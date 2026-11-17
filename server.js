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

const IG_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
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
// Step 1: Resolve username → numeric user ID
// Uses Instagram's GraphQL endpoint (same one the
// web client uses to render profiles).
// ──────────────────────────────────────────────
function resolveUserId(username, sessionid, csrfToken) {
  return new Promise((resolve) => {
    const docId = '7898364790222749'; // ProfileInfo query ID used by instagram.com
    const variables = JSON.stringify({ username, __relay_internal__pv__PolarisIsLoggedInrelayprovider: true });

    const postData = new URLSearchParams({
      av: '0',
      __d: 'dis',
      __user: '0',
      __a: '1',
      __req: Math.floor(Math.random() * 999999).toString(),
      dpr: '1',
      __ccg: 'UNKNOWN',
      __rev: '1016000000',
      __s: '',
      __hsi: '',
      __dyn: '',
      __csr: '',
      __comet_req: '0',
      fb_dtsg: '',
      jazoest: '',
      lsd: '',
      __spin_r: '1016000000',
      __spin_b: 'trunk',
      __spin_t: '',
      __crn: '',
      variables,
      doc_id: docId,
    }).toString();

    const cookie = [
      `sessionid=${sessionid}`,
      `csrftoken=${csrfToken || ''}`,
      `mid=anonymous`,
      `ig_did=${randomUUID()}`,
    ].join('; ');

    const req = https.request({
      hostname: 'www.instagram.com',
      path: '/graphql/query/',
      method: 'POST',
      headers: {
        ...IG_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Cookie': cookie,
        'X-FB-LSD': '',
        'X-ASBD-ID': '129477',
        'X-CSRFToken': csrfToken || '',
        'X-IG-App-ID': '936619743392459',
        'Origin': 'https://www.instagram.com',
        'Referer': `https://www.instagram.com/${username}/`,
      },
      timeout: 10000,
    }, igRes => {
      let data = '';
      igRes.on('data', d => { data += d; });
      igRes.on('end', () => {
        log('STEP 1: Profile lookup response', {
          statusCode: igRes.statusCode,
          bodyPreview: data.substring(0, 300),
        });
        try {
          const parsed = JSON.parse(data);
          const user = parsed?.data?.user
            || parsed?.data?.xdt_api__v1__feed__user_timeline_graphql_connection?.user
            || null;
          // Try multiple paths
          const id = parsed?.data?.user?.id
            || parsed?.data?.user?.pk
            || user?.id
            || parsed?.user?.id
            || null;
          resolve(id);
        } catch {
          log('STEP 1: JSON parse failed', { raw: data.substring(0, 200) });
          resolve(null);
        }
      });
    });
    req.on('error', (e) => { log('STEP 1 ERROR', e.message); resolve(null); });
    req.on('timeout', () => { req.destroy(); log('STEP 1 TIMEOUT', {}); resolve(null); });
    req.write(postData);
    req.end();
  });
}

