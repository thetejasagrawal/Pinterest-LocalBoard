# Chrome Web Store Listing

## Product Name

Pinterest LocalBoard

## Category

Productivity

## Language

English

## Short Description

Download Pinterest boards into one clean local ZIP.

## Detailed Description

Pinterest LocalBoard saves the images from the currently open Pinterest board
into a single ZIP file on your machine.

The extension is built for a narrow, simple workflow:

1. Open a Pinterest board
2. Click the extension
3. Download the board as one ZIP

Key features:

- detects Pinterest board pages from the active tab
- works with already-open Pinterest tabs
- supports public boards and private boards visible to your signed-in Pinterest session
- prefers the highest-quality image URL exposed by Pinterest
- builds one ZIP locally in the browser
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

Use these files:

- `chrome-web-store/assets/screenshot-board-ready-1280x800.png`
- `chrome-web-store/assets/screenshot-progress-1280x800.png`

Optional promo assets:

- `chrome-web-store/assets/promo-tile-440x280.png`
- `chrome-web-store/assets/marquee-1400x560.png`

## Reviewer Notes

The extension has a single purpose: download images from the currently open
Pinterest board into a local ZIP file.

Testing flow:

1. Load the unpacked extension from the `extension/` folder or upload the ZIP
   built from that folder.
2. Open a public Pinterest board page, or a private board that the signed-in
   Pinterest account can already view.
3. Click the extension action.
4. Confirm the popup detects the board.
5. Click `Download ZIP`.
6. Wait for the ZIP to finish downloading.

## Permissions Justification

- `activeTab`
  Accesses the tab the user explicitly activates so the extension can inspect
  the current Pinterest board.
- `scripting`
  Injects the content script into an already-open Pinterest tab when needed.
- `storage`
  Stores recent local download history and state.
- `https://pinterest.com/*` and `https://*.pinterest.com/*`
  Required to read the currently open Pinterest board page.
- `https://*.pinimg.com/*`
  Required to fetch the image files that are added to the ZIP.

## Privacy Practices Notes

- Single purpose:
  Download images from the currently open Pinterest board into a ZIP on the
  user's device.
- Remote code:
  No. All executable code is bundled locally with the extension.
- User data:
  The extension processes Pinterest page content needed for the requested
  download and stores recent download history locally in Chrome only.
- Sale / transfer:
  No.
- Advertising:
  No.
- Creditworthiness / lending:
  No.
