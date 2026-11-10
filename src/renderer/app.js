/**
 * Real-Time Meeting Co-Pilot App Controller (Light Theme)
 * Pure real-time WASAPI speech-to-text, live VU meters, and intent routing.
 */

document.addEventListener('DOMContentLoaded', () => {
  const meterCh0 = document.getElementById('meter-ch0');
  const meterCh1 = document.getElementById('meter-ch1');
  const bleedGateIndicator = document.getElementById('bleed-gate-indicator');
  const turnsList = document.getElementById('turns-list');
  const feedEmptyState = document.getElementById('feed-empty-state');
  const aiSuggestionCard = document.getElementById('ai-suggestion-card');
  const aiAnswerContent = document.getElementById('ai-answer-content');
  const detectedQueryText = document.getElementById('detected-query-text');
  const aiLatencyBadge = document.getElementById('ai-latency-badge');
  const ragSourcesPreview = document.getElementById('rag-sources-preview');
  const statusBarText = document.getElementById('status-bar-text');

  // Modals
  const testMatrixModal = document.getElementById('test-matrix-modal');
  const ragModal = document.getElementById('rag-modal');

  let interimCards = { 0: null, 1: null };
  let turnCount = 0;

  // -------------------------------------------------------------
  // Real-Time VU Meters (Directly Driven by Windows WASAPI Loopback & Mic)
  // -------------------------------------------------------------
  window.cluelyApi.onAudioLevels(({ ch0Mic, ch1Sys, bleedSuppressed }) => {
    const ch0Pct = Math.min(100, Math.round((ch0Mic || 0) * 100));
    const ch1Pct = Math.min(100, Math.round((ch1Sys || 0) * 100));

    meterCh0.style.width = `${ch0Pct}%`;
    meterCh1.style.width = `${ch1Pct}%`;

    if (bleedSuppressed) {
      bleedGateIndicator.classList.add('active');
    } else {
      bleedGateIndicator.classList.remove('active');
    }
  });

  // -------------------------------------------------------------
  // Real-Time Transcription Turn Stream (From Native WASAPI & SpeechRecognition)
  // -------------------------------------------------------------
  function handleIncomingInterim(data) {
    hideEmptyState();
    let card = interimCards[data.channel];
    if (!card) {
      card = createTurnCard(data, true);
      interimCards[data.channel] = card;
      turnsList.appendChild(card);
    } else {
      const textElem = card.querySelector('.turn-text');
      if (textElem) textElem.textContent = data.text;
    }
    scrollToBottom();
  }

  function handleIncomingFinal(turn) {
    hideEmptyState();
    turnCount++;
    let card = interimCards[turn.channel];
    if (card) {
      card.classList.remove('interim');
      const textElem = card.querySelector('.turn-text');
      if (textElem) textElem.textContent = turn.text;

      const metaElem = card.querySelector('.turn-meta');
      if (metaElem) {
        metaElem.textContent = `${formatTime(turn.timestamp)} • ${Math.round((turn.confidence || 0.95) * 100)}% conf`;
      }
      interimCards[turn.channel] = null;
    } else {
      card = createTurnCard(turn, false);
      turnsList.appendChild(card);
    }

    statusBarText.textContent = `WASAPI Active • ${turnCount} turns recorded • Last speaker: ${turn.speaker}`;
    scrollToBottom();
  }

  window.cluelyApi.onTurnInterim((data) => {
    handleIncomingInterim(data);
  });

  window.cluelyApi.onTurnFinal((turn) => {
    handleIncomingFinal(turn);
  });

  function hideEmptyState() {
    if (feedEmptyState && feedEmptyState.parentElement) {
      feedEmptyState.style.display = 'none';
    }
  }

  function showEmptyState() {
    if (feedEmptyState) {
      feedEmptyState.style.display = 'flex';
    }
  }

  function createTurnCard(turn, isInterim) {
    const card = document.createElement('div');
    card.className = `turn-card ${isInterim ? 'interim' : ''}`;

    let channelClass = 'ch1-turn';
    let speakerBadgeClass = 'remote-1';
    let speakerLabel = turn.speaker || 'Speaker';

    if (turn.channel === 0) {
      channelClass = 'ch0-turn';
      speakerBadgeClass = 'user';
      speakerLabel = 'You (Mic)';
    }

    card.classList.add(channelClass);

    card.innerHTML = `
      <div class="turn-header">
        <span class="turn-speaker-badge ${speakerBadgeClass}">
          ${turn.channel === 0 ? '🎙️' : '🔊'} ${speakerLabel}
        </span>
        <span class="turn-meta">
          ${formatTime(turn.timestamp)} ${isInterim ? '• live' : `• ${Math.round((turn.confidence || 0.95) * 100)}% conf`}
        </span>
      </div>
      <div class="turn-text">${escapeHtml(turn.text)}</div>
    `;

    return card;
  }

  function scrollToBottom() {
    turnsList.scrollTop = turnsList.scrollHeight;
  }

  function formatTime(ts) {
    const d = new Date(ts || Date.now());
    return d.toTimeString().substring(0, 8);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // -------------------------------------------------------------
  // AI Co-Pilot Recommendation Card
  // -------------------------------------------------------------
  let answerStartTime = 0;

  window.cluelyApi.onAnswerStart((data) => {
    answerStartTime = Date.now();
    aiSuggestionCard.style.display = 'flex';
    detectedQueryText.textContent = data.query || 'Synthesizing live dialogue...';
    aiAnswerContent.innerHTML = '<span style="color: var(--accent-indigo); font-family: var(--font-mono);">Generating recommendation...</span>';
    aiLatencyBadge.textContent = '⚡ Ingesting...';

    if (data.ragChunks && data.ragChunks.length > 0) {
      ragSourcesPreview.style.display = 'flex';
      ragSourcesPreview.innerHTML = '';
      data.ragChunks.forEach(chunk => {
        const pill = document.createElement('div');
        pill.className = 'rag-pill';
        pill.innerHTML = `
          <span class="rag-pill-badge">${escapeHtml(chunk.category || 'Spec')}</span>
          <span><b>${escapeHtml(chunk.title)}</b>: ${escapeHtml(chunk.text.substring(0, 80))}...</span>
        `;
        ragSourcesPreview.appendChild(pill);
      });
    } else {
      ragSourcesPreview.style.display = 'none';
    }
  });

  window.cluelyApi.onAnswerChunk((data) => {
    if (data.isFirst) {
      const elapsed = Date.now() - answerStartTime;
      aiLatencyBadge.textContent = `⚡ ${elapsed}ms first-token`;
    }

    let formatted = escapeHtml(data.fullText)
      .replace(/\*\*Bottom Line:\*\*/g, '<strong style="color: #0f172a; display: block; margin-bottom: 2px;">⚡ Bottom Line:</strong>')
      .replace(/\*\*Key Points:\*\*/g, '<strong style="color: #0f172a; display: block; margin-top: 10px; margin-bottom: 4px;">📋 Key Technical Points:</strong>')
      .replace(/\*\*Anticipated Follow-up:\*\*/g, '<strong style="color: #0f172a; display: block; margin-top: 10px; margin-bottom: 4px;">🎯 Anticipated Follow-up:</strong>');

    aiAnswerContent.innerHTML = formatted;
  });

  window.cluelyApi.onAnswerDone((result) => {
    const totalElapsed = Date.now() - answerStartTime;
    aiLatencyBadge.textContent = `⚡ ${totalElapsed}ms`;
  });

  // -------------------------------------------------------------
  // Controls & Actions
  // -------------------------------------------------------------
  // AI Co-Pilot Trigger & Custom Prompt
  const copilotPromptInput = document.getElementById('copilot-custom-prompt');

  function triggerAICopilot() {
    const promptText = copilotPromptInput ? copilotPromptInput.value.trim() : null;
    window.cluelyApi.triggerAIAssist(promptText || null);
  }

  const btnTriggerAI = document.getElementById('btn-trigger-ai');
  if (btnTriggerAI) {
    btnTriggerAI.addEventListener('click', triggerAICopilot);
  }

  if (copilotPromptInput) {
    copilotPromptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerAICopilot();
      }
    });
  }

  document.getElementById('btn-dismiss-answer').addEventListener('click', () => {
    aiSuggestionCard.style.display = 'none';
  });

  document.getElementById('btn-copy-answer').addEventListener('click', () => {
    const text = aiAnswerContent.innerText;
    navigator.clipboard.writeText(text);
    const copyBtn = document.getElementById('btn-copy-answer');
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
  });

  document.getElementById('btn-clear-transcript').addEventListener('click', () => {
    turnsList.innerHTML = '';
    interimCards = { 0: null, 1: null };
    turnCount = 0;
    showEmptyState();
    window.cluelyApi.clearTranscript();
    statusBarText.textContent = 'Listening for real-time audio • 0 turns recorded';
  });

  // Stealth Exclusion Protection Toggle
  const protectionBadge = document.getElementById('protection-badge');
  let isStealthExcluded = false;

  protectionBadge.addEventListener('click', () => {
    isStealthExcluded = !isStealthExcluded;
    window.cluelyApi.setContentProtection(isStealthExcluded);
    if (isStealthExcluded) {
      protectionBadge.className = 'protection-badge active';
      protectionBadge.innerHTML = '<span class="shield-icon">🛡️</span><span class="badge-text">Stealth: Excluded</span>';
      protectionBadge.title = 'WDA_EXCLUDEFROMCAPTURE: Invisible to Zoom, Teams, Meet, and OBS screen share';
    } else {
      protectionBadge.className = 'protection-badge';
      protectionBadge.innerHTML = '<span class="shield-icon">👁️</span><span class="badge-text">Stealth: Visible</span>';
      protectionBadge.title = 'Window is visible to all screen shares and captures';
    }
  });

  // Modals
  document.getElementById('btn-toggle-matrix').addEventListener('click', () => {
    testMatrixModal.style.display = 'flex';
  });

  document.getElementById('btn-close-matrix').addEventListener('click', () => {
    testMatrixModal.style.display = 'none';
  });

  document.getElementById('btn-docs').addEventListener('click', async () => {
    ragModal.style.display = 'flex';
    loadRagDocs();
  });

  document.getElementById('btn-close-rag').addEventListener('click', () => {
    ragModal.style.display = 'none';
  });

  // RAG Docs Loader
  async function loadRagDocs() {
    const docs = await window.cluelyApi.getDocuments();
    const container = document.getElementById('rag-docs-list');
    container.innerHTML = '';
    docs.forEach(doc => {
      const card = document.createElement('div');
      card.className = 'rag-doc-card';
      card.innerHTML = `
        <div class="rag-doc-title">
          <span>${escapeHtml(doc.title)}</span>
          <span class="rag-pill-badge">${escapeHtml(doc.category)}</span>
        </div>
        <div class="rag-doc-body">${escapeHtml(doc.content)}</div>
      `;
      container.appendChild(card);
    });
  }

  document.getElementById('btn-add-doc').addEventListener('click', async () => {
    const titleInput = document.getElementById('new-doc-title');
    const contentInput = document.getElementById('new-doc-content');
    if (!titleInput.value.trim() || !contentInput.value.trim()) return;

    await window.cluelyApi.addDocument(titleInput.value.trim(), contentInput.value.trim(), 'Custom');
    titleInput.value = '';
    contentInput.value = '';
    loadRagDocs();
  });

  // Settings Modal (AI Provider Configuration: OpenRouter, Gemini, DeepSeek)
  const settingsModal = document.getElementById('settings-modal');
  const openRouterKeyInput = document.getElementById('openrouter-api-key');
  const openRouterModelSelect = document.getElementById('openrouter-model-select');
  const geminiKeyInput = document.getElementById('gemini-api-key');
  const geminiModelSelect = document.getElementById('gemini-model-select');
  const geminiCustomModelInput = document.getElementById('gemini-custom-model');
  const deepseekKeyInput = document.getElementById('deepseek-api-key');
  const deepseekModelSelect = document.getElementById('deepseek-model-select');
  const settingsStatus = document.getElementById('settings-status');

  if (geminiModelSelect && geminiCustomModelInput) {
    geminiModelSelect.addEventListener('change', () => {
      geminiCustomModelInput.style.display = geminiModelSelect.value === 'custom' ? 'block' : 'none';
    });
  }

  let activeProvider = 'openrouter';

  const providerTabs = {
    openrouter: document.getElementById('tab-openrouter'),
    gemini: document.getElementById('tab-gemini'),
    deepseek: document.getElementById('tab-deepseek')
  };

  const providerPanels = {
    openrouter: document.getElementById('panel-openrouter'),
    gemini: document.getElementById('panel-gemini'),
    deepseek: document.getElementById('panel-deepseek')
  };

  function switchProviderTab(provider) {
    activeProvider = provider;
    Object.keys(providerTabs).forEach(p => {
      if (providerTabs[p]) {
        providerTabs[p].className = p === provider ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-secondary';
      }
      if (providerPanels[p]) {
        providerPanels[p].style.display = p === provider ? 'block' : 'none';
      }
    });
  }

  if (providerTabs.openrouter) {
    providerTabs.openrouter.addEventListener('click', () => switchProviderTab('openrouter'));
  }
  if (providerTabs.gemini) {
    providerTabs.gemini.addEventListener('click', () => switchProviderTab('gemini'));
  }
  if (providerTabs.deepseek) {
    providerTabs.deepseek.addEventListener('click', () => switchProviderTab('deepseek'));
  }

  document.getElementById('btn-settings').addEventListener('click', async () => {
    settingsModal.style.display = 'flex';
    if (window.cluelyApi.getConfig) {
      try {
        const config = await window.cluelyApi.getConfig();
        if (config.provider) {
          switchProviderTab(config.provider);
        }
        if (config.hasOpenRouterKey && !openRouterKeyInput.value) {
          openRouterKeyInput.placeholder = '•••••••••••••••••••••••• (Configured)';
        }
        if (config.openRouterModel) {
          openRouterModelSelect.value = config.openRouterModel;
        }
        if (config.hasGeminiKey && !geminiKeyInput.value) {
          geminiKeyInput.placeholder = '•••••••••••••••••••••••• (Configured)';
        }
        if (config.geminiModel) {
          const knownOptions = Array.from(geminiModelSelect.options).map(o => o.value);
          if (knownOptions.includes(config.geminiModel)) {
            geminiModelSelect.value = config.geminiModel;
            geminiCustomModelInput.style.display = 'none';
          } else {
            geminiModelSelect.value = 'custom';
            geminiCustomModelInput.value = config.geminiModel;
            geminiCustomModelInput.style.display = 'block';
          }
        }
        if (config.hasDeepSeekKey && !deepseekKeyInput.value) {
          deepseekKeyInput.placeholder = '•••••••••••••••••••••••• (Configured)';
        }
        if (config.deepseekModel) {
          deepseekModelSelect.value = config.deepseekModel;
        }
      } catch (err) {
        console.error('Failed to load config:', err);
      }
    }
  });

  document.getElementById('btn-close-settings').addEventListener('click', () => {
    settingsModal.style.display = 'none';
    settingsStatus.style.display = 'none';
  });

  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const configPayload = {
      provider: activeProvider
    };

    if (openRouterKeyInput.value.trim()) configPayload.openRouterApiKey = openRouterKeyInput.value.trim();
    if (openRouterModelSelect.value) configPayload.openRouterModel = openRouterModelSelect.value;
    if (geminiKeyInput.value.trim()) configPayload.geminiApiKey = geminiKeyInput.value.trim();
    
    let selectedGeminiModel = geminiModelSelect.value;
    if (selectedGeminiModel === 'custom' && geminiCustomModelInput.value.trim()) {
      selectedGeminiModel = geminiCustomModelInput.value.trim();
    }
    if (selectedGeminiModel) configPayload.geminiModel = selectedGeminiModel;

    if (deepseekKeyInput.value.trim()) configPayload.deepseekApiKey = deepseekKeyInput.value.trim();
    if (deepseekModelSelect.value) configPayload.deepseekModel = deepseekModelSelect.value;

    try {
      if (window.cluelyApi.setConfig) {
        await window.cluelyApi.setConfig(configPayload);
      }
      settingsStatus.style.display = 'block';
      settingsStatus.style.color = '#10b981';
      settingsStatus.textContent = `✓ Settings saved! Active Provider: ${activeProvider.toUpperCase()}`;
      setTimeout(() => {
        settingsModal.style.display = 'none';
        settingsStatus.style.display = 'none';
      }, 1500);
    } catch (err) {
      settingsStatus.style.display = 'block';
      settingsStatus.style.color = '#ef4444';
      settingsStatus.textContent = `Failed to save: ${err.message}`;
    }
  });
});
