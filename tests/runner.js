/* Tessera — minimal browser test framework.
 *
 * Usage:
 *   const t = new Tessera.TestRunner(rootElement);
 *   t.suite('My suite', function (s) {
 *     s.test('does the thing', function () {
 *       s.assert(1 + 1 === 2, '1 + 1 should be 2');
 *     });
 *     s.testAsync('does async thing', async function () {
 *       const x = await foo();
 *       s.assert(x === 42);
 *     });
 *   });
 *   t.run();   // returns Promise<{passed, failed, skipped}>
 */
(function (global) {
  'use strict';

  var T = global.Tessera = global.Tessera || {};

  function TestRunner(rootEl) {
    this.root = rootEl;
    this.suites = [];
  }

  TestRunner.prototype.suite = function (name, fn) {
    var suite = new Suite(name);
    fn(suite);
    this.suites.push(suite);
  };

  TestRunner.prototype.run = function () {
    var self = this;
    var totals = { passed: 0, failed: 0, skipped: 0 };
    self.root.innerHTML = '';
    var p = Promise.resolve();
    self.suites.forEach(function (suite) {
      p = p.then(function () { return suite.run(self.root, totals); });
    });
    return p.then(function () {
      var summary = document.createElement('div');
      summary.className = 'test-summary';
      var status = totals.failed === 0 ? 'good' : 'bad';
      summary.innerHTML = '<strong class="' + status + '">'
        + (totals.failed === 0 ? 'ALL TESTS PASSED' : totals.failed + ' TEST(S) FAILED')
        + '</strong> · ' + totals.passed + ' passed, ' + totals.failed + ' failed, ' + totals.skipped + ' skipped';
      self.root.appendChild(summary);
      return totals;
    });
  };

  function Suite(name) {
    this.name = name;
    this.cases = [];
  }
  Suite.prototype.test = function (name, fn) {
    this.cases.push({ name: name, fn: fn, async: false });
  };
  Suite.prototype.testAsync = function (name, fn) {
    this.cases.push({ name: name, fn: fn, async: true });
  };
  Suite.prototype.skip = function (name, reason) {
    this.cases.push({ name: name, skip: true, reason: reason || '' });
  };
  Suite.prototype.assert = function (cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
  };
  Suite.prototype.assertEq = function (actual, expected, msg) {
    if (actual !== expected) {
      throw new Error((msg ? msg + ': ' : '') + 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
    }
  };
  Suite.prototype.assertBytesEq = function (actual, expected, msg) {
    if (actual.length !== expected.length) {
      throw new Error((msg ? msg + ': ' : '') + 'length mismatch: expected ' + expected.length + ', got ' + actual.length);
    }
    for (var i = 0; i < actual.length; i++) {
      if (actual[i] !== expected[i]) {
        throw new Error((msg ? msg + ': ' : '') + 'byte ' + i + ' differs: expected 0x'
          + expected[i].toString(16).padStart(2, '0') + ', got 0x' + actual[i].toString(16).padStart(2, '0'));
      }
    }
  };
  Suite.prototype.run = function (rootEl, totals) {
    var self = this;
    var el = document.createElement('div');
    el.className = 'test-suite';
    el.innerHTML = '<h3>' + escapeHtml(self.name) + '</h3>';
    rootEl.appendChild(el);
    var p = Promise.resolve();
    self.cases.forEach(function (tc) {
      p = p.then(function () { return runCase(self, tc, el, totals); });
    });
    return p;
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function runCase(suite, tc, el, totals) {
    var caseEl = document.createElement('div');
    caseEl.className = 'test-case';
    el.appendChild(caseEl);

    if (tc.skip) {
      caseEl.classList.add('skip');
      caseEl.textContent = tc.name + (tc.reason ? ' (' + tc.reason + ')' : '');
      totals.skipped++;
      return;
    }

    var startedAt = performance.now();
    function pass() {
      var ms = (performance.now() - startedAt).toFixed(0);
      caseEl.classList.add('pass');
      caseEl.textContent = tc.name + ' (' + ms + ' ms)';
      totals.passed++;
    }
    function fail(err) {
      var ms = (performance.now() - startedAt).toFixed(0);
      caseEl.classList.add('fail');
      caseEl.innerHTML = escapeHtml(tc.name) + ' (' + ms + ' ms)<div class="detail">' + escapeHtml(err && (err.stack || err.message) || String(err)) + '</div>';
      totals.failed++;
    }

    try {
      var result = tc.fn(suite);
      if (result && typeof result.then === 'function') {
        return result.then(pass, fail);
      }
      pass();
    } catch (e) {
      fail(e);
    }
  }

  T.TestRunner = TestRunner;
})(typeof window !== 'undefined' ? window : globalThis);
