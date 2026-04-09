# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows a simple
manual versioning flow until formal releases are added.

## [Unreleased]

### Changed

- Rebranded the extension and repo name to `Pinterest LocalBoard`
- Renamed internal history storage to `localBoardDownloadHistory` with legacy
  history migration
- Updated generated ZIP names to include the `localboard` product tag

### Added

- Initial Chrome extension for downloading Pinterest board images into a ZIP
- Apple-style popup UI with live board detection and progress feedback
- Local download history stored in `chrome.storage.local`
- Partial-failure reporting through `_download_report.json` inside generated ZIPs
- GitHub-ready repo scaffolding, issue templates, PR template, and CI validation
