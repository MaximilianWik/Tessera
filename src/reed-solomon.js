/* Tessera — Reed–Solomon over GF(256) for QR codes.
 *
 * QR uses GF(256) constructed via the primitive polynomial 0x11D
 * (x^8 + x^4 + x^3 + x^2 + 1), per ISO/IEC 18004 §7.5.2.
 *
 * This file builds two lookup tables (EXP and LOG) for fast multiplication,
 * then provides:
 *   - Tessera.RS.gfMul(a, b)            — multiply in GF(256)
 *   - Tessera.RS.buildGenerator(degree) — generator polynomial for `degree` EC codewords
 *   - Tessera.RS.encode(data, ecCount)  — append `ecCount` Reed–Solomon EC codewords
 *
 * No dependencies. Pure functions. ~120 lines.
 */
(function (global) {
  'use strict';

  var EXP = new Uint8Array(512); // EXP[i] = α^i in GF(256), with α = 2; doubled for wraparound
  var LOG = new Uint8Array(256); // LOG[v] = i such that α^i = v

  (function buildTables() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
    // LOG[0] is undefined mathematically; we leave it as 0 and never multiply by 0 via LOG path.
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  // Build the generator polynomial g(x) = (x - α^0)(x - α^1)...(x - α^(degree-1))
  // Returned as coefficients high-degree-first, length = degree + 1, leading coefficient = 1.
  // We cache by degree because every codeword block of the same EC count uses the same generator.
  var GENERATOR_CACHE = {};
  function buildGenerator(degree) {
    if (GENERATOR_CACHE[degree]) return GENERATOR_CACHE[degree];
    // Start with g(x) = 1
    var g = [1];
    for (var i = 0; i < degree; i++) {
      // Multiply g(x) by (x - α^i) = (x + α^i) in GF(256)
      var next = new Array(g.length + 1).fill(0);
      for (var j = 0; j < g.length; j++) {
        next[j] ^= g[j];                          // g(x) * x — shift up
        next[j + 1] ^= gfMul(g[j], EXP[i]);       // g(x) * α^i — accumulate
      }
      g = next;
    }
    GENERATOR_CACHE[degree] = g;
    return g;
  }

  // Encode: append `ecCount` Reed–Solomon error-correction codewords to `data`.
  // `data` is a Uint8Array (or array of bytes 0–255). Returns a new Uint8Array of
  // length data.length + ecCount with the EC bytes at the end.
  //
  // This is polynomial division of (data * x^ecCount) by the generator polynomial.
  // The remainder is the EC bytes.
  function encode(data, ecCount) {
    var dataLen = data.length;
    var generator = buildGenerator(ecCount);
    // Working buffer holds data followed by ecCount zero bytes (the x^ecCount shift).
    var buf = new Uint8Array(dataLen + ecCount);
    for (var i = 0; i < dataLen; i++) buf[i] = data[i];
    // Synthetic division: at each step, eliminate the leading coefficient by XORing
    // an appropriately shifted copy of the generator polynomial.
    for (var i2 = 0; i2 < dataLen; i2++) {
      var coef = buf[i2];
      if (coef !== 0) {
        // generator[0] is always 1, so this XOR zeroes buf[i2] as expected.
        for (var j = 0; j < generator.length; j++) {
          buf[i2 + j] ^= gfMul(generator[j], coef);
        }
      }
    }
    // The last `ecCount` bytes are the EC codewords. We want to return data || EC.
    var out = new Uint8Array(dataLen + ecCount);
    for (var k = 0; k < dataLen; k++) out[k] = data[k];
    for (var m = 0; m < ecCount; m++) out[dataLen + m] = buf[dataLen + m];
    return out;
  }

  global.Tessera = global.Tessera || {};
  global.Tessera.RS = {
    EXP: EXP,
    LOG: LOG,
    gfMul: gfMul,
    buildGenerator: buildGenerator,
    encode: encode,
  };
})(typeof window !== 'undefined' ? window : globalThis);
