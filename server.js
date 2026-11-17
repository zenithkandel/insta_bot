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

// ──────────────────────────────────────────────
// Structured console logger
// ──────────────────────────────────────────────
function log(label, data) {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  const lines = (typeof data === 'string' ? data : JSON.stringify(data, null, 2)).split('\n');
  console.log(`\n[${ts}] ── ${label} ──`);
  lines.forEach(l => console.log('  ' + l));
}

// ──────────────────────────────────────────────
// Resolve a numeric user ID from a username
// via Instagram's public web profile page.
// ──────────────────────────────────────────────
function resolveUserId(username, sessionid, csrfToken, deviceId) {
  return new Promise((resolve) => {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Cookie': `sessionid=${sessionid}; csrftoken=${csrfToken || ''}`,
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRFToken': csrfToken || '',
      'Referer': `https://www.instagram.com/${username}/`,
      'Accept': '*/*',
    };

    const req = https.request({
      hostname: 'www.instagram.com',
      path: `/${username}/?__a=1&__d=dis`,
      method: 'GET',
      headers,
      timeout: 10000,
    }, igRes => {
      let data = '';
      igRes.on('data', d => { data += d; });
      igRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // Try new format first, then fall back to old graphql format
          const id = parsed?.graphql?.user?.id
            || parsed?.data?.user?.id
            || parsed?.user?.id
            || null;
          resolve(id);
        } catch {
          // Fallback: regex extract from HTML page source
          const m = data.match(/"profilePage_(\d+)"/) || data.match(/profile_id["\s:]+(\d+)/);
          resolve(m ? m[1] : null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ──────────────────────────────────────────────
// Send DM via Instagram's private direct_v2 API
// Endpoint: POST /api/v1/direct_v2/threads/broadcast/text/
// ──────────────────────────────────────────────
function proxyToInstagram(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    let payload;
    try { payload = JSON.parse(body); }
    catch { return json(res, 400, { ok: false, error: 'Invalid JSON body' }); }

    const { sessionid, recipient, text } = payload;
    let { csrfToken, deviceId } = payload;

    if (!sessionid)  return json(res, 400, { ok: false, error: 'Missing sessionid' });
    if (!recipient)  return json(res, 400, { ok: false, error: 'Missing recipient' });
    if (!text)       return json(res, 400, { ok: false, error: 'Missing text' });

    csrfToken = csrfToken || '';
    deviceId  = deviceId  || randomUUID();

    log('→ OUTGOING REQUEST', {
      endpoint: '/api/v1/direct_v2/threads/broadcast/text/',
      recipient,
      textLength: text.length,
      textPreview: text.substring(0, 80) + (text.length > 80 ? '…' : ''),
      csrfToken: csrfToken ? `${csrfToken.slice(0, 8)}…` : '(none)',
      deviceId,
    });

    // ── Step 1: Resolve username → user ID ──
    log('STEP 1: Resolving user ID', { username: recipient });
    const userId = await resolveUserId(recipient, sessionid, csrfToken, deviceId);

    if (!userId) {
      log('STEP 1 FAILED', { error: 'Could not resolve user ID from username' });
      return json(res, 200, {
        ok: false,
        status: 'resolve_failed',
        error: `Could not resolve numeric ID for @${recipient}. Profile may be private or username misspelled.`,
      });
    }
    log('STEP 1 OK', { username: recipient, userId });

    // ── Step 2: Send the DM ──
    const clientContext = randomUUID();
    const formBody = new URLSearchParams({
      recipient_users: JSON.stringify([userId]),
      link_urls: JSON.stringify([]),
      text,
      action: 'send_item',
      client_context: clientContext,
      mutation_token: clientContext,
      _csrftoken: csrfToken,
      _uuid: deviceId,
      device_id: deviceId,
      nav_chain: '[12_12w:1b2H2S:1b2H2S:1b2H2S:12_12w:1b2H2S:1b2H2S:1b2H2S:12_12w:1b2H2S:1b2H2S:1b2H2S:12_12w:1b2H2S:1b2H2S:1b2H2S:12_12w:1b2H2S:1b2H2S:1b2H2S]',
    }).toString();

    const proxyHeaders = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(formBody),
      'Cookie': `sessionid=${sessionid}; csrftoken=${csrfToken}; ds_user_id=${userId}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRFToken': csrfToken,
      'X-IG-App-ID': '936619743392459',
      'X-IG-WWW-Claim': 'hmac.AR4z4nCUgTWkLu4E6B8n6N1VxW3jJzM5H',
      'X-ASBD-ID': '129477',
      'Origin': 'https://www.instagram.com',
      'Referer': 'https://www.instagram.com/',
      'Accept': '*/*',
    };

    log('STEP 2: Sending DM', {
      endpoint: '/api/v1/direct_v2/threads/broadcast/text/',
      formFields: Object.fromEntries(new URLSearchParams(formBody).entries()),
      formBodyPreview: formBody.substring(0, 200) + '…',
      headers: Object.fromEntries(
        Object.entries(proxyHeaders).map(([k, v]) =>
          [k, k === 'Cookie' ? v.replace(sessionid, sessionid.slice(0, 8) + '…') : v]
        )
      ),
    });

    const opts = new URL('https://www.instagram.com/api/v1/direct_v2/threads/broadcast/text/');
    const igReq = https.request({
      hostname: opts.hostname,
      path: opts.pathname,
      method: 'POST',
      headers: proxyHeaders,
      timeout: 15000,
    }, igRes => {
      log('← INSTAGRAM RESPONSE', {
        statusCode: igRes.statusCode,
        statusMessage: igRes.statusMessage,
        headers: igRes.headers,
      });

      let data = '';
      igRes.on('data', d => { data += d; });
      igRes.on('end', () => {
        log('← INSTAGRAM RESPONSE BODY', data.substring(0, 1000));

        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = { raw: data }; }

        const ok = igRes.statusCode >= 200 && igRes.statusCode < 300;

        log(ok ? '✓ DM SENT' : '✗ DM FAILED', {
          recipient,
          userId,
          statusCode: igRes.statusCode,
          body: parsed,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok,
          status: igRes.statusCode,
          body: parsed,
          meta: { recipient, userId, clientContext },
        }));
      });
    });

    igReq.on('error', err => {
      log('✗ PROXY ERROR', { message: err.message });
      json(res, 502, { ok: false, error: `Proxy error: ${err.message}` });
    });
    igReq.on('timeout', () => {
      igReq.destroy();
      log('✗ TIMEOUT', { message: 'Instagram request timed out after 15s' });
      json(res, 504, { ok: false, error: 'Instagram request timed out' });
    });

    igReq.write(formBody);
    igReq.end();
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