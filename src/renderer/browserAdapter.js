/**
 * Browser Adapter for Cluely API
 * Provides seamless drop-in compatibility for window.cluelyApi in standard web browsers.
 * Communicates with the backend server over WebSockets & fetch API.
 */

(function () {
  if (window.cluelyApi) {
    // Already in Electron with native contextBridge
    return;
  }

  console.log('[BrowserAdapter] Initializing Browser Cluely API bridge...');

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

  let ws = null;
  const eventListeners = {
    'turn-interim': [],
    'turn-final': [],
    'audio-levels': [],
    'bleed-status': [],
    'device-event': [],
    'answer-start': [],
    'answer-chunk': [],
    'answer-done': [],
    'hotkey-triggered': [],
    'protection-state': []
  };

  function connectWs() {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[BrowserAdapter] Connected to real-time meeting pipeline');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const { type, payload } = msg;
        if (eventListeners[type]) {
          eventListeners[type].forEach(cb => cb(payload));
        }
      } catch (err) {
        console.error('[BrowserAdapter] Message parse error:', err);
      }
    };

    ws.onclose = () => {
      console.warn('[BrowserAdapter] WebSocket disconnected, reconnecting in 1s...');
      setTimeout(connectWs, 1000);
    };
  }

  connectWs();

  function sendWs(type, payload = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    }
  }

  // Implement window.cluelyApi interface
  window.cluelyApi = {
    setIgnoreMouseEvents: (ignore, forward = true) => {
      console.log(`[BrowserAdapter] Click-through set to ${ignore} (Forward: ${forward})`);
    },
    toggleStealthWindow: () => {
      console.log('[BrowserAdapter] Toggle stealth window requested');
    },
    setContentProtection: (enable) => {
      sendWs('set-content-protection', { enable });
    },
    closeApp: () => {
      window.close();
    },
    minimizeApp: () => {
      console.log('[BrowserAdapter] Minimize requested');
    },

    setAudioMode: (mode) => {
      sendWs('set-audio-mode', { mode });
    },
    sendLiveTurn: (turnData) => {
      sendWs('live-transcript-turn', turnData);
    },
    startYouTubeStream: (url = 'https://www.youtube.com/watch?v=9tOu4r-FiQI', speed = 1.0) => {
      sendWs('start-youtube-stream', { url, speed });
    },
    triggerDeviceFailover: () => {
      sendWs('trigger-device-failover');
    },
    triggerAIAssist: (customQuery = null) => {
      sendWs('trigger-ai-assist', { customQuery });
    },
    clearTranscript: () => {
      sendWs('clear-transcript');
    },

    runTestMatrix: async () => {
      const res = await fetch('/api/test-matrix');
      return await res.json();
    },
    runSingleTest: async (testIndex) => {
      const res = await fetch(`/api/test-single?index=${testIndex}`);
      return await res.json();
    },
    getDryRunPayload: async () => {
      const res = await fetch('/api/dry-run');
      return await res.json();
    },
    getDocuments: async () => {
      const res = await fetch('/api/documents');
      return await res.json();
    },
    addDocument: async (title, content, category) => {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, category })
      });
      return await res.json();
    },

    getConfig: async () => {
      const res = await fetch('/api/config');
      return await res.json();
    },

    setConfig: async (config) => {
      sendWs('set-openrouter-config', config);
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      return await res.json();
    },

    onTurnInterim: (cb) => eventListeners['turn-interim'].push(cb),
    onTurnFinal: (cb) => eventListeners['turn-final'].push(cb),
    onAudioLevels: (cb) => eventListeners['audio-levels'].push(cb),
    onBleedStatus: (cb) => eventListeners['bleed-status'].push(cb),
    onDeviceEvent: (cb) => eventListeners['device-event'].push(cb),
    onAnswerStart: (cb) => eventListeners['answer-start'].push(cb),
    onAnswerChunk: (cb) => eventListeners['answer-chunk'].push(cb),
    onAnswerDone: (cb) => eventListeners['answer-done'].push(cb),
    onHotkeyTriggered: (cb) => eventListeners['hotkey-triggered'].push(cb),
    onProtectionState: (cb) => eventListeners['protection-state'].push(cb)
  };

  // Keyboard shortcut listener for browser preview
  window.addEventListener('keydown', (e) => {
    // Ctrl + Enter -> AI Assist (sends entire transcript and optional custom prompt)
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      const promptInput = document.getElementById('copilot-custom-prompt');
      const query = promptInput ? promptInput.value.trim() : null;
      window.cluelyApi.triggerAIAssist(query || null);
    }
    // Ctrl + Shift + T -> Test Matrix
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'T' || e.key === 't')) {
      e.preventDefault();
      const modal = document.getElementById('test-matrix-modal');
      if (modal) {
        modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
      }
    }
  });
})();

