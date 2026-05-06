# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 2026-05-06

#### Run 8: blur-detection bug fix (iOS Safari < 17 silently no-ops ctx.filter)

Run 7's mobile fix added a JS box-blur fallback for browsers without canvas filter support, gated on a `HAS_CTX_FILTER` detection. The detection had a subtle bug: it set `ctx.filter = 'blur(2px)'` and then read it back, expecting browsers without filter support to either throw or return a different value. iOS Safari before v17 does neither — assigning to a non-existent property silently creates a regular JS property on the context object, so reading it back returns the value that was set, the equality test passes, Tessera concludes filter is supported, takes the native path, and the blur silently does nothing. The user's "still doesn't work on mobile" report.

Changed:

- **`HAS_CTX_FILTER` detection** in `src/damage-preview.js` rewritten as a *functional* pixel test instead of a property-readback test. Paints a small white square on a black canvas via `drawImage` with `ctx.filter = 'blur(2px)'`, then reads back a pixel just outside the square. If blur worked, that pixel is gray (gaussian spread reached it); if blur silently no-opped, it's pure black. Also adds a prototype-presence check upfront (`'filter' in CanvasRenderingContext2D.prototype`) so the common no-prototype case fails fast without the canvas test.

Verified:

- Headless Chrome with normal `ctx.filter`: detection returns true (pixel test reads non-zero), native path selected. Same as desktop today.
- Headless Chrome with `ctx.filter` stubbed to no-op (simulating iOS Safari 16): detection returns false, JS box-blur fallback runs, blur actually applies — verified by ~190 000 pixels changed between 0% and 30% blur on the rendered canvas.
- 93/93 tests still green. Mobile-screenshot regression check at 375 px wide unchanged from run 7.

#### Run 7: mobile fix (blur preview broken on iOS Safari, layout overflow)

The user flagged that the damage preview didn't work on mobile and the layout was broken. Two real bugs:

1. The blur effect uses `ctx.filter = 'blur(Npx)'` on the canvas 2D context. iOS Safari before v17 (released September 2023) doesn't support that property; the assignment silently no-ops and the rendered QR stays pristine at every damage level. So the blur preview never appeared to do anything on a non-trivial fraction of iPhones, and decoders happily read the unblurred image at "30% damage" too.
2. The damage canvas was rendered at a fixed pixel size (~333 px wide for a v3 QR) without `max-width: 100%` on the canvas element. On phones below ~360 px CSS width, that overflowed the panel and pushed the whole page sideways. A few other places (tattoo table fixed column widths, site-nav padding, hero credit max-width) also overflowed at narrow viewports.

Added:

- **Pure-JS box-blur fallback in `src/damage-preview.js`**: a separable, sliding-window box blur that runs three passes to approximate a gaussian. O(N) per pass regardless of radius, so safe to run on mobile at any blur level without freezing the UI. A feature-detect at module load (`HAS_CTX_FILTER`) picks the native `ctx.filter` path on Chrome / Edge / iOS 17+ / Firefox, and the JS fallback on iOS &lt; 17 and any other browser without canvas filter support. Calibrated with a 0.6 factor on the box radius so the JS path produces tolerance-log results that match the native path: same 0%/5%/10%/15% OK and 20%/25%/30% FAIL for the default v3-H QR.
- Comprehensive mobile breakpoints in `styles.css` at `max-width: 720px` and `max-width: 480px`:
  - Hero ASCII sigil hidden on mobile (no horizontal room), hero padding tightened, title size dropped from `clamp(3rem, 12vw, 9rem)` to `clamp(2.4rem, 14vw, 4rem)` (and further to `clamp(1.9rem, 16vw, 3rem)` below 480px).
  - Site header: nav links wrap, alternate brand glyph hidden, padding compacted.
  - Meta-rail: separator characters hidden, type scaled to 10px.
  - Panel padding reduced; panel headers wrap their badge below the title.
  - Damage controls: 7-button level row keeps its single-line layout with tighter padding, slider height reduced.
  - Tolerance log table: 9px font, 4px row padding.
  - Tattoo recommendations table: at narrow widths (&lt; 480 px) collapses to a stacked card layout, with each row becoming a vertical block and the column-2/column-3 cells gaining `Module:` / `Tattoo:` prefix labels for context. Removes the fixed widths that caused horizontal overflow at desktop breakpoints too.
  - Optimal callout: at very narrow widths the head wraps so the Apply button drops into its own full-width row.
  - Permanence layer cards: number sized down to 2.4rem on mobile, body type scaled to match.
  - Image strip: height reduced from 280px to 200px so it doesn't dominate the page on phone screens.

