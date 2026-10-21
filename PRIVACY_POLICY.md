# Privacy Policy

Last updated: 2026-09-01

Pinterest LocalBoard is a Chrome extension that downloads images from the
currently open Pinterest board into ZIP files on the user's device.

## Summary

- No backend is used.
- No analytics are included.
- No user data is sold.
- No user data is shared with the developer or third parties for advertising.
- Data processing is limited to the extension's core download functionality.

## What The Extension Accesses

Pinterest LocalBoard accesses the currently open Pinterest board page when the
user actively runs the extension. It reads board and pin information from that
page so it can:

- detect whether the tab is a Pinterest board
- collect image URLs exposed by the page
- fetch Pinterest-hosted image files
- generate ZIP files locally in the browser

## What The Extension Stores

The extension stores recent download history locally using `chrome.storage.local`.
This local history may include:

- board name
- board URL
- ZIP filename
- downloaded image count
- failed image count
- timestamp

This history stays in the user's local Chrome profile unless the user clears it
or removes the extension.

For interrupted Smart-parts exports, the extension also stores a local resume
checkpoint containing the board identifier or URL, expected pin and part counts,
completed part count, success/failure counts, export scope, a non-reversible
fingerprint of the ordered pin IDs, and update time. The checkpoint contains no
image files, expires after seven days, and is removed when the export completes.

## What The Extension Does Not Do

Pinterest LocalBoard does not:

- send board metadata or download history to the developer
- upload downloaded images to an external server
- track user behavior across websites
- use analytics, ads, or third-party trackers
- collect account credentials, payment data, or health data

## Network Requests

The extension may request:

- Pinterest page data from `pinterest.com`
- image assets from `pinimg.com`

These requests are required to download the board content the user explicitly
opens and chooses to export.

The extension uses Chrome's downloads manager only to verify that each locally
generated ZIP starts and finishes before marking the export or resume checkpoint
complete, and to stop that generated ZIP if the user cancels. It does not read,
inspect, or change unrelated downloads.

## Data Retention

The extension keeps recent download history locally until:

- the user clears history from the popup
- the user clears extension storage in Chrome
- the extension is removed

Interrupted-export checkpoints are removed after a successful export and are
ignored and cleared after seven days.

## Security

Pinterest LocalBoard does not operate a remote backend. Downloaded ZIP files are
created locally in the browser session and saved by Chrome's normal download
flow.

## Contact

For support or privacy questions, see [SUPPORT.md](SUPPORT.md).
