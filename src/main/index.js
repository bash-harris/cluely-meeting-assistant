/**
 * Main Electron Process
 * 
 * Manages the Stealth Overlay Window, OS-level Screen Capture Exclusion (WDA_EXCLUDEFROMCAPTURE),
 * Forward Click-Through Routing, Global OS Hotkeys, and Native Audio Subsystems.
 */

const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');
const { AudioCaptureBridge } = require('./audioCaptureBridge');
const { TranscriptionPipeline } = require('./transcriptionPipeline');
const { IntentRouter } = require('./intentRouter');
const { RAGEngine } = require('./ragEngine');
const { TestMatrixRunner } = require('./testMatrixRunner');

let mainWindow = null;
let isProtected = false; // Off by default in dev preview so remote desktop/screen sharing can see it; togglable via button or hotkey!
let isStealthVisible = true;
let isClickThroughActive = false;

// Initialize Core Subsystems
const ragEngine = new RAGEngine();
const intentRouter = new IntentRouter({ ragEngine });
const transcriptionPipeline = new TranscriptionPipeline();
const audioBridge = new AudioCaptureBridge({ mode: 'dev-synthetic' });
const testMatrixRunner = new TestMatrixRunner();

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  const windowWidth = Math.min(980, Math.floor(width * 0.75));
  const windowHeight = Math.min(780, Math.floor(height * 0.85));

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    center: true, // Center on primary monitor so it pops up right in front of user
    title: "Cluely - Stealth Meeting Assistant",
    backgroundColor: '#0d1117',
    frame: true, // Standard window frame so it's clearly visible, draggable, and resizable
    alwaysOnTop: true, // Stays above IDEs and meeting windows
    skipTaskbar: false, // Visible on Windows Taskbar and Alt+Tab
    resizable: true,
    show: false, // Will show smoothly on ready-to-show
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  // Load UI
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(true, 'floating');
    console.log('[Window] Cluely preview window shown and focused in center of screen.');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Register Global OS Shortcuts (No focus stealing)
function registerGlobalShortcuts() {
  // Command or Control + Enter -> Trigger AI Answer
  globalShortcut.register('CommandOrControl+Enter', () => {
    console.log('[Hotkey] Triggered AI Assist (Ctrl+Enter)');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('hotkey-triggered', { action: 'TRIGGER_ASSIST' });
      handleTriggerAIAssist();
    }
  });

  // Command or Control + Backslash -> Stealth Panic Toggle (Hide / Show)
  globalShortcut.register('CommandOrControl+\\', () => {
    console.log('[Hotkey] Stealth Panic Toggle (Ctrl+\\)');
    toggleStealthWindow();
  });

  // Command or Control + Shift + T -> Toggle Pre-Compilation Test Matrix
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('hotkey-triggered', { action: 'TOGGLE_TEST_MATRIX' });
    }
  });
}

function toggleStealthWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (isStealthVisible) {
    mainWindow.hide();
    isStealthVisible = false;
  } else {
    mainWindow.show();
    mainWindow.focus();
    isStealthVisible = true;
  }
}

async function handleTriggerAIAssist(manualQuery = null) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  // Send the entire recorded transcript ring buffer to the AI API
  const allTurns = transcriptionPipeline.getRingBuffer();
  const payload = intentRouter.buildPromptPayload(allTurns, manualQuery);

  mainWindow.webContents.send('answer-start', {
    query: payload.isolatedQuery,
    ragChunks: payload.ragChunks,
    detectedIntent: payload.detectedIntent
  });

  await intentRouter.streamAnswer(
    payload,
    (chunk) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('answer-chunk', chunk);
      }
    },
    (result) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('answer-done', result);
      }
    }
  );
}

// Wire Subsystem Events to Renderer UI
function wireSubsystemEvents() {
  // Audio level meter updates
  audioBridge.on('levels', (levels) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('audio-levels', levels);
    }
  });

  // Echo bleed status
  audioBridge.on('pcm_frame', (frame) => {
    if (frame.channel === 0 && frame.isSuppressed) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bleed-status', {
          isBleedActive: true,
          suppressed: true,
          timestamp: frame.timestamp
        });
      }
    }
  });

  // Device failover events
  audioBridge.on('device_disconnect', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('device-event', data);
    }
  });
  audioBridge.on('device_rebound', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('device-event', data);
    }
  });

  // Transcription Pipeline events
  transcriptionPipeline.on('interim_turn', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('turn-interim', data);
    }
  });

  transcriptionPipeline.on('final_turn', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('turn-final', data);
    }

    // Note: Automatic co-pilot recommendation on sentence finish has been disabled per user requirement.
    // AI co-pilot is triggered exclusively when the user clicks 'AI Co-Pilot' or hits Ctrl+Enter.
  });
}

