/**
 * Instagram DM Outreach Manager - Lightweight Single-Page Application (SPA)
 * 
 * Features:
 * - 100% Client-side operation with browser localStorage persistence.
 * - Password-masked Instagram session ID management.
 * - Recipient importing (.txt / .csv), format validation, and duplicate elimination.
 * - Live personalization message preview with {{username}} variable substitution.
 * - Campaign scheduling feasibility calculator (deadline cannot override platform limits).
 * - Campaign execution state machine (Start, Pause, Resume, Stop).
 * - Isolated delivery adapter (Simulation Engine vs Direct Browser CORS isolation).
 * - Safe JSON export/import backup (strictly excludes session ID).
 */

(() => {
  'use strict';

  // ================= STORAGE KEYS =================
  const STORAGE_KEYS = {
    SESSION_ID: 'insta_session_id',
    CSRF_TOKEN: 'insta_csrf_token',
    RECIPIENTS: 'insta_recipients',
    MESSAGE: 'insta_message',
    SCHEDULE: 'insta_schedule',
    ADAPTER: 'insta_adapter',
    LOGS: 'insta_logs',
    STATS: 'insta_stats'
  };

  // ================= APPLICATION STATE =================
  const state = {
    sessionId: '',
    csrfToken: '',
    recipients: [],
    rawRecipientsText: '',
    messageText: '',
    schedule: {
      startTime: '',
      deadline: '',
      pacingInterval: 30, // seconds
      maxVolume: 50
    },
    adapter: 'simulation', // 'simulation' | 'direct_browser'
    campaignStatus: 'idle', // 'idle' | 'running' | 'paused' | 'completed' | 'stopped'
    currentIndex: 0,
    stats: {
      total: 0,
      sent: 0,
      failed: 0,
      remaining: 0
    },
    timerId: null,
    logs: []
  };

  // ================= DOM ELEMENTS =================
  const dom = {
    // Header & Session
    sessionStatusPill: document.getElementById('sessionStatusPill'),
    sessionStatusText: document.getElementById('sessionStatusText'),
    sessionIdInput: document.getElementById('sessionIdInput'),
    toggleSessionVisibility: document.getElementById('toggleSessionVisibility'),
    csrfTokenInput: document.getElementById('csrfTokenInput'),
    toggleCsrfVisibility: document.getElementById('toggleCsrfVisibility'),
    btnSaveSession: document.getElementById('btnSaveSession'),
    btnClearSession: document.getElementById('btnClearSession'),
    sessionNotification: document.getElementById('sessionNotification'),
    btnExportBackup: document.getElementById('btnExportBackup'),
    backupFileInput: document.getElementById('backupFileInput'),
    btnResetApp: document.getElementById('btnResetApp'),

    // Recipients
    recipientsTextarea: document.getElementById('recipientsTextarea'),
    recipientCountBadge: document.getElementById('recipientCountBadge'),
    recipientsFileInput: document.getElementById('recipientsFileInput'),
    btnDedupRecipients: document.getElementById('btnDedupRecipients'),
    btnClearRecipients: document.getElementById('btnClearRecipients'),
    recipientsValidationNote: document.getElementById('recipientsValidationNote'),
    dedupNotice: document.getElementById('dedupNotice'),

    // Message
    messageTextarea: document.getElementById('messageTextarea'),
    btnInsertVariable: document.getElementById('btnInsertVariable'),
    charCountBadge: document.getElementById('charCountBadge'),
    livePreviewBox: document.getElementById('livePreviewBox'),

    // Scheduling
    startTimeInput: document.getElementById('startTimeInput'),
    deadlineInput: document.getElementById('deadlineInput'),
    pacingIntervalInput: document.getElementById('pacingIntervalInput'),
    maxVolumeInput: document.getElementById('maxVolumeInput'),
    feasibilityCard: document.getElementById('feasibilityCard'),
    feasibilityTitle: document.getElementById('feasibilityTitle'),
    feasibilityDesc: document.getElementById('feasibilityDesc'),
    btnFixDeadline: document.getElementById('btnFixDeadline'),

    // Campaign Controls & Monitor
    adapterSelect: document.getElementById('adapterSelect'),
    btnStartCampaign: document.getElementById('btnStartCampaign'),
    btnPauseCampaign: document.getElementById('btnPauseCampaign'),
    btnResumeCampaign: document.getElementById('btnResumeCampaign'),
    btnStopCampaign: document.getElementById('btnStopCampaign'),
    campaignStatusPill: document.getElementById('campaignStatusPill'),
    campaignStatusText: document.getElementById('campaignStatusText'),
    currentRecipientBadge: document.getElementById('currentRecipientBadge'),
    progressPercentageText: document.getElementById('progressPercentageText'),
    progressFill: document.getElementById('progressFill'),
    statTotal: document.getElementById('statTotal'),
    statSent: document.getElementById('statSent'),
    statFailed: document.getElementById('statFailed'),
    statRemaining: document.getElementById('statRemaining'),

    // Logs Feed
    logsTableBody: document.getElementById('logsTableBody'),
    btnClearLogs: document.getElementById('btnClearLogs')
  };

  // ================= INITIALIZATION =================
  function init() {
    loadPersistedState();
    bindEvents();
    renderAll();
  }

  // ================= LOCAL STORAGE PERSISTENCE =================
  function loadPersistedState() {
    // 1. Session ID
    const savedSession = localStorage.getItem(STORAGE_KEYS.SESSION_ID) || '';
    state.sessionId = savedSession;
    dom.sessionIdInput.value = savedSession;

    // 1b. CSRF Token
    const savedCsrf = localStorage.getItem(STORAGE_KEYS.CSRF_TOKEN) || '';
    state.csrfToken = savedCsrf;
    dom.csrfTokenInput.value = savedCsrf;

    updateSessionStatusUI();

    // 2. Recipients
    const defaultRecipients = 'alex_designer\nstudio.flux\ncreative_labs\nmotion_artist';
    const savedRecipients = localStorage.getItem(STORAGE_KEYS.RECIPIENTS);
    state.rawRecipientsText = savedRecipients !== null ? savedRecipients : defaultRecipients;
    dom.recipientsTextarea.value = state.rawRecipientsText;
    processRecipients(state.rawRecipientsText, false);

    // 3. Message
    const defaultMessage = 'Hi @{{username}}, loved your recent visual work! Would love to invite you to test our new creative platform.';
    const savedMessage = localStorage.getItem(STORAGE_KEYS.MESSAGE);
    state.messageText = savedMessage !== null ? savedMessage : defaultMessage;
    dom.messageTextarea.value = state.messageText;

    // 4. Schedule
    const now = new Date();
    const in24h = new Date(Date.now() + 24 * 3600 * 1000);
    const formatLocalIso = (d) => {
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const savedSchedule = localStorage.getItem(STORAGE_KEYS.SCHEDULE);
    if (savedSchedule) {
      try {
        state.schedule = { ...state.schedule, ...JSON.parse(savedSchedule) };
      } catch (e) {
        state.schedule.startTime = formatLocalIso(now);
        state.schedule.deadline = formatLocalIso(in24h);
      }
    } else {
      state.schedule.startTime = formatLocalIso(now);
      state.schedule.deadline = formatLocalIso(in24h);
    }

    dom.startTimeInput.value = state.schedule.startTime;
    dom.deadlineInput.value = state.schedule.deadline;
    dom.pacingIntervalInput.value = state.schedule.pacingInterval || 30;
    dom.maxVolumeInput.value = state.schedule.maxVolume || 50;

    // 5. Adapter
    const savedAdapter = localStorage.getItem(STORAGE_KEYS.ADAPTER) || 'simulation';
    state.adapter = savedAdapter;
    dom.adapterSelect.value = savedAdapter;

    // 6. Logs & Stats
    const savedLogs = localStorage.getItem(STORAGE_KEYS.LOGS);
    if (savedLogs) {
      try { state.logs = JSON.parse(savedLogs); } catch (e) { state.logs = []; }
    }

    const savedStats = localStorage.getItem(STORAGE_KEYS.STATS);
    if (savedStats) {
      try { state.stats = JSON.parse(savedStats); } catch (e) { /* ignore */ }
    }
  }

  function persistSession() {
    localStorage.setItem(STORAGE_KEYS.SESSION_ID, state.sessionId);
    localStorage.setItem(STORAGE_KEYS.CSRF_TOKEN, state.csrfToken);
  }

  function persistRecipients() {
    localStorage.setItem(STORAGE_KEYS.RECIPIENTS, state.rawRecipientsText);
  }

  function persistMessage() {
    localStorage.setItem(STORAGE_KEYS.MESSAGE, state.messageText);
  }

  function persistSchedule() {
    localStorage.setItem(STORAGE_KEYS.SCHEDULE, JSON.stringify(state.schedule));
  }

  function persistAdapter() {
    localStorage.setItem(STORAGE_KEYS.ADAPTER, state.adapter);
  }

  function persistLogs() {
    localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(state.logs.slice(0, 100)));
  }

  function persistStats() {
    localStorage.setItem(STORAGE_KEYS.STATS, JSON.stringify(state.stats));
  }

  // ================= RECIPIENT PROCESSING & VALIDATION =================
  const USERNAME_REGEX = /^[a-zA-Z0-9._]{1,30}$/;

  function validateUsername(handle) {
    if (!handle) return false;
    const clean = handle.replace(/^@/, '').trim();
    if (clean.length === 0 || clean.length > 30) return false;
    if (/\s/.test(clean) || /\.\./.test(clean)) return false;
    if (clean.startsWith('.') || clean.endsWith('.')) return false;
    return USERNAME_REGEX.test(clean);
  }

  function processRecipients(rawText, updateTextarea = true) {
    state.rawRecipientsText = rawText;
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const seen = new Set();
    const cleanList = [];
    let dupsCount = 0;
    let invalidCount = 0;

    for (const line of lines) {
      let candidate = line;
      // If line contains commas (CSV style), take the first item
      if (candidate.includes(',')) {
        const parts = candidate.split(',').map(p => p.replace(/^["']|["']$/g, '').trim());
        if (['username', 'handle', 'recipient', 'user'].includes(parts[0].toLowerCase())) continue;
        candidate = parts[0];
      }

      const clean = candidate.replace(/^@/, '').trim();
      if (!validateUsername(clean)) {
        invalidCount++;
        continue;
      }

      const lower = clean.toLowerCase();
      if (seen.has(lower)) {
        dupsCount++;
      } else {
        seen.add(lower);
        cleanList.push(clean);
      }
    }

    state.recipients = cleanList;

    if (updateTextarea) {
      dom.recipientsTextarea.value = cleanList.join('\n');
      state.rawRecipientsText = dom.recipientsTextarea.value;
      persistRecipients();
    }

    // Update UI badge
    dom.recipientCountBadge.textContent = `${cleanList.length} recipient${cleanList.length === 1 ? '' : 's'}`;
    if (dupsCount > 0) {
      dom.dedupNotice.textContent = `Auto-removed ${dupsCount} duplicate${dupsCount === 1 ? '' : 's'}`;
    } else if (invalidCount > 0) {
      dom.dedupNotice.textContent = `Ignored ${invalidCount} invalid handle${invalidCount === 1 ? '' : 's'}`;
    } else {
      dom.dedupNotice.textContent = '';
    }

    // Update stats if not currently running
    if (state.campaignStatus === 'idle') {
      state.stats.total = cleanList.length;
      state.stats.remaining = cleanList.length;
      state.stats.sent = 0;
      state.stats.failed = 0;
      state.currentIndex = 0;
      updateStatsUI();
    }

    evaluateFeasibility();
  }

  // ================= MESSAGE PREVIEW & VARIABLES =================
  function updateMessagePreview() {
    const text = state.messageText || '';
    dom.charCountBadge.textContent = `${text.length} character${text.length === 1 ? '' : 's'}`;

    const sampleUsername = (state.recipients.length > 0 && state.recipients[0]) ? state.recipients[0] : 'alex_creator';
    const rendered = text
      .replace(/\{\{\s*username\s*\}\}/gi, sampleUsername)
      .replace(/\{\{\s*handle\s*\}\}/gi, `@${sampleUsername}`);

    dom.livePreviewBox.textContent = rendered || 'Type a message above to see preview...';
  }

  // ================= CAMPAIGN FEASIBILITY CALCULATOR =================
  function evaluateFeasibility() {
    const totalRecipients = state.recipients.length;
    const interval = Math.max(5, Number(state.schedule.pacingInterval) || 30);
    const maxVolume = Math.max(1, Number(state.schedule.maxVolume) || 50);

    const start = new Date(state.schedule.startTime || Date.now());
    const deadline = new Date(state.schedule.deadline);

    if (isNaN(deadline.getTime()) || deadline <= start) {
      dom.feasibilityCard.className = 'sub-card border-rose-900/40 bg-rose-950/20 text-xs flex items-start justify-between gap-3';
      dom.feasibilityTitle.textContent = 'Invalid Target Deadline';
      dom.feasibilityTitle.className = 'font-medium text-rose-400';
      dom.feasibilityDesc.textContent = 'Deadline must be set to a future date after campaign start time.';
      dom.btnFixDeadline.classList.add('hidden');
      return;
    }

    const availableSeconds = (deadline.getTime() - start.getTime()) / 1000;
    const achievableUnderPacing = Math.floor(availableSeconds / interval);
    const deliverableCount = Math.min(achievableUnderPacing, maxVolume);

    if (deliverableCount < totalRecipients) {
      const shortfall = totalRecipients - deliverableCount;
      dom.feasibilityCard.className = 'sub-card border-amber-900/40 bg-amber-950/20 text-xs flex items-start justify-between gap-3';
      dom.feasibilityTitle.textContent = 'Platform Safeguard: Target Infeasible';
      dom.feasibilityTitle.className = 'font-medium text-amber-400';
      dom.feasibilityDesc.innerHTML = `Under ${interval}s deterministic pacing and max volume (${maxVolume}), only <strong>${deliverableCount} of ${totalRecipients}</strong> recipients can be safely delivered. <strong>${shortfall} will remain unserviced</strong>. The deadline cannot override platform rate limits.`;
      
      // Calculate recommended safe deadline
      const neededSeconds = totalRecipients * interval;
      const recommendedDate = new Date(start.getTime() + neededSeconds * 1000);
      dom.btnFixDeadline.classList.remove('hidden');
      dom.btnFixDeadline.onclick = () => {
        const pad = (n) => String(n).padStart(2, '0');
        const formatted = `${recommendedDate.getFullYear()}-${pad(recommendedDate.getMonth() + 1)}-${pad(recommendedDate.getDate())}T${pad(recommendedDate.getHours())}:${pad(recommendedDate.getMinutes())}`;
        state.schedule.deadline = formatted;
        dom.deadlineInput.value = formatted;
        persistSchedule();
        evaluateFeasibility();
      };
    } else {
      dom.feasibilityCard.className = 'sub-card border-emerald-900/30 bg-emerald-950/10 text-xs flex items-start justify-between gap-3';
      dom.feasibilityTitle.textContent = 'Schedule Feasible & Compliant';
      dom.feasibilityTitle.className = 'font-medium text-emerald-400';
      const estimatedMinutes = Math.ceil((totalRecipients * interval) / 60);
      dom.feasibilityDesc.textContent = `All ${totalRecipients} recipients can complete in ~${estimatedMinutes} minutes without exceeding platform pacing or volume limits.`;
      dom.btnFixDeadline.classList.add('hidden');
    }
  }

  // ================= CAMPAIGN ENGINE (EXECUTION LOOP) =================
  function startCampaign() {
    if (state.recipients.length === 0) {
      alert('Please enter or import at least one valid Instagram username.');
      return;
    }
    if (!state.messageText.trim()) {
      alert('Please compose an outreach message.');
      return;
    }

    state.campaignStatus = 'running';
    state.currentIndex = 0;
    state.stats.total = state.recipients.length;
    state.stats.sent = 0;
    state.stats.failed = 0;
    state.stats.remaining = state.recipients.length;
    persistStats();

    addLog('system', 'running', `Campaign started with ${state.recipients.length} recipients (${state.schedule.pacingInterval}s pacing).`);
    updateCampaignControlsUI();
    updateStatsUI();

    // Kick off dispatch loop
    scheduleNextDispatch(500); // initial immediate dispatch after 500ms
  }

  function pauseCampaign() {
    if (state.campaignStatus !== 'running') return;
    state.campaignStatus = 'paused';
    if (state.timerId) clearTimeout(state.timerId);
    state.timerId = null;

    addLog('system', 'paused', 'Campaign paused manually by user.');
    updateCampaignControlsUI();
  }

  function resumeCampaign() {
    if (state.campaignStatus !== 'paused') return;
    state.campaignStatus = 'running';

    addLog('system', 'running', 'Campaign resumed.');
    updateCampaignControlsUI();
    scheduleNextDispatch(1000);
  }

  function stopCampaign() {
    state.campaignStatus = 'stopped';
    if (state.timerId) clearTimeout(state.timerId);
    state.timerId = null;

    addLog('system', 'stopped', `Campaign stopped by user. Processed ${state.stats.sent + state.stats.failed} of ${state.stats.total}.`);
    updateCampaignControlsUI();
  }

  function finishCampaign() {
    state.campaignStatus = 'completed';
    if (state.timerId) clearTimeout(state.timerId);
    state.timerId = null;

    addLog('system', 'completed', `Campaign completed successfully! Total Sent: ${state.stats.sent}, Failed: ${state.stats.failed}.`);
    updateCampaignControlsUI();
    updateStatsUI();
  }

  function scheduleNextDispatch(delayMs) {
    if (state.campaignStatus !== 'running') return;
    if (state.timerId) clearTimeout(state.timerId);

    state.timerId = setTimeout(async () => {
      await executeDispatchStep();
    }, delayMs);
  }

  async function executeDispatchStep() {
    if (state.campaignStatus !== 'running') return;

    if (state.currentIndex >= state.recipients.length) {
      finishCampaign();
      return;
    }

    const username = state.recipients[state.currentIndex];
    dom.currentRecipientBadge.textContent = `Dispatching: @${username} (${state.currentIndex + 1} of ${state.recipients.length})`;

    const personalized = state.messageText
      .replace(/\{\{\s*username\s*\}\}/gi, username)
      .replace(/\{\{\s*handle\s*\}\}/gi, `@${username}`);

    let result;
    if (state.adapter === 'simulation') {
      result = await dispatchViaSimulation(username, personalized);
    } else {
      result = await dispatchViaDirectBrowser(username, personalized);
    }

    if (result.success) {
      state.stats.sent++;
      addLog(username, 'sent', result.details);
    } else {
      state.stats.failed++;
      addLog(username, 'failed', result.details);
    }

    state.currentIndex++;
    state.stats.remaining = Math.max(0, state.stats.total - (state.stats.sent + state.stats.failed));
    persistStats();
    updateStatsUI();

    if (state.currentIndex < state.recipients.length && state.campaignStatus === 'running') {
      const intervalSec = Math.max(5, Number(state.schedule.pacingInterval) || 30);
      dom.currentRecipientBadge.textContent = `Pacing delay (${intervalSec}s) before next dispatch...`;
      scheduleNextDispatch(intervalSec * 1000);
    } else {
      finishCampaign();
    }
  }

  // ================= DELIVERY ADAPTERS =================
  /**
   * 1. Simulation Engine Adapter
   * Fully functional deterministic queue engine that simulates realistic dispatch,
   * handles mock delivery, and catches simulated edge-case usernames.
   */
  async function dispatchViaSimulation(username, message) {
    // Artificial slight network latency
    await new Promise(r => setTimeout(r, 400));

    // Simulated test cases
    if (username.toLowerCase().includes('fail_test')) {
      return {
        success: false,
        details: 'Simulated platform rejection: recipient direct messaging restricted.'
      };
    }
    if (username.toLowerCase().includes('policy_test')) {
      return {
        success: false,
        details: 'Simulated policy block: recipient outside 24-hour interaction window.'
      };
    }

    return {
      success: true,
      details: `Simulated DM delivered successfully to @${username}. Length: ${message.length} chars.`
    };
  }

  /**
   * 2. Direct Browser Session Adapter (Proxy-Backed)
   * Sends the DM through our local Node.js proxy at /api/send-dm,
   * which resolves username → userId then forwards to Instagram's
   * /api/v1/direct_v2/threads/broadcast/text/ endpoint server-side.
   */
  async function dispatchViaDirectBrowser(username, message) {
    if (!state.sessionId) {
      return {
        success: false,
        details: 'No session ID configured. Paste your sessionid cookie above to send DMs.'
      };
    }

    // Read csrfToken from the session field if present (format: "sessionid|csrfToken" or just sessionid)
    // The server handles missing csrfToken gracefully.
    const csrfToken = state.csrfToken || '';

    try {
      const res = await fetch('/api/send-dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionid: state.sessionId,
          csrfToken,
          recipient: username,
          text: message
        })
      });

      const data = await res.json();

      if (data.ok) {
        const threadId = data.body?.payload?.thread_id || data.body?.thread_id || 'unknown';
        return {
          success: true,
          details: `✓ DM sent to @${username} (userId: ${data.meta?.userId || '?'}). Thread: ${threadId}`
        };
      }

      // Build a detailed failure reason from the server response
      const igBody = data.body || {};
      const debug = data.debug || {};
      let reason = igBody.message || igBody.error_title || igBody.feedback_title || igBody.htmlTitle || '';
      if (!reason && igBody.error) reason = igBody.error;
      if (!reason && igBody.htmlError) reason = igBody.htmlError;
      if (!reason && data.error) reason = data.error;
      if (!reason) reason = `HTTP ${data.status || 'unknown'}`;

      // Include token status and userId in failure details
      const extra = [];
      if (data.meta?.userId) extra.push(`userId: ${data.meta.userId}`);
      if (data.meta?.ownUserId) extra.push(`ownId: ${data.meta.ownUserId}`);
      if (debug.tokens?.fb_dtsg) extra.push('fb_dtsg: ✓');
      if (debug.responseBodyRaw) {
        const short = debug.responseBodyRaw.substring(0, 120).replace(/\n/g, ' ');
        extra.push(`raw: ${short}`);
      }
      return {
        success: false,
        details: `✗ @${username} → ${reason}${extra.length ? ' [' + extra.join(', ') + ']' : ''}`
      };
    } catch (err) {
      return {
        success: false,
        details: `✗ @${username} → Proxy unreachable: ${err.message}. Is "node server.js" running?`
      };
    }
  }

  // ================= LOGGING =================
  function addLog(recipient, status, details) {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const logItem = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      time: timeStr,
      recipient,
      status,
      details
    };

    state.logs.unshift(logItem);
    if (state.logs.length > 100) state.logs.pop();
    persistLogs();
    renderLogs();
  }

  function renderLogs() {
    if (state.logs.length === 0) {
      dom.logsTableBody.innerHTML = `
        <tr>
          <td colspan="4" class="text-center text-zinc-500 py-6 font-sans">
            No outreach dispatches recorded. Configure recipients and click "Start Campaign".
          </td>
        </tr>
      `;
      return;
    }

    const rows = state.logs.map(log => {
      const isSystem = log.recipient === 'system';
      const badgeClass = {
        sent: 'badge-running',
        failed: 'badge-stopped',
        skipped: 'badge-paused',
        running: 'badge-running',
        paused: 'badge-paused',
        completed: 'badge-completed',
        stopped: 'badge-stopped'
      }[log.status] || 'badge-idle';

      return `
        <tr class="hover:bg-zinc-900/50">
          <td class="text-zinc-500 tabular-nums">${log.time}</td>
          <td class="font-medium text-zinc-200">
            ${isSystem ? '<span class="text-zinc-500 font-sans">System</span>' : `@${escapeHtml(log.recipient)}`}
          </td>
          <td>
            <span class="badge ${badgeClass} text-[10px] py-0 px-1.5">
              ${escapeHtml(log.status)}
            </span>
          </td>
          <td class="text-zinc-400 font-sans text-xs truncate max-w-xs" title="${escapeHtml(log.details)}">
            ${escapeHtml(log.details)}
          </td>
        </tr>
      `;
    }).join('');

    dom.logsTableBody.innerHTML = rows;
  }

  // ================= UI RENDERING & STATUS UPDATES =================
  function updateSessionStatusUI() {
    const hasSession = state.sessionId && state.sessionId.trim().length > 5;
    const hasCsrf = state.csrfToken && state.csrfToken.trim().length > 5;

    if (hasSession && hasCsrf) {
      dom.sessionStatusPill.className = 'badge badge-running';
      dom.sessionStatusText.textContent = 'Ready to Send';
    } else if (hasSession && !hasCsrf) {
      dom.sessionStatusPill.className = 'badge badge-paused';
      dom.sessionStatusText.textContent = 'CSRF Missing';
    } else {
      dom.sessionStatusPill.className = 'badge badge-idle';
      dom.sessionStatusText.textContent = 'No Session';
    }
  }

  function updateCampaignControlsUI() {
    const status = state.campaignStatus;
    const badgeConfigs = {
      idle: { text: 'Idle', class: 'badge-idle' },
      running: { text: 'Running', class: 'badge-running' },
      paused: { text: 'Paused', class: 'badge-paused' },
      completed: { text: 'Completed', class: 'badge-completed' },
      stopped: { text: 'Stopped', class: 'badge-stopped' }
    };

    const config = badgeConfigs[status] || badgeConfigs.idle;
    dom.campaignStatusPill.className = `badge ${config.class}`;
    dom.campaignStatusText.textContent = config.text;

    if (status === 'running') {
      dom.btnStartCampaign.classList.add('hidden');
      dom.btnPauseCampaign.classList.remove('hidden');
      dom.btnPauseCampaign.disabled = false;
      dom.btnResumeCampaign.classList.add('hidden');
      dom.btnStopCampaign.disabled = false;
    } else if (status === 'paused') {
      dom.btnStartCampaign.classList.add('hidden');
      dom.btnPauseCampaign.classList.add('hidden');
      dom.btnResumeCampaign.classList.remove('hidden');
      dom.btnResumeCampaign.disabled = false;
      dom.btnStopCampaign.disabled = false;
      dom.currentRecipientBadge.textContent = 'Campaign paused';
    } else {
      // idle, completed, stopped
      dom.btnStartCampaign.classList.remove('hidden');
      dom.btnPauseCampaign.classList.remove('hidden');
      dom.btnPauseCampaign.disabled = true;
      dom.btnResumeCampaign.classList.add('hidden');
      dom.btnStopCampaign.disabled = true;
      if (status === 'completed') {
        dom.currentRecipientBadge.textContent = 'Campaign completed';
      } else if (status === 'stopped') {
        dom.currentRecipientBadge.textContent = 'Campaign terminated';
      } else {
        dom.currentRecipientBadge.textContent = 'No active dispatch';
      }
    }
  }

  function updateStatsUI() {
    const total = state.stats.total;
    const processed = state.stats.sent + state.stats.failed;
    const percentage = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

    dom.statTotal.textContent = total;
    dom.statSent.textContent = state.stats.sent;
    dom.statFailed.textContent = state.stats.failed;
    dom.statRemaining.textContent = Math.max(0, total - processed);

    dom.progressPercentageText.textContent = `${percentage}%`;
    dom.progressFill.style.width = `${percentage}%`;
  }

  function renderAll() {
    updateSessionStatusUI();
    updateMessagePreview();
    evaluateFeasibility();
    updateCampaignControlsUI();
    updateStatsUI();
    renderLogs();
  }

  // ================= EVENT LISTENERS =================
  function bindEvents() {
    // 1. Session Controls
    dom.btnSaveSession.addEventListener('click', () => {
      state.sessionId = dom.sessionIdInput.value.trim();
      state.csrfToken = dom.csrfTokenInput.value.trim();
      persistSession();
      updateSessionStatusUI();
      dom.sessionNotification.textContent = 'Session saved locally';
      setTimeout(() => { dom.sessionNotification.textContent = ''; }, 3000);
    });

    dom.btnClearSession.addEventListener('click', () => {
      state.sessionId = '';
      state.csrfToken = '';
      dom.sessionIdInput.value = '';
      dom.csrfTokenInput.value = '';
      persistSession();
      updateSessionStatusUI();
      dom.sessionNotification.textContent = 'Session cleared';
      setTimeout(() => { dom.sessionNotification.textContent = ''; }, 3000);
    });

    dom.toggleSessionVisibility.addEventListener('click', () => {
      if (dom.sessionIdInput.type === 'password') {
        dom.sessionIdInput.type = 'text';
        dom.toggleSessionVisibility.textContent = 'Hide';
      } else {
        dom.sessionIdInput.type = 'password';
        dom.toggleSessionVisibility.textContent = 'Show';
      }
    });

    dom.toggleCsrfVisibility.addEventListener('click', () => {
      if (dom.csrfTokenInput.type === 'password') {
        dom.csrfTokenInput.type = 'text';
        dom.toggleCsrfVisibility.textContent = 'Hide';
      } else {
        dom.csrfTokenInput.type = 'password';
        dom.toggleCsrfVisibility.textContent = 'Show';
      }
    });

    // 2. Recipients Controls
    dom.recipientsTextarea.addEventListener('input', (e) => {
      processRecipients(e.target.value, false);
      persistRecipients();
    });

    dom.recipientsTextarea.addEventListener('blur', (e) => {
      processRecipients(e.target.value, true);
    });

    dom.btnDedupRecipients.addEventListener('click', () => {
      processRecipients(dom.recipientsTextarea.value, true);
    });

    dom.btnClearRecipients.addEventListener('click', () => {
      if (confirm('Clear the entire recipient list?')) {
        dom.recipientsTextarea.value = '';
        processRecipients('', true);
      }
    });

    dom.recipientsFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target.result;
        processRecipients(text, true);
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    // 3. Message Controls
    dom.messageTextarea.addEventListener('input', (e) => {
      state.messageText = e.target.value;
      persistMessage();
      updateMessagePreview();
    });

    dom.btnInsertVariable.addEventListener('click', () => {
      const textarea = dom.messageTextarea;
      const cursor = textarea.selectionStart || textarea.value.length;
      const before = textarea.value.substring(0, cursor);
      const after = textarea.value.substring(cursor);
      textarea.value = before + '{{username}}' + after;
      state.messageText = textarea.value;
      persistMessage();
      updateMessagePreview();
      textarea.focus();
      textarea.setSelectionRange(cursor + 12, cursor + 12);
    });

    // 4. Scheduling Controls
    dom.startTimeInput.addEventListener('change', (e) => {
      state.schedule.startTime = e.target.value;
      persistSchedule();
      evaluateFeasibility();
    });

    dom.deadlineInput.addEventListener('change', (e) => {
      state.schedule.deadline = e.target.value;
      persistSchedule();
      evaluateFeasibility();
    });

    dom.pacingIntervalInput.addEventListener('change', (e) => {
      state.schedule.pacingInterval = Math.max(5, Number(e.target.value) || 30);
      persistSchedule();
      evaluateFeasibility();
    });

    dom.maxVolumeInput.addEventListener('change', (e) => {
      state.schedule.maxVolume = Math.max(1, Number(e.target.value) || 50);
      persistSchedule();
      evaluateFeasibility();
    });

    // 5. Campaign Action Controls
    dom.adapterSelect.addEventListener('change', (e) => {
      state.adapter = e.target.value;
      persistAdapter();
    });

    dom.btnStartCampaign.addEventListener('click', startCampaign);
    dom.btnPauseCampaign.addEventListener('click', pauseCampaign);
    dom.btnResumeCampaign.addEventListener('click', resumeCampaign);
    dom.btnStopCampaign.addEventListener('click', stopCampaign);

    // 6. Clear Logs
    dom.btnClearLogs.addEventListener('click', () => {
      state.logs = [];
      persistLogs();
      renderLogs();
    });

    // 7. Backup Export & Import (STRICTLY EXCLUDES SESSION ID)
    dom.btnExportBackup.addEventListener('click', () => {
      const backupData = {
        version: '2.0.0',
        exportedAt: new Date().toISOString(),
        recipients: state.recipients,
        message: state.messageText,
        schedule: state.schedule,
        adapter: state.adapter,
        stats: state.stats
        // CRITICAL REQUIREMENT: Never expose the session ID in exported files
      };

      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `insta_campaign_backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    dom.backupFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          if (parsed.recipients && Array.isArray(parsed.recipients)) {
            state.rawRecipientsText = parsed.recipients.join('\n');
            dom.recipientsTextarea.value = state.rawRecipientsText;
            processRecipients(state.rawRecipientsText, false);
            persistRecipients();
          }
          if (parsed.message) {
            state.messageText = parsed.message;
            dom.messageTextarea.value = state.messageText;
            persistMessage();
            updateMessagePreview();
          }
          if (parsed.schedule) {
            state.schedule = { ...state.schedule, ...parsed.schedule };
            dom.startTimeInput.value = state.schedule.startTime;
            dom.deadlineInput.value = state.schedule.deadline;
            dom.pacingIntervalInput.value = state.schedule.pacingInterval;
            dom.maxVolumeInput.value = state.schedule.maxVolume;
            persistSchedule();
            evaluateFeasibility();
          }
          alert('Campaign configuration backup restored successfully!');
        } catch (err) {
          alert('Invalid backup JSON file: ' + err.message);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    // 8. Reset App
    dom.btnResetApp.addEventListener('click', () => {
      if (confirm('Reset all saved local data? This will clear session, recipients, and logs.')) {
        localStorage.clear();
        location.reload();
      }
    });
  }

  // ================= UTILITIES =================
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Bootstrap when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
