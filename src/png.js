/* Tessera — PNG output writer.
 *
 * Renders a QR matrix to a PNG via Canvas. We use canvas.toBlob() which
 * produces a fully conforming PNG (per the W3C PNG spec) — every PNG decoder
 * in existence reads it. This is the simplest path that maximizes
 * archivability.
 *
 * Public API:
 *   Tessera.PNG.toCanvas(qr, opts)    -> HTMLCanvasElement
 *   Tessera.PNG.toBlob(qr, opts)      -> Promise<Blob>
 *   Tessera.PNG.toDataURL(qr, opts)   -> string (data:image/png;base64,...)
 *
 * opts:
 *   moduleSize: pixel size of one module (default 10)
 *   margin:     quiet-zone size in modules (default 4 — ISO minimum)
 *   dark:       CSS colour for dark modules (default '#000')
 *   light:      CSS colour for light modules (default '#fff')
 */
(function (global) {
  'use strict';

  var T = global.Tessera = global.Tessera || {};

  function defaults(opts) {
    opts = opts || {};
    return {
      moduleSize: opts.moduleSize || 10,
      margin: opts.margin === undefined ? 4 : opts.margin,
      dark: opts.dark || '#000000',
      light: opts.light || '#ffffff',
    };
  }

  function toCanvas(qr, opts) {
    var o = defaults(opts);
    var size = qr.size;
    var pxSize = (size + 2 * o.margin) * o.moduleSize;
    var canvas = document.createElement('canvas');
    canvas.width = pxSize;
    canvas.height = pxSize;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = o.light;
    ctx.fillRect(0, 0, pxSize, pxSize);
    ctx.fillStyle = o.dark;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (qr.modules[y][x]) {
          ctx.fillRect(
            (x + o.margin) * o.moduleSize,
            (y + o.margin) * o.moduleSize,
            o.moduleSize,
            o.moduleSize
          );
        }
      }
    }
    return canvas;
  }

  function toBlob(qr, opts) {
    var canvas = toCanvas(qr, opts);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) reject(new Error('PNG encoding failed'));
        else resolve(blob);
      }, 'image/png');
    });
  }

  function toDataURL(qr, opts) {
    var canvas = toCanvas(qr, opts);
    return canvas.toDataURL('image/png');
  }

  // Render to an existing canvas (used for the live preview in the UI).
  function renderInto(canvas, qr, opts) {
    var o = defaults(opts);
    var size = qr.size;
    var pxSize = (size + 2 * o.margin) * o.moduleSize;
    canvas.width = pxSize;
    canvas.height = pxSize;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = o.light;
    ctx.fillRect(0, 0, pxSize, pxSize);
    ctx.fillStyle = o.dark;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (qr.modules[y][x]) {
          ctx.fillRect(
            (x + o.margin) * o.moduleSize,
            (y + o.margin) * o.moduleSize,
            o.moduleSize,
            o.moduleSize
          );
        }
      }
    }
    return canvas;
  }

  T.PNG = {
    toCanvas: toCanvas,
    toBlob: toBlob,
    toDataURL: toDataURL,
    renderInto: renderInto,
  };
})(typeof window !== 'undefined' ? window : globalThis);
