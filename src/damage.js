/* Tessera — damage tolerance module.
 *
 * The actual blur-based damage simulation lives in `damage-preview.js`. This
 * file is kept as a thin alias so existing references to `Tessera.Damage`
 * (in the spec sheet, the test corpus, and any external code that points at
 * this module) keep working with no changes.
 *
 *   Tessera.Damage.test(qr, text, opts)   -> Promise<sweepResult>
 *     equivalent to Tessera.DamagePreview.sweepTolerance(qr, text, opts)
 *
 *   Tessera.Damage.LEVELS                  -> [0, 5, 10, 15, 20, 25, 30]
 */
(function (global) {
  'use strict';

  var T = global.Tessera = global.Tessera || {};

  if (!T.DamagePreview) {
    throw new Error(
      'Tessera.Damage requires Tessera.DamagePreview (damage-preview.js) ' +
      'to be loaded first.'
    );
  }

  T.Damage = {
    LEVELS: T.DamagePreview.LEVELS,
    test: T.DamagePreview.sweepTolerance,
    decodeBlurred: T.DamagePreview.decodeBlurred,
    renderBlurred: T.DamagePreview.renderBlurred,
    blurRadiusFor: T.DamagePreview.blurRadiusFor,
  };
})(typeof window !== 'undefined' ? window : globalThis);
