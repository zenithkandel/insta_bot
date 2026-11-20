"""
Instagram DM Worker v4 — Headless Chrome + Selenium

Why this works where everything else failed:
  - Instagram's /api/graphql/ endpoint does TLS fingerprinting + header
    fingerprinting + checks for browser-specific tokens that curl_cffi
    cannot fully replicate, regardless of cookies.
  - Headless Chrome IS a real browser: same TLS fingerprint, same headers,
    same JS execution, same cookie handling as a normal browser tab.
  - We inject the sessionid cookie into the browser, navigate to instagram.com,
    then use driver.execute_async_script() to run fetch() calls from the
    same origin — CORS, CSRF, cookies all handled by the browser natively.

Usage:
  python ig_worker.py validate  '<json>'
  python ig_worker.py resolve   '<json>'
  python ig_worker.py send-dm   '<json>'
  python ig_worker.py debug     '<json>'
"""
import json, re, sys, os, io, uuid, time, random, base64

if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service

IG_APP_ID = "936619743392459"
IGDirectTextSendMutation_DOC_ID = "28737274835943013"

_req_counter = random.randint(1, 99999)

def next_req():
    global _req_counter
    _req_counter += 1
    return _req_counter

def log(label, data):
    print(f"[PYTHON] {label}: {json.dumps(data, ensure_ascii=False)}", file=sys.stderr, flush=True)

def generate_offline_threading_id():
    ts = int(time.time() * 1000)
    rand = random.randint(0, 4294967295)
    rand_bin = ("0000000000000000000000" + bin(rand)[2:])[-22:]
    ts_bin = bin(ts)[2:] + rand_bin
    val = ts_bin[-63:]
    return str(int(val, 2))

# ──────────────────────────────────────────────
# Headless Chrome driver
# ──────────────────────────────────────────────
_driver = None

def get_driver():
    global _driver
    if _driver is not None:
        return _driver

    opts = Options()
    opts.add_argument('--headless=new')
    opts.add_argument('--no-sandbox')
    opts.add_argument('--disable-dev-shm-usage')
    opts.add_argument('--disable-gpu')
    opts.add_argument('--window-size=1920,1080')
    opts.add_argument('--disable-blink-features=AutomationControlled')
    opts.add_experimental_option('excludeSwitches', ['enable-automation'])
    opts.add_experimental_option('useAutomationExtension', False)

    # Try to find chrome
    chrome_paths = [
        r'C:\Program Files\Google\Chrome\Application\chrome.exe',
        r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    ]
    for p in chrome_paths:
        if os.path.exists(p):
            opts.binary_location = p
            break

    _driver = webdriver.Chrome(options=opts)
    # Remove webdriver detection
    _driver.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {
        'source': 'Object.defineProperty(navigator, "webdriver", {get: () => undefined})'
    })
    log("driver: started", {})
    return _driver

def quit_driver():
    global _driver
    if _driver is not None:
        try:
            _driver.quit()
        except:
            pass
        _driver = None

# ──────────────────────────────────────────────
# Inject session into browser cookies
# ──────────────────────────────────────────────
def inject_session(sessionid, csrftoken=""):
    driver = get_driver()
    ds_id = sessionid.split(":")[0] if ":" in sessionid else ""

    # First visit instagram.com to establish domain cookies
    driver.get('https://www.instagram.com/')
    time.sleep(1)

    # Add session cookies
    driver.add_cookie({
        'name': 'sessionid',
        'value': sessionid,
        'domain': '.instagram.com',
        'path': '/',
    })
    if csrftoken:
        driver.add_cookie({
            'name': 'csrftoken',
            'value': csrftoken,
            'domain': '.instagram.com',
            'path': '/',
        })
    if ds_id:
        driver.add_cookie({
            'name': 'ds_user_id',
            'value': ds_id,
            'domain': '.instagram.com',
            'path': '/',
        })

    # Reload to apply cookies
    driver.get('https://www.instagram.com/')
    time.sleep(2)
    log("inject_session: done", {"ds_id": ds_id, "csrftoken": csrftoken[:10] + "..." if csrftoken else "(none)"})
    return driver

