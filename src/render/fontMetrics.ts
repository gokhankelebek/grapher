// ============================================================================
// src/render/fontMetrics.ts — advance widths of the PDF standard fonts.
//
// Two users:
//   * the PDF writer, which must know how wide Helvetica / Times / Courier /
//     Symbol set a string to honour a label's centre or right alignment (the
//     viewer sets the glyphs with these same built-in metrics);
//   * the recording context in node, where there is no canvas to measure with
//     and the renderer still needs plausible widths to lay labels out.
//
// Units are 1/1000 em, the AFM convention. Helvetica and Courier are exact
// (Adobe's AFM files); Times is the roman face, used for italic too, which is
// within a few per cent — the only effect is a sub-pixel alignment shift.
// ============================================================================

/** Helvetica, codes 32–126. */
const HELV: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]

/** Helvetica-Bold, codes 32–126. */
const HELV_BOLD: readonly number[] = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
]

/** Times-Roman, codes 32–126. */
const TIMES: readonly number[] = [
  250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278,
  500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444,
  921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722,
  556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500,
  333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500,
  500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541,
]

/** Widths of the WinAnsi upper half the PDF writer uses (Helvetica). */
export const HELV_HIGH: Readonly<Record<number, number>> = {
  0x85: 1000, // …
  0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, // ‘ ’ “ ”
  0x95: 350, // •
  0x96: 556, // –  (the minus stands in as an en dash)
  0x97: 1000, // —
  0xb0: 400, // °
  0xb1: 584, // ±
  0xb2: 333, 0xb3: 333, 0xb9: 333, // ² ³ ¹
  0xb5: 556, // µ
  0xb7: 278, // ·
  0xd7: 584, // ×
  0xf7: 584, // ÷
}

/** Symbol-font glyphs the PDF writer draws, by Unicode char → [code, width]. */
export const SYMBOL_GLYPHS: Readonly<Record<string, readonly [number, number]>> = {
  'π': [0x70, 549], 'θ': [0x71, 521], 'α': [0x61, 631], 'β': [0x62, 549], 'γ': [0x67, 411],
  'δ': [0x64, 494], 'ε': [0x65, 439], 'λ': [0x6c, 549], 'μ': [0x6d, 576], 'σ': [0x73, 603],
  'φ': [0x66, 521], 'ω': [0x77, 686], 'Δ': [0x44, 612], 'Σ': [0x53, 592], 'Ω': [0x57, 768],
  'τ': [0x74, 439], 'ρ': [0x72, 549],
  '√': [0xd6, 549], '∞': [0xa5, 713], '≈': [0xbb, 549], '≤': [0xa3, 549], '≥': [0xb3, 549],
  '≠': [0xb9, 549], '′': [0xa2, 247], '″': [0xb2, 411], '∫': [0xf2, 274], '→': [0xae, 987],
  '⋅': [0xd7, 250], '∈': [0xce, 713], '∪': [0xc8, 768], '∩': [0xc7, 768], '∠': [0xd0, 768],
  '⇒': [0xde, 987], '∂': [0xb6, 494], '∑': [0xe5, 713], '≡': [0xba, 549], '∅': [0xc6, 823],
}

export type FontFace = 'helvetica' | 'helvetica-bold' | 'times' | 'courier'

/** Advance width in 1/1000 em of one WinAnsi code in a face. */
export function glyphWidth(code: number, face: FontFace): number {
  if (face === 'courier') return 600
  if (code >= 32 && code <= 126) {
    const t = face === 'times' ? TIMES : face === 'helvetica-bold' ? HELV_BOLD : HELV
    return t[code - 32]
  }
  const hi = HELV_HIGH[code]
  if (hi !== undefined) return face === 'times' ? hi * 0.9 : hi
  // Latin-1 letters and the rest of the upper half: a typical lowercase width.
  return face === 'times' ? 500 : 556
}

const SUB_SUP = /[⁰-₟²³¹]/

/**
 * Estimated width of a string in em, for measuring without a canvas. Sub- and
 * superscript characters count at 0.7 of a digit; anything outside Latin-1
 * and the Symbol table counts as a typical glyph.
 */
export function textWidthEstimate(
  text: string,
  generic: 'sans-serif' | 'serif' | 'monospace',
  bold = false,
): number {
  const face: FontFace =
    generic === 'monospace' ? 'courier' : generic === 'serif' ? 'times' : bold ? 'helvetica-bold' : 'helvetica'
  let w = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 63
    if (face === 'courier') w += 600
    else if (c >= 32 && c <= 126) w += glyphWidth(c, face)
    else if (ch === '−') w += 584
    else if (SUB_SUP.test(ch)) w += 0.7 * 556
    else if (SYMBOL_GLYPHS[ch]) w += SYMBOL_GLYPHS[ch][1]
    else if (c < 256) w += glyphWidth(c, face)
    else w += 556
  }
  return w / 1000
}
