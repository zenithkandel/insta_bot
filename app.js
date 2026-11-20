/**
 * InstaDM — High-Speed Campaign Manager Frontend
 * Pure vanilla SPA with Linear/Raycast design ergonomics.
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
    LOGS: 'instadm_logs',
  };

  // ================= STATE =================
  const state = {
    sessionId: '',
    senderInfo: null,
    recipients: [], // Array of username strings (lowercase)
    selectedRecipients: new Set(), // Set of selected username strings
    verifiedRecipients: {}, // username -> { exists: bool, userId: str, fullName: str, profilePic: str }
    messageText: '',
    parallelWorkers: 3,
    pacingInterval: 0,
    logs: [],
    
    // Runtime campaign status
    campaignStatus: 'idle', // 'idle' | 'running' | 'paused' | 'stopped' | 'completed'
    currentIndex: 0,
    activeSelectedQueue: [],
    sentCount: 0,
    failedCount: 0,
    rowStatuses: {}, // username -> { status: 'pending'|'sending'|'sent'|'failed', latency: str, details: str }

    // UI filters
    activeTab: 'recipientsView',
    recipientSearchQuery: '',
    recipientFilter: 'all', // 'all' | 'selected' | 'verified' | 'unverified' | 'invalid'
    logSearchQuery: '',
    logFilter: 'all', // 'all' | 'sent' | 'failed' | 'system'
  };

  // ================= DOM ELEMENT CACHE =================
  const $ = id => document.getElementById(id);
  const dom = {};

  function cacheDom() {
    [
      // Header
      'browserStatusContainer', 'browserStatusDot', 'browserStatusLabel',
      'headerAccountPill', 'headerAvatar', 'headerUsername', 'headerAccountSub',
      'btnOpenSessionModal', 'sessionBtnLabel', 'btnExportBackup', 'btnImportBackupTrigger', 'backupFileInput',

      // Left Column: Sender Card
      'btnToggleSessionDrawer', 'senderAvatar', 'senderUsernameText', 'senderStatusBadge', 'senderUserIdText',
      'sessionDrawer', 'sessionIdInput', 'toggleSessionVisibility', 'btnCloseSessionDrawer', 'btnSaveSession', 'sessionFeedback',

      // Message Composer
      'btnInsertUsername', 'messageTextarea', 'charCount', 'wordCount', 'btnTogglePreview', 'livePreviewBox',
      'previewTargetName', 'previewBubbleText',

      // Dispatch Concurrency Settings
      'selectedCountBadge', 'parallelWorkersInput', 'parallelWorkersSlider', 'sliderMidLabel', 'sliderMaxLabel',
      'btnSetWorkersMax', 'pacingIntervalInput',

      // Campaign Execution & Metrics
      'campaignStatusPill', 'btnStartCampaign', 'startBtnLabel', 'runningActionsRow',
      'btnPauseCampaign', 'btnResumeCampaign', 'btnStopCampaign',
      'currentWorkerActivity', 'progressPercentageText', 'progressFill',
      'statSelected', 'statSent', 'statFailed', 'statRemaining',

      // Right Column: Tabs & Headers
      'tabRecipientsBtn', 'tabLogsBtn', 'recipientsTabBadge', 'logsTabBadge',
      'recipientsHeaderActions', 'logsHeaderActions', 'btnOpenAddModal', 'btnVerifyUnchecked', 'btnVerifyLabel',
      'btnClearLogs', 'btnExportLogs',

      // View 1: Recipients
      'recipientsView', 'recipientSearchInput', 'btnClearSearch',
      'filterCountAll', 'filterCountSelected', 'filterCountVerified', 'filterCountUnverified', 'filterCountInvalid',
      'btnSelectAll', 'btnDeselectAll', 'btnSelectVerified', 'btnDeleteSelected',
      'removeInvalidDivider', 'btnRemoveInvalid', 'invalidCountBadge',
      'masterCheckbox', 'recipientsTableBody', 'recipientsEmptyState', 'btnEmptyAdd',

      // View 2: Logs
      'logsView', 'logSearchInput', 'logFilterAll', 'logFilterSent', 'logFilterFailed', 'logFilterSystem', 'logsFeedContainer',

      // Add Recipients Modal
      'addRecipientsModal', 'btnCloseAddModal', 'importTextarea', 'importFileInput', 'importFileLabel',
      'importParsedCount', 'btnCancelAddModal', 'btnConfirmAddRecipients',
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
        // Default select all
        state.selectedRecipients = new Set(state.recipients);
      }

      const savedVerified = localStorage.getItem(STORAGE_KEYS.VERIFIED_RECIPIENTS);
      if (savedVerified) state.verifiedRecipients = JSON.parse(savedVerified);

      state.messageText = localStorage.getItem(STORAGE_KEYS.MESSAGE) || 'Hi {{username}}! Great connecting with you.';
      state.parallelWorkers = Math.max(1, Number(localStorage.getItem(STORAGE_KEYS.PARALLEL_WORKERS)) || 3);
      state.pacingInterval = Math.max(0, Number(localStorage.getItem(STORAGE_KEYS.PACING_INTERVAL)) || 0);

      const savedLogs = localStorage.getItem(STORAGE_KEYS.LOGS);
      if (savedLogs) state.logs = JSON.parse(savedLogs);
    } catch (err) {
      console.warn('Error loading localStorage state:', err);
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
      localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(state.logs.slice(0, 300))); // Keep latest 300
    } catch (err) {
      console.warn('Error saving to localStorage:', err);
    }
  }

  // ================= BROWSER STATUS POLLING =================
  async function pollBrowserStatus() {
    try {
      const res = await fetch('/api/status', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        updateBrowserStatusUI(data.browser || (data.daemon ? 'warm' : 'starting'), data.driver_active);
      } else {
        updateBrowserStatusUI('offline', false);
      }
    } catch {
      updateBrowserStatusUI('offline', false);
    }
  }

  function updateBrowserStatusUI(status, driverActive) {
    const dot = dom.browserStatusDot;
    const label = dom.browserStatusLabel;
    if (!dot || !label) return;

    dot.className = 'status-indicator-dot';

    if (status === 'warm' || (status === 'ready' && driverActive)) {
      dot.classList.add('dot-warm');
      label.textContent = 'Browser Warm (Ready)';
      dom.browserStatusContainer.title = 'Headless Chrome is warm in background. Sub-second DM delivery active.';
    } else if (status === 'starting') {
      dot.classList.add('dot-starting');
      label.textContent = 'Launching Browser...';
      dom.browserStatusContainer.title = 'Headless Chrome instance is booting up.';
    } else {
      dot.classList.add('dot-offline');
      label.textContent = 'Browser Standby';
      dom.browserStatusContainer.title = 'Browser worker will launch automatically on first dispatch.';
    }
  }

  // ================= SENDER / SESSION MANAGEMENT =================
  function updateSenderUI() {
    const s = state.senderInfo;
    const hasSession = Boolean(state.sessionId && state.sessionId.trim());

    if (hasSession && s && s.authenticated) {
      // Header pill
      dom.headerUsername.textContent = `@${s.username || 'active_user'}`;
      dom.headerAccountSub.textContent = `ID: ${s.id || s.ds_user_id || 'Connected'}`;
      dom.sessionBtnLabel.textContent = 'Configure';
      if (s.profilePic) {
        dom.headerAvatar.innerHTML = `<img src="${escapeHtml(s.profilePic)}" alt="" />`;
        dom.senderAvatar.innerHTML = `<img src="${escapeHtml(s.profilePic)}" alt="" />`;
      } else {
        const initial = (s.username || 'U').charAt(0).toUpperCase();
        dom.headerAvatar.textContent = initial;
        dom.senderAvatar.textContent = initial;
      }

      // Sender Card
      dom.senderUsernameText.textContent = `@${s.username}`;
      dom.senderStatusBadge.className = 'badge badge-success';
      dom.senderStatusBadge.textContent = 'Connected';
      dom.senderUserIdText.textContent = s.id || s.ds_user_id || 'Verified';
      dom.btnToggleSessionDrawer.textContent = 'Change Cookie';
    } else if (hasSession) {
      dom.headerUsername.textContent = 'Cookie Saved';
      dom.headerAccountSub.textContent = 'Click to verify';
      dom.sessionBtnLabel.textContent = 'Verify';
      dom.headerAvatar.textContent = '🍪';
      dom.senderAvatar.textContent = '🍪';
      dom.senderUsernameText.textContent = 'Unverified Cookie';
      dom.senderStatusBadge.className = 'badge badge-warning';
      dom.senderStatusBadge.textContent = 'Unverified';
      dom.senderUserIdText.textContent = 'Click Change Cookie to verify';
      dom.btnToggleSessionDrawer.textContent = 'Verify Cookie';
    } else {
      dom.headerUsername.textContent = 'Not Connected';
      dom.headerAccountSub.textContent = 'No session active';
      dom.sessionBtnLabel.textContent = 'Connect';
      dom.headerAvatar.textContent = '?';
      dom.senderAvatar.textContent = '?';
      dom.senderUsernameText.textContent = 'No session configured';
      dom.senderStatusBadge.className = 'badge badge-neutral';
      dom.senderStatusBadge.textContent = 'Offline';
      dom.senderUserIdText.textContent = '—';
      dom.btnToggleSessionDrawer.textContent = 'Enter Cookie';
    }

    if (dom.sessionIdInput && !dom.sessionIdInput.value) {
      dom.sessionIdInput.value = state.sessionId;
    }
  }

  async function verifySession() {
    const rawInput = dom.sessionIdInput.value.trim();
    if (!rawInput) {
      showSessionFeedback('error', 'Please paste your sessionid cookie first.');
      return;
    }

    dom.btnSaveSession.disabled = true;
    dom.btnSaveSession.innerHTML = `<span class="iconify" data-icon="ph:spinner" data-width="14"></span> Verifying...`;
    showSessionFeedback('neutral', 'Connecting to Instagram & extracting authenticated profile...');

    try {
      const res = await fetch('/api/verify-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionid: rawInput }),
      });
      const data = await res.json();

      if (data.ok && data.sender) {
        state.sessionId = rawInput;
        state.senderInfo = { ...data.sender, authenticated: true };
        saveState();
        updateSenderUI();
        showSessionFeedback('success', `Verified as @${data.sender.username} (User ID: ${data.sender.id})`);
        addLog('system', 'completed', `Session verified successfully. Authenticated as @${data.sender.username}.`);
        setTimeout(() => {
          dom.sessionDrawer.classList.add('hidden');
          hideSessionFeedback();
        }, 1500);
      } else {
        const reason = data.reason || data.error || 'Invalid session cookie. Please check DevTools.';
        showSessionFeedback('error', `Verification failed: ${reason}`);
        addLog('system', 'failed', `Session verification failed: ${reason}`);
      }
    } catch (err) {
      showSessionFeedback('error', `Connection error: ${err.message}`);
      addLog('system', 'failed', `Session network error: ${err.message}`);
    } finally {
      dom.btnSaveSession.disabled = false;
      dom.btnSaveSession.innerHTML = `<span class="iconify" data-icon="ph:shield-check-bold" data-width="14"></span> <span>Verify & Save</span>`;
    }
  }

  function showSessionFeedback(type, message) {
    const fb = dom.sessionFeedback;
    fb.className = `drawer-feedback ${type}`;
    fb.textContent = message;
    fb.classList.remove('hidden');
  }

  function hideSessionFeedback() {
    dom.sessionFeedback.classList.add('hidden');
  }

  // ================= MESSAGE COMPOSER =================
  function updateMessageUI() {
    const text = dom.messageTextarea.value;
    state.messageText = text;
    dom.charCount.textContent = text.length;
    dom.wordCount.textContent = text.trim() ? text.trim().split(/\s+/).length : 0;
    updateLivePreview();
    saveState();
  }

  function updateLivePreview() {
    // Pick first selected recipient, or first recipient, or fallback
    let target = 'username';
    for (const r of state.recipients) {
      if (state.selectedRecipients.has(r)) {
        target = r;
        break;
      }
    }
    if (target === 'username' && state.recipients.length > 0) {
      target = state.recipients[0];
    }

    dom.previewTargetName.textContent = `@${target}`;
    const raw = dom.messageTextarea.value || 'Your message preview will appear here...';
    const personalized = raw
      .replace(/\{\{\s*username\s*\}\}/gi, target)
      .replace(/\{\{\s*handle\s*\}\}/gi, `@${target}`);
    dom.previewBubbleText.textContent = personalized;
  }

  // ================= DYNAMIC WORKER SLIDER SCALING =================
  function updateWorkerControls() {
    const selectedCount = state.selectedRecipients.size;
    dom.selectedCountBadge.textContent = `${selectedCount} Selected`;

    // Max limit is either the selected count or at least 20
    const dynamicMax = Math.max(selectedCount > 0 ? selectedCount : 20, 20);
    dom.parallelWorkersSlider.max = dynamicMax;
    dom.parallelWorkersInput.max = dynamicMax;

    dom.sliderMidLabel.textContent = Math.round(dynamicMax / 2);
    dom.sliderMaxLabel.textContent = `${dynamicMax} Max`;

    // Keep value within bounds
    let currentVal = Number(dom.parallelWorkersInput.value) || state.parallelWorkers || 3;
    if (selectedCount > 0 && currentVal > selectedCount) {
      currentVal = selectedCount;
    }
    currentVal = Math.max(1, currentVal);

    state.parallelWorkers = currentVal;
    dom.parallelWorkersInput.value = currentVal;
    dom.parallelWorkersSlider.value = currentVal;

    // Update preset chips active state
    document.querySelectorAll('.preset-chip[data-workers]').forEach(chip => {
      const w = Number(chip.dataset.workers);
      chip.classList.toggle('active', w === currentVal);
    });

    // Update primary CTA button text
    if (state.campaignStatus === 'idle') {
      dom.startBtnLabel.textContent = selectedCount > 0 
        ? `Start Campaign (Send to ${selectedCount} Selected)` 
        : `Start Campaign (No Recipients Selected)`;
    }
  }

  function setWorkers(n) {
    const selectedCount = state.selectedRecipients.size;
    let target = Math.max(1, n);
    if (selectedCount > 0 && target > selectedCount) target = selectedCount;

    state.parallelWorkers = target;
    dom.parallelWorkersInput.value = target;
    dom.parallelWorkersSlider.value = target;
    saveState();
    updateWorkerControls();
  }

  // ================= RECIPIENTS LOGIC & TABLE =================
  function addRecipients(handles) {
    const cleanList = handles
      .map(h => h.trim().replace(/^@/, '').toLowerCase())
      .filter(h => h.length > 0 && /^[a-zA-Z0-9._]+$/.test(h));

    if (cleanList.length === 0) return 0;

    const existingSet = new Set(state.recipients);
    let addedCount = 0;

    cleanList.forEach(handle => {
      if (!existingSet.has(handle)) {
        existingSet.add(handle);
        state.recipients.push(handle);
        state.selectedRecipients.add(handle); // Auto-select new additions
        addedCount++;
      }
    });

    if (addedCount > 0) {
      saveState();
      renderRecipientsTable();
      updateWorkerControls();
      updateUnverifiedCountUI();
      updateLivePreview();
      addLog('system', 'completed', `Added ${addedCount} new unique recipient(s). Total: ${state.recipients.length}.`);
    }

    return addedCount;
  }

  function deleteSelectedRecipients() {
    const toDelete = new Set(state.selectedRecipients);
    if (toDelete.size === 0) return;

    if (!confirm(`Are you sure you want to remove ${toDelete.size} selected recipient(s)?`)) return;

    state.recipients = state.recipients.filter(h => !toDelete.has(h));
    state.selectedRecipients.clear();
    saveState();
    renderRecipientsTable();
    updateWorkerControls();
    updateUnverifiedCountUI();
    updateLivePreview();
    addLog('system', 'completed', `Removed ${toDelete.size} recipient(s).`);
  }

  function removeInvalidRecipients() {
    const beforeCount = state.recipients.length;
    state.recipients = state.recipients.filter(h => {
      const v = state.verifiedRecipients[h];
      return !(v && v.exists === false);
    });
    
    // Clean selection
    const validSet = new Set(state.recipients);
    state.selectedRecipients = new Set(Array.from(state.selectedRecipients).filter(h => validSet.has(h)));

    const removed = beforeCount - state.recipients.length;
    saveState();
    renderRecipientsTable();
    updateWorkerControls();
    updateUnverifiedCountUI();
    addLog('system', 'completed', `Removed ${removed} non-existent Instagram profile(s).`);
  }

  function deleteSingleRecipient(handle) {
    state.recipients = state.recipients.filter(h => h !== handle);
    state.selectedRecipients.delete(handle);
    saveState();
    renderRecipientsTable();
    updateWorkerControls();
    updateUnverifiedCountUI();
    updateLivePreview();
  }

  function toggleSelectRecipient(handle, isSelected) {
    if (isSelected) {
      state.selectedRecipients.add(handle);
    } else {
      state.selectedRecipients.delete(handle);
    }
    saveState();
    updateWorkerControls();
    updateFilterCounts();
    updateMasterCheckbox();
    updateLivePreview();

    // Toggle row class
    const row = document.getElementById(`row-${handle}`);
    if (row) row.classList.toggle('selected', isSelected);
  }

  function selectAllVisible() {
    const visibleHandles = getFilteredRecipients();
    visibleHandles.forEach(h => state.selectedRecipients.add(h));
    saveState();
    renderRecipientsTable();
    updateWorkerControls();
    updateLivePreview();
  }

  function deselectAll() {
    state.selectedRecipients.clear();
    saveState();
    renderRecipientsTable();
    updateWorkerControls();
    updateLivePreview();
  }

  function selectVerifiedOnly() {
    state.selectedRecipients.clear();
    state.recipients.forEach(h => {
      const v = state.verifiedRecipients[h];
      if (v && v.exists) {
        state.selectedRecipients.add(h);
      }
    });
    saveState();
    renderRecipientsTable();
    updateWorkerControls();
    updateLivePreview();
  }

  // Filter & Search logic
  function getFilteredRecipients() {
    const q = state.recipientSearchQuery.toLowerCase().trim();
    const f = state.recipientFilter;

    return state.recipients.filter(h => {
      const v = state.verifiedRecipients[h];
      
      // Filter status
      if (f === 'selected' && !state.selectedRecipients.has(h)) return false;
      if (f === 'verified' && (!v || !v.exists)) return false;
      if (f === 'unverified' && v) return false;
      if (f === 'invalid' && (!v || v.exists !== false)) return false;

      // Search match
      if (q) {
        const matchHandle = h.includes(q);
        const matchName = v?.fullName?.toLowerCase().includes(q);
        const matchId = String(v?.userId || '').includes(q);
        if (!matchHandle && !matchName && !matchId) return false;
      }

      return true;
    });
  }

  function renderRecipientsTable() {
    const visibleList = getFilteredRecipients();
    dom.recipientsTabBadge.textContent = state.recipients.length;
    updateFilterCounts();

    if (state.recipients.length === 0) {
      dom.recipientsEmptyState.classList.remove('hidden');
      dom.recipientsTableBody.innerHTML = '';
      dom.masterCheckbox.checked = false;
      return;
    }

    dom.recipientsEmptyState.classList.add('hidden');

    const html = visibleList.map(handle => {
      const isSelected = state.selectedRecipients.has(handle);
      const v = state.verifiedRecipients[handle];
      const rowStatus = state.rowStatuses[handle] || { status: 'pending' };

      // Verification badge
      let verifyBadgeHtml = `<span class="badge badge-idle text-xs">Unchecked</span>`;
      if (v) {
        if (v.exists) {
          verifyBadgeHtml = `<span class="badge badge-success text-xs"><span class="iconify" data-icon="ph:check-bold"></span> Verified</span>`;
        } else {
          verifyBadgeHtml = `<span class="badge badge-danger text-xs"><span class="iconify" data-icon="ph:x-bold"></span> 404 Missing</span>`;
        }
      }

      // Live Send Status Badge
      let statusBadgeHtml = `<span class="badge badge-neutral text-xs">Pending</span>`;
      if (rowStatus.status === 'sending') {
        statusBadgeHtml = `<span class="badge badge-running text-xs"><span class="iconify" data-icon="ph:spinner"></span> Sending...</span>`;
      } else if (rowStatus.status === 'sent') {
        const lat = rowStatus.latency ? `<span class="text-accent font-mono ml-1">(${rowStatus.latency})</span>` : '';
        statusBadgeHtml = `<span class="badge badge-success text-xs"><span class="iconify" data-icon="ph:check-circle-fill"></span> Sent${lat}</span>`;
      } else if (rowStatus.status === 'failed') {
        statusBadgeHtml = `<span class="badge badge-danger text-xs" title="${escapeHtml(rowStatus.details || 'Failed')}"><span class="iconify" data-icon="ph:warning-circle-fill"></span> Failed</span>`;
      }

      // Avatar
      const avatarHtml = v?.profilePic 
        ? `<img src="${escapeHtml(v.profilePic)}" alt="" />`
        : handle.charAt(0).toUpperCase();

      const fullName = v?.fullName ? escapeHtml(v.fullName) : '<span class="text-muted">—</span>';
      const userId = v?.userId ? `<code class="font-mono text-xs">${escapeHtml(v.userId)}</code>` : '<span class="text-muted">—</span>';

      return `
        <tr id="row-${handle}" class="${isSelected ? 'selected' : ''}">
          <td class="th-checkbox">
            <input type="checkbox" data-handle="${handle}" class="recipient-checkbox" ${isSelected ? 'checked' : ''} />
          </td>
          <td>
            <div class="user-cell">
              <div class="user-avatar-tiny">${avatarHtml}</div>
              <a href="https://instagram.com/${handle}" target="_blank" rel="noreferrer" class="user-handle-link">@${escapeHtml(handle)}</a>
            </div>
          </td>
          <td>${fullName}</td>
          <td>${userId}</td>
          <td>${verifyBadgeHtml}</td>
          <td>${statusBadgeHtml}</td>
          <td class="th-action">
            <button class="link-btn-sm text-muted delete-single-btn" data-handle="${handle}" title="Delete recipient">
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
    const visibleList = getFilteredRecipients();
    if (visibleList.length === 0) {
      dom.masterCheckbox.checked = false;
      dom.masterCheckbox.indeterminate = false;
      return;
    }

    const selectedVisibleCount = visibleList.filter(h => state.selectedRecipients.has(h)).length;
    if (selectedVisibleCount === visibleList.length) {
      dom.masterCheckbox.checked = true;
      dom.masterCheckbox.indeterminate = false;
    } else if (selectedVisibleCount > 0) {
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
      if (!v) {
        unverified++;
      } else if (v.exists) {
        verified++;
      } else {
        invalid++;
      }
    });

    dom.filterCountAll.textContent = total;
    dom.filterCountSelected.textContent = selected;
    dom.filterCountVerified.textContent = verified;
    dom.filterCountUnverified.textContent = unverified;
    dom.filterCountInvalid.textContent = invalid;

    if (invalid > 0) {
      dom.btnRemoveInvalid.classList.remove('hidden');
      dom.removeInvalidDivider.classList.remove('hidden');
      dom.invalidCountBadge.textContent = invalid;
    } else {
      dom.btnRemoveInvalid.classList.add('hidden');
      dom.removeInvalidDivider.classList.add('hidden');
    }
  }

  function updateUnverifiedCountUI() {
    const unverified = state.recipients.filter(h => !state.verifiedRecipients[h]);
    if (unverified.length > 0) {
      dom.btnVerifyLabel.textContent = `Verify IDs (${unverified.length})`;
      dom.btnVerifyUnchecked.disabled = false;
    } else {
      dom.btnVerifyLabel.textContent = `All IDs Cached`;
      dom.btnVerifyUnchecked.disabled = false;
    }
  }

  // ================= SMART UPFRONT VERIFICATION =================
  async function batchResolveUnverifiedRecipients() {
    if (!state.sessionId) {
      alert('Please connect your Instagram session cookie first.');
      dom.sessionDrawer.classList.remove('hidden');
      return;
    }

    // Filter ONLY recipients that haven't been verified yet!
    const unverified = state.recipients.filter(h => !state.verifiedRecipients[h]);
    if (unverified.length === 0) {
      alert('All recipient handles already have their Instagram numeric IDs pre-cached in memory!');
      return;
    }

    dom.btnVerifyUnchecked.disabled = true;
    dom.btnVerifyUnchecked.innerHTML = `<span class="iconify" data-icon="ph:spinner" data-width="13"></span> Verifying ${unverified.length}...`;
    addLog('system', 'running', `Verifying ${unverified.length} unverified handles with Instagram API...`);

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
          const key = r.username.toLowerCase();
          state.verifiedRecipients[key] = {
            exists: Boolean(r.exists),
            userId: r.userId || null,
            fullName: r.fullName || '',
            profilePic: r.profilePic || '',
            isPrivate: Boolean(r.isPrivate),
          };
          if (r.exists) valid++;
          else notFound++;
        });

        saveState();
        renderRecipientsTable();
        updateUnverifiedCountUI();
        addLog('system', 'completed', `Verification finished for ${unverified.length} handles: ${valid} found & cached, ${notFound} not found.`);
      } else {
        const err = data.error || 'Failed to verify recipients.';
        alert(`Verification failed: ${err}`);
        addLog('system', 'failed', `Recipient verification error: ${err}`);
      }
    } catch (err) {
      alert(`Network error during verification: ${err.message}`);
      addLog('system', 'failed', `Verification network error: ${err.message}`);
    } finally {
      dom.btnVerifyUnchecked.disabled = false;
      updateUnverifiedCountUI();
    }
  }

  // ================= CAMPAIGN EXECUTION ENGINE =================
  async function startCampaign() {
    if (!state.sessionId) {
      alert('Paste and verify your sessionid cookie first.');
      dom.sessionDrawer.classList.remove('hidden');
      return;
    }

    if (!state.messageText.trim()) {
      alert('Write a message before starting the campaign.');
      dom.messageTextarea.focus();
      return;
    }

    // Filter recipients to ONLY selected ones
    state.activeSelectedQueue = state.recipients.filter(h => state.selectedRecipients.has(h));
    if (state.activeSelectedQueue.length === 0) {
      alert('No recipients selected! Please check the boxes for the recipients you want to send to.');
      return;
    }

    const totalSelected = state.activeSelectedQueue.length;
    const workersCount = Math.min(state.parallelWorkers, totalSelected);
    const intervalSec = state.pacingInterval;

    state.campaignStatus = 'running';
    state.currentIndex = 0;
    state.sentCount = 0;
    state.failedCount = 0;
    state.rowStatuses = {};

    updateCampaignControlsUI();
    updateStatsUI();

    addLog('system', 'running', `Campaign started — Dispatching to ${totalSelected} selected recipients using ${workersCount} parallel workers (pacing: ${intervalSec}s).`);

    // Worker dispatcher loop
    const workerPromises = [];
    for (let i = 0; i < workersCount; i++) {
      workerPromises.push(campaignWorker(i + 1, intervalSec));
    }

    await Promise.all(workerPromises);

    if (state.campaignStatus === 'running') {
      finishCampaign();
    }
  }

  async function campaignWorker(workerId, intervalSec) {
    while (state.campaignStatus === 'running' && state.currentIndex < state.activeSelectedQueue.length) {
      const idx = state.currentIndex++;
      const username = state.activeSelectedQueue[idx];
      const targetNum = idx + 1;
      const totalNum = state.activeSelectedQueue.length;

      dom.currentWorkerActivity.textContent = `Worker #${workerId}: Sending to @${username} (${targetNum}/${totalNum})`;

      // Mark row as sending
      state.rowStatuses[username] = { status: 'sending' };
      renderRecipientsTable();

      const personalizedMessage = state.messageText
        .replace(/\{\{\s*username\s*\}\}/gi, username)
        .replace(/\{\{\s*handle\s*\}\}/gi, `@${username}`);

      // Dispatch and measure latency
      const startTime = performance.now();
      const sendResult = await sendOneDM(username, personalizedMessage);
      const elapsedMs = Math.round(performance.now() - startTime);
      const latencyStr = elapsedMs < 1000 ? `${elapsedMs}ms` : `${(elapsedMs / 1000).toFixed(2)}s`;

      if (sendResult.success) {
        state.sentCount++;
        state.rowStatuses[username] = { status: 'sent', latency: latencyStr, details: sendResult.details };
        addLog(username, 'sent', sendResult.details, latencyStr);
      } else {
        state.failedCount++;
        state.rowStatuses[username] = { status: 'failed', latency: latencyStr, details: sendResult.details };
        addLog(username, 'failed', sendResult.details, latencyStr);
      }

      updateStatsUI();
      renderRecipientsTable();

      // Pacing interval
      if (intervalSec > 0 && state.campaignStatus === 'running' && state.currentIndex < state.activeSelectedQueue.length) {
        dom.currentWorkerActivity.textContent = `Worker #${workerId}: Pacing ${intervalSec}s...`;
        await sleep(intervalSec * 1000);
      }
    }
  }

  async function sendOneDM(username, text) {
    try {
      const cached = state.verifiedRecipients[username];
      const recipientUserId = (cached && cached.exists && cached.userId) ? cached.userId : null;

      const payload = {
        sessionid: state.sessionId,
        recipient: username,
        text,
      };

      if (recipientUserId) {
        payload.recipientUserId = recipientUserId;
      }

      const res = await fetch('/api/send-dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.ok) {
        const threadId = data.meta?.threadId || data.body?.thread_id || 'active';
        return { success: true, details: `Delivered to @${username} (thread: ${threadId})` };
      }

      const igBody = data.body || {};
      let reason = igBody.message || igBody.errorSummary || igBody.error_title || '';
      if (!reason && igBody.error) reason = igBody.error;
      if (!reason && data.error) reason = data.error;
      if (!reason) reason = `HTTP ${data.status || 'unknown'}`;

      return { success: false, details: reason };
    } catch (err) {
      return { success: false, details: `Network error: ${err.message}` };
    }
  }

  function pauseCampaign() {
    state.campaignStatus = 'paused';
    addLog('system', 'paused', 'Campaign paused by user.');
    updateCampaignControlsUI();
  }

  function resumeCampaign() {
    state.campaignStatus = 'running';
    addLog('system', 'running', 'Campaign resumed.');
    updateCampaignControlsUI();
    const workersCount = Math.min(state.parallelWorkers, state.activeSelectedQueue.length);
    const workerPromises = [];
    for (let i = 0; i < workersCount; i++) {
      workerPromises.push(campaignWorker(i + 1, state.pacingInterval));
    }
    Promise.all(workerPromises).then(() => {
      if (state.campaignStatus === 'running') finishCampaign();
    });
  }

  function stopCampaign() {
    state.campaignStatus = 'stopped';
    addLog('system', 'stopped', `Campaign stopped. Dispatched to ${state.sentCount + state.failedCount} recipients.`);
    updateCampaignControlsUI();
    dom.currentWorkerActivity.textContent = 'Campaign terminated';
  }

  function finishCampaign() {
    state.campaignStatus = 'completed';
    addLog('system', 'completed', `Campaign completed! Successfully sent: ${state.sentCount}, Failed: ${state.failedCount}.`);
    updateCampaignControlsUI();
    dom.currentWorkerActivity.textContent = `Completed (${state.sentCount} sent, ${state.failedCount} failed)`;
  }

  function updateCampaignControlsUI() {
    const s = state.campaignStatus;
    const pill = dom.campaignStatusPill;
    pill.className = `badge badge-${s === 'running' ? 'running' : s === 'paused' ? 'warning' : s === 'completed' ? 'success' : 'neutral'}`;
    pill.textContent = s.charAt(0).toUpperCase() + s.slice(1);

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
    const total = state.activeSelectedQueue.length > 0 ? state.activeSelectedQueue.length : state.selectedRecipients.size;
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

  // ================= BEAUTIFIED ACTIVITY LOGS =================
  function addLog(handle, status, details, latency = null) {
    const ts = new Date();
    const timeStr = ts.toTimeString().split(' ')[0] + '.' + String(ts.getMilliseconds()).padStart(3, '0');

    const entry = {
      id: Date.now() + Math.random(),
      time: timeStr,
      handle,
      status, // 'sent' | 'failed' | 'running' | 'completed' | 'paused' | 'stopped'
      details,
      latency,
    };

    state.logs.unshift(entry);
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
        const matchHandle = l.handle.toLowerCase().includes(q);
        const matchDetails = l.details.toLowerCase().includes(q);
        const matchStatus = l.status.toLowerCase().includes(q);
        if (!matchHandle && !matchDetails && !matchStatus) return false;
      }

      return true;
    });
  }

  function renderLogs() {
    dom.logsTabBadge.textContent = state.logs.length;
    updateLogFilterCounts();

    const filtered = getFilteredLogs();
    if (filtered.length === 0) {
      dom.logsFeedContainer.innerHTML = `
        <div class="table-empty-state">
          <span class="iconify empty-icon" data-icon="ph:clipboard-text-duotone" data-width="32"></span>
          <p class="empty-title">No activity logged</p>
          <p class="empty-desc">Events, dispatches, and verification traces will appear here.</p>
        </div>
      `;
      return;
    }

    const html = filtered.map(l => {
      const isSystem = l.handle === 'system';
      const handleDisplay = isSystem ? 'System Engine' : `@${escapeHtml(l.handle)}`;
      const latencyBadge = l.latency ? `<span class="log-latency">⚡ ${l.latency}</span>` : '';

      return `
        <div class="log-entry-card">
          <span class="log-timestamp font-mono">${l.time}</span>
          <span class="log-status-pill ${l.status}">${l.status}</span>
          <div class="log-content-col">
            <div class="log-target-line">
              <span class="log-handle">${handleDisplay}</span>
              ${latencyBadge}
            </div>
            <div class="log-message-details">${escapeHtml(l.details)}</div>
          </div>
        </div>
      `;
    }).join('');

    dom.logsFeedContainer.innerHTML = html;
  }

  function updateLogFilterCounts() {
    let sent = 0;
    let failed = 0;
    let system = 0;

    state.logs.forEach(l => {
      if (l.status === 'sent') sent++;
      else if (l.status === 'failed') failed++;
      if (l.handle === 'system') system++;
    });

    dom.logFilterAll.textContent = state.logs.length;
    dom.logFilterSent.textContent = sent;
    dom.logFilterFailed.textContent = failed;
    dom.logFilterSystem.textContent = system;
  }

  // ================= VIEW SWITCHING =================
  function switchView(viewId) {
    state.activeTab = viewId;
    if (viewId === 'recipientsView') {
      dom.tabRecipientsBtn.classList.add('active');
      dom.tabLogsBtn.classList.remove('active');
      dom.recipientsView.classList.remove('hidden');
      dom.logsView.classList.add('hidden');
      dom.recipientsHeaderActions.classList.remove('hidden');
      dom.logsHeaderActions.classList.add('hidden');
      renderRecipientsTable();
    } else {
      dom.tabRecipientsBtn.classList.remove('active');
      dom.tabLogsBtn.classList.add('active');
      dom.recipientsView.classList.add('hidden');
      dom.logsView.classList.remove('hidden');
      dom.recipientsHeaderActions.classList.add('hidden');
      dom.logsHeaderActions.classList.remove('hidden');
      renderLogs();
    }
  }

  // ================= BACKUP IMPORT / EXPORT =================
  function exportBackup() {
    const payload = {
      exportedAt: new Date().toISOString(),
      recipients: state.recipients,
      selectedRecipients: Array.from(state.selectedRecipients),
      verifiedRecipients: state.verifiedRecipients,
      messageText: state.messageText,
      parallelWorkers: state.parallelWorkers,
      pacingInterval: state.pacingInterval,
      senderInfo: state.senderInfo ? { username: state.senderInfo.username, id: state.senderInfo.id } : null,
      logs: state.logs.slice(0, 50),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `instadm-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a);
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.recipients && Array.isArray(data.recipients)) {
          state.recipients = data.recipients;
        }
        if (data.selectedRecipients && Array.isArray(data.selectedRecipients)) {
          state.selectedRecipients = new Set(data.selectedRecipients);
        } else {
          state.selectedRecipients = new Set(state.recipients);
        }
        if (data.verifiedRecipients) {
          state.verifiedRecipients = { ...state.verifiedRecipients, ...data.verifiedRecipients };
        }
        if (data.messageText) {
          state.messageText = data.messageText;
          dom.messageTextarea.value = data.messageText;
        }
        saveState();
        renderRecipientsTable();
        updateWorkerControls();
        updateMessageUI();
        alert('Backup data successfully imported!');
      } catch (err) {
        alert('Invalid JSON backup file: ' + err.message);
      }
    };
    reader.readAsText(file);
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
    // Session Drawer
    dom.btnOpenSessionModal.addEventListener('click', () => {
      dom.sessionDrawer.classList.toggle('hidden');
    });
    dom.btnToggleSessionDrawer.addEventListener('click', () => {
      dom.sessionDrawer.classList.toggle('hidden');
    });
    dom.btnCloseSessionDrawer.addEventListener('click', () => {
      dom.sessionDrawer.classList.add('hidden');
    });
    dom.btnSaveSession.addEventListener('click', verifySession);
    dom.toggleSessionVisibility.addEventListener('click', () => {
      const inp = dom.sessionIdInput;
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    // Message Composer
    dom.messageTextarea.addEventListener('input', updateMessageUI);
    dom.btnInsertUsername.addEventListener('click', () => {
      const pos = dom.messageTextarea.selectionStart;
      const text = dom.messageTextarea.value;
      dom.messageTextarea.value = text.substring(0, pos) + '{{username}}' + text.substring(pos);
      updateMessageUI();
      dom.messageTextarea.focus();
    });
    dom.btnTogglePreview.addEventListener('click', () => {
      dom.livePreviewBox.classList.toggle('hidden');
    });

    // Workers & Concurrency
    dom.parallelWorkersSlider.addEventListener('input', e => {
      setWorkers(Number(e.target.value));
    });
    dom.parallelWorkersInput.addEventListener('change', e => {
      setWorkers(Number(e.target.value));
    });
    document.querySelectorAll('.preset-chip[data-workers]').forEach(chip => {
      chip.addEventListener('click', () => {
        setWorkers(Number(chip.dataset.workers));
      });
    });
    dom.btnSetWorkersMax.addEventListener('click', () => {
      setWorkers(state.selectedRecipients.size || 20);
    });
    dom.pacingIntervalInput.addEventListener('change', e => {
      state.pacingInterval = Math.max(0, Number(e.target.value) || 0);
      saveState();
    });

    // Campaign CTAs
    dom.btnStartCampaign.addEventListener('click', startCampaign);
    dom.btnPauseCampaign.addEventListener('click', pauseCampaign);
    dom.btnResumeCampaign.addEventListener('click', resumeCampaign);
    dom.btnStopCampaign.addEventListener('click', stopCampaign);

    // View Switching
    dom.tabRecipientsBtn.addEventListener('click', () => switchView('recipientsView'));
    dom.tabLogsBtn.addEventListener('click', () => switchView('logsView'));

    // Verification
    dom.btnVerifyUnchecked.addEventListener('click', batchResolveUnverifiedRecipients);

    // Recipient Filtering & Search
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

    // Bulk selection buttons
    dom.masterCheckbox.addEventListener('change', e => {
      if (e.target.checked) selectAllVisible();
      else deselectAll();
    });
    dom.btnSelectAll.addEventListener('click', selectAllVisible);
    dom.btnDeselectAll.addEventListener('click', deselectAll);
    dom.btnSelectVerified.addEventListener('click', selectVerifiedOnly);
    dom.btnDeleteSelected.addEventListener('click', deleteSelectedRecipients);
    dom.btnRemoveInvalid.addEventListener('click', removeInvalidRecipients);

    // Table Event Delegation (checkboxes & delete)
    dom.recipientsTableBody.addEventListener('change', e => {
      if (e.target.classList.contains('recipient-checkbox')) {
        const handle = e.target.dataset.handle;
        toggleSelectRecipient(handle, e.target.checked);
      }
    });
    dom.recipientsTableBody.addEventListener('click', e => {
      const btn = e.target.closest('.delete-single-btn');
      if (btn) {
        deleteSingleRecipient(btn.dataset.handle);
      }
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
      dom.importParsedCount.textContent = lines.length;
    });
    dom.importFileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      dom.importFileLabel.textContent = file.name;
      const reader = new FileReader();
      reader.onload = ev => {
        dom.importTextarea.value = ev.target.result;
        const lines = ev.target.result.split('\n').filter(l => l.trim().length > 0);
        dom.importParsedCount.textContent = lines.length;
      };
      reader.readAsText(file);
    });
    dom.btnConfirmAddRecipients.addEventListener('click', () => {
      const lines = dom.importTextarea.value.split('\n');
      const count = addRecipients(lines);
      dom.importTextarea.value = '';
      dom.importFileLabel.textContent = 'No file chosen';
      dom.importParsedCount.textContent = '0';
      dom.addRecipientsModal.classList.add('hidden');
    });

    // Logs Events
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
      if (confirm('Clear all activity logs?')) {
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
      a.download = `instadm-activity-logs-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(a);
    });

    // Backup Export / Import
    dom.btnExportBackup.addEventListener('click', exportBackup);
    dom.btnImportBackupTrigger.addEventListener('click', () => dom.backupFileInput.click());
    dom.backupFileInput.addEventListener('change', e => {
      if (e.target.files[0]) importBackup(e.target.files[0]);
    });
  }

  // ================= INITIALIZATION =================
  function init() {
    cacheDom();
    loadPersistedState();
    bindEvents();

    // Populate initial inputs
    dom.messageTextarea.value = state.messageText;
    dom.pacingIntervalInput.value = state.pacingInterval;

    updateSenderUI();
    updateMessageUI();
    renderRecipientsTable();
    updateWorkerControls();
    updateUnverifiedCountUI();
    renderLogs();
    updateStatsUI();

    // Browser status polling
    pollBrowserStatus();
    setInterval(pollBrowserStatus, 3000);
  }

  // Boot on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
