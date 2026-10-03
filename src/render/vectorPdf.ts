// ============================================================================
// src/render/vectorPdf.ts — a recorded board as a one-page PDF 1.4, by hand.
//
// No library: the file is small and regular enough to write directly, and
// writing it here means every byte is known — which is what lets a test parse
// the xref table back and check that each offset lands on its "n 0 obj".
//
//   page      one, sized to the figure: 1 CSS px = 0.75 pt (96 px per inch);
//   paths     m/l/c/h in points, y flipped; arcs as ≤ 90° cubic Béziers;
//   paint     RGB `rg`/`RG`, width `w`, caps `J`, joins `j`, miter `M`,
//             dash `d`; alpha through one ExtGState per (fill, stroke) pair;
//   clips     `q <path> W n … Q`, nested along each item's clip chain;
//   text      the standard 14 fonts, never embedded: Helvetica (or Times for a
//             serif figure, Courier for mono) in WinAnsiEncoding.
//
// GLYPHS OUTSIDE WINANSI. The board writes a true minus, π, √, ∞, θ, primes,
// and sub/superscript digits (P₀, x²). Each is handled so it cannot break the
// file or silently turn into a box:
//   −            → WinAnsi en dash (0x96): the minus's own width and height;
//   π θ √ ∞ ≈ ≤ ≥ ≠ ′ Δ … → the standard Symbol font, glyph by glyph, in the
//                  same BT block (a Tf switch between runs);
//   ₀–₉ ⁰–⁹ ⁻ ⁺  → the digit itself at 70 % size, lowered or raised with Ts;
//   ✓ ✔ ✗ ✘      → the standard ZapfDingbats font (built-in encoding, never
//                  embedded): a19 (code 51), a20 (52), a23 (55), a24 (56) —
//                  the Unicode Dingbats block is ZapfDingbats in order,
//                  U+2713 ✓ = 0x33, U+2717 ✗ = 0x37;
//   ‘ ’ “ ” – — … • and Latin-1 → their WinAnsi codes;
//   anything else → "?". Nothing outside ASCII ever reaches the file raw:
//                  every byte above 126 in a string is written as \ddd.
// ============================================================================

import { SYMBOL_GLYPHS, glyphWidth } from './fontMetrics'
import type { FontFace } from './fontMetrics'
import type { DisplayList, FontSpec, PathItem, Rgba, Seg, TextItem } from './vectorCtx'
import { arcToBeziers, clipChain } from './vectorCtx'
import { num } from './vectorSvg'

/** 1 CSS px in PDF points. */
export const PT_PER_PX = 0.75

const WINANSI_HIGH: Readonly<Record<string, number>> = {
  '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '−': 0x96,
}

const SUP: Readonly<Record<string, string>> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8',
  '⁹': '9', '⁻': '-', '⁺': '+', 'ⁿ': 'n', 'ⁱ': 'i', 'ˣ': 'x',
}
const SUB: Readonly<Record<string, string>> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8',
  '₉': '9', '₋': '-', '₊': '+', 'ₙ': 'n', 'ₓ': 'x', 'ᵢ': 'i', 'ₖ': 'k', 'ₐ': 'a',
}

/** ZapfDingbats glyphs: [code in its built-in encoding, advance in 1/1000 em] (AFM). */
const DINGBATS: Readonly<Record<string, readonly [number, number]>> = {
  '✓': [0x33, 755], // a19
  '✔': [0x34, 846], // a20
  '✗': [0x37, 571], // a23
  '✘': [0x38, 677], // a24
}

/** Fonts with their own built-in encoding (no /Encoding /WinAnsiEncoding). */
const SYMBOLIC_FONTS = new Set(['Symbol', 'ZapfDingbats'])

/** Size and shift of a sub/superscript, as fractions of the font size. */
const SCRIPT_SIZE = 0.7
const SUP_RISE = 0.38
const SUB_RISE = -0.18

/** The base font a label is set in. */
function baseFont(f: FontSpec): { name: string; face: FontFace } {
  const style = f.bold && f.italic ? 3 : f.bold ? 2 : f.italic ? 1 : 0
  if (f.generic === 'serif') {
    return { name: ['Times-Roman', 'Times-Italic', 'Times-Bold', 'Times-BoldItalic'][style], face: 'times' }
  }
  if (f.generic === 'monospace') {
    return { name: ['Courier', 'Courier-Oblique', 'Courier-Bold', 'Courier-BoldOblique'][style], face: 'courier' }
  }
  return {
    name: ['Helvetica', 'Helvetica-Oblique', 'Helvetica-Bold', 'Helvetica-BoldOblique'][style],
    face: f.bold ? 'helvetica-bold' : 'helvetica',
  }
}

