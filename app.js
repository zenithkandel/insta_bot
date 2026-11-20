/**
 * InstaDM — Ultra-Minimalist Campaign Manager
 * Clean, distraction-free progressive sections.
 */

(() => {
  'use strict';

  // ================= STORAGE KEYS =================
  const STORAGE_KEYS = {
    SESSION_ID: 'instadm_session_id',
    SENDER_INFO: 'instadm_sender_info',
    RECIPIENTS: 'instadm_recipients',
    SELECTED_RECIPIENTS: 'instadm_selected_recipients',
    VERIFIED_RECIPIENTS: 'instadm_verified_recipients',
    MESSAGE: 'instadm_message',
    PARALLEL_WORKERS: 'instadm_parallel_workers',
    LOGS: 'instadm_logs',
  };

  // ================= STATE =================
  const state = {
    sessionId: '',
    senderInfo: null,
    recipients: [], // Array of username strings
    selectedRecipients: new Set(),
    verifiedRecipients: {}, // username -> { exists, userId, fullName, profilePic }
    messageText: '',
    parallelWorkers: 3,
    logs: [],

    // Campaign runtime
    campaignStatus: 'idle', // 'idle' | 'running' | 'paused' | 'stopped' | 'completed'
    currentIndex: 0,
    activeQueue: [],
    sentCount: 0,
    failedCount: 0,
    rowStatuses: {}, // username -> { status, latency, details }

    // Search query
    searchQuery: '',
  };

  // ================= DOM ELEMENT CACHE =================
  const $ = id => document.getElementById(id);
  const dom = {};

  function cacheDom() {
    [
      // Header
      'browserStatusContainer', 'browserStatusDot', 'browserStatusLabel',
      'btnToggleAccountDrawer', 'headerAccountLabel',

      // Section 1: Account
      'btnEditSession', 'accountAvatar', 'accountHandle', 'accountStatusPill', 'accountUserId',
      'sessionDrawer', 'sessionIdInput', 'btnToggleSessionVisibility', 'btnSaveSession', 'sessionFeedback',

      // Section 2: Recipients
      'recipientsCountPill', 'btnOpenAddModal', 'btnVerifyUnchecked', 'btnVerifyLabel',
      'recipientSearchInput', 'btnSelectAll', 'btnDeselectAll', 'btnDeleteSelected',
      'pipeInvalid', 'btnRemoveInvalid', 'invalidCountBadge',
      'recipientsList', 'emptyRecipientsState', 'btnEmptyAdd',

      // Section 3: Message
      'btnInsertUsername', 'messageTextarea', 'charCount', 'previewSnippet',

      // Section 4: Dispatch
      'campaignStatusPill', 'workerExplainText', 'workerChipsContainer', 'btnWorkersMax',
      'btnStartCampaign', 'startBtnLabel', 'runningActionsRow',
      'btnPauseCampaign', 'btnResumeCampaign', 'btnStopCampaign',
      'currentWorkerActivity', 'statSent', 'statFailed', 'statRemaining', 'progressFill',

      // Section 5: Logs
      'btnClearLogs', 'btnExportLogs', 'logsFeed',

      // Add Modal
      'addRecipientsModal', 'btnCloseAddModal', 'btnCancelAddModal', 'importTextarea',
      'importFileInput', 'importParsedCount', 'btnConfirmAddRecipients',
    ].forEach(id => {
      dom[id] = $(id);
    });
  }

  // ================= PERSISTENCE =================
  function loadPersistedState() {
    try {
      state.sessionId = localStorage.getItem(STORAGE_KEYS.SESSION_ID) || '';
      
      const savedSender = localStorage.getItem(STORAGE_KEYS.SENDER_INFO);
      if (savedSender) state.senderInfo = JSON.parse(savedSender);

      const savedRecipients = localStorage.getItem(STORAGE_KEYS.RECIPIENTS);
      if (savedRecipients) state.recipients = JSON.parse(savedRecipients);

      const savedSelected = localStorage.getItem(STORAGE_KEYS.SELECTED_RECIPIENTS);
      if (savedSelected) {
        state.selectedRecipients = new Set(JSON.parse(savedSelected));
      } else {
        state.selectedRecipients = new Set(state.recipients);
      }

      const savedVerified = localStorage.getItem(STORAGE_KEYS.VERIFIED_RECIPIENTS);
      if (savedVerified) state.verifiedRecipients = JSON.parse(savedVerified);

      state.messageText = localStorage.getItem(STORAGE_KEYS.MESSAGE) || 'Hi {{username}}! Great connecting with you.';
      state.parallelWorkers = Math.max(1, Number(localStorage.getItem(STORAGE_KEYS.PARALLEL_WORKERS)) || 3);

      const savedLogs = localStorage.getItem(STORAGE_KEYS.LOGS);
      if (savedLogs) state.logs = JSON.parse(savedLogs);
    } catch (err) {
      console.warn('Error loading state:', err);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEYS.SESSION_ID, state.sessionId);
      if (state.senderInfo) localStorage.setItem(STORAGE_KEYS.SENDER_INFO, JSON.stringify(state.senderInfo));
      localStorage.setItem(STORAGE_KEYS.RECIPIENTS, JSON.stringify(state.recipients));
      localStorage.setItem(STORAGE_KEYS.SELECTED_RECIPIENTS, JSON.stringify(Array.from(state.selectedRecipients)));
      localStorage.setItem(STORAGE_KEYS.VERIFIED_RECIPIENTS, JSON.stringify(state.verifiedRecipients));
      localStorage.setItem(STORAGE_KEYS.MESSAGE, state.messageText);
      localStorage.setItem(STORAGE_KEYS.PARALLEL_WORKERS, String(state.parallelWorkers));
      localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(state.logs.slice(0, 150)));
    } catch (err) {
      console.warn('Error saving state:', err);
    }
  }

  // ================= BROWSER STATUS POLLING =================
  async function pollBrowserStatus() {
    try {
      const res = await fetch('/api/status', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        updateBrowserUI(data.browser || (data.daemon ? 'warm' : 'starting'), data.driver_active);
      } else {
        updateBrowserUI('offline', false);
      }
    } catch {
      updateBrowserUI('offline', false);
    }
  }

  function updateBrowserUI(status, driverActive) {
    const dot = dom.browserStatusDot;
    const label = dom.browserStatusLabel;
    if (!dot || !label) return;

    dot.className = 'status-dot';

    if (status === 'warm' || (status === 'ready' && driverActive)) {
      dot.classList.add('dot-warm');
      label.textContent = 'Chrome Warm (Ready)';
    } else if (status === 'starting') {
      dot.classList.add('dot-starting');
      label.textContent = 'Launching Chrome...';
    } else {
      dot.classList.add('dot-offline');
      label.textContent = 'Browser Standby';
    }
  }

  // ================= SECTION 1: ACCOUNT =================
  function updateAccountUI() {
    const s = state.senderInfo;
    const hasSession = Boolean(state.sessionId && state.sessionId.trim());

    if (hasSession && s && s.authenticated) {
      dom.headerAccountLabel.textContent = `@${s.username}`;
      dom.accountHandle.textContent = `@${s.username}`;
      dom.accountStatusPill.className = 'pill pill-success';
      dom.accountStatusPill.textContent = 'Connected';
      dom.accountUserId.textContent = `User ID: ${s.id || s.ds_user_id || 'Verified'}`;
      dom.btnEditSession.textContent = 'Change';

      if (s.profilePic) {
        dom.accountAvatar.innerHTML = `<img src="${escapeHtml(s.profilePic)}" alt="" />`;
      } else {
        const init = (s.username || 'U').charAt(0).toUpperCase();
        dom.accountAvatar.innerHTML = `<span class="font-mono text-xs">${init}</span>`;
      }
    } else if (hasSession) {
      dom.headerAccountLabel.textContent = 'Verify Cookie';
      dom.accountHandle.textContent = 'Cookie Saved';
      dom.accountStatusPill.className = 'pill pill-warning';
      dom.accountStatusPill.textContent = 'Unverified';
      dom.accountUserId.textContent = 'Click Change to test connection';
      dom.btnEditSession.textContent = 'Verify';
      dom.accountAvatar.innerHTML = `<span class="iconify" data-icon="ph:cookie-bold" data-width="14"></span>`;
    } else {
      dom.headerAccountLabel.textContent = 'Connect Session';
      dom.accountHandle.textContent = 'No session configured';
      dom.accountStatusPill.className = 'pill pill-neutral';
      dom.accountStatusPill.textContent = 'Disconnected';
      dom.accountUserId.textContent = 'Add your browser session cookie to begin';
      dom.btnEditSession.textContent = 'Connect';
      dom.accountAvatar.innerHTML = `<span class="iconify" data-icon="ph:user-bold" data-width="14"></span>`;
    }

    if (dom.sessionIdInput && !dom.sessionIdInput.value) {
      dom.sessionIdInput.value = state.sessionId;
    }
  }

  async function verifySession() {
    const raw = dom.sessionIdInput.value.trim();
    if (!raw) {
      showFeedback('error', 'Please paste your sessionid cookie first.');
      return;
    }

    dom.btnSaveSession.disabled = true;
    dom.btnSaveSession.innerHTML = `<span class="iconify" data-icon="ph:spinner" data-width="12"></span> Verifying...`;
    showFeedback('neutral', 'Connecting to Instagram...');

    try {
      const res = await fetch('/api/verify-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionid: raw }),
      });
      const data = await res.json();

      if (data.ok && data.sender) {
        state.sessionId = raw;
        state.senderInfo = { ...data.sender, authenticated: true };
        saveState();
        updateAccountUI();
        showFeedback('success', `Connected as @${data.sender.username}`);
        addLog('system', `Session verified. Connected as @${data.sender.username}`);
        setTimeout(() => {
          dom.sessionDrawer.classList.add('hidden');
          dom.sessionFeedback.classList.add('hidden');
        }, 1200);
      } else {
        const err = data.reason || data.error || 'Invalid session cookie.';
        showFeedback('error', `Verification failed: ${err}`);
        addLog('system', `Session verification failed: ${err}`);
      }
    } catch (err) {
      showFeedback('error', `Network error: ${err.message}`);
      addLog('system', `Network error: ${err.message}`);
    } finally {
      dom.btnSaveSession.disabled = false;
      dom.btnSaveSession.textContent = 'Save & Verify';
    }
  }

  function showFeedback(type, text) {
    dom.sessionFeedback.className = `feedback-msg ${type}`;
    dom.sessionFeedback.textContent = text;
    dom.sessionFeedback.classList.remove('hidden');
  }

  // ================= SECTION 2: RECIPIENTS =================
  function addRecipients(handles) {
    const cleanList = handles
      .map(h => h.trim().replace(/^@/, '').toLowerCase())
      .filter(h => h.length > 0 && /^[a-zA-Z0-9._]+$/.test(h));

    if (cleanList.length === 0) return 0;

    const existing = new Set(state.recipients);
    let count = 0;

    cleanList.forEach(h => {
      if (!existing.has(h)) {
        existing.add(h);
        state.recipients.push(h);
        state.selectedRecipients.add(h);
        count++;
      }
    });

    if (count > 0) {
      saveState();
      renderRecipients();
      updateWorkerChips();
      updatePreview();
      addLog('system', `Added ${count} new recipient(s). Total: ${state.recipients.length}`);
    }
    return count;
  }

  function deleteSelected() {
    const toDelete = new Set(state.selectedRecipients);
    if (toDelete.size === 0) return;

    state.recipients = state.recipients.filter(h => !toDelete.has(h));
    state.selectedRecipients.clear();
    saveState();
    renderRecipients();
    updateWorkerChips();
    updatePreview();
    addLog('system', `Removed ${toDelete.size} recipient(s).`);
  }

  function removeInvalid() {
    const before = state.recipients.length;
    state.recipients = state.recipients.filter(h => {
      const v = state.verifiedRecipients[h];
      return !(v && v.exists === false);
    });

    const validSet = new Set(state.recipients);
    state.selectedRecipients = new Set(Array.from(state.selectedRecipients).filter(h => validSet.has(h)));

    const removed = before - state.recipients.length;
    saveState();
    renderRecipients();
    updateWorkerChips();
    addLog('system', `Removed ${removed} invalid handles.`);
  }

  function deleteSingle(handle) {
    state.recipients = state.recipients.filter(h => h !== handle);
    state.selectedRecipients.delete(handle);
    saveState();
    renderRecipients();
    updateWorkerChips();
    updatePreview();
  }

  function toggleSelect(handle, isSelected) {
    if (isSelected) state.selectedRecipients.add(handle);
    else state.selectedRecipients.delete(handle);
    saveState();
    updateCounts();
    updateWorkerChips();
    updatePreview();

    const row = document.getElementById(`row-${handle}`);
    if (row) row.classList.toggle('selected', isSelected);
  }

  function selectAll() {
    getFilteredRecipients().forEach(h => state.selectedRecipients.add(h));
    saveState();
    renderRecipients();
    updateWorkerChips();
    updatePreview();
  }

  function deselectAll() {
    state.selectedRecipients.clear();
    saveState();
    renderRecipients();
    updateWorkerChips();
    updatePreview();
  }

  function getFilteredRecipients() {
    const q = state.searchQuery.toLowerCase().trim();
    if (!q) return state.recipients;

    return state.recipients.filter(h => {
      const v = state.verifiedRecipients[h];
      const matchHandle = h.includes(q);
      const matchName = v?.fullName?.toLowerCase().includes(q);
      const matchId = String(v?.userId || '').includes(q);
      return matchHandle || matchName || matchId;
    });
  }

  function renderRecipients() {
    const list = getFilteredRecipients();
    updateCounts();

    if (state.recipients.length === 0) {
      dom.emptyRecipientsState.classList.remove('hidden');
      dom.recipientsList.innerHTML = '';
      return;
    }

    dom.emptyRecipientsState.classList.add('hidden');

    const html = list.map(handle => {
      const isSelected = state.selectedRecipients.has(handle);
      const v = state.verifiedRecipients[handle];
      const statusObj = state.rowStatuses[handle] || { status: 'pending' };

      // Verification pill
      let verifyPill = `<span class="pill pill-neutral">Unchecked</span>`;
      if (v) {
        if (v.exists) {
          verifyPill = `<span class="pill pill-success">Verified</span>`;
        } else {
          verifyPill = `<span class="pill pill-danger">Not Found</span>`;
        }
      }

      // Live Send Status
      let sendPill = '';
      if (statusObj.status === 'sending') {
        sendPill = `<span class="pill pill-warning">Sending...</span>`;
      } else if (statusObj.status === 'sent') {
        const lat = statusObj.latency ? ` (${statusObj.latency})` : '';
        sendPill = `<span class="pill pill-success">Sent${lat}</span>`;
      } else if (statusObj.status === 'failed') {
        sendPill = `<span class="pill pill-danger" title="${escapeHtml(statusObj.details || 'Failed')}">Failed</span>`;
      }

      const displayName = v?.fullName ? `<span class="row-name">${escapeHtml(v.fullName)}</span>` : '';

      return `
        <div class="recipient-row ${isSelected ? 'selected' : ''}" id="row-${handle}">
          <div class="row-left">
            <input type="checkbox" data-handle="${handle}" class="recipient-checkbox" ${isSelected ? 'checked' : ''} />
            <a href="https://instagram.com/${handle}" target="_blank" rel="noreferrer" class="row-handle">@${escapeHtml(handle)}</a>
            ${displayName}
          </div>
          <div class="row-right">
            ${verifyPill}
            ${sendPill}
            <button class="delete-row-btn" data-handle="${handle}" title="Remove">
              <span class="iconify" data-icon="ph:trash-bold" data-width="12"></span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    dom.recipientsList.innerHTML = html;
  }

  function updateCounts() {
    const total = state.recipients.length;
    const selected = state.selectedRecipients.size;
    dom.recipientsCountPill.textContent = `${selected} selected of ${total}`;

    // Check invalid
    let invalidCount = 0;
    let unverifiedCount = 0;
    state.recipients.forEach(h => {
      const v = state.verifiedRecipients[h];
      if (!v) unverifiedCount++;
      else if (!v.exists) invalidCount++;
    });

    if (invalidCount > 0) {
      dom.pipeInvalid.classList.remove('hidden');
      dom.btnRemoveInvalid.classList.remove('hidden');
      dom.invalidCountBadge.textContent = invalidCount;
    } else {
      dom.pipeInvalid.classList.add('hidden');
      dom.btnRemoveInvalid.classList.add('hidden');
    }

    dom.btnVerifyLabel.textContent = unverifiedCount > 0 ? `Verify IDs (${unverifiedCount})` : 'All Verified';
  }

  // Upfront Verification
  async function batchResolveRecipients() {
    if (!state.sessionId) {
      alert('Please connect your session cookie first.');
      dom.sessionDrawer.classList.remove('hidden');
      return;
    }

    const unverified = state.recipients.filter(h => !state.verifiedRecipients[h]);
    if (unverified.length === 0) {
      alert('All recipient handles already have their Instagram numeric IDs cached in memory.');
      return;
    }

    dom.btnVerifyUnchecked.disabled = true;
    dom.btnVerifyUnchecked.innerHTML = `<span class="iconify" data-icon="ph:spinner" data-width="12"></span> Verifying ${unverified.length}...`;
    addLog('system', `Verifying ${unverified.length} handles with Instagram...`);

    try {
      const res = await fetch('/api/resolve-recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionid: state.sessionId,
          recipients: unverified,
        }),
      });

      const data = await res.json();
      if (data.ok && Array.isArray(data.results)) {
        let valid = 0;
        let notFound = 0;

        data.results.forEach(r => {
          const k = r.username.toLowerCase();
          state.verifiedRecipients[k] = {
            exists: Boolean(r.exists),
            userId: r.userId || null,
            fullName: r.fullName || '',
            profilePic: r.profilePic || '',
          };
          if (r.exists) valid++;
          else notFound++;
        });

        saveState();
        renderRecipients();
        addLog('system', `Verification complete: ${valid} found, ${notFound} missing.`);
      } else {
        alert('Verification error: ' + (data.error || 'Failed'));
      }
    } catch (err) {
      alert('Network error during verification: ' + err.message);
    } finally {
      dom.btnVerifyUnchecked.disabled = false;
      updateCounts();
    }
  }

  // ================= SECTION 3: MESSAGE =================
  function updateMessage() {
    const text = dom.messageTextarea.value;
    state.messageText = text;
    dom.charCount.textContent = text.length;
    updatePreview();
    saveState();
  }

  function updatePreview() {
    let target = 'user';
    for (const r of state.recipients) {
      if (state.selectedRecipients.has(r)) {
        target = r;
        break;
      }
    }
    const sample = (dom.messageTextarea.value || 'Hi {{username}}! Great connecting...')
      .replace(/\{\{\s*username\s*\}\}/gi, `@${target}`);
    dom.previewSnippet.textContent = `Preview: ${sample.substring(0, 45)}${sample.length > 45 ? '...' : ''}`;
  }

  // ================= SECTION 4: DISPATCH =================
  function updateWorkerChips() {
    const selectedCount = state.selectedRecipients.size;
    dom.btnWorkersMax.textContent = `All (${selectedCount})`;

    let w = state.parallelWorkers;
    if (selectedCount > 0 && w > selectedCount) {
      w = selectedCount;
      state.parallelWorkers = w;
    }

    document.querySelectorAll('.worker-chip[data-workers]').forEach(chip => {
      const num = Number(chip.dataset.workers);
      chip.classList.toggle('active', num === w);
    });

    const isMax = selectedCount > 0 && w === selectedCount && w > 5;
    dom.btnWorkersMax.classList.toggle('active', isMax);

    dom.workerExplainText.textContent = `Sends to ${w} recipient${w > 1 ? 's' : ''} simultaneously`;

    if (state.campaignStatus === 'idle') {
      dom.startBtnLabel.textContent = selectedCount > 0
        ? `Start Campaign (${selectedCount} Recipients)`
        : 'Start Campaign (Select Recipients Above)';
    }
  }

  function setWorkers(num) {
    const selectedCount = state.selectedRecipients.size;
    let target = Math.max(1, num);
    if (selectedCount > 0 && target > selectedCount) target = selectedCount;

    state.parallelWorkers = target;
    saveState();
    updateWorkerChips();
  }

  async function startCampaign() {
    if (!state.sessionId) {
      alert('Connect your Instagram session cookie first.');
      dom.sessionDrawer.classList.remove('hidden');
      return;
    }

    if (!state.messageText.trim()) {
      alert('Please write a message first.');
      dom.messageTextarea.focus();
      return;
    }

    state.activeQueue = state.recipients.filter(h => state.selectedRecipients.has(h));
    if (state.activeQueue.length === 0) {
      alert('Please check the boxes for the recipients you want to send to.');
      return;
    }

    const total = state.activeQueue.length;
    const workers = Math.min(state.parallelWorkers, total);

    state.campaignStatus = 'running';
    state.currentIndex = 0;
    state.sentCount = 0;
    state.failedCount = 0;
    state.rowStatuses = {};

    updateCampaignUI();
    updateStats();

    addLog('system', `Campaign started — ${total} recipients with ${workers} parallel workers.`);

    const workerTasks = [];
    for (let i = 0; i < workers; i++) {
      workerTasks.push(runWorker(i + 1));
    }

    await Promise.all(workerTasks);

    if (state.campaignStatus === 'running') {
      finishCampaign();
    }
  }

  async function runWorker(workerId) {
    while (state.campaignStatus === 'running' && state.currentIndex < state.activeQueue.length) {
      const idx = state.currentIndex++;
      const username = state.activeQueue[idx];
      const currentNum = idx + 1;
      const totalNum = state.activeQueue.length;

      dom.currentWorkerActivity.textContent = `Sending to @${username} (${currentNum}/${totalNum})...`;
      state.rowStatuses[username] = { status: 'sending' };
      renderRecipients();

      const msg = state.messageText
        .replace(/\{\{\s*username\s*\}\}/gi, username)
        .replace(/\{\{\s*handle\s*\}\}/gi, `@${username}`);

      const startMs = performance.now();
      const res = await sendDM(username, msg);
      const elapsed = Math.round(performance.now() - startMs);
      const latStr = elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`;

      if (res.ok) {
        state.sentCount++;
        state.rowStatuses[username] = { status: 'sent', latency: latStr };
        addLog(username, `Sent (${latStr})`);
      } else {
        state.failedCount++;
        state.rowStatuses[username] = { status: 'failed', latency: latStr, details: res.error };
        addLog(username, `Failed: ${res.error}`);
      }

      updateStats();
      renderRecipients();
    }
  }

  async function sendDM(username, text) {
    try {
      const cached = state.verifiedRecipients[username];
      const recipientUserId = (cached && cached.exists && cached.userId) ? cached.userId : null;

      const payload = {
        sessionid: state.sessionId,
        recipient: username,
        text,
      };
      if (recipientUserId) payload.recipientUserId = recipientUserId;

      const res = await fetch('/api/send-dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.ok) return { ok: true };

      const body = data.body || {};
      const err = body.message || body.error || data.error || `HTTP ${data.status || 'unknown'}`;
      return { ok: false, error: err };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function pauseCampaign() {
    state.campaignStatus = 'paused';
    addLog('system', 'Campaign paused.');
    updateCampaignUI();
  }

  function resumeCampaign() {
    state.campaignStatus = 'running';
    addLog('system', 'Campaign resumed.');
    updateCampaignUI();
    const workers = Math.min(state.parallelWorkers, state.activeQueue.length);
    const workerTasks = [];
    for (let i = 0; i < workers; i++) workerTasks.push(runWorker(i + 1));
    Promise.all(workerTasks).then(() => {
      if (state.campaignStatus === 'running') finishCampaign();
    });
  }

  function stopCampaign() {
    state.campaignStatus = 'stopped';
    addLog('system', 'Campaign stopped.');
    updateCampaignUI();
    dom.currentWorkerActivity.textContent = 'Campaign terminated';
  }

  function finishCampaign() {
    state.campaignStatus = 'completed';
    addLog('system', `Completed! ${state.sentCount} sent, ${state.failedCount} failed.`);
    updateCampaignUI();
    dom.currentWorkerActivity.textContent = `Completed (${state.sentCount} sent, ${state.failedCount} failed)`;
  }

  function updateCampaignUI() {
    const s = state.campaignStatus;
    dom.campaignStatusPill.className = `pill pill-${s === 'running' ? 'warning' : s === 'completed' ? 'success' : 'idle'}`;
    dom.campaignStatusPill.textContent = s.charAt(0).toUpperCase() + s.slice(1);

    if (s === 'running') {
      dom.btnStartCampaign.classList.add('hidden');
      dom.runningActionsRow.classList.remove('hidden');
      dom.btnPauseCampaign.classList.remove('hidden');
      dom.btnResumeCampaign.classList.add('hidden');
      dom.btnStopCampaign.classList.remove('hidden');
    } else if (s === 'paused') {
      dom.btnStartCampaign.classList.add('hidden');
      dom.runningActionsRow.classList.remove('hidden');
      dom.btnPauseCampaign.classList.add('hidden');
      dom.btnResumeCampaign.classList.remove('hidden');
      dom.btnStopCampaign.classList.remove('hidden');
      dom.currentWorkerActivity.textContent = 'Campaign paused';
    } else {
      dom.btnStartCampaign.classList.remove('hidden');
      dom.runningActionsRow.classList.add('hidden');
      updateWorkerChips();
    }
  }

  function updateStats() {
    const total = state.activeQueue.length > 0 ? state.activeQueue.length : state.selectedRecipients.size;
    const processed = state.sentCount + state.failedCount;
    const remaining = Math.max(0, total - processed);
    const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

    dom.statSent.textContent = state.sentCount;
    dom.statFailed.textContent = state.failedCount;
    dom.statRemaining.textContent = remaining;
    dom.progressFill.style.width = `${pct}%`;
  }

  // ================= SECTION 5: ACTIVITY LOGS =================
  function addLog(who, msg) {
    const d = new Date();
    const time = d.toTimeString().split(' ')[0];
    state.logs.unshift({ time, who, msg });
    saveState();
    renderLogs();
  }

  function renderLogs() {
    if (state.logs.length === 0) {
      dom.logsFeed.innerHTML = `<div class="empty-logs">No activity recorded yet.</div>`;
      return;
    }

    const html = state.logs.map(l => {
      const isSys = l.who === 'system';
      const whoLabel = isSys ? 'system' : `@${escapeHtml(l.who)}`;
      return `
        <div class="log-row">
          <span class="log-time">${l.time}</span>
          <span class="log-who ${isSys ? 'text-muted' : ''}">${whoLabel}</span>
          <span class="log-msg">${escapeHtml(l.msg)}</span>
        </div>
      `;
    }).join('');

    dom.logsFeed.innerHTML = html;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ================= EVENT BINDINGS =================
  function bindEvents() {
    // Header & Section 1: Account
    dom.btnToggleAccountDrawer.addEventListener('click', () => {
      dom.sessionDrawer.classList.toggle('hidden');
      if (!dom.sessionDrawer.classList.contains('hidden')) dom.sessionIdInput.focus();
    });
    dom.btnEditSession.addEventListener('click', () => {
      dom.sessionDrawer.classList.toggle('hidden');
      if (!dom.sessionDrawer.classList.contains('hidden')) dom.sessionIdInput.focus();
    });
    dom.btnToggleSessionVisibility.addEventListener('click', () => {
      const inp = dom.sessionIdInput;
      const isPass = inp.type === 'password';
      inp.type = isPass ? 'text' : 'password';
      dom.btnToggleSessionVisibility.textContent = isPass ? 'Hide' : 'Show';
    });
    dom.btnSaveSession.addEventListener('click', verifySession);

    // Section 2: Recipients
    dom.recipientSearchInput.addEventListener('input', e => {
      state.searchQuery = e.target.value;
      renderRecipients();
    });
    dom.btnSelectAll.addEventListener('click', selectAll);
    dom.btnDeselectAll.addEventListener('click', deselectAll);
    dom.btnDeleteSelected.addEventListener('click', deleteSelected);
    dom.btnRemoveInvalid.addEventListener('click', removeInvalid);
    dom.btnVerifyUnchecked.addEventListener('click', batchResolveRecipients);

    dom.recipientsList.addEventListener('change', e => {
      if (e.target.classList.contains('recipient-checkbox')) {
        toggleSelect(e.target.dataset.handle, e.target.checked);
      }
    });
    dom.recipientsList.addEventListener('click', e => {
      const btn = e.target.closest('.delete-row-btn');
      if (btn) deleteSingle(btn.dataset.handle);
    });

    // Add Recipients Modal
    dom.btnOpenAddModal.addEventListener('click', () => {
      dom.addRecipientsModal.classList.remove('hidden');
      dom.importTextarea.focus();
    });
    dom.btnEmptyAdd.addEventListener('click', () => {
      dom.addRecipientsModal.classList.remove('hidden');
      dom.importTextarea.focus();
    });
    dom.btnCloseAddModal.addEventListener('click', () => {
      dom.addRecipientsModal.classList.add('hidden');
    });
    dom.btnCancelAddModal.addEventListener('click', () => {
      dom.addRecipientsModal.classList.add('hidden');
    });
    dom.importTextarea.addEventListener('input', e => {
      const lines = e.target.value.split('\n').filter(l => l.trim().length > 0);
      dom.importParsedCount.textContent = `${lines.length} handles detected`;
    });
    dom.importFileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const r = new FileReader();
      r.onload = ev => {
        dom.importTextarea.value = ev.target.result;
        const lines = ev.target.result.split('\n').filter(l => l.trim().length > 0);
        dom.importParsedCount.textContent = `${lines.length} handles detected`;
      };
      r.readAsText(file);
    });
    dom.btnConfirmAddRecipients.addEventListener('click', () => {
      addRecipients(dom.importTextarea.value.split('\n'));
      dom.importTextarea.value = '';
      dom.importParsedCount.textContent = '0 handles detected';
      dom.addRecipientsModal.classList.add('hidden');
    });

    // Section 3: Message
    dom.messageTextarea.addEventListener('input', updateMessage);
    dom.btnInsertUsername.addEventListener('click', () => {
      const pos = dom.messageTextarea.selectionStart;
      const text = dom.messageTextarea.value;
      dom.messageTextarea.value = text.substring(0, pos) + '{{username}}' + text.substring(pos);
      updateMessage();
      dom.messageTextarea.focus();
    });

    // Section 4: Dispatch
    document.querySelectorAll('.worker-chip[data-workers]').forEach(chip => {
      chip.addEventListener('click', () => setWorkers(Number(chip.dataset.workers)));
    });
    dom.btnWorkersMax.addEventListener('click', () => {
      setWorkers(state.selectedRecipients.size || 20);
    });
    dom.btnStartCampaign.addEventListener('click', startCampaign);
    dom.btnPauseCampaign.addEventListener('click', pauseCampaign);
    dom.btnResumeCampaign.addEventListener('click', resumeCampaign);
    dom.btnStopCampaign.addEventListener('click', stopCampaign);

    // Section 5: Logs
    dom.btnClearLogs.addEventListener('click', () => {
      if (confirm('Clear logs?')) {
        state.logs = [];
        saveState();
        renderLogs();
      }
    });
    dom.btnExportLogs.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state.logs, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `instadm-logs-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(a);
    });
  }

  // ================= INIT =================
  function init() {
    cacheDom();
    loadPersistedState();
    bindEvents();

    dom.messageTextarea.value = state.messageText;

    updateAccountUI();
    renderRecipients();
    updateMessage();
    updateWorkerChips();
    updateStats();
    renderLogs();

    pollBrowserStatus();
    setInterval(pollBrowserStatus, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
