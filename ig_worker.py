"""
Instagram DM Worker v3 — uses the ACTUAL GraphQL mutation Instagram's web client uses.

Mutation: IGDirectTextSendMutation (doc_id 28737274835943013)
Endpoint: POST /api/graphql/
Root field: xig_direct_text_send_with_slide_messaging_response

This replaces the dead direct_v2 REST endpoints entirely.
"""
import json, re, sys, os, io, uuid, time, random
from curl_cffi import requests

if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

IG_APP_ID = "936619743392459"
IG_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
IGDirectTextSendMutation_DOC_ID = "28737274835943013"
IGDMessageListOffMsysQuery_DOC_ID = "29008944932098151"

_req_counter = random.randint(1, 99999)

def next_req():
    global _req_counter
    _req_counter += 1
    return _req_counter

def log(label, data):
    print(f"[PYTHON] {label}: {json.dumps(data, ensure_ascii=False)}", file=sys.stderr, flush=True)

def generate_offline_threading_id():
    """Generate a proper offline_threading_id (base-10 of 63-bit value from timestamp)."""
    ts = int(time.time() * 1000)
    rand = random.randint(0, 4294967295)
    # 22-bit binary of random, appended to timestamp
    rand_bin = ("0000000000000000000000" + bin(rand)[2:])[-22:]
    ts_bin = bin(ts)[2:] + rand_bin
    # Take last 63 bits
    val = ts_bin[-63:]
    # Convert binary string to decimal string
    return str(int(val, 2))

def make_session(sessionid, csrftoken):
    s = requests.Session(impersonate="chrome120")
    r = s.get("https://www.instagram.com/", headers={"Accept": "text/html"}, timeout=15)
    if not csrftoken:
        try:
            csrftoken = s.cookies.get("csrftoken")
            if csrftoken:
                log("auto-extracted csrftoken", {"csrftoken": csrftoken[:10] + "..."})
        except:
            pass
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
    tokens = {}
    for pat in [
        r'"DTSGInitialData",\[\],\{"token":"([^"]+)"',
        r'"fb_dtsg":"([^"]+)"',
        r'name="fb_dtsg"\s+value="([^"]+)"',
    ]:
        m = re.search(pat, html)
        if m:
            tokens["fb_dtsg"] = m.group(1)
            break

    if "fb_dtsg" in tokens:
        h = 0
        for c in tokens["fb_dtsg"]:
            h = ((h << 5) - h + ord(c)) & 0xFFFFFFFF
        tokens["jazoest"] = str(h)

    for pat in [r'"LSD",\[\],\{"token":"([^"]+)"', r'name="lsd"\s+value="([^"]+)"', r'"lsd":"([^"]+)"']:
        m = re.search(pat, html)
        if m:
            tokens["lsd"] = m.group(1)
            break

    m = re.search(r'"client_revision":(\d+)', html)
    tokens["rev"] = m.group(1) if m else "1055532492"

    m = re.search(r'"app_id":"(\d+)"', html)
    if m:
        tokens["app_id"] = m.group(1)

    # Extract viewer_id (messaging ID, not IG pk)
    m = re.search(r'"viewer_id":"(\d+)"', html)
    if m:
        tokens["viewer_id"] = m.group(1)

    # Extract actorID / viewer FBID
    m = re.search(r'"actorID":"(\d+)"', html)
    if m:
        tokens["actor_id"] = m.group(1)

    # Haste session
    m = re.search(r'"hsi":"(\d+)"', html)
    if m:
        tokens["hsi"] = m.group(1)
    else:
        m = re.search(r'"haste_session":"([^"]+)"', html)
        if m:
            tokens["hsi"] = m.group(1)

    return tokens

def extract_own_userid(html):
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
    all_ids = re.findall(r'"profilePage_(\d+)"', html)
    for uid in all_ids:
        if uid != own_userid:
            return uid
    for pat in [
        r'"xig_user_by_username".*?"pk"?\s*:\s*"?(\d+)"?',
        r'"PolarisProfilePageContentQuery".*?"pk"?\s*:\s*"?(\d+)"?',
    ]:
        m = re.search(pat, html, re.DOTALL)
        if m and m.group(1) != own_userid:
            return m.group(1)
    return None