export interface TextRun {
  /** BaseFont name: 'Helvetica', 'Symbol', … */
  font: string
  /** Single-byte codes in that font's encoding. */
  codes: number[]
  /** Size as a fraction of the label's size. */
  scale: number
  /** Baseline shift as a fraction of the label's size. */
  rise: number
  /** Advance width in em of the label's size. */
  width: number
}

/** A label split into runs the standard fonts can set. */
export function pdfTextRuns(text: string, f: FontSpec): TextRun[] {
  const base = baseFont(f)
  const runs: TextRun[] = []
  const add = (font: string, code: number, scale: number, rise: number, w1000: number): void => {
    const last = runs[runs.length - 1]
    const w = (w1000 / 1000) * scale
    if (last && last.font === font && last.scale === scale && last.rise === rise) {
      last.codes.push(code)
      last.width += w
    } else {
      runs.push({ font, codes: [code], scale, rise, width: w })
    }
  }
  const baseCode = (ch: string): number | null => {
    const c = ch.codePointAt(0) ?? 63
    if (c >= 32 && c <= 126) return c
    const hi = WINANSI_HIGH[ch]
    if (hi !== undefined) return hi
    if (c >= 0xa0 && c <= 0xff) return c
    return null
  }
  // The parallel signs have no glyph in WinAnsi, Symbol or ZapfDingbats: the
  // standard fonts print them as two ASCII bars, which is how they are read.
  const expanded = text.replace(/[\u2225\u2016]/g, '||')
  for (const ch of expanded) {
    // Scripts first: ² and ³ exist in WinAnsi but ⁴ does not, and x² beside
    // x⁴ must not come out in two different sizes.
    const script = SUP[ch] !== undefined ? SUP[ch] : SUB[ch]
    if (script !== undefined) {
      const code = script.charCodeAt(0)
      add(base.name, code, SCRIPT_SIZE, SUP[ch] !== undefined ? SUP_RISE : SUB_RISE, glyphWidth(code, base.face))
      continue
    }
    const direct = baseCode(ch)
    if (direct !== null) {
      add(base.name, direct, 1, 0, glyphWidth(direct, base.face))
      continue
    }
    const sym = SYMBOL_GLYPHS[ch]
    if (sym) {
      add('Symbol', sym[0], 1, 0, sym[1])
      continue
    }
    const ding = DINGBATS[ch]
    if (ding) {
      add('ZapfDingbats', ding[0], 1, 0, ding[1])
      continue
    }
    add(base.name, 63, 1, 0, glyphWidth(63, base.face)) // '?'
  }
  return runs
}

/** A PDF literal string for single-byte codes; nothing above 126 is written raw. */
export function pdfString(codes: readonly number[]): string {
  let s = '('
  for (const c of codes) {
    if (c === 0x28 || c === 0x29 || c === 0x5c) s += '\\' + String.fromCharCode(c)
    else if (c < 32 || c > 126) s += '\\' + c.toString(8).padStart(3, '0')
    else s += String.fromCharCode(c)
  }
  return s + ')'
}

/** A text string (for /Info) as UTF-16BE hex. */
function pdfTextString(s: string): string {
  let hex = 'FEFF'
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase()
  return `<${hex}>`
}

const rgb = (c: Rgba): string => `${num(c.r / 255, 3)} ${num(c.g / 255, 3)} ${num(c.b / 255, 3)}`

const CAP = { butt: 0, round: 1, square: 2 } as const
const JOIN = { miter: 0, round: 1, bevel: 2 } as const

export interface PdfOptions {
  /** Points per device unit; default 0.75 (CSS px → pt). */
  ptPerPx?: number
  title?: string
}

/** Font and transparency resources shared by every page of one file. */
interface PdfResources {
  fontRes(name: string): string
  gs(fill: number, stroke: number): string | null
  fonts: Map<string, string>
  states: Map<string, string>
}

