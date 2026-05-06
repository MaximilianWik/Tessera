/* Tessera — UI glue.
 *
 * Wires up the input field, live preview, verification readout, and download
 * controls. Defensive: download buttons stay disabled until verification
 * succeeds. The user cannot accidentally download a broken QR.
 */
(function () {
  'use strict';

  // -- DOM refs ----------------------------------------------------------------

  var $input        = document.getElementById('input-text');
  var $charCount    = document.getElementById('char-count');
  var $byteCount    = document.getElementById('byte-count');
  var $ecLevel      = document.getElementById('ec-level');
  var $previewWrap  = document.getElementById('preview-wrap');
  var $previewCanvas = document.getElementById('preview-canvas');
  var $metaVersion  = document.getElementById('meta-version');
  var $metaSize     = document.getElementById('meta-size');
  var $metaMask     = document.getElementById('meta-mask');
  var $metaEC       = document.getElementById('meta-ec');
  var $verifyList   = document.getElementById('verify-list');
  var $damageOut    = document.getElementById('damage-out');
  var $statusBadge  = document.getElementById('status-badge');
  var $btnPng       = document.getElementById('btn-png');
  var $btnSvg       = document.getElementById('btn-svg');
  var $btnSheet     = document.getElementById('btn-sheet');
  var $error        = document.getElementById('error');

  // -- State -------------------------------------------------------------------

  var currentQr = null;
  var currentVerify = null;
  var currentDamage = null;
  var encodeSeq = 0; // monotonic; used to ignore late async results

  // -- Helpers -----------------------------------------------------------------

  function setError(msg) {
    if (msg) {
      $error.textContent = msg;
      $error.hidden = false;
    } else {
      $error.textContent = '';
      $error.hidden = true;
    }
  }

  function setDownloadEnabled(enabled) {
    [$btnPng, $btnSvg, $btnSheet].forEach(function (b) {
      b.disabled = !enabled;
      b.title = enabled ? '' : 'Verification must pass before download';
    });
  }

  function setStatus(state, label) {
    // states: idle | encoding | verifying | ok | fail
    $statusBadge.dataset.state = state;
    $statusBadge.textContent = label;
  }

  function utf8Bytes(s) {
    return new TextEncoder().encode(s).length;
  }

  // -- Encode + verify pipeline -----------------------------------------------

  function run(text, ecLevel) {
    var seq = ++encodeSeq;
    setError(null);
    setDownloadEnabled(false);
    currentQr = null;
    currentVerify = null;
    currentDamage = null;

    if (!text) {
      setStatus('idle', 'Enter text');
      $previewWrap.hidden = true;
      $verifyList.innerHTML = '';
      $damageOut.innerHTML = '';
      $metaVersion.textContent = '—';
      $metaSize.textContent = '—';
      $metaMask.textContent = '—';
      $metaEC.textContent = '—';
      return;
    }

    setStatus('encoding', 'Encoding…');
    var qr;
    try {
      qr = Tessera.QR.encode(text, { ecLevel: ecLevel });
    } catch (e) {
      setStatus('fail', 'Encode failed');
      setError(e.message || String(e));
      $previewWrap.hidden = true;
      return;
    }
    if (seq !== encodeSeq) return;

    currentQr = qr;
    Tessera.PNG.renderInto($previewCanvas, qr, { moduleSize: Math.max(4, Math.floor(280 / (qr.size + 8))) });
    $previewWrap.hidden = false;
    $metaVersion.textContent = qr.version;
    $metaSize.textContent = qr.size + ' × ' + qr.size + ' modules';
    $metaMask.textContent = qr.mask;
    $metaEC.textContent = qr.ecLevel;

    // Show "verifying" placeholder while async work runs
    $verifyList.innerHTML = '<li class="muted">Decoding with each available decoder…</li>';
    $damageOut.innerHTML = '<p class="muted">Running damage tolerance trials…</p>';
    setStatus('verifying', 'Verifying…');

    Tessera.Verify.verify(qr, text).then(function (vr) {
      if (seq !== encodeSeq) return;
      currentVerify = vr;
      renderVerify(vr);
      // Damage test only runs if at least one decoder agreed.
      var anyAvailable = vr.decoders.some(function (d) { return d.available; });
      if (!anyAvailable) {
        $damageOut.innerHTML = '<p class="bad">No decoders available in this browser. Damage test skipped.</p>';
        setStatus('fail', 'No decoders available');
        return;
      }
      return Tessera.Damage.test(qr, text, { trialsPer: 5 }).then(function (dr) {
        if (seq !== encodeSeq) return;
        currentDamage = dr;
        renderDamage(dr);
        // Download gating is on round-trip verification only — that's the
        // hard correctness guarantee. Damage tolerance is reported as
        // additional information; the verified-encoder + at-least-this-much
        // damage tolerance is the full claim.
        if (vr.ok) {
          var redundancyLabel;
          if (vr.redundancy >= 3) redundancyLabel = '3 decoders';
          else if (vr.redundancy === 2) redundancyLabel = '2 decoders';
          else redundancyLabel = '1 decoder';
          var label = dr.passesPermanenceBar
            ? 'Verified · ' + redundancyLabel + ' · tolerates ' + dr.maxTolerated + '%'
            : 'Verified · ' + redundancyLabel;
          setStatus('ok', label);
          setDownloadEnabled(true);
        } else {
          setStatus('fail', 'Verification failed');
        }
      });
    }).catch(function (err) {
      if (seq !== encodeSeq) return;
      console.error('verification error', err);
      setError('Verification error: ' + (err && err.message || err));
      setStatus('fail', 'Verification error');
    });
  }

  function renderVerify(vr) {
    var html = vr.decoders.map(function (d) {
      if (!d.available) {
        return '<li class="muted"><strong>' + d.name + '</strong> — not available in this browser</li>';
      }
      if (!d.success) {
        return '<li class="bad"><strong>' + d.name + '</strong> — failed: ' + escape(d.error || '') + '</li>';
      }
      if (!d.equals) {
        return '<li class="bad"><strong>' + d.name + '</strong> — decoded mismatch: <code>' + escape(d.decoded) + '</code></li>';
      }
      return '<li class="good"><strong>' + d.name + '</strong> — round-trip exact</li>';
    }).join('');
    $verifyList.innerHTML = html;
  }

  function renderDamage(dr) {
    var bar;
    if (dr.passesPermanenceBar) {
      bar = '<p class="good"><strong>Pass.</strong> Survives at least 5% clustered damage. Max fully tolerated: ' + dr.maxTolerated + '%.</p>';
    } else {
      bar = '<p class="warn"><strong>Below permanence bar.</strong> Highest fully-tolerated damage: ' + dr.maxTolerated + '%. (5% is the bar.)</p>';
    }
    var rows = dr.levels.map(function (lv) {
      var pct = (lv.passRate * 100).toFixed(0) + '%';
      var cls = lv.passRate === 1 ? 'good' : (lv.passRate >= 0.5 ? 'warn' : 'bad');
      return '<tr><td>' + lv.percent + '%</td><td class="' + cls + '">' + pct + '</td></tr>';
    }).join('');
    $damageOut.innerHTML = bar + '<table class="damage-table"><thead><tr><th>Damage</th><th>Pass rate</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function escape(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // -- Download handlers -------------------------------------------------------

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function safeFilename(text, ext) {
    var slug = text.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '');
    if (!slug) slug = 'qr';
    var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return 'tessera-' + slug + '-' + stamp + '.' + ext;
  }

  $btnPng.addEventListener('click', function () {
    if (!currentQr) return;
    Tessera.PNG.toBlob(currentQr, { moduleSize: 16 }).then(function (blob) {
      downloadBlob(blob, safeFilename(currentQr.text, 'png'));
    });
  });

  $btnSvg.addEventListener('click', function () {
    if (!currentQr) return;
    var blob = Tessera.SVG.toBlob(currentQr, { moduleSize: 10 });
    downloadBlob(blob, safeFilename(currentQr.text, 'svg'));
  });

  $btnSheet.addEventListener('click', function () {
    if (!currentQr) return;
    Tessera.SpecSheet.openInTab(currentQr, {
      verifyResult: currentVerify,
      damageResult: currentDamage,
    });
  });

  // -- Input wiring ------------------------------------------------------------

  var debounceTimer = null;
  function scheduleRun() {
    var text = $input.value;
    var ecLevel = $ecLevel.value;
    $charCount.textContent = text.length;
    $byteCount.textContent = utf8Bytes(text);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { run(text, ecLevel); }, 200);
  }

  $input.addEventListener('input', scheduleRun);
  $ecLevel.addEventListener('change', scheduleRun);

  // Initial state
  setStatus('idle', 'Enter text');
  setDownloadEnabled(false);
  scheduleRun();
})();