# ──────────────────────────────────────────────
# Extract tokens from the browser's live page
# ──────────────────────────────────────────────
def extract_tokens_from_browser(driver):
    # Run JS in the browser to extract tokens
    script = """
    const html = document.documentElement.outerHTML;

    // fb_dtsg
    let fbDtsg = null;
    const dtsgMatch = html.match(/"DTSGInitialData"[^}]*"token":"([^"]+)"/);
    if (dtsgMatch) fbDtsg = dtsgMatch[1];
    if (!fbDtsg) {
        const m = html.match(/"fb_dtsg":"([^"]+)"/);
        if (m) fbDtsg = m[1];
    }

    // lsd
    let lsd = null;
    const lsdMatch = html.match(/"LSD"[^}]*"token":"([^"]+)"/);
    if (lsdMatch) lsd = lsdMatch[1];
    if (!lsd) {
        const m = html.match(/"lsd":"([^"]+)"/);
        if (m) lsd = m[1];
    }

    // csrftoken from cookie
    const csrfCookie = document.cookie.match(/csrftoken=([^;]+)/);
    const csrftoken = csrfCookie ? csrfCookie[1] : null;

    // client revision
    const revMatch = html.match(/"client_revision":(\d+)/);
    const rev = revMatch ? revMatch[1] : "1055532492";

    // viewer_id
    const viewerMatch = html.match(/"viewer_id":"(\\d+)"/);
    const viewerId = viewerMatch ? viewerMatch[1] : null;

    // jazoest from fb_dtsg
    let jazoest = null;
    if (fbDtsg) {
        let h = 0;
        for (let i = 0; i < fbDtsg.length; i++) {
            h = ((h << 5) - h + fbDtsg.charCodeAt(i)) | 0;
        }
        jazoest = Math.abs(h).toString();
    }

    return { fb_dtsg: fbDtsg, lsd, csrftoken, rev, jazoest, viewer_id: viewerId };
    """
    result = driver.execute_script(script)
    log("extract_tokens_from_browser", {k: (v[:15] + "..." if isinstance(v, str) and len(v) > 15 else v) for k, v in result.items()})
    return result

# ──────────────────────────────────────────────
# Run fetch() from the browser context (same-origin)
# ──────────────────────────────────────────────
def browser_fetch(driver, url, options_json):
    """
    Execute a fetch() call from within the browser context.
    This is same-origin, so CORS/cookies/CSRF are all handled by the browser.
    """
    script = f"""
    const done = arguments[arguments.length - 1];
    const url = {json.dumps(url)};
    const options = {options_json};

    fetch(url, options)
      .then(r => r.text().then(text => {{
        done({{ status: r.status, text: text }});
      }}))
      .catch(err => {{
        done({{ status: 0, text: err.toString() }});
      }});
    """
    driver.set_script_timeout(30)
    result = driver.execute_async_script(script)
    return result

# ──────────────────────────────────────────────
# Validate session
# ──────────────────────────────────────────────
def validate_session(sessionid, csrftoken):
    try:
        driver = inject_session(sessionid, csrftoken)
        # Check if we're logged in
        page_source = driver.page_source
        if 'not-logged-in' in page_source[:5000]:
            return {"valid": False, "reason": "Session rejected — Instagram returned login page."}
        tokens = extract_tokens_from_browser(driver)
        return {
            "valid": True,
            "username": tokens.get("username", "unknown"),
            "userId": None,
            "has_fb_dtsg": bool(tokens.get("fb_dtsg")),
            "csrftoken": tokens.get("csrftoken", "")[:10] + "..." if tokens.get("csrftoken") else "(none)",
        }
    except Exception as e:
        return {"valid": False, "reason": f"Browser error: {str(e)}"}
    finally:
        quit_driver()