def resolve_userid_strict(sessionid, csrftoken, username, own_userid):
    s, csrftoken = make_session(sessionid, csrftoken)
    r = s.get(f"https://www.instagram.com/{username}/", headers={"Accept": "text/html"}, timeout=15)
    if r.status_code != 200:
        return None, f"Profile page returned HTTP {r.status_code}"
    if "not-logged-in" in r.text[:5000]:
        return None, "Session rejected — got login page"
    uid = extract_profile_userid(r.text, own_userid)
    if uid and uid != own_userid:
        log("resolve: found userId", {"username": username, "userId": uid})
        return uid, None
    return None, "Could not extract userId from profile page HTML"

def find_thread_fbid(sessionid, csrftoken, recipient_pk):
    """
    Find the thread_fbid for an existing DM conversation with a user.
    Uses the GraphQL query IGDMessageListOffMsysQuery (doc_id 29008944932098151)
    or falls back to querying the inbox via GraphQL.
    Returns (thread_fbid, interop_fbid, reason).
    """
    s, csrftoken = make_session(sessionid, csrftoken)
    tokens = extract_tokens(s.get("https://www.instagram.com/", headers={"Accept": "text/html"}, timeout=15).text)

    # Try GraphQL approach: use get_slide_thread_nullable query
    # First, try to find the thread via the DM inbox GraphQL
    # We'll use the legacy inbox API to find the thread, then get thread_fbid from there
    try:
        r = s.get(
            "https://i.instagram.com/api/v1/direct_v2/inbox/?visual_message_return_type=unseen&thread_message_limit=1&persistentBadging=true&limit=50",
            headers={"X-IG-App-ID": IG_APP_ID, "X-CSRFToken": csrftoken, "Accept": "application/json"},
            timeout=15,
        )
        if r.status_code == 200:
            data = r.json()
            threads = data.get("inbox", {}).get("threads", [])
            target_pk = str(recipient_pk)

            for thread in threads:
                users = thread.get("users", [])
                for u in users:
                    u_pk = str(u.get("pk", ""))
                    if u_pk == target_pk:
                        thread_fbid = thread.get("thread_fbid") or thread.get("thread_id", "")
                        thread_key = thread.get("thread_id", "")
                        # Get the interop messaging user fbid
                        interop_fbid = None
                        for u2 in users:
                            if str(u2.get("pk", "")) == target_pk:
                                interop_fbid = str(u2.get("interop_messaging_user_fbid", "")) or None
                                break
                        log("find_thread_fbid: found", {
                            "thread_fbid": thread_fbid,
                            "thread_key": thread_key,
                            "interop_fbid": interop_fbid,
                            "target_pk": target_pk,
                        })
                        return thread_fbid, interop_fbid, None

            log("find_thread_fbid: no thread found", {"totalThreads": len(threads), "targetPk": target_pk})
            return None, None, f"No existing DM thread found for userId {recipient_pk}"
        else:
            log("find_thread_fbid: inbox API failed", {"status": r.status_code})
            return None, None, f"Inbox API returned HTTP {r.status_code}"
    except Exception as e:
        log("find_thread_fbid: exception", {"error": str(e)})
        return None, None, f"Error finding thread: {str(e)}"

