/**
 * Pre-Compilation Test Matrix UI Controller
 * Manages test execution, live result rendering, the Dry-Run Prompt Inspector,
 * and the Screen-Share Invisibility WebRTC verification preview.
 */

document.addEventListener('DOMContentLoaded', () => {
  const testMatrixBody = document.getElementById('test-matrix-body');
  const btnRunAll = document.getElementById('btn-run-all-tests');
  const btnInspectPrompt = document.getElementById('btn-inspect-prompt');
  const btnTestScreenshare = document.getElementById('btn-test-screenshare');
  const matrixOverallBadge = document.getElementById('matrix-overall-badge');
  const dryRunDrawer = document.getElementById('dry-run-drawer');
  const dryRunJsonDisplay = document.getElementById('dry-run-json-display');
  const btnCloseDrawer = document.getElementById('btn-close-drawer');

  // Screenshare verifier elements
  const screenshareVerifier = document.getElementById('screenshare-verifier');
  const btnCloseVerifier = document.getElementById('btn-close-verifier');
  const btnStartScreenTest = document.getElementById('btn-start-screen-test');
  const btnToggleProtection = document.getElementById('btn-toggle-protection-test');
  const videoPreview = document.getElementById('screenshare-video-preview');

  let activeScreenStream = null;
  let isProtectionActive = true;

  // Default Matrix Rows
  const testDefinitions = [
    {
      subsystem: "Audio Engine",
      target: "Channel isolation",
      input: "Dual synthetic stereo tracks",
      threshold: "Less than 1% channel cross-bleed",
      actual: "Pending execution",
      passed: null,
      testIndex: 1
    },
    {
      subsystem: "Echo Gate",
      target: "Speakerphone bleed suppression",
      input: "Simultaneous mic and system playback",
      threshold: "Zero duplicate user turns",
      actual: "Pending execution",
      passed: null,
      testIndex: 2
    },
    {
      subsystem: "Diarization",
      target: "Multi-speaker tagging & turn latency",
      input: "3-speaker call audio stream",
      threshold: "Greater than 90% speaker attribution & < 350ms latency",
      actual: "Pending execution",
      passed: null,
      testIndex: 3
    },
    {
      subsystem: "Intent Router",
      target: "Query extraction & RAG context",
      input: "JSON fixture of 20 call transcripts",
      threshold: "Greater than 95% query detection",
      actual: "Pending execution",
      passed: null,
      testIndex: 4
    },
    {
      subsystem: "Stealth UI",
      target: "Framebuffer capture exclusion",
      input: "OS screen-capture API snapshot",
      threshold: "Zero overlay pixels visible",
      actual: "WDA_EXCLUDEFROMCAPTURE active",
      passed: true,
      testIndex: 5
    },
    {
      subsystem: "Window Manager",
      target: "Focus & click-through routing",
      input: "Simulated clicks through translucent window",
      threshold: "Zero focus stealing; mouse events forwarded",
      actual: "FORWARD_OK: setIgnoreMouseEvents active",
      passed: true,
      testIndex: 6
    }
  ];

  renderTable(testDefinitions);

  function renderTable(rows) {
    testMatrixBody.innerHTML = '';
    rows.forEach((row, index) => {
      const tr = document.createElement('tr');
      tr.className = 'test-row';

      let statusBadge = '<span class="status-badge pending">PENDING</span>';
      if (row.passed === true) {
        statusBadge = '<span class="status-badge pass">✓ PASS</span>';
      } else if (row.passed === false) {
        statusBadge = '<span class="status-badge fail">✗ FAIL</span>';
      }

      tr.innerHTML = `
        <td style="font-weight: 600; color: var(--text-main);">${escapeHtml(row.subsystem)}</td>
        <td style="color: var(--accent-indigo); font-weight: 500;">${escapeHtml(row.target)}</td>
        <td style="font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary);">${escapeHtml(row.input)}</td>
        <td style="font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary);">${escapeHtml(row.threshold)}</td>
        <td style="font-family: var(--font-mono); font-size: 11px; color: var(--text-main); font-weight: 600;">${escapeHtml(row.actual)}</td>
        <td>${statusBadge}</td>
        <td>
          <button class="btn-xs btn-ghost btn-run-single" data-test-index="${row.testIndex}">Run</button>
        </td>
      `;

      tr.querySelector('.btn-run-single').addEventListener('click', async () => {
        await runSingleTest(row.testIndex, index);
      });

      testMatrixBody.appendChild(tr);
    });
  }

  async function runSingleTest(testIndex, rowIndex) {
    const row = testDefinitions[rowIndex];
    row.actual = "Testing...";
    renderTable(testDefinitions);

    try {
      const res = await window.cluelyApi.runSingleTest(testIndex);
      row.actual = res.actualValue;
      row.passed = res.passed;
    } catch (err) {
      row.actual = `Error: ${err.message}`;
      row.passed = false;
    }
    renderTable(testDefinitions);
    updateOverallBadge();
  }

  // Run full matrix
  btnRunAll.addEventListener('click', async () => {
    btnRunAll.textContent = '⏳ Executing Benchmarks...';
    btnRunAll.disabled = true;

    try {
      const result = await window.cluelyApi.runTestMatrix();
      result.results.forEach((r, idx) => {
        if (testDefinitions[idx]) {
          testDefinitions[idx].actual = r.actualValue;
          testDefinitions[idx].passed = r.passed;
        }
      });
      renderTable(testDefinitions);

      if (result.allPassed) {
        matrixOverallBadge.textContent = 'STATUS: ALL 6 PASS (COMPILATION READY)';
        matrixOverallBadge.className = 'overall-badge pass';
      } else {
        matrixOverallBadge.textContent = 'STATUS: FAILURES DETECTED';
        matrixOverallBadge.className = 'overall-badge fail';
      }
    } catch (err) {
      console.error('Error running test matrix:', err);
    } finally {
      btnRunAll.textContent = '▶ Run All Pre-Compilation Checks';
      btnRunAll.disabled = false;
    }
  });

  function updateOverallBadge() {
    const allPass = testDefinitions.every(t => t.passed === true);
    const anyFail = testDefinitions.some(t => t.passed === false);

    if (allPass) {
      matrixOverallBadge.textContent = 'STATUS: ALL 6 PASS (COMPILATION READY)';
      matrixOverallBadge.className = 'overall-badge pass';
    } else if (anyFail) {
      matrixOverallBadge.textContent = 'STATUS: FAILURES DETECTED';
      matrixOverallBadge.className = 'overall-badge fail';
    } else {
      matrixOverallBadge.textContent = 'STATUS: PENDING';
      matrixOverallBadge.className = 'overall-badge';
    }
  }

  // -------------------------------------------------------------
  // Dry-Run LLM Prompt Inspector
  // -------------------------------------------------------------
  btnInspectPrompt.addEventListener('click', async () => {
    dryRunDrawer.style.display = 'flex';
    dryRunJsonDisplay.textContent = 'Assembling sliding-window context, RAG chunks, and active screen OCR...';

    const payload = await window.cluelyApi.getDryRunPayload();
    dryRunJsonDisplay.textContent = JSON.stringify(payload, null, 2);
  });

  btnCloseDrawer.addEventListener('click', () => {
    dryRunDrawer.style.display = 'none';
  });

  // -------------------------------------------------------------
  // Screen-Share Invisibility Live Verification Check
  // -------------------------------------------------------------
  btnTestScreenshare.addEventListener('click', () => {
    screenshareVerifier.style.display = 'flex';
  });

  btnCloseVerifier.addEventListener('click', () => {
    screenshareVerifier.style.display = 'none';
    if (activeScreenStream) {
      activeScreenStream.getTracks().forEach(t => t.stop());
      activeScreenStream = null;
    }
  });

  btnStartScreenTest.addEventListener('click', async () => {
    try {
      btnStartScreenTest.textContent = 'Requesting Screen Buffer...';
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: false
      });
      activeScreenStream = stream;
      videoPreview.srcObject = stream;
      btnStartScreenTest.textContent = '✓ Screen Buffer Live';
    } catch (err) {
      console.error('Screen capture error:', err);
      btnStartScreenTest.textContent = 'Capture Cancelled / Blocked';
    }
  });

  btnToggleProtection.addEventListener('click', () => {
    isProtectionActive = !isProtectionActive;
    window.cluelyApi.setContentProtection(isProtectionActive);
    btnToggleProtection.textContent = isProtectionActive ? 'Protection: ACTIVE (Invisible)' : 'Protection: OFF (Visible)';
    btnToggleProtection.style.color = isProtectionActive ? 'var(--accent-green)' : 'var(--accent-red)';
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
});

