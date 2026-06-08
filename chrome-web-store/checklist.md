# Chrome Web Store Upload Checklist

## Package

- Build the upload ZIP with `scripts/build-chrome-web-store-package.sh`
- Upload the generated ZIP from `dist/`
- Confirm `manifest.json` is at the root of the ZIP, not wrapped in another folder

## Store Listing

- Name: `Pinterest LocalBoard`
- Category: `Productivity`
- Short description: `Download Pinterest boards into one clean local ZIP.`
- Detailed description: use `chrome-web-store/listing.md`
- Screenshots:
  - `chrome-web-store/assets/screenshot-board-ready-1280x800.png`
  - `chrome-web-store/assets/screenshot-progress-1280x800.png`

## Privacy / Support

- Privacy policy URL:
  `https://github.com/thetejasagrawal/Pinterest-LocalBoard/blob/main/PRIVACY_POLICY.md`
- Support URL:
  `https://github.com/thetejasagrawal/Pinterest-LocalBoard/blob/main/SUPPORT.md`

## Privacy Practices Tab

- Single purpose:
  Download images from the currently open Pinterest board into a ZIP file on the user's device.
- Remote code:
  `No`
- Permission justifications:
  copy from `chrome-web-store/listing.md`
- Data handling:
  disclose local-only processing and local history storage accurately and keep it
  consistent with `PRIVACY_POLICY.md`

## Final Preflight

- Confirm the extension still loads as unpacked
- Confirm a public Pinterest board downloads successfully
- Confirm a private board downloads successfully when the browser is signed into
  an account with access
- Confirm `_download_report.json` is included when some items fail
- Confirm recent download history updates in the popup
- Confirm the screenshots match the current UI and branding