def send_dm_graphql(sessionid, csrftoken, thread_fbid, recipient_igids, text, tokens, own_userid):
    """
    Send a DM via the ACTUAL GraphQL mutation Instagram uses:
    IGDirectTextSendMutation (doc_id 28737274835943013)
    POST /api/graphql/

    Variables:
      ig_thread_igid: thread_fbid (for existing thread)
      recipient_igids: [interop_messaging_user_fbid] (for new thread)
      offline_threading_id: generated ID
      text: {sensitive_string_value: "..."}
    """
    device_id = str(uuid.uuid4())
    offline_threading_id = generate_offline_threading_id()
    ds_user_id = sessionid.split(":")[0] if ":" in sessionid else own_userid or ""

    # Build variables — use EITHER ig_thread_igid OR recipient_igids
    variables = {
        "commands": None,
        "forwarded_from_thread_id": None,
        "ig_thread_igid": str(thread_fbid) if thread_fbid else None,
        "is_forwarded_from_own_message": None,
        "mentioned_user_ids": None,
        "mentions": None,
        "offline_threading_id": offline_threading_id,
        "recipient_igids": json.dumps(recipient_igids) if recipient_igids else None,
        "replied_to_item_id": None,
        "reply_to_message_id": None,
        "sampled": None,
        "send_attribution": None,
        "text": {"sensitive_string_value": text},
    }

    # Build form data for POST /api/graphql/
    form_data = {
        "doc_id": IGDirectTextSendMutation_DOC_ID,
        "fb_api_caller_class": "RelayModern",
        "fb_api_req_friendly_name": "IGDirectTextSendMutation",
        "server_timestamps": "true",
        "variables": json.dumps(variables),
        "fb_dtsg": tokens.get("fb_dtsg", ""),
        "jazoest": tokens.get("jazoest", ""),
        "lsd": tokens.get("lsd", ""),
        "__user": str(ds_user_id),
        "__a": "1",
        "__req": str(next_req()),
        "__rev": tokens.get("rev", "1055532492"),
        "hsi": tokens.get("hsi", ""),
        "dpr": "1",
        "hs_key": tokens.get("hsi", ""),
        "__comet_req": "7",
        "fb_dtsg": tokens.get("fb_dtsg", ""),
        "jazoest": tokens.get("jazoest", ""),
        "lsd": tokens.get("lsd", ""),
        "__spin_r": tokens.get("rev", "1055532492"),
        "__spin_b": "trunk",
        "__spin_t": "",
    }

    # Remove duplicate keys
    form_data = {k: v for k, v in form_data.items() if v is not None}

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
        "X-IG-D": "www",
        "X-CSRFToken": csrftoken,
        "X-Requested-With": "XMLHttpRequest",
        "X-ASBD-ID": "129477",
        "X-FB-Friendly-Name": "IGDirectTextSendMutation",
        "Origin": "https://www.instagram.com",
        "Referer": f"https://www.instagram.com/direct/t/{thread_fbid}/" if thread_fbid else "https://www.instagram.com/",
        "Accept": "application/json, text/plain, */*",
    }
    if tokens.get("fb_dtsg"):
        headers["X-FB-DTSG"] = tokens["fb_dtsg"]
    if tokens.get("lsd"):
        headers["X-FB-LSD"] = tokens["lsd"]

    log("send_dm_graphql: sending", {
        "doc_id": IGDirectTextSendMutation_DOC_ID,
        "endpoint": "POST /api/graphql/",
        "thread_fbid": thread_fbid,
        "recipient_igids": recipient_igids,
        "offline_threading_id": offline_threading_id,
        "textLength": len(text),
    })

    s = requests.Session(impersonate="chrome120")
    s.cookies.set("sessionid", sessionid, domain=".instagram.com")
    if csrftoken:
        s.cookies.set("csrftoken", csrftoken, domain=".instagram.com")
    s.cookies.set("ds_user_id", ds_user_id, domain=".instagram.com")
    s.cookies.set("ig_did", device_id, domain=".instagram.com")

    r = s.post(
        "https://www.instagram.com/api/graphql/",
        data=form_data,
        headers=headers,
        timeout=20,
    )

    log("send_dm_graphql: response", {
        "status": r.status_code,
        "contentType": r.headers.get("content-type", ""),
        "bodyLength": len(r.text),
        "bodyPreview": r.text[:600],
    })

    # Parse response
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

    # Check GraphQL errors
    graphql_errors = None
    if isinstance(body, dict):
        if body.get("errors"):
            graphql_errors = body["errors"]
            ok = False
        # Check for the mutation response
        response_key = "xig_direct_text_send_with_slide_messaging_response"
        if response_key in body.get("data", {}):
            msg_data = body["data"][response_key]
            if msg_data:
                ok = True
                log("send_dm_graphql: message sent!", {
                    "message_id": msg_data.get("message_id"),
                    "timestamp_ms": msg_data.get("timestamp_ms"),
                })

    return ok, r.status_code, body, graphql_errors, offline_threading_id


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
    if "not-logged-in" in r.text[:5000]:
        ds_id = sessionid.split(":")[0] if ":" in sessionid else ""
        if ds_id:
            r2 = s.get(f"https://www.instagram.com/{ds_id}/", headers={"Accept": "text/html"}, timeout=15)
            if "not-logged-in" in r2.text[:5000]:
                return {"valid": False, "reason": "Session rejected — Instagram returned login page."}
        else:
            return {"valid": False, "reason": "Cannot extract ds_user_id from sessionid."}
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
    s, csrftoken = make_session(sessionid, csrftoken)
    r = s.get("https://www.instagram.com/", headers={"Accept": "text/html"}, timeout=15)
    own_id = extract_own_userid(r.text) or (sessionid.split(":")[0] if ":" in sessionid else None)
    if not own_id:
        return {"userId": None, "reason": "Could not determine own userId"}
    uid, reason = resolve_userid_strict(sessionid, csrftoken, username, own_id)
    return {"userId": uid, "reason": reason, "ownUserId": own_id}

