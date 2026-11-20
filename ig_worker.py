"""
Instagram DM Worker — called by server.js via child_process for each request.

Commands:
  validate  — check if sessionid+csrftoken are valid
  resolve   — resolve username → numeric userId (STRICT: rejects self)
  send-dm   — resolve + send DM via Instagram's messaging endpoint
  debug     — send DM and return FULL response for debugging

All output: last line of stdout is JSON result.
Debug info goes to stderr (prefixed with [PYTHON]).
"""
import json, re, sys, os, io, uuid
from curl_cffi import requests

# Force UTF-8
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

IG_APP_ID = "936619743392459"
IG_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"


def log(label, data):
    """Log debug info to stderr."""
    print(f"[PYTHON] {label}: {json.dumps(data, ensure_ascii=False)}", file=sys.stderr, flush=True)


def make_session(sessionid, csrftoken):
    """Create a curl_cffi session with Chrome TLS fingerprint + user cookies.
    Returns (session, csrftoken). If csrftoken is empty, extracts it from homepage cookies."""
    s = requests.Session(impersonate="chrome120")
    # Get device cookies from homepage (datr, mid, ig_did, csrftoken)
    r = s.get("https://www.instagram.com/", headers={"Accept": "text/html"}, timeout=15)
    # If user didn't provide csrftoken, grab it from the cookie jar
    if not csrftoken:
        try:
            csrftoken = s.cookies.get("csrftoken")
            if csrftoken:
                log("make_session: auto-extracted csrftoken from cookies", {"csrftoken": csrftoken[:10] + "..."})
        except:
            pass
    # Overlay user session
    ds_id = sessionid.split(":")[0] if ":" in sessionid else ""
    s.cookies.set("sessionid", sessionid, domain=".instagram.com")
    if csrftoken:
        s.cookies.set("csrftoken", csrftoken, domain=".instagram.com")
    if ds_id:
        s.cookies.set("ds_user_id", ds_id, domain=".instagram.com")
    s.headers.update({
        "User-Agent": IG_UA,
        "X-IG-App-ID": IG_APP_ID,
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://www.instagram.com/",
    })
    return s, csrftoken


def extract_tokens(html):
    """Extract fb_dtsg, lsd, app_id, rev from Instagram HTML."""
    tokens = {}
    # fb_dtsg — multiple patterns
    for pat in [
        r'"DTSGInitialData",\[\],\{"token":"([^"]+)"',
        r'"fb_dtsg":"([^"]+)"',
        r'name="fb_dtsg"\s+value="([^"]+)"',
        r'"DTSGInitialData".*?"token":"([^"]+)"',
    ]:
        m = re.search(pat, html)
        if m:
            tokens["fb_dtsg"] = m.group(1)
            break

    # jazoest from fb_dtsg
    if "fb_dtsg" in tokens:
        h = 0
        for c in tokens["fb_dtsg"]:
            h = ((h << 5) - h + ord(c)) & 0xFFFFFFFF
        tokens["jazoest"] = str(h)

    # lsd
    for pat in [
        r'"LSD",\[\],\{"token":"([^"]+)"',
        r'name="lsd"\s+value="([^"]+)"',
        r'"lsd":"([^"]+)"',
    ]:
        m = re.search(pat, html)
        if m:
            tokens["lsd"] = m.group(1)
            break

    # client_revision
    m = re.search(r'"client_revision":(\d+)', html)
    tokens["rev"] = m.group(1) if m else "1016000000"

    # app_id
    m = re.search(r'"app_id":"(\d+)"', html)
    if m:
        tokens["app_id"] = m.group(1)

    return tokens


def extract_own_userid(html):
    """Extract the logged-in user's own userId from the HTML."""
    for pat in [
        r'"profilePage_(\d+)"',
        r'"currentUser".*?"pk"?\s*:\s*"?(\d+)"?',
        r'"user_id":"(\d+)"',
        r'"ds_user_id":"(\d+)"',
        r'"pk":"(\d+)"',
    ]:
        m = re.search(pat, html)
        if m:
            return m.group(1)
    return None


