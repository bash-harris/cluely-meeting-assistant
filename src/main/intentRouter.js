/**
 * Sliding-Window Intent Classifier and Context Router
 * 
 * Analyzes live conversation turns, isolates incoming questions directed at the user,
 * and generates concise, relevant answers directly addressing the conversation topic.
 */

const EventEmitter = require('events');
const { RAGEngine } = require('./ragEngine');

class IntentRouter extends EventEmitter {
  constructor(options = {}) {
    super();
    this.ragEngine = options.ragEngine || new RAGEngine();
    this.rollingWindowSeconds = options.rollingWindowSeconds || 60;

    // AI Provider selection: 'openrouter' | 'gemini' | 'deepseek' | 'local'
    this.aiProvider = options.aiProvider || process.env.AI_PROVIDER || 'openrouter';

    // OpenRouter config
    this.openRouterApiKey = options.openRouterApiKey || process.env.OPENROUTER_API_KEY || null;
    this.openRouterModel = options.openRouterModel || process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.2-3b-instruct:free';

    // Google Gemini config (Latest generation with highest free limits)
    this.geminiApiKey = options.geminiApiKey || process.env.GEMINI_API_KEY || null;
    this.geminiModel = options.geminiModel || process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';

    // DeepSeek config
    this.deepseekApiKey = options.deepseekApiKey || process.env.DEEPSEEK_API_KEY || null;
    this.deepseekModel = options.deepseekModel || process.env.DEEPSEEK_MODEL || 'deepseek-chat';

    // Pattern matchers for intent detection (<5ms)
    this.interrogativePatterns = [
      /\b(can|could|would|will)\s+you\b/i,
      /\bhow\s+(does|do|can|will|would|is|are|much|long|to)\b/i,
      /\bwhat\s+(is|are|happens|happened|about|was|were|the|if)\b/i,
      /\bwhat's\s+the\b/i,
      /\bwhy\s+(did|do|does|is|are|would|should)\b/i,
      /\b(is|are|do|does)\s+there\b/i,
      /\bwhere\s+(does|do|is|are)\b/i,
      /\b(asking|wondering|inquir(ed|ing)|curious)\s+if\b/i,
      /\bhow\s+many\b/i,
      /\?$/
    ];

    this.imperativePatterns = [
      /\b(walk\s+us\s+through|tell\s+me\s+about|explain\s+how|explain\s+why|summarize|give\s+an\s+overview|show\s+me|please\s+detail)\b/i
    ];

    this.objectionPatterns = [
      /\bi'm\s+concerned\s+that\b/i,
      /\bwhat\s+about\s+the\s+risk\b/i,
      /\bdoesn't\s+this\b/i,
      /\bisn't\s+(it|that|this)\b/i,
      /\blatency\s+seems\b/i,
      /\bhow\s+will\s+this\s+scale\b/i
    ];
  }

  /**
   * Fast Intent Classifier: Analyzes turns in the 60-second sliding window
   * Filters out Channel 0 (user) and focuses on Channel 1 (remote meeting/system audio)
   */
  classifyIntent(turns) {
    if (!turns || turns.length === 0) {
      return { isDetected: false, intentType: 'none', queryText: null };
    }

    // Role-Aware: Focus on Channel 1 (Incoming system/remote audio)
    const remoteTurns = turns.filter(t => t.channel === 1 && t.text && t.text.trim().length > 0);
    if (remoteTurns.length === 0) {
      return { isDetected: false, intentType: 'none', queryText: null };
    }

    // Check recent turns in reverse order
    for (let i = remoteTurns.length - 1; i >= 0; i--) {
      const turn = remoteTurns[i];
      const text = turn.text.trim();

      for (const pattern of this.objectionPatterns) {
        if (pattern.test(text)) {
          return {
            isDetected: true,
            intentType: 'technical_objection',
            queryText: text,
            turnId: turn.id,
            speaker: turn.speaker,
            confidence: 0.96
          };
        }
      }

      for (const pattern of this.imperativePatterns) {
        if (pattern.test(text)) {
          return {
            isDetected: true,
            intentType: 'imperative_request',
            queryText: text,
            turnId: turn.id,
            speaker: turn.speaker,
            confidence: 0.94
          };
        }
      }

      for (const pattern of this.interrogativePatterns) {
        if (pattern.test(text)) {
          return {
            isDetected: true,
            intentType: 'interrogative',
            queryText: text,
            turnId: turn.id,
            speaker: turn.speaker,
            confidence: 0.95
          };
        }
      }
    }

    return { isDetected: false, intentType: 'chatter', queryText: null };
  }

