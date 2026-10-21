# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog. GitHub releases include the packaged
extension ZIP; Chrome Web Store publishing is handled separately.

## [Unreleased]

## [2.0.4] - 2026-10-21

### Release

- Published the accumulated v2 changes on GitHub, including the new icon,
  redesigned popup, Smart parts, resume checkpoints, and updated store assets.
- Aligned the repository logo, default store icon, README previews, and
  development instructions with the current extension.
- Added a repeatable headless Chrome runner for the existing browser fixtures.

### Fixed

- Made the visible `Find more ideas` line the authoritative end of a board,
  even when Pinterest's masonry or portal layout places suggestion cards
  earlier in DOM source order or labels them with the current board ID.
- Recognized non-semantic, extended-copy, localized ARIA, and
  `aria-labelledby` recommendation headings while ignoring marker-like labels
  inside individual pin cards.
- Removed recommendation pins from whole-board exports and selection mode when
  they render at or below the recommendation boundary.
- Kept heading-only and foreign-board recommendation sidebars from ending the
  main-board scan early or leaking their cards into exports.
- Discarded virtualized page-state records that were never observed on the
  board side of a visible recommendation boundary.

## [2.0.3] - 2026-09-01

### Fixed

- Made scan completion depend on newly found pin IDs rather than Pinterest's
  changing virtual-feed height, so completed boards reliably proceed to export.
- Removed the fixed scan-pass ceiling, added a longer grace period for known
  incomplete boards, and retained the 20-minute safety limit.
- Strengthened recommendation filtering with localized headings, semantic feed
  markers, board metadata, duplicate-pin protection, and virtualized-selection
  handling.
- Prevented selected-pin exports from silently creating partial ZIPs when a
  requested pin could not be found.
- Made Cancel interrupt fetch retries, response-body reads, concurrent workers,
  ZIP packing, and ZIP-download verification without leaving the run stuck.
- Verified every generated ZIP through Chrome before advancing a Smart-parts
  checkpoint, and cancel the active generated ZIP when the user cancels.
- Bound resume checkpoints to the exact board URL, export scope, and ordered pin
  IDs so a different export can never skip parts from an older run.
- Re-probed temporary URL-only board detection and rejected stale Pinterest
  metadata after single-page navigation to another board.
- Isolated popup progress by board, serialized overlapping refreshes, preserved
  action errors, retained the user's export-mode preference, and blocked tab
  reloads while an export is active.
- Added a content-protocol check so Pinterest tabs left open during an extension
  update receive a clear one-time reload instruction.

### Changed

- Added the `downloads` permission solely to verify and, on user request,
  cancel LocalBoard's generated ZIP downloads.
- Restricted Chrome Web Store packages to an explicit release-file allowlist
  with syntax and manifest validation before zipping.

## [2.0.2] - 2026-09-01

### Fixed

- Prevented unknown-count boards from scanning indefinitely when Pinterest's
  virtualized feed keeps changing height after the last unique board pin.

## [2.0.1] - 2026-08-22

### Fixed

- Restored the LocalBoard logo in the page-injected scanning overlay and pin
  selection bar by exposing only that asset to Pinterest pages.
- Stopped whole-board scans at Pinterest's `Find more ideas` boundary so
  recommendation pins cannot be added after the board ends.
- Added board-ID validation and a hard cap when Pinterest provides a reliable
  board count.

### Changed

- Enlarged the pin-selection bar and renamed its exit action to `Whole board`.
- `Whole board` now clears the temporary selection and reopens the normal
  extension settings without starting a download.
- Recommendation pins no longer receive selection controls.
- Replaced the store screenshot and promo set with a darker editorial-tech
  direction rendered from the real `2.0.1` interface.

## [2.0.0] - 2026-08-19

### Added

- New warm, playful-but-precise popup design with the supplied LocalBoard logo,
  rounded wordmark, clearer hierarchy, compact workflow steps, and polished
  ready, progress, selection, completion, and history states.
- `Smart parts` export mode, which packages large boards into sequential ZIPs of
  up to 250 pins to keep browser memory use steady.
- Seven-day local resume checkpoints that continue an interrupted Smart-parts
  export from the next unfinished ZIP part.
- Large-board scanning that waits through slow Pinterest loading, retries a
  stalled feed with scroll nudges, and uses explicit time-based safety limits.
- Five production Chrome Web Store screenshots plus updated small and marquee
  promo tiles built from high-quality photographic foundations and the real UI.

### Changed

- Large boards now default to Smart parts while smaller boards retain Single ZIP.
- Updated extension icons, store icon, manifest copy, store listing, and upload
  checklist for the v2 brand and workflow.

## [1.4.0] - 2026-06-08

### Fixed

- Capped generated folder, archive, and image filenames so long pin titles or
  alt text cannot create ZIP entries that are hard to open or move.

### Improved

- Added an authenticated image-fetch retry path for boards visible to the
  user's signed-in Pinterest session, including private boards the user can
  already access.

## Earlier versions

### Changed

- Rebranded the extension and repo name to `Pinterest LocalBoard`
- Renamed internal history storage to `localBoardDownloadHistory` with legacy
  history migration
- Updated generated ZIP names to include the `localboard` product tag
- Tightened manifest metadata for Chrome Web Store submission
- Added store listing assets, privacy/support docs, and a packaging script

### Added

- Initial Chrome extension for downloading Pinterest board images into a ZIP
- Apple-style popup UI with live board detection and progress feedback
- Local download history stored in `chrome.storage.local`
- Partial-failure reporting through `_download_report.json` inside generated ZIPs
- GitHub-ready repo scaffolding, issue templates, PR template, and CI validation
