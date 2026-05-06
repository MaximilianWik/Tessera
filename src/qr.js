/* Tessera — QR encoder. ISO/IEC 18004:2015 compliant.
 *
 * Pipeline (see docs/SPEC.md for plain-English overview):
 *   1. encodeBytes(text)              -> Uint8Array (UTF-8)
 *   2. pickVersion(data, ecLevel)     -> smallest version that fits
 *   3. buildBitStream(...)            -> mode + count + data + terminator + pad
 *   4. splitIntoBlocks + RS encode    -> data blocks with EC appended
 *   5. interleave                     -> final codeword stream
 *   6. placeModules                   -> snake-fill bits into matrix
 *   7. pickBestMask                   -> lowest penalty score
 *   8. writeFormatInfo / writeVersionInfo
 *
 * Public API:
 *   Tessera.QR.encode(text, options) -> {
 *     version, ecLevel, mask, size, modules, // modules[y][x] = 0|1
 *     dataCodewords, ecCodewords, totalCodewords,
 *     text, mode,
 *   }
 *
 * options:
 *   ecLevel: 'L' | 'M' | 'Q' | 'H' (default 'H')
 *   minVersion: 1..40 (default 1)
 *   maxVersion: 1..40 (default 40)
 *   mask: 0..7 (default: auto — pick lowest-penalty)
 *   forceVersion: number — skip auto-pick and use this exact version
 *
 * Tables in this file are taken directly from ISO/IEC 18004:2015. They are
 * verifiable against the ISO Annex I worked example (see tests/test-iso-vector.js).
 */