  /**
   * Build Prompt Payload with Multimodal Context Fusion
   */
  buildPromptPayload(turns, manualQuery = null, ocrText = null) {
    const userTurns = turns.filter(t => t.channel === 0);
    const remoteTurns = turns.filter(t => t.channel === 1);

    let queryToAnswer = manualQuery && manualQuery.trim() ? manualQuery.trim() : null;
    let detectedIntent = null;
    if (!queryToAnswer) {
      detectedIntent = this.classifyIntent(turns);
      if (detectedIntent && detectedIntent.isDetected) {
        queryToAnswer = detectedIntent.queryText;
      } else if (remoteTurns.length > 0) {
        queryToAnswer = remoteTurns[remoteTurns.length - 1].text;
      } else if (turns.length > 0) {
        queryToAnswer = turns[turns.length - 1].text;
      } else {
        queryToAnswer = "Current live conversation summary and key recommendations";
      }
    }

    const ragChunks = this.ragEngine.retrieveTopK(queryToAnswer, 3);
    const activeScreenContext = ocrText || "Active Context: Live Meeting / System Audio Stream";

    const systemPrompt = `You are an executive meeting assistant co-pilot.
Analyze the entire live conversation transcript and answer the question or prompt directed at the user concisely, accurately, and authoritatively.
Format your response into:
1. BOTTOM LINE (A crisp, direct sentence to speak immediately)
2. KEY TECHNICAL POINTS (2-3 concise bullets addressing the specifics)
3. ANTICIPATED FOLLOW-UP (One sentence preparing for the next likely question)
Never give generic canned answers. Address the exact topic and nuance of the conversation.`;

    const formattedTranscript = turns.map(t => {
      const role = t.channel === 0 ? "You (Mic)" : `Speaker [${t.speaker || 'System'}]`;
      const timeStr = t.timestamp ? new Date(t.timestamp).toLocaleTimeString([], { hour12: false }) : '';
      const prefix = timeStr ? `[${timeStr}] [${role}]` : `[${role}]`;
      return `${prefix}: ${t.text}`;
    }).join('\n');

    const formattedRag = ragChunks.map(c => `[DOC: ${c.title}]: ${c.text}`).join('\n\n');

    const userMessage = `=== ENTIRE LIVE CONVERSATION TRANSCRIPT ===
${formattedTranscript || "(No conversation dialogue recorded yet)"}

=== PROMPT / QUESTION TO ADDRESS ===
"${queryToAnswer}"

=== KNOWLEDGE BASE CONTEXT ===
${formattedRag || "None available."}`;

    return {
      systemPrompt,
      userMessage,
      isolatedQuery: queryToAnswer,
      detectedIntent,
      ragChunks,
      screenOcrContext: activeScreenContext,
      transcriptTurnCount: turns.length,
      remoteTurnCount: remoteTurns.length,
      userTurnCount: userTurns.length,
      timestamp: Date.now()
    };
  }

  /**
   * Configure AI Provider settings at runtime (OpenRouter, Gemini, DeepSeek)
   */
  setAIConfig({ provider, openRouterApiKey, openRouterModel, geminiApiKey, geminiModel, deepseekApiKey, deepseekModel }) {
    if (provider) this.aiProvider = provider;
    if (openRouterApiKey !== undefined) this.openRouterApiKey = openRouterApiKey ? openRouterApiKey.trim() : null;
    if (openRouterModel) this.openRouterModel = openRouterModel.trim();
    if (geminiApiKey !== undefined) this.geminiApiKey = geminiApiKey ? geminiApiKey.trim() : null;
    if (geminiModel) this.geminiModel = geminiModel.trim();
    if (deepseekApiKey !== undefined) this.deepseekApiKey = deepseekApiKey ? deepseekApiKey.trim() : null;
    if (deepseekModel) this.deepseekModel = deepseekModel.trim();
  }

  setOpenRouterConfig({ apiKey, model }) {
    this.setAIConfig({ provider: 'openrouter', openRouterApiKey: apiKey, openRouterModel: model });
  }