def extract_profile_userid(html, own_userid):
    """
    Extract a profile page's userId from SSR data.
    STRICT: rejects the logged-in user's own ID.
    The profile page embeds the target user's ID in the
    PolarisProfilePageContentQuery response data.
    """
    # Find ALL profilePage_<id> occurrences
    all_ids = re.findall(r'"profilePage_(\d+)"', html)

    for uid in all_ids:
        if uid != own_userid:
            return uid

    # Try to find the profile data specifically in the SSR query response
    # The SSR data has: "xig_user_by_username":{"pk":"<userId>","username":"<username>"}
    for pat in [
        r'"xig_user_by_username".*?"pk"?\s*:\s*"?(\d+)"?',
        r'"PolarisProfilePageContentQuery".*?"pk"?\s*:\s*"?(\d+)"?',
        r'"user".*?"pk"?\s*:\s*"?(\d+)"?',
    ]:
        m = re.search(pat, html, re.DOTALL)
        if m and m.group(1) != own_userid:
            return m.group(1)

    # Last resort: find all numeric IDs near the username
    # Look for patterns like "username":"target_user" ... "id":"12345"
    return None


def resolve_userid_strict(sessionid, csrftoken, username, own_userid):
    """
    Resolve username → numeric userId.
    Returns (userId, reason) tuple.
    Strictly rejects own userId.
    """
    s, csrftoken = make_session(sessionid, csrftoken)

    r = s.get(
        f"https://www.instagram.com/{username}/",
        headers={"Accept": "text/html"},
        timeout=15,
    )

    log("resolve: profile page status", {"status": r.status_code, "length": len(r.text)})

    if r.status_code != 200:
        return None, f"Profile page returned HTTP {r.status_code}"

    if "not-logged-in" in r.text[:5000]:
        return None, "Session rejected — got login page"

    # STRICT extraction
    uid = extract_profile_userid(r.text, own_userid)

    if uid and uid != own_userid:
        log("resolve: found userId", {"username": username, "userId": uid, "isOwn": False})
        return uid, None

    if uid == own_userid:
        log("resolve: BUG — extracted own userId", {"username": username, "ownId": own_userid})
        return None, f"Extracted own userId ({own_userid}) instead of @{username}'s. The profile page may not have loaded the target user's SSR data."

    return None, "Could not extract userId from profile page HTML"


def find_existing_thread(s, user_id, own_id, csrftoken):
    """
    Look up the existing DM thread ID for a given user by querying
    the direct inbox. Returns thread_id or None.
    """
    try:
        r = s.get(
            "https://i.instagram.com/api/v1/direct_v2/inbox/?visual_message_return_type=unseen&thread_message_limit=1&persistentBadging=true&limit=20",
            headers={"X-IG-App-ID": IG_APP_ID, "X-CSRFToken": csrftoken, "Accept": "application/json"},
            timeout=15,
        )
        if r.status_code != 200:
            log("find_thread: inbox fetch failed", {"status": r.status_code})
            return None

        data = r.json()
        threads = data.get("inbox", {}).get("threads", [])
        target_id = str(user_id)
        own_id_str = str(own_id)

        for thread in threads:
            users = thread.get("users", [])
            user_ids = [str(u.get("pk", "")) for u in users]
            # Match: thread has exactly the target user (and optionally self)
            if target_id in user_ids and own_id_str in user_ids:
                thread_id = thread.get("thread_id") or thread.get("thread_v2_id")
                log("find_thread: found existing thread", {
                    "threadId": thread_id,
                    "users": user_ids,
                })
                return thread_id
            # Also match if only target user is in the thread
            if target_id in user_ids and len(user_ids) <= 2:
                thread_id = thread.get("thread_id") or thread.get("thread_v2_id")
                log("find_thread: found thread (target only)", {
                    "threadId": thread_id,
                    "users": user_ids,
                })
                return thread_id

        log("find_thread: no existing thread found", {"totalThreads": len(threads)})
        return None
    except Exception as e:
        log("find_thread: exception", {"error": str(e)})
        return None