function pdfResources(): PdfResources {
  const fonts = new Map<string, string>() // BaseFont → /Fn
  const states = new Map<string, string>() // "ca|CA" → /GSn
  return {
    fonts,
    states,
    fontRes(name: string): string {
      let r = fonts.get(name)
      if (!r) {
        r = `F${fonts.size + 1}`
        fonts.set(name, r)
      }
      return r
    },
    gs(fill: number, stroke: number): string | null {
      const ca = Math.max(0, Math.min(1, fill))
      const CA = Math.max(0, Math.min(1, stroke))
      if (ca >= 0.9995 && CA >= 0.9995) return null
      const key = `${num(ca, 3)}|${num(CA, 3)}`
      let r = states.get(key)
      if (!r) {
        r = `GS${states.size + 1}`
        states.set(key, r)
      }
      return r
    },
  }
}

/** One display list as a page content stream, in points, y flipped. */
function pdfContent(list: DisplayList, k: number, res: PdfResources): string {
  const Hpt = list.height * k
  const X = (x: number): string => num(x * k)
  const Y = (y: number): string => num(Hpt - y * k)
  const { fontRes, gs } = res

  const pathOps = (segs: readonly Seg[]): string => {
    const out: string[] = []
    for (const s of segs) {
      switch (s.k) {
        case 'M': out.push(`${X(s.x)} ${Y(s.y)} m`); break
        case 'L': out.push(`${X(s.x)} ${Y(s.y)} l`); break
        case 'C': out.push(`${X(s.x1)} ${Y(s.y1)} ${X(s.x2)} ${Y(s.y2)} ${X(s.x)} ${Y(s.y)} c`); break
        case 'A':
          for (const b of arcToBeziers(s.cx, s.cy, s.r, s.a0, s.sweep)) {
            out.push(`${X(b[0])} ${Y(b[1])} ${X(b[2])} ${Y(b[3])} ${X(b[4])} ${Y(b[5])} c`)
          }
          break
        case 'Z': out.push('h'); break
      }
    }
    return out.join('\n')
  }

  const pathItem = (it: PathItem): string => {
    const out: string[] = ['q']
    const g = gs(it.fill ? it.fill.a : 1, it.stroke ? it.stroke.color.a : 1)
    if (g) out.push(`/${g} gs`)
    if (it.fill) out.push(`${rgb(it.fill)} rg`)
    const s = it.stroke
    if (s) {
      out.push(`${rgb(s.color)} RG`, `${num(s.width * k, 3)} w`, `${CAP[s.cap]} J`, `${JOIN[s.join]} j`)
      if (s.join === 'miter') out.push(`${num(s.miter)} M`)
      if (s.dash.length > 0) {
        out.push(`[${s.dash.map((d) => num(d * k, 3)).join(' ')}] ${num(s.dashOffset * k, 3)} d`)
      }
    }
    out.push(pathOps(it.segs))
    out.push(it.fill && s ? 'B' : it.fill ? 'f' : 'S')
    out.push('Q')
    return out.join('\n')
  }

  const textItem = (it: TextItem): string => {
    const runs = pdfTextRuns(it.text, it.font)
    if (runs.length === 0) return ''
    const size = it.font.size * k
    const width = runs.reduce((w, r) => w + r.width, 0) * size
    const x0 = it.x * k - (it.anchor === 'middle' ? width / 2 : it.anchor === 'end' ? width : 0)
    const out: string[] = ['q']
    const g = gs(it.color.a, 1)
    if (g) out.push(`/${g} gs`)
    out.push(`${rgb(it.color)} rg`, 'BT', `${num(x0)} ${Y(it.y)} Td`)
    let rise = 0
    for (const r of runs) {
      out.push(`/${fontRes(r.font)} ${num(size * r.scale, 3)} Tf`)
      if (r.rise !== rise) {
        out.push(`${num(size * r.rise, 3)} Ts`)
        rise = r.rise
      }
      out.push(`${pdfString(r.codes)} Tj`)
    }
    out.push('ET', 'Q')
    return out.join('\n')
  }

  const body: string[] = []
  const open: number[] = []
  for (const it of list.items) {
    const chain = clipChain(list, it.clip)
    let keep = 0
    while (keep < open.length && keep < chain.length && open[keep] === chain[keep]) keep++
    while (open.length > keep) {
      body.push('Q')
      open.pop()
    }
    for (let i = keep; i < chain.length; i++) {
      const c = list.clips[chain[i] - 1]
      body.push('q', pathOps(c.segs), 'W n')
      open.push(chain[i])
    }
    const s = it.t === 'path' ? pathItem(it) : textItem(it)
    if (s) body.push(s)
  }
  while (open.length > 0) {
    body.push('Q')
    open.pop()
  }
  return body.join('\n') + '\n'
}