# ──────────────────────────────────────────────
# Resolve username -> userId
# ──────────────────────────────────────────────
def resolve_userid(sessionid, csrftoken, username):
    try:
        driver = inject_session(sessionid, csrftoken)
        # Navigate to the user's profile page
        driver.get(f'https://www.instagram.com/{username}/')
        time.sleep(2)
        page_source = driver.page_source
        if 'not-logged-in' in page_source[:5000]:
            return {"userId": None, "reason": "Session rejected during profile lookup"}
        # Extract userId from profilePage_<id> in the SSR data
        match = re.search(r'"profilePage_(\d+)"', page_source)
        if match:
            uid = match.group(1)
            log(f"resolve: found userId for @{username}", {"userId": uid})
            return {"userId": uid, "reason": None, "ownUserId": None}
        # Fallback: try other patterns
        for pat in [r'"user_id":"(\d+)"', r'"pk":"(\d+)"']:
            m = re.search(pat, page_source)
            if m:
                return {"userId": m.group(1), "reason": None, "ownUserId": None}
        return {"userId": None, "reason": "Could not extract userId from profile page"}
    except Exception as e:
        return {"userId": None, "reason": f"Browser error: {str(e)}"}
    finally:
        quit_driver()

# ──────────────────────────────────────────────
# Find thread_fbid from inbox
# ──────────────────────────────────────────────
def find_thread_fbid(driver, recipient_pk, csrftoken):
    """Use the browser's fetch() to query the inbox API (same-origin, cookies auto-sent)."""
    try:
        url = "https://i.instagram.com/api/v1/direct_v2/inbox/?visual_message_return_type=unseen&thread_message_limit=1&persistentBadging=true&limit=50"
        result = browser_fetch(driver, url, json.dumps({
            "method": "GET",
            "headers": {
                "X-IG-App-ID": IG_APP_ID,
                "Accept": "application/json",
            }
        }))
        if result["status"] != 200:
            log("find_thread_fbid: inbox fetch failed", {"status": result["status"], "body": result["text"][:200]})
            return None, None, f"Inbox API returned HTTP {result['status']}"

        data = json.loads(result["text"])
        threads = data.get("inbox", {}).get("threads", [])
        target_pk = str(recipient_pk)

        for thread in threads:
            users = thread.get("users", [])
            for u in users:
                u_pk = str(u.get("pk", ""))
                if u_pk == target_pk:
                    thread_fbid = thread.get("thread_fbid") or thread.get("thread_id", "")
                    interop_fbid = None
                    for u2 in users:
                        if str(u2.get("pk", "")) == target_pk:
                            interop_fbid = str(u2.get("interop_messaging_user_fbid", "")) or None
                            break
                    log("find_thread_fbid: found", {
                        "thread_fbid": thread_fbid,
                        "interop_fbid": interop_fbid,
                        "target_pk": target_pk,
                    })
                    return thread_fbid, interop_fbid, None

        log("find_thread_fbid: no thread found", {"totalThreads": len(threads), "targetPk": target_pk})
        return None, None, f"No existing DM thread found for userId {recipient_pk}"
    except Exception as e:
        log("find_thread_fbid: exception", {"error": str(e)})
        return None, None, f"Error finding thread: {str(e)}"

