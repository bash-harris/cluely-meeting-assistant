/**
 * Live Audio Preview Server for Cluely Meeting Assistant
 * Spawns the native WASAPI bridge to capture real-time Windows system audio (Channel 1)
 * and hardware microphone (Channel 0) without any mock or hardcoded feeds.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const WebSocket = require('ws');

const { TranscriptionPipeline } = require('./main/transcriptionPipeline');
const { IntentRouter } = require('./main/intentRouter');
const { RAGEngine } = require('./main/ragEngine');
const { TestMatrixRunner } = require('./main/testMatrixRunner');

const PORT = process.env.PORT || 3000;

// Subsystems
const ragEngine = new RAGEngine();
const intentRouter = new IntentRouter({ ragEngine });
const transcriptionPipeline = new TranscriptionPipeline();
const testMatrixRunner = new TestMatrixRunner();

let isProtected = false;
let connectedClients = new Set();
let wasapiProcess = null;

// MIME Types
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // REST API Endpoints
  if (pathname === '/api/test-matrix') {
    testMatrixRunner.runFullMatrix(isProtected, true).then(result => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  if (pathname === '/api/test-single') {
    const index = parseInt(urlObj.searchParams.get('index') || '1', 10);
    const testMap = {
      1: () => testMatrixRunner.runAudioChannelIsolationTest(),
      2: () => testMatrixRunner.runEchoGateTest(),
      3: () => testMatrixRunner.runDiarizationBenchmarkTest(),
      4: () => testMatrixRunner.runIntentRouterTest(),
      5: () => testMatrixRunner.runStealthExclusionTest(isProtected),
      6: () => testMatrixRunner.runClickThroughTest(true)
    };
    const fn = testMap[index] || testMap[1];
    fn().then(result => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  if (pathname === '/api/dry-run') {
    const turns = transcriptionPipeline.getRollingTurns(60);
    const payload = intentRouter.buildPromptPayload(turns);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
    return;
  }

  if (pathname === '/api/config') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const config = JSON.parse(body);
          intentRouter.setAIConfig(config);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            provider: intentRouter.aiProvider,
            hasOpenRouterKey: !!intentRouter.openRouterApiKey,
            openRouterModel: intentRouter.openRouterModel,
            hasGeminiKey: !!intentRouter.geminiApiKey,
            geminiModel: intentRouter.geminiModel,
            hasDeepSeekKey: !!intentRouter.deepseekApiKey,
            deepseekModel: intentRouter.deepseekModel
          }));
        } catch {
          res.writeHead(400);
          res.end('Invalid JSON');
        }
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      provider: intentRouter.aiProvider,
      hasOpenRouterKey: !!intentRouter.openRouterApiKey,
      openRouterModel: intentRouter.openRouterModel,
      hasGeminiKey: !!intentRouter.geminiApiKey,
      geminiModel: intentRouter.geminiModel,
      hasDeepSeekKey: !!intentRouter.deepseekApiKey,
      deepseekModel: intentRouter.deepseekModel
    }));
    return;
  }

  if (pathname === '/api/documents') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { title, content, category } = JSON.parse(body);
          ragEngine.addDocument(title, content, category || 'Custom');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(ragEngine.getAllDocuments()));
        } catch {
          res.writeHead(400);
          res.end('Invalid JSON');
        }
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ragEngine.getAllDocuments()));
    return;
  }

  // Static File Serving
  let filePath = '';
  if (pathname === '/' || pathname === '/index.html') {
    filePath = path.join(__dirname, 'renderer', 'index.html');
  } else {
    filePath = path.join(__dirname, 'renderer', pathname);
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

// Setup WebSocket Server
const wss = new WebSocket.Server({ server, path: '/ws' });

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload });
  connectedClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

wss.on('connection', (ws) => {
  connectedClients.add(ws);

  ws.send(JSON.stringify({
    type: 'protection-state',
    payload: { isProtected, flag: isProtected ? 'WDA_EXCLUDEFROMCAPTURE' : 'WDA_NONE' }
  }));

  ws.send(JSON.stringify({
    type: 'config-state',
    payload: {
      provider: intentRouter.aiProvider,
      hasOpenRouterKey: !!intentRouter.openRouterApiKey,
      openRouterModel: intentRouter.openRouterModel,
      hasGeminiKey: !!intentRouter.geminiApiKey,
      geminiModel: intentRouter.geminiModel,
      hasDeepSeekKey: !!intentRouter.deepseekApiKey,
      deepseekModel: intentRouter.deepseekModel
    }
  }));

  // Send current ring buffer history to client
  const history = transcriptionPipeline.getRingBuffer();
  history.forEach(turn => {
    ws.send(JSON.stringify({ type: 'turn-final', payload: turn }));
  });

  ws.on('message', async (data) => {
    try {
      const { type, payload } = JSON.parse(data);

      if (type === 'trigger-ai-assist') {
        await handleAIAssist(payload ? payload.customQuery : null);
      } else if (type === 'set-content-protection') {
        isProtected = !!(payload && payload.enable);
        broadcast('protection-state', {
          isProtected,
          flag: isProtected ? 'WDA_EXCLUDEFROMCAPTURE (0x00000011)' : 'WDA_NONE'
        });
      } else if (type === 'clear-transcript') {
        transcriptionPipeline.clear();
        broadcast('transcript-cleared', {});
      } else if (type === 'set-ai-config' || type === 'set-openrouter-config') {
        intentRouter.setAIConfig(payload || {});
        broadcast('config-state', {
          provider: intentRouter.aiProvider,
          hasOpenRouterKey: !!intentRouter.openRouterApiKey,
          openRouterModel: intentRouter.openRouterModel,
          hasGeminiKey: !!intentRouter.geminiApiKey,
          geminiModel: intentRouter.geminiModel,
          hasDeepSeekKey: !!intentRouter.deepseekApiKey,
          deepseekModel: intentRouter.deepseekModel
        });
      }
    } catch (err) {
      console.error('[WebSocket] Message handling error:', err);
    }
  });

  ws.on('close', () => {
    connectedClients.delete(ws);
  });
});

async function handleAIAssist(manualQuery = null) {
  // Send the entire recorded transcript ring buffer to the AI API
  const allTurns = transcriptionPipeline.getRingBuffer();
  const payload = intentRouter.buildPromptPayload(allTurns, manualQuery);

  broadcast('answer-start', {
    query: payload.isolatedQuery,
    ragChunks: payload.ragChunks,
    detectedIntent: payload.detectedIntent
  });

  await intentRouter.streamAnswer(
    payload,
    (chunk) => broadcast('answer-chunk', chunk),
    (result) => broadcast('answer-done', result)
  );
}

// -------------------------------------------------------------
// Native WASAPI Subprocess Bridge
// -------------------------------------------------------------
function startNativeWasapiBridge() {
  const bridgeScript = path.join(__dirname, '../native/wasapi_bridge.py');
  if (!fs.existsSync(bridgeScript)) {
    console.warn('[Server] WASAPI bridge script not found:', bridgeScript);
    return;
  }

  console.log('[Server] Spawning Native WASAPI Bridge (System Loopback + Hardware Mic)...');
  wasapiProcess = spawn('python', ['-u', bridgeScript], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' }
  });

  let lineBuffer = '';

  wasapiProcess.stdout.on('data', async (chunk) => {
    lineBuffer += chunk.toString('utf-8');
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop(); // Keep remainder

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.type === 'levels') {
          broadcast('audio-levels', {
            ch0Mic: msg.ch0Mic || 0,
            ch1Sys: msg.ch1Sys || 0,
            bleedSuppressed: !!msg.bleedSuppressed
          });
        } else if (msg.type === 'turn') {
          console.log(`[WASAPI Turn] Channel ${msg.channel} (${msg.speaker}): "${msg.text}"`);

          transcriptionPipeline.feedTranscriptToken(msg.channel, msg.text, {
            speakerId: msg.speaker,
            isFinal: false,
            confidence: 0.95
          });

          const finalTurn = transcriptionPipeline.finalizeTurn(msg.channel, 0.95) || {
            id: `turn-${Date.now()}`,
            channel: msg.channel,
            speaker: msg.speaker,
            text: msg.text,
            timestamp: msg.timestamp || Date.now()
          };

          broadcast('turn-final', finalTurn);

          // Note: Automatic co-pilot recommendation on sentence finish has been disabled per user requirement.
          // AI co-pilot is now triggered exclusively when the user clicks 'AI Co-Pilot' or hits Ctrl+Enter.
        }
      } catch (err) {
        // Ignore unparseable non-JSON lines
      }
    }
  });

  wasapiProcess.on('close', (code) => {
    console.log(`[Server] WASAPI Bridge exited with code ${code}`);
    wasapiProcess = null;
  });
}

// Start Server & Bridge
server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n============================================================`);
  console.log(`  CLUELY MEETING ASSISTANT - NATIVE SYSTEM & MIC CAPTURE`);
  console.log(`  Access URL:  ${url}`);
  console.log(`  Capturing:   Windows WASAPI System Audio Loopback + Hardware Mic`);
  console.log(`============================================================\n`);

  startNativeWasapiBridge();
  exec(`start ${url}`);
});

process.on('exit', () => {
  if (wasapiProcess) wasapiProcess.kill();
});