def cmd_send_dm(payload):
    sessionid = payload["sessionid"]
    csrftoken = payload.get("csrftoken", "")
    recipient = payload["recipient"]
    text = payload["text"]

    s, csrftoken = make_session(sessionid, csrftoken)
    r = s.get("https://www.instagram.com/", headers={"Accept": "text/html"}, timeout=15)
    own_id = extract_own_userid(r.text) or (sessionid.split(":")[0] if ":" in sessionid else None)
    tokens = extract_tokens(r.text)

    log("send_dm: starting", {"ownId": own_id, "csrftoken": csrftoken[:10] + "..." if csrftoken else "(none)"})

    # Resolve recipient userId
    uid, reason = resolve_userid_strict(sessionid, csrftoken, recipient, own_id)
    if not uid:
        return {"ok": False, "status": 0, "reason": reason}

    # Find thread_fbid for existing conversation
    thread_fbid, interop_fbid, thread_reason = find_thread_fbid(sessionid, csrftoken, uid)

    if thread_fbid:
        log("send_dm: found existing thread", {"thread_fbid": thread_fbid})
        # Send to existing thread
        recipient_igids = [interop_fbid] if interop_fbid else None
        ok, status, body, errors, otid = send_dm_graphql(sessionid, csrftoken, thread_fbid, recipient_igids, text, tokens, own_id)
    else:
        log("send_dm: no existing thread, trying new thread", {"reason": thread_reason})
        # For new thread, we need interop_messaging_user_fbid
        # Try to get it from the profile page
        recipient_igids = [str(uid)]  # fallback to pk
        ok, status, body, errors, otid = send_dm_graphql(sessionid, csrftoken, None, recipient_igids, text, tokens, own_id)

    return {
        "ok": ok,
        "status": status,
        "body": body,
        "threadId": thread_fbid,
        "userId": uid,
        "ownUserId": own_id,
        "errors": errors,
    }

def cmd_debug(payload):
    """Send DM and return FULL debug info including raw response."""
    sessionid = payload["sessionid"]
    csrftoken = payload.get("csrftoken", "")
    recipient = payload["recipient"]
    text = payload["text"]

    s, csrftoken = make_session(sessionid, csrftoken)
    r = s.get("https://www.instagram.com/", headers={"Accept": "text/html"}, timeout=15)
    own_id = extract_own_userid(r.text) or (sessionid.split(":")[0] if ":" in sessionid else None)
    tokens = extract_tokens(r.text)

    log("debug: own userId", {"ownId": own_id, "csrftoken": csrftoken[:10] + "..." if csrftoken else "(none)"})

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

    # Find thread
    thread_fbid, interop_fbid, thread_reason = find_thread_fbid(sessionid, csrftoken, uid)
    log("debug: thread lookup", {"thread_fbid": thread_fbid, "interop_fbid": interop_fbid, "reason": thread_reason})

    # Send
    recipient_igids = [interop_fbid] if interop_fbid else [str(uid)]
    ok, status, body, errors, otid = send_dm_graphql(sessionid, csrftoken, thread_fbid, recipient_igids, text, tokens, own_id)

    return {
        "ok": ok,
        "step": "send_dm",
        "statusCode": status,
        "contentType": "application/json",
        "responseBody": json.dumps(body)[:500] if isinstance(body, dict) else str(body)[:500],
        "responseBodyRaw": json.dumps(body)[:2000] if isinstance(body, dict) else str(body)[:2000],
        "userId": uid,
        "ownUserId": own_id,
        "threadId": thread_fbid,
        "offlineThreadingId": otid,
        "tokens": {k: (v[:20] + "..." if isinstance(v, str) and len(v) > 20 else v) for k, v in tokens.items()},
        "csrftoken": csrftoken[:10] + "..." if csrftoken else "(none)",
        "graphqlErrors": errors,
        "recipientIgids": recipient_igids,
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