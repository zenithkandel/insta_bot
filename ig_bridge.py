"""
Instagram DM Bridge — uses curl_cffi (Chrome TLS impersonation) to bypass
Instagram's bot detection. All API calls go through Python subprocess.

Endpoints:
  POST /validate     { sessionid, csrftoken }  → { valid, username, userId }
  POST /resolve      { sessionid, username }   → { userId }
  POST /send-dm      { sessionid, csrftoken, recipient, text } → { ok, ... }

Run standalone:  python ig_bridge.py
Imported by server.js via child_process spawn.
"""
import json, re, sys, os, io, uuid
from http.server import HTTPServer, BaseHTTPRequestHandler
from curl_cffi import requests

# Force UTF-8 stdout on Windows (cp1252 can't encode box-drawing chars)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

PORT = 5051
IG_APP_ID = "936619743392459"
IG_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

def log(label, data):
    import datetime
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    print(f"\n[{ts}] ── {label} ──", flush=True)
    if isinstance(data, str):
        for l in data.split('\n'):
            print(f"  {l}", flush=True)
    else:
        print(f"  {json.dumps(data, indent=2)}", flush=True)

def make_session(sessionid, csrftoken):
    """Create a curl_cffi session with Chrome TLS fingerprint + user cookies."""
    s = requests.Session(impersonate="chrome120")
    # Get device cookies from homepage (datr, mid, ig_did, csrftoken)
    s.get("https://www.instagram.com/", headers={"Accept": "text/html"})
    # Overlay user's session
    ds_id = sessionid.split(":")[0] if ":" in sessionid else ""
    s.cookies.set("sessionid", sessionid, domain=".instagram.com")
    s.cookies.set("csrftoken", csrftoken, domain=".instagram.com")
    if ds_id:
        s.cookies.set("ds_user_id", ds_id, domain=".instagram.com")
    return s

def extract_tokens(html):
    """Extract fb_dtsg, jazoest, lsd, and app id from Instagram HTML page."""
    tokens = {}
    # fb_dtsg
    m = re.search(r'"DTSGInitialData",\[\],\{"token":"([^"]+)"', html)
    if m:
        tokens["fb_dtsg"] = m.group(1)
    else:
        m = re.search(r'"fb_dtsg":"([^"]+)"', html)
        if m:
            tokens["fb_dtsg"] = m.group(1)
        else:
            m = re.search(r'name="fb_dtsg"\s+value="([^"]+)"', html)
            if m:
                tokens["fb_dtsg"] = m.group(1)

    # jazoest — derived from fb_dtsg
    if "fb_dtsg" in tokens:
        def hash_val(s):
            h = 0
            for c in s:
                h = ((h << 5) - h + ord(c)) & 0xFFFFFFFF
            return h
        tokens["jazoest"] = str(hash_val(tokens["fb_dtsg"]))

    # lsd
    m = re.search(r'"LSD",\[\],\{"token":"([^"]+)"', html)
    if m:
        tokens["lsd"] = m.group(1)
    else:
        m = re.search(r'name="lsd"\s+value="([^"]+)"', html)
        if m:
            tokens["lsd"] = m.group(1)

    # __rev
    m = re.search(r'"client_revision":(\d+)', html)
    if m:
        tokens["rev"] = m.group(1)
    else:
        tokens["rev"] = "1016000000"

    # __spin_r
    m = re.search(r'"__spin_r":(\d+)', html)
    if m:
        tokens["spin_r"] = m.group(1)
    else:
        tokens["spin_r"] = tokens["rev"]

    # app id from HTML
    m = re.search(r'"app_id":"(\d+)"', html)
    if m:
        tokens["app_id"] = m.group(1)

    return tokens

