# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 2026-05-06

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
