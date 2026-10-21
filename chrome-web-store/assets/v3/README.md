# LocalBoard v3 Chrome Web Store assets

This is the editorial-tech screenshot direction for the `2.0.1` extension.
The v2 upload set remains unchanged in `assets/v2/`.

## Final upload set

| Order | File | Size | Purpose |
| --- | --- | --- | --- |
| 1 | `final/01-editorial-laptop-1280x800.png` | 1280 × 800 | Premium hardware hero with the real ready UI |
| 2 | `final/02-board-ready-1280x800.png` | 1280 × 800 | Straight-on board and ready state |
| 3 | `final/03-smart-parts-progress-1280x800.png` | 1280 × 800 | Smart-parts saving progress |
| 4 | `final/04-selection-mode-1280x800.png` | 1280 × 800 | Enlarged `Whole board` selection workflow |
| 5 | `final/05-export-complete-1280x800.png` | 1280 × 800 | Completed export state |
| — | `final/promo-small-440x280.png` | 440 × 280 | Small promo tile |
| — | `final/promo-marquee-1400x560.png` | 1400 × 560 | Marquee promo tile |

## Production method

The three photographic foundations in `sources/` were generated with the
built-in ImageGen tool. The extension states were captured directly from the
`2.0.1` popup in Chrome and composited deterministically with
`chrome-web-store/preview/v3/render.html`.

## ImageGen prompt set

### Editorial laptop hero

```text
Use case: product-mockup
Asset type: premium Chrome Web Store screenshot foundation, exact 16:10 landscape
Primary request: Create a highly realistic front-facing product photograph of a modern silver laptop centered slightly to the right on a monolithic dark graphite desk. The laptop display is large and clearly readable. On screen is a clean desktop browser containing a curated editorial mood-board grid of architecture, interiors, tactile objects, landscape, and graphic compositions on the left 64 percent, while the right 36 percent is a calm neutral dark-warm-gray area reserved for compositing the exact extension interface later.
Scene/backdrop: minimal charcoal studio with a seamless wall and desk, subtle cool cobalt light from the upper left and a restrained deep red edge glow from the right, no decorative props
Style/medium: ultra-photorealistic premium technology campaign photography, precise brushed aluminum, believable screen glass, crisp browser geometry, sophisticated and mature
Composition/framing: exact 16:10 landscape, nearly straight-on camera with only a tiny natural perspective, full laptop visible, screen occupies most of the canvas, generous but controlled negative space, no dramatic crop
Lighting/mood: cinematic but understated, confident, modern, gallery-like, detailed shadows without crushing blacks
Color palette: graphite, charcoal, silver, ink black, muted cobalt, restrained oxblood red, warm off-white within the board photographs
Constraints: no people, no hands, no plants or pottery outside the screen, no readable text, no logos, no watermark, no extension popup, no promotional copy, no floating interface cards, no exaggerated neon, no playful styling, no transparency
```

### Product-state browser

```text
Use case: ui-mockup
Asset type: premium Chrome Web Store product screenshot foundation, exact 16:10 landscape
Primary request: Create a highly realistic straight-on desktop browser window floating cleanly over a sophisticated dark graphite studio background. Inside the browser, the left 63 percent is a dense but orderly editorial mood-board masonry grid with high-end architecture, interiors, art books, fashion details without people, landscape, typography-like abstract forms without readable words, and tactile product photography. The right 37 percent is an uninterrupted warm off-white application area reserved for compositing the exact LocalBoard extension UI later.
Scene/backdrop: edge-to-edge graphite-to-deep-navy gradient with a very subtle oxblood glow in one corner; no desk, no hardware, no props
Style/medium: photorealistic premium software campaign, sharp real browser geometry, refined editorial art direction, mature and contemporary
Composition/framing: exact 16:10, browser centered with 54-pixel outer margins, large readable content, thin dark browser chrome with blank address field, rounded 22-pixel outer corners, no dramatic perspective
Lighting/mood: crisp controlled contrast, polished and confident, cool cinematic atmosphere
Color palette: charcoal, deep navy, warm off-white, muted cobalt, oxblood red, bone, stone, with a few rich editorial image colors
Constraints: no people or faces, no logos, no watermark, no readable text, no extension popup, no promotional copy, no floating cards inside or outside the browser, no playful illustration, no transparency
```

### Selection canvas

```text
Use case: ui-mockup
Asset type: premium Chrome Web Store selection-workflow screenshot foundation, exact 16:10 landscape
Primary request: Create a highly realistic straight-on desktop browser window containing a full-width Pinterest-style editorial masonry board. Fill the page beneath the browser chrome with clean, distinct image tiles featuring bold contemporary architecture, fashion material details without people, sculptural furniture, analog cameras, ocean and mountain landscapes, abstract paper forms, industrial design, and rich textures. Each tile must have clear boundaries and uncluttered upper-left corners so exact circular selection controls can be composited later.
Scene/backdrop: browser floats over a dark graphite-to-deep-navy studio gradient with a faint restrained oxblood glow, no hardware or props
Style/medium: photorealistic premium software product campaign, sophisticated editorial design magazine art direction, mature and energetic
Composition/framing: exact 16:10, browser centered with about 54-pixel margins, thin dark browser chrome and blank address field, five balanced masonry columns, no blank side panel, no dramatic perspective
Lighting/mood: crisp, cool, high contrast but natural, gallery-like
Color palette: charcoal, deep navy, bone, cobalt, rust, oxblood, muted sage and silver; richer than neutral but never candy-colored
Constraints: no people or faces, no logos, no readable text, no watermark, no selection circles or checkmarks, no extension bar, no extension popup, no promotional copy, no floating interface cards, no playful illustration, no transparency
```
