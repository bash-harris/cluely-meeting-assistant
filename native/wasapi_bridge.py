"""
Native Windows WASAPI Dual-Channel Audio Capture Bridge
Captures:
- Channel 1: Multi-endpoint Windows Audio Output (WASAPI Loopback)
  Taps Bluetooth headphones, laptop speakers, or USB audio simultaneously.
- Channel 0: Hardware Microphone
  Isolates microphone audio with Acoustic Echo Cancellation / Bleed Gate.

Subsystem specifications:
- Thread-safe COM initialization (CoInitialize) on all capture and STT worker threads
- Downsampling to 16 kHz 16-bit linear PCM in worker threads
- 400ms / 300ms VAD silence threshold & 3.5s max utterance window for continuous streaming
- Audio peak normalization to 0.95 before STT for high recognition accuracy
- Dynamic device reconnect / endpoint failover without crashing
- Emits JSON lines to stdout
"""

import sys
import json
import time
import threading
import warnings
import ctypes
import numpy as np

# Suppress mediafoundation runtime warnings
warnings.filterwarnings("ignore")

try:
    import soundcard as sc
    import speech_recognition as sr
except ImportError as e:
    sys.stderr.write(f"[WASAPI Bridge] Import error: {e}\n")
    sys.exit(1)

# Optional open-sourced WhisperFlow engine
try:
    from whisperflow_engine import WhisperFlowEngine
    whisper_engine = WhisperFlowEngine()
except Exception:
    whisper_engine = None

SAMPLE_RATE = 16000
CHUNK_MS = 100
SAMPLES_PER_CHUNK = int(SAMPLE_RATE * CHUNK_MS / 1000) # 1600 samples
SYS_SPEECH_RMS_THRESHOLD = 0.003
MIC_SPEECH_RMS_THRESHOLD = 0.004
VAD_SILENCE_THRESHOLD_MS = 900   # Wait 900ms of pause before finalizing a sentence
MAX_TURN_SECONDS = 5.0           # Maximum 5 seconds per continuous utterance (reduced from 7s)
MIN_TURN_SECONDS = 0.6

recognizer = sr.Recognizer()

# Shared metrics
latest_mic_rms = 0.0
latest_sys_rms = 0.0

# Ensure UTF-8 output without buffering issues
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

def emit(data):
    try:
        line = json.dumps(data) + '\n'
        sys.stdout.write(line)
        sys.stdout.flush()
    except Exception as e:
        sys.stderr.write(f"[WASAPI Bridge] emit error: {e}\n")

def transcribe_audio_worker(pcm_float_array, channel, speaker):
    """STT worker thread with peak normalization"""
    try:
        ctypes.windll.ole32.CoInitialize(None)
    except Exception:
        pass

    try:
        max_val = float(np.max(np.abs(pcm_float_array)))
        # Filter out quiet ambient noise / background room hiss
        if max_val < 0.025:
            return

        # Peak normalization ensures crystal clear recognition even at low system/video volume
        norm_pcm = (pcm_float_array / max_val * 0.95)
        clipped = np.clip(norm_pcm, -1.0, 1.0)
        pcm_int16 = (clipped * 32767).astype(np.int16).tobytes()

        text = None
        # Try local WhisperFlow engine first if available
        if whisper_engine and getattr(whisper_engine, 'is_available', False):
            try:
                text = whisper_engine.transcribe_chunk(norm_pcm, SAMPLE_RATE)
            except Exception:
                text = None

        # Fallback to Google Speech Recognition
        if not text:
            audio_data = sr.AudioData(pcm_int16, SAMPLE_RATE, 2)
            text = recognizer.recognize_google(audio_data, language="en-US")

        if text and len(text.strip()) > 0:
            emit({
                "type": "turn",
                "channel": channel,
                "speaker": speaker,
                "text": text.strip(),
                "isFinal": True,
                "timestamp": int(time.time() * 1000)
            })
    except sr.UnknownValueError:
        pass # Low volume audio or music without intelligible English speech
    except sr.RequestError as e:
        sys.stderr.write(f"[WASAPI Bridge] STT network error: {e}\n")
    except Exception as e:
        sys.stderr.write(f"[WASAPI Bridge] Transcription error: {e}\n")

def single_speaker_loopback_worker(spk_name):
    """Listens on a specific speaker endpoint (e.g. Headphones or Laptop Speakers)"""
    global latest_sys_rms
    try:
        ctypes.windll.ole32.CoInitialize(None)
    except Exception:
        pass

    sys.stderr.write(f"[WASAPI Bridge] Tapping System Audio Loopback on: {spk_name}\n")

    while True:
        try:
            loop = sc.get_microphone(id=str(spk_name), include_loopback=True)
            accumulated_chunks = []
            silence_duration_ms = 0
            is_speaking = False

            with loop.recorder(samplerate=SAMPLE_RATE, channels=1) as recorder:
                while True:
                    data = recorder.record(numframes=SAMPLES_PER_CHUNK)[:, 0]
                    rms = float(np.sqrt(np.mean(data**2)))

                    # Update global sys rms if this device is louder
                    if rms > latest_sys_rms or latest_sys_rms < 0.001:
                        latest_sys_rms = rms

                    if rms > SYS_SPEECH_RMS_THRESHOLD:
                        is_speaking = True
                        silence_duration_ms = 0
                        accumulated_chunks.append(data)

                        current_duration_s = (len(accumulated_chunks) * CHUNK_MS) / 1000.0
                        if current_duration_s >= MAX_TURN_SECONDS:
                            turn_data = np.concatenate(accumulated_chunks)
                            accumulated_chunks = []
                            is_speaking = False
                            silence_duration_ms = 0

                            t = threading.Thread(
                                target=transcribe_audio_worker,
                                args=(turn_data, 1, "Speaker"),
                                daemon=True
                            )
                            t.start()
                    elif is_speaking:
                        accumulated_chunks.append(data)
                        silence_duration_ms += CHUNK_MS
                        if silence_duration_ms >= VAD_SILENCE_THRESHOLD_MS:
                            turn_data = np.concatenate(accumulated_chunks)
                            accumulated_chunks = []
                            is_speaking = False
                            silence_duration_ms = 0

                            if len(turn_data) >= SAMPLE_RATE * MIN_TURN_SECONDS:
                                t = threading.Thread(
                                    target=transcribe_audio_worker,
                                    args=(turn_data, 1, "Speaker"),
                                    daemon=True
                                )
                                t.start()
        except Exception as e:
            sys.stderr.write(f"[WASAPI Bridge] Loopback warning for {spk_name}: {e}. Rebinding in 2s...\n")
            time.sleep(2.0)

