/* Tessera — printable archival spec sheet.
 *
 * Generates a self-contained HTML document that, if printed and stored, can
 * fully reconstruct the QR even if every digital file is lost. Includes:
 *
 *   - The QR rendered at the three tattoo-recommended physical sizes
 *   - The encoded URL in plain text
 *   - Version, EC level, mask number, module dimensions
 *   - Tattoo recommendations (min / recommended / conservative module sizes)
 *   - Generation timestamp
 *   - The full module matrix as ASCII art and as a hex dump
 *   - SHA-256 of the generator source code
 *   - Round-trip verification results
 *   - Blur-damage tolerance log
 *   - Reproduction instructions
 *
 * Public API:
 *   Tessera.SpecSheet.build(qr, ctx) -> Promise<string>
 *   Tessera.SpecSheet.openInTab(qr, ctx)
 *
 * ctx (all optional but recommended):
 *   verifyResult: result from Tessera.Verify.verify(...)
 *   damageResult: result from Tessera.Damage.test(...)  (sweep tolerance log)
 *   sourceHash:   precomputed SHA-256 hex string of the generator
 *   generatedAt:  ISO timestamp string (default = now)
 *   url:          URL of the live Tessera site that generated this
 */
(function (global) {
  'use strict';

  var T = global.Tessera = global.Tessera || {};

  var TATTOO_GRADES = [
    { id: 'min',  label: 'Minimum (still scans)',           mm: 0.7 },
    { id: 'rec',  label: 'Recommended',                     mm: 1.2 },
    { id: 'cons', label: 'Conservative (large, durable)',   mm: 1.8 },
  ];

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function moduleMatrixToAscii(qr) {
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
    var size = qr.size;
    var totalBits = size * size;
    var totalBytes = Math.ceil(totalBits / 8);
    var bytes = new Uint8Array(totalBytes);
    var bitIdx = 0;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (qr.modules[y][x]) bytes[bitIdx >> 3] |= 1 << (7 - (bitIdx & 7));
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
      var total = 0;
      buffers.forEach(function (b) { total += b.byteLength; });
      var combined = new Uint8Array(total);
      var off = 0;
      buffers.forEach(function (b) {
        combined.set(new Uint8Array(b), off);
        off += b.byteLength;
      });
      return sha256Hex(combined.buffer);
    }, function () { return '(could not fetch source files. Open spec sheet from the live site.)'; });
  }

  // Render the QR at a specific module size (in mm), as an SVG sized to print
  // at exactly that physical size (96 dpi web px).
  function svgAtModuleMm(qr, mmPerModule) {
    var moduleCount = qr.size + 8;
    var pxPerCm = 96 / 2.54;
    var pxPerModule = (mmPerModule / 10) * pxPerCm;
    return T.SVG.toString(qr, { moduleSize: pxPerModule, margin: 4 });
  }

  function fmtCm(mm)  { return (mm / 10).toFixed(1) + ' cm'; }
  function fmtMm(mm)  { return mm.toFixed(1).replace(/\.0$/, '') + ' mm'; }
  function fmtIn(mm)  { return (mm / 25.4).toFixed(2) + ' in'; }

  function renderTattooHtml(qr) {
    var modulesPerSide = qr.size + 8;
    var rows = TATTOO_GRADES.map(function (g) {
      var sideMm = modulesPerSide * g.mm;
      var cls = (g.id === 'rec') ? ' style="background: #fff7e6; border-left: 3px solid #c41e26;"' : '';
      return '<tr' + cls + '>'
        + '<td>' + g.label + '</td>'
        + '<td>' + fmtMm(g.mm) + ' / module</td>'
        + '<td><strong>' + fmtCm(sideMm) + '</strong> &nbsp; (' + fmtIn(sideMm) + ')</td>'
        + '</tr>';
    }).join('');
    return ''
      + '<p>Show the artist <strong>the recommended size</strong>. The module size is what determines whether a phone can read the tattoo and how durable it is to skin stretch and ink bleed. Bigger modules age much better; smaller modules will scan today but may not in twenty years.</p>'
      + '<table>'
      + '<thead><tr><th>Quality</th><th>Module size</th><th>Tattoo size (incl. quiet zone)</th></tr></thead>'
      + '<tbody>' + rows + '</tbody>'
      + '</table>'
      + '<p class="muted">Sizes are computed for this QR (v' + qr.version + ', ' + qr.size + '×' + qr.size + ' modules + 4-module white quiet zone on each side). The quiet zone is part of the spec; the artist must not crop it out.</p>';
  }

  function renderQRSizesHtml(qr) {
    var sections = TATTOO_GRADES.map(function (g) {
      return '<figure>' + svgAtModuleMm(qr, g.mm)
        + '<figcaption><strong>' + g.label + '</strong><br>' + fmtMm(g.mm) + ' / module &nbsp; (' + fmtCm((qr.size + 8) * g.mm) + ' total)</figcaption></figure>';
    }).join('\n');
    return '<div class="qr-grid">' + sections + '</div>';
  }

  function renderVerifyHtml(verifyResult) {
    if (!verifyResult) return '<p class="muted">No verification result attached.</p>';
    var rows = verifyResult.decoders.map(function (d) {
      if (!d.available) {
        return '<tr><td>' + escapeHtml(d.name) + '</td><td class="muted">not available in this browser</td><td>·</td></tr>';
      }
      if (!d.success) {
        return '<tr><td>' + escapeHtml(d.name) + '</td><td class="bad">FAIL: ' + escapeHtml(d.error || '') + '</td><td>·</td></tr>';
      }
      var statusCls = d.equals ? 'good' : 'bad';
      var statusText = d.equals ? 'OK · round-trip exact' : 'MISMATCH';
      return '<tr><td>' + escapeHtml(d.name) + '</td><td class="' + statusCls + '">' + statusText + '</td><td><code>' + escapeHtml(d.decoded) + '</code></td></tr>';
    });
    return '<table><thead><tr><th>Decoder</th><th>Status</th><th>Decoded text</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  }

  function renderDamageHtml(damageResult) {
    if (!damageResult) return '<p class="muted">No damage test result attached.</p>';
    var rows = damageResult.levels.map(function (lv) {
      var cls = lv.ok ? 'good' : 'bad';
      var verdict = lv.ok ? 'OK' : 'FAIL';
      return '<tr><td>' + lv.percent + '%</td><td class="' + cls + '">' + verdict + '</td></tr>';
    });
    var bar = damageResult.passesPermanenceBar
      ? '<p class="good">PASS. Survives gaussian blur up to <strong>' + damageResult.maxTolerated + '%</strong> on the Tessera scale (a single-trial decode at each level).</p>'
      : '<p class="bad">FAIL. Highest blur level still decoded: ' + damageResult.maxTolerated + '%.</p>';
    return bar
      + '<p class="muted">Blur model: gaussian convolution with radius = (severity / 100) &times; module-pixel-size &times; 0.5. 5% &asymp; a few-year-old tattoo, 15% &asymp; ~15-year-old tattoo with normal aging, 30% &asymp; severe ink bleed. See the permanence doctrine on the live site for why blur is the right model for tattoo aging.</p>'
      + '<table><thead><tr><th>Blur</th><th>Decoded</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
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
      var modulesPerSide = qr.size + 8;
      return ''
        + '<!doctype html>\n'
        + '<html lang="en">\n'
        + '<head>\n'
        + '<meta charset="utf-8">\n'
        + '<title>Tessera spec sheet · ' + escapeHtml(qr.text.slice(0, 50)) + '</title>\n'
        + '<style>\n'
        + '  body { font: 11pt/1.45 -apple-system, "Segoe UI", "Helvetica Neue", sans-serif; margin: 2cm; color: #111; }\n'
        + '  h1 { font-size: 22pt; margin: 0 0 0.2em; letter-spacing: -0.01em; }\n'
        + '  h2 { font-size: 13pt; margin: 1.6em 0 0.3em; padding-bottom: 0.1em; border-bottom: 1px solid #ccc; text-transform: uppercase; letter-spacing: 0.06em; }\n'
        + '  table { border-collapse: collapse; margin: 0.5em 0; }\n'
        + '  th, td { padding: 5px 12px 5px 0; text-align: left; vertical-align: top; }\n'
        + '  th { font-weight: 600; border-bottom: 1px solid #888; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.04em; }\n'
        + '  code, pre { font: 9pt/1.3 ui-monospace, "SF Mono", Consolas, monospace; }\n'
        + '  pre { background: #f5f5f5; padding: 8px 12px; border: 1px solid #ddd; border-radius: 3px; white-space: pre; overflow: auto; }\n'
        + '  .muted { color: #777; font-size: 10pt; }\n'
        + '  .good { color: #14753b; }\n'
        + '  .warn { color: #aa6e00; }\n'
        + '  .bad { color: #b00020; }\n'
        + '  .qr-grid { display: flex; flex-wrap: wrap; gap: 0.8cm; align-items: flex-end; margin: 0.5em 0 1em; }\n'
        + '  .qr-grid figure { margin: 0; max-width: 12cm; }\n'
        + '  .qr-grid figcaption { text-align: left; font-size: 9pt; color: #444; margin-top: 4px; }\n'
        + '  .meta { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }\n'
        + '  .meta dt { font-weight: 600; color: #555; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.04em; }\n'
        + '  .meta dd { margin: 0; word-break: break-all; }\n'
        + '  .credit { margin: 0; font-size: 9pt; color: #666; letter-spacing: 0.18em; text-transform: uppercase; border-left: 2px solid #c41e26; padding: 4px 0 4px 10px; }\n'
        + '  @media print { @page { margin: 1.5cm; } h2 { page-break-after: avoid; } pre { page-break-inside: avoid; } .qr-grid { page-break-inside: avoid; } }\n'
        + '</style>\n'
        + '</head>\n'
        + '<body>\n'
        + '<h1>Tessera · QR specification sheet</h1>\n'
        + '<p class="credit">a tessera by Maximilian Wikström · MMXXVI</p>\n'
        + '<p class="muted">Print this page and file it with important documents. The hex dump and ASCII matrix are sufficient to reconstruct the QR by hand if every digital file is lost.</p>\n'

        + '<h2>Encoded payload</h2>\n'
        + '<dl class="meta">\n'
        + '  <dt>Text</dt><dd><code>' + escapeHtml(qr.text) + '</code></dd>\n'
        + '  <dt>Length</dt><dd>' + qr.text.length + ' chars (' + new Blob([qr.text]).size + ' UTF-8 bytes)</dd>\n'
        + '</dl>\n'

        + '<h2>Encoding parameters</h2>\n'
        + '<dl class="meta">\n'
        + '  <dt>Version</dt><dd>' + qr.version + ' (' + qr.size + '×' + qr.size + ' modules)</dd>\n'
        + '  <dt>With quiet zone</dt><dd>' + modulesPerSide + '×' + modulesPerSide + ' modules wide (4-module quiet zone on each side)</dd>\n'
        + '  <dt>Error correction</dt><dd>Level ' + qr.ecLevel + ' (recovers up to ~' + ({L:7,M:15,Q:25,H:30})[qr.ecLevel] + '% of damaged modules)</dd>\n'
        + '  <dt>Mask pattern</dt><dd>' + qr.mask + '</dd>\n'
        + '  <dt>Mode</dt><dd>' + qr.mode + '</dd>\n'
        + '  <dt>Generated</dt><dd>' + escapeHtml(generatedAt) + '</dd>\n'
        + '  <dt>Generator</dt><dd>Tessera · <a href="' + escapeHtml(url) + '">' + escapeHtml(url) + '</a></dd>\n'
        + '  <dt>Source SHA-256</dt><dd><code>' + escapeHtml(sourceHash) + '</code></dd>\n'
        + '</dl>\n'

        + '<h2>Tattoo recommendations</h2>\n'
        + renderTattooHtml(qr)

        + '<h2>Reference renderings (actual physical size)</h2>\n'
        + '<p class="muted">Each is the same QR at a different module size. The recommended one (1.2 mm/module) is the right answer for most placements; pick a larger size for forearm/calf/back placements that you want to last decades.</p>\n'
        + renderQRSizesHtml(qr)

        + '<h2>Round-trip verification</h2>\n'
        + renderVerifyHtml(ctx.verifyResult)

        + '<h2>Blur tolerance (tattoo aging simulation)</h2>\n'
        + renderDamageHtml(ctx.damageResult)

        + '<h2>Module matrix · ASCII art</h2>\n'
        + '<p class="muted">Each module is two characters wide so the printed result is approximately square. ' + qr.size + '×' + qr.size + ' modules.</p>\n'
        + '<pre>' + escapeHtml(ascii) + '</pre>\n'

        + '<h2>Module matrix · hex dump</h2>\n'
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
