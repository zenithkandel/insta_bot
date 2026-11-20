# InstaDM — High-Speed Local Instagram Campaign Manager

An ultra-minimalist, high-performance web tool for managing personalized Instagram direct message (DM) outreach campaigns. Built with an editorial warm light theme, pure vector SVG icons, and a dedicated **one tab = one feature** architecture.

Runs 100% locally on your machine with **sub-second GraphQL DM delivery** powered by a persistent headless Chrome background daemon.

---

## Security & Local Privacy Guarantee

> **Your session ID never leaves your own computer.**
> 
> * **Zero External Servers:** InstaDM has no cloud backend, no remote databases, and no external tracking telemetry.
> * **Local Storage Only:** Your Instagram session cookie (`sessionid`) is stored exclusively in your browser's private `localStorage`.
> * **Local Loopback Communication:** All requests pass solely through your local loopback address (`http://127.0.0.1:5050` and `http://127.0.0.1:5055`) to your locally running headless Chrome instance.
> * **Backup Security:** When exporting campaign JSON backups, your session ID is permanently and automatically scrubbed.

---

## Key Features

* **Dedicated Tabbed Workflow (One Tab = One Feature):**
  * **Session Tab:** Paste and verify your Instagram `sessionid` cookie. View authenticated account details and manage credentials.
  * **Recipients Tab:** Import, search, and verify Instagram handles. Filter by status (`All`, `Selected`, `Verified`, `Unchecked`, `Not Found`), bulk select/deselect, and pre-cache numeric user IDs.
  * **Composer Tab:** Draft messages with `{{username}}` personalization tags, live character/word counters, and real-time personalized previews.
  * **Dispatch Tab:** Set parallel workers (from 1 up to all selected recipients) and pacing delays. Launch, pause, resume, and track live delivery with real-time progress bars.
  * **Activity Tab:** Inspect formatted execution logs with high-precision timestamps, recipient tags, and measured latency (e.g. `185ms`).
* **Sub-Second GraphQL Delivery:** Direct browser-authenticated GraphQL mutations (`IGDirectTextSendMutation`) routed through Chrome DevTools Protocol (CDP) cookie injection and persistent browser daemon.
* **Smart Upfront Verification:** Pre-resolves recipient profiles and pre-caches numeric user IDs so messages send instantly without re-querying existing profiles.
* **Scalable for 100s of Handles:** Virtualized/compact table rendering with instant client-side search across handles, names, and user IDs.
* **Warm Light Editorial Design:** Beige paper background, deep charcoal typography, zero emojis, zero gradients, zero AI-slop bloat.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│            Browser Frontend SPA (Port 5050)            │
│         HTML5 / CSS3 / Vanilla JavaScript ES6+         │
└───────────────────────────┬────────────────────────────┘
                            │ Local HTTP / REST
┌───────────────────────────▼────────────────────────────┐
│              Node.js Local Server (server.js)          │
│            Serves SPA & Proxies API Requests           │
└───────────────────────────┬────────────────────────────┘
                            │ HTTP Loopback (Port 5055)
┌───────────────────────────▼────────────────────────────┐
│         Python Daemon Worker (ig_worker.py)            │
│  Headless Chrome (Selenium) + CDP Cookie Injection     │
│       Sub-Second IGDirectTextSendMutation GraphQL      │
└────────────────────────────────────────────────────────┘
```

---

## Prerequisites

Before running InstaDM, make sure your machine has:

1. **Node.js** (v18.0.0 or higher) — [Download Node.js](https://nodejs.org/)
2. **Python** (v3.10 or higher) — [Download Python](https://www.python.org/)
3. **Google Chrome** browser installed on your computer.

---

## Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/zenithkandel/insta_bot.git
   cd insta_bot
   ```

2. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

3. **Install Python dependencies:**
   ```bash
   pip install selenium curl_cffi requests webdriver-manager
   ```

4. **Start the application:**
   ```bash
   npm start
   # Or directly: node server.js
   ```

5. **Open in your browser:**
   ```
   http://localhost:5050
   ```

---

## How to Get Your Instagram Session ID

InstaDM uses your browser's existing authenticated Instagram session cookie. You never need to enter your Instagram password.

1. Open your browser (Chrome, Edge, Brave, etc.) and log in to [instagram.com](https://www.instagram.com).
2. Press `F12` (or right-click anywhere on the page and select **Inspect**) to open **Developer Tools**.
3. Select the **Application** tab at the top (if hidden, click the `>>` overflow menu).
4. In the left sidebar, expand **Cookies** and click `https://www.instagram.com`.
5. Look for the cookie with the name `sessionid`.
6. Double-click the **Value** column of `sessionid` and copy the entire string.
7. Paste this string into InstaDM under the **Session** tab and click **Save & Verify**.

---

## Step-by-Step Usage Guide

### 1. Connect Session (Tab 1)
* Navigate to the **Session** tab.
* Paste your `sessionid` cookie and click **Save & Verify**.
* InstaDM will authenticate with Instagram and display your username, profile avatar, and numeric user ID.

### 2. Add & Verify Recipients (Tab 2)
* Go to the **Recipients** tab.
* Click **Add Handles** to paste usernames (one per line, with or without `@`), or upload a `.txt` or `.csv` file. Duplicates are stripped automatically.
* Click **Verify IDs** to resolve profile existence and cache numeric Instagram IDs upfront. Handles that do not exist will be marked as `404 Missing` and can be removed with one click.
* Use the checkboxes to select which recipients should receive messages in this run.

### 3. Draft Message (Tab 3)
* Switch to the **Composer** tab.
* Write your message copy.
* Click the **Insert `{{username}}`** button to personalize each DM with the recipient's handle.
* Review the **Live Preview** card to see exactly how your message will appear to the first selected recipient.

### 4. Dispatch Campaign (Tab 4)
* Open the **Dispatch** tab.
* Choose your **Parallel Workers** (e.g. `1 Safe`, `3 Balanced`, `5 Fast`, or `All Selected`).
* Set a **Pacing Delay** (e.g. `0s` for instant delivery, or `2s-5s` for spaced pacing).
* Click **Start Campaign (X Recipients)**.
* Watch the live progress bar, sent/failed metrics, and worker status in real time.

### 5. Inspect Activity (Tab 5)
* View real-time dispatch logs with exact millisecond latency (e.g. `Sent (185ms)`).
* Filter logs by `All`, `Sent`, `Failed`, or `System`.
* Export logs as a structured JSON file at any time.

---

## Safety & Best Practices

* **Warm-up Volume:** If using a new or rarely used account, start with 1-3 parallel workers and send in batches of 15-25 recipients per day.
* **Established Accounts:** Accounts with established DM activity can comfortably use 3-5 workers.
* **Pacing Delay:** For large campaigns (50+ recipients), setting a 2 to 5-second pacing delay helps maintain natural delivery cadences.

---

## License

MIT License. Developed for local outreach and personal campaign management.