// Live Simulated Meeting Feed for Dev-Mode Hot-Reload
function startDevModeMeetingFeed() {
  const script = [
    { channel: 1, speaker: "Speaker 1", pitchHz: 155, text: "Hey team, let's review the dual-channel native capture architecture." },
    { channel: 0, speaker: "You (Mic)", pitchHz: 0, text: "Sounds good, I have the audio bridge metrics open right now." },
    { channel: 1, speaker: "Speaker 2", pitchHz: 235, text: "Could you walk us through how the dual-channel audio isolation handles laptop speaker bleed?" },
    { channel: 1, speaker: "Speaker 1", pitchHz: 155, text: "Also, what is our end-to-end latency SLA for the STT turns?" },
    { channel: 1, speaker: "Speaker 2", pitchHz: 235, text: "I'm concerned that Zoom or Google Meet will capture the overlay if the candidate is sharing their full desktop." }
  ];

  let scriptIndex = 0;

  function scheduleNext() {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const item = script[scriptIndex % script.length];
    scriptIndex++;

    const words = item.text.split(' ');
    let wordIdx = 0;

    const tokenInterval = setInterval(() => {
      if (wordIdx < words.length) {
        transcriptionPipeline.feedTranscriptToken(item.channel, words[wordIdx], {
          pitchHz: item.pitchHz,
          speakerId: item.speaker,
          isFinal: false
        });
        wordIdx++;
      } else {
        clearInterval(tokenInterval);
        setTimeout(() => {
          transcriptionPipeline.finalizeTurn(item.channel, 0.96);
          // Wait 3.5s before next participant speaks
          setTimeout(scheduleNext, 3800);
        }, 400); // VAD silence threshold
      }
    }, 180);
  }

  // Start feed after 1.5s
  setTimeout(scheduleNext, 1500);
}

// IPC Handlers
function setupIpcHandlers() {
  // Click-through mouse event toggling
  ipcMain.on('set-ignore-mouse-events', (event, { ignore, forward }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(ignore, { forward: !!forward });
      isClickThroughActive = ignore;
    }
  });

  // Toggle stealth window
  ipcMain.on('toggle-stealth-window', () => {
    toggleStealthWindow();
  });

  // Set Content Protection (WDA_EXCLUDEFROMCAPTURE)
  ipcMain.on('set-content-protection', (event, enable) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.setContentProtection(enable);
        isProtected = enable;
        console.log(`[Stealth] win.setContentProtection(${enable}) updated.`);
        mainWindow.webContents.send('protection-state', {
          isProtected: enable,
          flag: enable ? 'WDA_EXCLUDEFROMCAPTURE (0x00000011)' : 'WDA_NONE'
        });
      } catch (err) {
        console.error('[Stealth] setContentProtection error:', err);
      }
    }
  });

  ipcMain.on('trigger-ai-assist', (_, customQuery) => {
    handleTriggerAIAssist(customQuery);
  });

  ipcMain.on('trigger-device-failover', () => {
    audioBridge.triggerDeviceFailover();
  });

  ipcMain.on('clear-transcript', () => {
    transcriptionPipeline.clear();
  });

  ipcMain.on('close-app', () => {
    app.quit();
  });

  ipcMain.on('minimize-app', () => {
    if (mainWindow) mainWindow.minimize();
  });

  // Test Matrix IPC Handlers
  ipcMain.handle('run-test-matrix', async () => {
    return await testMatrixRunner.runFullMatrix(isProtected, isClickThroughActive);
  });

  ipcMain.handle('run-single-test', async (_, testIndex) => {
    switch (testIndex) {
      case 1: return await testMatrixRunner.runAudioChannelIsolationTest();
      case 2: return await testMatrixRunner.runEchoGateTest();
      case 3: return await testMatrixRunner.runDiarizationBenchmarkTest();
      case 4: return await testMatrixRunner.runIntentRouterTest();
      case 5: return await testMatrixRunner.runStealthExclusionTest(isProtected);
      case 6: return await testMatrixRunner.runClickThroughTest(isClickThroughActive);
      default: throw new Error(`Unknown test index: ${testIndex}`);
    }
  });

  ipcMain.handle('get-dry-run-payload', async () => {
    const turns = transcriptionPipeline.getRollingTurns(60);
    return intentRouter.buildPromptPayload(turns);
  });

  ipcMain.handle('get-documents', async () => {
    return ragEngine.getAllDocuments();
  });

  ipcMain.handle('add-document', async (_, { title, content, category }) => {
    ragEngine.addDocument(title, content, category);
    return ragEngine.getAllDocuments();
  });
}

// App Lifecycle
app.whenReady().then(() => {
  createWindow();
  registerGlobalShortcuts();
  wireSubsystemEvents();
  setupIpcHandlers();

  // Start audio capture engine
  audioBridge.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  audioBridge.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
