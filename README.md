<p align="center">
  <img src="logo.png" alt="Pinterest LocalBoard logo" width="120">
</p>

<h1 align="center">Pinterest LocalBoard</h1>

<p align="center">
  A clean Chrome extension that saves an entire Pinterest board into one local ZIP.
</p>

<p align="center">
  <a href="https://github.com/txtgrey/Pinterest-LocalBoard/actions/workflows/validate.yml">
    <img src="https://github.com/txtgrey/Pinterest-LocalBoard/actions/workflows/validate.yml/badge.svg" alt="Validate workflow">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/txtgrey/Pinterest-LocalBoard?style=flat-square" alt="License">
  </a>
  <img src="https://img.shields.io/badge/manifest-v3-black?style=flat-square" alt="Manifest V3">
  <img src="https://img.shields.io/badge/privacy-local%20only-111827?style=flat-square" alt="Privacy local only">
</p>

<p align="center">
  <a href="#quick-start"><strong>Quick Start</strong></a>
  ·
  <a href="#features"><strong>Features</strong></a>
  ·
  <a href="#installation"><strong>Installation</strong></a>
  ·
  <a href="#how-it-works"><strong>How It Works</strong></a>
  ·
  <a href="#development"><strong>Development</strong></a>
</p>

> Built for a simple workflow: open a Pinterest board, click the extension,
> and download the board as a single ZIP on your machine.

Pinterest LocalBoard is intentionally focused. It does not use a backend, it
does not upload your board data, and it does not try to be a Pinterest client.
It detects the current board page, gathers the highest-quality image URLs the
page exposes, downloads what it can, and packages the results into one archive.

## Quick Start

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select the [`extension/`](extension) folder.
6. Open a Pinterest board your current session can access.
7. Click `Pinterest LocalBoard` and press `Download ZIP`.

## Features

| Area | What it does |
| --- | --- |
| Board detection | Detects Pinterest board pages from the active tab and re-checks when Pinterest changes the URL without a full page reload. |
| Full-quality image capture | Prefers the best `i.pinimg.com` image candidate available, including `originals` when Pinterest exposes it. |
| One-click ZIP export | Downloads collected images and bundles them into a single ZIP file locally in the browser. |
| Recovery-aware workflow | Retries image downloads, tolerates partial failures, and still completes the ZIP when possible. |
| Failure reporting | Writes `_download_report.json` into the ZIP with scan details and failed items. |
| Local history | Stores recent downloads in `chrome.storage.local` with board name, ZIP name, counts, and timestamps. |
| Clean popup UI | Includes board info, live progress, quick actions, cancel support, and recent downloads. |

## Why This Exists

- Saving a board image-by-image is slow and tedious.
- Pinterest changes pages like a single-page app, so a downloader needs to
  handle stale detection cleanly.
- Large boards fail badly when one broken asset aborts the whole job.
- Many users want a local export flow without a remote service.

Pinterest LocalBoard is designed to be practical first: local-only, explicit,
and resilient enough for real use.

## Installation

### Load As An Unpacked Extension

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Turn on `Developer mode`.
4. Click `Load unpacked`.
5. Choose the [`extension/`](extension) directory from this repository.

### After Updates

1. Go back to `chrome://extensions`.
2. Click `Reload` on Pinterest LocalBoard.
3. Refresh the Pinterest tab if board detection looks stale.

## Usage

1. Open a Pinterest board page.
2. Wait until the board content is visible.
3. Click the extension icon.
4. Confirm the popup shows the board name.
5. Click `Download ZIP`.
6. Wait for the archive to finish downloading.

### Best Results

- Open the actual board feed, not an individual pin page.
- If Pinterest is showing section tiles instead of pins, open `All Pins` or a
  specific section with visible pin tiles.
- For very large boards, give the page a moment to settle before starting.

## What You Get

Each export is a ZIP file named like:

```text
my_board_localboard_2026-04-09.zip
```

Inside the archive:

```text
My_Board/
├── 001_123456789_title.jpg
├── 002_987654321_title.webp
├── ...
└── _download_report.json
```

The report file includes:

- board name and URL
- scan totals
- downloaded and failed counts
- per-item failure details when some assets could not be fetched

## How It Works

| Part | File | Responsibility |
| --- | --- | --- |
| Popup UI | [`extension/popup.html`](extension/popup.html), [`extension/popup.css`](extension/popup.css), [`extension/popup.js`](extension/popup.js) | Detects the active tab, shows current board state, starts downloads, shows progress, and renders local history. |
| Content script | [`extension/content.js`](extension/content.js) | Detects board pages, watches Pinterest SPA navigation, scans pins, fetches image candidates, builds the ZIP, and writes history entries. |
| ZIP library | [`extension/vendor/jszip.min.js`](extension/vendor/jszip.min.js) | Generates the archive in-browser. |
| CI validation | [`.github/workflows/validate.yml`](.github/workflows/validate.yml) | Runs syntax and manifest validation on pushes and pull requests. |

### Reliability Notes

- Handles already-open Pinterest tabs by injecting the content script when
  needed.
- Clears stale board detection when the page URL changes.
- Waits for additional pins or page height growth while scanning.
- Continues the run when a subset of images fails.
- Records failed assets instead of silently dropping them.

## Permissions

### Extension Permissions

| Permission | Why it is needed |
| --- | --- |
| `activeTab` | Accesses the currently open tab when you trigger the extension. |
| `scripting` | Injects the content script into already-open Pinterest tabs when necessary. |
| `storage` | Saves recent download history locally in the browser. |

### Host Permissions

| Host pattern | Why it is needed |
| --- | --- |
| `https://pinterest.com/*` | Supports direct Pinterest navigation. |
| `https://*.pinterest.com/*` | Supports Pinterest subdomains and board pages. |
| `https://*.pinimg.com/*` | Fetches the actual image assets used in the ZIP. |

## Privacy

- No backend
- No analytics
- No external upload step
- Download history is stored locally in Chrome only
- The extension only works with content your current Pinterest session can access

## Limitations

- Pinterest LocalBoard does not bypass private-board permissions.
- It depends on Pinterest's current DOM and client-side data exposure.
- Extremely large boards can still hit browser memory limits because ZIP
  assembly happens in-browser.
- If Pinterest stops exposing high-quality image URLs in the page, output
  quality may degrade until detection logic is updated.

## Troubleshooting

<details>
  <summary><strong>The popup says no board was found</strong></summary>

  <br>

  Make sure the active tab is a Pinterest board URL, reload the extension in
  `chrome://extensions`, then refresh the Pinterest tab once.
</details>

<details>
  <summary><strong>The extension finds too few images</strong></summary>

  <br>

  Scroll the board a little first, open the actual board feed instead of a
  board overview with sections only, and try a board with clearly visible pins.
</details>

<details>
  <summary><strong>The ZIP finishes with some failures</strong></summary>

  <br>

  Open `_download_report.json` inside the ZIP. The extension is designed to
  finish with partial success instead of failing the whole run when only some
  assets are unavailable.
</details>

<details>
  <summary><strong>History looks empty after an update</strong></summary>

  <br>

  Reload the extension once. Recent versions migrate older history entries to
  the new LocalBoard storage key automatically.
</details>

## Development

There is no build step. The project is plain HTML, CSS, and JavaScript.

### Validate Locally

```bash
node --check extension/popup.js
node --check extension/content.js
python3 -m json.tool extension/manifest.json >/dev/null
```

### Project Layout

```text
.
├── .github/
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
├── README.md
├── SECURITY.md
├── logo.png
└── extension/
    ├── content.js
    ├── icons/
    ├── manifest.json
    ├── popup.css
    ├── popup.html
    ├── popup.js
    └── vendor/
```

For contribution and validation expectations, see
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Roadmap

- Stronger recovery for very large boards
- Optional background-worker architecture for longer-running jobs
- Better reporting for skipped pins and selector mismatches
- Future packaging for easier distribution beyond unpacked installs

## License

MIT. See [`LICENSE`](LICENSE).

## Disclaimer

Pinterest LocalBoard is an independent project and is not affiliated with,
endorsed by, or sponsored by Pinterest.
