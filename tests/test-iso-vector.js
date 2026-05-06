/* Tessera — ISO/IEC 18004 Annex I worked-example test.
 *
 * The spec's worked example (§I.2 / §I.3) encodes the alphanumeric string
 * "01234567" as a 1-M QR code. Tessera doesn't implement alphanumeric mode
 * (we use byte mode for everything to handle URLs with arbitrary characters),
 * but the Reed–Solomon step takes byte input and produces byte output —
 * which we *can* verify against the spec, byte-for-byte.
 *
 * Per ISO §I.3:
 *   Input data codewords (16 bytes, what the alphanumeric encoder produces
 *   before RS):
 *     0x10 0x20 0x0C 0x56 0x61 0x80 0xEC 0x11 0xEC 0x11 0xEC 0x11 0xEC 0x11 0xEC 0x11
 *   Expected EC codewords (10 bytes, ECC level M):
 *     0xA5 0x24 0xD4 0xC1 0xED 0x36 0xC7 0x87 0x2C 0x55
 *
 * If our RS encoder produces those 10 bytes from those 16 bytes, our GF(256)
 * arithmetic, our generator polynomial construction, and our polynomial
 * division are all correct — collectively the most error-prone parts of any
 * QR encoder.
 *
 * We also test:
 *   - GF(256) basics (α^0 = 1, α^255 = 1 cycle)
 *   - Generator polynomial degrees match what the QR EC tables expect
 *   - The encoder produces byte streams of the expected length per version/level
 */
