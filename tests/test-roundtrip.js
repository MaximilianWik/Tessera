/* Tessera — round-trip tests.
 *
 * For each of a curated test corpus, encode the string and verify that every
 * available decoder reads it back unchanged. This is the definitive
 * cross-implementation check: if our encoder produces something three
 * independent decoders all decode to the input, our encoder is correct.
 */
(function () {
  'use strict';

  var CORPUS = [
    // Common URLs at various lengths
    'https://example.com',
    'https://example.com/',
    'https://en.wikipedia.org/wiki/QR_code',
    'https://example.com/very/long/path/with/many/segments?query=value&another=thing#fragment',
    // Plain text
    'Hello, World!',
    'The quick brown fox jumps over the lazy dog.',
    // Single character (smallest possible byte mode payload)
    'a',
    // ASCII boundary cases
    '!@#$%^&*()_+-={}[]|\\:;"\'<>,.?/`~',
    // UTF-8 multi-byte
    'Café résumé naïve',                      // Latin-1 supplement (2-byte UTF-8)
    'Ω≈ç√∫˜µ≤≥÷',                              // various symbols (multi-byte)
    '日本語のテスト',                            // Japanese (3-byte UTF-8)
    '🎉 émoji + UTF-8 ✨',                       // 4-byte UTF-8 (surrogate pairs)
    // Numbers
    '1234567890',
    // Mixed
    'order #12345 — €99.99',
    // mailto / tel schemes (common QR uses)
    'mailto:test@example.com?subject=Hi',
    'tel:+1-555-123-4567',
    // Fairly long input (~ should push to v6+ at level H)
    'https://example.com/api/v2/users/12345/orders/abcdef-1234-5678-90ab-cdef01234567',
  ];

  var EC_LEVELS_TO_TEST = ['L', 'M', 'Q', 'H'];

  function register(runner) {
    runner.suite('Round-trip — every available decoder reads back the input', function (s) {
      // Make one test case per (input, ecLevel) combo. We don't await all
      // at once because we want incremental UI updates.
      CORPUS.forEach(function (text) {
        EC_LEVELS_TO_TEST.forEach(function (ec) {
          s.testAsync('"' + abbrev(text) + '" @ ' + ec, function () {
            var qr = Tessera.QR.encode(text, { ecLevel: ec });
            return Tessera.Verify.verify(qr, text).then(function (vr) {
              if (!vr.ok) {
                throw new Error(
                  'verification failed (redundancy=' + vr.redundancy + '): ' +
                    vr.decoders.map(function (d) {
                      return d.name + ': ' + (!d.available ? 'not available'
                        : d.success ? (d.equals ? 'OK' : 'WRONG: ' + JSON.stringify(d.decoded))
                        : ('FAIL — ' + (d.error || '')));
                    }).join(' | ')
                );
              }
            });
          });
        });
      });
    });

    runner.suite('Edge cases', function (s) {
      s.test('Empty string is handled', function () {
        // Empty is technically valid but useless. We allow it.
        var qr = Tessera.QR.encode('', { ecLevel: 'L' });
        s.assertEq(qr.version, 1);
      });

      s.test('Each EC level produces a different matrix for same input', function () {
        var qrL = Tessera.QR.encode('https://example.com', { ecLevel: 'L' });
        var qrH = Tessera.QR.encode('https://example.com', { ecLevel: 'H' });
        // They might end up at different versions, which makes them trivially different.
        // But same data at L vs H must produce different bytestreams in any case:
        var diff = false;
        var minSize = Math.min(qrL.size, qrH.size);
        for (var y = 0; y < minSize; y++) {
          for (var x = 0; x < minSize; x++) {
            if (qrL.modules[y][x] !== qrH.modules[y][x]) { diff = true; break; }
          }
          if (diff) break;
        }
        s.assert(diff, 'L and H must differ');
      });

      s.test('Forced mask 0 differs from forced mask 7', function () {
        var qr0 = Tessera.QR.encode('test', { ecLevel: 'M', mask: 0 });
        var qr7 = Tessera.QR.encode('test', { ecLevel: 'M', mask: 7 });
        s.assertEq(qr0.mask, 0);
        s.assertEq(qr7.mask, 7);
        // Same version and size, but matrices must differ
        s.assertEq(qr0.size, qr7.size);
        var differs = false;
        for (var y = 0; y < qr0.size; y++) {
          for (var x = 0; x < qr0.size; x++) {
            if (qr0.modules[y][x] !== qr7.modules[y][x]) { differs = true; break; }
          }
          if (differs) break;
        }
        s.assert(differs, 'different masks must produce different matrices');
      });

      s.testAsync('Forced version 7 includes valid version-info bits', function () {
        // Versions ≥ 7 carry extra version-info blocks. Round-trip-decoding it
        // implicitly confirms the version-info bits are valid.
        var qr = Tessera.QR.encode('https://example.com', { ecLevel: 'H', forceVersion: 7 });
        s.assertEq(qr.version, 7);
        return Tessera.Verify.verify(qr, 'https://example.com').then(function (vr) {
          s.assert(vr.ok, 'v7 round-trip must succeed');
        });
      });
    });
  }

  function abbrev(s) {
    if (s.length <= 30) return s;
    return s.slice(0, 27) + '…';
  }

  if (typeof window !== 'undefined' && window.__tesseraTestRegister) {
    window.__tesseraTestRegister(register);
  } else if (typeof window !== 'undefined') {
    window.__tesseraTestSuites = window.__tesseraTestSuites || [];
    window.__tesseraTestSuites.push(register);
  }
})();
