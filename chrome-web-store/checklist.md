# Chrome Web Store Upload Checklist

## Package

- Build the upload ZIP with `scripts/build-chrome-web-store-package.sh`
- Upload the generated ZIP from `dist/`
- Confirm `manifest.json` is at the root of the ZIP, not wrapped in another folder
- Confirm the `downloads` permission justification explains completion
  verification and user-requested cancellation for generated ZIP files

## Store Listing

- Name: `Pinterest LocalBoard`
- Store icon: `chrome-web-store/assets/store-icon-128.png` (128 × 128, current v2 branding)
- Category: `Productivity`
- Short description: `Save Pinterest boards locally with reliable ZIP exports for boards of any size.`
- Detailed description: use `chrome-web-store/listing.md`
- Screenshots:
  - `chrome-web-store/assets/v5/final/01-laptop-popup-closeup-1280x800.png`
  - `chrome-web-store/assets/v5/final/02-board-ready-browser-1280x800.png`
  - `chrome-web-store/assets/v5/final/03-smart-parts-browser-1280x800.png`
  - `chrome-web-store/assets/v5/final/04-selection-closeup-1280x800.png`
  - `chrome-web-store/assets/v5/final/05-export-complete-browser-1280x800.png`
- Small promo tile: `chrome-web-store/assets/v5/final/promo-small-440x280.png`
- Marquee promo tile: `chrome-web-store/assets/v5/final/promo-marquee-1400x560.png`

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
- Confirm a public Pinterest board downloads successfully in Single ZIP mode
- Confirm a 1,000+ pin board scans to the end and downloads in Smart parts mode
- Confirm a private board downloads successfully when the browser is signed into
  an account with access
- Confirm `_download_report.json` is included when some items fail
- Confirm recent download history updates in the popup
- Confirm the screenshots match the current UI and branding
