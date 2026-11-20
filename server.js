import http from 'http';
import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 5050;
const DAEMON_PORT = 5055;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// ──────────────────────────────────────────────
// Persistent Python daemon worker for sub-second DMs
// ──────────────────────────────────────────────
let daemonProc = null;

function ensureDaemon() {
  const workerPath = path.join(__dirname, 'ig_worker.py');
  daemonProc = spawn('python', [workerPath, 'daemon', String(DAEMON_PORT)], {
    cwd: __dirname,
    windowsHide: true,
    stdio: 'ignore'
  });
  daemonProc.unref();
}

ensureDaemon();

process.on('exit', () => {
  try { daemonProc?.kill(); } catch {}
});

// ──────────────────────────────────────────────
// Structured logger
// ──────────────────────────────────────────────
function log(label, data) {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  const lines = (typeof data === 'string' ? data : JSON.stringify(data, null, 2)).split('\n');
  console.log(`\n[${ts}] ── ${label} ──`);
  lines.forEach(l => console.log('  ' + l));
}

// ──────────────────────────────────────────────
// Call Python worker (fast daemon with fallback to CLI)
// ──────────────────────────────────────────────
async function callPython(command, payload) {
  // 1. Fast route: Persistent daemon with warm browser (~200ms!)
  try {
    const res = await fetch(`http://127.0.0.1:${DAEMON_PORT}/${command}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    // Daemon not ready or restarting, fallback to CLI
  }

  // 2. Fallback route: one-shot CLI execution
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'ig_worker.py');
    const arg = JSON.stringify(payload);
    execFile('python', [workerPath, command, arg], {
      cwd: __dirname,
      timeout: 35000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      if (err) {
        if (stderr) {
          stderr.toString().trim().split('\n').forEach(l => {
            if (l.trim()) console.log('  [python stderr] ' + l.trim());
          });
        }
        return reject(new Error(err.message));
      }

      const lines = stdout.toString().trim().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        try {
          return resolve(JSON.parse(line));
        } catch {
          // Not JSON, keep looking
        }
      }
      reject(new Error('No JSON in Python output: ' + stdout.toString().substring(0, 200)));
    });
  });
}

// ──────────────────────────────────────────────
// Verify Session & Extract Sender Info
// ──────────────────────────────────────────────
function handleVerifySession(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    let payload;
    try { payload = JSON.parse(body); }
    catch { return json(res, 400, { ok: false, error: 'Invalid JSON body' }); }

    const { sessionid: rawSessionid } = payload;
    const csrfToken = (payload.csrfToken || payload.csrftoken || '').trim();
    if (!rawSessionid) return json(res, 400, { ok: false, error: 'Missing sessionid' });

    const sessionid = rawSessionid.replace(/%3A/gi, ':').replace(/%3B/gi, ';').trim();
    log('─── VERIFY SESSION REQUEST ───', { dsUserId: sessionid.split(':')[0] });

    try {
      const result = await callPython('verify-session', { sessionid, csrfToken });
      log('VERIFY SESSION RESULT', result);
      return json(res, 200, {
        ok: Boolean(result.valid),
        valid: Boolean(result.valid),
        sender: result.sender ? { ...result.sender, authenticated: true } : null,
        tokens: result.tokens || null,
        reason: result.reason || null
      });
    } catch (err) {
      log('X VERIFY SESSION ERROR', { message: err.message });
      return json(res, 500, { ok: false, error: err.message });
    }
  });
}

// ──────────────────────────────────────────────
// Batch Resolve Recipients (Pre-verify existence & cache userIds)
// ──────────────────────────────────────────────
function handleResolveRecipients(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    let payload;
    try { payload = JSON.parse(body); }
    catch { return json(res, 400, { ok: false, error: 'Invalid JSON body' }); }

    const rawSessionid = payload.sessionid;
    const recipients = payload.recipients || payload.usernames;
    const csrfToken = (payload.csrfToken || payload.csrftoken || '').trim();
    if (!rawSessionid) return json(res, 400, { ok: false, error: 'Missing sessionid' });
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return json(res, 400, { ok: false, error: 'No recipients provided' });
    }

    const sessionid = rawSessionid.replace(/%3A/gi, ':').replace(/%3B/gi, ';').trim();
    log('─── BATCH RESOLVE REQUEST ───', { total: recipients.length, sample: recipients.slice(0, 3) });

    try {
      const result = await callPython('batch-resolve', { sessionid, csrfToken, recipients });
      log('BATCH RESOLVE RESULT', { count: (result.results || []).length });
      return json(res, 200, result);
    } catch (err) {
      log('X BATCH RESOLVE ERROR', { message: err.message });
      return json(res, 500, { ok: false, error: err.message });
    }
  });
}

// ──────────────────────────────────────────────
// Main proxy handler
// ──────────────────────────────────────────────
function proxyToInstagram(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    let payload;
    try { payload = JSON.parse(body); }
    catch { return json(res, 400, { ok: false, error: 'Invalid JSON body' }); }

    const { sessionid: rawSessionid, recipient, text, recipientUserId } = payload;
    const csrfToken = (payload.csrfToken || '').trim();

    if (!rawSessionid)  return json(res, 400, { ok: false, error: 'Missing sessionid' });
    if (!recipient)     return json(res, 400, { ok: false, error: 'Missing recipient' });
    if (!text)          return json(res, 400, { ok: false, error: 'Missing text' });

    const sessionid = rawSessionid.replace(/%3A/gi, ':').replace(/%3B/gi, ';').trim();

    // ── FAST PATH: recipientUserId is already known from upfront verification ──
    if (recipientUserId) {
      log('⚡ FAST DISPATCH (Pre-cached recipientUserId)', {
        recipient,
        recipientUserId,
        textPreview: text.substring(0, 50),
      });

      try {
        const result = await callPython('fast-send', {
          sessionid,
          csrfToken,
          recipient,
          recipientUserId,
          text,
          tokens: payload.tokens
        });

        log('FAST SEND RESULT', {
          ok: result.ok,
          status: result.status,
          userId: result.userId,
          threadId: result.threadId
        });

        return json(res, 200, {
          ok: result.ok,
          status: result.status,
          body: result.body,
          meta: {
            recipient,
            userId: result.userId || recipientUserId,
            threadId: result.threadId,
            offlineThreadingId: result.offlineThreadingId
          }
        });
      } catch (err) {
        log('X FAST SEND ERROR', { message: err.message });
        return json(res, 500, { ok: false, error: `Fast send error: ${err.message}` });
      }
    }

    log('─── STANDARD DM REQUEST (Unresolved) ───', {
      recipient,
      textLength: text.length,
      textPreview: text.substring(0, 100),
      csrfToken: csrfToken ? `${csrfToken.slice(0, 8)}...` : '(none)',
      sessionidPreview: sessionid.substring(0, 20) + '...',
      dsUserId: sessionid.split(':')[0],
    });

    try {
      // ── Step 0: Validate session ──
      log('STEP 0: Validating session (curl_cffi chrome120)', {});
      const validation = await callPython('validate', { sessionid, csrfToken });

      if (!validation.valid) {
        log('X SESSION INVALID', { reason: validation.reason });
        return json(res, 200, {
          ok: false,
          status: 'session_invalid',
          error: validation.reason,
        });
      }
      log('OK SESSION VALID', {
        username: validation.username,
        userId: validation.userId,
        hasFbDtsg: validation.has_fb_dtsg,
      });

      // ── Step 1: Resolve recipient userId ──
      log('STEP 1: Resolving recipient userId', { username: recipient });
      const resolved = await callPython('resolve', { sessionid, csrfToken, username: recipient });

      if (!resolved.userId) {
        log('X RESOLVE FAILED', { reason: resolved.reason });
        return json(res, 200, {
          ok: false,
          status: 'resolve_failed',
          error: `Could not resolve @${recipient}: ${resolved.reason}`,
        });
      }
      log('OK userId resolved', { username: recipient, userId: resolved.userId });

      // ── Step 2: Send DM via GraphQL IGDirectTextSendMutation ──
      log('STEP 2: Sending DM (GraphQL IGDirectTextSendMutation doc_id=28737274835943013)', {
        recipient,
        userId: resolved.userId,
        ownUserId: resolved.ownUserId,
      });
      const result = await callPython('debug', {
        sessionid, csrfToken, recipient, text,
      });

      log('PYTHON DEBUG RESULT', {
        ok: result.ok,
        step: result.step,
        statusCode: result.statusCode,
        userId: result.userId,
        ownUserId: result.ownUserId,
        threadId: result.threadId,
        recipientIgids: result.recipientIgids,
        offlineThreadingId: result.offlineThreadingId,
        graphqlErrors: result.graphqlErrors,
        responseBody: result.responseBody ? result.responseBody.substring(0, 300) : undefined,
      });

      return json(res, 200, {
        ok: result.ok,
        status: result.statusCode || result.status,
        body: result.body || result.responseBody,
        meta: {
          recipient,
          userId: result.userId || resolved.userId,
          ownUserId: result.ownUserId || resolved.ownUserId,
          threadId: result.threadId,
          offlineThreadingId: result.offlineThreadingId,
          recipientIgids: result.recipientIgids,
        },
        debug: {
          step: result.step,
          tokens: result.tokens,
          graphqlErrors: result.graphqlErrors,
          responseBodyRaw: result.responseBodyRaw,
        },
      });
    } catch (err) {
      log('X PYTHON ERROR', { message: err.message });
      return json(res, 502, {
        ok: false,
        error: `Python worker error: ${err.message}`,
      });
    }
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// ──────────────────────────────────────────────
// HTTP Server
// ──────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/api/status') {
    (async () => {
      try {
        const resDaemon = await fetch(`http://127.0.0.1:${DAEMON_PORT}/status`, { signal: AbortSignal.timeout(2000) });
        if (resDaemon.ok) {
          const d = await resDaemon.json();
          return json(res, 200, { ok: true, daemon: true, browser: d.browser || 'ready', driver_active: Boolean(d.driver_active) });
        }
      } catch {}
      return json(res, 200, { ok: true, daemon: false, browser: 'starting', driver_active: false });
    })();
    return;
  }

  if (req.method === 'POST') {
    if (req.url === '/api/verify-session') return handleVerifySession(req, res);
    if (req.url === '/api/resolve-recipients') return handleResolveRecipients(req, res);
    if (req.url === '/api/send-dm') return proxyToInstagram(req, res);
  }

  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(__dirname, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n  Instagram DM Manager (GraphQL Mutation Mode)`);
  console.log(`  --------------------------------------------`);
  console.log(`  UI     => http://localhost:${PORT}`);
  console.log(`  Proxy  => POST http://localhost:${PORT}/api/send-dm`);
  console.log(`  Worker => Python curl_cffi (chrome120 TLS)`);
  console.log(`  Method => IGDirectTextSendMutation doc_id=28737274835943013`);
  console.log(`  Ready.\n`);
});