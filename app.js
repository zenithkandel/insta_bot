/**
 * DM Outreach Manager — Frontend SPA
 *
 * Tabs: Campaign, Recipients, Schedule, Activity, Settings, Docs
 * Backend: Node.js server.js -> Python Selenium (headless Chrome)
 */

(() => {
  'use strict';

  // ================= STORAGE KEYS =================
  const K = {
    SESSION_ID: 'insta_session_id',
    CSRF_TOKEN: 'insta_csrf_token',
    RECIPIENTS: 'insta_recipients',
    MESSAGE: 'insta_message',
    SCHEDULE: 'insta_schedule',
    LOGS: 'insta_logs',
    STATS: 'insta_stats',
    ACTIVE_TAB: 'insta_active_tab',
    PARALLEL: 'insta_parallel',
    RETRIES: 'insta_retries',
    SENDER_INFO: 'insta_sender_info',
    TOKENS: 'insta_tokens',
    VERIFIED_RECIPIENTS: 'insta_verified_recipients',
  };

  // ================= STATE =================
  const state = {
    sessionId: '',
    csrfToken: '',
    senderInfo: null,
    tokens: null,
    verifiedRecipients: {},
    recipients: [],
    rawRecipientsText: '',
    messageText: '',
    schedule: {
      startTime: '',
      deadline: '',
      pacingInterval: 0,
      maxVolume: 50,
      parallelWorkers: 3,
      retryAttempts: 2,
    },
    campaignStatus: 'idle',
    currentIndex: 0,
    sentCount: 0,
    failedCount: 0,
    stats: { total: 0, sent: 0, failed: 0, remaining: 0 },
    logs: [],
    activeTab: 'campaign',
    isDispatching: false,
    parallelQueue: [],
    activeWorkers: 0,
  };

  // ================= DOM =================
  const $ = id => document.getElementById(id);
  const dom = {};

  function cacheDom() {
    [
      'sessionIdInput', 'csrfTokenInput', 'toggleSessionVisibility', 'toggleCsrfVisibility',
      'btnSaveSession', 'sidebarSessionCard', 'sidebarStatusDot', 'sidebarStatusText',
      'sidebarSessionBtn', 'topbarStatusDot', 'topbarStatusText',
      'senderInfoCard', 'senderUsernameDisplay', 'senderUserIdDisplay',
      'tokenFbDtsgStatus', 'tokenCsrfStatus', 'tokenLsdStatus',
      'sessionErrorBanner', 'sessionErrorText',
      'recipientsTextarea', 'recipientsTextareaFull', 'recipientCountBadge',
      'recipientsFileInput', 'recipientsFileFull', 'btnDedupRecipients', 'btnClearRecipients',
      'btnDedupeFull', 'btnClearFull', 'btnImportFull',
      'btnVerifyRecipients', 'btnVerifyFull',
      'recipientsVerificationBox', 'verifiedRecipientsList', 'verifiedSummaryPill', 'btnRemoveInvalidRecipients',
      'recipientsFullVerificationBox', 'verifiedRecipientsListFull', 'verifiedSummaryPillFull', 'btnRemoveInvalidFull',
      'summaryTotal', 'summaryValid', 'summaryInvalid', 'summaryDups', 'dedupNotice',
      'messageTextarea', 'btnInsertVariable', 'charCountBadge', 'livePreviewBox',
      'startTimeInput', 'deadlineInput', 'pacingIntervalInput', 'maxVolumeInput',
      'pacingIntervalSchedule', 'maxVolumeSchedule', 'parallelWorkersSchedule',
      'retryAttemptsSchedule', 'parallelWorkersInput', 'retryAttemptsInput',
      'feasibilityCard', 'feasibilityTitle', 'feasibilityDesc', 'btnFixDeadline',
      'feasibilityCardSchedule', 'feasibilityTitleSchedule', 'feasibilityDescSchedule',
      'adapterSelect', 'btnStartCampaign', 'btnPauseCampaign', 'btnResumeCampaign',
      'btnStopCampaign', 'campaignStatusPill', 'campaignStatusText',
      'currentRecipientBadge', 'progressPercentageText', 'progressFill',
      'statTotal', 'statSent', 'statFailed', 'statRemaining',
      'logsTableBody', 'logsContainer', 'btnClearLogs', 'btnClearLogsFull', 'btnExportLogs',
      'btnExportBackup', 'backupFileInput', 'btnResetApp',
      'settingsParallel', 'settingsRetry',
      'mobileMenuBtn', 'sidebar', 'sidebarOverlay', 'pageTitle',
    ].forEach(id => { dom[id] = $(id); });

    // Tab nav items
    dom.navItems = Array.from(document.querySelectorAll('.nav-item'));
    dom.tabContents = Array.from(document.querySelectorAll('.tab-content'));
  }

  // ================= INIT =================
  function init() {
    cacheDom();
    loadState();
    bindEvents();
    switchTab(state.activeTab || 'campaign');
    renderAll();
  }

  // ================= STATE PERSISTENCE =================
  function loadState() {
    state.sessionId = localStorage.getItem(K.SESSION_ID) || '';
    state.csrfToken = localStorage.getItem(K.CSRF_TOKEN) || '';
    state.rawRecipientsText = localStorage.getItem(K.RECIPIENTS) || 'alex_designer\nstudio.flux\ncreative_labs\nmotion_artist';
    state.messageText = localStorage.getItem(K.MESSAGE) || 'Hi @{{username}}, loved your recent visual work! Would love to invite you to test our new creative platform.';
    state.activeTab = localStorage.getItem(K.ACTIVE_TAB) || 'campaign';
    state.schedule.parallelWorkers = parseInt(localStorage.getItem(K.PARALLEL) || '3');
    state.schedule.retryAttempts = parseInt(localStorage.getItem(K.RETRIES) || '2');

    const savedSchedule = localStorage.getItem(K.SCHEDULE);
    if (savedSchedule) {
      try { Object.assign(state.schedule, JSON.parse(savedSchedule)); } catch {}
    }

    const savedStats = localStorage.getItem(K.STATS);
    if (savedStats) { try { Object.assign(state.stats, JSON.parse(savedStats)); } catch {} }

    const savedLogs = localStorage.getItem(K.LOGS);
    if (savedLogs) { try { state.logs = JSON.parse(savedLogs); } catch { state.logs = []; } }

    const savedSender = localStorage.getItem(K.SENDER_INFO);
    if (savedSender) { try { state.senderInfo = JSON.parse(savedSender); } catch {} }

    const savedTokens = localStorage.getItem(K.TOKENS);
    if (savedTokens) { try { state.tokens = JSON.parse(savedTokens); } catch {} }

    const savedVerified = localStorage.getItem(K.VERIFIED_RECIPIENTS);
    if (savedVerified) { try { state.verifiedRecipients = JSON.parse(savedVerified); } catch {} }

    // Populate form fields
    dom.sessionIdInput.value = state.sessionId;
    dom.csrfTokenInput.value = state.csrfToken;
    dom.recipientsTextarea.value = state.rawRecipientsText;
    dom.recipientsTextareaFull.value = state.rawRecipientsText;
    dom.messageTextarea.value = state.messageText;
    dom.parallelWorkersInput.value = state.schedule.parallelWorkers;
    dom.retryAttemptsInput.value = state.schedule.retryAttempts;
    dom.parallelWorkersSchedule.value = state.schedule.parallelWorkers;
    dom.retryAttemptsSchedule.value = state.schedule.retryAttempts;
    dom.settingsParallel.value = state.schedule.parallelWorkers;
    dom.settingsRetry.value = state.schedule.retryAttempts;

    processRecipients(state.rawRecipientsText, false);
    updateSessionUI();
    renderVerifiedRecipientsList();
  }

  function save() {
    localStorage.setItem(K.SESSION_ID, state.sessionId);
    localStorage.setItem(K.CSRF_TOKEN, state.csrfToken);
    localStorage.setItem(K.RECIPIENTS, state.rawRecipientsText);
    localStorage.setItem(K.MESSAGE, state.messageText);
    localStorage.setItem(K.ACTIVE_TAB, state.activeTab);
    localStorage.setItem(K.SCHEDULE, JSON.stringify(state.schedule));
    localStorage.setItem(K.LOGS, JSON.stringify(state.logs.slice(0, 100)));
    localStorage.setItem(K.STATS, JSON.stringify(state.stats));
    localStorage.setItem(K.PARALLEL, String(state.schedule.parallelWorkers));
    localStorage.setItem(K.RETRIES, String(state.schedule.retryAttempts));

    if (state.senderInfo) localStorage.setItem(K.SENDER_INFO, JSON.stringify(state.senderInfo));
    else localStorage.removeItem(K.SENDER_INFO);

    if (state.tokens) localStorage.setItem(K.TOKENS, JSON.stringify(state.tokens));
    else localStorage.removeItem(K.TOKENS);

    if (state.verifiedRecipients) localStorage.setItem(K.VERIFIED_RECIPIENTS, JSON.stringify(state.verifiedRecipients));
  }

  // ================= TAB SWITCHING =================
  function switchTab(tabName) {
    state.activeTab = tabName;
    save();

    dom.navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.tab === tabName);
    });
    dom.tabContents.forEach(content => {
      content.classList.toggle('active', content.id === `tab-${tabName}`);
    });

    const titles = {
      campaign: 'Campaign',
      recipients: 'Recipients',
      schedule: 'Schedule',
      logs: 'Activity',
      settings: 'Settings',
      docs: 'Documentation',
    };
    dom.pageTitle.textContent = titles[tabName] || 'Campaign';

    // Close mobile sidebar
    closeMobileSidebar();
  }

  // ================= RECIPIENT PROCESSING =================
  const USERNAME_RE = /^[a-zA-Z0-9._]{1,30}$/;

  function validateUsername(handle) {
    if (!handle) return false;
    const clean = handle.replace(/^@/, '').trim();
    if (!clean || clean.length > 30) return false;
    if (/\s/.test(clean) || clean.includes('..')) return false;
    if (clean.startsWith('.') || clean.endsWith('.')) return false;
    return USERNAME_RE.test(clean);
  }

  function processRecipients(rawText, updateFields = true) {
    state.rawRecipientsText = rawText;
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const seen = new Set();
    const clean = [];
    let dups = 0, invalid = 0;

    for (const line of lines) {
      let candidate = line;
      if (candidate.includes(',')) {
        const parts = candidate.split(',').map(p => p.replace(/^["']|["']$/g, '').trim());
        if (['username', 'handle', 'recipient', 'user'].includes(parts[0].toLowerCase())) continue;
        candidate = parts[0];
      }
      const c = candidate.replace(/^@/, '').trim();
      if (!validateUsername(c)) { invalid++; continue; }
      const lower = c.toLowerCase();
      if (seen.has(lower)) { dups++; }
      else { seen.add(lower); clean.push(c); }
    }

    state.recipients = clean;

    if (updateFields) {
      dom.recipientsTextarea.value = clean.join('\n');
      dom.recipientsTextareaFull.value = clean.join('\n');
      state.rawRecipientsText = clean.join('\n');
      save();
    }

    dom.recipientCountBadge.textContent = String(clean.length);
    if (dups > 0) dom.dedupNotice.textContent = `Removed ${dups} duplicate${dups === 1 ? '' : 's'}`;
    else if (invalid > 0) dom.dedupNotice.textContent = `Ignored ${invalid} invalid`;
    else dom.dedupNotice.textContent = '';

    // Summary
    dom.summaryTotal.textContent = lines.length;
    dom.summaryValid.textContent = clean.length;
    dom.summaryInvalid.textContent = invalid;
    dom.summaryDups.textContent = dups;

    if (state.campaignStatus === 'idle') {
      state.stats.total = clean.length;
      state.stats.remaining = clean.length;
      updateStatsUI();
    }

    evaluateFeasibility();
  }

  // ================= MESSAGE PREVIEW =================
  function updateMessagePreview() {
    const text = state.messageText || '';
    dom.charCountBadge.textContent = `${text.length} chars`;
    const sample = state.recipients.length > 0 ? state.recipients[0] : 'alex_creator';
    const rendered = text
      .replace(/\{\{\s*username\s*\}\}/gi, sample)
      .replace(/\{\{\s*handle\s*\}\}/gi, `@${sample}`);
    dom.livePreviewBox.textContent = rendered || 'Type a message to see preview...';
  }

  // ================= SESSION UI & SENDER VERIFICATION =================
  function updateSessionUI() {
    const hasSession = Boolean(state.sessionId && state.sessionId.trim().length > 5);
    const hasCsrf = Boolean(state.csrfToken && state.csrfToken.trim().length > 5);
    const isVerified = Boolean(state.senderInfo && (state.senderInfo.username || state.senderInfo.userId));

    if (isVerified) {
      const uname = state.senderInfo.username || 'user';
      const uid = state.senderInfo.userId || state.senderInfo.ds_user_id || 'Verified';
      dom.sidebarStatusDot.className = 'status-dot active';
      dom.sidebarStatusText.textContent = `@${uname}`;
      dom.topbarStatusDot.className = 'status-dot active';
      dom.topbarStatusText.textContent = `@${uname} (Verified)`;

      if (dom.senderInfoCard) {
        dom.senderUsernameDisplay.textContent = `@${uname}`;
        dom.senderUserIdDisplay.textContent = `(ID: ${uid})`;
        dom.tokenFbDtsgStatus.textContent = state.tokens?.fb_dtsg ? 'fb_dtsg: ready' : 'fb_dtsg: cached';
        dom.tokenCsrfStatus.textContent = state.tokens?.csrftoken ? 'csrftoken: ready' : 'csrftoken: cached';
        dom.tokenLsdStatus.textContent = state.tokens?.lsd ? 'lsd: ready' : 'lsd: cached';
        show(dom.senderInfoCard);
      }
      hide(dom.sessionErrorBanner);
    } else if (hasSession && hasCsrf) {
      dom.sidebarStatusDot.className = 'status-dot active';
      dom.sidebarStatusText.textContent = 'Session Set';
      dom.topbarStatusDot.className = 'status-dot active';
      dom.topbarStatusText.textContent = 'Ready (Unverified)';
      hide(dom.senderInfoCard);
    } else if (hasSession && !hasCsrf) {
      dom.sidebarStatusDot.className = 'status-dot inactive';
      dom.sidebarStatusText.textContent = 'CSRF Missing';
      dom.topbarStatusDot.className = 'status-dot inactive';
      dom.topbarStatusText.textContent = 'CSRF Missing';
      hide(dom.senderInfoCard);
    } else {
      dom.sidebarStatusDot.className = 'status-dot';
      dom.sidebarStatusText.textContent = 'No Session';
      dom.topbarStatusDot.className = 'status-dot';
      dom.topbarStatusText.textContent = 'No Session';
      hide(dom.senderInfoCard);
    }
  }

  async function verifySession() {
    const sessionId = dom.sessionIdInput.value.trim();
    const csrfToken = dom.csrfTokenInput.value.trim();

    if (!sessionId) {
      alert('Please enter a sessionid cookie value first.');
      return;
    }

    dom.btnSaveSession.disabled = true;
    dom.btnSaveSession.innerHTML = `<span class="iconify" data-icon="ph:spinner-gap-bold" data-width="14" style="animation:spin 1s linear infinite"></span> Verifying...`;
    hide(dom.sessionErrorBanner);

    try {
      const res = await fetch('/api/verify-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionid: sessionId, csrftoken: csrfToken }),
      });

      const data = await res.json();

      if (data.ok || data.valid || (data.sender && (data.sender.username || data.sender.userId))) {
        state.sessionId = sessionId;
        state.csrfToken = csrfToken;
        state.senderInfo = {
          username: (data.sender && data.sender.username) || sessionId.split(':')[0] || 'User',
          userId: (data.sender && data.sender.userId) || sessionId.split(':')[0] || '',
          fullName: (data.sender && data.sender.fullName) || '',
          profilePic: (data.sender && data.sender.profilePic) || '',
          authenticated: true,
        };
        state.tokens = data.tokens || {};
        save();
        updateSessionUI();
        addLog('system', 'verified', `Sender verified: Logged in as @${state.senderInfo.username} (ID: ${state.senderInfo.userId}). Tokens pre-cached.`);
      } else {
        const err = data.error || data.reason || (data.sender && data.sender.error) || 'Invalid session. Please check your cookies.';
        dom.sessionErrorText.textContent = `Verification failed: ${err}`;
        show(dom.sessionErrorBanner);
        hide(dom.senderInfoCard);
        state.senderInfo = null;
        state.tokens = null;
        save();
        updateSessionUI();
        addLog('system', 'failed', `Session verification failed: ${err}`);
      }
    } catch (err) {
      dom.sessionErrorText.textContent = `Network error: ${err.message}`;
      show(dom.sessionErrorBanner);
      hide(dom.senderInfoCard);
      addLog('system', 'failed', `Session verification network error: ${err.message}`);
    } finally {
      dom.btnSaveSession.disabled = false;
      dom.btnSaveSession.innerHTML = `<span class="iconify" data-icon="ph:check-circle-fill" data-width="14"></span> Save & Verify`;
    }
  }

  // ================= RECIPIENT VERIFICATION & PRE-CACHING =================
  async function batchResolveRecipients() {
    if (!state.recipients || state.recipients.length === 0) {
      alert('Please add at least one recipient first.');
      return;
    }
    if (!state.sessionId) {
      alert('Please enter and save your Instagram session first.');
      return;
    }

    // Only verify recipients who haven't already been checked!
    const unverified = state.recipients.filter(h => {
      const v = state.verifiedRecipients[h.toLowerCase()];
      return !v || v.exists === undefined;
    });

    if (unverified.length === 0) {
      renderVerifiedRecipientsList();
      addLog('system', 'completed', `All ${state.recipients.length} recipients are already verified and cached.`);
      return;
    }

    const alreadyVerifiedCount = state.recipients.length - unverified.length;

    const buttons = [dom.btnVerifyRecipients, dom.btnVerifyFull].filter(Boolean);
    buttons.forEach(b => {
      b.disabled = true;
      b.innerHTML = `<span class="iconify" data-icon="ph:spinner-gap-bold" data-width="13" style="animation:spin 1s linear infinite"></span> Verifying (${unverified.length})...`;
    });

    show(dom.recipientsVerificationBox);
    show(dom.recipientsFullVerificationBox);

    const statusMsg = alreadyVerifiedCount > 0
      ? `Verifying ${unverified.length} new profile(s)... (${alreadyVerifiedCount} already cached)`
      : `Verifying ${unverified.length} profiles and pre-fetching IDs...`;

    if (dom.verifiedRecipientsList) {
      dom.verifiedRecipientsList.innerHTML = `<div class="p-3 text-xs text-zinc-500 flex items-center gap-2"><span class="iconify text-primary" data-icon="ph:spinner-gap-bold" data-width="14" style="animation:spin 1s linear infinite"></span> ${statusMsg}</div>`;
    }
    if (dom.verifiedRecipientsListFull) {
      dom.verifiedRecipientsListFull.innerHTML = `<div class="p-3 text-xs text-zinc-500 flex items-center gap-2"><span class="iconify text-primary" data-icon="ph:spinner-gap-bold" data-width="14" style="animation:spin 1s linear infinite"></span> ${statusMsg}</div>`;
    }

    addLog('system', 'running', `Verifying ${unverified.length} new recipient(s) on Instagram (${alreadyVerifiedCount} skipped as already verified)...`);

    try {
      const res = await fetch('/api/resolve-recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionid: state.sessionId,
          csrftoken: state.csrfToken,
          usernames: unverified,
        }),
      });

      const data = await res.json();
      if (data.ok && Array.isArray(data.results)) {
        data.results.forEach(item => {
          state.verifiedRecipients[item.username.toLowerCase()] = {
            username: item.username,
            exists: !!item.exists,
            userId: item.userId || null,
            isPrivate: !!item.isPrivate,
            fullName: item.fullName || '',
            profilePic: item.profilePic || '',
            checkedAt: Date.now(),
          };
        });

        save();
        renderVerifiedRecipientsList();

        const newValid = data.results.filter(r => r.exists).length;
        const newInvalid = data.results.filter(r => !r.exists).length;
        addLog('system', 'completed', `Verified ${unverified.length} new recipient(s): ${newValid} valid, ${newInvalid} not found (${alreadyVerifiedCount} kept from cache).`);
      } else {
        const err = data.error || 'Failed to verify recipients.';
        alert(`Verification error: ${err}`);
        addLog('system', 'failed', `Recipient verification failed: ${err}`);
      }
    } catch (err) {
      alert(`Network error: ${err.message}`);
      addLog('system', 'failed', `Recipient verification network error: ${err.message}`);
    } finally {
      buttons.forEach(b => {
        b.disabled = false;
        b.innerHTML = `<span class="iconify" data-icon="ph:magnifying-glass-bold" data-width="13"></span> Verify & Pre-fetch IDs`;
      });
      if (dom.btnVerifyFull) {
        dom.btnVerifyFull.innerHTML = `<span class="iconify" data-icon="ph:magnifying-glass-bold" data-width="14"></span> Verify IDs`;
      }
    }
  }

  function renderVerifiedRecipientsList() {
    const list = state.recipients || [];
    if (list.length === 0) {
      hide(dom.recipientsVerificationBox);
      hide(dom.recipientsFullVerificationBox);
      return;
    }

    const hasAnyVerified = list.some(h => state.verifiedRecipients[h.toLowerCase()]);
    if (!hasAnyVerified) {
      hide(dom.recipientsVerificationBox);
      hide(dom.recipientsFullVerificationBox);
      return;
    }

    show(dom.recipientsVerificationBox);
    show(dom.recipientsFullVerificationBox);

    let validCount = 0;
    let invalidCount = 0;

    const html = list.map(handle => {
      const v = state.verifiedRecipients[handle.toLowerCase()];
      if (!v) {
        return `
          <div class="recipient-verify-item">
            <div class="recipient-item-left">
              <span class="iconify text-zinc-400" data-icon="ph:user" data-width="14"></span>
              <span class="recipient-item-handle">@${escapeHtml(handle)}</span>
            </div>
            <div class="recipient-item-right">
              <span class="badge badge-idle text-[10px]">Unchecked</span>
            </div>
          </div>`;
      }

      if (v.exists) {
        validCount++;
        return `
          <div class="recipient-verify-item verified">
            <div class="recipient-item-left">
              <span class="iconify text-emerald-500 shrink-0" data-icon="ph:check-circle-fill" data-width="14"></span>
              <span class="recipient-item-handle">@${escapeHtml(v.username || handle)}</span>
              <span class="recipient-item-id font-mono">ID: ${escapeHtml(v.userId || 'Pre-cached')}</span>
              ${v.fullName ? `<span class="text-[11px] text-zinc-400">(${escapeHtml(v.fullName)})</span>` : ''}
            </div>
            <div class="recipient-item-right">
              ${v.isPrivate ? '<span class="badge badge-neutral text-[10px]">Private</span>' : '<span class="badge badge-neutral text-[10px]">Public</span>'}
              <span class="badge badge-success text-[10px]">Ready</span>
            </div>
          </div>`;
      } else {
        invalidCount++;
        return `
          <div class="recipient-verify-item invalid">
            <div class="recipient-item-left">
              <span class="iconify text-rose-500 shrink-0" data-icon="ph:x-circle-fill" data-width="14"></span>
              <span class="recipient-item-handle text-rose-700">@${escapeHtml(handle)}</span>
              <span class="text-[11px] text-rose-500 font-mono">Profile not found</span>
            </div>
            <div class="recipient-item-right">
              <span class="badge badge-stopped text-[10px]">Not Found</span>
            </div>
          </div>`;
      }
    }).join('');

    if (dom.verifiedRecipientsList) dom.verifiedRecipientsList.innerHTML = html;
    if (dom.verifiedRecipientsListFull) dom.verifiedRecipientsListFull.innerHTML = html;

    const summary = `${validCount}/${list.length} verified${invalidCount > 0 ? ` (${invalidCount} invalid)` : ''}`;
    if (dom.verifiedSummaryPill) dom.verifiedSummaryPill.textContent = summary;
    if (dom.verifiedSummaryPillFull) dom.verifiedSummaryPillFull.textContent = summary;

    [dom.btnRemoveInvalidRecipients, dom.btnRemoveInvalidFull].forEach(btn => {
      if (!btn) return;
      if (invalidCount > 0) {
        show(btn);
        btn.textContent = `Remove Invalid (${invalidCount})`;
      } else {
        hide(btn);
      }
    });
  }

  function removeInvalidRecipients() {
    const beforeCount = state.recipients.length;
    const filtered = state.recipients.filter(h => {
      const v = state.verifiedRecipients[h.toLowerCase()];
      return !v || v.exists !== false;
    });

    const removedCount = beforeCount - filtered.length;
    if (removedCount === 0) return;

    state.recipients = filtered;
    state.rawRecipientsText = filtered.join('\n');
    dom.recipientsTextarea.value = state.rawRecipientsText;
    dom.recipientsTextareaFull.value = state.rawRecipientsText;
    processRecipients(state.rawRecipientsText, true);
    renderVerifiedRecipientsList();
    addLog('system', 'completed', `Removed ${removedCount} non-existent handle(s) from campaign.`);
  }

  // ================= FEASIBILITY =================
  function evaluateFeasibility() {
    const total = state.recipients.length;
    const interval = Math.max(5, Number(dom.parallelWorkersInput?.value) || state.schedule.parallelWorkers || 3);
    const parallel = Math.max(1, Number(dom.parallelWorkersInput?.value) || state.schedule.parallelWorkers || 3);
    const maxVol = Math.max(1, Number(dom.maxVolumeInput?.value) || state.schedule.maxVolume || 50);
    const effectiveInterval = interval / parallel;
    const achievable = Math.max(1, Math.floor((maxVol * interval) / effectiveInterval));

    let cls = 'feasibility-bar success';
    let title = 'Schedule Feasible';
    let desc = `${total} recipients will complete with ${parallel} parallel workers.`;

    if (total > maxVol) {
      cls = 'feasibility-bar warning';
      title = 'Volume Limited';
      desc = `Only ${maxVol} of ${total} recipients will be processed per campaign.`;
    }

    [dom.feasibilityCard, dom.feasibilityCardSchedule].forEach(card => {
      if (card) card.className = cls;
    });
    [dom.feasibilityTitle, dom.feasibilityTitleSchedule].forEach(el => {
      if (el) el.textContent = title;
    });
    [dom.feasibilityDesc, dom.feasibilityDescSchedule].forEach(el => {
      if (el) el.textContent = desc;
    });
  }

  // ================= CAMPAIGN ENGINE =================
  async function startCampaign() {
    if (state.recipients.length === 0) { alert('Add at least one recipient.'); return; }
    if (!state.messageText.trim()) { alert('Write a message first.'); return; }
    if (!state.sessionId) { alert('Paste your session ID first.'); return; }

    state.campaignStatus = 'running';
    state.currentIndex = 0;
    state.sentCount = 0;
    state.failedCount = 0;
    state.stats = { total: state.recipients.length, sent: 0, failed: 0, remaining: state.recipients.length };
    state.parallelQueue = [];
    state.activeWorkers = 0;
    state.isDispatching = false;

    const parallel = Math.max(1, Number(dom.parallelWorkersInput.value) || 3);
    const interval = Math.max(0, Number(dom.pacingIntervalInput.value) || 0);
    const retries = Math.max(0, Number(dom.retryAttemptsInput.value) || 0);

    state.schedule.parallelWorkers = parallel;
    state.schedule.retryAttempts = retries;
    save();

    addLog('system', 'running', `Campaign started — ${state.recipients.length} recipients, ${parallel} parallel workers, ${interval}s interval, ${retries} retries.`);
    updateCampaignControlsUI();
    updateStatsUI();

    // Dispatch loop with parallel workers
    await dispatchLoop(parallel, interval, retries);
  }

  async function dispatchLoop(parallel, interval, retries) {
    const worker = async (workerId) => {
      while (state.currentIndex < state.recipients.length && state.campaignStatus === 'running') {
        const index = state.currentIndex;
        state.currentIndex++;
        const username = state.recipients[index];

        dom.currentRecipientBadge.textContent = `[W${workerId}] Dispatching @${username} (${index + 1}/${state.recipients.length})`;

        const personalized = state.messageText
          .replace(/\{\{\s*username\s*\}\}/gi, username)
          .replace(/\{\{\s*handle\s*\}\}/gi, `@${username}`);

        let result;
        for (let attempt = 0; attempt <= retries; attempt++) {
          result = await sendOne(username, personalized);
          if (result.success) break;
          if (attempt < retries) {
            addLog(username, 'failed', `Attempt ${attempt + 1} failed: ${result.details}. Retrying...`);
            if (interval > 0) await sleep(interval * 1000);
          }
        }

        if (result.success) {
          state.stats.sent++;
          addLog(username, 'sent', result.details);
        } else {
          state.stats.failed++;
          addLog(username, 'failed', result.details);
        }

        state.stats.remaining = Math.max(0, state.stats.total - (state.stats.sent + state.stats.failed));
        save();
        updateStatsUI();

        // Pacing between sends (only if user specified an interval > 0)
        if (interval > 0 && state.currentIndex < state.recipients.length && state.campaignStatus === 'running') {
          dom.currentRecipientBadge.textContent = `Pacing (${interval}s)...`;
          await sleep(interval * 1000);
        }
      }
    };

    // Launch parallel workers
    const workers = [];
    for (let i = 0; i < parallel; i++) {
      workers.push(worker(i + 1));
    }
    await Promise.all(workers);

    if (state.campaignStatus === 'running') {
      finishCampaign();
    }
  }

  async function sendOne(username, message) {
    try {
      // Look up pre-cached recipient numeric ID
      const cached = state.verifiedRecipients[username.toLowerCase()];
      const recipientUserId = (cached && cached.exists && cached.userId) ? cached.userId : null;

      const payload = {
        sessionid: state.sessionId,
        csrfToken: state.csrfToken,
        recipient: username,
        text: message,
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
        const threadId = data.meta?.threadId || data.body?.thread_id || 'new';
        const fastTag = recipientUserId ? ' ⚡[fast-send]' : '';
        return { success: true, details: `Sent to @${username} (thread: ${threadId})${fastTag}` };
      }

      const igBody = data.body || {};
      let reason = igBody.message || igBody.errorSummary || igBody.error_title || '';
      if (!reason && igBody.error) reason = igBody.error;
      if (!reason && data.error) reason = data.error;
      if (!reason) reason = `HTTP ${data.status || 'unknown'}`;

      const extra = data.meta?.userId ? ` [userId: ${data.meta.userId}]` : '';
      return { success: false, details: `${reason}${extra}` };
    } catch (err) {
      return { success: false, details: `Proxy error: ${err.message}` };
    }
  }

  function pauseCampaign() {
    state.campaignStatus = 'paused';
    addLog('system', 'paused', 'Campaign paused.');
    updateCampaignControlsUI();
  }

  function resumeCampaign() {
    state.campaignStatus = 'running';
    addLog('system', 'running', 'Campaign resumed.');
    updateCampaignControlsUI();
  }

  function stopCampaign() {
    state.campaignStatus = 'stopped';
    addLog('system', 'stopped', `Campaign stopped. Sent: ${state.stats.sent}, Failed: ${state.stats.failed}.`);
    updateCampaignControlsUI();
    updateStatsUI();
  }

  function finishCampaign() {
    state.campaignStatus = 'completed';
    addLog('system', 'completed', `Campaign complete. Sent: ${state.stats.sent}, Failed: ${state.stats.failed}.`);
    updateCampaignControlsUI();
    updateStatsUI();
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ================= LOGGING =================
  function addLog(recipient, status, details) {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    state.logs.unshift({ id: `${Date.now()}_${Math.random()}`, time, recipient, status, details });
    if (state.logs.length > 200) state.logs.pop();
    save();
    renderLogs();
  }

  function renderLogs() {
    // Compact feed
    if (dom.logsContainer) {
      if (state.logs.length === 0) {
        dom.logsContainer.innerHTML = `
          <div class="logs-empty">
            <span class="iconify" data-icon="ph:tray-fill" data-width="24"></span>
            <span>No activity yet. Start a campaign to see live updates.</span>
          </div>`;
      } else {
        const icons = {
          sent: { icon: 'ph:check-circle-fill', color: 'text-emerald-500' },
          failed: { icon: 'ph:x-circle-fill', color: 'text-rose-500' },
          running: { icon: 'ph:play-circle-fill', color: 'text-indigo-500' },
          paused: { icon: 'ph:pause-circle-fill', color: 'text-amber-500' },
          completed: { icon: 'ph:check-circle-fill', color: 'text-indigo-500' },
          stopped: { icon: 'ph:stop-circle-fill', color: 'text-rose-500' },
        };
        dom.logsContainer.innerHTML = state.logs.slice(0, 30).map(l => {
          const ic = icons[l.status] || icons.running;
          const isSys = l.recipient === 'system';
          return `
            <div class="log-item">
              <span class="log-icon iconify ${ic.color}" data-icon="${ic.icon}" data-width="14"></span>
              <div class="log-content">
                <div class="log-meta">
                  <span class="log-recipient">${isSys ? 'System' : '@' + escapeHtml(l.recipient)}</span>
                  <span class="log-status ${l.status}">${escapeHtml(l.status)}</span>
                </div>
                <div class="log-details">${escapeHtml(l.details)}</div>
              </div>
              <span class="log-time">${l.time}</span>
            </div>`;
        }).join('');
        // Re-render iconify
        if (window.iconify) window.iconify.render();
      }
    }

    // Full table
    if (dom.logsTableBody) {
      if (state.logs.length === 0) {
        dom.logsTableBody.innerHTML = `<tr><td colspan="4" class="logs-table-empty">No activity recorded yet.</td></tr>`;
      } else {
        const badgeClass = {
          sent: 'badge-running', failed: 'badge-stopped', running: 'badge-running',
          paused: 'badge-paused', completed: 'badge-completed', stopped: 'badge-stopped',
        };
        dom.logsTableBody.innerHTML = state.logs.map(l => {
          const isSys = l.recipient === 'system';
          const bc = badgeClass[l.status] || 'badge-idle';
          return `
            <tr>
              <td class="text-xs text-zinc-500 tabular-nums">${l.time}</td>
              <td class="text-xs font-medium">${isSys ? '<span class="text-zinc-500">System</span>' : '@' + escapeHtml(l.recipient)}</td>
              <td><span class="badge ${bc} text-[10px]">${escapeHtml(l.status)}</span></td>
              <td class="text-xs text-zinc-500" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(l.details)}">${escapeHtml(l.details)}</td>
            </tr>`;
        }).join('');
      }
    }
  }

  // ================= UI RENDERING =================
  function updateCampaignControlsUI() {
    const s = state.campaignStatus;
    const configs = {
      idle: 'badge-idle', running: 'badge-running', paused: 'badge-paused',
      completed: 'badge-completed', stopped: 'badge-stopped',
    };
    dom.campaignStatusPill.className = `badge ${configs[s] || 'badge-idle'}`;
    dom.campaignStatusText.textContent = s.charAt(0).toUpperCase() + s.slice(1);

    if (s === 'running') {
      hide(dom.btnStartCampaign); show(dom.btnPauseCampaign);
      dom.btnPauseCampaign.disabled = false;
      hide(dom.btnResumeCampaign);
      dom.btnStopCampaign.disabled = false;
    } else if (s === 'paused') {
      hide(dom.btnStartCampaign); hide(dom.btnPauseCampaign);
      show(dom.btnResumeCampaign); dom.btnResumeCampaign.disabled = false;
      dom.btnStopCampaign.disabled = false;
      dom.currentRecipientBadge.textContent = 'Campaign paused';
    } else {
      show(dom.btnStartCampaign);
      hide(dom.btnPauseCampaign);
      dom.btnPauseCampaign.disabled = true;
      hide(dom.btnResumeCampaign);
      dom.btnStopCampaign.disabled = true;
      const labels = { completed: 'Campaign completed', stopped: 'Campaign terminated', idle: 'No active dispatch' };
      dom.currentRecipientBadge.textContent = labels[s] || 'Idle';
    }
  }

  function updateStatsUI() {
    const total = state.stats.total;
    const processed = state.stats.sent + state.stats.failed;
    const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

    dom.statTotal.textContent = total;
    dom.statSent.textContent = state.stats.sent;
    dom.statFailed.textContent = state.stats.failed;
    dom.statRemaining.textContent = Math.max(0, total - processed);
    dom.progressPercentageText.textContent = `${pct}%`;
    dom.progressFill.style.width = `${pct}%`;
  }

  function renderAll() {
    updateSessionUI();
    updateMessagePreview();
    evaluateFeasibility();
    renderVerifiedRecipientsList();
    updateCampaignControlsUI();
    updateStatsUI();
    renderLogs();
  }

  // ================= HELPERS =================
  function hide(el) { if (el) el.classList.add('hidden'); }
  function show(el) { if (el) el.classList.remove('hidden'); }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // ================= EVENTS =================
  function bindEvents() {
    // Tabs
    dom.navItems.forEach(item => {
      item.addEventListener('click', () => switchTab(item.dataset.tab));
    });

    // Mobile menu
    if (dom.mobileMenuBtn) {
      dom.mobileMenuBtn.addEventListener('click', () => {
        dom.sidebar.classList.toggle('open');
        dom.sidebarOverlay.classList.toggle('hidden');
      });
    }
    if (dom.sidebarOverlay) {
      dom.sidebarOverlay.addEventListener('click', closeMobileSidebar);
    }
    if (dom.sidebarSessionBtn) {
      dom.sidebarSessionBtn.addEventListener('click', () => switchTab('campaign'));
    }

    // Session save & upfront verification
    dom.btnSaveSession.addEventListener('click', verifySession);

    // Recipient upfront verification
    [dom.btnVerifyRecipients, dom.btnVerifyFull].forEach(btn => {
      if (btn) btn.addEventListener('click', batchResolveRecipients);
    });

    // Remove invalid/non-existent recipients
    [dom.btnRemoveInvalidRecipients, dom.btnRemoveInvalidFull].forEach(btn => {
      if (btn) btn.addEventListener('click', removeInvalidRecipients);
    });

    [dom.toggleSessionVisibility, dom.toggleCsrfVisibility].forEach((btn, i) => {
      if (!btn) return;
      const input = i === 0 ? dom.sessionIdInput : dom.csrfTokenInput;
      btn.addEventListener('click', () => {
        input.type = input.type === 'password' ? 'text' : 'password';
        btn.textContent = input.type === 'password' ? 'Show' : 'Hide';
      });
    });

    // Recipients
    [dom.recipientsTextarea, dom.recipientsTextareaFull].forEach(ta => {
      if (!ta) return;
      ta.addEventListener('input', e => processRecipients(e.target.value, false));
      ta.addEventListener('blur', e => processRecipients(e.target.value, true));
    });

    [dom.btnDedupRecipients, dom.btnDedupeFull].forEach(btn => {
      if (btn) btn.addEventListener('click', () => processRecipients(dom.recipientsTextarea.value, true));
    });

    [dom.btnClearRecipients, dom.btnClearFull].forEach(btn => {
      if (btn) btn.addEventListener('click', () => {
        if (confirm('Clear all recipients?')) {
          dom.recipientsTextarea.value = '';
          dom.recipientsTextareaFull.value = '';
          processRecipients('', true);
        }
      });
    });

    [dom.recipientsFileInput, dom.recipientsFileFull].forEach(inp => {
      if (!inp) return;
      inp.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => processRecipients(ev.target.result, true);
        reader.readAsText(file);
        e.target.value = '';
      });
    });

    // Message
    dom.messageTextarea.addEventListener('input', e => {
      state.messageText = e.target.value;
      save();
      updateMessagePreview();
    });

    dom.btnInsertVariable.addEventListener('click', () => {
      const ta = dom.messageTextarea;
      const pos = ta.selectionStart || ta.value.length;
      ta.value = ta.value.substring(0, pos) + '{{username}}' + ta.value.substring(pos);
      state.messageText = ta.value;
      save();
      updateMessagePreview();
      ta.focus();
      ta.setSelectionRange(pos + 12, pos + 12);
    });

    // Schedule sync (pacing + volume fields mirror across tabs)
    const syncPacing = (val) => {
      state.schedule.parallelWorkers = Math.max(1, Number(val) || 3);
      dom.parallelWorkersInput.value = dom.parallelWorkersSchedule.value = dom.settingsParallel.value = val;
      save(); evaluateFeasibility();
    };
    const syncRetries = (val) => {
      state.schedule.retryAttempts = Math.max(0, Number(val) || 0);
      dom.retryAttemptsInput.value = dom.retryAttemptsSchedule.value = dom.settingsRetry.value = val;
      save();
    };

    [dom.parallelWorkersInput, dom.parallelWorkersSchedule, dom.settingsParallel].forEach(el => {
      if (el) el.addEventListener('change', e => syncPacing(e.target.value));
    });
    [dom.retryAttemptsInput, dom.retryAttemptsSchedule, dom.settingsRetry].forEach(el => {
      if (el) el.addEventListener('change', e => syncRetries(e.target.value));
    });

    // Start / Pause / Resume / Stop
    dom.btnStartCampaign.addEventListener('click', startCampaign);
    dom.btnPauseCampaign.addEventListener('click', pauseCampaign);
    dom.btnResumeCampaign.addEventListener('click', resumeCampaign);
    dom.btnStopCampaign.addEventListener('click', stopCampaign);

    // Clear logs
    [dom.btnClearLogs, dom.btnClearLogsFull].forEach(btn => {
      if (btn) btn.addEventListener('click', () => {
        state.logs = [];
        save();
        renderLogs();
      });
    });

    // Export logs
    if (dom.btnExportLogs) {
      dom.btnExportLogs.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(state.logs, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dm_logs_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    // Backup
    dom.btnExportBackup?.addEventListener('click', () => {
      const data = {
        version: '3.0.0',
        exportedAt: new Date().toISOString(),
        recipients: state.recipients,
        message: state.messageText,
        schedule: state.schedule,
        stats: state.stats,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dm_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    dom.backupFileInput?.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const data = JSON.parse(ev.target.result);
          if (data.recipients) { state.rawRecipientsText = data.recipients.join('\n'); dom.recipientsTextarea.value = state.rawRecipientsText; processRecipients(state.rawRecipientsText, false); save(); }
          if (data.message) { state.messageText = data.message; dom.messageTextarea.value = data.message; save(); updateMessagePreview(); }
          if (data.schedule) { Object.assign(state.schedule, data.schedule); save(); evaluateFeasibility(); }
          alert('Backup restored.');
        } catch (err) { alert('Invalid backup: ' + err.message); }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    // Reset
    dom.btnResetApp?.addEventListener('click', () => {
      if (confirm('Reset all data? This clears everything.')) {
        localStorage.clear();
        location.reload();
      }
    });
  }

  function closeMobileSidebar() {
    dom.sidebar?.classList.remove('open');
    dom.sidebarOverlay?.classList.add('hidden');
  }

  // ================= BOOT =================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();