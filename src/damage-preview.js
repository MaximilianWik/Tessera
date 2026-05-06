/* Tessera — interactive damage tolerance preview.
 *
 * Lets the user pick a damage level (0% through 30%) and see, in real time:
 *   1. The QR with a clustered "blot" of that size flipped on top
 *   2. Whether the decoders can still read it back, and what they read
 *
 * The blot uses the same model as src/damage.js (square blot at random
 * position, only flipping non-reserved data modules), driven by a stable
 * seed so the visual is reproducible per level.
 *
 * Public API:
 *   Tessera.DamagePreview.renderDamaged(canvas, qr, percent, opts)
 *     - Synchronously paints `qr` with `percent`% clustered damage onto
 *       `canvas`. Returns the corrupted QR-shaped object.
 *
 *   Tessera.DamagePreview.decodeDamaged(qr, percent, expectedText, opts)
 *     - Renders to an offscreen canvas, runs every available decoder,
 *       returns Promise<{
 *         ok,                  // true iff at least one decoder returned the
 *                              // expected text and none returned wrong text
 *         decoded,             // first matching decoded text, or null
 *         decoders,            // [{name, available, success, equals?, error?}]
 *         percent,             // echoed back
 *       }>
 *
 *   Tessera.DamagePreview.LEVELS — [0, 5, 10, 15, 20, 25, 30]
 *
 * opts (both):
 *   moduleSize: pixels per module (default 12)
 *   margin:     quiet-zone modules (default 4)
 *   seed:       uint32 for the blot RNG (default 0xC0FFEE — same as test seed
 *               so the preview matches what the damage test reports)
 */
(function (global) {
  'use strict';

  var T = global.Tessera = global.Tessera || {};

  var LEVELS = [0, 5, 10, 15, 20, 25, 30];

  function corrupt(qr, percent, seed) {
    if (!percent || percent <= 0) return qr; // no-op at 0%
    var rand = T.Damage._mulberry32(seed >>> 0);
    return T.Damage._corruptModules(qr, percent, rand);
  }

  function paintToCanvas(canvas, qr, opts) {
    var moduleSize = opts.moduleSize || 12;
    var margin = opts.margin === undefined ? 4 : opts.margin;
    var size = qr.size;
    var pxSize = (size + 2 * margin) * moduleSize;
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
            moduleSize, moduleSize
          );
        }
      }
    }
  }

  function renderDamaged(canvas, qr, percent, opts) {
    opts = opts || {};
    var seed = opts.seed === undefined ? 0xC0FFEE : opts.seed;
    var corrupted = corrupt(qr, percent, seed);
    paintToCanvas(canvas, corrupted, opts);
    return corrupted;
  }

  // Decode a damaged QR and report whether all surviving decoders agree on
  // the expected text. Mirrors Tessera.Verify.verify but uses the corrupted
  // matrix; since damage is the entire point, the verifier-style "ok = at
  // least one match + no mismatches" rule is identical.
  function decodeDamaged(qr, percent, expectedText, opts) {
    opts = opts || {};
    var seed = opts.seed === undefined ? 0xC0FFEE : opts.seed;
    var corrupted = corrupt(qr, percent, seed);

    // Use the verify module's render-for-decode path so the decoders see a
    // sufficiently large canvas (zxing-js needs roomy renders).
    var rendered = T.Verify.renderForDecode(corrupted);
    var jsqrResult = T.Verify._decodeWithJsQR(rendered);
    var zxingResult = T.Verify._decodeWithZXing(rendered);
    return T.Verify._decodeWithNative(rendered).then(function (nativeResult) {
      var decoders = [jsqrResult, zxingResult, nativeResult];
      decoders.forEach(function (d) { if (d.success) d.equals = (d.decoded === expectedText); });
      var available = decoders.filter(function (d) { return d.available; });
      var successes = available.filter(function (d) { return d.success; });
      var anyExact = successes.some(function (d) { return d.equals; });
      var anyMismatch = successes.some(function (d) { return !d.equals; });
      var firstDecoded = null;
      for (var i = 0; i < successes.length; i++) {
        if (successes[i].equals) { firstDecoded = successes[i].decoded; break; }
      }
      if (firstDecoded === null && successes.length > 0) firstDecoded = successes[0].decoded;
      return {
        ok: anyExact && !anyMismatch,
        decoded: firstDecoded,
        decoders: decoders,
        percent: percent,
        corrupted: corrupted,
      };
    });
  }

  T.DamagePreview = {
    LEVELS: LEVELS,
    renderDamaged: renderDamaged,
    decodeDamaged: decodeDamaged,
  };
})(typeof window !== 'undefined' ? window : globalThis);