Changed:

- `.preview__frame canvas` and `.damage__canvas-wrap canvas` now have `max-width: 100%; height: auto;` so the canvas display size scales to fit the viewport while keeping its internal pixel resolution intact (decoders still see the high-resolution data).
- `.preview__frame` and `.damage__canvas-wrap` get `max-width: 100%` so the bone-white border frame can't push past the panel edge.

Verified:

- 93/93 tests still green.
- Headless screenshots taken at 375 px (iPhone SE), 393 px (iPhone 14 Pro), and 320 px (smallest realistic viewport) all render without horizontal overflow. Damage canvas, tolerance log, tattoo specs, and the optimal callout are all readable and functional.
- JS box-blur fallback measured against ctx.filter: same OK/FAIL pattern at every damage level on the default QR, so users on iOS &lt; 17 see the same tolerance number their friends on Chrome do.

#### Run 6: tattoo-optimal recommendation (fewer modules wins for blur)

The user pointed out (correctly) that fewer modules is generally better for tattoos: physical module size dominates the blur failure mode, and a higher-EC choice that pushes the QR up a version actually makes each module smaller. The default of "always level H" was wrong for the tattoo use case. This run adds a tattoo-aware recommendation that picks the smallest version that fits the data at any EC level, paired with the highest EC at that version, and surfaces it in the tattoo specs panel as a one-click switch.

Added:

- **`Tessera.QR.findTattooOptimal(text)`** in `src/qr.js`. Returns `{ version, ecLevel }` for the smallest version that fits the data at any EC level, with the highest EC at that version. For a 19-byte URL like `http://max-wik.com/`: returns `v2 / Q` (vs the previous default of `v3 / H`), giving 12% bigger modules at the same physical tattoo size in exchange for 5% less algorithmic recovery.
- **Tattoo-optimal callout** at the top of the tattoo specs panel. Compares the user's current settings to the optimal pair, explains the trade (e.g. "12% bigger modules in exchange for 5% less error correction"), and offers a one-click "Apply" button that switches the EC dropdown and triggers re-encoding.
- Reasoning copy in the callout: "the dominant failure mode is blur, not localized damage, and bigger modules survive blur far better than higher EC at smaller modules". Backed by a longer paragraph in `permanence.html` Layer IV explaining why physical module size matters more than algorithmic recovery for tattoos (artist's needle has a ~0.3 mm dot resolution; below ~0.7 mm/module the artwork can't be rendered cleanly in the first place).

Changed:

- **EC dropdown copy** in `index.html` reflects the new recommendation: `Q` is labeled "often best for tattoos", `H` is labeled "most algorithmic recovery". The hint text now points at the tattoo specs panel as the place to see the recommendation.
- **Tattoo status badge** logic: shows `✓ tattoo-optimized` only when the current settings match the optimal pair, and `smaller QR available` when they don't (with the suggestion in the callout).
- `fmtMm` in both `app.js` and `spec-sheet.js` now formats to one decimal (e.g. `0.7 mm`, `1.2 mm`) instead of rounding to `1 mm` / `1 mm`. The round-to-integer was a copy-paste bug that flattened all three quality grades to "1 mm".
- New CSS rules in `styles.css`: `.optimal-callout` (the suggestion box with blood-red side bar and gradient backdrop), `.btn--small` (compact button variant for the in-callout Apply button).

Notes:

- The default still encodes at level H (the long-standing convention for "permanence"), but now informs the user when there's a smaller QR they could use, rather than locking them into the larger one. This matches Tessera's broader philosophy: report the trade-offs honestly, let the user pick.

#### Run 5: blur damage model + creator credit + tattoo-optimized recommendations

The damage tolerance system was rebuilt around a model that reflects how tattoos actually fail: gradual ink bleed, not random blot coverage. The hero subtitle was replaced with a stamped creator credit. A new tattoo-recommendations panel teaches users what physical size to ask the artist for. The damage preview and the per-level tolerance log are now a single panel, so the user sees both the live verdict and the full sweep at the same time.

