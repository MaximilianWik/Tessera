/* Tessera — damage tolerance tests.
 *
 * For a small set of representative QRs, verify that they survive the
 * permanence bar of 5% blur damage (see src/damage-preview.js for why blur
 * is the right model for tattoo aging, and why 5% is the empirical floor).
 */
(function () {
  'use strict';

  var CASES = [
    { text: 'http://max-wik.com/', ec: 'H' },
    { text: 'https://en.wikipedia.org/wiki/QR_code', ec: 'H' },
    { text: 'mailto:test@example.com', ec: 'H' },
    { text: 'Hello, World!', ec: 'H' },
    { text: 'http://max-wik.com/', ec: 'Q' },
  ];

  function register(runner) {
    runner.suite('Damage tolerance — survives 5% blur', function (s) {
      CASES.forEach(function (c) {
        s.testAsync('"' + abbrev(c.text) + '" @ ' + c.ec + ' tolerates ≥5% blur', function () {
          var qr = Tessera.QR.encode(c.text, { ecLevel: c.ec });
          return Tessera.Damage.test(qr, c.text).then(function (dr) {
            s.assert(
              dr.passesPermanenceBar,
              'expected to tolerate ≥5% blur, but max tolerated was ' + dr.maxTolerated + '%' +
                '\n  level breakdown: ' + JSON.stringify(dr.levels.map(function (l) {
                  return l.percent + '%=' + (l.ok ? 'OK' : 'FAIL');
                }))
            );
          });
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