def send_dm_to_thread(sessionid, csrftoken, thread_id, text, tokens):
    """
    Send a text message to an EXISTING thread via the add_thread_item endpoint.
    This bypasses the message-request gate because the thread already exists.
    """
    client_context = str(uuid.uuid4())
    device_id = str(uuid.uuid4())
    ds_user_id = sessionid.split(":")[0] if ":" in sessionid else ""

    # Use the thread item endpoint for existing threads
    form_data = {
        "action": "send_item",
        "client_context": client_context,
        "mutation_token": client_context,
        "text": text,
        "link_urls": json.dumps([]),
        "_csrftoken": csrftoken,
        "_uuid": device_id,
        "device_id": device_id,
        "nav_chain": "[12_12w:1b2H2S:1b2H2S:1b2H2S:12_12w:1b2H2S:1b2H2S:1b2H2S:12_12w:1b2H2S:1b2H2S:1b2H2S:12_12w:1b2H2S:1b2H2S:1b2H2S:12_12w:1b2H2S:1b2H2S:1b2H2S]",
    }

    cookie = "; ".join([
        f"sessionid={sessionid}",
        f"csrftoken={csrftoken}",
        f"ds_user_id={ds_user_id}",
        f"ig_did={device_id}",
    ])

    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": cookie,
        "User-Agent": IG_UA,
        "X-IG-App-ID": IG_APP_ID,
        "X-CSRFToken": csrftoken,
        "X-Requested-With": "XMLHttpRequest",
        "X-ASBD-ID": "129477",
        "Origin": "https://www.instagram.com",
        "Referer": f"https://www.instagram.com/direct/t/{thread_id}/",
        "Accept": "application/json, text/plain, */*",
    }
    if tokens.get("fb_dtsg"):
        headers["X-FB-DTSG"] = tokens["fb_dtsg"]
    if tokens.get("lsd"):
        headers["X-FB-LSD"] = tokens["lsd"]

    s = requests.Session(impersonate="chrome120")
    s.cookies.set("sessionid", sessionid, domain=".instagram.com")
    s.cookies.set("csrftoken", csrftoken, domain=".instagram.com")
    s.cookies.set("ds_user_id", ds_user_id, domain=".instagram.com")
    s.cookies.set("ig_did", device_id, domain=".instagram.com")

    # Use the thread-specific endpoint
    url = f"https://i.instagram.com/api/v1/direct_v2/threads/{thread_id}/items/text/"
    log("send_dm_to_thread: sending", {"url": url, "threadId": thread_id})

    r = s.post(url, data=form_data, headers=headers, timeout=20)

    log("send_dm_to_thread: response", {
        "status": r.status_code,
        "contentType": r.headers.get("content-type", ""),
        "bodyLength": len(r.text),
        "bodyPreview": r.text[:500],
    })

    is_json = r.text.strip().startswith("{") or r.text.strip().startswith("[")
    if is_json:
        try:
            body = r.json()
        except:
            body = {"raw": r.text[:500]}
    else:
        body = {"raw": r.text[:500]}
        m = re.search(r"<title[^>]*>([\s\S]*?)</title>", r.text, re.IGNORECASE)
        if m:
            body["htmlTitle"] = m.group(1).strip()

    ok = r.status_code >= 200 and r.status_code < 300
    return ok, r.status_code, body, thread_id


# ──────────────────────────────────────────────
# Commands
# ──────────────────────────────────────────────

def cmd_validate(payload):
    sessionid = payload["sessionid"]
    csrftoken = payload.get("csrftoken", "")

    s, csrftoken = make_session(sessionid, csrftoken)
    r = s.get("https://www.instagram.com/", headers={"Accept": "text/html"}, timeout=15)

    if r.status_code != 200:
        return {"valid": False, "reason": f"Homepage returned HTTP {r.status_code}"}

    # Check login
    if "not-logged-in" in r.text[:5000]:
        ds_id = sessionid.split(":")[0] if ":" in sessionid else ""
        if ds_id:
            r2 = s.get(f"https://www.instagram.com/{ds_id}/", headers={"Accept": "text/html"}, timeout=15)
            if "not-logged-in" in r2.text[:5000]:
                return {"valid": False, "reason": "Session cookie rejected — Instagram returned login page. Check sessionid and csrftoken are from the same browser session and still active."}
        else:
            return {"valid": False, "reason": "Cannot extract ds_user_id from sessionid format."}

    tokens = extract_tokens(r.text)
    username = None
    m = re.search(r'"username":"([^"]+)"', r.text)
    if m:
        username = m.group(1)

    own_id = extract_own_userid(r.text) or (sessionid.split(":")[0] if ":" in sessionid else None)

    return {
        "valid": True,
        "username": username,
        "userId": own_id,
        "has_fb_dtsg": bool(tokens.get("fb_dtsg")),
        "csrftoken": csrftoken[:10] + "..." if csrftoken else "(none)",
    }


