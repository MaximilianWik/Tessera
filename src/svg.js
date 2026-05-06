/* Tessera — SVG output writer.
 *
 * SVG is the recommended format for a tattoo artist. It scales to any size
 * losslessly. We emit a single <path> made up of axis-aligned rectangles —
 * this is by far the most compact representation and renders identically
 * in every SVG renderer ever made.
 *
 * Public API:
 *   Tessera.SVG.toString(qr, opts) -> string
 *   Tessera.SVG.toBlob(qr, opts)   -> Blob
 *
 * opts:
 *   moduleSize: pixel size per module in the SVG's user units (default 10)
 *   margin:     quiet-zone in modules (default 4)
 *   dark:       fill colour (default '#000')
 *   light:      background colour, or null for transparent (default '#fff')
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
      light: opts.light === null ? null : (opts.light || '#ffffff'),
    };
  }

  function buildPath(qr, o) {
    // Run-length encode each row into M/h directives. This is far smaller
    // than one rect per module and renders identically.
    var size = qr.size;
    var parts = [];
    for (var y = 0; y < size; y++) {
      var x = 0;
      while (x < size) {
        if (qr.modules[y][x]) {
          var startX = x;
          while (x < size && qr.modules[y][x]) x++;
          var w = x - startX;
          // Path: M <x> <y> h <w> v 1 h -<w> z
          parts.push('M' + (startX + o.margin) + ',' + (y + o.margin)
                   + 'h' + w + 'v1h-' + w + 'z');
        } else {
          x++;
        }
      }
    }
    return parts.join('');
  }

  function toString(qr, opts) {
    var o = defaults(opts);
    var size = qr.size;
    var total = size + 2 * o.margin;
    var pxSize = total * o.moduleSize;
    var path = buildPath(qr, o);
    var bg = '';
    if (o.light !== null) {
      bg = '<rect width="' + total + '" height="' + total + '" fill="' + o.light + '"/>';
    }
    // We use viewBox in module units and let width/height scale to any pixel
    // size. shape-rendering="crispEdges" ensures pixel-perfect rendering at
    // integer scales (no antialiasing blur on module boundaries).
    return ''
      + '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<svg xmlns="http://www.w3.org/2000/svg" '
      +     'viewBox="0 0 ' + total + ' ' + total + '" '
      +     'width="' + pxSize + '" height="' + pxSize + '" '
      +     'shape-rendering="crispEdges">'
      + bg
      + '<path d="' + path + '" fill="' + o.dark + '"/>'
      + '</svg>\n';
  }

  function toBlob(qr, opts) {
    return new Blob([toString(qr, opts)], { type: 'image/svg+xml' });
  }

  T.SVG = {
    toString: toString,
    toBlob: toBlob,
  };
})(typeof window !== 'undefined' ? window : globalThis);
