# Contributing

## Scope

This project is a plain Chrome extension with no build step. Changes should
keep the workflow simple, reliable, and easy to review.

## Local Setup

1. Clone the repository.
2. Open `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select the `extension/` directory.

## Validation

Run these checks before opening a pull request:

```bash
node --check extension/popup.js
node --check extension/content.js
python3 -m json.tool extension/manifest.json >/dev/null
```

Then manually verify:

1. Reload the unpacked extension in Chrome.
2. Open a public Pinterest board.
3. Confirm the popup detects the board.
4. Run a ZIP download.
5. Confirm history updates after success.

## Pull Requests

- Keep PRs focused and easy to review.
- Include a short summary of the behavior change.
- Call out user-facing risks, Pinterest selector changes, or permission changes.
- Include screenshots for popup UI changes when relevant.

## Reliability Expectations

- Do not break partial-download recovery.
- Preserve graceful handling when Pinterest changes its SPA navigation.
- Prefer additive fixes over brittle hardcoded selectors when possible.

## Style

- Keep the UI clean and straightforward.
- Match the existing plain JavaScript structure unless a refactor is justified.
- Use ASCII unless the file already requires something else.
