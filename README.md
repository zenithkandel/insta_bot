# InstaDM — High-Speed Local Instagram DM Outreach & Campaign Manager

<p align="center">
  <img src="https://img.shields.io/badge/Release-v2.4.0-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/Privacy-100%25_On--Device-success?style=flat-square" alt="Privacy" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18.0-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node" />
  <img src="https://img.shields.io/badge/Python-%3E%3D3.10-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/Chrome-Headless_CDP-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome" />
</p>

> **InstaDM** is a high-speed, privacy-first local Instagram direct message (DM) outreach tool. Send personalized bulk cold outreach messages using sub-second GraphQL mutation delivery powered by a warm headless Chrome daemon. **Runs 100% locally on your machine with zero cloud databases, zero monthly subscription fees, and zero credential leakage.**

---

## 🔒 Security & Local Privacy Guarantee

Unlike cloud-hosted SaaS outreach tools that require handing over your Instagram account credentials or session cookies to remote third-party servers, **InstaDM operates entirely on your personal computer**:

* **Zero External Cloud Servers:** InstaDM has no remote backend, no external databases, and no analytics or telemetry tracking.
* **100% Localhost Execution:** Your browser communicates exclusively with your own machine over loopback ports (`http://127.0.0.1:5050` and `http://127.0.0.1:5055`).
* **Encrypted On-Device Storage:** Your Instagram session cookie (`sessionid`) is stored strictly in your browser's local `localStorage`.
* **Safe Export Scrubbing:** When exporting campaign backups or activity logs, your session ID is permanently and automatically stripped to prevent accidental credential leakage.

---

## ⚡ Why InstaDM vs. Cloud SaaS Platforms?

| Feature | InstaDM (Local) | Typical Cloud Outreach SaaS |
| :--- | :--- | :--- |
| **Pricing** | **100% Free & Open Source** | $50 – $200 / month |
| **Credential Safety** | **100% On-Device** (Never leaves machine) | Stored on third-party remote servers |
| **Delivery Speed** | **Sub-Second (~180ms)** via Warm Daemon | Slow queue processing (minutes per message) |
| **Meta Verification** | **None Required** (No Graph API review) | Complex business verification required |
| **Database Overhead** | **Zero** (Browser localStorage persistence) | Heavy remote database / account setup |
| **Personalization** | **Full `{{username}}` interpolation** | Variable support gated behind tiers |
| **Tracking / Ads** | **Zero ads, zero telemetry, zero trackers** | Heavy user behavior tracking |

---

## 🛠️ Key Capabilities & Features

### 1. Dedicated Tabbed Architecture (One Tab = One Feature)
* **Session Tab:** Paste and verify your browser `sessionid` cookie in seconds. Inspect authenticated account username, profile avatar, and numeric user ID.
* **Recipients Tab:** Bulk import handles from raw text or `.txt`/`.csv` files. Real-time search across handles, names, and IDs. Individual and master selection checkboxes.
* **Composer Tab:** Clean message editor with live character and word counters. Includes a one-click `{{username}}` personalization tag button and live preview.
* **Dispatch Tab:** Full concurrency management. Choose parallel workers (`1 Safe`, `3 Balanced`, `5 Fast`, or `All Selected`) and custom pacing intervals. Real-time progress bar with sent/failed/remaining counters.
* **Activity Tab:** Beautified monospace event logs showing exact millisecond timestamps, delivery latency (e.g. `185ms`), recipient handles, and error details. Exportable to JSON.

### 2. Sub-Second GraphQL Mutation Engine
InstaDM utilizes Instagram's native internal GraphQL mutations (`IGDirectTextSendMutation`) combined with Chrome DevTools Protocol (CDP) cookie injection and a persistent background daemon on port `5055`. This eliminates cold browser startups, sending DMs in **sub-second intervals** (~180ms – 300ms).

### 3. Smart Upfront Recipient Verification
Pre-caches numeric Instagram user IDs before dispatching. If you add 20 handles, clicking **Verify IDs** resolves profile existence upfront. Missing profiles (`404 Not Found`) are isolated immediately, preventing failed dispatch attempts.

### 4. Minimalist Warm Light Editorial Design
Crafted with a warm beige paper aesthetic (`#f5f1ea`), crisp stone borders (`#ded7ca`), and deep charcoal typography (`#1c1917`). **Zero emojis, pure vector SVGs, and zero AI-slop elements.**

---

## 🚀 Quick Start Guide

### Prerequisites
* **Node.js** (v18.0.0 or higher)
* **Python** (v3.10 or higher)
* **Google Chrome** desktop browser

### 1. Clone & Install
```bash
git clone https://github.com/zenithkandel/insta_bot.git
cd insta_bot

# Install Node.js proxy server
npm install

# Install Python daemon dependencies
pip install -r requirements.txt
```

### 2. Run the Application
```bash
npm start
# or: node server.js
```

Open your browser to:
```
http://localhost:5050
```

---

## 🔑 How to Retrieve Your Instagram Session Cookie

You do not need to share or enter your Instagram password. InstaDM uses your browser's existing authenticated session cookie:

1. Open your browser and log in to [instagram.com](https://www.instagram.com).
2. Press `F12` (or right-click anywhere and select **Inspect**) to open **Developer Tools**.
3. Navigate to the **Application** tab (in Firefox: **Storage**).
4. Under **Storage** in the left sidebar, click **Cookies** > `https://www.instagram.com`.
5. Locate the row named **`sessionid`**.
6. Double-click the **Value** column, copy the string, and paste it into InstaDM under the **Session** tab.

---

## 📖 Operational Guidelines & Safety Best Practices

* **New / Low-Activity Accounts:** Start conservative. Use 1–2 parallel workers with a pacing delay of 5–10 seconds, dispatching no more than 15–25 DMs per day.
* **Aged / Active Accounts:** Established accounts can comfortably dispatch with 3–5 parallel workers and a 2–3 second pacing delay.
* **Warm Daemon Status:** The top navigation bar displays a live status indicator (`● Chrome Warm (Ready)`). Ensure this is active before launching large volume dispatches for maximum delivery speed.

---

## ❓ Frequently Asked Questions (FAQ)

### How does InstaDM send direct messages so quickly?
Unlike traditional web-scraping bots that navigate to each user's profile and simulate mouse clicks, InstaDM injects your session cookies via Chrome DevTools Protocol (CDP) into a persistent background daemon and dispatches direct, authenticated GraphQL mutations (`IGDirectTextSendMutation`).

### Can anyone see my Instagram session ID?
No. Your session ID is stored strictly in your local browser's `localStorage` and communicates exclusively with your local machine's loopback address (`127.0.0.1`). It is never sent to external servers or included in exported backup files.

### Does InstaDM require Meta Graph API approval or app reviews?
No. InstaDM is a client-side local automation utility that interfaces directly with your authenticated browser session. No Meta Developer accounts or app reviews are required.

### Can I personalize messages for each recipient?
Yes. Use the `{{username}}` variable anywhere in your message copy. InstaDM will dynamically interpolate each recipient's handle at the moment of dispatch.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