def cmd_resolve(payload):
    sessionid = payload["sessionid"]
    csrftoken = payload.get("csrftoken", "")
    username = payload["username"]

    # First get own userId
    s, csrftoken = make_session(sessionid, csrftoken)
    r = s.get("https://www.instagram.com/", headers={"Accept": "text/html"}, timeout=15)
    own_id = extract_own_userid(r.text) or (sessionid.split(":")[0] if ":" in sessionid else None)

    if not own_id:
        return {"userId": None, "reason": "Could not determine own userId for validation"}

    uid, reason = resolve_userid_strict(sessionid, csrftoken, username, own_id)
    return {"userId": uid, "reason": reason, "ownUserId": own_id}


def cmd_send_dm(payload):
    sessionid = payload["sessionid"]
    csrftoken = payload.get("csrftoken", "")
    recipient = payload["recipient"]
    text = payload["text"]

    # Step 1: Get own userId + tokens
    s, csrftoken = make_session(sessionid, csrftoken)
    r = s.get("https://www.instagram.com/", headers={"Accept": "text/html"}, timeout=15)
    own_id = extract_own_userid(r.text) or (sessionid.split(":")[0] if ":" in sessionid else None)
    tokens = extract_tokens(r.text)

    log("send_dm: own userId", {"ownId": own_id, "hasFbDtsg": bool(tokens.get("fb_dtsg")), "csrftoken": csrftoken[:10] + "..." if csrftoken else "(none)"})

    # Step 2: Resolve target userId (STRICT)
    uid, reason = resolve_userid_strict(sessionid, csrftoken, recipient, own_id)
    if not uid:
        log("send_dm: resolve failed", {"reason": reason})
        return {"ok": False, "status": 0, "reason": reason}

    log("send_dm: resolved", {"recipient": recipient, "userId": uid})

    # Step 3: Try existing thread first (bypasses message-request gate)
    thread_id = find_existing_thread(s, uid, own_id, csrftoken)

    if thread_id:
        log("send_dm: using existing thread", {"threadId": thread_id})
        ok, status, body, thread_id = send_dm_to_thread(sessionid, csrftoken, thread_id, text, tokens)
    else:
        log("send_dm: no existing thread, using broadcast endpoint")
        ok, status, body, thread_id = send_dm_request(sessionid, csrftoken, uid, recipient, text, tokens)

    log("send_dm: result", {"ok": ok, "status": status, "threadId": thread_id})

    return {
        "ok": ok,
        "status": status,
        "body": body,
        "threadId": thread_id,
        "userId": uid,
        "ownUserId": own_id,
    }