(function (global) {
  'use strict';

  var T = global.Tessera = global.Tessera || {};
  var RS = T.RS;
  if (!RS) throw new Error('Tessera.QR requires Tessera.RS (reed-solomon.js) to be loaded first.');

  // ---------------------------------------------------------------------------
  // Tables
  // ---------------------------------------------------------------------------

  var EC_LEVELS = { L: 0, M: 1, Q: 2, H: 3 };
  // ISO format-info bit ordering: L=01, M=00, Q=11, H=10. We index our other tables
  // in the L,M,Q,H order above (0..3) and convert when writing format info.
  var EC_LEVEL_FORMAT_BITS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

  // CAPACITY[version][ecLevelIdx] = max byte-mode characters that fit.
  // Generated from ISO/IEC 18004 Table 7. Indexed [version-1][L,M,Q,H].
  // We use this only as an upper bound for version selection; exact bit accounting
  // is done against TOTAL_DATA_CODEWORDS below.
  // (We don't actually need this table — version selection compares bit length to
  // capacity in bits, which we derive from TOTAL_DATA_CODEWORDS * 8.)

  // EC_BLOCKS[version-1][ecLevelIdx] = [ecCodewordsPerBlock, group1Blocks, group1DataPerBlock, group2Blocks, group2DataPerBlock]
  // Source: ISO/IEC 18004:2015 Table 9.
  var EC_BLOCKS = [
    // v1
    [[ 7, 1, 19, 0,  0],[10, 1, 16, 0,  0],[13, 1, 13, 0,  0],[17, 1,  9, 0,  0]],
    // v2
    [[10, 1, 34, 0,  0],[16, 1, 28, 0,  0],[22, 1, 22, 0,  0],[28, 1, 16, 0,  0]],
    // v3
    [[15, 1, 55, 0,  0],[26, 1, 44, 0,  0],[18, 2, 17, 0,  0],[22, 2, 13, 0,  0]],
    // v4
    [[20, 1, 80, 0,  0],[18, 2, 32, 0,  0],[26, 2, 24, 0,  0],[16, 4,  9, 0,  0]],
    // v5
    [[26, 1,108, 0,  0],[24, 2, 43, 0,  0],[18, 2, 15, 2, 16],[22, 2, 11, 2, 12]],
    // v6
    [[18, 2, 68, 0,  0],[16, 4, 27, 0,  0],[24, 4, 19, 0,  0],[28, 4, 15, 0,  0]],
    // v7
    [[20, 2, 78, 0,  0],[18, 4, 31, 0,  0],[18, 2, 14, 4, 15],[26, 4, 13, 1, 14]],
    // v8
    [[24, 2, 97, 0,  0],[22, 2, 38, 2, 39],[22, 4, 18, 2, 19],[26, 4, 14, 2, 15]],
    // v9
    [[30, 2,116, 0,  0],[22, 3, 36, 2, 37],[20, 4, 16, 4, 17],[24, 4, 12, 4, 13]],
    // v10
    [[18, 2, 68, 2, 69],[26, 4, 43, 1, 44],[24, 6, 19, 2, 20],[28, 6, 15, 2, 16]],
    // v11
    [[20, 4, 81, 0,  0],[30, 1, 50, 4, 51],[28, 4, 22, 4, 23],[24, 3, 12, 8, 13]],
    // v12
    [[24, 2, 92, 2, 93],[22, 6, 36, 2, 37],[26, 4, 20, 6, 21],[28, 7, 14, 4, 15]],
    // v13
    [[26, 4,107, 0,  0],[22, 8, 37, 1, 38],[24, 8, 20, 4, 21],[22,12, 11, 4, 12]],
    // v14
    [[30, 3,115, 1,116],[24, 4, 40, 5, 41],[20,11, 16, 5, 17],[24,11, 12, 5, 13]],
    // v15
    [[22, 5, 87, 1, 88],[24, 5, 41, 5, 42],[30, 5, 24, 7, 25],[24,11, 12, 7, 13]],
    // v16
    [[24, 5, 98, 1, 99],[28, 7, 45, 3, 46],[24,15, 19, 2, 20],[30, 3, 15,13, 16]],
    // v17
    [[28, 1,107, 5,108],[28,10, 46, 1, 47],[28, 1, 22,15, 23],[28, 2, 14,17, 15]],
    // v18
    [[30, 5,120, 1,121],[26, 9, 43, 4, 44],[28,17, 22, 1, 23],[28, 2, 14,19, 15]],
    // v19
    [[28, 3,113, 4,114],[26, 3, 44,11, 45],[26,17, 21, 4, 22],[26, 9, 13,16, 14]],
    // v20
    [[28, 3,107, 5,108],[26, 3, 41,13, 42],[30,15, 24, 5, 25],[28,15, 15, 10,16]],
    // v21
    [[28, 4,116, 4,117],[26,17, 42, 0,  0],[28,17, 22, 6, 23],[30,19, 16, 6, 17]],
    // v22
    [[28, 2,111, 7,112],[28,17, 46, 0,  0],[30, 7, 24,16, 25],[24,34, 13, 0,  0]],
    // v23
    [[30, 4,121, 5,122],[28, 4, 47,14, 48],[30,11, 24,14, 25],[30,16, 15,14, 16]],
    // v24
    [[30, 6,117, 4,118],[28, 6, 45,14, 46],[30,11, 24,16, 25],[30,30, 16, 2, 17]],
    // v25
    [[26, 8,106, 4,107],[28, 8, 47,13, 48],[30, 7, 24,22, 25],[30,22, 15,13, 16]],
    // v26
    [[28,10,114, 2,115],[28,19, 46, 4, 47],[28,28, 22, 6, 23],[30,33, 16, 4, 17]],
    // v27
    [[30, 8,122, 4,123],[28,22, 45, 3, 46],[30, 8, 23,26, 24],[30,12, 15,28, 16]],
    // v28
    [[30, 3,117,10,118],[28, 3, 45,23, 46],[30, 4, 24,31, 25],[30,11, 15,31, 16]],
    // v29
    [[30, 7,116, 7,117],[28,21, 45, 7, 46],[30, 1, 23,37, 24],[30,19, 15,26, 16]],
    // v30
    [[30, 5,115,10,116],[28,19, 47,10, 48],[30,15, 24,25, 25],[30,23, 15,25, 16]],
    // v31
    [[30,13,115, 3,116],[28, 2, 46,29, 47],[30,42, 24, 1, 25],[30,23, 15,28, 16]],
    // v32
    [[30,17,115, 0,  0],[28,10, 46,23, 47],[30,10, 24,35, 25],[30,19, 15,35, 16]],
    // v33
    [[30,17,115, 1,116],[28,14, 46,21, 47],[30,29, 24,19, 25],[30,11, 15,46, 16]],
    // v34
    [[30,13,115, 6,116],[28,14, 46,23, 47],[30,44, 24, 7, 25],[30,59, 16, 1, 17]],
    // v35
    [[30,12,121, 7,122],[28,12, 47,26, 48],[30,39, 24,14, 25],[30,22, 15,41, 16]],
    // v36
    [[30, 6,121,14,122],[28, 6, 47,34, 48],[30,46, 24,10, 25],[30, 2, 15,64, 16]],
    // v37
    [[30,17,122, 4,123],[28,29, 46,14, 47],[30,49, 24,10, 25],[30,24, 15,46, 16]],
    // v38
    [[30, 4,122,18,123],[28,13, 46,32, 47],[30,48, 24,14, 25],[30,42, 15,32, 16]],
    // v39
    [[30,20,117, 4,118],[28,40, 47, 7, 48],[30,43, 24,22, 25],[30,10, 15,67, 16]],
    // v40
    [[30,19,118, 6,119],[28,18, 47,31, 48],[30,34, 24,34, 25],[30,20, 15,61, 16]],
  ];

  // Total data codewords (data, not counting EC) per (version, ecLevel)
  function totalDataCodewords(version, ecLevelIdx) {
    var b = EC_BLOCKS[version - 1][ecLevelIdx];
    return b[1] * b[2] + b[3] * b[4];
  }

  // Total codewords (data + EC) per version. Independent of EC level.
  // Source: ISO/IEC 18004 Table 7. Computed at module load time as a sanity check.
  // We instead derive bit capacity from data codewords directly.

  // Alignment-pattern centers per version, ISO/IEC 18004 Annex E.
  // ALIGN_POS[version-1] = array of axis coordinates. Patterns are placed at every
  // (x,y) combination of these coordinates, except where they overlap a finder pattern.
  var ALIGN_POS = [
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
    [6, 30, 54],
    [6, 32, 58],
    [6, 34, 62],
    [6, 26, 46, 66],
    [6, 26, 48, 70],
    [6, 26, 50, 74],
    [6, 30, 54, 78],
    [6, 30, 56, 82],
    [6, 30, 58, 86],
    [6, 34, 62, 90],
    [6, 28, 50, 72, 94],
    [6, 26, 50, 74, 98],
    [6, 30, 54, 78, 102],
    [6, 28, 54, 80, 106],
    [6, 32, 58, 84, 110],
    [6, 30, 58, 86, 114],
    [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122],
    [6, 30, 54, 78, 102, 126],
    [6, 26, 52, 78, 104, 130],
    [6, 30, 56, 82, 108, 134],
    [6, 34, 60, 86, 112, 138],
    [6, 30, 58, 86, 114, 142],
    [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150],
    [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158],
    [6, 32, 58, 84, 110, 136, 162],
    [6, 26, 54, 82, 110, 138, 166],
    [6, 30, 58, 86, 114, 142, 170],
  ];

  // Pre-computed format info table per ISO Annex C, indexed by
  // (ecLevelFormatBits << 3) | maskNumber. The 15-bit value is the BCH(15,5)
  // encoding of the 5-bit input XOR'd with the format mask 0x5412.
  // Index ranges:
  //   0x00..0x07  ->  M (ec bits = 00), masks 0..7
  //   0x08..0x0F  ->  L (ec bits = 01), masks 0..7
  //   0x10..0x17  ->  H (ec bits = 10), masks 0..7
  //   0x18..0x1F  ->  Q (ec bits = 11), masks 0..7
  var FORMAT_INFO = [
    0x5412, 0x5125, 0x5E7C, 0x5B4B, 0x45F9, 0x40CE, 0x4F97, 0x4AA0, // M, masks 0..7
    0x77C4, 0x72F3, 0x7DAA, 0x789D, 0x662F, 0x6318, 0x6C41, 0x6976, // L, masks 0..7
    0x1689, 0x13BE, 0x1CE7, 0x19D0, 0x0762, 0x0255, 0x0D0C, 0x083B, // H, masks 0..7
    0x355F, 0x3068, 0x3F31, 0x3A06, 0x24B4, 0x2183, 0x2EDA, 0x2BED, // Q, masks 0..7
  ];

  // Version info bits (18 bits) for versions 7..40. Index = version - 7.
  // Source: ISO/IEC 18004 Annex D.
  var VERSION_INFO = [
    0x07C94, 0x085BC, 0x09A99, 0x0A4D3, 0x0BBF6, 0x0C762, 0x0D847, 0x0E60D, 0x0F928,
    0x10B78, 0x1145D, 0x12A17, 0x13532, 0x149A6, 0x15683, 0x168C9, 0x177EC, 0x18EC4,
    0x191E1, 0x1AFAB, 0x1B08E, 0x1CC1A, 0x1D33F, 0x1ED75, 0x1F250, 0x209D5, 0x216F0,
    0x228BA, 0x2379F, 0x24B0B, 0x2542E, 0x26A64, 0x27541, 0x28C69,
  ];

  // ---------------------------------------------------------------------------
  // Step 1: Encode text to bytes (UTF-8)
  // ---------------------------------------------------------------------------

  function utf8Encode(str) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(str);
    }
    // Fallback (shouldn't be needed in modern browsers but keeps the encoder
    // self-contained and archival).
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      } else if ((c & 0xFC00) === 0xD800 && i + 1 < str.length) {
        // Surrogate pair
        var hi = c, lo = str.charCodeAt(++i);
        var cp = 0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F),
                 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      }
    }
    return new Uint8Array(out);
  }

  // ---------------------------------------------------------------------------
  // Step 2: Version selection
  // ---------------------------------------------------------------------------

  function characterCountIndicatorBits(version) {
    // Byte mode character-count indicator length, ISO Table 3.
    if (version <= 9) return 8;
    return 16;
  }

  function pickVersion(byteLen, ecLevel, minVersion, maxVersion) {
    var ecIdx = EC_LEVELS[ecLevel];
    for (var v = minVersion; v <= maxVersion; v++) {
      var capacityBits = totalDataCodewords(v, ecIdx) * 8;
      // mode (4) + count (8 or 16) + 8*byteLen
      var needBits = 4 + characterCountIndicatorBits(v) + byteLen * 8;
      if (needBits <= capacityBits) return v;
    }
    return null;
  }

  // Find the (version, ecLevel) combination that's optimal for a tattoo:
  // the smallest version that can hold the data at any EC level, paired with
  // the highest EC level that fits at that version.
  //
  // Why: for tattoos, failure is dominated by blur (ink bleed and edge
  // softening), not by localized damage. Bigger physical modules survive
  // blur better than higher EC at smaller modules. So the best strategy is
  // "smallest grid, then push EC as high as it'll go on that grid", giving
  // you maximum module size for whatever EC headroom is available.
  //
  // Returns { version, ecLevel } or null if the data won't fit anywhere.
  function findTattooOptimal(text) {
    var data = utf8Encode(text);
    var levels = ['H', 'Q', 'M', 'L']; // try highest first at each version
    for (var v = 1; v <= 40; v++) {
      for (var i = 0; i < levels.length; i++) {
        var lev = levels[i];
        var ecIdx = EC_LEVELS[lev];
        var capBits = totalDataCodewords(v, ecIdx) * 8;
        var needBits = 4 + characterCountIndicatorBits(v) + data.length * 8;
        if (needBits <= capBits) {
          return { version: v, ecLevel: lev };
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Step 3: Build bit stream
  // ---------------------------------------------------------------------------

  function BitWriter() {
    this.bytes = [];
    this.bitPos = 0; // bit position WITHIN the current (last) byte; 0 = no current byte
  }
  BitWriter.prototype.writeBits = function (value, length) {
    for (var i = length - 1; i >= 0; i--) {
      if (this.bitPos === 0) this.bytes.push(0);
      var bit = (value >> i) & 1;
      this.bytes[this.bytes.length - 1] |= bit << (7 - this.bitPos);
      this.bitPos = (this.bitPos + 1) & 7;
    }
  };
  BitWriter.prototype.bitLength = function () {
    return this.bytes.length === 0 ? 0
      : (this.bytes.length - 1) * 8 + (this.bitPos === 0 ? 8 : this.bitPos);
  };
  BitWriter.prototype.toUint8Array = function () { return new Uint8Array(this.bytes); };

  function buildBitStream(data, version, ecLevel) {
    var ecIdx = EC_LEVELS[ecLevel];
    var capacityBits = totalDataCodewords(version, ecIdx) * 8;
    var bw = new BitWriter();
    // Mode indicator: 0100 = byte mode
    bw.writeBits(0b0100, 4);
    // Character count indicator
    bw.writeBits(data.length, characterCountIndicatorBits(version));
    // Data
    for (var i = 0; i < data.length; i++) bw.writeBits(data[i], 8);
    // Terminator: up to 4 zero bits, but never exceed capacity
    var remaining = capacityBits - bw.bitLength();
    var termLen = remaining < 4 ? remaining : 4;
    bw.writeBits(0, termLen);
    // Byte-align
    while (bw.bitLength() % 8 !== 0) bw.writeBits(0, 1);
    // Pad bytes
    var padBytes = [0xEC, 0x11];
    var padIdx = 0;
    while (bw.bitLength() < capacityBits) {
      bw.writeBits(padBytes[padIdx], 8);
      padIdx ^= 1;
    }
    return bw.toUint8Array();
  }

  // ---------------------------------------------------------------------------
  // Step 4 + 5: Block split, RS encode, interleave
  // ---------------------------------------------------------------------------

  function buildCodewords(dataCodewords, version, ecLevel) {
    var ecIdx = EC_LEVELS[ecLevel];
    var ecPerBlock = EC_BLOCKS[version - 1][ecIdx][0];
    var g1Count = EC_BLOCKS[version - 1][ecIdx][1];
    var g1Size  = EC_BLOCKS[version - 1][ecIdx][2];
    var g2Count = EC_BLOCKS[version - 1][ecIdx][3];
    var g2Size  = EC_BLOCKS[version - 1][ecIdx][4];

    // Split data into blocks
    var blocks = [];
    var ecBlocks = [];
    var p = 0;
    for (var i = 0; i < g1Count; i++) {
      var b = dataCodewords.slice(p, p + g1Size);
      p += g1Size;
      blocks.push(b);
      var enc = RS.encode(b, ecPerBlock);
      ecBlocks.push(enc.slice(b.length));
    }
    for (var j = 0; j < g2Count; j++) {
      var b2 = dataCodewords.slice(p, p + g2Size);
      p += g2Size;
      blocks.push(b2);
      var enc2 = RS.encode(b2, ecPerBlock);
      ecBlocks.push(enc2.slice(b2.length));
    }

    // Interleave data codewords: column-by-column across blocks.
    var maxDataLen = Math.max(g1Size, g2Size);
    var out = [];
    for (var col = 0; col < maxDataLen; col++) {
      for (var bi = 0; bi < blocks.length; bi++) {
        if (col < blocks[bi].length) out.push(blocks[bi][col]);
      }
    }
    // Interleave EC codewords (all blocks have ecPerBlock EC codewords)
    for (var col2 = 0; col2 < ecPerBlock; col2++) {
      for (var bi2 = 0; bi2 < ecBlocks.length; bi2++) {
        out.push(ecBlocks[bi2][col2]);
      }
    }
    return new Uint8Array(out);
  }

  // ---------------------------------------------------------------------------
  // Step 6: Module placement
  // ---------------------------------------------------------------------------

  // Matrix value convention:
  //   modules[y][x] = 0 (light) or 1 (dark)
  //   reserved[y][x] = true if this cell is a function pattern or reserved area
  //                    (must not be overwritten by data placement, must not be masked)

  function makeMatrix(size) {
    var m = new Array(size);
    for (var y = 0; y < size; y++) {
      m[y] = new Uint8Array(size); // all 0 (light) by default
    }
    return m;
  }

  function placeFinderPattern(m, reserved, x0, y0) {
    // 7x7 finder pattern
    for (var dy = -1; dy <= 7; dy++) {
      for (var dx = -1; dx <= 7; dx++) {
        var x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= m.length || y >= m.length) continue;
        var inOuter = (dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6);
        var onRing = (dx === 0 || dx === 6 || dy === 0 || dy === 6);
        var inInner = (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
        var dark = inOuter && (onRing || inInner);
        m[y][x] = dark ? 1 : 0;
        reserved[y][x] = true; // includes the white separator border one module out
      }
    }
  }

  function placeAlignmentPattern(m, reserved, cx, cy) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        var x = cx + dx, y = cy + dy;
        var ring = (Math.abs(dx) === 2 || Math.abs(dy) === 2);
        var center = (dx === 0 && dy === 0);
        m[y][x] = (ring || center) ? 1 : 0;
        reserved[y][x] = true;
      }
    }
  }

  function placeFunctionPatterns(m, reserved, version) {
    var size = m.length;
    // Three finder patterns (top-left, top-right, bottom-left), with their
    // separators (handled by drawing the 8x8 region around each as reserved).
    placeFinderPattern(m, reserved, 0, 0);
    placeFinderPattern(m, reserved, size - 7, 0);
    placeFinderPattern(m, reserved, 0, size - 7);

    // Timing patterns: alternating dark/light along row 6 and column 6.
    for (var i = 8; i < size - 8; i++) {
      var d = (i % 2 === 0) ? 1 : 0;
      m[6][i] = d; reserved[6][i] = true;
      m[i][6] = d; reserved[i][6] = true;
    }

    // Alignment patterns
    var positions = ALIGN_POS[version - 1];
    for (var ai = 0; ai < positions.length; ai++) {
      for (var aj = 0; aj < positions.length; aj++) {
        var cx = positions[aj], cy = positions[ai];
        // Skip if it would overlap a finder pattern
        var skip = (cx <= 8 && cy <= 8)
          || (cx >= size - 9 && cy <= 8)
          || (cx <= 8 && cy >= size - 9);
        if (skip) continue;
        placeAlignmentPattern(m, reserved, cx, cy);
      }
    }

    // Dark module: always 1, at position (8, 4*version + 9)
    m[4 * version + 9][8] = 1;
    reserved[4 * version + 9][8] = true;

    // Reserve format info regions (15 bits in two locations)
    for (var k = 0; k < 9; k++) {
      reserved[8][k] = true;     // top-left horizontal
      reserved[k][8] = true;     // top-left vertical
    }
    for (var k2 = 0; k2 < 8; k2++) {
      reserved[8][size - 1 - k2] = true; // top-right
      reserved[size - 1 - k2][8] = true; // bottom-left
    }

    // Reserve version info regions for v >= 7 (6x3 in two locations)
    if (version >= 7) {
      for (var vy = 0; vy < 6; vy++) {
        for (var vx = 0; vx < 3; vx++) {
          reserved[vy][size - 11 + vx] = true; // top-right block
          reserved[size - 11 + vx][vy] = true; // bottom-left block
        }
      }
    }
  }

  function placeData(m, reserved, codewords) {
    var size = m.length;
    var bitIdx = 0;
    var totalBits = codewords.length * 8;
    // Walk in 2-column zig-zags from right to left, skipping the column that
    // contains the timing pattern (column 6).
    var x = size - 1;
    var upward = true;
    while (x > 0) {
      if (x === 6) x--; // skip vertical timing
      for (var step = 0; step < size; step++) {
        var y = upward ? (size - 1 - step) : step;
        for (var col = 0; col < 2; col++) {
          var cx = x - col;
          if (!reserved[y][cx]) {
            var bit = 0;
            if (bitIdx < totalBits) {
              var byte = codewords[bitIdx >> 3];
              bit = (byte >> (7 - (bitIdx & 7))) & 1;
              bitIdx++;
            }
            m[y][cx] = bit;
          }
        }
      }
      x -= 2;
      upward = !upward;
    }
  }

  // ---------------------------------------------------------------------------
  // Step 7: Masking
  // ---------------------------------------------------------------------------

  // ISO §7.8.2 mask formulas. Given (row, col), each returns true if the module
  // should be inverted by this mask. (Note: the spec writes (i,j) where i=row, j=col.)
  var MASK_FNS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r, c) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return ((r * c) % 2) + ((r * c) % 3) === 0; },
    function (r, c) { return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; },
    function (r, c) { return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; },
  ];

  function applyMask(m, reserved, maskNum) {
    var size = m.length;
    var fn = MASK_FNS[maskNum];
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (!reserved[y][x] && fn(y, x)) {
          m[y][x] ^= 1;
        }
      }
    }
  }

  // Penalty rules from ISO §7.8.3.1
  function maskPenalty(m) {
    var size = m.length;
    var penalty = 0;

    // Rule 1: runs of >=5 same-colour modules in a row or column.
    for (var y = 0; y < size; y++) {
      var runR = 1, runC = 1;
      for (var x = 1; x < size; x++) {
        if (m[y][x] === m[y][x - 1]) runR++;
        else { if (runR >= 5) penalty += 3 + (runR - 5); runR = 1; }
        if (m[x][y] === m[x - 1][y]) runC++;
        else { if (runC >= 5) penalty += 3 + (runC - 5); runC = 1; }
      }
      if (runR >= 5) penalty += 3 + (runR - 5);
      if (runC >= 5) penalty += 3 + (runC - 5);
    }

    // Rule 2: 2x2 blocks of same colour. +3 per block.
    for (var y2 = 0; y2 < size - 1; y2++) {
      for (var x2 = 0; x2 < size - 1; x2++) {
        var v = m[y2][x2];
        if (m[y2][x2 + 1] === v && m[y2 + 1][x2] === v && m[y2 + 1][x2 + 1] === v) {
          penalty += 3;
        }
      }
    }

    // Rule 3: 1:1:3:1:1 finder-pattern lookalikes (with 4-module quiet on either side),
    // in rows or columns. +40 per occurrence.
    var pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]; // dark/light-with-quiet-trailing
    var pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]; // dark/light-with-quiet-leading
    for (var y3 = 0; y3 < size; y3++) {
      for (var x3 = 0; x3 <= size - 11; x3++) {
        var matches1H = true, matches2H = true, matches1V = true, matches2V = true;
        for (var k = 0; k < 11; k++) {
          if (m[y3][x3 + k] !== pat1[k]) matches1H = false;
          if (m[y3][x3 + k] !== pat2[k]) matches2H = false;
          if (m[x3 + k][y3] !== pat1[k]) matches1V = false;
          if (m[x3 + k][y3] !== pat2[k]) matches2V = false;
        }
        if (matches1H) penalty += 40;
        if (matches2H) penalty += 40;
        if (matches1V) penalty += 40;
        if (matches2V) penalty += 40;
      }
    }

    // Rule 4: dark-module ratio. Step away from 50%.
    var dark = 0;
    for (var y4 = 0; y4 < size; y4++) {
      for (var x4 = 0; x4 < size; x4++) {
        if (m[y4][x4]) dark++;
      }
    }
    var total = size * size;
    var ratio = (dark * 100) / total;
    var dev = Math.floor(Math.abs(ratio - 50) / 5);
    penalty += dev * 10;

    return penalty;
  }

  function pickBestMask(matrixBuilder) {
    var bestMask = 0;
    var bestPenalty = Infinity;
    var bestMatrix = null;
    for (var mk = 0; mk < 8; mk++) {
      var built = matrixBuilder(mk);
      var p = maskPenalty(built);
      if (p < bestPenalty) {
        bestPenalty = p;
        bestMask = mk;
        bestMatrix = built;
      }
    }
    return { mask: bestMask, matrix: bestMatrix, penalty: bestPenalty };
  }

  // ---------------------------------------------------------------------------
  // Step 8 & 9: Format and version info
  // ---------------------------------------------------------------------------

  function writeFormatInfo(m, ecLevel, maskNum) {
    var size = m.length;
    var ecBits = EC_LEVEL_FORMAT_BITS[ecLevel];
    var format = FORMAT_INFO[(ecBits << 3) | maskNum]; // 15-bit value
    // The 15 bits are placed twice (redundancy). Per ISO §7.9.1:
    //   Top-left horizontal/vertical strip: bits 0..14 placed in a defined order.
    // We use the specific module coordinates from ISO Figure 25.
    //
    // Bit 0 = LSB. Mapping (bit -> (row, col)) for the top-left copy:
    //   bits 0..5  -> col 8, rows 0..5
    //   bit 6      -> col 8, row 7      (skipping row 6 = timing)
    //   bit 7      -> col 8, row 8
    //   bit 8      -> col 7, row 8      (skipping col 6 = timing later? actually next is col 7)
    //   bits 9..14 -> col 5..0, row 8
    // Wait — re-reading the spec, the top-left copy goes:
    //   bits 0..6 placed top-down at column 8 (rows 0,1,2,3,4,5,7,8 — skipping 6),
    //   bits 7..14 placed left-to-right at row 8 (columns 7,5,4,3,2,1,0 — skipping 6).
    // We implement that explicitly below.
    var bits = [];
    for (var i = 14; i >= 0; i--) bits.push((format >> i) & 1); // bits[0] is bit 14 (MSB)
    // Convert MSB-first array to LSB-first lookup: getBit(k) returns bit k of format.
    function getBit(k) { return (format >> k) & 1; }

    // Top-left copy
    // bits 0..5 at col 8, rows 0..5
    for (var i2 = 0; i2 <= 5; i2++) m[i2][8] = getBit(i2);
    // bit 6 at col 8, row 7
    m[7][8] = getBit(6);
    // bit 7 at col 8, row 8
    m[8][8] = getBit(7);
    // bit 8 at col 7, row 8
    m[8][7] = getBit(8);
    // bits 9..14 at col 5..0, row 8
    for (var i3 = 9, c = 5; i3 <= 14; i3++, c--) m[8][c] = getBit(i3);

    // Top-right + bottom-left copy
    // bits 0..7 at row 8, columns size-1..size-8
    for (var i4 = 0; i4 <= 7; i4++) m[8][size - 1 - i4] = getBit(i4);
    // bits 8..14 at column 8, rows size-7..size-1
    for (var i5 = 8, r = size - 7; i5 <= 14; i5++, r++) m[r][8] = getBit(i5);

    // Dark module (always 1) is already placed by placeFunctionPatterns.
  }

  function writeVersionInfo(m, version) {
    if (version < 7) return;
    var size = m.length;
    var v = VERSION_INFO[version - 7]; // 18-bit value, MSB at bit 17
    // Top-right block: 6 rows x 3 cols at (rows 0..5, cols size-11..size-9)
    // Bottom-left block: 3 rows x 6 cols at (rows size-11..size-9, cols 0..5)
    // Bit ordering per ISO Annex D / Figure 26:
    //   The 18 bits b17 .. b0 are placed at:
    //     for i in 0..5 (rows):
    //       for j in 0..2 (cols):
    //         bitIndex = i*3 + j
    //   into top-right at (i, size-11+j) and bottom-left at (size-11+j, i),
    //   with bit 0 = LSB.
    for (var i = 0; i < 6; i++) {
      for (var j = 0; j < 3; j++) {
        var bitIdx = i * 3 + j;
        var bit = (v >> bitIdx) & 1;
        m[i][size - 11 + j] = bit;
        m[size - 11 + j][i] = bit;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public encode()
  // ---------------------------------------------------------------------------

  function encode(text, options) {
    options = options || {};
    var ecLevel = options.ecLevel || 'H';
    if (!(ecLevel in EC_LEVELS)) throw new Error('Invalid ecLevel: ' + ecLevel);
    var minVersion = options.minVersion || 1;
    var maxVersion = options.maxVersion || 40;
    var forcedMask = (options.mask !== undefined && options.mask !== null) ? options.mask : null;

    var data = utf8Encode(text);
    var version;
    if (options.forceVersion) {
      version = options.forceVersion;
      // Make sure it actually fits
      var ecIdx = EC_LEVELS[ecLevel];
      var capBits = totalDataCodewords(version, ecIdx) * 8;
      var needBits = 4 + characterCountIndicatorBits(version) + data.length * 8;
      if (needBits > capBits) {
        throw new Error('Data does not fit in forced version ' + version + ' at level ' + ecLevel);
      }
    } else {
      version = pickVersion(data.length, ecLevel, minVersion, maxVersion);
      if (!version) throw new Error('Data too long for QR (max ~2953 bytes at level L, much less at H)');
    }

    var bitstream = buildBitStream(data, version, ecLevel);
    var codewords = buildCodewords(bitstream, version, ecLevel);

    var size = 17 + 4 * version;

    // Build a fresh matrix per mask candidate, then mask it, then evaluate.
    function buildMatrixForMask(maskNum) {
      var m = makeMatrix(size);
      var reserved = new Array(size);
      for (var y = 0; y < size; y++) reserved[y] = new Array(size).fill(false);
      placeFunctionPatterns(m, reserved, version);
      placeData(m, reserved, codewords);
      applyMask(m, reserved, maskNum);
      writeFormatInfo(m, ecLevel, maskNum);
      writeVersionInfo(m, version);
      return m;
    }

    var chosen;
    if (forcedMask !== null) {
      chosen = { mask: forcedMask, matrix: buildMatrixForMask(forcedMask), penalty: null };
    } else {
      chosen = pickBestMask(buildMatrixForMask);
    }

    return {
      text: text,
      mode: 'byte',
      version: version,
      ecLevel: ecLevel,
      mask: chosen.mask,
      maskPenalty: chosen.penalty,
      size: size,
      modules: chosen.matrix,
      reserved: buildReserved(version, size), // function patterns + format/version info
      dataCodewords: bitstream,
      allCodewords: codewords,
    };
  }

  // Standalone reserved-area builder so callers (damage tolerance) can
  // distinguish data modules from function patterns without re-running the
  // encoder. Returns a size-by-size boolean grid.
  function buildReserved(version, size) {
    var dummyM = makeMatrix(size);
    var reserved = new Array(size);
    for (var y = 0; y < size; y++) reserved[y] = new Array(size).fill(false);
    placeFunctionPatterns(dummyM, reserved, version);
    return reserved;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers exposed for tests
  // ---------------------------------------------------------------------------

  T.QR = {
    encode: encode,
    findTattooOptimal: findTattooOptimal,
    // Internals (exposed for tests/diagnostics — not part of the stable API):
    _internals: {
      EC_BLOCKS: EC_BLOCKS,
      ALIGN_POS: ALIGN_POS,
      FORMAT_INFO: FORMAT_INFO,
      VERSION_INFO: VERSION_INFO,
      utf8Encode: utf8Encode,
      pickVersion: pickVersion,
      buildBitStream: buildBitStream,
      buildCodewords: buildCodewords,
      maskPenalty: maskPenalty,
      MASK_FNS: MASK_FNS,
      totalDataCodewords: totalDataCodewords,
      characterCountIndicatorBits: characterCountIndicatorBits,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
