/* Tessera — damage tolerance tests.
 *
 * For a small set of representative QRs, verify that they survive the
 * permanence bar of 5% clustered damage. See src/damage.js for why this is
 * the right bar (it's the empirical floor across all QR sizes; larger QRs
 * tolerate considerably more).
 */
(function () {
  'use strict';

  var CASES = [
    { text: 'https://example.com', ec: 'H' },
    { text: 'https://en.wikipedia.org/wiki/QR_code', ec: 'H' },
    { text: 'mailto:test@example.com', ec: 'H' },
    { text: 'Hello, World!', ec: 'H' },
    { text: 'https://example.com', ec: 'Q' },
  ];

  function register(runner) {
    runner.suite('Damage tolerance — survives 5% clustered corruption', function (s) {
      CASES.forEach(function (c) {
        s.testAsync('"' + abbrev(c.text) + '" @ ' + c.ec + ' tolerates ≥5%', function () {
          var qr = Tessera.QR.encode(c.text, { ecLevel: c.ec });
          // Use a fixed seed for reproducibility
          return Tessera.Damage.test(qr, c.text, { trialsPer: 5, seed: 0xC0FFEE }).then(function (dr) {
            s.assert(
              dr.passesPermanenceBar,
              'expected to tolerate ≥5%, but max tolerated was ' + dr.maxTolerated + '%' +
                '\n  level breakdown: ' + JSON.stringify(dr.levels.map(function (l) {
                  return l.percent + '%=' + (l.passRate * 100).toFixed(0) + '%';
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
