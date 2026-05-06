# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial implementation: client-side QR encoder (byte mode, all 40 versions, EC levels L/M/Q/H, masks 0–7)
- Reed–Solomon encoder over GF(256) with the QR-specific primitive polynomial 0x11D
- ISO/IEC 18004 Annex I worked-example test vector
- Round-trip verification through jsQR, zxing-js, and native `BarcodeDetector` (where available)
- Damage tolerance simulation (random module corruption at 5–30%)
- PNG and SVG output writers
- Printable archival specification sheet
- Browser-based test runner (`tests.html`)
- GitHub Actions CI workflow
- Documentation: `README.md`, `docs/PERMANENCE.md`, `docs/SPEC.md`

[Unreleased]: https://github.com/MaximilianWik/Tessera/compare/v0.0.0...HEAD