def validate_session(sessionid, csrftoken):
    """Validate by loading Instagram homepage and checking login state."""
    log("VALIDATE: loading homepage", {})
    s = make_session(sessionid, csrftoken)
    r = s.get("https://www.instagram.com/", headers={"Accept": "text/html"})

    if r.status_code != 200:
        return {"valid": False, "reason": f"Homepage returned HTTP {r.status_code}"}

    # Check if logged in
    if "not-logged-in" in r.text[:5000]:
        # Try loading own profile page
        ds_id = sessionid.split(":")[0] if ":" in sessionid else ""
        if ds_id:
            r2 = s.get(f"https://www.instagram.com/{ds_id}/", headers={"Accept": "text/html"})
            if "not-logged-in" in r2.text[:5000]:
                return {"valid": False, "reason": "Session cookie not accepted — Instagram shows login page."}
        else:
            return {"valid": False, "reason": "Cannot extract ds_user_id from sessionid."}

    # Extract tokens from page
    tokens = extract_tokens(r.text)
    log("VALIDATE: extracted tokens", {k: v[:20] + "..." if len(v) > 20 else v for k, v in tokens.items()})

    # Get current user info from the page
    username = None
    user_id = sessionid.split(":")[0] if ":" in sessionid else None

    # Try to find username in page
    m = re.search(r'"username":"([^"]+)"', r.text)
    if m:
        username = m.group(1)

    log("VALIDATE: session valid", {"username": username, "userId": user_id, "tokens": list(tokens.keys())})
    return {
        "valid": True,
        "username": username,
        "userId": user_id,
        "tokens": tokens,
    }

def resolve_userid(sessionid, csrftoken, username):
    """Resolve username to numeric userId by loading their profile page HTML."""
    log(f"RESOLVE: @{username}", {})
    s = make_session(sessionid, csrftoken)

    r = s.get(f"https://www.instagram.com/{username}/", headers={"Accept": "text/html"})
    log("RESOLVE: profile page response", {"status": r.status_code, "length": len(r.text)})

    if r.status_code != 200:
        return {"userId": None, "reason": f"HTTP {r.status_code}"}

    # Primary pattern from SSR
    m = re.search(r'"profilePage_(\d+)"', r.text)
    if m:
        user_id = m.group(1)
        log(f"RESOLVE: found userId={user_id}", {})
        return {"userId": user_id, "reason": None}

    # Fallback patterns
    for pattern in [r'"user_id":"(\d+)"', r'"pk":"(\d+)"', r'"id":"(\d+)"']:
        m = re.search(pattern, r.text)
        if m:
            log(f"RESOLVE: found via fallback pattern, userId={m.group(1)}", {})
            return {"userId": m.group(1), "reason": None}

    # Check if page shows login wall
    if "not-logged-in" in r.text[:5000]:
        return {"userId": None, "reason": "Session rejected — got login page"}

    return {"userId": None, "reason": "userId not found in page SSR data"}

