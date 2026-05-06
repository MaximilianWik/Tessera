/* Tessera — printable archival spec sheet.
 *
 * Generates a self-contained HTML document that, if printed and stored, can
 * fully reconstruct the QR even if every digital file is lost. Includes:
 *
 *   - The QR rendered at multiple physical sizes (3, 5, 7, 10 cm)
 *   - The encoded URL in plain text
 *   - Version, EC level, mask number, module dimensions
 *   - Generation timestamp
 *   - The full module matrix as ASCII art and as a hex dump
 *   - SHA-256 of the generator source code
 *   - Round-trip verification results
 *   - Damage tolerance test results
 *   - Reproduction instructions
 *
 * Public API:
 *   Tessera.SpecSheet.build(qr, ctx) -> Promise<string>  // full HTML document
 *   Tessera.SpecSheet.openInTab(qr, ctx)                 // opens in a new window for printing
 *
 * ctx (all optional but recommended):
 *   verifyResult: result from Tessera.Verify.verify(...)
 *   damageResult: result from Tessera.Damage.test(...)
 *   sourceHash:   precomputed SHA-256 hex string of the generator (we'll compute if absent)
 *   generatedAt:  ISO timestamp string (default = now)
 *   url:          URL of the live Tessera site that generated this (for reproduction)
 */