Added:

- **`Tessera.DamagePreview`** rewritten around a gaussian-blur model. New API: `LEVELS`, `blurRadiusFor(percent, moduleSize)`, `renderBlurred(canvas, qr, percent, opts)`, `decodeBlurred(qr, percent, expected, opts)`, `sweepTolerance(qr, expected, opts)`. Blur radius scales linearly with damage percent and the rendered module size; 30% lands at nearly a full module of blur, which empirically renders small QRs unreadable while a v3-H QR still survives the first 15%.
- Inline tolerance log inside the damage panel (`#tolerance-log` in `index.html`). Each blur level (0/5/10/15/20/25/30%) gets a row with a binary OK/FAIL verdict, computed once on QR change. The currently-selected slider level is highlighted with a blood-red marker so the user can see exactly where they are in the failure curve.
- **Tattoo recommendations panel** (`#tattoo-recs` in `index.html`). Three quality grades (Minimum 0.7 mm/module, Recommended 1.2 mm/module, Conservative 1.8 mm/module) with computed total tattoo dimensions in cm and inches. The "Recommended" row is the answer the artist should be shown; it's highlighted with a blood-red side bar and "ASK FOR THIS" emphasis. The panel header shows a `✓ tattoo-optimized` badge when the EC level is H (the right setting for permanence) and a warning otherwise.
- Hero **creator credit watermark** replacing the old "Permanent tiles for a permanent mark" subtitle. Three-line block: "A TESSERA BY / MAXIMILIAN WIKSTRÖM / · ARCHITECT · MMXXVI ·" with a blood-red side bar and a faint blood-red gradient backdrop. Site footer updated to include the same credit.
- New CSS rules in `styles.css`: `.hero__credit*` (watermark), `.tolerance-log` (inline log row highlighting), `.tattoo-table` (recommendations table with `tr.rec` accent treatment).

Changed:

- **Default URL** is now `http://max-wik.com/` (was `https://example.com`). Test corpus in `tests/test-damage.js` updated to match.
- The "blur ≤N%" tolerance number is now part of the verified-status badge label (`"Verified · 2 decoders · blur ≤15%"`), so the user sees their QR's measured durability without having to look at a separate panel.
- `src/damage.js` is now a thin alias module that re-exports `Tessera.DamagePreview` as `Tessera.Damage` for backward compatibility with the existing test corpus and spec sheet.
- `src/spec-sheet.js` reworked: blur tolerance instead of blot, new tattoo-recommendations section, new printable physical-size renderings (one per quality grade rather than fixed 3/5/7/10 cm), creator credit at the top.
- `docs/PERMANENCE.md`'s and `permanence.html`'s Layer IV rewritten to describe the blur model, the calibration formula, the per-level interpretation in tattoo-aging terms, and why the test reports binary OK/FAIL per level rather than pass-rate (blur is deterministic).
- HTML `<script>` load order updated: `damage-preview.js` now loads before `damage.js` (the alias).
- `index.html` panel ordering: I Input · II Output · III Round-trip · IV Damage preview (with inline tolerance log) · V Tattoo specs · VI Export. Previously V was a separate "tolerance log" panel; that's now merged into IV, freeing slot V for the tattoo recommendations.

Removed:

- Old random-blot damage model (`Tessera.Damage._corruptModules`, `Tessera.Damage._mulberry32`, the `trialsPer` / `seed` parameters). The blur model is deterministic, so multi-trial averaging is no longer needed.
- Old separate "Tolerance log" panel and the `damage-out` element. The tolerance log now lives inside the damage preview panel.
- Old hero subtitle "Permanent tiles for a permanent mark…". The tagline is preserved as a quote in the README and as the title-bar quote in the docs, but no longer appears on the live site.

#### Run 4: Vercel deployment fix (404 NOT_FOUND on root URL)

The cyber-sigilism overhaul (run 3) created a `public/` directory full of imagery. After deploying to Vercel, the root URL started returning `404: NOT_FOUND` (Vercel error ID `arn1::drlxn-...`). The cause: Vercel's framework auto-detection treats a `public/` directory as the build output of a Next.js / CRA / similar SPA project, so it tried to serve `index.html` from inside `public/` (where it doesn't exist) instead of from the repo root (where it does).

