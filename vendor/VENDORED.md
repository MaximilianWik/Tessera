# Vendored decoders

This directory holds **committed copies** of the two third-party QR decoders Tessera uses for round-trip verification. The decoders are not loaded from a CDN at runtime; they're served from this repo as part of the static site. This means:

1. **No supply-chain risk.** The exact decoder code is part of your Git history. If the upstream package were ever compromised, your existing builds are unaffected.
2. **No external network calls.** The Tessera site has zero runtime dependencies on third-party services.
3. **Archivability.** If npm or the CDN ever go away, your repo still works.
4. **Auditability.** Anyone can `git diff` the vendored file against the published source.

## What's vendored

### `jsqr.js`
- **Project**: [cozmo/jsQR](https://github.com/cozmo/jsQR)
- **Version**: 1.4.0
- **Source**: `https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js`
- **License**: Apache-2.0
- **Global it attaches to**: `window.jsQR`
- **Usage**: `jsQR(rgbaUint8ClampedArray, width, height) -> { data, ... } | null`

### `zxing.js`
- **Project**: [zxing-js/library](https://github.com/zxing-js/library), the JavaScript port of [Google ZXing](https://github.com/zxing/zxing), the canonical reference QR decoder used in Android ML Kit Vision.
- **Version**: 0.21.3
- **Source**: `https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js`
- **License**: Apache-2.0
- **Global it attaches to**: `window.ZXing`
- **Usage**: `new ZXing.QRCodeReader().decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.RGBLuminanceSource(...))))`

### Native `BarcodeDetector`
A third decoder is used when available: the browser's built-in [`BarcodeDetector`](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector). On Chrome and Edge this calls the **OS-level decoder**, the same code iPhones and Androids use in the camera app. There's nothing to vendor here; the runtime feature-detects it.

## Verifying authenticity

To verify the vendored files match the upstream packages:

```sh
# jsqr.js
curl -sL https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js \
  | shasum -a 256
shasum -a 256 vendor/jsqr.js

# zxing.js
curl -sL https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js \
  | shasum -a 256
shasum -a 256 vendor/zxing.js
```

The hashes must match. (Checking these in CI is a planned future improvement.)

## Updating

If you need to update a vendored decoder, fetch the new version, commit it as part of a clearly-labeled change, and update this file with the new version + URL. Run the full test suite to confirm round-trip still works.
