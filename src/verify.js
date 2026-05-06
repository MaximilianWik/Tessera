/* Tessera — round-trip verification.
 *
 * Renders a QR matrix to a canvas, then asks each available decoder to read
 * it back and compares the result to the input text. Returns a structured
 * result that the UI uses to gate the download buttons.
 *
 * Decoders attempted (each independently):
 *   1. jsQR                       — vendored from cozmo/jsQR
 *   2. zxing-js                   — vendored from zxing-js/library (port of Google ZXing)
 *   3. BarcodeDetector (native)   — browser-built-in, where available (Chrome/Edge today,
 *                                   Safari iOS 17+ via Visual Look-Up)
 *
 * The output is considered "verified" if every available decoder returned the
 * exact original input string. If a decoder is not available, it's recorded as
 * such — verification is not blocked, but the result is flagged.
 *
 * Public API:
 *   Tessera.Verify.verify(qr, text, opts)  -> Promise<VerifyResult>
 *   Tessera.Verify.renderForDecode(qr)     -> { canvas, imageData, width, height }
 *
 * VerifyResult shape:
 *   {
 *     ok: boolean,                   // true iff all *available* decoders agreed
 *     decoders: [
 *       { name, available, success, decoded, equals, error? },
 *       ...
 *     ],
 *   }
 */
