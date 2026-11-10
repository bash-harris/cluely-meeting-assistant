const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cluelyApi', {
  // Stealth window management
  setIgnoreMouseEvents: (ignore, forward = true) => {
    ipcRenderer.send('set-ignore-mouse-events', { ignore, forward });
  },
  toggleStealthWindow: () => {
    ipcRenderer.send('toggle-stealth-window');
  },
  setContentProtection: (enable) => {
    ipcRenderer.send('set-content-protection', enable);
  },
  closeApp: () => {
    ipcRenderer.send('close-app');
  },
  minimizeApp: () => {
    ipcRenderer.send('minimize-app');
  },

  // Audio & Stream control
  setAudioMode: (mode) => {
    ipcRenderer.send('set-audio-mode', mode); // 'dev-synthetic' or 'live'
  },
  triggerDeviceFailover: () => {
    ipcRenderer.send('trigger-device-failover');
  },
  triggerAIAssist: (customQuery = null) => {
    ipcRenderer.send('trigger-ai-assist', customQuery);
  },
  clearTranscript: () => {
    ipcRenderer.send('clear-transcript');
  },

  // Test Matrix & Verification
  runTestMatrix: () => {
    return ipcRenderer.invoke('run-test-matrix');
  },
  runSingleTest: (testIndex) => {
    return ipcRenderer.invoke('run-single-test', testIndex);
  },
  getDryRunPayload: () => {
    return ipcRenderer.invoke('get-dry-run-payload');
  },

  // Local RAG
  getDocuments: () => {
    return ipcRenderer.invoke('get-documents');
  },
  addDocument: (title, content, category) => {
    return ipcRenderer.invoke('add-document', { title, content, category });
  },

  // Event Listeners from Main
  onTurnInterim: (callback) => {
    ipcRenderer.on('turn-interim', (_, data) => callback(data));
  },
  onTurnFinal: (callback) => {
    ipcRenderer.on('turn-final', (_, data) => callback(data));
  },
  onAudioLevels: (callback) => {
    ipcRenderer.on('audio-levels', (_, data) => callback(data));
  },
  onBleedStatus: (callback) => {
    ipcRenderer.on('bleed-status', (_, data) => callback(data));
  },
  onDeviceEvent: (callback) => {
    ipcRenderer.on('device-event', (_, data) => callback(data));
  },
  onAnswerStart: (callback) => {
    ipcRenderer.on('answer-start', (_, data) => callback(data));
  },
  onAnswerChunk: (callback) => {
    ipcRenderer.on('answer-chunk', (_, data) => callback(data));
  },
  onAnswerDone: (callback) => {
    ipcRenderer.on('answer-done', (_, data) => callback(data));
  },
  onHotkeyTriggered: (callback) => {
    ipcRenderer.on('hotkey-triggered', (_, data) => callback(data));
  },
  onProtectionState: (callback) => {
    ipcRenderer.on('protection-state', (_, data) => callback(data));
  }
});

