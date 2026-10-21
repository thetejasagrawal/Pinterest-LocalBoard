# LocalBoard v2 design QA

- Source visual truth: [selected reference](qa/screenshots/popup-v2-reference.png)
- Implemented screenshot: [ready popup](qa/screenshots/popup-v2-ready.png)
- Combined comparison: [design comparison](qa/screenshots/design-comparison-v2.png)
- State: large Pinterest board detected, ready to export, Smart parts selected
- Viewport: 400 × 620 CSS px, device scale factor 1
- Source pixels: 941 × 1672
- Implementation pixels: 400 × 620
- Normalization: both full views were placed top-aligned in a single 860 × 760 comparison canvas. The reference was fit proportionally; the implementation was captured at the production Chrome popup width. The shorter implementation is an intentional Chrome-popup constraint and density improvement.

**Full-view comparison evidence**

- The implemented hierarchy matches the source: logo/wordmark and status, board identity, large-board warning, export-mode choice, three-step workflow, primary export action, local-only reassurance, and collapsible recent downloads.
- The implementation preserves the source's warm cream surface, white cards, red selected/primary states, orange warning, green privacy state, rounded geometry, and restrained soft elevation.
- Smart parts is visibly selected and marked Recommended for the 1,248-pin fixture.
- The implementation adds the existing Select pins capability as a quiet secondary action without competing with the primary export path.

**Focused region comparison evidence**

- A separate crop was not needed: at the combined comparison's native size, the brand, mode-card copy, workflow labels, CTA, status pill, and history label are all legible enough to judge directly.

**Required fidelity surfaces**

- Fonts and typography: the wordmark uses a locally available rounded display stack to retain the playful source character; the rest uses the native macOS/Chrome UI stack for legibility. Heading, metadata, labels, and small copy preserve the source hierarchy without awkward wrapping.
- Spacing and layout rhythm: the 400 px layout is consistently aligned to 20 px gutters, with compact 8–14 px internal gaps, 13–14 px card radii, and a total ready-state height that fits a practical Chrome popup.
- Colors and visual tokens: cream, red, orange, green, neutral ink, border, and elevation tokens map coherently to the source. Contrast remains readable in default, selected, disabled, progress, and completion states.
- Image quality and asset fidelity: the user-supplied logo is used directly in the popup and extension icon sizes; no placeholder logo or generated substitute is used. The source's decorative ZIP/card illustrations were intentionally omitted to keep the production popup less childish and more compact.
- Copy and content: core copy is accurate to the implemented behavior. “Smart parts” explicitly says “Up to 250 pins per ZIP,” and the large-board notice explains the memory and resume benefit.

**Findings**

- No actionable P0, P1, or P2 visual mismatches remain.
- [P3] The source has bespoke archive illustrations inside the mode cards; the implementation uses quieter radio cards. This is an intentional maturity and density adjustment based on the user's request for playfulness without childishness.
- [P3] The source is much taller than a production Chrome popup. The implementation compresses vertical spacing and shortens helper copy while preserving the same task order.

**Comparison history**

- Initial capture: Smart parts was not visually selected in the ready fixture because the preview preference was assigned after the control state was initialized.
- Fix: synchronized the preview's persisted export mode before rendering.
- Post-fix evidence: `qa/screenshots/popup-v2-ready.png` and `qa/screenshots/design-comparison-v2.png` show Smart parts selected with a red radio, red border, and Recommended badge.

**Interaction and runtime evidence**

- Preview states rendered in Chrome: ready, saving progress, and export complete.
- Primary controls represented and wired: Start export, Cancel export, Export again, Select pins, export-mode radios, and recent-download disclosure.
- JavaScript syntax checks passed for `popup.js` and `content.js`; the manifest parses as valid JSON.
- The browser-based 1,025-pin regression fixture passed: 1,025 collected,
  1,025 saved, zero failed, and five numbered ZIP parts emitted.

**Implementation Checklist**

- [x] Match the selected visual hierarchy and brand treatment.
- [x] Use the supplied logo in the production popup and icons.
- [x] Make Smart parts the default for large boards.
- [x] Verify ready, progress, and completed UI states.
- [x] Keep the ready state within a practical Chrome popup height.

final result: passed
