# Permanence: defense in depth

Tessera is built on the assumption that a QR code generator's output may need to remain decodable for **decades**. For a QR code being tattooed onto skin, "good enough" isn't.

Correctness is treated as a multi-layered problem. The QR is only released for download once **every layer agrees** it's sound. Failure requires *all* layers to fail simultaneously, which is engineering-equivalent to impossible.

## Layer 1: The format itself is permanent

QR is **ISO/IEC 18004**, an international standard ratified in 2000 and revised in compatible ways since. Trillions of QR codes have been deployed worldwide. Decoders exist:

- **Natively in every iPhone since iOS 11 (2017)**: the Camera app auto-detects QR.
- **Natively in every Android since 2019**: Google Lens / ML Kit Vision in the Camera app.
- **In every payment terminal, supermarket scanner, airport boarding-pass reader, restaurant menu scanner.**

The infrastructure to read QR codes is not optional for the global economy. Phones and scanners will continue to read them for the rest of any human life now alive. This is not a guess; it's economic and infrastructural certainty.

If the QR format itself is ever superseded, the world will spend decades supporting the legacy format because of the sheer install base. Cassette tapes, written in the 1960s, still play in 2026 on devices manufactured this year. QR is in that class.

## Layer 2: Spec-compliance, mathematically verified

Tessera's encoder is verified against the **ISO/IEC 18004 Annex I worked example**, the standard's *own* published test vector. This is the gold-standard test: if Tessera's output for the spec's example matches the spec's published expected output, then Tessera agrees with the standard itself.

The Annex I example encodes the alphanumeric string `"01234567"` as a 1-M QR code. The spec walks through every step:

1. Mode and character-count indicator
2. Data bit stream
3. Codeword sequence (after padding)
4. Reed-Solomon error correction codewords
5. Final codeword interleaving
6. Module placement and masking
7. Final masked matrix

Tessera's `tests/test-iso-vector.js` checks **every intermediate step**, not just the final matrix. If any stage diverges from the spec, the test fails loudly and the deploy is blocked.

> Note: an earlier draft of this project planned to additionally cross-check against `qrencode` and `python-qrcode` reference implementations. That comparison was dropped after determining that the ISO Annex I vector is *the* canonical test, and that round-trip decoding by three independent decoders (Layer 3) provides equivalent cross-implementation evidence with stronger guarantees (those decoders are what *actually* read the QR, which is what matters for a tattoo).

## Layer 3: Round-trip decoding by multiple independent decoders

Every QR Tessera produces is **decoded back to text** before the download buttons enable. Three independent decoders are used:

| Decoder | Origin | Why it matters |
|---|---|---|
| **jsQR** | [cozmo/jsQR](https://github.com/cozmo/jsQR) | Most-used pure-JS decoder; powers many web QR apps |
| **zxing-js** | [zxing-js/library](https://github.com/zxing-js/library) | Direct port of Google's ZXing, the canonical reference, used in Android ML Kit |
| **`BarcodeDetector`** | Browser-native (Chrome, Edge, Safari iOS 17+) | Calls the **OS-level decoder**, the same code iPhones and Androids use in the camera app |

Three independent codebases, three independent algorithmic traditions. Verification passes iff:
1. **At least one decoder successfully decoded** the QR (else nothing actually read it back, so the QR isn't *verified*; it just exists).
2. **Every decoder that succeeded returned the exact original input text** (silent mismatches are the dangerous failure mode; that's an encoder bug producing a "valid-looking but wrong" QR, and verification fails immediately if any decoder reports a mismatch).

The UI separately reports the **redundancy level**: how many decoders agreed (1, 2, or 3). When `BarcodeDetector` is available (Chrome/Edge desktop, Safari iOS 17+) and zxing-js doesn't trip on its own quirks, redundancy = 3, the strongest cross-check. In headless CI environments or older browsers, redundancy may be 1 or 2; that's still a passing verification, just with a more visible cross-check footprint shown in the readout. The reason this rule was chosen rather than "all decoders must succeed": zxing-js (port of the canonical Google ZXing, used by Android ML Kit) has known quirks on small computer-rendered QRs that have nothing to do with this encoder; if jsQR + native both agree, that's already strong evidence of correctness.

`BarcodeDetector` availability varies by browser; when it's not available, Tessera proceeds with jsQR + zxing-js (and clearly indicates this in the verification readout).

## Layer 4: Damage tolerance simulation

Tattoos don't fail through hard "blot" cover-ups. They fail through gradual **ink bleed and edge softening**: a year of normal skin life rounds the corners of the modules, ten years blurs them appreciably, thirty years can leave the QR a soft watercolor. This is the failure mode Tessera simulates and tests against.

The damage model is a **Gaussian blur** applied to the rendered QR canvas at a radius proportional to the chosen severity:

1. Render the QR onto a clean canvas at high resolution (20 px per module).
2. Apply a Gaussian blur with radius = (severity / 100) × moduleSize × 3. So 5% ≈ one-sixth of a module of blur, 30% ≈ nearly a full module of blur.
3. Re-run the round-trip decoders against the blurred image.
4. Repeat at 0%, 5%, 10%, 15%, 20%, 25%, 30%. Blur is deterministic, so a single trial per level is enough.
5. Record the highest level at which the QR still decoded correctly.

Reading the severity scale in tattoo-aging terms:

- **0%**: pristine, the day after the tattoo heals.
- **5%**: a fresh-ish tattoo after a few years; just-perceptible softening.
- **15%**: ~15-year-old tattoo with normal aging on a forearm or calf.
- **30%**: heavily blurred. A 30+ year-old tattoo, or a poorly placed/maintained one, or a small dense one that ran together early.

The **permanence bar** is **5% blur tolerated**. Every QR Tessera generates is swept through all seven levels on load, and the highest level the decoders still read is reported on the live tolerance log next to the damage preview.

Why a binary OK/FAIL per level rather than a pass-rate? Blur is deterministic; there's no random variable to average over. The test is "at this exact blur radius, do any decoders still read the exact input back?" — a clean, reproducible yes-or-no.

Importantly, the actual measured tolerance for *your* QR is shown live in the UI and recorded on the spec sheet. If your input pushes the QR up to v6 or v10 (more redundancy per block), you'll see and record a much higher tolerance number. The 5% bar is just the floor below which Tessera won't ship.

> **Why finders aren't damaged in this model.** Gaussian blur affects every pixel uniformly, including the finder patterns. That's faithful to real tattoos: ink bleed doesn't respect the spec. But the blur scale is calibrated so the finders are still detectable up to severe damage levels; losing the finders means losing detection entirely, with no recovery path. If a real tattoo gets so blurry the decoder can't find it, the recommendation is "ask the artist to touch it up", not "rely on a spec layer that wasn't designed for finder loss".

Real-world tattoo failure modes (ink spread, fading) usually correspond to blur levels far less than 10% on the Tessera scale. A QR that survives 10% blur in this simulation will almost certainly survive normal aging at sensible module sizes.

> **Why fewer modules win for tattoos.** Higher EC levels (H over Q) buy more algorithmic damage recovery, but they pay for it in *more modules* for the same data. For tattoos, the failure mode is blur, and what helps with blur is **physical module size**, not algorithmic recovery: bigger modules ⇒ more skin per module ⇒ more margin before edges merge with neighbors ⇒ more pixels per module when a phone reads it. The artist's needle has its own resolution limit (about 0.3 mm dots), which puts a hard floor on viable module size. So Tessera's tattoo-optimal recommendation is the *smallest version that fits the data at any EC level*, with the *highest EC level that fits at that version*: maximum module size, with whatever EC headroom is still available. The generator's tattoo-specs panel suggests this combination automatically and lets you apply it with one click.

> Note: damage tolerance is **reported, not gated**. Downloads are gated on round-trip verification (Layer 3), which is the hard correctness check. Damage tolerance is informational; the headline claim is "verified-correct encoder + at-least-this-much blur tolerance".

## Layer 5: Multi-format archival output

For each successful generation, Tessera emits:

- **Primary QR**: smallest version that fits the data at level H. Densest visual, biggest individual modules (more tolerant of small-scale damage).
- **Backup QR**: same data, forced to next version up. More redundancy at the cost of slightly smaller modules. Useful as a backup file or a wallet-card print.
- **Specification sheet**: a printable HTML page (also exportable as PDF via the browser's "Save as PDF") containing:

  - The QR rendered at multiple physical sizes (3 cm, 5 cm, 7 cm, 10 cm) for the artist.
  - The encoded URL in plain text.
  - Version, EC level, mask number, module dimensions.
  - Generation date and time.
  - **The full module matrix as ASCII art and as a hex dump.**
  - SHA-256 of the source code that generated it.
  - Round-trip verification results.
  - Damage tolerance test results.
  - Reproduction instructions.

The matrix dump is the doomsday backup. If every digital file is lost in 30 years, the QR can be reconstructed by hand from the printed paper.

## Layer 6: Open-source auditability

The repo is public. Anyone can:

- Read the encoder source. It's a few hundred lines of vanilla JS, no transpilation, no hidden behavior.
- Run the test suite locally (just open `tests.html`).
- Verify the deployed code passes its own tests by visiting `/tests.html` on the live site.
- Compute the SHA-256 of `src/qr.js` and compare it to the hash printed on the spec sheet, as proof that the code that generated *your* QR is the code in this commit.

The correctness of your tattoo is **publicly verifiable forever**.

## What this project doesn't claim

Tessera does **not** claim "100% guaranteed correct forever." That claim is unfalsifiable and unscientific. The actual claim:

> Verified correct against the ISO/IEC 18004 spec's own test vector, round-trip-tested by up to three independent decoders (with the redundancy level recorded), damage-tolerant under a Gaussian-blur stress test (with the actual measured tolerance recorded for every QR), and open-source auditable.

That is the strongest honest claim possible. It is stronger than any commercial QR generator offers.