Changed:

- Renamed `tessera/public/` to `tessera/assets/`. The directory name was the entire problem; `assets/` is not a reserved name in any framework auto-detector.
- Updated all imagery references accordingly: `index.html` (preload + hero bg + image strip), `tests.html` (hero bg), `permanence.html` (hero bg + two image strips). All six sigil paths verified to resolve.
- `vercel.json` made explicit so a future fork can't trip the same wire: `framework: null`, `buildCommand: null`, `outputDirectory: "."`, `installCommand: null`. Same `cleanUrls`, `trailingSlash`, and headers as before; just adds the explicit overrides that disable framework auto-detection.

#### Run 3: cyber-sigilism overhaul + interactive damage preview

Added:

- **Cyber-sigilism visual overhaul.** Complete redesign of the front-end across all three pages: black ground, bone-coloured text, blood-red accents, JetBrains Mono throughout, brutalist grid panels with sharp 2px borders. New design tokens and full layout system in `styles.css` (~700 lines). Subtle CSS-noise overlay on the background, finder-pattern brand glyph in the header, ASCII sigils at the corners of each hero, atmospheric image strips between sections.
- **Interactive damage-tolerance preview** on the generator page (`src/damage-preview.js`, wired in `src/app.js`). Users pick a damage level via a row of preset buttons (0%, 5%, 10%, 15%, 20%, 25%, 30%) or a continuous slider; the QR is rendered with that exact clustered blot overlaid, then re-decoded on the fly. The verdict badge flips between SCAN OK / WRONG TEXT / UNREADABLE in real time, with the recovered text shown beneath. Uses the same blot model and seed as `Tessera.Damage`, so the preview matches what the tolerance log reports.
- **`permanence.html`**: full HTML version of the defense-in-depth doctrine (previously only available as `docs/PERMANENCE.md`). Six-layer visual breakdown with massive Roman numerals, a hero atmospheric image, two image strips with pulled-quote captions (between layers II/III and IV/V), a closing "what this project doesn't claim" panel, and consistent navigation. The original markdown stays as a GitHub-readable mirror.
- `public/sigil-01.jpg` through `public/sigil-27.jpg`: twenty-seven cyber-sigilism reference images (renamed from their hash-named originals) used as hero backgrounds, image-strip atmosphere, and visual accents across all three pages. Each image gets a heavy darkening overlay plus a grayscale + contrast filter so it never overpowers the content.
- ASCII sigil art in the corner of every hero block (varies per page: triple finder grid on the generator, diagnostic panel on tests, layered sigil on permanence) and ▓░▒-pattern dividers between sections and in the footer.
- Sticky header with brand glyph (two clipped diamonds) and active-page nav highlighting.
- Per-level pass-rate "tolerance log" panel, separated from the live damage preview, with monospace ASCII-styled tables.

Changed:

