<div align="center">
  <img src="icons/icon128.png" alt="TabTidy Icon" width="108" height="108" />
  <h1>TabTidy</h1>
  <p><strong>A lightweight Chrome Side Panel extension for Tab Group navigation, smart deduplication, and tiered auto-sleep &amp; archiving.</strong></p>
  <p>
    <a href="https://wwzhuang01.github.io/tabtidy/"><strong>Homepage</strong></a> ·
    <a href="README.zh-CN.md">简体中文</a> ·
    <a href="#features">Features</a> ·
    <a href="#how-it-works">How It Works</a> ·
    <a href="#installation">Installation</a> ·
    <a href="#privacy">Privacy</a> ·
    <a href="#development">Development</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/Chrome-116%2B-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome 116+" />
    <img src="https://img.shields.io/badge/Manifest-V3-34D399?style=flat-square" alt="Manifest V3" />
    <img src="https://img.shields.io/badge/Dependencies-Zero-F59E0B?style=flat-square" alt="Zero Dependencies" />
    <img src="https://img.shields.io/badge/License-MIT-60A5FA?style=flat-square" alt="MIT License" />
  </p>
</div>

---

**TabTidy** brings together the best parts of a grouped vertical tab switcher, a duplicate tab cleaner, and an automatic idle tab manager — inside Chrome's native **Side Panel**, with **zero build step**, **zero third-party runtime dependencies**, and **100% local execution**.

Built for heavy Chrome users who organize work with **Chrome Tab Groups** and want to stop opening duplicate pages or running out of memory without losing important tabs.

## Features

- **Native Tab Group Names & Colors**: Displays every open window organized by **Pinned**, **Chrome Tab Groups** (preserving authentic Chromium group colors, left accent bars, and group titles), and **Ungrouped** tabs.
- **Side Panel + Instant Cross-Window Jump**: Search across titles, URLs, and **Tab Group names** across all open Chrome windows. Click any item to activate the tab and focus its window immediately, with a one-click **Expand All / Collapse All** toggle.
- **Smart Duplicate Detection & Deduplication**:
  - Automatically detects duplicate tabs with configurable URL normalization (ignores `#hash` fragments and trailing slashes by default; optional `?query` ignore).
  - Smart keeper ranking automatically keeps the best copy: **Focused Active > Active > Pinned > Locked > Named Group > Grouped > Most Recent**.
  - One-click bulk or per-URL deduplication, plus an optional **Auto-jump on duplicate open** switch.
- **Independent Tiered Idle Policy (Sleep & Archive)**:
  - **Ungrouped tabs**: Auto-sleep via `chrome.tabs.discard` after **15 min** (set `0` to disable), auto-close into Corral after **60 min**.
  - **Grouped tabs**: Auto-sleep after **30 min** (stays neatly in its Tab Group while freeing RAM), auto-close after **24 hours** — or toggle **Sleep-only for grouped tabs** to never auto-close grouped work.
- **Group-Aware Corral Recovery**: Every tab closed by TabTidy (auto-idle, dedupe, or manual close) is saved locally (up to 500 items) with its original **Tab Group name and color**. Clicking to restore automatically puts it back into a matching open group or recreates the group.
- **Built-In Safety Guardrails**: Never auto-sleeps or closes active tabs, pinned tabs, audible tabs (meetings/music), manually locked tabs/groups/windows, whitelisted domains, or internal Chrome pages; respects a configurable minimum open tab floor.
- **Adaptive Light & Dark UI**: Automatically follows your system/Chrome appearance, built specifically for narrow Side Panel widths (320px+).

## How It Works

### Default Tidy Rules

| Tab Type | Auto-Sleep (Free RAM) | Auto-Close to Corral | Customizable |
| :--- | :--- | :--- | :--- |
| **Ungrouped Tabs** | `15 min` (`0` to disable) | `60 min` | Independent timers in Settings |
| **Grouped Tabs** | `30 min` | `24 hours` (or **Sleep-only**) | Independent timers + Sleep-only switch |

- Background sweep runs every **1 minute** via Manifest V3 `chrome.alarms` (never relies on an always-on page or `setInterval`).
- Pause/Resume auto-tidy anytime from the header, or trigger an immediate sweep with **Tidy Now** (`立即整理`).
- Session locks (per-tab, per-group, or per-window) protect critical pages during the current Chrome session.

### Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| **`⌘ + Shift + E`** (macOS) / **`Ctrl + Shift + E`** (Windows/Linux) | Open TabTidy Side Panel (rebindable at `chrome://extensions/shortcuts`) |
| **`/`** | Focus search box in Tabs or Corral view |
| **`Esc`** | Clear active search query |

## Installation

TabTidy requires **no build step and no `npm install`**. Load it directly in Chrome 116+:

1. Clone this repository:
   ```sh
   git clone https://github.com/wwzhuang01/tabtidy.git
   ```
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the cloned `tabtidy` directory.
5. Click the **TabTidy** icon in your toolbar (or press `⌘⇧E` / `Ctrl+Shift+E`) to open the Side Panel.

## Privacy

**100% local, zero network calls.** TabTidy requests no host permissions, injects no content scripts into web pages, and never sends your URLs, titles, or Tab Group names off your machine. All settings, timestamps, and Corral history stay strictly inside your local Chrome profile.

See [PRIVACY.md](PRIVACY.md) for the full permission breakdown.

## Development

### Project Structure

```text
tabtidy/
├── manifest.json          # Chrome Extension Manifest V3 entry
├── sidepanel.html         # Side Panel document
├── icons/                 # Master SVG + 16/32/48/128px PNG icons
├── src/
│   ├── background.js      # MV3 service worker, alarms, Chrome API handlers
│   ├── sidepanel.js       # Side Panel UI & live Chrome event sync
│   ├── sidepanel.css      # Light/Dark theme & Chromium Tab Group colors
│   └── core/
│       ├── url.js         # URL normalization, duplicate grouping, keeper ranking
│       ├── policy.js      # Tiered idle sleep/close engine & settings sanitizer
│       ├── locks.js       # Tab / Group / Window lock helpers
│       └── corral.js      # Recovery history deduplication, capping & search
├── tests/                 # Node.js built-in test runner unit tests
├── docs/                  # Bilingual static product homepage (GitHub Pages)
├── PRIVACY.md             # Local-only privacy policy
└── package.json           # Test script (zero external dependencies)
```

### Run Unit Tests

Requires Node.js 18+:

```sh
npm test
```

## Note on Saved Closed Tab Groups

Chrome's `chrome.tabGroups` extension API currently exposes only **open** Tab Groups (both expanded and collapsed). Saved-and-closed groups living solely on Chrome's bookmarks bar cannot be read by extensions due to Chromium API limits. Keeping active task groups open and letting TabTidy auto-sleep them gives you zero-RAM overhead with full group search and instant jump.

## License

[MIT](LICENSE) © 2026 wwzhuang01
