import http from 'http';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { randomUUID } from 'crypto';
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

const IG_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const IG_APP_ID = '936619743392459';

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
// Normalize sessionid: decode %3A → : and strip
// any surrounding quotes/whitespace the browser
// might have added.
// ──────────────────────────────────────────────
function normalizeSessionid(raw) {
  if (!raw) return '';
  return raw
    .trim()
    .replace(/^['"]|['"]$/g, '')   // strip wrapping quotes
    .replace(/%3A/gi, ':')          // URL-decode colons
    .replace(/%3B/gi, ';');         // URL-decode semicolons (rare)
}

// ──────────────────────────────────────────────
// Extract ds_user_id from the sessionid string.
// Format: <userId>:<token>
// ──────────────────────────────────────────────
function extractUserId(sessionid) {
  const m = sessionid.match(/^(\d+):/);
  return m ? m[1] : null;
}

// ──────────────────────────────────────────────
// Validate session — try multiple endpoints and
// both GET and POST, with correct cookies.
// ──────────────────────────────────────────────
function validateSession(sessionid, csrfToken) {
  return new Promise(async (resolve) => {
    const dsUserId = extractUserId(sessionid);

    const cookie = [
      `sessionid=${sessionid}`,
      `csrftoken=${csrfToken || ''}`,
      `ds_user_id=${dsUserId || ''}`,
      `mid=BGH9pgAAAAEBG6gQ2YmY2`,
      `ig_did=${randomUUID()}`,
    ].join('; ');

    const commonHeaders = {
      'User-Agent': IG_UA,
      'Cookie': cookie,
      'X-CSRFToken': csrfToken || '',
      'X-IG-App-ID': IG_APP_ID,
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': 'https://www.instagram.com',
      'Referer': 'https://www.instagram.com/',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    // Try GET first (lighter, no body needed)
    const tryGet = () => new Promise((done) => {
      const req = https.request({
        hostname: 'i.instagram.com',
        path: '/api/v1/users/current_user/',
        method: 'GET',
        headers: commonHeaders,
        timeout: 10000,
      }, igRes => {
        let data = '';
        igRes.on('data', d => { data += d; });
        igRes.on('end', () => {
          log('VALIDATE (GET i.instagram.com)', {
            statusCode: igRes.statusCode,
            contentType: igRes.headers['content-type'] || 'none',
            bodyPreview: data.substring(0, 300),
          });
          done(data);
        });
      });
      req.on('error', (e) => { log('VALIDATE (GET) ERROR', e.message); done(''); });
      req.on('timeout', () => { req.destroy(); log('VALIDATE (GET) TIMEOUT', {}); done(''); });
      req.end();
    });

    // Fallback: POST to www.instagram.com
    const tryPost = () => new Promise((done) => {
      const postData = new URLSearchParams({ csrf: csrfToken || '' }).toString();
      const req = https.request({
        hostname: 'www.instagram.com',
        path: '/api/v1/users/current_user/',
        method: 'POST',
        headers: {
          ...commonHeaders,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 10000,
      }, igRes => {
        let data = '';
        igRes.on('data', d => { data += d; });
        igRes.on('end', () => {
          log('VALIDATE (POST www.instagram.com)', {
            statusCode: igRes.statusCode,
            contentType: igRes.headers['content-type'] || 'none',
            bodyPreview: data.substring(0, 300),
          });
          done(data);
        });
      });
      req.on('error', (e) => { log('VALIDATE (POST) ERROR', e.message); done(''); });
      req.on('timeout', () => { req.destroy(); log('VALIDATE (POST) TIMEOUT', {}); done(''); });
      req.write(postData);
      req.end();
    });

    // Run GET, fallback to POST
    let data = await tryGet();
    if (!data || data.includes('<!DOCTYPE') || data.includes('not-logged-in') || data.trim() === '') {
      data = await tryPost();
    }

    if (!data || data.includes('<!DOCTYPE') || data.includes('not-logged-in') || data.includes('Page Not Found')) {
      return resolve({
        valid: false,
        reason: `Session rejected — Instagram returned HTML login page. ds_user_id extracted: ${dsUserId || 'none'}. Check that sessionid and csrftoken are from the SAME browser session and the session is still active.`,
      });
    }

    try {
      const parsed = JSON.parse(data);
      if (parsed.user?.pk || parsed.user?.pk_id) {
        return resolve({
          valid: true,
          username: parsed.user.username,
          userId: parsed.user.pk || parsed.user.pk_id,
          fullName: parsed.user.full_name,
        });
      }
      if (parsed.message || parsed.error_type || parsed.status === 'fail') {
        return resolve({ valid: false, reason: parsed.message || 'Session rejected by Instagram.' });
      }
      return resolve({ valid: false, reason: 'Unexpected response (no user object).' });
    } catch {
      return resolve({ valid: false, reason: 'Response is not JSON.' });
    }
  });
}

// ──────────────────────────────────────────────
// Resolve username → numeric user ID
// ──────────────────────────────────────────────
function resolveUserId(username, sessionid, csrfToken, selfUserId) {
  return new Promise((resolve) => {
    const dsUserId = extractUserId(sessionid);
    const cookie = [
      `sessionid=${sessionid}`,
      `csrftoken=${csrfToken || ''}`,
      `ds_user_id=${dsUserId || selfUserId || ''}`,
    ].join('; ');

    const req = https.request({
      hostname: 'i.instagram.com',
      path: `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      method: 'GET',
      headers: {
        'User-Agent': IG_UA,
        'Cookie': cookie,
        'X-CSRFToken': csrfToken || '',
        'X-IG-App-ID': IG_APP_ID,
        'Origin': 'https://www.instagram.com',
        'Referer': `https://www.instagram.com/${username}/`,
        'Accept': 'application/json, text/plain, */*',
      },
      timeout: 10000,
    }, igRes => {
      let data = '';
      igRes.on('data', d => { data += d; });
      igRes.on('end', () => {
        log('RESOLVE userId (web_profile_info)', {
          statusCode: igRes.statusCode,
          contentType: igRes.headers['content-type'] || 'none',
          bodyPreview: data.substring(0, 300),
        });

        if (data.includes('<!DOCTYPE') || data.includes('not-logged-in')) {
          return resolve({ userId: null, reason: 'Session rejected during profile lookup (got HTML login page)' });
        }

        try {
          const parsed = JSON.parse(data);
          const id = parsed?.data?.user?.id;
          if (id) {
            log('✓ userId found', { username, userId: id });
            return resolve({ userId: id, reason: null });
          }
          if (parsed.message) {
            return resolve({ userId: null, reason: parsed.message });
          }
          return resolve({ userId: null, reason: 'No user.id in response' });
        } catch {
          return resolve({ userId: null, reason: 'Non-JSON response' });
        }
      });
    });
    req.on('error', (e) => resolve({ userId: null, reason: `Network error: ${e.message}` }));
    req.on('timeout', () => { req.destroy(); resolve({ userId: null, reason: 'Timeout' }); });
    req.end();
  });
}

// ──────────────────────────────────────────────
// Send DM via direct_v2
// ──────────────────────────────────────────────
function sendDM({ sessionid, csrfToken, userId, recipient, text }) {
  return new Promise((resolve) => {
    const dsUserId = extractUserId(sessionid) || userId;
    const clientContext = randomUUID();
    const deviceId = randomUUID();

    const formBody = new URLSearchParams({
      recipient_users: JSON.stringify([String(userId)]),
      link_urls: JSON.stringify([]),
      text,
      action: 'send_item',
      client_context: clientContext,
      mutation_token: clientContext,
      _csrftoken: csrfToken || '',
      _uuid: deviceId,
      device_id: deviceId,
      nav_chain: '[12_12w:1b2H2S:1b2H2S:1b2H2S:12_12w:1b2H2S:1b2H2S:1b2H2S:12_12w:1b2H2S:1b2H2S:1b2H2S:12_12w:1b2H2S:1b2H2S:1b2H2S:12_12w:1b2H2S:1b2H2S:1b2H2S]',
    }).toString();

    const cookie = [
      `sessionid=${sessionid}`,
      `csrftoken=${csrfToken || ''}`,
      `ds_user_id=${dsUserId}`,
      `ig_did=${deviceId}`,
      `mid=BGH9pgAAAAEBG6gQ2YmY2`,
    ].join('; ');

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(formBody),
      'Cookie': cookie,
      'User-Agent': IG_UA,
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRFToken': csrfToken || '',
      'X-IG-App-ID': IG_APP_ID,
      'X-ASBD-ID': '129477',
      'Origin': 'https://www.instagram.com',
      'Referer': 'https://www.instagram.com/',
      'Accept': 'application/json, text/plain, */*',
    };

    log('SEND DM (direct_v2/threads/broadcast/text)', {
      recipient,
      userId,
      formFields: Object.fromEntries(new URLSearchParams(formBody).entries()),
    });

    const igReq = https.request({
      hostname: 'www.instagram.com',
      path: '/api/v1/direct_v2/threads/broadcast/text/',
      method: 'POST',
      headers,
      timeout: 15000,
    }, igRes => {
      let data = '';
      igRes.on('data', d => { data += d; });
      igRes.on('end', () => {
        log('DM RESPONSE', {
          statusCode: igRes.statusCode,
          statusMessage: igRes.statusMessage,
          bodyPreview: data.substring(0, 500),
        });

        const isJson = data.trim().startsWith('{') || data.trim().startsWith('[');
        let parsed;
        if (isJson) {
          try { parsed = JSON.parse(data); } catch { parsed = { raw: data.substring(0, 300) }; }
        } else {
          parsed = { raw: data.substring(0, 300), contentType: igRes.headers['content-type'] };
          const titleMatch = data.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          if (titleMatch) parsed.htmlTitle = titleMatch[1].trim();
        }

        const ok = igRes.statusCode >= 200 && igRes.statusCode < 300;
        const threadId = parsed?.payload?.thread_id || parsed?.thread_id || null;

        log(ok ? '✓ DM SENT' : '✗ DM FAILED', {
          recipient, userId, threadId, statusCode: igRes.statusCode, body: parsed,
        });

        resolve({ ok, statusCode: igRes.statusCode, body: parsed, threadId });
      });
    });

    igReq.on('error', err => {
      log('✗ PROXY ERROR', { message: err.message });
      resolve({ ok: false, statusCode: 0, error: err.message });
    });
    igReq.on('timeout', () => {
      igReq.destroy();
      log('✗ TIMEOUT', { message: 'Instagram request timed out after 15s' });
      resolve({ ok: false, statusCode: 0, error: 'Request timed out' });
    });

    igReq.write(formBody);
    igReq.end();
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

    // Normalize: decode %3A → : and strip quotes
    const sessionid = normalizeSessionid(rawSessionid);

    log('═══ NEW DM REQUEST ═══', {
      recipient,
      textLength: text.length,
      textPreview: text.substring(0, 100),
      csrfToken: csrfToken ? `${csrfToken.slice(0, 8)}…` : '(none)',
      sessionidRaw: rawSessionid.substring(0, 20) + '…',
      sessionidNormalized: sessionid.substring(0, 20) + '…',
      dsUserId: extractUserId(sessionid),
    });

    // ── Step 0: Validate session ──
    log('STEP 0: Validating session', { method: 'GET + POST fallback' });
    const validation = await validateSession(sessionid, csrfToken);

    if (!validation.valid) {
      log('✗ SESSION INVALID', { reason: validation.reason });
      return json(res, 200, {
        ok: false,
        status: 'session_invalid',
        error: validation.reason,
      });
    }
    log('✓ SESSION VALID', { username: validation.username, userId: validation.userId });

    // ── Step 1: Resolve recipient userId ──
    log('STEP 1: Resolving recipient userId', { username: recipient });
    const { userId, reason } = await resolveUserId(recipient, sessionid, csrfToken, validation.userId);

    if (!userId) {
      log('✗ RESOLVE FAILED', { reason });
      return json(res, 200, {
        ok: false,
        status: 'resolve_failed',
        error: `Could not resolve @${recipient}: ${reason}`,
      });
    }
    log('✓ userId resolved', { username: recipient, userId });

    // ── Step 2: Send DM ──
    log('STEP 2: Sending DM', { recipient, userId });
    const result = await sendDM({
      sessionid, csrfToken, userId, recipient, text,
    });

    return json(res, 200, {
      ok: result.ok,
      status: result.statusCode,
      body: result.body,
      meta: { recipient, userId, threadId: result.threadId },
    });
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
  console.log(`  UI    → http://localhost:${PORT}`);
  console.log(`  Proxy → POST http://localhost:${PORT}/api/send-dm`);
  console.log(`  Watching console for full request/response logs…\n`);
});