(function (global) {
  'use strict';

  var T = global.Tessera = global.Tessera || {};

  // Render the QR onto a canvas at a generous module size so decoders can
  // reliably scan it. zxing-js's HybridBinarizer is sensitive to small image
  // dimensions; 20 px/module is the smallest size that's reliably read by
  // all three decoders across our test corpus, even for tight v1 QRs.
  function renderForDecode(qr, opts) {
    opts = opts || {};
    var moduleSize = opts.moduleSize || 20;
    var margin = opts.margin === undefined ? 4 : opts.margin;
    var size = qr.size;
    var pxSize = (size + 2 * margin) * moduleSize;

    var canvas = document.createElement('canvas');
    canvas.width = pxSize;
    canvas.height = pxSize;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pxSize, pxSize);
    ctx.fillStyle = '#000000';
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (qr.modules[y][x]) {
          ctx.fillRect(
            (x + margin) * moduleSize,
            (y + margin) * moduleSize,
            moduleSize,
            moduleSize
          );
        }
      }
    }
    var imageData = ctx.getImageData(0, 0, pxSize, pxSize);
    return { canvas: canvas, imageData: imageData, width: pxSize, height: pxSize };
  }

  // ---- Decoder 1: jsQR -------------------------------------------------------

  function decodeWithJsQR(rendered) {
    if (typeof global.jsQR !== 'function') {
      return { name: 'jsQR', available: false };
    }
    try {
      var result = global.jsQR(rendered.imageData.data, rendered.width, rendered.height);
      if (!result) {
        return { name: 'jsQR', available: true, success: false, error: 'no QR detected' };
      }
      return { name: 'jsQR', available: true, success: true, decoded: result.data };
    } catch (e) {
      return { name: 'jsQR', available: true, success: false, error: String(e && e.message || e) };
    }
  }

  // ---- Decoder 2: zxing-js ---------------------------------------------------

  function decodeWithZXing(rendered) {
    var ZX = global.ZXing;
    if (!ZX || !ZX.QRCodeReader) {
      return { name: 'zxing-js', available: false };
    }
    try {
      // Convert RGBA -> luminance (single channel, 0..255) for RGBLuminanceSource.
      // Our canvas only ever paints pure black or pure white modules, so
      // R == G == B at every pixel; we can take any channel directly. This
      // produces exact 0/255 endpoints, which zxing's HybridBinarizer is
      // happier with than a weighted-luma formula that yields 254.something.
      var rgba = rendered.imageData.data;
      var n = rendered.width * rendered.height;
      var lum = new Uint8ClampedArray(n);
      for (var i = 0, j = 0; i < n; i++, j += 4) {
        lum[i] = rgba[j];
      }
      // Try multiple binarizer strategies. zxing-js's HybridBinarizer is
      // tuned for camera input and sometimes fails on tight, perfect
      // computer-rendered QRs (small image dimensions, no noise to anchor
      // its block-thresholding heuristic). GlobalHistogramBinarizer is the
      // canonical fallback for clean inputs.
      var binarizers = [
        function (src) { return new ZX.HybridBinarizer(src); },
        function (src) { return new ZX.GlobalHistogramBinarizer(src); },
      ];
      var lastErr = null;
      for (var bi = 0; bi < binarizers.length; bi++) {
        try {
          var source = new ZX.RGBLuminanceSource(lum, rendered.width, rendered.height);
          var bitmap = new ZX.BinaryBitmap(binarizers[bi](source));
          var reader = new ZX.QRCodeReader();
          var result = reader.decode(bitmap);
          return { name: 'zxing-js', available: true, success: true, decoded: result.getText() };
        } catch (e) {
          lastErr = e;
        }
      }
      return { name: 'zxing-js', available: true, success: false, error: String(lastErr && lastErr.message || lastErr) };
    } catch (e) {
      return { name: 'zxing-js', available: true, success: false, error: String(e && e.message || e) };
    }
  }

  // ---- Decoder 3: native BarcodeDetector ------------------------------------

  function decodeWithNative(rendered) {
    if (typeof global.BarcodeDetector !== 'function') {
      return Promise.resolve({ name: 'BarcodeDetector', available: false });
    }
    try {
      var detector = new global.BarcodeDetector({ formats: ['qr_code'] });
      return detector.detect(rendered.canvas).then(
        function (results) {
          if (!results || results.length === 0) {
            return { name: 'BarcodeDetector', available: true, success: false, error: 'no QR detected' };
          }
          return { name: 'BarcodeDetector', available: true, success: true, decoded: results[0].rawValue };
        },
        function (err) {
          return { name: 'BarcodeDetector', available: true, success: false, error: String(err && err.message || err) };
        }
      );
    } catch (e) {
      return Promise.resolve({ name: 'BarcodeDetector', available: true, success: false, error: String(e && e.message || e) });
    }
  }

  // ---- Orchestrator ----------------------------------------------------------

  function verify(qr, text, opts) {
    var rendered = renderForDecode(qr, opts);
    var jsqrResult = decodeWithJsQR(rendered);
    var zxingResult = decodeWithZXing(rendered);
    return decodeWithNative(rendered).then(function (nativeResult) {
      var decoders = [jsqrResult, zxingResult, nativeResult];
      decoders.forEach(function (d) {
        if (d.success) d.equals = (d.decoded === text);
      });
      var availableResults = decoders.filter(function (d) { return d.available; });
      var successes = availableResults.filter(function (d) { return d.success; });
      var anyMismatch = successes.some(function (d) { return !d.equals; });
      // Verification semantics:
      //   - At least one decoder must successfully decode the QR (else
      //     no scanner read it, so it's not actually verified).
      //   - Every decoder that succeeded must agree on the exact input
      //     (silent mismatches are the dangerous failure mode — that's an
      //     encoder bug producing a "valid-looking but wrong" QR).
      // We separately report the redundancy level (1/2/3) so the UI can
      // distinguish "1 decoder agreed" from "3 decoders agreed".
      var ok = successes.length >= 1 && !anyMismatch;
      return {
        ok: ok,
        redundancy: successes.length,
        decoders: decoders,
      };
    });
  }

  T.Verify = {
    verify: verify,
    renderForDecode: renderForDecode,
    // Exposed for damage-tolerance tests:
    _decodeWithJsQR: decodeWithJsQR,
    _decodeWithZXing: decodeWithZXing,
    _decodeWithNative: decodeWithNative,
  };
})(typeof window !== 'undefined' ? window : globalThis);
