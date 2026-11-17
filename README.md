# Instagram DM Outreach Manager

A polished, desktop-first application for managing Instagram DM outreach campaigns built with strict adherence to Meta Platform Terms, authorized Meta Graph API v21.0 messaging architecture, and disciplined rate-limit safeguards.

---

## 1. Core Architectural Pillars

- **Authorized API Usage Only:** Operates strictly through sanctioned Meta Graph API endpoints or a high-fidelity Authorized Sandbox Simulator. Never relies on private API exploitation, cookie replay, credential injection, or CAPTCHA bypass tricks.
- **Strict Schedule Feasibility Safeguards:** The completion deadline is treated as a scheduling target, **never an excuse to exceed platform limits**. If a campaign cannot finish within permitted daily quotas and sending windows, the engine calculates the shortfall, warns the operator, and recommends a compliant deadline.
- **Persistent Queue Engine:** Backed by SQLite in Write-Ahead Logging (WAL) mode. Recovers in-flight dispatches seamlessly across application restarts without data loss.
- **Consent & Opt-Out Enforcement:** Automatic filtering against a local opt-out blocklist ensures that unsubscribed users are marked `Skipped` before an outbound network packet is dispatched.
- **Zero Credential Exposure:** Raw tokens and session secrets are permanently scrubbed from client-side state, browser storage, and activity logs.
- **Global Emergency Stop:** One-click global tripwire immediately halts all queue processing across active campaigns.

---

## 2. Interface & Feature Breakdown

### A. Dashboard
- Live status of connected Instagram account, token expiration countdown, and operational mode (Sandbox vs. Live).
- High-level metric cards: Total Queued, Messages Sent, Messages Pending, Failed / Policy Restricted, and Opt-Out Skipped.
- Primary campaign progress bar with real-time percentage and tabular metrics.
- Live stream of recent system and dispatch activity logs.

### B. Account Connection
- Connect Instagram account through Meta OAuth flow or system user tokens.
- Display connected username, Instagram Business Account ID, and token expiration status.
- Toggle between **Authorized Sandbox Simulator** (safe zero-risk evaluation) and **Live Meta API**.
- Token masking: raw tokens are never rendered or logged in plaintext.
- Disconnect account control with automatic suspension of active campaigns.

### C. Recipient Management
- Large textarea supporting line-by-line username input.
- CSV file import with header auto-detection and column extraction.
- Automatic duplicate removal with instant counter.
- Strict username formatting validation according to Instagram rules (1-30 chars, alphanumeric, periods, underscores).
- Visual breakdown of valid, duplicate, invalid (with specific reason), and opted-out recipients.
- Individual recipient removal and export of cleaned lists to CSV.
- Dedicated **Consent & Opt-Out Blocklist** manager.

### D. Message Composer & Template Library
- Large message editor with UTF-8 character counter and Meta Graph API 1000-character threshold warning.
- Dynamic personalization chips: `{{username}}` and `{{handle}}`.
- Live simulated Instagram direct message chat bubble preview with test username switcher.
- Saved templates library: save drafts, categorise, load into editor, or delete.

### E. Campaign Scheduling & Feasibility Analyzer
- Configurable parameters:
  - Start time and completion target deadline.
  - Timezone selection.
  - Maximum authorized messages per day (default: 50).
  - Maximum messages per campaign.
  - Sending window (start and end times, e.g. 09:00 - 18:00).
  - Deterministic minimum interval pacing (e.g. 60s gap between dispatches).
- **Feasibility Analyzer:** Computes whether `total_recipients` can physically be dispatched before the deadline under authorized daily limits and window hours.
- If infeasible, displays:
  - Shortfall warning and percentage.
  - Exact number of recipients that will remain unserviced.
  - One-click **Apply Safe Deadline** button that recalculates the target date.

### F. Campaign Execution Engine
- Explicit user confirmation modal before launching any campaign.
- Persistent queue state: `Pending`, `Processing`, `Sent`, `Failed`, `Skipped`, `Awaiting authorization`.
- **Safe Retry Rules:**
  - Retries up to 1 time ONLY for transient network timeouts or 5xx server glitches.
  - **Zero automatic retries** for policy restrictions (24-hr messaging window exceeded, recipient permissions restricted, or 403 authorization failures).
- Automatic suspension upon HTTP 429 rate limit detection.
- Immediate Pause, Resume, Stop, and Delete controls.
- Automatic recovery of in-flight jobs upon application restart.

### G. Activity Logs & Audit Trail
- Structured log tracking: timestamp, recipient username, status, event type, campaign ID, and description.
- Filters by status (sent, failed, skipped, suspended, warning, info) and username search.
- Export logs as CSV.
- Real-time SSE updates without browser reloads.

---

## 3. Technology Stack

- **Runtime:** Node.js (v22+)
- **Backend:** Express.js, Server-Sent Events (SSE)
- **Database:** SQLite via `better-sqlite3` with Write-Ahead Logging (WAL)
- **Frontend:** React 18, Vite, Tailwind CSS, Lucide React
- **Design Language:** Dark monochrome minimal SaaS aesthetic (`#09090b` zinc-950, crisp typography, tabular numerals, subtle borders)

---

## 4. Setup & Running Instructions

### Prerequisites
- Node.js (v18 or higher; v22 recommended)
- npm (v9 or higher)

### Installation
Dependencies are already installed in both `backend` and `frontend`. To reinstall or clean:
```bash
# In backend
cd backend
npm install

# In frontend
cd ../frontend
npm install
```

### Running the Application
To run the server (which serves the compiled frontend and API on port 5050):
```bash
npm start
# or from backend:
node backend/server.js
```
Open **[http://localhost:5050](http://localhost:5050)** in your browser.

To run with frontend hot-module reloading (Vite dev server on port 5173):
```bash
npm run dev:frontend
```

### Environment Configuration
Copy `.env.example` to `.env` to configure custom ports or live Meta Graph API keys:
```bash
cp .env.example .env
```

---

## 5. Automated Verification & Testing

Run the automated test suite covering feasibility math, recipient validation, opt-out filtering, and safety policies:
```bash
npm test
```

### Test Suites Included:
1. `tests/feasibility.test.js`: Validates compliant schedules, catches capacity shortfalls, and computes safe deadline extensions.
2. `tests/queue.test.js`: Tests Instagram handle formatting regex and duplicate resolution.
3. `tests/safety.test.js`: Verifies opt-out blocklist filtering, strict non-retry of policy errors, transient error retries, and token scrubbing.

---

## 6. Meta Permissions & Review Reference

For a comprehensive explanation of Meta App Review, Business Verification, required permissions (`instagram_manage_messages`, `instagram_basic`), and the 24-hour messaging window, see [META_PERMISSIONS_GUIDE.md](file:///c:/xampp/htdocs/codes/insta_bot/META_PERMISSIONS_GUIDE.md).