(function () {
  'use strict';

  function register(runner) {
    runner.suite('GF(256) arithmetic', function (s) {
      s.test('EXP[0] = 1', function () {
        s.assertEq(Tessera.RS.EXP[0], 1);
      });
      s.test('EXP[255] = 1 (cycle)', function () {
        s.assertEq(Tessera.RS.EXP[255], 1);
      });
      s.test('EXP[1] = 2 (α = 2)', function () {
        s.assertEq(Tessera.RS.EXP[1], 2);
      });
      s.test('LOG/EXP are inverses', function () {
        for (var i = 0; i < 255; i++) {
          var v = Tessera.RS.EXP[i];
          s.assertEq(Tessera.RS.LOG[v], i, 'LOG[EXP[' + i + ']]');
        }
      });
      s.test('gfMul(0, x) = 0', function () {
        for (var i = 0; i < 256; i++) {
          s.assertEq(Tessera.RS.gfMul(0, i), 0);
          s.assertEq(Tessera.RS.gfMul(i, 0), 0);
        }
      });
      s.test('gfMul(1, x) = x', function () {
        for (var i = 0; i < 256; i++) {
          s.assertEq(Tessera.RS.gfMul(1, i), i);
        }
      });
      s.test('gfMul is commutative', function () {
        for (var a = 0; a < 256; a += 7) {
          for (var b = 0; b < 256; b += 11) {
            s.assertEq(Tessera.RS.gfMul(a, b), Tessera.RS.gfMul(b, a));
          }
        }
      });
    });

    runner.suite('Reed–Solomon — ISO/IEC 18004 Annex I worked example', function (s) {
      s.test('1-M generator polynomial has degree 10', function () {
        var gen = Tessera.RS.buildGenerator(10);
        s.assertEq(gen.length, 11, 'degree 10 → 11 coefficients');
        s.assertEq(gen[0], 1, 'leading coefficient must be 1');
      });

      s.test('Encoder produces correct EC codewords for ISO §I.3 input', function () {
        // The 16 data codewords from ISO §I.3, after alphanumeric encoding
        // of "01234567" with terminator/padding for version 1, level M.
        var data = new Uint8Array([
          0x10, 0x20, 0x0C, 0x56, 0x61, 0x80,
          0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11
        ]);
        // Expected output: 16 data + 10 EC = 26 bytes.
        var expectedEC = new Uint8Array([
          0xA5, 0x24, 0xD4, 0xC1, 0xED, 0x36, 0xC7, 0x87, 0x2C, 0x55
        ]);
        var encoded = Tessera.RS.encode(data, 10);
        s.assertEq(encoded.length, 26, 'output length = data + EC');
        // First 16 bytes are unchanged data
        for (var i = 0; i < 16; i++) {
          s.assertEq(encoded[i], data[i], 'data byte ' + i + ' preserved');
        }
        // Last 10 bytes are the EC codewords
        var actualEC = encoded.slice(16);
        s.assertBytesEq(actualEC, expectedEC, 'EC codewords match spec Annex I');
      });

      // A second, independent RS test from a well-known QR text — encoding
      // 16 bytes of all-zeros with degree 10 should produce all-zeros EC
      // (since 0 is the additive identity in any field).
      s.test('All-zero data → all-zero EC', function () {
        var data = new Uint8Array(16); // all zeros
        var encoded = Tessera.RS.encode(data, 10);
        for (var i = 0; i < 26; i++) {
          s.assertEq(encoded[i], 0, 'byte ' + i + ' of all-zero RS output');
        }
      });
    });

    runner.suite('Encoder — bit stream construction', function (s) {
      s.test('byte-mode bit stream for "A" at v1 starts with mode + count', function () {
        // Mode 0100 (4 bits) + count 00000001 (8 bits for v≤9) + data 'A' = 0x41 (8 bits)
        // Then terminator 0000, byte-align padding, 0xEC 0x11 ... pad bytes.
        // First two bytes: 0100 0000 + 0001 0100 = 0x40, 0x14? Let's compute:
        //   Bits: 0100 00000001 01000001 0000 ...
        //   Group as bytes (MSB first): 01000000 = 0x40, 00010100 = 0x14, 0001_0000 = ...
        var data = new Uint8Array([0x41]); // "A"
        var bits = Tessera.QR._internals.buildBitStream(data, 1, 'M');
        s.assertEq(bits[0], 0x40, 'first byte');
        s.assertEq(bits[1], 0x14, 'second byte');
        // Total length must equal totalDataCodewords(1, M) = 16 bytes
        s.assertEq(bits.length, 16);
      });

      s.test('Bit stream is exactly capacity for every (version, EC) combo', function () {
        var ecLevels = ['L', 'M', 'Q', 'H'];
        for (var v = 1; v <= 40; v++) {
          for (var ei = 0; ei < ecLevels.length; ei++) {
            var ec = ecLevels[ei];
            var capBytes = Tessera.QR._internals.totalDataCodewords(v, { L: 0, M: 1, Q: 2, H: 3 }[ec]);
            // Encode a single byte and verify the bit stream is padded to capacity.
            var bits = Tessera.QR._internals.buildBitStream(new Uint8Array([0x00]), v, ec);
            s.assertEq(bits.length, capBytes, 'v' + v + '-' + ec + ' bit stream length');
          }
        }
      });
    });

    runner.suite('Encoder — high-level smoke', function (s) {
      s.test('encode("https://example.com") at level H produces a valid matrix', function () {
        var qr = Tessera.QR.encode('https://example.com', { ecLevel: 'H' });
        s.assert(qr.version >= 1 && qr.version <= 40, 'version in 1..40');
        s.assertEq(qr.size, 17 + 4 * qr.version, 'size formula');
        s.assertEq(qr.modules.length, qr.size);
        s.assertEq(qr.modules[0].length, qr.size);
        // Finder patterns: top-left corner module at (0,0) must be dark.
        s.assertEq(qr.modules[0][0], 1, 'top-left finder corner');
        s.assertEq(qr.modules[0][6], 1, 'top-left finder right edge');
        s.assertEq(qr.modules[6][0], 1, 'top-left finder bottom edge');
        s.assertEq(qr.modules[6][6], 1, 'top-left finder bottom-right edge');
        // Center of finder is dark
        s.assertEq(qr.modules[3][3], 1, 'top-left finder center');
        // Dark module at (4V+9, 8) must be 1
        s.assertEq(qr.modules[4 * qr.version + 9][8], 1, 'dark module');
      });

      s.test('Tiny input picks v1', function () {
        var qr = Tessera.QR.encode('hi', { ecLevel: 'L' });
        s.assertEq(qr.version, 1);
      });

      s.test('Larger input bumps version', function () {
        // 100 chars at level H definitely doesn't fit in v1
        var qr = Tessera.QR.encode('x'.repeat(100), { ecLevel: 'H' });
        s.assert(qr.version > 1, 'version > 1');
      });

      s.test('Forced version that does not fit throws', function () {
        var threw = false;
        try {
          Tessera.QR.encode('x'.repeat(1000), { ecLevel: 'H', forceVersion: 1 });
        } catch (e) { threw = true; }
        s.assert(threw, 'should throw');
      });
    });
  }

  // Auto-register if a global runner exists
  if (typeof window !== 'undefined' && window.__tesseraTestRegister) {
    window.__tesseraTestRegister(register);
  } else if (typeof window !== 'undefined') {
    window.__tesseraTestSuites = window.__tesseraTestSuites || [];
    window.__tesseraTestSuites.push(register);
  }
})();