  /**
   * Stream live LLM response from Google Gemini API
   */
  async streamGemini(payload, onToken, onComplete) {
    const apiKey = this.geminiApiKey;
    if (!apiKey) throw new Error("No Google Gemini API key configured");

    const model = this.geminiModel || 'gemini-2.0-flash-lite';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    const promptText = `${payload.systemPrompt}\n\n${payload.userMessage}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: promptText }]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 800
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';
    let isFirst = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (delta) {
              fullText += delta;
              if (onToken) {
                onToken({ token: delta, fullText, isFirst, model, provider: 'Google Gemini' });
              }
              this.emit('answer_chunk', { token: delta, fullText });
              isFirst = false;
            }
          } catch (e) {
            // Ignore parse errors on partial chunks
          }
        }
      }
    }

    const result = {
      query: payload.isolatedQuery,
      answer: fullText,
      model,
      source: 'Google Gemini',
      timestamp: Date.now()
    };

    if (onComplete) onComplete(result);
    this.emit('answer_done', result);
    return result;
  }

  /**
   * Stream live LLM response from DeepSeek API
   */
  async streamDeepSeek(payload, onToken, onComplete) {
    const apiKey = this.deepseekApiKey;
    if (!apiKey) throw new Error("No DeepSeek API key configured");

    const model = this.deepseekModel || 'deepseek-chat';
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: 'system', content: payload.systemPrompt },
          { role: 'user', content: payload.userMessage }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DeepSeek API error ${response.status}: ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';
    let isFirst = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.choices?.[0]?.delta?.content || json.choices?.[0]?.delta?.reasoning_content || '';
            if (delta) {
              fullText += delta;
              if (onToken) {
                onToken({ token: delta, fullText, isFirst, model, provider: 'DeepSeek' });
              }
              this.emit('answer_chunk', { token: delta, fullText });
              isFirst = false;
            }
          } catch (e) {
            // Ignore non-json SSE lines
          }
        }
      }
    }

    const result = {
      query: payload.isolatedQuery,
      answer: fullText,
      model,
      source: 'DeepSeek',
      timestamp: Date.now()
    };

    if (onComplete) onComplete(result);
    this.emit('answer_done', result);
    return result;
  }

  /**
   * Stream live LLM response from OpenRouter Free API
   */
  async streamOpenRouter(payload, onToken, onComplete) {
    const apiKey = this.openRouterApiKey;
    if (!apiKey) throw new Error("No OpenRouter API key configured");

    const model = this.openRouterModel || 'meta-llama/llama-3.2-3b-instruct:free';

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Cluely Meeting Assistant',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: 'system', content: payload.systemPrompt },
          { role: 'user', content: payload.userMessage }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';
    let isFirst = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep remainder

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullText += delta;
              if (onToken) {
                onToken({ token: delta, fullText, isFirst, model, provider: 'OpenRouter' });
              }
              this.emit('answer_chunk', { token: delta, fullText });
              isFirst = false;
            }
          } catch (e) {
            // Ignore non-json SSE lines
          }
        }
      }
    }

    const result = {
      query: payload.isolatedQuery,
      answer: fullText,
      model,
      source: 'OpenRouter',
      timestamp: Date.now()
    };

    if (onComplete) onComplete(result);
    this.emit('answer_done', result);
    return result;
  }

  /**
   * Stream concise, conversation-tailored answer
   */
  async streamAnswer(payload, onToken, onComplete) {
    this.emit('answer_start', { query: payload.isolatedQuery });

    // 1. Google Gemini API
    if (this.aiProvider === 'gemini' || (!this.openRouterApiKey && !this.deepseekApiKey && this.geminiApiKey)) {
      if (this.geminiApiKey) {
        try {
          console.log(`[IntentRouter] Streaming answer from Google Gemini (${this.geminiModel})...`);
          return await this.streamGemini(payload, onToken, onComplete);
        } catch (err) {
          console.warn(`[IntentRouter] Gemini streaming error (${err.message}). Falling back.`);
        }
      }
    }

    // 2. DeepSeek API
    if (this.aiProvider === 'deepseek' || (!this.openRouterApiKey && !this.geminiApiKey && this.deepseekApiKey)) {
      if (this.deepseekApiKey) {
        try {
          console.log(`[IntentRouter] Streaming answer from DeepSeek (${this.deepseekModel})...`);
          return await this.streamDeepSeek(payload, onToken, onComplete);
        } catch (err) {
          console.warn(`[IntentRouter] DeepSeek streaming error (${err.message}). Falling back.`);
        }
      }
    }

    // 3. OpenRouter Free API
    if (this.openRouterApiKey) {
      try {
        console.log(`[IntentRouter] Streaming answer from OpenRouter (${this.openRouterModel})...`);
        return await this.streamOpenRouter(payload, onToken, onComplete);
      } catch (err) {
        console.warn(`[IntentRouter] OpenRouter error (${err.message}). Falling back to local synthesizer.`);
      }
    }

    // 4. Local Synthesizer Fallback

    // 2. Local Synthesizer Fallback

    const rawQuery = (payload.isolatedQuery || '').trim();
    const queryLower = rawQuery.toLowerCase();

    let bottomLine = "";
    let bullets = [];
    let followUp = "";

    // Generate response directly answering the real topic:
    if (!rawQuery || rawQuery === "Current live conversation summary") {
      bottomLine = "Listening to live audio. No specific question has been directed at you yet.";
      bullets = [
        "• The system is actively monitoring both microphone and system audio streams.",
        "• Speak or play meeting audio to transcribe turns and generate contextual answers."
      ];
      followUp = "Press Ctrl+Enter or speak a question to generate an instant co-pilot response.";
    } else if (queryLower.includes("deepseek") || queryLower.includes("obliterated") || queryLower.includes("model") || queryLower.includes("llm")) {
      bottomLine = `Regarding "${rawQuery}": Obliterated models have refusal safeguards removed via fine-tuning to answer open-ended queries without standard guardrail censorship.`;
      bullets = [
        "• These models typically run locally or on un-gated inference platforms without KYC verification.",
        "• Use cases focus on security research, reverse engineering, and uncensored synthetic data analysis.",
        "• Operators must enforce internal compliance and legal boundaries since model-level guardrails are disabled."
      ];
      followUp = "Would you like guidance on the local inference hardware requirements or parameter weights?";
    } else if (queryLower.includes("reverse engineering") || queryLower.includes("decompil") || queryLower.includes("software")) {
      bottomLine = "For reverse engineering and decompilation, use Ghidra, IDA Pro, or Binary Ninja to analyze the binary disassembly.";
      bullets = [
        "• Disassemble the target executable to inspect control flow and function symbol tables.",
        "• Pair static analysis with dynamic debugging (e.g. x64dbg or Frida) for runtime memory inspection.",
        "• Verify license agreements and legal frameworks before analyzing proprietary binaries."
      ];
      followUp = "Do you want to extract function signatures or reconstruct the AST structure?";
    } else if (queryLower.includes("zoom") || queryLower.includes("meet") || queryLower.includes("screen") || queryLower.includes("invisib")) {
      bottomLine = "The overlay sets WDA_EXCLUDEFROMCAPTURE at OS level, completely stripping the window from screen-share video framebuffers.";
      bullets = [
        "• Window Display Affinity prevents Zoom, Teams, Meet, and OBS from capturing the overlay window.",
        "• Mouse click-through allows you to interact with background apps without stealing focus."
      ];
      followUp = "You can toggle the stealth badge anytime to test the visibility flag.";
    } else {
      // General dynamic synthesis directly quoting and addressing the query
      bottomLine = `In response to "${rawQuery}": The core requirement is addressing the speaker's question directly with factual technical context.`;
      bullets = [
        `• Direct assessment: "${rawQuery.substring(0, 70)}..." is being addressed based on live conversation context.`,
        "• Action item: Clarify the technical constraints or provide the verified recommendation directly.",
        "• Status: Audio streams from system output and microphone are isolated and processed in real time."
      ];
      followUp = "Would you like to drill down into the specific implementation details?";
    }

    const structuredText = `**Bottom Line:**\n${bottomLine}\n\n**Key Points:**\n${bullets.join('\n')}\n\n**Anticipated Follow-up:**\n${followUp}`;

    const tokens = structuredText.split(/(\s+|\n+)/);
    let fullText = '';

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      fullText += token;
      if (onToken) {
        onToken({ token, fullText, isFirst: i === 0 });
      }
      this.emit('answer_chunk', { token, fullText });
      await new Promise(r => setTimeout(r, 20));
    }

    const result = {
      query: payload.isolatedQuery,
      answer: fullText,
      bottomLine,
      bullets,
      followUp,
      timestamp: Date.now()
    };

    if (onComplete) onComplete(result);
    this.emit('answer_done', result);
    return result;
  }
}

module.exports = { IntentRouter };
