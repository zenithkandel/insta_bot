/**
 * InstaDM — Dedicated Tabbed Architecture
 * One Tab = One Feature. Pure SVG icons, zero emojis, light beige palette.
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
    PACING_INTERVAL: 'instadm_pacing_interval',
    ACTIVE_TAB: 'instadm_active_tab',
    LOGS: 'instadm_logs',
  };

  // ================= STATE =================
  const state = {
    sessionId: '',
    senderInfo: null,
    recipients: [],
    selectedRecipients: new Set(),
    verifiedRecipients: {},
    messageText: '',
    parallelWorkers: 3,
    pacingInterval: 0,
    activeTab: 'tab-session',
    logs: [],

    // Campaign runtime
    campaignStatus: 'idle',
    currentIndex: 0,
    activeQueue: [],
    sentCount: 0,
    failedCount: 0,
    rowStatuses: {},

    // Filters
    recipientSearchQuery: '',
    recipientFilter: 'all',
    logSearchQuery: '',
    logFilter: 'all',
  };

  // ================= DOM ELEMENT CACHE =================
  const $ = id => document.getElementById(id);
  const dom = {};

  function cacheDom() {
    [
      // Navigation
      'mainNavTabs', 'sessionIndicator', 'recipientsTabBadge', 'dispatchStatusPill',
      'browserStatusContainer', 'browserStatusDot', 'browserStatusLabel',
      'headerAccountChip', 'headerAccountHandle',

      // Tab 1: Session
      'sessionAvatar', 'sessionHandle', 'sessionStatusBadge', 'sessionMetaSub', 'btnClearSession',
      'sessionIdInput', 'btnToggleSessionVisibility', 'btnSaveSession', 'sessionFeedback',

      // Tab 2: Recipients
      'btnOpenAddModal', 'btnVerifyUnchecked', 'btnVerifyLabel',
      'recipientSearchInput', 'btnClearSearch',
      'filterAllCount', 'filterSelectedCount', 'filterVerifiedCount', 'filterUnverifiedCount',
      'btnSelectAll', 'btnDeselectAll', 'btnDeleteSelected',
      'pipeInvalid', 'btnRemoveInvalid', 'invalidCountBadge',
      'masterCheckbox', 'recipientsTableBody', 'recipientsEmptyState', 'btnEmptyAdd',

      // Tab 3: Composer
      'btnInsertUsername', 'messageTextarea', 'charCount', 'wordCount',
      'previewTargetName', 'previewBubble',

      // Tab 4: Dispatch
      'campaignStatusBadge', 'summarySelectedCount', 'summarySenderHandle', 'summaryWorkersText', 'summaryPacingText',
      'parallelWorkersInput', 'parallelWorkersSlider', 'sliderMaxText', 'btnWorkersMax', 'workersExplain',
      'pacingIntervalInput', 'btnStartCampaign', 'startBtnLabel', 'runningActionsRow',
      'btnPauseCampaign', 'btnResumeCampaign', 'btnStopCampaign',
      'currentWorkerActivity', 'progressPercentageText', 'progressFill',
      'statSelected', 'statSent', 'statFailed', 'statRemaining',

      // Tab 5: Activity
      'btnClearLogs', 'btnExportLogs', 'logSearchInput',
      'logFilterAllCount', 'logFilterSentCount', 'logFilterFailedCount', 'logFilterSystemCount',
      'logsFeed',

      // Add Modal
      'addRecipientsModal', 'btnCloseAddModal', 'btnCancelAddModal', 'importTextarea',
      'importFileInput', 'importParsedCount', 'btnConfirmAddRecipients',
    ].forEach(id => {
      dom[id] = $(id);
    });

    dom.navTabButtons = Array.from(document.querySelectorAll('.nav-tab'));
    dom.tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
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
      state.pacingInterval = Math.max(0, Number(localStorage.getItem(STORAGE_KEYS.PACING_INTERVAL)) || 0);
      state.activeTab = localStorage.getItem(STORAGE_KEYS.ACTIVE_TAB) || (state.sessionId ? 'tab-recipients' : 'tab-session');

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
      localStorage.setItem(STORAGE_KEYS.PACING_INTERVAL, String(state.pacingInterval));
      localStorage.setItem(STORAGE_KEYS.ACTIVE_TAB, state.activeTab);
      localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(state.logs.slice(0, 150)));
    } catch (err) {
      console.warn('Error saving state:', err);
    }
  }

  // ================= TAB NAVIGATION =================
  function switchTab(tabId) {
    state.activeTab = tabId;
    saveState();

    dom.navTabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    dom.tabPanels.forEach(panel => {
      const isTarget = panel.id === tabId;
      panel.classList.toggle('active', isTarget);
      panel.classList.toggle('hidden', !isTarget);
    });

    // Refresh context when switching
    if (tabId === 'tab-recipients') renderRecipientsTable();
    else if (tabId === 'tab-composer') updateComposerUI();
    else if (tabId === 'tab-dispatch') updateDispatchSummaryUI();
    else if (tabId === 'tab-activity') renderLogs();
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
      label.textContent = 'Chrome Standby';
    }
  }

  // ================= TAB 1: SESSION =================
  function updateSessionUI() {
    const s = state.senderInfo;
    const hasSession = Boolean(state.sessionId && state.sessionId.trim());

    if (hasSession && s && s.authenticated) {
      dom.headerAccountHandle.textContent = `@${s.username}`;
      dom.sessionHandle.textContent = `@${s.username}`;
      dom.sessionStatusBadge.className = 'badge badge-success';
      dom.sessionStatusBadge.textContent = 'Connected';
      dom.sessionMetaSub.textContent = `Instagram User ID: ${s.id || s.ds_user_id || 'Verified'} • Cookies stored locally`;
      dom.sessionIndicator.classList.add('active');

      if (s.profilePic) {
        dom.sessionAvatar.innerHTML = `<img src="${escapeHtml(s.profilePic)}" alt="" />`;
      } else {
        const init = (s.username || 'U').charAt(0).toUpperCase();
        dom.sessionAvatar.innerHTML = `<span class="font-mono">${init}</span>`;
      }
      dom.btnClearSession.classList.remove('hidden');
    } else if (hasSession) {
      dom.headerAccountHandle.textContent = 'Cookie Saved';
      dom.sessionHandle.textContent = 'Unverified Cookie';
      dom.sessionStatusBadge.className = 'badge badge-warning';
      dom.sessionStatusBadge.textContent = 'Unverified';
      dom.sessionMetaSub.textContent = 'Click Save & Verify to test your session';
      dom.sessionAvatar.innerHTML = `<span class="iconify" data-icon="ph:cookie-bold" data-width="18"></span>`;
      dom.sessionIndicator.classList.remove('active');
      dom.btnClearSession.classList.remove('hidden');
    } else {
      dom.headerAccountHandle.textContent = 'Not Connected';
      dom.sessionHandle.textContent = 'No session configured';
      dom.sessionStatusBadge.className = 'badge badge-neutral';
      dom.sessionStatusBadge.textContent = 'Offline';
      dom.sessionMetaSub.textContent = 'Enter your session cookie below to authenticate';
      dom.sessionAvatar.innerHTML = `<span class="iconify" data-icon="ph:user-bold" data-width="18"></span>`;
      dom.sessionIndicator.classList.remove('active');
      dom.btnClearSession.classList.add('hidden');
    }

    if (dom.sessionIdInput && !dom.sessionIdInput.value) {
      dom.sessionIdInput.value = state.sessionId;
    }
  }

  async function verifySession() {
    const raw = dom.sessionIdInput.value.trim();
    if (!raw) {
      showSessionFeedback('error', 'Please enter your sessionid cookie first.');
      return;
    }

    dom.btnSaveSession.disabled = true;
    dom.btnSaveSession.innerHTML = `<span class="iconify" data-icon="ph:spinner" data-width="12"></span> Verifying...`;
    showSessionFeedback('neutral', 'Connecting to Instagram & checking authenticated profile...');

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
        updateSessionUI();
        updateDispatchSummaryUI();
        showSessionFeedback('success', `Verified successfully as @${data.sender.username} (User ID: ${data.sender.id})`);
        addLog('system', `Session verified. Connected as @${data.sender.username}`);
      } else {
        const err = data.reason || data.error || 'Invalid session cookie.';
        showSessionFeedback('error', `Verification failed: ${err}`);
        addLog('system', `Session verification failed: ${err}`);
      }
    } catch (err) {
      showSessionFeedback('error', `Connection error: ${err.message}`);
      addLog('system', `Network error: ${err.message}`);
    } finally {
      dom.btnSaveSession.disabled = false;
      dom.btnSaveSession.innerHTML = `<span class="iconify" data-icon="ph:check-bold" data-width="12"></span> <span>Save & Verify</span>`;
    }
  }

  function clearSession() {
    if (!confirm('Clear your saved session cookie? You will need to re-enter it to dispatch campaigns.')) return;
    state.sessionId = '';
    state.senderInfo = null;
    dom.sessionIdInput.value = '';
    saveState();
    updateSessionUI();
    updateDispatchSummaryUI();
    addLog('system', 'Session cookie cleared.');
  }

  function showSessionFeedback(type, text) {
    dom.sessionFeedback.className = `feedback-box ${type}`;
    dom.sessionFeedback.textContent = text;
    dom.sessionFeedback.classList.remove('hidden');
  }

  // ================= TAB 2: RECIPIENTS =================
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
      renderRecipientsTable();
      updateWorkerControls();
      updateDispatchSummaryUI();
      addLog('system', `Added ${count} new recipient(s). Total: ${state.recipients.length}`);
    }
    return count;
  }

  function deleteSelected() {
    const toDelete = new Set(state.selectedRecipients);
    if (toDelete.size === 0) return;

    if (!confirm(`Remove ${toDelete.size} selected recipient(s)?`)) return;

    state.recipients = state.recipients.filter(h => !toDelete.has(h));
    state.selectedRecipients.clear();
    saveState();
    renderRecipientsTable();
    updateWorkerControls();
    updateDispatchSummaryUI();
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
    renderRecipientsTable();
    updateWorkerControls();
    updateDispatchSummaryUI();
    addLog('system', `Removed ${removed} non-existent handles.`);
  }

  function deleteSingle(handle) {
    state.recipients = state.recipients.filter(h => h !== handle);
    state.selectedRecipients.delete(handle);
    saveState();
    renderRecipientsTable();
    updateWorkerControls();
    updateDispatchSummaryUI();
  }

  function toggleSelect(handle, isSelected) {
    if (isSelected) state.selectedRecipients.add(handle);
    else state.selectedRecipients.delete(handle);
    saveState();
    updateFilterCounts();
    updateWorkerControls();
    updateDispatchSummaryUI();
    updateMasterCheckbox();

    const row = document.getElementById(`row-${handle}`);
    if (row) row.classList.toggle('selected', isSelected);
  }

  function selectAll() {
    getFilteredRecipients().forEach(h => state.selectedRecipients.add(h));
    saveState();
    renderRecipientsTable();
    updateWorkerControls();
    updateDispatchSummaryUI();
  }

  function deselectAll() {
    state.selectedRecipients.clear();
    saveState();
    renderRecipientsTable();
    updateWorkerControls();
    updateDispatchSummaryUI();
  }

  function getFilteredRecipients() {
    const q = state.recipientSearchQuery.toLowerCase().trim();
    const f = state.recipientFilter;

    return state.recipients.filter(h => {
      const v = state.verifiedRecipients[h];
      if (f === 'selected' && !state.selectedRecipients.has(h)) return false;
      if (f === 'verified' && (!v || !v.exists)) return false;
      if (f === 'unverified' && v) return false;

      if (q) {
        const matchHandle = h.includes(q);
        const matchName = v?.fullName?.toLowerCase().includes(q);
        const matchId = String(v?.userId || '').includes(q);
        return matchHandle || matchName || matchId;
      }
      return true;
    });
  }

  function renderRecipientsTable() {
    const list = getFilteredRecipients();
    dom.recipientsTabBadge.textContent = state.recipients.length;
    updateFilterCounts();

    if (state.recipients.length === 0) {
      dom.recipientsEmptyState.classList.remove('hidden');
      dom.recipientsTableBody.innerHTML = '';
      dom.masterCheckbox.checked = false;
      return;
    }

    dom.recipientsEmptyState.classList.add('hidden');

    const html = list.map(handle => {
      const isSelected = state.selectedRecipients.has(handle);
      const v = state.verifiedRecipients[handle];
      const statusObj = state.rowStatuses[handle] || { status: 'pending' };

      // Verification pill
      let verifyPill = `<span class="badge badge-neutral">Unchecked</span>`;
      if (v) {
        if (v.exists) {
          verifyPill = `<span class="badge badge-success"><span class="iconify" data-icon="ph:check-bold"></span> Verified</span>`;
        } else {
          verifyPill = `<span class="badge badge-danger"><span class="iconify" data-icon="ph:x-bold"></span> 404 Missing</span>`;
        }
      }

      // Live Send Status
      let sendPill = `<span class="badge badge-neutral">Pending</span>`;
      if (statusObj.status === 'sending') {
        sendPill = `<span class="badge badge-warning"><span class="iconify" data-icon="ph:spinner"></span> Sending</span>`;
      } else if (statusObj.status === 'sent') {
        const lat = statusObj.latency ? ` (${statusObj.latency})` : '';
        sendPill = `<span class="badge badge-success"><span class="iconify" data-icon="ph:check-circle-fill"></span> Sent${lat}</span>`;
      } else if (statusObj.status === 'failed') {
        sendPill = `<span class="badge badge-danger" title="${escapeHtml(statusObj.details || 'Failed')}">Failed</span>`;
      }

      const fullName = v?.fullName ? escapeHtml(v.fullName) : '<span class="text-muted">—</span>';
      const userId = v?.userId ? `<code class="font-mono text-xs">${escapeHtml(v.userId)}</code>` : '<span class="text-muted">—</span>';

      return `
        <tr id="row-${handle}" class="${isSelected ? 'selected' : ''}">
          <td class="th-check">
            <input type="checkbox" data-handle="${handle}" class="recipient-checkbox" ${isSelected ? 'checked' : ''} />
          </td>
          <td>
            <a href="https://instagram.com/${handle}" target="_blank" rel="noreferrer" class="user-link">@${escapeHtml(handle)}</a>
          </td>
          <td>${fullName}</td>
          <td>${userId}</td>
          <td>${verifyPill} ${statusObj.status !== 'pending' ? sendPill : ''}</td>
          <td class="th-action">
            <button class="delete-row-btn" data-handle="${handle}" title="Remove">
              <span class="iconify" data-icon="ph:trash-bold" data-width="13"></span>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    dom.recipientsTableBody.innerHTML = html;
    updateMasterCheckbox();
  }

  function updateMasterCheckbox() {
    const list = getFilteredRecipients();
    if (list.length === 0) {
      dom.masterCheckbox.checked = false;
      dom.masterCheckbox.indeterminate = false;
      return;
    }

    const selectedCount = list.filter(h => state.selectedRecipients.has(h)).length;
    if (selectedCount === list.length) {
      dom.masterCheckbox.checked = true;
      dom.masterCheckbox.indeterminate = false;
    } else if (selectedCount > 0) {
      dom.masterCheckbox.checked = false;
      dom.masterCheckbox.indeterminate = true;
    } else {
      dom.masterCheckbox.checked = false;
      dom.masterCheckbox.indeterminate = false;
    }
  }

  function updateFilterCounts() {
    const total = state.recipients.length;
    let selected = 0;
    let verified = 0;
    let unverified = 0;
    let invalid = 0;

    state.recipients.forEach(h => {
      if (state.selectedRecipients.has(h)) selected++;
      const v = state.verifiedRecipients[h];
      if (!v) unverified++;
      else if (v.exists) verified++;
      else invalid++;
    });

    dom.filterAllCount.textContent = total;
    dom.filterSelectedCount.textContent = selected;
    dom.filterVerifiedCount.textContent = verified;
    dom.filterUnverifiedCount.textContent = unverified;

    if (invalid > 0) {
      dom.pipeInvalid.classList.remove('hidden');
      dom.btnRemoveInvalid.classList.remove('hidden');
      dom.invalidCountBadge.textContent = invalid;
    } else {
      dom.pipeInvalid.classList.add('hidden');
      dom.btnRemoveInvalid.classList.add('hidden');
    }

    dom.btnVerifyLabel.textContent = unverified > 0 ? `Verify IDs (${unverified})` : 'All Verified';
  }

  async function batchResolveRecipients() {
    if (!state.sessionId) {
      alert('Please connect your session cookie in the Session tab first.');
      switchTab('tab-session');
      return;
    }

    const unverified = state.recipients.filter(h => !state.verifiedRecipients[h]);
    if (unverified.length === 0) {
      alert('All recipients already have their numeric IDs pre-cached.');
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
        renderRecipientsTable();
        addLog('system', `Verification complete: ${valid} found & cached, ${notFound} missing.`);
      } else {
        alert('Verification error: ' + (data.error || 'Failed'));
      }
    } catch (err) {
      alert('Network error during verification: ' + err.message);
    } finally {
      dom.btnVerifyUnchecked.disabled = false;
      updateFilterCounts();
    }
  }

  // ================= TAB 3: COMPOSER =================
  function updateComposerUI() {
    const text = dom.messageTextarea.value;
    state.messageText = text;
    dom.charCount.textContent = text.length;
    dom.wordCount.textContent = text.trim() ? text.trim().split(/\s+/).length : 0;
    updatePreview();
    saveState();
  }

  function updatePreview() {
    let target = 'first_recipient';
    for (const r of state.recipients) {
      if (state.selectedRecipients.has(r)) {
        target = r;
        break;
      }
    }
    dom.previewTargetName.textContent = `@${target}`;
    const raw = dom.messageTextarea.value || 'Your message preview will appear here...';
    const personalized = raw
      .replace(/\{\{\s*username\s*\}\}/gi, target)
      .replace(/\{\{\s*handle\s*\}\}/gi, `@${target}`);
    dom.previewBubble.textContent = personalized;
  }

  // ================= TAB 4: DISPATCH =================
  function updateDispatchSummaryUI() {
    const selectedCount = state.selectedRecipients.size;
    dom.summarySelectedCount.textContent = `${selectedCount} Selected`;
    dom.summarySenderHandle.textContent = state.senderInfo?.username ? `@${state.senderInfo.username}` : 'Not Connected';
    dom.summaryWorkersText.textContent = `${state.parallelWorkers} Concurrent`;
    dom.summaryPacingText.textContent = state.pacingInterval === 0 ? '0s (Instant)' : `${state.pacingInterval}s delay`;
    updateWorkerControls();
    updateStatsUI();
  }

  function updateWorkerControls() {
    const selectedCount = state.selectedRecipients.size;
    dom.btnWorkersMax.textContent = `All (${selectedCount})`;

    const dynamicMax = Math.max(selectedCount > 0 ? selectedCount : 20, 20);
    dom.parallelWorkersSlider.max = dynamicMax;
    dom.parallelWorkersInput.max = dynamicMax;
    dom.sliderMaxText = `${dynamicMax} Max`;

    let currentVal = Number(dom.parallelWorkersInput.value) || state.parallelWorkers || 3;
    if (selectedCount > 0 && currentVal > selectedCount) currentVal = selectedCount;
    currentVal = Math.max(1, currentVal);

    state.parallelWorkers = currentVal;
    dom.parallelWorkersInput.value = currentVal;
    dom.parallelWorkersSlider.value = currentVal;

    document.querySelectorAll('.preset-chip[data-workers]').forEach(chip => {
      chip.classList.toggle('active', Number(chip.dataset.workers) === currentVal);
    });

    const isMax = selectedCount > 0 && currentVal === selectedCount && currentVal > 5;
    dom.btnWorkersMax.classList.toggle('active', isMax);

    dom.workersExplain.textContent = `Dispatches ${currentVal} messages simultaneously.`;

    if (state.campaignStatus === 'idle') {
      dom.startBtnLabel.textContent = selectedCount > 0
        ? `Start Campaign (${selectedCount} Recipients)`
        : 'Start Campaign (Select Recipients First)';
    }
  }

  function setWorkers(num) {
    const selectedCount = state.selectedRecipients.size;
    let target = Math.max(1, num);
    if (selectedCount > 0 && target > selectedCount) target = selectedCount;

    state.parallelWorkers = target;
    saveState();
    updateDispatchSummaryUI();
  }

  async function startCampaign() {
    if (!state.sessionId) {
      alert('Please connect your session cookie in the Session tab first.');
      switchTab('tab-session');
      return;
    }

    if (!state.messageText.trim()) {
      alert('Please draft your message in the Composer tab first.');
      switchTab('tab-composer');
      return;
    }

    state.activeQueue = state.recipients.filter(h => state.selectedRecipients.has(h));
    if (state.activeQueue.length === 0) {
      alert('No recipients selected. Please select recipients in the Recipients tab.');
      switchTab('tab-recipients');
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
    updateStatsUI();

    addLog('system', `Campaign started — ${total} selected recipients with ${workers} concurrent workers.`);

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

      dom.currentWorkerActivity.textContent = `[Worker #${workerId}] Sending to @${username} (${currentNum}/${totalNum})...`;
      state.rowStatuses[username] = { status: 'sending' };
      renderRecipientsTable();

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
        addLog(username, `Sent (${latStr})`, 'sent');
      } else {
        state.failedCount++;
        state.rowStatuses[username] = { status: 'failed', latency: latStr, details: res.error };
        addLog(username, `Failed: ${res.error}`, 'failed');
      }

      updateStatsUI();
      renderRecipientsTable();

      if (state.pacingInterval > 0 && state.campaignStatus === 'running' && state.currentIndex < state.activeQueue.length) {
        dom.currentWorkerActivity.textContent = `Pacing ${state.pacingInterval}s...`;
        await sleep(state.pacingInterval * 1000);
      }
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
    addLog('system', `Completed! Sent: ${state.sentCount}, Failed: ${state.failedCount}.`);
    updateCampaignUI();
    dom.currentWorkerActivity.textContent = `Completed (${state.sentCount} sent, ${state.failedCount} failed)`;
  }

  function updateCampaignUI() {
    const s = state.campaignStatus;
    dom.campaignStatusBadge.className = `pill pill-${s === 'running' ? 'warning' : s === 'completed' ? 'success' : 'idle'}`;
    dom.campaignStatusBadge.textContent = s.charAt(0).toUpperCase() + s.slice(1);
    dom.dispatchStatusPill.className = `tab-pill pill-${s === 'running' ? 'warning' : s === 'completed' ? 'success' : 'idle'}`;
    dom.dispatchStatusPill.textContent = s.charAt(0).toUpperCase() + s.slice(1);

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
      updateWorkerControls();
    }
  }

  function updateStatsUI() {
    const total = state.activeQueue.length > 0 ? state.activeQueue.length : state.selectedRecipients.size;
    const processed = state.sentCount + state.failedCount;
    const remaining = Math.max(0, total - processed);
    const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

    dom.statSelected.textContent = total;
    dom.statSent.textContent = state.sentCount;
    dom.statFailed.textContent = state.failedCount;
    dom.statRemaining.textContent = remaining;
    dom.progressPercentageText.textContent = `${pct}%`;
    dom.progressFill.style.width = `${pct}%`;
  }

  // ================= TAB 5: ACTIVITY LOGS =================
  function addLog(handle, details, status = 'system') {
    const d = new Date();
    const time = d.toTimeString().split(' ')[0];
    state.logs.unshift({ time, handle, details, status });
    saveState();
    renderLogs();
  }

  function getFilteredLogs() {
    const q = state.logSearchQuery.toLowerCase().trim();
    const f = state.logFilter;

    return state.logs.filter(l => {
      if (f === 'sent' && l.status !== 'sent') return false;
      if (f === 'failed' && l.status !== 'failed') return false;
      if (f === 'system' && l.handle !== 'system') return false;

      if (q) {
        return l.handle.toLowerCase().includes(q) || l.details.toLowerCase().includes(q);
      }
      return true;
    });
  }

  function renderLogs() {
    updateLogCounts();
    const list = getFilteredLogs();

    if (list.length === 0) {
      dom.logsFeed.innerHTML = `<div class="empty-state">No activity matching filter.</div>`;
      return;
    }

    const html = list.map(l => {
      const isSys = l.handle === 'system';
      const pillClass = l.status === 'sent' ? 'sent' : l.status === 'failed' ? 'failed' : 'system';
      const handleDisplay = isSys ? 'system' : `@${escapeHtml(l.handle)}`;

      return `
        <div class="log-item">
          <span class="log-time">${l.time}</span>
          <span class="log-pill ${pillClass}">${l.status}</span>
          <span class="log-handle">${handleDisplay}</span>
          <span class="log-msg">${escapeHtml(l.details)}</span>
        </div>
      `;
    }).join('');

    dom.logsFeed.innerHTML = html;
  }

  function updateLogCounts() {
    let sent = 0;
    let failed = 0;
    let sys = 0;

    state.logs.forEach(l => {
      if (l.status === 'sent') sent++;
      else if (l.status === 'failed') failed++;
      if (l.handle === 'system') sys++;
    });

    dom.logFilterAllCount.textContent = state.logs.length;
    dom.logFilterSentCount.textContent = sent;
    dom.logFilterFailedCount.textContent = failed;
    dom.logFilterSystemCount.textContent = sys;
  }

  // ================= UTILITIES =================
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
    // Nav Tabs
    dom.navTabButtons.forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Header Account Chip -> jump to Session tab
    dom.headerAccountChip.addEventListener('click', () => switchTab('tab-session'));

    // Tab 1: Session
    dom.btnToggleSessionVisibility.addEventListener('click', () => {
      const inp = dom.sessionIdInput;
      const isPass = inp.type === 'password';
      inp.type = isPass ? 'text' : 'password';
      dom.btnToggleSessionVisibility.textContent = isPass ? 'Hide' : 'Show';
    });
    dom.btnSaveSession.addEventListener('click', verifySession);
    dom.btnClearSession.addEventListener('click', clearSession);

    // Tab 2: Recipients
    dom.recipientSearchInput.addEventListener('input', e => {
      state.recipientSearchQuery = e.target.value;
      dom.btnClearSearch.classList.toggle('hidden', !e.target.value);
      renderRecipientsTable();
    });
    dom.btnClearSearch.addEventListener('click', () => {
      dom.recipientSearchInput.value = '';
      state.recipientSearchQuery = '';
      dom.btnClearSearch.classList.add('hidden');
      renderRecipientsTable();
    });

    document.querySelectorAll('.filter-chip[data-filter]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip[data-filter]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.recipientFilter = chip.dataset.filter;
        renderRecipientsTable();
      });
    });

    dom.masterCheckbox.addEventListener('change', e => {
      if (e.target.checked) selectAll();
      else deselectAll();
    });
    dom.btnSelectAll.addEventListener('click', selectAll);
    dom.btnDeselectAll.addEventListener('click', deselectAll);
    dom.btnDeleteSelected.addEventListener('click', deleteSelected);
    dom.btnRemoveInvalid.addEventListener('click', removeInvalid);
    dom.btnVerifyUnchecked.addEventListener('click', batchResolveRecipients);

    dom.recipientsTableBody.addEventListener('change', e => {
      if (e.target.classList.contains('recipient-checkbox')) {
        toggleSelect(e.target.dataset.handle, e.target.checked);
      }
    });
    dom.recipientsTableBody.addEventListener('click', e => {
      const btn = e.target.closest('.delete-row-btn');
      if (btn) deleteSingle(btn.dataset.handle);
    });

    // Add Modal
    dom.btnOpenAddModal.addEventListener('click', () => {
      dom.addRecipientsModal.classList.remove('hidden');
      dom.importTextarea.focus();
    });
    dom.btnEmptyAdd.addEventListener('click', () => {
      dom.addRecipientsModal.classList.remove('hidden');
      dom.importTextarea.focus();
    });
    dom.btnCloseAddModal.addEventListener('click', () => dom.addRecipientsModal.classList.add('hidden'));
    dom.btnCancelAddModal.addEventListener('click', () => dom.addRecipientsModal.classList.add('hidden'));

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

    // Tab 3: Composer
    dom.messageTextarea.addEventListener('input', updateComposerUI);
    dom.btnInsertUsername.addEventListener('click', () => {
      const pos = dom.messageTextarea.selectionStart;
      const text = dom.messageTextarea.value;
      dom.messageTextarea.value = text.substring(0, pos) + '{{username}}' + text.substring(pos);
      updateComposerUI();
      dom.messageTextarea.focus();
    });

    // Tab 4: Dispatch
    dom.parallelWorkersSlider.addEventListener('input', e => setWorkers(Number(e.target.value)));
    dom.parallelWorkersInput.addEventListener('change', e => setWorkers(Number(e.target.value)));
    document.querySelectorAll('.preset-chip[data-workers]').forEach(chip => {
      chip.addEventListener('click', () => setWorkers(Number(chip.dataset.workers)));
    });
    dom.btnWorkersMax.addEventListener('click', () => setWorkers(state.selectedRecipients.size || 20));
    dom.pacingIntervalInput.addEventListener('change', e => {
      state.pacingInterval = Math.max(0, Number(e.target.value) || 0);
      saveState();
      updateDispatchSummaryUI();
    });

    dom.btnStartCampaign.addEventListener('click', startCampaign);
    dom.btnPauseCampaign.addEventListener('click', pauseCampaign);
    dom.btnResumeCampaign.addEventListener('click', resumeCampaign);
    dom.btnStopCampaign.addEventListener('click', stopCampaign);

    // Tab 5: Activity
    dom.logSearchInput.addEventListener('input', e => {
      state.logSearchQuery = e.target.value;
      renderLogs();
    });
    document.querySelectorAll('.filter-chip[data-log-filter]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip[data-log-filter]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.logFilter = chip.dataset.logFilter;
        renderLogs();
      });
    });
    dom.btnClearLogs.addEventListener('click', () => {
      if (confirm('Clear activity logs?')) {
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
    dom.pacingIntervalInput.value = state.pacingInterval;

    updateSessionUI();
    renderRecipientsTable();
    updateComposerUI();
    updateDispatchSummaryUI();
    renderLogs();

    switchTab(state.activeTab);

    pollBrowserStatus();
    setInterval(pollBrowserStatus, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