- `index.html` completely restructured around the new cyber-sigilism layout: hero, meta-rail (showing standard / version / vendor / test-count info at a glance), six-panel app grid (Input, Output, Round-trip, **Damage preview**, Tolerance log, Export), atmospheric image strip, footer.
- `tests.html` restyled as a "diagnostic terminal": large DIAG/NOSE hero, monospace test result blocks with `[ OK ]` / `[FAIL]` / `[SKIP]` indicators in bracketed all-caps, summary banner at the bottom that reads `[ ALL PASSED ]` or `[ FAILED ]`. Auto-runs on load, with a re-run button.
- `src/app.js` extended to manage the damage preview state machine: monotonic damage decode sequence numbers (so old async results don't override newer ones when the user drags the slider), button/slider sync, decode result rendering. Status badge label now reflects redundancy level + tolerance percentage when verified.
- Status badge styling moved to a state-driven CSS pattern (`data-state="idle|encoding|verifying|ok|fail"`), with a blinking ▓ indicator during async work and colour-keyed border treatments for each state.
- Footer redesigned with ASCII rule, MIT/site link, and per-page nav links.
- Preview and damage canvases now sit inside a bone-white frame with blood-red corner brackets and a triple inset shadow for visual weight.

Removed:

- Old "calm dark blue" theme entirely (nothing about it was salvageable for the new aesthetic).
- Old single-pass damage-tolerance results section (replaced by the live preview plus the per-level log).

#### Run 2: Hagia Sophia image identification + workflow rule

Added:

- "About the name" section in `README.md` explaining the Roman/Byzantine origin of *tessera* (mosaic tile), with an inline image of the Imperial Gate Mosaic in Hagia Sophia (`hagia_sophia_tessera.jpg`) as a permanence reference.
- Image caption identifying the mosaic as the Imperial Gate Mosaic, Hagia Sophia, circa 886-912 CE, so readers can see how long the artwork has lasted.
- Workflow rule: every change run gets its own dated/numbered entry in this file (this entry is the rule's first application).

#### Run 1: deployment URLs, voice and dash cleanup

Added:

- `homepage` and `bugs` fields in `package.json` pointing to the live Vercel deployment and GitHub Issues.
- Live-deployment links in `README.md` header (production site, source repo, live test page).

Changed:

- All repo references updated from the placeholder `USER/tessera` to the real `MaximilianWik/Tessera` (in `package.json`, this `CHANGELOG.md`, `index.html` x2, `tests.html`).
- Deployment guide inlined into `README.md` after `docs/DEPLOYMENT.md` was removed; CI lint job no longer requires that file.
- Repo-layout diagram in `README.md` updated to reflect docs/ contents (PERMANENCE, SPEC).
- All em-dash (U+2014) and en-dash (U+2013) characters removed from prose across `README.md`, `CHANGELOG.md`, `docs/PERMANENCE.md`, `docs/SPEC.md`, `vendor/VENDORED.md`, `tools/README.md`. Replaced with commas, semicolons, periods, colons, or parentheses as context dictated. Compound-word hyphens (`open-source`, `round-trip`, etc.) and code/URL/path hyphens preserved.
- All first-person-plural voice (we / our) removed from documentation; rewritten in passive or impersonal voice to reflect single-author project. Also cleaned in `vendor/VENDORED.md`.
- Stale "damage-tolerant to over 25% module loss" claim in `README.md`'s "What Tessera does NOT claim" section corrected to match the actual measured 5% bar.

Removed:

- `docs/DEPLOYMENT.md` (content folded into `README.md`'s Deployment section).
- Reference to `docs/DEPLOYMENT.md` from CI lint job, README docs comment in repo-layout diagram, and the documentation list in this file.
- Broken `<link rel="icon" href="public/favicon.ico">` from `index.html` (favicon was never created); empty `public/` directory removed (later refilled in run 3 with sigil imagery).

### Initial implementation

Added:

- Client-side QR encoder (byte mode, all 40 versions, EC levels L/M/Q/H, masks 0 to 7).
- Reed-Solomon encoder over GF(256) with the QR-specific primitive polynomial 0x11D.
- ISO/IEC 18004 Annex I worked-example test vector.
- Round-trip verification through jsQR, zxing-js, and native `BarcodeDetector` (where available). Verification rule: at least one decoder must succeed AND every decoder that succeeded must return the exact input text. Reports redundancy level (1, 2, or 3) in the UI.
- Damage tolerance simulation using a clustered "blot" model (square blot covering 5 to 30% of the module area, only flipping non-reserved data modules). Permanence bar: 5% clustered damage tolerated reliably across all QR sizes, with the actual measured tolerance reported per QR.
- PNG and SVG output writers.
- Printable archival specification sheet (`src/spec-sheet.js`) with multi-size physical previews, full module matrix as ASCII art and hex dump, SHA-256 of the source code, round-trip + damage results, and reproduction instructions.
- Browser-based test runner (`tests.html`) with 93 test cases (GF(256) arithmetic, Reed-Solomon vs ISO Annex I, bit stream construction, encoder smoke, round-trip across decoders, edge cases, damage tolerance).
- GitHub Actions CI workflow that runs the browser tests headlessly via Playwright on every push.
- Documentation: `README.md`, `docs/PERMANENCE.md`, `docs/SPEC.md`.
- Vendored decoders: jsQR 1.4.0 + @zxing/library 0.21.3 (committed as source under `vendor/`, with `vendor/VENDORED.md` documenting provenance).

[Unreleased]: https://github.com/MaximilianWik/Tessera/compare/v0.0.0...HEAD