# ──────────────────────────────────────────────
# Send DM via GraphQL mutation (from browser context)
# ──────────────────────────────────────────────
def send_dm_via_browser(driver, thread_fbid, recipient_igids, text, tokens):
    """
    Send DM using fetch() from within the browser context.
    Same-origin → cookies, CSRF, TLS all handled by the browser natively.
    """
    offline_threading_id = generate_offline_threading_id()
    ds_user_id = str(tokens.get("viewer_id", ""))

    # Build the form data exactly like the browser would
    variables = {
        "commands": None,
        "forwarded_from_thread_id": None,
        "ig_thread_igid": str(thread_fbid) if thread_fbid else None,
        "is_forwarded_from_own_message": None,
        "mentioned_user_ids": None,
        "mentions": None,
        "offline_threading_id": offline_threading_id,
        "recipient_igids": recipient_igids if recipient_igids else None,
        "replied_to_item_id": None,
        "reply_to_message_id": None,
        "sampled": None,
        "send_attribution": "igd_web_chat_tab:in_thread",
        "text": {"sensitive_string_value": text},
    }

    # Build URLSearchParams (what the browser sends for form-encoded)
    params = {
        "doc_id": IGDirectTextSendMutation_DOC_ID,
        "fb_api_caller_class": "RelayModern",
        "fb_api_req_friendly_name": "IGDirectTextSendMutation",
        "server_timestamps": "true",
        "variables": json.dumps(variables),
        "fb_dtsg": tokens.get("fb_dtsg", ""),
        "jazoest": tokens.get("jazoest", ""),
        "lsd": tokens.get("lsd", ""),
        "__user": ds_user_id,
        "__a": "1",
        "__req": str(next_req()),
        "__rev": tokens.get("rev", "1055532492"),
        "dpr": "1",
        "__comet_req": "7",
        "__spin_r": tokens.get("rev", "1055532492"),
        "__spin_b": "trunk",
        "__spin_t": "",
    }
    params = {k: v for k, v in params.items() if v is not None and v != ""}

    # Build form body as URLSearchParams (browser-style)
    form_body = "&".join(f"{k}={v}" for k, v in params.items())

    log("send_dm_via_browser: sending", {
        "doc_id": IGDirectTextSendMutation_DOC_ID,
        "thread_fbid": thread_fbid,
        "recipient_igids": recipient_igids,
        "offline_threading_id": offline_threading_id,
        "textLength": len(text),
    })

    # Use the browser's fetch() — same-origin, all auth handled natively
    result = browser_fetch(driver, "https://www.instagram.com/api/graphql/", json.dumps({
        "method": "POST",
        "headers": {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-IG-App-ID": IG_APP_ID,
            "X-IG-D": "www",
            "X-CSRFToken": tokens.get("csrftoken", ""),
            "X-Requested-With": "XMLHttpRequest",
            "X-ASBD-ID": "129477",
            "X-FB-Friendly-Name": "IGDirectTextSendMutation",
            "Accept": "application/json",
        },
        "body": form_body,
    }))

    status = result["status"]
    resp_text = result["text"]

    # Strip "for (;;);" prefix
    if resp_text.startswith("for (;;);"):
        resp_text = resp_text[9:]

    log("send_dm_via_browser: response", {
        "status": status,
        "bodyLength": len(resp_text),
        "bodyPreview": resp_text[:600],
    })

    # Parse response
    try:
        body = json.loads(resp_text)
    except:
        body = {"raw": resp_text[:500]}

    ok = status >= 200 and status < 300
    graphql_errors = None

    if isinstance(body, dict):
        if body.get("error"):
            ok = False
            graphql_errors = [{"message": body.get("errorSummary", ""), "description": body.get("errorDescription", "")}]
            log("send_dm_via_browser: error", {
                "error": body.get("error"),
                "summary": body.get("errorSummary"),
                "desc": body.get("errorDescription"),
            })

        response_key = "xig_direct_text_send_with_slide_messaging_response"
        if response_key in body.get("data", {}):
            msg_data = body["data"][response_key]
            if msg_data:
                ok = True
                log("send_dm_via_browser: message sent!", {
                    "message_id": msg_data.get("message_id"),
                    "timestamp_ms": msg_data.get("timestamp_ms"),
                })

    thread_id = thread_fbid
    return ok, status, body, graphql_errors, offline_threading_id, thread_id

# ──────────────────────────────────────────────
# Commands
# ──────────────────────────────────────────────

