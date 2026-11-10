"""
WhisperFlow Real-Time Audio Capture & Streaming Transcription Engine
Interfaces with open-sourced WhisperFlow (https://github.com/dimastatz/whisper-flow)
for local streaming Whisper transcription over WASAPI loopback and microphone chunks.
"""

import sys
import numpy as np

try:
    import whisperflow
    import whisperflow.transcriber as wt
    WHISPERFLOW_AVAILABLE = True
except Exception as e:
    WHISPERFLOW_AVAILABLE = False
    wt = None

class WhisperFlowEngine:
    def __init__(self, model_name="tiny.en.pt"):
        self.is_available = WHISPERFLOW_AVAILABLE
        self.model_name = model_name
        self.pool = None

        if self.is_available and wt:
            try:
                available_models = wt.list_models()
                target_model = model_name if model_name in available_models else (available_models[0] if available_models else "tiny.en.pt")
                sys.stderr.write(f"[WhisperFlow] Initializing WhisperFlow model pool ({target_model})...\n")
                self.pool = wt.get_model(target_model)
                sys.stderr.write(f"[WhisperFlow] WhisperFlow local streaming model ({target_model}) active.\n")
            except Exception as e:
                sys.stderr.write(f"[WhisperFlow] WhisperFlow load warning: {e}. Falling back to Cloud STT.\n")
                self.is_available = False

    def transcribe_chunk(self, pcm_int16_bytes, sample_rate=16000):
        """Transcribes a 16-bit linear PCM byte buffer using WhisperFlow ModelPool"""
        if not self.is_available or not self.pool or not wt:
            return None

        try:
            result = wt.transcribe_pcm_chunks(
                self.pool,
                [pcm_int16_bytes],
                lang="en",
                temperature=0.0
            )
            if result and isinstance(result, dict):
                text = result.get('text', '').strip()
                return text if text else None
            return None
        except Exception as e:
            sys.stderr.write(f"[WhisperFlow] Transcription warning: {e}\n")
            return None

if __name__ == '__main__':
    engine = WhisperFlowEngine()
    print("WhisperFlow Engine Status: Ready" if engine.is_available else "WhisperFlow Engine Status: Unavailable")