def loopback_coordinator():
    """Dynamically monitors all playback devices and spawns capture listeners"""
    try:
        ctypes.windll.ole32.CoInitialize(None)
    except Exception:
        pass

    spawned = set()
    while True:
        try:
            for s in sc.all_speakers():
                if s.name not in spawned:
                    spawned.add(s.name)
                    t = threading.Thread(
                        target=single_speaker_loopback_worker,
                        args=(s.name,),
                        daemon=True
                    )
                    t.start()
        except Exception as e:
            sys.stderr.write(f"[WASAPI Bridge] Device discovery error: {e}\n")
        time.sleep(4.0)

def mic_worker():
    """Captures Hardware Microphone with Acoustic Bleed Gate and VAD"""
    global latest_mic_rms
    try:
        ctypes.windll.ole32.CoInitialize(None)
    except Exception:
        pass

    while True:
        try:
            mic = sc.default_microphone()
            sys.stderr.write(f"[WASAPI Bridge] Tapping Hardware Microphone on: {mic.name}\n")

            accumulated_chunks = []
            silence_duration_ms = 0
            is_speaking = False

            with mic.recorder(samplerate=SAMPLE_RATE, channels=1) as recorder:
                while True:
                    data = recorder.record(numframes=SAMPLES_PER_CHUNK)[:, 0]
                    rms = float(np.sqrt(np.mean(data**2)))
                    latest_mic_rms = rms

                    # Acoustic Bleed Gate: Drop mic audio if it matches speaker bleed
                    if latest_sys_rms > 0.03 and rms < latest_sys_rms * 0.7:
                        # Suppress speakerphone bleed
                        continue

                    if rms > MIC_SPEECH_RMS_THRESHOLD:
                        is_speaking = True
                        silence_duration_ms = 0
                        accumulated_chunks.append(data)

                        current_duration_s = (len(accumulated_chunks) * CHUNK_MS) / 1000.0
                        if current_duration_s >= MAX_TURN_SECONDS:
                            turn_data = np.concatenate(accumulated_chunks)
                            accumulated_chunks = []
                            is_speaking = False
                            silence_duration_ms = 0

                            t = threading.Thread(
                                target=transcribe_audio_worker,
                                args=(turn_data, 0, "You (Mic)"),
                                daemon=True
                            )
                            t.start()
                    elif is_speaking:
                        accumulated_chunks.append(data)
                        silence_duration_ms += CHUNK_MS
                        if silence_duration_ms >= VAD_SILENCE_THRESHOLD_MS:
                            turn_data = np.concatenate(accumulated_chunks)
                            accumulated_chunks = []
                            is_speaking = False
                            silence_duration_ms = 0

                            if len(turn_data) >= SAMPLE_RATE * MIN_TURN_SECONDS:
                                t = threading.Thread(
                                    target=transcribe_audio_worker,
                                    args=(turn_data, 0, "You (Mic)"),
                                    daemon=True
                                )
                                t.start()
        except Exception as e:
            sys.stderr.write(f"[WASAPI Bridge] Microphone warning: {e}. Rebinding in 2s...\n")
            time.sleep(2.0)

def levels_ticker():
    """Emits VU levels at ~10 Hz with smooth meter decay"""
    global latest_mic_rms, latest_sys_rms
    while True:
        mic_level = min(1.0, latest_mic_rms * 6.0)
        sys_level = min(1.0, latest_sys_rms * 6.0)
        is_bleed = latest_sys_rms > 0.03 and latest_mic_rms < latest_sys_rms * 0.7

        emit({
            "type": "levels",
            "ch0Mic": round(mic_level, 3),
            "ch1Sys": round(sys_level, 3),
            "bleedSuppressed": is_bleed
        })

        # Smooth decay
        latest_mic_rms = max(0.0, latest_mic_rms * 0.75)
        latest_sys_rms = max(0.0, latest_sys_rms * 0.75)
        time.sleep(0.1)

if __name__ == '__main__':
    sys.stderr.write("[WASAPI Bridge] Initializing dual-channel WASAPI engine...\n")
    emit({"type": "ready", "status": "WASAPI_ACTIVE"})

    t_loop = threading.Thread(target=loopback_coordinator, daemon=True)
    t_mic = threading.Thread(target=mic_worker, daemon=True)
    t_levels = threading.Thread(target=levels_ticker, daemon=True)

    t_loop.start()
    t_mic.start()
    t_levels.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        sys.stderr.write("[WASAPI Bridge] Shutting down.\n")