def cmd_debug(payload):
    """Send DM and return FULL debug info including raw response."""
    sessionid = payload["sessionid"]
    csrftoken = payload.get("csrftoken", "")
    recipient = payload["recipient"]
    text = payload["text"]

    # Get own userId + tokens
    s, csrftoken = make_session(sessionid, csrftoken)
    r = s.get("https://www.instagram.com/", headers={"Accept": "text/html"}, timeout=15)
    own_id = extract_own_userid(r.text) or (sessionid.split(":")[0] if ":" in sessionid else None)
    tokens = extract_tokens(r.text)

    log("debug: own userId", {"ownId": own_id, "csrftoken": csrftoken[:10] + "..." if csrftoken else "(none)", "hasFbDtsg": bool(tokens.get("fb_dtsg"))})

    # Resolve
    uid, resolve_reason = resolve_userid_strict(sessionid, csrftoken, recipient, own_id)

    if not uid:
        return {
            "ok": False,
            "step": "resolve",
            "reason": resolve_reason,
            "ownUserId": own_id,
            "tokens": {k: v[:20] + "..." for k, v in tokens.items()},
        }

    # Try existing thread first (bypasses message-request gate)
    thread_id = find_existing_thread(s, uid, own_id, csrftoken)

    if thread_id:
        log("debug: using existing thread", {"threadId": thread_id})
        ok, status, body, thread_id = send_dm_to_thread(sessionid, csrftoken, thread_id, text, tokens)
        # Build a mock response-like object for the return block below
        class FakeResp:
            def __init__(self, status, body):
                self.status_code = status
                self.headers = {"content-type": "application/json"}
                self.text = json.dumps(body) if isinstance(body, dict) else str(body)
        r2 = FakeResp(status, body)
        form_data = {"text": text, "thread_id": thread_id}
    else:
        log("debug: no existing thread, using broadcast endpoint")
        # Fall through to broadcast
        client_context = str(uuid.uuid4())
        device_id = str(uuid.uuid4())
        ds_user_id = sessionid.split(":")[0] if ":" in sessionid else ""

        form_data = {
            "recipient_users": json.dumps([str(uid)]),
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

        cookie = "; ".join([
            f"sessionid={sessionid}",
            f"ds_user_id={ds_user_id}",
            f"ig_did={device_id}",
        ])
        if csrftoken:
            cookie = f"csrftoken={csrftoken}; " + cookie

        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Cookie": cookie,
            "User-Agent": IG_UA,
            "X-IG-App-ID": tokens.get("app_id", IG_APP_ID),
            "X-CSRFToken": csrftoken,
            "X-Requested-With": "XMLHttpRequest",
            "X-ASBD-ID": "129477",
            "Origin": "https://www.instagram.com",
            "Referer": "https://www.instagram.com/",
            "Accept": "application/json, text/plain, */*",
        }
        if tokens.get("fb_dtsg"):
            headers["X-FB-DTSG"] = tokens["fb_dtsg"]
        if tokens.get("lsd"):
            headers["X-FB-LSD"] = tokens["lsd"]

        s2 = requests.Session(impersonate="chrome120")
        s2.cookies.set("sessionid", sessionid, domain=".instagram.com")
        if csrftoken:
            s2.cookies.set("csrftoken", csrftoken, domain=".instagram.com")
        s2.cookies.set("ds_user_id", ds_user_id, domain=".instagram.com")
        s2.cookies.set("ig_did", device_id, domain=".instagram.com")

        r2 = s2.post(
            "https://i.instagram.com/api/v1/direct_v2/threads/broadcast/text/",
            data=form_data,
            headers=headers,
            timeout=20,
        )
        thread_id = None

    return {
        "ok": r2.status_code >= 200 and r2.status_code < 300,
        "step": "send_dm",
        "statusCode": r2.status_code,
        "contentType": r2.headers.get("content-type", ""),
        "responseHeaders": dict(r2.headers),
        "responseBodyRaw": r2.text[:2000],
        "responseBody": r2.text[:500],
        "userId": uid,
        "ownUserId": own_id,
        "threadId": thread_id,
        "tokens": {k: (v[:20] + "..." if isinstance(v, str) and len(v) > 20 else v) for k, v in tokens.items()},
        "csrftoken": csrftoken[:10] + "..." if csrftoken else "(none)",
        "formFieldsSent": {k: (v[:50] + "..." if isinstance(v, str) and len(v) > 50 else v) for k, v in form_data.items()},
    }


# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Usage: ig_worker.py <command> '<json>'"}))
        sys.exit(1)

    command = sys.argv[1]
    payload = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}

    # Normalize sessionid: decode %3A → :
    if "sessionid" in payload:
        payload["sessionid"] = (
            payload["sessionid"]
            .replace("%3A", ":")
            .replace("%3B", ";")
            .strip()
            .strip("'\"")
        )

    try:
        if command == "validate":
            result = cmd_validate(payload)
        elif command == "resolve":
            result = cmd_resolve(payload)
        elif command == "send-dm":
            result = cmd_send_dm(payload)
        elif command == "debug":
            result = cmd_debug(payload)
        else:
            result = {"ok": False, "error": f"Unknown command: {command}"}
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        result = {"ok": False, "error": str(e)}

    print(json.dumps(result, ensure_ascii=False))