def cmd_verify_session(payload):
    sessionid = payload["sessionid"]
    csrftoken = payload.get("csrftoken") or payload.get("csrfToken") or ""
    ds_id = sessionid.split(":")[0] if ":" in sessionid else ""
    try:
        driver = inject_session(sessionid, csrftoken)
        page_source = driver.page_source
        if 'not-logged-in' in page_source[:5000]:
            return {"valid": False, "reason": "Session rejected — Instagram returned login page."}
        
        tokens = extract_tokens_from_browser(driver)
        
        # Try to extract sender username
        username = None
        full_name = None
        profile_pic = None

        m_viewer = re.search(r'"viewer":\{"id":"\d+","username":"([^"]+)"\}', page_source)
        if m_viewer:
            username = m_viewer.group(1)
        if not username:
            m_u = re.search(r'"username":"([^"]+)","badge_count"', page_source)
            if m_u:
                username = m_u.group(1)

        # 1. Fetch web account settings to get real username
        if not username or username.isdigit():
            try:
                acc_res = browser_fetch(driver, "https://www.instagram.com/api/v1/web/accounts/edit/web_form_data/", json.dumps({
                    "method": "GET",
                    "headers": {
                        "X-IG-App-ID": IG_APP_ID,
                        "Accept": "application/json"
                    }
                }))
                if acc_res.get("status") == 200:
                    acc_data = json.loads(acc_res.get("text", "{}"))
                    fd = acc_data.get("form_data", {})
                    if fd.get("username"):
                        username = fd.get("username")
                        full_name = fd.get("first_name") or username
            except Exception as e:
                log("cmd_verify_session: web_form_data note", {"err": str(e)})
        
        # Fetch own user info via browser fetch (same-origin, authenticated)
        if ds_id:
            try:
                info_res = browser_fetch(driver, f"https://www.instagram.com/api/v1/users/{ds_id}/info/", json.dumps({
                    "method": "GET",
                    "headers": {
                        "X-IG-App-ID": IG_APP_ID,
                        "Accept": "application/json"
                    }
                }))
                if info_res.get("status") == 200:
                    info_data = json.loads(info_res.get("text", "{}"))
                    u_obj = info_data.get("user", {})
                    if u_obj.get("username"):
                        username = u_obj.get("username")
                    full_name = u_obj.get("full_name")
                    profile_pic = u_obj.get("profile_pic_url")
            except Exception as e:
                log("cmd_verify_session: user info fetch note", {"err": str(e)})

        if not username:
            username = tokens.get("viewer_id") or ds_id or "authenticated_user"

        return {
            "valid": True,
            "sender": {
                "username": username,
                "userId": ds_id or tokens.get("viewer_id"),
                "fullName": full_name or username,
                "profilePic": profile_pic,
                "authenticated": True
            },
            "tokens": {
                "fb_dtsg": tokens.get("fb_dtsg"),
                "lsd": tokens.get("lsd"),
                "csrftoken": tokens.get("csrftoken") or csrftoken,
                "jazoest": tokens.get("jazoest"),
                "rev": tokens.get("rev", "1055532492"),
                "viewer_id": tokens.get("viewer_id") or ds_id
            }
        }
    except Exception as e:
        return {"valid": False, "reason": f"Browser verification error: {str(e)}"}
    finally:
        quit_driver()

