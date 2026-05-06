# How QR encoding works (plain English)

This is a quick-reference summary of the QR encoding pipeline, oriented around how Tessera implements it. For the full normative reference, see ISO/IEC 18004:2015. For a free deep-dive, see [Project Nayuki's QR explainer](https://www.nayuki.io/page/creating-a-qr-code-step-by-step).

## The big picture

A QR code is a square grid of black and white *modules*. The grid encodes:

- **Format info** — what error-correction level was used, which mask is applied (small region, near corners).
- **Version info** — the size of the QR (only present for versions 7+).
- **Function patterns** — the three big square "finder" patterns in the corners, the timing patterns, and small alignment patterns. These help scanners locate and orient the code.
- **Data + ECC** — everything else. This is the bulk of the matrix.

The encoder's job is to turn input text into the data+ECC stream and place it correctly into the matrix, then apply the best-of-eight masking pattern, then write the format and version info on top.

## The encoding pipeline

### 1. Choose mode

QR has four built-in modes, each with different efficiency:

| Mode | Best for | Bits per char (roughly) |
|---|---|---|
| Numeric | digits only | 3.33 |
| Alphanumeric | uppercase A–Z, digits, `$%*+-./:` and space | 5.5 |
| Byte | anything (UTF-8 in practice) | 8 |
| Kanji | Shift-JIS double-byte | 13 per 2 chars |

**Tessera defaults to Byte mode** because URLs typically include lowercase letters and `?=&` characters that aren't in the alphanumeric set. Byte mode handles arbitrary UTF-8.

### 2. Choose version (size)

There are 40 versions, from v1 (21×21 modules) to v40 (177×177 modules). Each step up adds 4 modules per side.

The encoder picks the **smallest** version that fits the data at the chosen error-correction level. Smaller version → bigger individual modules at any given physical print size → easier to scan from far away or with damage.

### 3. Choose error-correction level

Four levels, defined by how much of the matrix is redundant ECC:

| Level | Recovery capacity |
|---|---|
| L | ~7% |
| M | ~15% |
| Q | ~25% |
| **H** | **~30%** |

**Tessera defaults to H** — the most redundant — because permanence is the whole point.

### 4. Build the bit stream

```
[mode indicator: 4 bits]
[character-count indicator: 8/16 bits depending on version]
[encoded data]
[terminator: up to 4 zero bits]
[byte-align padding]
[pad bytes 0xEC, 0x11 alternating until capacity]
```

### 5. Reed–Solomon error correction

The data is split into one or more *blocks* (table in the spec). Each block gets RS error-correction codewords appended. The number of EC codewords per block is fixed for each (version, level) combination.

RS encoding is polynomial division over GF(256) — the finite field of 256 elements built using the QR-specific primitive polynomial `0x11D` (x⁸ + x⁴ + x³ + x² + 1). Tessera implements GF(256) from scratch (`src/reed-solomon.js`) — under 200 lines.

### 6. Interleave codewords

Data codewords from each block are interleaved column-wise:
```
block1[0], block2[0], block3[0], ..., block1[1], block2[1], ...
```
Then EC codewords are appended in the same interleaved order. This spreads damage tolerance evenly across the matrix.

### 7. Place modules

Working from the bottom-right, snake upward in 2-column zig-zags, skipping the timing column. At each module position (that isn't a function pattern), write the next bit of the data+ECC stream.

### 8. Pick the best mask

There are 8 standard mask patterns. Each mask XORs a regular geometric pattern with the data area only — function patterns are never masked.

For each mask, the encoder computes a *penalty score* based on four heuristics (long runs of same-colour modules, 2×2 blocks of same colour, finder-pattern lookalikes, dark/light imbalance). The mask with the **lowest** penalty wins.

### 9. Write format and version info

The 5-bit format info (level + mask) is BCH-encoded to 15 bits and written near the corners. For version ≥ 7, the 6-bit version is BCH-encoded to 18 bits and written near the bottom-left and top-right corners.

### 10. Done

The matrix is ready to render.

## Tessera-specific notes

- All 40 versions and all 4 EC levels are implemented.
- Byte mode is the default; numeric/alphanumeric/kanji are not auto-selected (Byte handles everything correctly, just less efficiently).
- The mask scoring follows ISO/IEC 18004 §7.8.3 verbatim.
- Reed–Solomon uses LUT-based GF(256) multiplication for speed and simplicity.
