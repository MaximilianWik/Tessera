# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 2026-05-06

#### Added
- "About the name" section in `README.md` explaining the Roman/Byzantine origin of *tessera* (mosaic tile), with an inline image of the Imperial Gate Mosaic in Hagia Sophia (`hagia_sophia_tessera.jpg`) as a permanence reference.
- Image caption identifying the mosaic as the Imperial Gate Mosaic, Hagia Sophia, circa 886-912 CE, so readers can see how long the artwork has lasted.
- `homepage` and `bugs` fields in `package.json` pointing to the live Vercel deployment and GitHub Issues.
- Live-deployment links in `README.md` header (production site, source repo, live test page).

#### Changed
- All repo references updated from the placeholder `USER/tessera` to the real `MaximilianWik/Tessera` (in `package.json`, `CHANGELOG.md`, `index.html` × 2, `tests.html`).
- Deployment guide inlined into `README.md` after `docs/DEPLOYMENT.md` was removed; CI lint job no longer requires that file.
- Repo-layout diagram in `README.md` updated to reflect docs/ contents (PERMANENCE, SPEC).
- All em-dash (U+2014) and en-dash (U+2013) characters removed from prose across `README.md`, `CHANGELOG.md`, `docs/PERMANENCE.md`, `docs/SPEC.md`, `vendor/VENDORED.md`, `tools/README.md`. Replaced with commas, semicolons, periods, colons, or parentheses as context dictated. Compound-word hyphens (`open-source`, `round-trip`, etc.) and code/URL/path hyphens preserved.
- All first-person-plural voice (we / our) removed from documentation; rewritten in passive or impersonal voice to reflect single-author project. Also cleaned in `vendor/VENDORED.md`.
- Stale "damage-tolerant to over 25% module loss" claim in `README.md`'s "What Tessera does NOT claim" section corrected to match the actual measured 5% bar.

#### Removed
- `docs/DEPLOYMENT.md` (content folded into `README.md`'s Deployment section).
- Reference to `docs/DEPLOYMENT.md` from CI lint job, README docs comment in repo-layout diagram, and `CHANGELOG.md` documentation list.
- Broken `<link rel="icon" href="public/favicon.ico">` from `index.html` (favicon was never created); empty `public/` directory removed.

### Initial implementation

#### Added
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