def cmd_batch_resolve(payload):
    sessionid = payload["sessionid"]
    csrftoken = payload.get("csrftoken") or payload.get("csrfToken") or ""
    recipients = payload.get("recipients") or payload.get("usernames") or []
    
    if not recipients:
        return {"ok": True, "results": []}

    try:
        driver = inject_session(sessionid, csrftoken)
        results = []

        for raw_u in recipients:
            u = str(raw_u).strip().lstrip('@')
            if not u:
                continue

            resolved_uid = None
            is_private = False
            full_name = ""
            profile_pic = ""

            # Attempt 1: fast search API via browser fetch (~150ms per user)
            try:
                search_url = f"https://www.instagram.com/api/v1/web/search/topsearch/?context=blended&query={u}&include_reel=false"
                sr = browser_fetch(driver, search_url, json.dumps({
                    "method": "GET",
                    "headers": {
                        "X-IG-App-ID": IG_APP_ID,
                        "Accept": "application/json"
                    }
                }))
                if sr.get("status") == 200:
                    s_data = json.loads(sr.get("text", "{}"))
                    for item in s_data.get("users", []):
                        usr = item.get("user", {})
                        if usr.get("username", "").lower() == u.lower():
                            resolved_uid = str(usr.get("pk", ""))
                            is_private = bool(usr.get("is_private"))
                            full_name = usr.get("full_name", "")
                            profile_pic = usr.get("profile_pic_url", "")
                            break
            except Exception as search_err:
                log("topsearch note", {"u": u, "err": str(search_err)})

            # Attempt 2 (fallback): navigate to user profile page
            if not resolved_uid:
                try:
                    driver.get(f'https://www.instagram.com/{u}/')
                    time.sleep(1.2)
                    title = driver.title
                    html = driver.page_source

                    if "Profile isn't available" in title or "Page Not Found" in title or "Sorry, this page isn't available." in html:
                        results.append({
                            "username": u,
                            "exists": False,
                            "userId": None,
                            "error": "Profile not found or disabled"
                        })
                        continue

                    match = re.search(r'"profilePage_(\d+)"', html) or re.search(r'"user_id":"(\d+)"', html) or re.search(r'"pk":"(\d+)"', html)
                    if match:
                        resolved_uid = match.group(1)
                    is_private = '"is_private":true' in html
                except Exception as page_err:
                    log("page lookup note", {"u": u, "err": str(page_err)})

            if resolved_uid:
                results.append({
                    "username": u,
                    "exists": True,
                    "userId": resolved_uid,
                    "isPrivate": is_private,
                    "fullName": full_name or u,
                    "profilePic": profile_pic
                })
            else:
                results.append({
                    "username": u,
                    "exists": False,
                    "userId": None,
                    "error": "Could not extract user ID"
                })

        return {"ok": True, "results": results}
    except Exception as e:
        return {"ok": False, "error": str(e), "results": []}
    finally:
        quit_driver()

def cmd_fast_send(payload):
    sessionid = payload["sessionid"]
    csrftoken = payload.get("csrftoken") or payload.get("csrfToken") or ""
    recipient = payload["recipient"]
    recipient_uid = payload.get("recipientUserId") or payload.get("userId")
    text = payload["text"]
    pre_tokens = payload.get("tokens") or {}

    if not recipient_uid:
        return cmd_send_dm(payload)

    try:
        driver = inject_session(sessionid, csrftoken)
        tokens = pre_tokens if (pre_tokens.get("fb_dtsg") and pre_tokens.get("csrftoken")) else extract_tokens_from_browser(driver)

        recipient_igids = [str(recipient_uid)]
        thread_fbid = payload.get("threadId")

        if not thread_fbid:
            thread_fbid, interop_fbid, _ = find_thread_fbid(driver, recipient_uid, csrftoken)
            if interop_fbid:
                recipient_igids = [str(interop_fbid)]

        ok, status, body, errors, otid, tid = send_dm_via_browser(driver, thread_fbid, recipient_igids, text, tokens)

        return {
            "ok": ok,
            "status": status,
            "body": body,
            "threadId": tid,
            "userId": str(recipient_uid),
            "errors": errors,
            "offlineThreadingId": otid
        }
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        return {"ok": False, "status": 0, "reason": str(e)}
    finally:
        quit_driver()

def cmd_validate(payload):
    sessionid = payload["sessionid"]
    csrftoken = payload.get("csrftoken", "")
    result = validate_session(sessionid, csrftoken)
    return result

def cmd_resolve(payload):
    sessionid = payload["sessionid"]
    csrftoken = payload.get("csrftoken", "")
    username = payload["username"]
    result = resolve_userid(sessionid, csrftoken, username)
    return result