def send_dm(sessionid, csrftoken, recipient, text):
    """Send a DM via the direct_v2 broadcast endpoint using GraphQL tokens."""
    log(f"SEND DM: @{recipient}", {"textLength": len(text)})

    # Step 1: Resolve userId
    resolved = resolve_userid(sessionid, csrftoken, recipient)
    if not resolved["userId"]:
        log("SEND DM: resolve failed", resolved)
        return {"ok": False, "reason": resolved["reason"]}

    user_id = resolved["userId"]
    log(f"SEND DM: userId resolved = {user_id}", {})

    # Step 2: Get fresh tokens from homepage
    s = make_session(sessionid, csrftoken)
    r = s.get("https://www.instagram.com/", headers={"Accept": "text/html"})
    tokens = extract_tokens(r.text)
    log("SEND DM: tokens extracted", {k: v[:15] + "..." if len(v) > 15 else v for k, v in tokens.items()})

    if not tokens.get("fb_dtsg"):
        log("SEND DM: ERROR — could not extract fb_dtsg", {})
        return {"ok": False, "reason": "Could not extract fb_dtsg token from Instagram page"}

    # Step 3: Send DM via direct_v2
    client_context = str(uuid.uuid4())
    device_id = str(uuid.uuid4())

    form_data = {
        "recipient_users": json.dumps([str(user_id)]),
        "link_urls": json.dumps([]),
        "text": text,
        "action": "send_item",
        "client_context": client_context,
        "mutation_token": client_context,
        "_csrftoken": csrftoken,
        "_uuid": device_id,
        "device_id": device_id,
        "nav_chain": "[12_12w:1b2H2S:1b2H2S:1b2H2S:12_12w:1b2H2S:1b2H2S:1b2H2S:12_12w:1b2H2S:1b2H2S:1b2H2S:12_12w:1b2H2S:1b2H2S:1b2H2S:12_12w:1b2H2S:1b2H2S:1b2H2S]",
    }

    headers = {
        "X-IG-App-ID": tokens.get("app_id", IG_APP_ID),
        "X-CSRFToken": csrftoken,
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://www.instagram.com",
        "Referer": "https://www.instagram.com/",
        "Accept": "application/json",
    }

    if tokens.get("fb_dtsg"):
        headers["X-FB-DTSG"] = tokens["fb_dtsg"]
    if tokens.get("lsd"):
        headers["X-FB-LSD"] = tokens["lsd"]

    log("SEND DM: POST to direct_v2", {
        "endpoint": "/api/v1/direct_v2/threads/broadcast/text/",
        "recipient": recipient,
        "userId": user_id,
    })

    r2 = s.post(
        "https://www.instagram.com/api/v1/direct_v2/threads/broadcast/text/",
        data=form_data,
        headers=headers,
    )

    log("SEND DM: response", {
        "status": r2.status_code,
        "preview": r2.text[:300],
    })

    is_json = r2.text.strip().startswith("{") or r2.text.strip().startswith("[")
    if is_json:
        try:
            body = r2.json()
        except:
            body = {"raw": r2.text[:300]}
    else:
        body = {"raw": r2.text[:300], "contentType": r2.headers.get("content-type", "")}
        # Extract title from HTML error
        m = re.search(r"<title[^>]*>([\s\S]*?)</title>", r2.text, re.IGNORECASE)
        if m:
            body["htmlTitle"] = m.group(1).strip()

    ok = r2.status_code >= 200 and r2.status_code < 300
    thread_id = None
    if isinstance(body, dict):
        thread_id = body.get("payload", {}).get("thread_id") or body.get("thread_id")

    log("SEND DM: " + ("SUCCESS" if ok else "FAILED"), {
        "recipient": recipient,
        "userId": user_id,
        "threadId": thread_id,
        "statusCode": r2.status_code,
        "body": body,
    })

    return {"ok": ok, "status": r2.status_code, "body": body, "threadId": thread_id, "userId": user_id}

# ──────────────────────────────────────────────
# HTTP Bridge Server (called by Node.js)
# ──────────────────────────────────────────────
class BridgeHandler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body)
        except:
            return self._send(400, {"ok": False, "error": "Invalid JSON"})

        # Normalize sessionid: decode %3A → :
        if "sessionid" in payload:
            payload["sessionid"] = payload["sessionid"].replace("%3A", ":").replace("%3B", ";").strip().strip("'\"")

        path = self.path

        if path == "/validate":
            result = validate_session(payload["sessionid"], payload.get("csrftoken", ""))
        elif path == "/resolve":
            result = resolve_userid(payload["sessionid"], payload.get("csrftoken", ""), payload["username"])
        elif path == "/send-dm":
            result = send_dm(payload["sessionid"], payload.get("csrftoken", ""), payload["recipient"], payload["text"])
        else:
            return self._send(404, {"ok": False, "error": f"Unknown endpoint: {path}"})

        self._send(200, result)

    def log_message(self, format, *args):
        pass  # Suppress default logging

if __name__ == "__main__":
    try:
        server = HTTPServer(("127.0.0.1", PORT), BridgeHandler)
        print(f"\n  Instagram DM Bridge (Python)")
        print(f"  -------------------------------------")
        print(f"  Listening on http://127.0.0.1:{PORT}")
        print(f"  Endpoints: /validate  /resolve  /send-dm")
        print(f"  Using curl_cffi chrome120 TLS impersonation\n")
        server.serve_forever()
    except UnicodeError:
        # Fallback for Windows cp1252 console
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
        server = HTTPServer(("127.0.0.1", PORT), BridgeHandler)
        print(f"\n  Instagram DM Bridge (Python)")
        print(f"  -------------------------------------")
        print(f"  Listening on http://127.0.0.1:{PORT}")
        print(f"  Endpoints: /validate  /resolve  /send-dm")
        print(f"  Using curl_cffi chrome120 TLS impersonation\n")
        server.serve_forever()