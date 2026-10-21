# Chrome Web Store Listing

## Product Name

Pinterest LocalBoard

## Category

Productivity

## Language

English

## Short Description

Save Pinterest boards locally with reliable ZIP exports for boards of any size.

## Detailed Description

Pinterest LocalBoard saves the images from the currently open Pinterest board
directly on your machine. Use one ZIP for smaller boards or memory-safe Smart
parts for boards with hundreds or thousands of pins.

The extension is built for a narrow, simple workflow:

1. Open a Pinterest board
2. Click the extension
3. Export the board as one ZIP or reliable ZIP parts

Key features:

- detects Pinterest board pages from the active tab
- works with already-open Pinterest tabs
- supports public boards and private boards visible to your signed-in Pinterest session
- prefers the highest-quality image URL exposed by Pinterest
- builds one ZIP locally for smaller boards
- splits large boards into numbered 250-pin ZIP parts to keep memory use steady
- waits through slow-loading board feeds instead of stopping after a short stall
- resumes interrupted Smart-parts runs from the next unfinished ZIP part
- shows clear Scan, Save, and Pack progress with cancel support
- keeps recent download history locally
- handles partial failures and includes `_download_report.json`

Pinterest LocalBoard does not run a backend and does not upload your board data
to a remote server.

## Store Listing URLs

- Homepage / website:
  `https://github.com/thetejasagrawal/Pinterest-LocalBoard`
- Support URL:
  `https://github.com/thetejasagrawal/Pinterest-LocalBoard/blob/main/SUPPORT.md`
- Privacy policy URL:
  `https://github.com/thetejasagrawal/Pinterest-LocalBoard/blob/main/PRIVACY_POLICY.md`

## Screenshot Assets

Store icon: `chrome-web-store/assets/store-icon-128.png` (128 × 128).

Use these v5 files, in this order:

- `chrome-web-store/assets/v5/final/01-laptop-popup-closeup-1280x800.png`
- `chrome-web-store/assets/v5/final/02-board-ready-browser-1280x800.png`
- `chrome-web-store/assets/v5/final/03-smart-parts-browser-1280x800.png`
- `chrome-web-store/assets/v5/final/04-selection-closeup-1280x800.png`
- `chrome-web-store/assets/v5/final/05-export-complete-browser-1280x800.png`

Optional promo assets:

- `chrome-web-store/assets/v5/final/promo-small-440x280.png`
- `chrome-web-store/assets/v5/final/promo-marquee-1400x560.png`

## Reviewer Notes

The extension has a single purpose: download images from the currently open
Pinterest board into local ZIP files.

Testing flow:

1. Load the unpacked extension from the `extension/` folder or upload the ZIP
   built from that folder.
2. Open a public Pinterest board page, or a private board that the signed-in
   Pinterest account can already view.
3. Click the extension action.
4. Confirm the popup detects the board.
5. Choose `Single ZIP` or `Smart parts`, then click `Start export`.
6. Wait for the ZIP export to finish. Chrome may ask once to allow multiple
   downloads when Smart parts is used.

## Permissions Justification

- `activeTab`
  Accesses the tab the user explicitly activates so the extension can inspect
  the current Pinterest board.
- `downloads`
  Verifies that each locally generated ZIP starts and finishes successfully,
  and stops the current generated ZIP when the user presses Cancel, before
  LocalBoard marks that ZIP part complete.
- `scripting`
  Injects the content script into an already-open Pinterest tab when needed.
- `storage`
  Stores recent local download history, the chosen export mode, and temporary
  Smart-parts resume checkpoints.
- `https://pinterest.com/*` and `https://*.pinterest.com/*`
  Required to read the currently open Pinterest board page.
- `https://*.pinimg.com/*`
  Required to fetch the image files that are added to the ZIP.

## Privacy Practices Notes

- Single purpose:
  Download images from the currently open Pinterest board into ZIP files on the
  user's device.
- Remote code:
  No. All executable code is bundled locally with the extension.
- User data:
  The extension processes Pinterest page content needed for the requested
  download and stores recent download history and temporary resume checkpoints
  locally in Chrome only.
- Sale / transfer:
  No.
- Advertising:
  No.
- Creditworthiness / lending:
  No.