// ──────────────────────────────────────────────
// Step 1b: Fallback resolver — use ranked recipients
// endpoint which returns user IDs directly.
// ──────────────────────────────────────────────
function resolveViaRankedRecipients(query, sessionid, csrfToken) {
  return new Promise((resolve) => {
    const postData = new URLSearchParams({
      csrf_token: csrfToken || '',
      has_selected: 'false',
      query: query,
    }).toString();

    const req = https.request({
      hostname: 'www.instagram.com',
      path: '/api/v1/direct_v2/ranked_recipients/',
      method: 'POST',
      headers: {
        ...IG_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Cookie': `sessionid=${sessionid}; csrftoken=${csrfToken || ''}`,
        'X-CSRFToken': csrfToken || '',
        'X-IG-App-ID': '936619743392459',
        'Origin': 'https://www.instagram.com',
        'Referer': 'https://www.instagram.com/',
      },
      timeout: 10000,
    }, igRes => {
      let data = '';
      igRes.on('data', d => { data += d; });
      igRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const users = parsed?.ranked_recipients || [];
          // Find exact username match
          const match = users.find(u =>
            u?.user?.username?.toLowerCase() === query.toLowerCase()
          );
          if (match) {
            log('STEP 1b (ranked_recipients): found', {
              username: match.user.username,
              userId: match.user.pk || match.user.pk_id,
            });
            resolve(match.user.pk || match.user.pk_id);
          } else {
            // Return first result as best effort
            const first = users[0];
            log('STEP 1b (ranked_recipients): no exact match, first result', {
              query,
              results: users.length,
            });
            resolve(first?.user?.pk || first?.user?.pk_id || null);
          }
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(postData);
    req.end();
  });
}

// ──────────────────────────────────────────────
// Step 1c: Direct API — get user info by username
// ──────────────────────────────────────────────
function resolveViaUserInfo(username, sessionid, csrfToken) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'i.instagram.com',
      path: `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      method: 'GET',
      headers: {
        ...IG_HEADERS,
        'Cookie': `sessionid=${sessionid}; csrftoken=${csrfToken || ''}`,
        'X-CSRFToken': csrfToken || '',
        'X-IG-App-ID': '936619743392459',
        'Origin': 'https://www.instagram.com',
        'Referer': `https://www.instagram.com/${username}/`,
      },
      timeout: 10000,
    }, igRes => {
      let data = '';
      igRes.on('data', d => { data += d; });
      igRes.on('end', () => {
        log('STEP 1c (web_profile_info): response', {
          statusCode: igRes.statusCode,
          bodyPreview: data.substring(0, 300),
        });
        try {
          const parsed = JSON.parse(data);
          const id = parsed?.data?.user?.id;
          resolve(id || null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
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

    const { sessionid, recipient, text } = payload;
    let { csrfToken, deviceId } = payload;

    if (!sessionid)  return json(res, 400, { ok: false, error: 'Missing sessionid' });
    if (!recipient)  return json(res, 400, { ok: false, error: 'Missing recipient' });
    if (!text)       return json(res, 400, { ok: false, error: 'Missing text' });

    csrfToken = csrfToken || '';
    deviceId  = deviceId  || randomUUID();

    log('═══ NEW DM REQUEST ═══', {
      recipient,
      textLength: text.length,
      textPreview: text.substring(0, 100),
      csrfToken: csrfToken ? `${csrfToken.slice(0, 8)}…` : '(none)',
      deviceId,
    });

    // ── Resolve username → userId (try all 3 methods) ──
    log('STEP 1: Resolving user ID', { username: recipient, method: 'web_profile_info' });
    let userId = await resolveViaUserInfo(recipient, sessionid, csrfToken);

    if (!userId) {
      log('STEP 1: web_profile_info failed, trying ranked_recipients', {});
      userId = await resolveViaRankedRecipients(recipient, sessionid, csrfToken);
    }

    if (!userId) {
      log('STEP 1: ranked_recipients failed, trying GraphQL', {});
      userId = await resolveUserId(recipient, sessionid, csrfToken);
    }

    if (!userId) {
      log('✗ STEP 1 FAILED — all 3 resolvers returned null', {});
      return json(res, 200, {
        ok: false,
        status: 'resolve_failed',
        error: `Could not resolve user ID for @${recipient}. All 3 lookup methods failed. Check sessionid is valid and profile exists.`,
      });
    }

    log('✓ STEP 1 OK — userId resolved', { username: recipient, userId });

    // ── Step 2: Send DM via direct_v2 ──
    const clientContext = randomUUID();
    const navChain = `[12_12w:1b2H2S:1b2H2S:1b2H2S:12_12w:1b2H2S:1b2H2S:1b2H2S:12_12w:1b2H2S:1b2H2S:1b2H2S:12_12w:1b2H2S:1b2H2S:1b2H2S:12_12w:1b2H2S:1b2H2S:1b2H2S]`;

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
      nav_chain: navChain,
      is_online: 'true',
      using_fetch: 'true',
      z: '',
      route: '',
      entry_point: 'self_profile',
    }).toString();

    const cookie = [
      `sessionid=${sessionid}`,
      `csrftoken=${csrfToken}`,
      `ds_user_id=${userId}`,
      `ig_did=${deviceId}`,
    ].join('; ');

    const proxyHeaders = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(formBody),
      'Cookie': cookie,
      'User-Agent': IG_HEADERS['User-Agent'],
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRFToken': csrfToken,
      'X-IG-App-ID': '936619743392459',
      'X-IG-WWW-Claim': 'hmac.AR4z4nCUgTWkLu4E6B8n6N1VxW3jJzM5H',
      'X-ASBD-ID': '129477',
      'Origin': 'https://www.instagram.com',
      'Referer': 'https://www.instagram.com/',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    log('STEP 2: Sending DM', {
      endpoint: 'POST /api/v1/direct_v2/threads/broadcast/text/',
      formFields: Object.fromEntries(new URLSearchParams(formBody).entries()),
      userId,
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
      });

      let data = '';
      igRes.on('data', d => { data += d; });
      igRes.on('end', () => {
        // Instagram may return HTML on error — detect and extract message
        const isJson = data.trim().startsWith('{') || data.trim().startsWith('[');
        let parsed;
        if (isJson) {
          try { parsed = JSON.parse(data); } catch { parsed = { raw: data.substring(0, 500) }; }
        } else {
          // HTML error page — extract useful info
          parsed = { raw: data.substring(0, 500), contentType: igRes.headers['content-type'] };
          const titleMatch = data.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          if (titleMatch) parsed.htmlTitle = titleMatch[1].trim();
          const msgMatch = data.match(/Sorry[^<]*|error[^<]*/i);
          if (msgMatch) parsed.htmlMessage = msgMatch[0];
        }

        log('← RESPONSE BODY', {
          isJson,
          preview: data.substring(0, 500),
        });

        const ok = igRes.statusCode >= 200 && igRes.statusCode < 300;

        // Extract thread ID if successful
        const threadId = parsed?.payload?.thread_id || parsed?.thread_id || null;

        log(ok ? '✓ DM SENT' : '✗ DM FAILED', {
          recipient,
          userId,
          threadId,
          statusCode: igRes.statusCode,
          body: parsed,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok,
          status: igRes.statusCode,
          body: parsed,
          meta: { recipient, userId, threadId, clientContext },
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