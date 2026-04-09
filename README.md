<p align="center">
  <img src="logo.png" alt="Pinterest LocalBoard logo" width="112">
</p>

# Pinterest LocalBoard

A Chrome extension that downloads images from the currently open Pinterest board
and bundles them into a single ZIP file.

Suggested GitHub repo slug: `pinterest-localboard`

The extension is designed for a simple workflow:

1. Open a Pinterest board in Chrome
2. Click the extension
3. Download the board as one ZIP

It includes a lightweight Apple-style popup UI, live board detection, progress
tracking, cancel support, and local download history.

## Features

- Detects Pinterest board pages directly from the active tab
- Auto-connects to already-open Pinterest tabs
- Scrolls the board and collects pin images from the current board page
- Prefers the highest-quality Pinterest image URL available, including `originals` when exposed
- Downloads all collected images into a single ZIP archive
- Continues building the ZIP even if a small number of images fail
- Adds a `_download_report.json` file into the ZIP for failed items and scan details
- Shows download progress in both the popup and an in-page overlay
- Stores recent download history locally in the browser
- Includes quick actions for refresh, reload tab, open board, and copy URL

## Project Structure

```text
.
├── .github
│   ├── ISSUE_TEMPLATE
│   ├── workflows
│   └── pull_request_template.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
├── README.md
├── SECURITY.md
├── logo.png
└── extension
    ├── content.js
    ├── icons
    ├── manifest.json
    ├── popup.css
    ├── popup.html
    ├── popup.js
    └── vendor
        └── jszip.min.js
```

## Installation

### Load as an unpacked extension

1. Open Chrome
2. Go to `chrome://extensions`
3. Enable `Developer mode`
4. Click `Load unpacked`
5. Select the `extension/` folder from this repository

## Usage

1. Open a Pinterest board page in Chrome
2. Click the extension icon
3. Confirm the popup detects the board
4. Click `Download ZIP`
5. Wait for the ZIP to finish building and download

### Best results

- Open the actual board page, not a random pin page
- If Pinterest shows sections instead of pins, open the board feed or a specific section with real pins visible
- If the extension was just reloaded, refresh the Pinterest tab once if detection feels stale

## Permissions

The extension uses the following permissions:

- `activeTab`
  Used to interact with the current Chrome tab.
- `scripting`
  Used to inject the content script into already-open Pinterest tabs when needed.
- `storage`
  Used to save recent download history locally.

Host permissions:

- `https://pinterest.com/*`
- `https://*.pinterest.com/*`
- `https://*.pinimg.com/*`

These are required to detect Pinterest boards and fetch Pinterest-hosted images.

## How It Works

### Popup

The popup UI lives in:

- `extension/popup.html`
- `extension/popup.css`
- `extension/popup.js`

Responsibilities:

- Detect the active Pinterest tab
- Ensure the content script is available
- Display board information and current run status
- Surface recent download history
- Expose small utility actions

### Content Script

The board collection and ZIP generation logic lives in:

- `extension/content.js`

Responsibilities:

- Detect whether the current page is a Pinterest board
- Re-detect on Pinterest SPA-style URL changes
- Scan visible pin cards and image candidates
- Prefer best-quality image URLs
- Download images with retry behavior
- Build the final ZIP
- Save successful downloads to local history

### ZIP Library

The extension uses JSZip from:

- `extension/vendor/jszip.min.js`

## Download History

Recent successful downloads are stored in `chrome.storage.local`.

Each history entry includes:

- board name
- board URL
- generated ZIP filename
- image count
- failed image count
- creation timestamp

History is local to the browser profile where the extension is installed.

## Limitations

- The extension only downloads images the current Pinterest page and session can access
- It does not bypass private-board permissions
- It depends on Pinterest’s current DOM and data exposure patterns
- Extremely large boards may still hit browser memory limits because the ZIP is assembled in-browser
- Some boards may expose fewer images if Pinterest lazy-loads content aggressively or changes internal page structure
- If Pinterest withholds some assets, the extension will still finish when possible and list failures in `_download_report.json`

## Troubleshooting

### The popup says it cannot find a board

- Make sure the active tab is a Pinterest board URL
- Refresh the Pinterest tab once
- Reopen the popup

### The board opens but the extension collects too few images

- Scroll the board a bit first, then try again
- Open the board feed instead of a board overview with only sections
- Try a public board that clearly shows pin tiles

### The ZIP download fails on large boards

- Retry on a smaller board first
- Close other memory-heavy tabs
- Try again after reloading Chrome

### History is empty

- History only records successful ZIP completions
- Reload the extension after permission changes

## Development

There is no build step right now. The extension is plain HTML, CSS, and JavaScript.

### Validate locally

```bash
node --check extension/popup.js
node --check extension/content.js
python3 -m json.tool extension/manifest.json >/dev/null
```

GitHub Actions runs the same validation on every push to `main` and every pull
request.

### Reload after changes

After editing files:

1. Open `chrome://extensions`
2. Click `Reload` on the unpacked extension
3. Refresh the Pinterest tab if needed

## Privacy

- No backend is used
- No analytics are included
- Download history is stored locally in Chrome only
- The extension does not send your board data to an external server

## Notes

- This project is not affiliated with Pinterest
- Pinterest may change its site structure at any time, which can require selector or detection updates

## Contributing

See `CONTRIBUTING.md` for local workflow, validation steps, and PR guidance.

## License

This project is licensed under the MIT License. See `LICENSE`.
