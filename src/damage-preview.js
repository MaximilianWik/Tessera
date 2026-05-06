/* Tessera — blur-based damage preview + tolerance sweep.
 *
 * Real tattoos don't fail through hard "blot" coverage. They fail through
 * gradual ink bleed and edge softening — gaussian blur, more or less. So
 * the damage preview applies an actual gaussian blur (via canvas filter) at
 * a radius proportional to the chosen damage level, then re-decodes the
 * blurred image. What you see on screen is what your QR will roughly look
 * like that many years into its life as a tattoo.
 *
 * Blur calibration:
 *   blur_radius_px = (percent / 100) * moduleSize * 3
 *
 *   Practical reading at moduleSize = 20 px:
 *     0%  → 0 px      pristine, fresh ink
 *     5%  → 3 px      visible softening, ~5-year tattoo
 *    15%  → 9 px      noticeable bleed, ~15-year tattoo with normal aging
 *    30%  → 18 px     nearly a full module of blur, severe bleed
 *
 *   The numbers are deliberately aggressive — real ink behaves worse than
 *   pure gaussian blur (it asymmetric-bleeds, fades unevenly). A QR that
 *   survives 5% blur in this simulation is comfortably durable for the
 *   first decade or two of normal skin life. A QR that survives 15% is
 *   robust enough to outlast most tattoos.
 *
 * Public API:
 *   Tessera.DamagePreview.LEVELS               -> [0, 5, 10, 15, 20, 25, 30]
 *
 *   Tessera.DamagePreview.renderBlurred(canvas, qr, percent, opts)
 *     -> synchronously paint qr + blur into `canvas`. Returns the blur
 *        radius applied (in px), for caller display.
 *
 *   Tessera.DamagePreview.decodeBlurred(qr, percent, expectedText, opts)
 *     -> Promise<{ ok, decoded, decoders, percent, blurPx }>
 *        ok      = at least one decoder returned the expected text AND
 *                  no decoder returned a different text
 *        decoded = first matching decoded text, or first wrong text, or null
 *
 *   Tessera.DamagePreview.sweepTolerance(qr, expectedText, opts)
 *     -> Promise<{
 *          levels: [{ percent, ok, decoded, blurPx }, ...],
 *          maxTolerated: number,    // highest level that still decoded ok
 *          passesPermanenceBar: bool  // maxTolerated >= 5
 *        }>
 *      Runs all LEVELS in order, reports which still scan. Replaces the
 *      old random-blot sweep in src/damage.js for the live preview path.
 *
 * opts (all):
 *   moduleSize: pixels per module on the rendered canvas (default 20). The
 *               blur scale follows this; bigger modules tolerate more blur
 *               in absolute pixels, which mirrors real tattoo behaviour
 *               (bigger ink dots = more durable to bleed).
 *   margin:     quiet-zone in modules (default 4)
 */
(function (global) {
  'use strict';

  var T = global.Tessera = global.Tessera || {};

  var LEVELS = [0, 5, 10, 15, 20, 25, 30];

  function defaults(opts) {
    opts = opts || {};
    return {
      moduleSize: opts.moduleSize || 20,
      margin: opts.margin === undefined ? 4 : opts.margin,
    };
  }

  function blurRadiusFor(percent, moduleSize) {
    // Linear in percent, scaled to the module size so the visual progression
    // is consistent regardless of render scale. The 3x multiplier lands 30%
    // at nearly a full module of blur — enough to render small QRs unreadable
    // and meaningfully degrade large ones, matching realistic worst-case
    // tattoo aging.
    return (percent / 100) * moduleSize * 3;
  }

  function paintQR(ctx, qr, o) {
    var size = qr.size;
    var pxSize = (size + 2 * o.margin) * o.moduleSize;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pxSize, pxSize);
    ctx.fillStyle = '#000000';
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (qr.modules[y][x]) {
          ctx.fillRect(
            (x + o.margin) * o.moduleSize,
            (y + o.margin) * o.moduleSize,
            o.moduleSize, o.moduleSize
          );
        }
      }
    }
    return pxSize;
  }

  function renderBlurred(canvas, qr, percent, opts) {
    var o = defaults(opts);
    var size = qr.size;
    var pxSize = (size + 2 * o.margin) * o.moduleSize;
    var blurPx = blurRadiusFor(percent, o.moduleSize);

    canvas.width = pxSize;
    canvas.height = pxSize;
    var ctx = canvas.getContext('2d');

    if (blurPx <= 0.001) {
      // Fast path: no blur, paint directly.
      paintQR(ctx, qr, o);
      return blurPx;
    }

    // Two-stage paint so the blur convolves a clean image:
    //   1. Paint the QR onto an offscreen canvas.
    //   2. Draw it onto the destination with ctx.filter = blur(N).
    var off = document.createElement('canvas');
    off.width = pxSize;
    off.height = pxSize;
    paintQR(off.getContext('2d'), qr, o);

    // Fill destination white first so blurred edges fade to white not black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pxSize, pxSize);
    ctx.filter = 'blur(' + blurPx.toFixed(2) + 'px)';
    ctx.drawImage(off, 0, 0);
    ctx.filter = 'none';
    return blurPx;
  }

  function imageDataFromCanvas(canvas) {
    var ctx = canvas.getContext('2d');
    return {
      canvas: canvas,
      imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
      width: canvas.width,
      height: canvas.height,
    };
  }

  function decodeBlurred(qr, percent, expectedText, opts) {
    var o = defaults(opts);
    var canvas = document.createElement('canvas');
    var blurPx = renderBlurred(canvas, qr, percent, o);
    var rendered = imageDataFromCanvas(canvas);

    var jsqrResult = T.Verify._decodeWithJsQR(rendered);
    var zxingResult = T.Verify._decodeWithZXing(rendered);
    return T.Verify._decodeWithNative(rendered).then(function (nativeResult) {
      var decoders = [jsqrResult, zxingResult, nativeResult];
      decoders.forEach(function (d) {
        if (d.success) d.equals = (d.decoded === expectedText);
      });
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
        blurPx: blurPx,
      };
    });
  }

  function sweepTolerance(qr, expectedText, opts) {
    // Deterministic blur — no need for multiple trials per level.
    var p = Promise.resolve();
    var levels = [];
    LEVELS.forEach(function (pct) {
      p = p.then(function () {
        return decodeBlurred(qr, pct, expectedText, opts).then(function (r) {
          levels.push({ percent: pct, ok: r.ok, decoded: r.decoded, blurPx: r.blurPx });
        });
      });
    });
    return p.then(function () {
      // Highest contiguous-from-zero level at which decoding still passes.
      var maxTolerated = 0;
      for (var i = 0; i < levels.length; i++) {
        if (levels[i].ok) maxTolerated = levels[i].percent;
        else break;
      }
      return {
        levels: levels,
        maxTolerated: maxTolerated,
        passesPermanenceBar: maxTolerated >= 5,
      };
    });
  }

  T.DamagePreview = {
    LEVELS: LEVELS,
    blurRadiusFor: blurRadiusFor,
    renderBlurred: renderBlurred,
    decodeBlurred: decodeBlurred,
    sweepTolerance: sweepTolerance,
  };
})(typeof window !== 'undefined' ? window : globalThis);
