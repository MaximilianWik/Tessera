/* Tessera: UI glue for the generator page.
 *
 * Wires:
 *   - Input field (URL/text + EC level)
 *   - Live preview canvas with metadata
 *   - Round-trip verification readout
 *   - Damage preview with INLINE tolerance log (blur model)
 *   - Tattoo recommendations panel
 *   - Download controls (locked until verification passes)
 *
 * Defensive: download buttons stay disabled until verification succeeds.
 * The user cannot accidentally download a broken QR.
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
  var $statusBadge   = document.getElementById('status-badge');
  var $btnPng        = document.getElementById('btn-png');
  var $btnSvg        = document.getElementById('btn-svg');
  var $btnSheet      = document.getElementById('btn-sheet');
  var $error         = document.getElementById('error');

  // Damage preview controls + inline tolerance log
  var $damageWrap    = document.getElementById('damage-canvas-wrap');
  var $damageCanvas  = document.getElementById('damage-canvas');
  var $damageVerdict = document.getElementById('damage-verdict');
  var $damagePct     = document.getElementById('damage-pct');
  var $damageStatus  = document.getElementById('damage-status');
  var $damageDecoded = document.getElementById('damage-decoded');
  var $damageDecoders = document.getElementById('damage-decoders');
  var $damageSlider  = document.getElementById('damage-slider');
  var $damageLevels  = document.getElementById('damage-levels');
  var $toleranceLog  = document.getElementById('tolerance-log');

  // Tattoo recommendations
  var $tattooStatus  = document.getElementById('tattoo-status');
  var $tattooRecs    = document.getElementById('tattoo-recs');

  // -- State -------------------------------------------------------------------

  var currentQr      = null;
  var currentVerify  = null;
  var currentTolerance = null;       // { levels, maxTolerated, passesPermanenceBar }
  var encodeSeq      = 0;            // monotonic; ignore late async results
  var damageLevel    = 5;            // current preview level (%)
  var damageSeq      = 0;            // monotonic for damage decode jobs

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
    currentTolerance = null;

    if (!text) {
      setStatus('idle', 'Enter text');
      $previewWrap.hidden = true;
      $verifyList.innerHTML = '';
      $toleranceLog.innerHTML = '';
      $tattooRecs.innerHTML = '';
      $tattooStatus.textContent = 'awaiting input';
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
      if ($damageDecoders) $damageDecoders.innerHTML = '';
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
    // Render preview + damage canvases at the SAME module size so they line
    // up visually on desktop. The damage panel's internal grid puts its
    // canvas at the same x-position as the output panel's canvas; matching
    // sizes makes that alignment readable.
    var canvasModuleSize = Math.max(6, Math.floor(280 / (qr.size + 8)));
    Tessera.PNG.renderInto($previewCanvas, qr, { moduleSize: canvasModuleSize });
    $previewWrap.hidden = false;
    $metaVersion.textContent = qr.version;
    $metaSize.textContent = qr.size + ' × ' + qr.size + ' modules';
    $metaMask.textContent = qr.mask;
    $metaEC.textContent = qr.ecLevel;

    // Show damage preview at the currently selected level
    $damageWrap.hidden = false;
    refreshDamagePreview();

    // Render tattoo recommendations (synchronous, derived from qr only)
    renderTattooRecs(qr, ecLevel);

    // Show "verifying" placeholder while async work runs
    $verifyList.innerHTML = '<li class="muted">Decoding with each available decoder…</li>';
    $toleranceLog.innerHTML = '<p class="muted small">Sweeping blur tolerance at all levels…</p>';
    setStatus('verifying', 'Verifying…');

    Tessera.Verify.verify(qr, text).then(function (vr) {
      if (seq !== encodeSeq) return;
      currentVerify = vr;
      renderVerify(vr);
      var anyAvailable = vr.decoders.some(function (d) { return d.available; });
      if (!anyAvailable) {
        $toleranceLog.innerHTML = '<p class="bad small">No decoders available in this browser. Tolerance sweep skipped.</p>';
        setStatus('fail', 'No decoders');
        return;
      }
      return Tessera.DamagePreview.sweepTolerance(qr, text).then(function (sweep) {
        if (seq !== encodeSeq) return;
        currentTolerance = sweep;
        renderToleranceLog(sweep);
        if (vr.ok) {
          var redundancy = vr.redundancy >= 3 ? '3 decoders'
                         : vr.redundancy === 2 ? '2 decoders' : '1 decoder';
          var label = sweep.passesPermanenceBar
            ? 'Verified · ' + redundancy + ' · blur ≤' + sweep.maxTolerated + '%'
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

  function renderToleranceLog(sweep) {
    var bar;
    if (sweep.passesPermanenceBar) {
      bar = '<p class="good small mt-0"><strong>PASS.</strong> Tolerates blur up to <strong>' + sweep.maxTolerated + '%</strong>.</p>';
    } else {
      bar = '<p class="warn small mt-0"><strong>BELOW BAR.</strong> Highest blur tolerated: <strong>' + sweep.maxTolerated + '%</strong>.</p>';
    }
    var rows = sweep.levels.map(function (lv) {
      var cls = lv.percent === damageLevel ? 'active' : '';
      var verdict = lv.ok
        ? '<span class="good">OK</span>'
        : '<span class="bad">FAIL</span>';
      return '<tr class="' + cls + '"><td>' + lv.percent + '%</td><td>' + verdict + '</td></tr>';
    }).join('');
    $toleranceLog.innerHTML = bar
      + '<table class="damage-table"><thead><tr><th>blur</th><th>scan</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  // -- Tattoo recommendations -------------------------------------------------

  // Module size guidance, in millimetres per module.
  //   Min:    smallest size still reliably scannable on a phone (~0.7 mm)
  //   Rec:    Tessera's recommended size — robust to a decade of normal blur
  //   Cons:   conservative, ages best, much more forgiving of misink
  var GRADES = [
    { id: 'min',  label: 'Minimum (still scans)',           mm: 0.7, hint: 'Smallest size that still reliably scans on a phone today. Ages worst.' },
    { id: 'rec',  label: 'Recommended (ASK FOR THIS)',      mm: 1.2, hint: 'Tessera\'s recommended size. Comfortable to scan, ages well, fits most placements.' },
    { id: 'cons', label: 'Conservative (large, durable)',   mm: 1.8, hint: 'Most forgiving to ink bleed and skin stretch. Best choice for forearm, calf, back.' },
  ];

  function fmtCm(mm)  { return (mm / 10).toFixed(1) + ' cm'; }
  function fmtMm(mm)  { return mm.toFixed(1).replace(/\.0$/, '') + ' mm'; }
  function fmtIn(mm)  { return (mm / 25.4).toFixed(2) + ' in'; }

  function renderTattooRecs(qr, ecLevel) {
    var modulesPerSide = qr.size + 8; // including 4-module quiet zone each side
    var optimal = Tessera.QR.findTattooOptimal(qr.text);
    var isOptimal = optimal && (qr.version === optimal.version) && (qr.ecLevel === optimal.ecLevel);

    var rows = GRADES.map(function (g) {
      var sideMm = modulesPerSide * g.mm;
      var cls = (g.id === 'rec') ? ' class="rec"' : '';
      return '<tr' + cls + '>'
        + '<td><strong>' + g.label + '</strong><br><span class="muted small">' + g.hint + '</span></td>'
        + '<td>' + fmtMm(g.mm) + '</td>'
        + '<td><strong>' + fmtCm(sideMm) + '</strong> <span class="muted small">(' + fmtIn(sideMm) + ')</span></td>'
        + '</tr>';
    }).join('');

    if (isOptimal) {
      $tattooStatus.innerHTML = '<span class="good small">✓ tattoo-optimized</span>';
    } else {
      $tattooStatus.innerHTML = '<span class="warn small">smaller QR available</span>';
    }

    var optimalCallout = '';
    if (optimal && !isOptimal) {
      // Compute module size delta at the recommended (1.2 mm) target.
      var currentSideMm = modulesPerSide * 1.2;
      var optimalModulesPerSide = optimal.version * 4 + 17 + 8; // size = 4V+17, plus quiet zone
      var optimalSideMm = optimalModulesPerSide * 1.2;
      var moduleSizePctBigger = ((modulesPerSide / optimalModulesPerSide) - 1) * 100;
      optimalCallout =
        '<div class="optimal-callout">' +
        '  <div class="optimal-callout__head">' +
        '    <strong>Smaller QR available · v' + optimal.version + ' / level ' + optimal.ecLevel + '</strong>' +
        '    <button id="btn-apply-optimal" type="button" class="btn btn--primary btn--small">Apply</button>' +
        '  </div>' +
        '  <p class="muted small">Your current settings encode this URL as <strong>v' + qr.version + ' / level ' + qr.ecLevel + '</strong> (' + qr.size + '×' + qr.size + ' modules). Switching to <strong>v' + optimal.version + ' / level ' + optimal.ecLevel + '</strong> (' + (optimalModulesPerSide - 8) + '×' + (optimalModulesPerSide - 8) + ' modules) gives <strong>' + moduleSizePctBigger.toFixed(0) + '% bigger modules</strong> at the same physical tattoo size, in exchange for <strong>' + recoveryDelta(qr.ecLevel, optimal.ecLevel) + '</strong> error correction.</p>' +
        '  <p class="muted small">For tattoos this is usually the right trade: the dominant failure mode is blur, not localized damage, and bigger modules survive blur far better than higher EC at smaller modules.</p>' +
        '</div>';
    }

    $tattooRecs.innerHTML =
      optimalCallout +
      '<dl class="meta-grid">' +
      '  <dt>Version</dt><dd>v' + qr.version + ' · ' + qr.size + '×' + qr.size + ' modules</dd>' +
      '  <dt>With quiet zone</dt><dd>' + modulesPerSide + '×' + modulesPerSide + ' modules wide</dd>' +
      '  <dt>EC level</dt><dd>' + ecLevel + ' · recovers ~' + ECPCT[ecLevel] + '% of corrupted modules</dd>' +
      '</dl>' +
      '<table class="tattoo-table mt-4"><thead><tr><th>Quality</th><th>Module</th><th>Tattoo size</th></tr></thead><tbody>'
      + rows
      + '</tbody></table>'
      + '<p class="muted small mt-2">Show the artist the recommended <strong>' + fmtCm(modulesPerSide * 1.2) + '</strong> size. Smaller is harder to scan and ages worse. Bigger is fine. The quiet zone (white margin) is part of the spec; the artist must not crop it out.</p>';

    // Wire apply button if shown
    var $apply = document.getElementById('btn-apply-optimal');
    if ($apply) {
      $apply.addEventListener('click', function () {
        $ecLevel.value = optimal.ecLevel;
        scheduleRun();
      });
    }
  }

  var ECPCT = { L: 7, M: 15, Q: 25, H: 30 };

  function recoveryDelta(fromLevel, toLevel) {
    var diff = ECPCT[fromLevel] - ECPCT[toLevel];
    if (diff > 0) return diff + '% less';
    if (diff < 0) return (-diff) + '% more';
    return 'the same';
  }

  // -- Damage preview wiring --------------------------------------------------

  function setDamageLevel(percent, source) {
    damageLevel = Math.max(0, Math.min(30, percent | 0));
    if (source !== 'slider') $damageSlider.value = damageLevel;
    var presets = Tessera.DamagePreview.LEVELS;
    var nearest = presets.reduce(function (a, b) {
      return Math.abs(b - damageLevel) < Math.abs(a - damageLevel) ? b : a;
    });
    $damageLevels.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', parseInt(b.dataset.level, 10) === nearest && damageLevel === nearest);
    });
    // Re-render tolerance log so the "active" row marker follows the level
    if (currentTolerance) renderToleranceLog(currentTolerance);
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
      $damageDecoders.innerHTML = '';
      return;
    }
    // Use the same module size as the output preview so the two canvases
    // visually match. Both end up in the left column of a 2-col internal grid.
    var moduleSize = Math.max(6, Math.floor(280 / (currentQr.size + 8)));
    Tessera.DamagePreview.renderBlurred($damageCanvas, currentQr, damageLevel, { moduleSize: moduleSize });
    $damagePct.textContent = damageLevel + '%';
    $damageStatus.textContent = 'decoding…';
    $damageVerdict.dataset.state = 'verifying';
    $damageVerdict.textContent = 'decoding…';
    $damageDecoded.classList.remove('ok', 'fail');
    $damageDecoded.textContent = '…';
    if ($damageDecoders) $damageDecoders.innerHTML = '<li class="muted">checking decoders…</li>';

    var seq = ++damageSeq;
    var expected = currentQr.text;
    Tessera.DamagePreview.decodeBlurred(currentQr, damageLevel, expected, { moduleSize: moduleSize }).then(function (res) {
      if (seq !== damageSeq) return;
      renderDamageDecoders(res.decoders, expected);
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

  function renderDamageDecoders(decoders, expectedText) {
    if (!$damageDecoders) return;
    var html = decoders.map(function (d) {
      if (!d.available) {
        return '<li class="muted"><strong>' + d.name + '</strong> not available</li>';
      }
      if (!d.success) {
        return '<li class="bad"><strong>' + d.name + '</strong> can\'t read it</li>';
      }
      if (d.decoded !== expectedText) {
        return '<li class="bad"><strong>' + d.name + '</strong> mismatch</li>';
      }
      return '<li class="good"><strong>' + d.name + '</strong> reads exact</li>';
    }).join('');
    $damageDecoders.innerHTML = html;
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
      damageResult: currentTolerance,
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
