# Instagram DM Campaign Manager (SPA)

A lightweight, single-screen web application for managing Instagram DM outreach campaigns. Built strictly as a client-side Single-Page Application (SPA) with browser `localStorage` persistence, zero database overhead, and isolated delivery adapters.

---

## 1. Design & Interface Principles

- **Single-Screen Architecture:** Everything is accessible from **one screen** without sidebars, multi-tab routing, or unnecessary clutter.
- **Visual Design:** Neutral monochrome theme (`#09090b` zinc-950, `#121215` cards, `#27272a` borders, crisp typography, tabular numerals). Inspired by Linear, Raycast, and modern developer utilities.
- **Zero Heavy Aesthetics:** No gradients, no glowing effects, no glassmorphism, no rounded card bloat.

---

## 2. Core Features & Functional Modules

### A. Instagram Session
- **Input:** Password-style masked input to paste the Instagram `sessionid` cookie obtained from browser DevTools (`Application > Cookies > https://www.instagram.com`).
- **Show/Hide:** Instant toggle for visibility.
- **Local Persistence:** Saves exclusively into browser `localStorage`.
- **Security:** Credentials are never transmitted to external servers, logged, or included in exports.
- **Connection Indicator:** Live badge reflecting session presence.

### B. Recipients
- **Input:** Large textarea accepting Instagram handles (one per line).
- **Auto-Deduplication:** Automatically strips duplicate entries and normalizes `@` prefixes.
- **Validation:** Enforces standard Instagram handle rules (`^[a-zA-Z0-9._]{1,30}$`).
- **File Import:** Import `.txt` or `.csv` files directly into the recipient queue.
- **Controls:** Instant Clear and Deduplicate buttons.

### C. Message Composer
- **Editor:** Large, clean textarea for outreach copy.
- **Personalization:** Full support for `{{username}}` and `{{handle}}` variable tags.
- **Quick Insert:** One-click `+ {{username}}` chip inserting the variable at the active cursor position.
- **Character Counter:** Real-time character count.
- **Live Preview:** Real-time rendering demonstrating the final message output with a sample handle (`@alex_creator`).

### D. Campaign Scheduling & Feasibility Analyzer
- **Scheduling Controls:**
  - Start Time (`datetime-local`)
  - Target Completion Deadline (`datetime-local`)
  - Deterministic Pacing Interval in seconds (e.g. 30s)
  - Maximum Permitted Sending Volume (e.g. 50 messages)
- **Feasibility Safeguard:** The completion deadline is a target, **never an excuse to exceed platform limits**.
  - Calculates whether `recipients.length * pacingInterval` can physically finish before the deadline.
  - If infeasible, warns with the exact unserviced shortfall and provides a 1-click **Align Deadline** button.

### E. Campaign Controls & Delivery Monitoring
- **Controls:** Start Campaign, Pause, Resume, and Stop.
- **Delivery Adapters:**
  1. **Simulation / Dry-Run Engine:** Executes full deterministic queue pacing, message interpolation, and status updates for zero-risk operational testing.
  2. **Direct Browser Session Adapter:** Directly demonstrates the client-side security reality: browser cross-origin requests to Instagram's private endpoints are stopped by browser CORS/CSRF boundaries, cleanly explaining why private cookies cannot be injected across domains without a native desktop extension.
- **Live Counters:** Total Recipients, Sent, Failed, Remaining, and Progress Percentage.
- **Live Execution Feed:** Real-time scrollable log table recording timestamps, recipient handles, status badges, and delivery notes.

### F. Local Persistence & Backup
- **Browser localStorage:** Automatically persists:
  - Session ID (`insta_session_id`)
  - Recipient list (`insta_recipients`)
  - Message copy (`insta_message`)
  - Schedule bounds (`insta_schedule`)
  - Delivery preferences (`insta_adapter`)
  - Real-time logs and statistics
- **JSON Backup:**
  - **Export:** Downloads clean JSON file.
  - **Security Guarantee:** **Session ID is permanently excluded from all exported backup files**.
  - **Import:** Restores previously saved campaign configurations.

---

## 3. Running the Application

### Option 1: Built-in Node Static Server (Included)
```bash
npm start
# or: node server.js
```
Open **[http://localhost:5050](http://localhost:5050)** in your browser.

### Option 2: Apache / XAMPP
Since this project resides in `c:\xampp\htdocs\codes\insta_bot`, you can also open it directly through Apache at:
```
http://localhost/codes/insta_bot/index.html
```

### Option 3: Direct File Open
You can open `index.html` directly in any web browser without running any server at all:
```
file:///c:/xampp/htdocs/codes/insta_bot/index.html
```

---

## 4. Automated Tests

Run the test suite:
```bash
npm test
```
Verifies username format validation, deduplication, message variable interpolation, scheduling feasibility calculations, and session ID export security.