/** The /Font and /ExtGState dictionaries' entries, numbered from `firstFont`. */
function resourceObjects(res: PdfResources, firstFont: number): { dict: string; objects: string[] } {
  const fontList = [...res.fonts.entries()]
  const stateList = [...res.states.entries()]
  const firstState = firstFont + fontList.length
  const fontDict = fontList.map(([, r], i) => `/${r} ${firstFont + i} 0 R`).join(' ')
  const stateDict = stateList.map(([, r], i) => `/${r} ${firstState + i} 0 R`).join(' ')
  const objects: string[] = []
  for (const [name] of fontList) {
    objects.push(
      SYMBOLIC_FONTS.has(name)
        ? `<< /Type /Font /Subtype /Type1 /BaseFont /${name} >>`
        : `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`,
    )
  }
  for (const [key] of stateList) {
    const [ca, CA] = key.split('|')
    objects.push(`<< /Type /ExtGState /ca ${ca} /CA ${CA} >>`)
  }
  const dict =
    `/Resources << /ProcSet [/PDF /Text]` +
    (fontDict ? ` /Font << ${fontDict} >>` : '') +
    (stateDict ? ` /ExtGState << ${stateDict} >>` : '') +
    ` >>`
  return { dict, objects }
}

/** Objects 1..n as a file, with its xref table and trailer. */
function pdfFile(objects: readonly string[], infoObj: number): string {
  // The second line is the customary binary marker: four bytes above 127 tell
  // a transfer program this is not a text file.
  let pdf = '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n'
  const offsets: number[] = []
  objects.forEach((o, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xrefAt = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  return pdf
}

const infoObject = (title: string | undefined): string =>
  `<< /Producer (Grapher)` + (title ? ` /Title ${pdfTextString(title)}` : '') + ' >>'

/**
 * The PDF as a string of single-byte characters (every char code ≤ 255), so
 * its length IS its byte length. Use toPdf() for the bytes.
 */
export function toPdfString(list: DisplayList, opts: PdfOptions = {}): string {
  const k = opts.ptPerPx ?? PT_PER_PX
  const Wpt = list.width * k
  const Hpt = list.height * k
  const res = pdfResources()
  const content = pdfContent(list, k, res)
  // 1 catalog, 2 pages, 3 page, 4 contents, 5 info, then fonts, then states.
  const { dict, objects: resObjs } = resourceObjects(res, 6)
  const objects: string[] = []
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(Wpt)} ${num(Hpt)}] ${dict} /Contents 4 0 R >>`,
  )
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`)
  objects.push(infoObject(opts.title))
  objects.push(...resObjs)
  return pdfFile(objects, 5)
}

/**
 * Several display lists as the pages of ONE PDF, in order — a worksheet.
 * Every page shares one set of font and transparency resources.
 *
 *   1 catalog, 2 pages, 3 info, then (page, contents) per page, then the
 *   fonts, then the graphics states.
 */
export function toPdfPagesString(lists: readonly DisplayList[], opts: PdfOptions = {}): string {
  if (lists.length === 0) throw new Error('a PDF needs at least one page')
  const k = opts.ptPerPx ?? PT_PER_PX
  const res = pdfResources()
  const contents = lists.map((l) => pdfContent(l, k, res))
  const firstFont = 4 + 2 * lists.length
  const { dict, objects: resObjs } = resourceObjects(res, firstFont)
  const pageObj = (i: number): number => 4 + 2 * i
  const objects: string[] = []
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push(
    `<< /Type /Pages /Kids [${lists.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${lists.length} >>`,
  )
  objects.push(infoObject(opts.title))
  lists.forEach((l, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(l.width * k)} ${num(l.height * k)}] ${dict} /Contents ${pageObj(i) + 1} 0 R >>`,
    )
    objects.push(`<< /Length ${contents[i].length} >>\nstream\n${contents[i]}endstream`)
  })
  objects.push(...resObjs)
  return pdfFile(objects, 3)
}

/** The bytes of a multi-page PDF. */
export function toPdfPages(lists: readonly DisplayList[], opts: PdfOptions = {}): Uint8Array {
  return latin1Bytes(toPdfPagesString(lists, opts))
}

const latin1Bytes = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

/** The PDF file's bytes. */
export function toPdf(list: DisplayList, opts: PdfOptions = {}): Uint8Array {
  return latin1Bytes(toPdfString(list, opts))
}
