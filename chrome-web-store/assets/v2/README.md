# LocalBoard v2 Chrome Web Store assets

All final files are opaque PNGs with the exact dimensions required by the
Chrome Web Store.

## Upload set

| Order | File | Size | Purpose |
| --- | --- | --- | --- |
| 1 | `final/01-macbook-large-board-1280x800.png` | 1280 × 800 | Restrained hardware context with the real extension UI |
| 2 | `final/02-board-ready-1280x800.png` | 1280 × 800 | Detected board with Smart parts selected |
| 3 | `final/03-smart-parts-progress-1280x800.png` | 1280 × 800 | Real saving progress across ZIP parts |
| 4 | `final/04-selection-mode-1280x800.png` | 1280 × 800 | Direct pin-selection workflow |
| 5 | `final/05-export-complete-1280x800.png` | 1280 × 800 | Completed export state and local history |
| — | `final/promo-small-440x280.png` | 440 × 280 | Small promo tile |
| — | `final/promo-marquee-1400x560.png` | 1400 × 560 | Marquee promo tile |

## Production method

The photographic foundations in `sources/` were made with the built-in
ImageGen tool. The real Chrome-rendered LocalBoard ready, progress, and
completion screens were composited on top in
`chrome-web-store/preview/v2/render.html`. This keeps the photographs realistic
while preserving exact, readable production UI and copy.

## Refined visual direction

The current set intentionally avoids oversized ad copy, floating UI cards,
dramatic perspective, and decorative lifestyle props. The five screenshots
lead with credible product UI at readable scale. Branding copy is limited to
the two required promo tiles and uses a restrained, mature typographic scale.

The earlier, more playful direction is preserved in
`archive-initial-direction/` and is not part of the upload set.

## ImageGen prompt used for the current hardware foundation

The built-in ImageGen tool was used only for the neutral photographic laptop
foundation. The exact extension interface was rendered separately from the
production HTML/CSS and composited into the screen.

```text
Use case: product-mockup
Asset type: restrained Chrome Web Store screenshot foundation, 16:10 landscape
Primary request: Create a highly realistic, understated product photograph of a modern silver laptop viewed almost straight-on with a very slight three-quarter angle. The laptop is centered and fills most of the frame. Its screen shows a clean desktop browser containing a realistic visual mood-board grid of interior and architecture photographs on the left two-thirds, while the right third of the screen is a calm neutral panel reserved for compositing the exact extension UI later.
Scene/backdrop: minimal matte light-gray studio background and simple graphite desk surface, no decorative lifestyle props
Style/medium: premium professional software product photography, crisp and credible, restrained B2B/SaaS launch aesthetic, physically accurate screen glass and brushed aluminum
Composition/framing: exact 16:10 landscape, centered laptop, screen large and readable, no dramatic crop, no floating panels, no marketing copy
Lighting/mood: soft neutral diffused studio lighting, confident, mature, precise
Color palette: neutral gray, silver, charcoal, white, muted natural photography; very restrained color
Constraints: no people, no hands, no plants or pottery outside the screen, no readable text, no logos, no watermark, no extension popup, no promotional copy, no exaggerated shadows, no playful styling, no transparency
```

## Previous ImageGen prompt set

### MacBook board studio

Use case: `product-mockup`. Premium photorealistic silver MacBook on a warm
designer desk, most of the display visible, screen showing a realistic
interior-design masonry board with no readable text or logos, a calmer right
screen region for the exact popup, natural morning light, brushed aluminum and
glass reflections, warm cream/sky/eucalyptus/terracotta palette, no people,
hands, watermark, floating UI, or promotional copy.

### Interior board browser

Use case: `ads-marketing`. Straight-on realistic desktop browser over a clean
warm studio background, masonry grid of editorial interior photographs, blank
rightmost 36 percent for the exact popup, believable macOS-like chrome, muted
natural palette, no readable words, logos, popup, watermark, or transparency.

### Creative selection board

Use case: `ads-marketing`. Straight-on full-width browser grid with realistic
travel, camera, headphones, architecture, plant, ceramic, and graphic-design
photography; clear tile boundaries for real selection controls; premium
photorealistic finish; no faces, readable text, logos, selection marks,
watermark, or floating popup.

### Completed export workspace

Use case: `product-mockup`. Photorealistic silver laptop on a warm stone desk,
visual-board browser on the left, macOS-style Downloads panel with five ZIP file
icons and no readable filenames, calm right screen area for the exact completed
popup, natural daylight, physically accurate aluminum/glass, no people, logos,
watermark, promotional copy, or transparency.

## Regeneration

The deterministic HTML composition is in `chrome-web-store/preview/v2/`.
Render that page in Chrome with the matching `?asset=` value and the target
window size. The current final set was captured with Chrome headless using
device scale factor 1.