(function (global) {
  'use strict';

  var T = global.Tessera = global.Tessera || {};

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function moduleMatrixToAscii(qr) {
    // Use two characters per module so the result is roughly square in a
    // monospace font.
    var rows = [];
    for (var y = 0; y < qr.size; y++) {
      var row = '';
      for (var x = 0; x < qr.size; x++) {
        row += qr.modules[y][x] ? '##' : '..';
      }
      rows.push(row);
    }
    return rows.join('\n');
  }

  function moduleMatrixToHex(qr) {
    // Pack the matrix row-major, MSB-first within each byte. Trailing bits
    // padded with 0. Output as 16-byte rows.
    var size = qr.size;
    var totalBits = size * size;
    var totalBytes = Math.ceil(totalBits / 8);
    var bytes = new Uint8Array(totalBytes);
    var bitIdx = 0;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (qr.modules[y][x]) {
          bytes[bitIdx >> 3] |= 1 << (7 - (bitIdx & 7));
        }
        bitIdx++;
      }
    }
    var hexLines = [];
    for (var off = 0; off < totalBytes; off += 16) {
      var line = ('00000000' + off.toString(16)).slice(-8) + ': ';
      for (var i = 0; i < 16 && off + i < totalBytes; i++) {
        line += ('0' + bytes[off + i].toString(16)).slice(-2) + ' ';
      }
      hexLines.push(line.trimEnd());
    }
    return hexLines.join('\n');
  }

  function sha256Hex(buffer) {
    if (typeof crypto === 'undefined' || !crypto.subtle || !crypto.subtle.digest) {
      return Promise.resolve('(crypto.subtle unavailable)');
    }
    return crypto.subtle.digest('SHA-256', buffer).then(function (hash) {
      var bytes = new Uint8Array(hash);
      var hex = '';
      for (var i = 0; i < bytes.length; i++) {
        hex += ('0' + bytes[i].toString(16)).slice(-2);
      }
      return hex;
    });
  }

  function fetchSourceHash() {
    if (typeof fetch !== 'function') return Promise.resolve('(fetch unavailable)');
    var paths = ['src/qr.js', 'src/reed-solomon.js'];
    return Promise.all(paths.map(function (p) {
      return fetch(p, { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('fetch ' + p + ' failed');
        return r.arrayBuffer();
      });
    })).then(function (buffers) {
      // Concatenate then hash
      var total = 0;
      buffers.forEach(function (b) { total += b.byteLength; });
      var combined = new Uint8Array(total);
      var off = 0;
      buffers.forEach(function (b) {
        combined.set(new Uint8Array(b), off);
        off += b.byteLength;
      });
      return sha256Hex(combined.buffer);
    }, function () { return '(could not fetch source files — open spec sheet from the live site)'; });
  }

  function svgAtCm(qr, cmSize) {
    // A 4-module quiet zone is required by the spec.
    var moduleCount = qr.size + 8;
    var pxPerCm = 96 / 2.54;
    var pxSize = cmSize * pxPerCm;
    return T.SVG.toString(qr, { moduleSize: pxSize / moduleCount, margin: 4 });
  }

  function renderVerifyHtml(verifyResult) {
    if (!verifyResult) return '<p class="muted">No verification result attached.</p>';
    var rows = verifyResult.decoders.map(function (d) {
      if (!d.available) {
        return '<tr><td>' + escapeHtml(d.name) + '</td><td class="muted">not available in this browser</td><td>—</td></tr>';
      }
      if (!d.success) {
        return '<tr><td>' + escapeHtml(d.name) + '</td><td class="bad">FAIL: ' + escapeHtml(d.error || '') + '</td><td>—</td></tr>';
      }
      var statusCls = d.equals ? 'good' : 'bad';
      var statusText = d.equals ? 'OK — round-trip exact' : 'MISMATCH';
      return '<tr><td>' + escapeHtml(d.name) + '</td><td class="' + statusCls + '">' + statusText + '</td><td><code>' + escapeHtml(d.decoded) + '</code></td></tr>';
    });
    return '<table><thead><tr><th>Decoder</th><th>Status</th><th>Decoded text</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  }

  function renderDamageHtml(damageResult) {
    if (!damageResult) return '<p class="muted">No damage test result attached.</p>';
    var rows = damageResult.levels.map(function (lv) {
      var pct = (lv.passRate * 100).toFixed(0);
      var cls = lv.passRate === 1 ? 'good' : (lv.passRate >= 0.5 ? 'warn' : 'bad');
      return '<tr><td>' + lv.percent + '%</td><td class="' + cls + '">' + pct + '% (' + lv.trials.filter(function (t) { return t.ok; }).length + '/' + lv.trials.length + ')</td></tr>';
    });
    var bar = damageResult.passesPermanenceBar
      ? '<p class="good">PASS — survives at least 25% module corruption (max tolerated: ' + damageResult.maxTolerated + '%).</p>'
      : '<p class="bad">FAIL — does not survive 25% module corruption. Highest fully-tolerated level: ' + damageResult.maxTolerated + '%.</p>';
    return bar + '<table><thead><tr><th>Damage</th><th>Pass rate (3 trials)</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  }

  function build(qr, ctx) {
    ctx = ctx || {};
    var generatedAt = ctx.generatedAt || new Date().toISOString();
    var url = ctx.url || (typeof location !== 'undefined' ? location.href : '(unknown)');

    var sourceHashPromise = ctx.sourceHash
      ? Promise.resolve(ctx.sourceHash)
      : fetchSourceHash();

    return sourceHashPromise.then(function (sourceHash) {
      var ascii = moduleMatrixToAscii(qr);
      var hex = moduleMatrixToHex(qr);
      return ''
        + '<!doctype html>\n'
        + '<html lang="en">\n'
        + '<head>\n'
        + '<meta charset="utf-8">\n'
        + '<title>Tessera spec sheet — ' + escapeHtml(qr.text.slice(0, 50)) + '</title>\n'
        + '<style>\n'
        + '  body { font: 11pt/1.4 -apple-system, "Segoe UI", "Helvetica Neue", sans-serif; margin: 2cm; color: #111; }\n'
        + '  h1 { font-size: 22pt; margin: 0 0 0.4em; }\n'
        + '  h2 { font-size: 14pt; margin: 1.6em 0 0.3em; padding-bottom: 0.1em; border-bottom: 1px solid #ccc; }\n'
        + '  table { border-collapse: collapse; margin: 0.5em 0; }\n'
        + '  th, td { padding: 4px 10px 4px 0; text-align: left; vertical-align: top; }\n'
        + '  th { font-weight: 600; border-bottom: 1px solid #ccc; }\n'
        + '  code, pre { font: 9pt/1.3 ui-monospace, "SF Mono", Consolas, monospace; }\n'
        + '  pre { background: #f5f5f5; padding: 8px 12px; border: 1px solid #ddd; border-radius: 3px; white-space: pre; overflow: auto; }\n'
        + '  .muted { color: #777; }\n'
        + '  .good { color: #14753b; }\n'
        + '  .warn { color: #aa6e00; }\n'
        + '  .bad { color: #b00020; }\n'
        + '  .qr-grid { display: flex; flex-wrap: wrap; gap: 1cm; align-items: flex-end; margin: 0.5em 0; }\n'
        + '  .qr-grid figure { margin: 0; }\n'
        + '  .qr-grid figcaption { text-align: center; font-size: 9pt; color: #666; margin-top: 4px; }\n'
        + '  .meta { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }\n'
        + '  .meta dt { font-weight: 600; color: #555; }\n'
        + '  .meta dd { margin: 0; word-break: break-all; }\n'
        + '  @media print { @page { margin: 1.5cm; } h2 { page-break-after: avoid; } pre { page-break-inside: avoid; } }\n'
        + '</style>\n'
        + '</head>\n'
        + '<body>\n'
        + '<h1>Tessera — QR specification sheet</h1>\n'
        + '<p class="muted">Permanent tiles for a permanent mark. Print this page and file it with important documents.</p>\n'

        + '<h2>Encoded payload</h2>\n'
        + '<dl class="meta">\n'
        + '  <dt>Text</dt><dd><code>' + escapeHtml(qr.text) + '</code></dd>\n'
        + '  <dt>Length</dt><dd>' + qr.text.length + ' chars (' + new Blob([qr.text]).size + ' UTF-8 bytes)</dd>\n'
        + '</dl>\n'

        + '<h2>Encoding parameters</h2>\n'
        + '<dl class="meta">\n'
        + '  <dt>Version</dt><dd>' + qr.version + ' (' + qr.size + '×' + qr.size + ' modules)</dd>\n'
        + '  <dt>Error correction</dt><dd>Level ' + qr.ecLevel + ' (recovers up to ~' + ({L:7,M:15,Q:25,H:30})[qr.ecLevel] + '% damage)</dd>\n'
        + '  <dt>Mask pattern</dt><dd>' + qr.mask + '</dd>\n'
        + '  <dt>Mode</dt><dd>' + qr.mode + '</dd>\n'
        + '  <dt>Generated</dt><dd>' + escapeHtml(generatedAt) + '</dd>\n'
        + '  <dt>Generator</dt><dd>Tessera — <a href="' + escapeHtml(url) + '">' + escapeHtml(url) + '</a></dd>\n'
        + '  <dt>Source SHA-256</dt><dd><code>' + escapeHtml(sourceHash) + '</code></dd>\n'
        + '</dl>\n'

        + '<h2>Reference renderings (actual physical size)</h2>\n'
        + '<p class="muted">For the tattoo artist. Each version below is the same QR — choose the smallest that scans reliably for your skin and ink, then mark up the SVG file.</p>\n'
        + '<div class="qr-grid">\n'
        + '  <figure>' + svgAtCm(qr, 3) + '<figcaption>3 cm</figcaption></figure>\n'
        + '  <figure>' + svgAtCm(qr, 5) + '<figcaption>5 cm</figcaption></figure>\n'
        + '  <figure>' + svgAtCm(qr, 7) + '<figcaption>7 cm</figcaption></figure>\n'
        + '  <figure>' + svgAtCm(qr, 10) + '<figcaption>10 cm</figcaption></figure>\n'
        + '</div>\n'

        + '<h2>Round-trip verification</h2>\n'
        + renderVerifyHtml(ctx.verifyResult)

        + '<h2>Damage tolerance</h2>\n'
        + renderDamageHtml(ctx.damageResult)

        + '<h2>Module matrix — ASCII art</h2>\n'
        + '<p class="muted">Each module is two characters wide so the printed result is approximately square. ' + qr.size + '×' + qr.size + ' modules.</p>\n'
        + '<pre>' + escapeHtml(ascii) + '</pre>\n'

        + '<h2>Module matrix — hex dump</h2>\n'
        + '<p class="muted">Row-major, MSB-first within each byte. ' + Math.ceil(qr.size * qr.size / 8) + ' bytes total. To reconstruct: pack the matrix row by row into bits (1 = dark, 0 = light), top-left first, eight bits per byte, most significant bit first.</p>\n'
        + '<pre>' + escapeHtml(hex) + '</pre>\n'

        + '<h2>Reproduction instructions</h2>\n'
        + '<ol>\n'
        + '  <li>Visit the Tessera repository (linked from the URL above).</li>\n'
        + '  <li>Compute the SHA-256 of <code>src/qr.js</code> + <code>src/reed-solomon.js</code> concatenated and verify it matches the value above.</li>\n'
        + '  <li>Open <code>index.html</code> directly (no server required) and paste the encoded text into the input.</li>\n'
        + '  <li>Set EC level to <strong>' + qr.ecLevel + '</strong>. Tessera will pick the same version (' + qr.version + ') and the same mask (' + qr.mask + ') will be selected automatically by the lowest-penalty rule.</li>\n'
        + '  <li>If you need to reconstruct from this paper alone: read the hex dump above into a byte array, expand to bits row-by-row, and render as a ' + qr.size + '×' + qr.size + ' grid with at least a 4-module white quiet zone around it.</li>\n'
        + '</ol>\n'

        + '<p class="muted">Generated by Tessera. Open source: anyone can audit this generator and verify your QR is correctly encoded.</p>\n'
        + '</body></html>';
    });
  }

  function openInTab(qr, ctx) {
    return build(qr, ctx).then(function (html) {
      var blob = new Blob([html], { type: 'text/html' });
      var url = URL.createObjectURL(blob);
      var w = global.open(url, '_blank');
      // Revoke after a delay so the new window has time to load.
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      return w;
    });
  }

  T.SpecSheet = {
    build: build,
    openInTab: openInTab,
    moduleMatrixToAscii: moduleMatrixToAscii,
    moduleMatrixToHex: moduleMatrixToHex,
  };
})(typeof window !== 'undefined' ? window : globalThis);
