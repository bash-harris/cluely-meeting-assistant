/**
 * Live Audio Capture & Speech Recognition Engine
 * Connects hardware microphone (Channel 0) and meeting system/tab audio (Channel 1)
 * directly in the browser or Electron using WebRTC & Chrome Speech API.
 */

class LiveMeetingAudioBridge {
  constructor() {
    this.audioCtx = null;
    this.micStream = null;
    this.meetingAudioStream = null;
    this.micRecognizer = null;
    this.remoteRecognizer = null;
    this.isMicActive = false;
    this.isMeetingAudioActive = false;
  }

  /**
   * Start Live Hardware Microphone Capture (Channel 0)
   */
  async startLiveMic(onLevelUpdate, onTranscriptTurn) {
    if (this.isMicActive) return;

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true
        }
      });

      this.initAudioContext();

      // Audio meter analyzer
      const micSource = this.audioCtx.createMediaStreamSource(this.micStream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 256;
      micSource.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateLevel = () => {
        if (!this.isMicActive) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength / 255;
        if (onLevelUpdate) onLevelUpdate(avg);
        requestAnimationFrame(updateLevel);
      };

      this.isMicActive = true;
      updateLevel();

      // Live Speech-to-Text for Channel 0 (Local Mic)
      this.initMicSpeechRecognition(onTranscriptTurn);

      return true;
    } catch (err) {
      console.error('[LiveAudio] Failed to access microphone:', err);
      alert('Microphone access error: ' + err.message);
      return false;
    }
  }

  stopLiveMic() {
    this.isMicActive = false;
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
    if (this.micRecognizer) {
      this.micRecognizer.stop();
      this.micRecognizer = null;
    }
  }

  /**
   * Start Meeting Audio Capture (Channel 1: Google Meet / Zoom tab or Desktop Audio)
   */
  async startMeetingAudio(onLevelUpdate, onRemoteTurn) {
    if (this.isMeetingAudioActive) return;

    try {
      // Prompt user to select Google Meet / Zoom tab or screen with system audio
      this.meetingAudioStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });

      const audioTracks = this.meetingAudioStream.getAudioTracks();
      if (audioTracks.length === 0) {
        alert('Notice: Please check "Share tab audio" or "Share system audio" when selecting the meeting window!');
        return false;
      }

      this.initAudioContext();

      const sysSource = this.audioCtx.createMediaStreamSource(this.meetingAudioStream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 256;
      sysSource.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateLevel = () => {
        if (!this.isMeetingAudioActive) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength / 255;
        if (onLevelUpdate) onLevelUpdate(avg);
        requestAnimationFrame(updateLevel);
      };

      this.isMeetingAudioActive = true;
      updateLevel();

      // Listen for track ending
      audioTracks[0].onended = () => {
        this.stopMeetingAudio();
      };

      return true;
    } catch (err) {
      console.error('[LiveAudio] Failed to tap meeting audio:', err);
      return false;
    }
  }

  stopMeetingAudio() {
    this.isMeetingAudioActive = false;
    if (this.meetingAudioStream) {
      this.meetingAudioStream.getTracks().forEach(t => t.stop());
      this.meetingAudioStream = null;
    }
  }

  initAudioContext() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtx();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  initMicSpeechRecognition(onTurn) {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      console.warn('[LiveAudio] Web Speech API not supported in this browser.');
      return;
    }

    this.micRecognizer = new SpeechRec();
    this.micRecognizer.continuous = true;
    this.micRecognizer.interimResults = true;
    this.micRecognizer.lang = 'en-US';

    this.micRecognizer.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        const isFinal = result.isFinal;
        if (onTurn) {
          onTurn({
            channel: 0,
            speaker: 'You (Mic)',
            text: transcript,
            isFinal,
            confidence: result[0].confidence || 0.95,
            timestamp: Date.now()
          });
        }
      }
    };

    this.micRecognizer.onerror = (e) => {
      console.warn('[LiveAudio] Mic recognition error:', e.error);
    };

    this.micRecognizer.onend = () => {
      if (this.isMicActive && this.micRecognizer) {
        try { this.micRecognizer.start(); } catch {}
      }
    };

    try {
      this.micRecognizer.start();
    } catch (e) {
      console.error('[LiveAudio] Could not start mic recognizer:', e);
    }
  }
}

window.liveAudioBridge = new LiveMeetingAudioBridge();

