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

  // Detect canvas 2D filter support — robustly. iOS Safari < 17 (released
  // Sept 2023) doesn't implement `ctx.filter`, but setting it still succeeds
  // (it just creates a normal JS property on the context object), so a naive
  // `ctx.filter = 'blur(2px)'; return ctx.filter === 'blur(2px)'` test passes
  // even though the filter never actually applies. We need to FUNCTIONALLY
  // verify that drawing with a blur filter changes the resulting pixels.
  //
  // The test: paint a small white square on a black canvas via drawImage with
  // ctx.filter = 'blur(2px)'. If blur worked, pixels just outside the square
  // pick up some gray from the spread. If blur silently no-opped, those
  // pixels stay pure black.
  var HAS_CTX_FILTER = (function () {
    if (typeof document === 'undefined') return false;
    try {
      // First-line check: is `filter` even on the prototype? (Catches iOS 16.)
      if (typeof CanvasRenderingContext2D !== 'undefined'
          && !('filter' in CanvasRenderingContext2D.prototype)) {
        return false;
      }
      var c = document.createElement('canvas');
      c.width = c.height = 8;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 8, 8);
      var off = document.createElement('canvas');
      off.width = off.height = 8;
      var offCtx = off.getContext('2d');
      offCtx.fillStyle = '#ffffff';
      offCtx.fillRect(2, 2, 4, 4); // 4×4 white square centered in 8×8
      ctx.filter = 'blur(2px)';
      ctx.drawImage(off, 0, 0);
      ctx.filter = 'none';
      // Pixel at (1, 1) is just outside the white square. With blur applied,
      // gaussian spread from the square reaches it; without blur, it stays
      // black (drawImage of an offscreen with no fill at (1,1) is transparent
      // over the existing black main canvas → black).
      var pixel = ctx.getImageData(1, 1, 1, 1).data;
      return pixel[0] > 0;
    } catch (e) {
      return false;
    }
  })();

  // Sliding-window box blur. O(N) per pass regardless of radius, so safe to
  // run on mobile at any blur level. Three passes approximate a gaussian
  // (sigma ~= radius * sqrt(3) for the 3-pass equivalence). For our use case
  // exact gaussian-equivalence isn't critical: the user just needs the QR
  // to actually blur and the decoders to see the result.
  function blurRow(src, dst, w, y, r) {
    var winLen = 2 * r + 1;
    var sumR = 0, sumG = 0, sumB = 0, sumA = 0;
    var i, sx, sidx;
    for (i = -r; i <= r; i++) {
      sx = i < 0 ? 0 : (i >= w ? w - 1 : i);
      sidx = (y * w + sx) * 4;
      sumR += src[sidx]; sumG += src[sidx + 1]; sumB += src[sidx + 2]; sumA += src[sidx + 3];
    }
    var didx, outX, inX, outIdx, inIdx;
    for (var x = 0; x < w; x++) {
      didx = (y * w + x) * 4;
      dst[didx]     = sumR / winLen;
      dst[didx + 1] = sumG / winLen;
      dst[didx + 2] = sumB / winLen;
      dst[didx + 3] = sumA / winLen;
      outX = x - r; if (outX < 0) outX = 0;
      inX  = x + r + 1; if (inX > w - 1) inX = w - 1;
      outIdx = (y * w + outX) * 4;
      inIdx  = (y * w + inX) * 4;
      sumR += src[inIdx]     - src[outIdx];
      sumG += src[inIdx + 1] - src[outIdx + 1];
      sumB += src[inIdx + 2] - src[outIdx + 2];
      sumA += src[inIdx + 3] - src[outIdx + 3];
    }
  }

  function blurCol(src, dst, w, h, x, r) {
    var winLen = 2 * r + 1;
    var sumR = 0, sumG = 0, sumB = 0, sumA = 0;
    var i, sy, sidx;
    for (i = -r; i <= r; i++) {
      sy = i < 0 ? 0 : (i >= h ? h - 1 : i);
      sidx = (sy * w + x) * 4;
      sumR += src[sidx]; sumG += src[sidx + 1]; sumB += src[sidx + 2]; sumA += src[sidx + 3];
    }
    var didx, outY, inY, outIdx, inIdx;
    for (var y = 0; y < h; y++) {
      didx = (y * w + x) * 4;
      dst[didx]     = sumR / winLen;
      dst[didx + 1] = sumG / winLen;
      dst[didx + 2] = sumB / winLen;
      dst[didx + 3] = sumA / winLen;
      outY = y - r; if (outY < 0) outY = 0;
      inY  = y + r + 1; if (inY > h - 1) inY = h - 1;
      outIdx = (outY * w + x) * 4;
      inIdx  = (inY * w + x) * 4;
      sumR += src[inIdx]     - src[outIdx];
      sumG += src[inIdx + 1] - src[outIdx + 1];
      sumB += src[inIdx + 2] - src[outIdx + 2];
      sumA += src[inIdx + 3] - src[outIdx + 3];
    }
  }

  function jsBoxBlur(imageData, blurPx) {
    // Three passes of box blur with radius r approximate a gaussian with
    // sigma ≈ r. Empirically the box-blur version is harsher on QR decoding
    // at the same nominal radius than ctx.filter's gaussian, so we apply a
    // calibration factor of 0.6 to bring mobile (JS path) tolerance results
    // into rough agreement with desktop (ctx.filter path) results.
    var radius = Math.max(1, Math.round(blurPx * 0.6));
    var w = imageData.width;
    var h = imageData.height;
    var data = imageData.data;
    var temp = new Uint8ClampedArray(data.length);
    for (var pass = 0; pass < 3; pass++) {
      // Horizontal: data -> temp
      for (var y = 0; y < h; y++) blurRow(data, temp, w, y, radius);
      // Vertical: temp -> data
      for (var x = 0; x < w; x++) blurCol(temp, data, w, h, x, radius);
    }
    return imageData;
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

    if (HAS_CTX_FILTER) {
      // Native canvas filter path. Two-stage paint so the blur convolves a
      // clean image:
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
    } else {
      // Fallback for iOS Safari < 17 and other browsers without canvas filter
      // support: paint the clean QR, then box-blur the imageData in pure JS.
      paintQR(ctx, qr, o);
      var imageData = ctx.getImageData(0, 0, pxSize, pxSize);
      jsBoxBlur(imageData, blurPx);
      ctx.putImageData(imageData, 0, 0);
    }
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
