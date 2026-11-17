import http from 'http';
import fs from 'fs';
import path from 'path';
import https from 'https';
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
// Proxy: forwards requests to instagram.com
// from the server (no CORS, cookies included).
// ──────────────────────────────────────────────
function proxyToInstagram(req, res) {
  const targetUrl = 'https://www.instagram.com/api/v1/direct_v2/web/threads/broadcast/text/';

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    // Client sends: { sessionid, recipient, text }
    let payload;
    try { payload = JSON.parse(body); }
    catch { return json(res, 400, { ok: false, error: 'Invalid JSON body' }); }

    if (!payload.sessionid) return json(res, 400, { ok: false, error: 'Missing sessionid' });
    if (!payload.recipient) return json(res, 400, { ok: false, error: 'Missing recipient' });
    if (!payload.text)      return json(res, 400, { ok: false, error: 'Missing text' });

    const formBody = new URLSearchParams({
      recipient_users: JSON.stringify([payload.recipient]),
      text: payload.text
    }).toString();

    const proxyHeaders = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(formBody),
      'Cookie': `sessionid=${payload.sessionid}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRFToken': payload.csrfToken || '',
      'Origin': 'https://www.instagram.com',
      'Referer': 'https://www.instagram.com/'
    };
    if (payload.csrfToken) proxyHeaders['X-CSRFToken'] = payload.csrfToken;

    const opts = new URL(targetUrl);
    const igReq = https.request({
      hostname: opts.hostname,
      path: opts.pathname,
      method: 'POST',
      headers: proxyHeaders,
      timeout: 15000
    }, igRes => {
      let data = '';
      igRes.on('data', d => { data += d; });
      igRes.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = { raw: data }; }
        res.writeHead(igRes.statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: igRes.statusCode >= 200 && igRes.statusCode < 300, status: igRes.statusCode, body: parsed }));
      });
    });

    igReq.on('error', err => {
      json(res, 502, { ok: false, error: `Proxy error: ${err.message}` });
    });
    igReq.on('timeout', () => {
      igReq.destroy();
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
// Static file server
// ──────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // CORS headers for the static server (so it works from any origin in dev)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Route: POST /api/send-dm  → proxy to Instagram
  if (req.method === 'POST' && req.url === '/api/send-dm') {
    return proxyToInstagram(req, res);
  }

  // Static files
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
    const mime = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`[Instagram DM Manager] running at http://localhost:${PORT}`);
  console.log(`[Instagram DM Manager] DM proxy  → POST http://localhost:${PORT}/api/send-dm`);
});