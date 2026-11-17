import http from 'http';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 5050;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

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
// Call Python worker for a single operation
// ──────────────────────────────────────────────
function callPython(command, payload) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'ig_worker.py');
    const arg = JSON.stringify(payload);
    // Use execFile to avoid shell escaping issues
    execFile('python', [workerPath, command, arg], {
      cwd: __dirname,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      if (err) {
        // Log stderr for debugging
        if (stderr) {
          stderr.toString().trim().split('\n').forEach(l => {
            if (l.trim()) console.log('  [python stderr] ' + l.trim());
          });
        }
        return reject(new Error(err.message));
      }

      // Parse stdout as JSON
      const lines = stdout.toString().trim().split('\n');
      // Last non-empty line is the JSON result
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
// Main proxy handler
// ──────────────────────────────────────────────
function proxyToInstagram(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    let payload;
    try { payload = JSON.parse(body); }
    catch { return json(res, 400, { ok: false, error: 'Invalid JSON body' }); }

    const { sessionid: rawSessionid, recipient, text } = payload;
    const csrfToken = (payload.csrfToken || '').trim();

    if (!rawSessionid)  return json(res, 400, { ok: false, error: 'Missing sessionid' });
    if (!recipient)     return json(res, 400, { ok: false, error: 'Missing recipient' });
    if (!text)          return json(res, 400, { ok: false, error: 'Missing text' });

    // Normalize sessionid: decode %3A → :
    const sessionid = rawSessionid.replace(/%3A/gi, ':').replace(/%3B/gi, ';').trim();

    log('═══ NEW DM REQUEST ═══', {
      recipient,
      textLength: text.length,
      textPreview: text.substring(0, 100),
      csrfToken: csrfToken ? `${csrfToken.slice(0, 8)}…` : '(none)',
      sessionidPreview: sessionid.substring(0, 20) + '…',
      dsUserId: sessionid.split(':')[0],
    });

    try {
      // ── Step 0: Validate session ──
      log('STEP 0: Validating session (curl_cffi chrome120)', {});
      const validation = await callPython('validate', { sessionid, csrfToken });

      if (!validation.valid) {
        log('✗ SESSION INVALID', { reason: validation.reason });
        return json(res, 200, {
          ok: false,
          status: 'session_invalid',
          error: validation.reason,
        });
      }
      log('✓ SESSION VALID', {
        username: validation.username,
        userId: validation.userId,
        hasFbDtsg: validation.has_fb_dtsg,
      });

      // ── Step 1: Resolve recipient userId ──
      log('STEP 1: Resolving recipient userId', { username: recipient });
      const resolved = await callPython('resolve', { sessionid, csrfToken, username: recipient });

      if (!resolved.userId) {
        log('✗ RESOLVE FAILED', { reason: resolved.reason });
        return json(res, 200, {
          ok: false,
          status: 'resolve_failed',
          error: `Could not resolve @${recipient}: ${resolved.reason}`,
        });
      }
      log('✓ userId resolved', { username: recipient, userId: resolved.userId });

      // ── Step 2: Send DM (with full debug logging) ──
      log('STEP 2: Sending DM (direct_v2 with fb_dtsg tokens)', {
        recipient,
        userId: resolved.userId,
        ownUserId: resolved.ownUserId,
      });
      const result = await callPython('debug', {
        sessionid, csrfToken, recipient, text,
      });

      // Log full result for terminal visibility
      log('PYTHON DEBUG RESULT', {
        ok: result.ok,
        step: result.step,
        statusCode: result.statusCode,
        userId: result.userId,
        ownUserId: result.ownUserId,
        tokens: result.tokens,
        responseHeaders: result.responseHeaders,
        formFieldsSent: result.formFieldsSent,
        responseBody: result.responseBody,
        responseBodyRaw: result.responseBodyRaw ? result.responseBodyRaw.substring(0, 300) : undefined,
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
        },
        debug: {
          step: result.step,
          tokens: result.tokens,
          responseHeaders: result.responseHeaders,
          formFieldsSent: result.formFieldsSent,
          responseBodyRaw: result.responseBodyRaw,
        },
      });
    } catch (err) {
      log('✗ PYTHON ERROR', { message: err.message });
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

  if (req.method === 'POST' && req.url === '/api/send-dm') {
    return proxyToInstagram(req, res);
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
  console.log(`\n  Instagram DM Manager`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  UI     → http://localhost:${PORT}`);
  console.log(`  Proxy  → POST http://localhost:${PORT}/api/send-dm`);
  console.log(`  Worker → Python curl_cffi (chrome120 TLS)`);
  console.log(`  Ready.\n`);
});