/* Tessera: UI glue for the generator page.
 *
 * Wires the input field, live preview, verification readout, damage
 * tolerance preview (slider + level buttons + canvas), damage tolerance
 * stats, and download controls. Defensive: download buttons stay disabled
 * until verification succeeds. The user cannot accidentally download a
 * broken QR.
 */
(function () {
  'use strict';

  // -- DOM refs ----------------------------------------------------------------

  var $input         = document.getElementById('input-text');
  var $charCount     = document.getElementById('char-count');
  var $byteCount     = document.getElementById('byte-count');
  var $ecLevel       = document.getElementById('ec-level');
  var $previewWrap   = document.getElementById('preview-wrap');
  var $previewCanvas = document.getElementById('preview-canvas');
  var $metaVersion   = document.getElementById('meta-version');
  var $metaSize      = document.getElementById('meta-size');
  var $metaMask      = document.getElementById('meta-mask');
  var $metaEC        = document.getElementById('meta-ec');
  var $verifyList    = document.getElementById('verify-list');
  var $damageOut     = document.getElementById('damage-out');
  var $statusBadge   = document.getElementById('status-badge');
  var $btnPng        = document.getElementById('btn-png');
  var $btnSvg        = document.getElementById('btn-svg');
  var $btnSheet      = document.getElementById('btn-sheet');
  var $error         = document.getElementById('error');

  // Damage preview controls
  var $damageWrap    = document.getElementById('damage-canvas-wrap');
  var $damageCanvas  = document.getElementById('damage-canvas');
  var $damageVerdict = document.getElementById('damage-verdict');
  var $damagePct     = document.getElementById('damage-pct');
  var $damageStatus  = document.getElementById('damage-status');
  var $damageDecoded = document.getElementById('damage-decoded');
  var $damageSlider  = document.getElementById('damage-slider');
  var $damageLevels  = document.getElementById('damage-levels');

  // -- State -------------------------------------------------------------------

  var currentQr      = null;
  var currentVerify  = null;
  var currentDamage  = null;
  var encodeSeq      = 0;          // monotonic; ignore late async results
  var damageLevel    = 5;          // current preview level (%)
  var damageSeq      = 0;          // monotonic for damage decode jobs

  // -- Helpers -----------------------------------------------------------------

  function setError(msg) {
    if (msg) { $error.textContent = msg; $error.hidden = false; }
    else { $error.textContent = ''; $error.hidden = true; }
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

  function utf8Bytes(s) { return new TextEncoder().encode(s).length; }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
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
      $metaVersion.textContent = '·';
      $metaSize.textContent = '·';
      $metaMask.textContent = '·';
      $metaEC.textContent = '·';
      $damageWrap.hidden = true;
      $damagePct.textContent = '0%';
      $damageStatus.textContent = 'awaiting input';
      $damageDecoded.textContent = '·';
      $damageDecoded.classList.remove('ok', 'fail');
      $damageVerdict.dataset.state = 'idle';
      $damageVerdict.textContent = '·';
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
      $damageWrap.hidden = true;
      return;
    }
    if (seq !== encodeSeq) return;

    currentQr = qr;
    Tessera.PNG.renderInto($previewCanvas, qr, {
      moduleSize: Math.max(4, Math.floor(280 / (qr.size + 8))),
    });
    $previewWrap.hidden = false;
    $metaVersion.textContent = qr.version;
    $metaSize.textContent = qr.size + ' × ' + qr.size + ' modules';
    $metaMask.textContent = qr.mask;
    $metaEC.textContent = qr.ecLevel;

    // Show damage preview at the currently selected level
    $damageWrap.hidden = false;
    refreshDamagePreview();

    // Show "verifying" placeholder while async work runs
    $verifyList.innerHTML = '<li class="muted">Decoding with each available decoder…</li>';
    $damageOut.innerHTML = '<p class="muted small">Running damage tolerance trials…</p>';
    setStatus('verifying', 'Verifying…');

    Tessera.Verify.verify(qr, text).then(function (vr) {
      if (seq !== encodeSeq) return;
      currentVerify = vr;
      renderVerify(vr);
      var anyAvailable = vr.decoders.some(function (d) { return d.available; });
      if (!anyAvailable) {
        $damageOut.innerHTML = '<p class="bad small">No decoders available in this browser. Damage test skipped.</p>';
        setStatus('fail', 'No decoders');
        return;
      }
      return Tessera.Damage.test(qr, text, { trialsPer: 5 }).then(function (dr) {
        if (seq !== encodeSeq) return;
        currentDamage = dr;
        renderDamage(dr);
        if (vr.ok) {
          var redundancy = vr.redundancy >= 3 ? '3 decoders'
                         : vr.redundancy === 2 ? '2 decoders' : '1 decoder';
          var label = dr.passesPermanenceBar
            ? 'Verified · ' + redundancy + ' · ' + dr.maxTolerated + '%'
            : 'Verified · ' + redundancy;
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
        return '<li class="muted"><strong>' + d.name + '</strong> not available</li>';
      }
      if (!d.success) {
        return '<li class="bad"><strong>' + d.name + '</strong> failed · ' + escapeHtml(d.error || '') + '</li>';
      }
      if (!d.equals) {
        return '<li class="bad"><strong>' + d.name + '</strong> mismatch · <code>' + escapeHtml(d.decoded) + '</code></li>';
      }
      return '<li class="good"><strong>' + d.name + '</strong> round-trip exact</li>';
    }).join('');
    $verifyList.innerHTML = html;
  }

  function renderDamage(dr) {
    var bar;
    if (dr.passesPermanenceBar) {
      bar = '<p class="good small"><strong>PASS.</strong> Tolerates at least 5% clustered damage. Max fully tolerated: <strong>' + dr.maxTolerated + '%</strong>.</p>';
    } else {
      bar = '<p class="warn small"><strong>BELOW BAR.</strong> Highest fully-tolerated damage: ' + dr.maxTolerated + '%. (Bar is 5%.)</p>';
    }
    var rows = dr.levels.map(function (lv) {
      var pct = (lv.passRate * 100).toFixed(0) + '%';
      var cls = lv.passRate === 1 ? 'good' : (lv.passRate >= 0.5 ? 'warn' : 'bad');
      return '<tr><td>' + lv.percent + '%</td><td class="' + cls + '">' + pct + '</td></tr>';
    }).join('');
    $damageOut.innerHTML = bar
      + '<table class="damage-table"><thead><tr><th>damage</th><th>pass rate</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  // -- Damage preview wiring --------------------------------------------------

  function setDamageLevel(percent, source) {
    damageLevel = Math.max(0, Math.min(30, percent | 0));

    // Sync slider
    if (source !== 'slider') {
      $damageSlider.value = damageLevel;
    }
    // Sync level buttons (snap to nearest preset for the active style only)
    var presets = Tessera.DamagePreview.LEVELS;
    var nearest = presets.reduce(function (a, b) {
      return Math.abs(b - damageLevel) < Math.abs(a - damageLevel) ? b : a;
    });
    $damageLevels.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', parseInt(b.dataset.level, 10) === nearest && damageLevel === nearest);
    });

    refreshDamagePreview();
  }

  function refreshDamagePreview() {
    if (!currentQr) {
      $damagePct.textContent = damageLevel + '%';
      $damageStatus.textContent = 'awaiting input';
      $damageDecoded.textContent = '·';
      $damageDecoded.classList.remove('ok', 'fail');
      $damageVerdict.dataset.state = 'idle';
      $damageVerdict.textContent = '·';
      return;
    }
    // Sync canvas size to fit the current QR
    var moduleSize = Math.max(4, Math.floor(320 / (currentQr.size + 8)));
    Tessera.DamagePreview.renderDamaged($damageCanvas, currentQr, damageLevel, { moduleSize: moduleSize });
    $damagePct.textContent = damageLevel + '%';
    $damageStatus.textContent = 'decoding…';
    $damageVerdict.dataset.state = 'verifying';
    $damageVerdict.textContent = 'decoding…';
    $damageDecoded.classList.remove('ok', 'fail');
    $damageDecoded.textContent = '…';

    var seq = ++damageSeq;
    var expected = currentQr.text;
    Tessera.DamagePreview.decodeDamaged(currentQr, damageLevel, expected).then(function (res) {
      if (seq !== damageSeq) return;
      if (res.ok) {
        $damageStatus.innerHTML = '<span class="good">decoded · matches input</span>';
        $damageVerdict.dataset.state = 'ok';
        $damageVerdict.textContent = 'SCAN OK';
        $damageDecoded.classList.add('ok');
        $damageDecoded.textContent = res.decoded || expected;
      } else if (res.decoded) {
        $damageStatus.innerHTML = '<span class="bad">read MISMATCH</span>';
        $damageVerdict.dataset.state = 'fail';
        $damageVerdict.textContent = 'WRONG TEXT';
        $damageDecoded.classList.add('fail');
        $damageDecoded.textContent = '⚠ ' + res.decoded;
      } else {
        $damageStatus.innerHTML = '<span class="bad">no decoder could read it</span>';
        $damageVerdict.dataset.state = 'fail';
        $damageVerdict.textContent = 'UNREADABLE';
        $damageDecoded.classList.add('fail');
        $damageDecoded.textContent = '// scan failed //';
      }
    }).catch(function (err) {
      if (seq !== damageSeq) return;
      console.error('damage preview decode error', err);
      $damageVerdict.dataset.state = 'fail';
      $damageVerdict.textContent = 'ERROR';
      $damageStatus.textContent = String(err.message || err);
    });
  }

  // -- Download handlers -------------------------------------------------------

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
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

  // -- Damage controls wiring --------------------------------------------------

  $damageLevels.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-level]');
    if (!btn) return;
    setDamageLevel(parseInt(btn.dataset.level, 10), 'button');
  });

  $damageSlider.addEventListener('input', function () {
    setDamageLevel(parseInt($damageSlider.value, 10), 'slider');
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
  setDamageLevel(damageLevel, 'init');
  scheduleRun();
})();