def cmd_send_dm(payload):
    sessionid = payload["sessionid"]
    csrftoken = payload.get("csrftoken", "")
    recipient = payload["recipient"]
    text = payload["text"]

    try:
        driver = inject_session(sessionid, csrftoken)
        tokens = extract_tokens_from_browser(driver)

        # Resolve recipient userId from profile page
        driver.get(f'https://www.instagram.com/{recipient}/')
        time.sleep(2)
        page_source = driver.page_source
        match = re.search(r'"profilePage_(\d+)"', page_source)
        if not match:
            return {"ok": False, "status": 0, "reason": "Could not resolve recipient userId"}
        uid = match.group(1)
        log("send_dm: resolved recipient", {"recipient": recipient, "userId": uid})

        # Find thread_fbid
        thread_fbid, interop_fbid, thread_reason = find_thread_fbid(driver, uid, csrftoken)

        if thread_fbid:
            recipient_igids = [interop_fbid] if interop_fbid else None
        else:
            recipient_igids = [str(uid)]

        # Send DM via browser fetch
        ok, status, body, errors, otid, tid = send_dm_via_browser(driver, thread_fbid, recipient_igids, text, tokens)

        return {
            "ok": ok,
            "status": status,
            "body": body,
            "threadId": tid,
            "userId": uid,
            "errors": errors,
        }
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        return {"ok": False, "status": 0, "reason": str(e)}
    finally:
        quit_driver()

def cmd_debug(payload):
    sessionid = payload["sessionid"]
    csrftoken = payload.get("csrftoken", "")
    recipient = payload["recipient"]
    text = payload["text"]

    try:
        driver = inject_session(sessionid, csrftoken)
        tokens = extract_tokens_from_browser(driver)

        # Resolve recipient
        driver.get(f'https://www.instagram.com/{recipient}/')
        time.sleep(2)
        page_source = driver.page_source
        match = re.search(r'"profilePage_(\d+)"', page_source)
        if not match:
            return {"ok": False, "step": "resolve", "reason": "Could not resolve recipient userId"}
        uid = match.group(1)
        log("debug: resolved recipient", {"recipient": recipient, "userId": uid})

        # Find thread
        thread_fbid, interop_fbid, thread_reason = find_thread_fbid(driver, uid, csrftoken)
        log("debug: thread lookup", {"thread_fbid": thread_fbid, "interop_fbid": interop_fbid, "reason": thread_reason})

        recipient_igids = [interop_fbid] if interop_fbid else [str(uid)]

        # Send
        ok, status, body, errors, otid, tid = send_dm_via_browser(driver, thread_fbid, recipient_igids, text, tokens)

        return {
            "ok": ok,
            "step": "send_dm",
            "statusCode": status,
            "responseBody": json.dumps(body)[:500] if isinstance(body, dict) else str(body)[:500],
            "responseBodyRaw": json.dumps(body)[:2000] if isinstance(body, dict) else str(body)[:2000],
            "userId": uid,
            "threadId": tid,
            "offlineThreadingId": otid,
            "tokens": {k: (v[:20] + "..." if isinstance(v, str) and len(v) > 20 else v) for k, v in tokens.items()},
            "graphqlErrors": errors,
            "recipientIgids": recipient_igids,
        }
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        return {"ok": False, "step": "error", "reason": str(e)}
    finally:
        quit_driver()

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
        elif command == "verify-session":
            result = cmd_verify_session(payload)
        elif command == "resolve":
            result = cmd_resolve(payload)
        elif command == "batch-resolve":
            result = cmd_batch_resolve(payload)
        elif command == "send-dm":
            result = cmd_send_dm(payload)
        elif command == "fast-send":
            result = cmd_fast_send(payload)
        elif command == "debug":
            result = cmd_debug(payload)
        else:
            result = {"ok": False, "error": f"Unknown command: {command}"}
    except Exception as e:
        result = {"ok": False, "error": str(e)}

    print(json.dumps(result, ensure_ascii=False))