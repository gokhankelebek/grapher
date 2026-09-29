// ============================================================================
// src/ui/seqLinks.ts — sequences and series on the board, as plain data plus
// every pure question the board asks about them.
//
// src/core/sequences.ts does the mathematics: reading a_n = 3 + 4(n − 1), a
// recursion or a list of terms, evaluating terms, classifying them (d or r,
// both formulas), the partial sums and what the series does, and the
// continuous partner. None of that is STATE. What the board remembers is the
// same handful a slope field is:
//
//   the line as typed          "b_1 = 10, b_(n+1) = 0.5b_n"
//   the free constants         [a, d]            -> sliders
//   the index window           n = n0 … n0 + count − 1
//   two toggles                partner curve, partial sums
//
// Everything visible — the dots (n, aₙ), the rings (n, Sₙ), the dashed partner
// y = 4x − 1, the terms table, "arithmetic, d = 4", "Σ = 20" — is recomputed
// from that on every change, so dragging a slider moves every one of them.
//
// A sequence is NOT a curve: it holds no curve letter (f, g, h …). It names
// itself by its own head letter (a of a_n), and the board keeps those letters
// apart from curve names — a sequence refuses a letter a curve holds, a typed
// curve refuses a letter a sequence holds, and no curve is ever handed one
// automatically.
//
// Pure: no React, no DOM, no canvas. The App owns the state; this owns the
// meaning of it.
// ============================================================================

import type { ParamMeta, Polyline } from '../core/types'
import {
  classify,
  parseSequence,
  partialSums,
  partnerSource,
  sequenceSource,
  seriesInfo,
  terms,
} from '../core/sequences'
import type { SeqClass, SequenceDef, SequenceParse, SeriesInfo } from '../core/sequences'
import type { BoardSequence, SeqSeriesView } from '../core/persist'
import {
  SEQ_COUNT_DEFAULT,
  SEQ_COUNT_MAX,
  SEQ_COUNT_MIN,
  SERIES_N_SPAN,
  clampSeqCount,
  clampSeqN0,
} from '../core/persist'
import { CURVE_COLORS } from '../core/types'
import {
  OUTCOME_TEXT,
  SERIES_TEST_NAMES,
  analyzeSeries,
  approxText,
  exactPartialSum,
  partialSumsTo,
  seriesSource,
} from '../core/series'
import type { SeriesAnalysis, SeriesOutcome, SeriesSource, SeriesTestId, SeriesVerdict } from '../core/series'
import type { Overlay } from '../render/overlays'
import { parseExpression } from '../core/parse'
import { exactForm } from '../core/exact'
import type { ScatterSet } from '../render/scatter'
import { carryParams, fieldParamMeta } from './fieldLinks'
import type { LegendEntry } from './present'

export type { BoardSequence, SeqClass, SeqSeriesView, SequenceDef, SeriesInfo }
export { SEQ_COUNT_DEFAULT, SEQ_COUNT_MAX, SEQ_COUNT_MIN, clampSeqCount, clampSeqN0, carryParams }

const MINUS = '−'

// ---------------------------------------------------------------------------
// Routing: is this line a sequence?
// ---------------------------------------------------------------------------

/**
 * Letters that never name a sequence: the parser's own variables. `y_1 = x²`
 * is a TI-style curve name, not a sequence y.
 */
const NOT_A_NAME: ReadonlySet<string> = new Set(['x', 'y', 'r', 'e'])

/** `y = …`, `f(x) = …`, `r(θ) = …`, `x = …`: a curve, whatever follows. */
const CURVE_HEAD = /^\s*(?:[xyr]\s*=|[A-Za-z]\s*\(\s*(?:x|t|θ|theta)\s*\)\s*=)/

/**
 * a_n, a_{n}, a_(n+1), a_1, a_{12}, a_k — a subscripted head (the core reads
 * n, k, i, j or m as the index) — or a Unicode one: aₙ, a₁.
 */
const SUB_HEAD = /^\s*([A-Za-z])\s*_\s*(?:\{\s*)?(?:\(\s*)?(?:[nkijm](?![A-Za-z])|\d)/
const UNI_HEAD = /^\s*([A-Za-z])[ₙ₀-₉]/

/** a(n) = … — the function-notation head. */
const FN_HEAD = /^\s*([A-Za-z])\s*\(\s*n\s*\)\s*=/

/** a(1) = 3, a(n+1) = … — function notation, recursive. */
const FN_REC = /^\s*([A-Za-z])\s*\(\s*\d+\s*\)\s*=[^,]*,.*\b[A-Za-z]\s*\(\s*n(?![A-Za-z])/

/** One listed term: an integer, a decimal or a fraction, any sign. */
const LIST_TERM = /^[-+−]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*\/\s*\d+(?:\.\d*)?)?$/
const ELLIPSIS = /^(?:…|\.\.\.?)$/

/** "3, 7, 11, 15" or "3, 7, 11, …" — three or more numbers and commas only. */
export function isTermList(src: string): boolean {
  if (typeof src !== 'string') return false
  const parts = src.split(',').map((p) => p.trim())
  if (parts.length > 0 && ELLIPSIS.test(parts[parts.length - 1])) parts.pop()
  if (parts.length < 3) return false
  return parts.every((p) => LIST_TERM.test(p))
}

/**
 * Does this line claim to be a sequence?
 *
 * The equation box is shared with curves, fields and shapes, so this is asked
 * FIRST and must never steal a curve: a line that opens with `y =` or
 * `f(x) =` is a curve whatever else is in it (`y = a(n + 1)` is a line with
 * sliders a and n). Anything that starts like a sequence stays on this
 * branch whether or not it parses, so the teacher reads the SEQUENCE parser's
 * complaint about `a_n = 3 +` rather than the curve parser's bafflement at a
 * product of a, n and an underscore.
 */
export function looksLikeSequence(src: string): boolean {
  if (typeof src !== 'string' || src.trim() === '') return false
  if (CURVE_HEAD.test(src)) return false
  if (isTermList(src)) return true
  for (const re of [SUB_HEAD, UNI_HEAD, FN_HEAD, FN_REC]) {
    const m = re.exec(src)
    if (m && !NOT_A_NAME.has(m[1])) return true
  }
  return false
}

/** The letter a line names its sequence by, read without the parser. */
export function headLetter(src: string): string | null {
  if (typeof src !== 'string') return null
  const m = /^\s*([A-Za-z])\s*[_(ₙ₀-₉]/.exec(src)
  if (m && !NOT_A_NAME.has(m[1])) return m[1]
  return isTermList(src) ? 'a' : null
}

// ---------------------------------------------------------------------------
// Reading the line
// ---------------------------------------------------------------------------

const PARSE_CACHE = new Map<string, SequenceParse>()
const PARSE_CACHE_MAX = 200

/** parseSequence, memoised on the text, never throwing. */
export function readSequence(src: string): SequenceParse {
  const hit = PARSE_CACHE.get(src)
  if (hit) return hit
  let out: SequenceParse
  try {
    out = parseSequence(src)
  } catch {
    out = { ok: false, error: 'The sequence parser crashed on this input' }
  }
  if (!out || typeof out !== 'object') out = { ok: false, error: 'This sequence could not be read' }
  if (PARSE_CACHE.size >= PARSE_CACHE_MAX) PARSE_CACHE.clear()
  PARSE_CACHE.set(src, out)
  return out
}

/** The parser's complaint, with where it is when the parser says. */
export function sequenceError(p: SequenceParse): string | null {
  if (p.ok) return null
  const msg = p.error || 'This sequence could not be read'
  if (typeof p.pos === 'number' && Number.isFinite(p.pos) && !/position/i.test(msg)) {
    return `${msg} at position ${p.pos}`
  }
  return msg
}

/** Terms the index window starts with for a fresh line: its own range, else n₀ … n₀ + 9. */
export function defaultWindow(seq: SequenceDef, params: readonly number[]): { n0: number; count: number } {
  if (seq.range && Number.isFinite(seq.range[0]) && Number.isFinite(seq.range[1])) {
    const lo = Math.min(seq.range[0], seq.range[1])
    const hi = Math.max(seq.range[0], seq.range[1])
    return { n0: clampSeqN0(lo), count: clampSeqCount(hi - lo + 1) }
  }
  const start = Number.isFinite(seq.start) ? clampSeqN0(seq.start) : 1
  if (seq.kind === 'list') {
    // A typed list shows exactly the terms it lists.
    let n = 0
    const vals = safeTerms(seq, params as number[], start, SEQ_COUNT_MAX)
    while (n < vals.length && Number.isFinite(vals[n])) n++
    if (n > 0 && n < SEQ_COUNT_MAX) return { n0: start, count: clampSeqCount(n) }
  }
  return { n0: start, count: SEQ_COUNT_DEFAULT }
}

function safeTerms(seq: SequenceDef, params: number[], n0: number, count: number): number[] {
  try {
    const out = terms(seq, params, n0, count)
    return Array.isArray(out) ? out.map((v) => (typeof v === 'number' ? v : Number.NaN)) : []
  } catch {
    return Array.from({ length: count }, () => Number.NaN)
  }
}

/** The constants a stored sequence runs at: its own, padded with the parser's defaults. */
export function reconcileParams(seq: SequenceDef, params: readonly number[]): number[] {
  const want = seq.paramNames.length
  if (params.length === want) return params as number[]
  return seq.paramNames.map((_, i) => {
    const v = params[i]
    return typeof v === 'number' && Number.isFinite(v) ? v : (seq.defaultParams[i] ?? 1)
  })
}

// ---------------------------------------------------------------------------
// Text: subscripts, numbers, names
// ---------------------------------------------------------------------------

const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '−': '₋', n: 'ₙ',
}

/** "12" -> "₁₂", "n" -> "ₙ". */
export function subscript(s: string | number): string {
  return String(s)
    .split('')
    .map((ch) => SUB[ch] ?? ch)
    .join('')
}

/**
 * A text the core wrote about letter `from` (aₙ, a₁, aₙ₊₁) read in letter
 * `to` — for a typed list, which the core calls a and the board may call c.
 * Only a letter directly followed by a subscript is touched.
 */
export function inName(text: string, from: string, to: string): string {
  if (!text || from === to) return text
  return text.replace(new RegExp(`(?<![A-Za-z])${from}(?=[ₙ₀-₉₊₋])`, 'g'), to)
}

/**
 * The letter a sequence answers to: the one its line names, or — for a typed
 * list, which names none — the one the board gave it (BoardSequence.name).
 */
export function seqName(q: Pick<BoardSequence, 'src' | 'name'>): string {
  const p = readSequence(q.src)
  if (p.ok && p.seq.kind !== 'list' && p.seq.name) return p.seq.name
  if (typeof q.name === 'string' && /^[A-Za-z]$/.test(q.name)) return q.name
  if (p.ok && p.seq.name) return p.seq.name
  return headLetter(q.src) ?? 'a'
}

/** Is this line a typed list (which the board names)? */
export function isListLine(src: string): boolean {
  const p = readSequence(src)
  return p.ok ? p.seq.kind === 'list' : isTermList(src)
}

/** One term or partial sum as the table prints it: exact where exact.ts knows it. */
export function termText(v: number): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  const r = Math.abs(v) < 1e-12 ? 0 : v
  if (Number.isInteger(r) && Math.abs(r) < 1e15) return String(r).replace('-', MINUS)
  if (Math.abs(r) < 1e7) {
    const ex = exactForm(r)
    if (ex) return ex.text.replace(/-/g, MINUS)
  }
  const s = Math.abs(r) >= 1e7 || Math.abs(r) < 1e-4 ? r.toPrecision(4) : String(Number(r.toPrecision(6)))
  return s.replace('-', MINUS)
}

// ---------------------------------------------------------------------------
// Compiling: everything a sequence shows, from its line
// ---------------------------------------------------------------------------

/** How many terms the classification looks at (from n = 1). */
const CLASSIFY_TERMS = 12

export interface CompiledSequence {
  id: string
  /** Null when the line does not parse; `error` says why. */
  seq: SequenceDef | null
  error: string | null
  /** The letter: a, b, u … */
  name: string
  /** The constants it runs at, reconciled with the parser's list. */
  params: number[]
  ns: number[]
  values: number[]
  sums: number[]
  cls: SeqClass
  series: SeriesInfo | null
  /** The continuous partner as a typed line ("y = 4x - 1"), when there is one. */
  partner: string | null
  /** The infinite series Σ aₙ, worked out only while its section is shown. */
  sigma: CompiledSeries | null
}

const NONE: SeqClass = { kind: 'none' }

/** One sequence, worked out. Never throws. */
export function compileSequence(q: BoardSequence): CompiledSequence {
  const parse = readSequence(q.src)
  const n0 = clampSeqN0(q.n0)
  // With the series shown, every partial sum S_N on the board has its terms
  // beside it: the window of terms reaches at least to N (S₁₂ with a₁₁, a₁₂
  // missing read as if the sum had outrun the sequence).
  const seriesN = q.series && Number.isFinite(q.series.N) ? Math.floor(q.series.N) : 0
  const count = clampSeqCount(Math.max(q.count, seriesN - n0 + 1))
  const ns = Array.from({ length: count }, (_, i) => n0 + i)
  const name = seqName(q)
  if (!parse.ok) {
    return {
      id: q.id,
      seq: null,
      error: sequenceError(parse),
      name,
      params: q.params.slice(),
      ns,
      values: ns.map(() => Number.NaN),
      sums: ns.map(() => Number.NaN),
      cls: NONE,
      series: null,
      partner: null,
      sigma: null,
    }
  }
  const seq = parse.seq
  const params = reconcileParams(seq, q.params)
  const values = safeTerms(seq, params, n0, count)
  while (values.length < count) values.push(Number.NaN)
  let sums: number[]
  try {
    sums = partialSums(values)
  } catch {
    sums = values.map(() => Number.NaN)
  }
  // The classification is about the SEQUENCE, not the window: it reads the
  // terms from the first index the definition gives, so "a₁ = 3" in its
  // formulas is the first term whatever window is shown.
  const from = Number.isInteger(seq.start) ? seq.start : 1
  const lead = safeTerms(seq, params, from, CLASSIFY_TERMS)
  let k = 0
  while (k < lead.length && Number.isFinite(lead[k])) k++
  let cls: SeqClass = NONE
  if (k >= 3) {
    try {
      cls = classify(lead.slice(0, k), from, name) ?? NONE
    } catch {
      cls = NONE
    }
  }
  let series: SeriesInfo | null = null
  try {
    const raw = seriesInfo(seq, params)
    series =
      raw && seq.name !== name
        ? {
            ...raw,
            closedForm: raw.closedForm ? inName(raw.closedForm, seq.name, name) : null,
            sentence: inName(raw.sentence, seq.name, name),
          }
        : raw
  } catch {
    series = null
  }
  let partner: string | null = null
  try {
    partner = cls.kind === 'none' ? null : partnerSource(cls)
  } catch {
    partner = null
  }
  return {
    id: q.id,
    seq,
    error: null,
    name,
    params,
    ns,
    values,
    sums,
    cls,
    series,
    partner: partner && partner.trim() !== '' ? partner : null,
    sigma: q.series ? compileSeries(q, seq, params, name) : null,
  }
}

/** Every sequence on the board, compiled once. */
export function compileSequences(qs: readonly BoardSequence[]): Map<string, CompiledSequence> {
  const out = new Map<string, CompiledSequence>()
  for (const q of qs) out.set(q.id, compileSequence(q))
  return out
}

/** The letters the sequences on this board hold. */
export function sequenceLetters(qs: readonly BoardSequence[]): Set<string> {
  const out = new Set<string>()
  for (const q of qs) out.add(seqName(q))
  return out
}

/** Letters a new sequence is offered, in order. */
export const SEQ_POOL: readonly string[] = ['a', 'b', 'c', 'u', 'v', 'w', 's', 'p', 'q']

/** The first sequence letter that neither a sequence nor a curve holds. */
export function nextSequenceLetter(taken: Iterable<string>): string {
  const t = new Set(taken)
  for (const l of SEQ_POOL) if (!t.has(l)) return l
  return 'a'
}

/**
 * Why `name` cannot be this sequence's letter, or null when it can.
 * `curveNames` are the letters curves hold; `seqNames` the other sequences'.
 */
export function sequenceNameClash(
  name: string,
  curveNames: Iterable<string>,
  seqNames: Iterable<string>,
): string | null {
  const curves = new Set(curveNames)
  const seqs = new Set(seqNames)
  const free = nextSequenceLetter([...curves, ...seqs])
  if (curves.has(name)) {
    return `${name} is the name of a curve on this board — call the sequence something else, like ${free}_n.`
  }
  if (seqs.has(name)) {
    return `There is already a sequence ${name} on this board — use another letter, like ${free}_n.`
  }
  return null
}

/** Why a CURVE may not take `letter`, when a sequence holds it. */
export function curveNameClash(letter: string | null, seqNames: ReadonlySet<string>): string | null {
  if (!letter || !seqNames.has(letter)) return null
  return `${letter} is a sequence on this board (${letter}${subscript('n')}) — give the curve another letter.`
}

/**
 * `src` with its sequence letter `from` replaced by `to` wherever it is the
 * sequence's own letter: a_n, a_(n+1), a(n) — a letter followed by _ or (.
 * A slider a in `b_n = a(n − 1)` is only touched when a IS the sequence.
 */
export function renameSequenceSrc(src: string, from: string, to: string): string {
  if (from === to || !/^[A-Za-z]$/.test(from) || !/^[A-Za-z]$/.test(to)) return src
  const re = new RegExp(`(?<![A-Za-z])${from}(?=\\s*[_(])`, 'g')
  return src.replace(re, to)
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export interface SeqRow {
  n: number
  a: number
  aText: string
  s: number
  sText: string
}

export interface SequenceCardData {
  name: string
  latex: string
  error: string | null
  params: { name: string; value: number; meta: ParamMeta }[]
  rows: SeqRow[]
  /** "arithmetic, d = 4", "geometric, r = 1/2", "neither arithmetic nor geometric". */
  classText: string | null
  /** The explicit and the recursive formula, in this sequence's letter. */
  explicit: string | null
  recursive: string | null
  /** The whole classification on one line, joined with " · ". */
  classLine: string | null
  /** "S₁₀ = 210 · Σ = 20" */
  seriesLine: string | null
  /** The core's sentence about the series ("converges because |r| < 1"). */
  seriesNote: string | null
  /** Sₙ in closed form, when known. */
  closedForm: string | null
  /** Whether a continuous partner exists to show. */
  hasPartner: boolean
  partner: string | null
  /** Why there is none, when that is worth saying ("no continuous partner: r < 0"). */
  partnerNote: string | null
  /** "S₁₀" or "a₀ + … + a₉" — what the last partial sum is called. */
  sumLabel: string
  /** The Series section, while "Σ Show series" is on; else null. */
  sigma: SeriesCardData | null
}

/** "arithmetic, d = 4" — the headline of a classification. */
export function classHeadline(cls: SeqClass): string | null {
  switch (cls.kind) {
    case 'arithmetic':
      return `arithmetic, d = ${cls.dText || termText(cls.d)}`
    case 'geometric':
      return `geometric, r = ${cls.rText || termText(cls.r)}`
    case 'quadratic':
      return 'quadratic (constant second differences)'
    default:
      return null
  }
}

/** What the last partial sum of the window is called. */
export function sumLabel(name: string, n0: number, last: number): string {
  if (n0 === 1) return `S${subscript(last)}`
  return `${name}${subscript(n0)} + … + ${name}${subscript(last)}`
}

/** Everything one sequence's card prints, already worked out. */
export function sequenceCard(q: BoardSequence, c: CompiledSequence): SequenceCardData {
  const rows: SeqRow[] = c.ns.map((n, i) => ({
    n,
    a: c.values[i],
    aText: termText(c.values[i]),
    s: c.sums[i],
    sText: termText(c.sums[i]),
  }))
  const params = c.seq
    ? c.seq.paramNames.map((name, i) => ({
        name,
        value: c.params[i],
        meta: fieldParamMeta(name, c.params[i]),
      }))
    : []
  const head = classHeadline(c.cls)
  const explicit = c.cls.kind === 'none' ? null : c.cls.explicit || null
  const recursive = c.cls.kind === 'none' ? null : c.cls.recursive || null
  const classText = c.seq ? (head ?? 'neither arithmetic nor geometric') : null
  const classLine = classText ? [classText, explicit, recursive].filter(Boolean).join(' · ') : null

  const last = c.ns[c.ns.length - 1]
  const label = sumLabel(c.name, c.ns[0], last)
  let seriesLine: string | null = null
  let seriesNote: string | null = null
  let closedForm: string | null = null
  if (c.seq) {
    const parts: string[] = []
    const lastSum = c.sums[c.sums.length - 1]
    if (Number.isFinite(lastSum)) parts.push(`${label} = ${termText(lastSum)}`)
    const s = c.series
    const list = c.seq.kind === 'list'
    const geo = c.cls.kind === 'geometric'
    if (s) {
      if (s.sum && Number.isFinite(s.sum.value) && !list) {
        // The infinite series: "Σ = 10/(1 − 1/2) = 20 (|r| < 1)".
        parts.push(`Σ = ${s.sum.text || termText(s.sum.value)}${geo ? ' (|r| < 1)' : ''}`)
      } else if (s.converges === false) {
        parts.push(geo ? 'diverges: |r| ≥ 1' : 'diverges (nth-term test)')
      }
      seriesNote = s.sentence && s.sentence.trim() !== '' ? s.sentence : null
      closedForm = s.closedForm || null
    }
    seriesLine = parts.length > 0 ? parts.join(' · ') : null
  }

  return {
    name: c.name,
    latex: c.seq?.latex ?? '',
    error: c.error,
    params,
    rows,
    classText,
    explicit,
    recursive,
    classLine,
    seriesLine,
    seriesNote,
    closedForm,
    hasPartner: c.partner !== null,
    partner: c.partner,
    // (−2)ˣ is undefined between the integers: a negative ratio has dots and
    // no function behind them, and the card says so rather than going quiet.
    partnerNote:
      c.partner === null && c.cls.kind === 'geometric' && c.cls.r < 0 ? 'no continuous partner: r < 0' : null,
    sumLabel: label,
    sigma: seriesCard(q, c),
  }
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

/** The id of a sequence's partial-sums set: never an object on the board. */
export function sumsSetId(id: string): string {
  return `${id}:sums`
}

/**
 * The scatter sets the board draws: one set of dots (n, aₙ) per sequence,
 * and, when its card says so, a set of rings (n, Sₙ) in the same colour.
 * A hidden sequence hides both.
 */
export function sequenceScatter(
  qs: readonly BoardSequence[],
  compiled: ReadonlyMap<string, CompiledSequence>,
): ScatterSet[] {
  const out: ScatterSet[] = []
  for (const q of qs) {
    const c = compiled.get(q.id)
    if (!c || !c.seq) continue
    out.push({
      id: q.id,
      xs: c.ns,
      ys: c.values,
      color: q.color,
      visible: q.visible,
      label: `${c.name}${subscript('n')}`,
    })
    // The series section draws its own partial sums (squares, companion
    // colour); the rings would sit on the same points.
    if (q.showSums && !(q.series && c.sigma)) {
      out.push({
        id: sumsSetId(q.id),
        xs: c.ns,
        ys: c.sums,
        color: q.color,
        visible: q.visible,
        marker: 'ring',
        label: `S${subscript('n')} of ${c.name}`,
      })
    }
  }
  return [...out, ...seriesScatter(qs, compiled)]
}

/** The partner's dash: long enough to read as "the function behind the dots". */
export const PARTNER_DASH: readonly number[] = [7, 5]

const PARTNER_CACHE = new Map<string, ((x: number) => number) | null>()

/** The partner line as a function of x, or null when it does not parse as one. */
export function partnerFunction(src: string): ((x: number) => number) | null {
  if (PARTNER_CACHE.has(src)) return PARTNER_CACHE.get(src) ?? null
  let fn: ((x: number) => number) | null = null
  try {
    const o = parseExpression(src)
    if (o.ok && o.plot.kind === 'explicit') {
      const spec = o.plot.makeModel('seq-partner')
      const p = o.plot.defaultParams.slice()
      if (spec.evalExplicit) {
        const ev = spec.evalExplicit.bind(spec)
        fn = (x: number) => {
          try {
            const v = ev(p, x)
            return typeof v === 'number' ? v : Number.NaN
          } catch {
            return Number.NaN
          }
        }
      }
    }
  } catch {
    fn = null
  }
  if (PARTNER_CACHE.size > 200) PARTNER_CACHE.clear()
  PARTNER_CACHE.set(src, fn)
  return fn
}

/**
 * The dashed partners of every visible sequence whose card asks for one,
 * sampled across `span`. Figure content: the export draws the same lines by
 * the same field (BoardScene.polylines). A sample that blows up is a gap,
 * never a line joined across it.
 */
export function partnerPolylines(
  qs: readonly BoardSequence[],
  compiled: ReadonlyMap<string, CompiledSequence>,
  span: readonly [number, number],
  samples = 320,
): Polyline[] {
  const out: Polyline[] = []
  const lo = Math.min(span[0], span[1])
  const hi = Math.max(span[0], span[1])
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return out
  for (const q of qs) {
    if (!q.visible || !q.showPartner) continue
    const c = compiled.get(q.id)
    if (!c || !c.partner) continue
    const f = partnerFunction(c.partner)
    if (!f) continue
    const pts: { x: number; y: number }[] = []
    for (let i = 0; i <= samples; i++) {
      const x = lo + ((hi - lo) * i) / samples
      const y = f(x)
      pts.push({ x, y: Number.isFinite(y) && Math.abs(y) < 1e12 ? y : Number.NaN })
    }
    out.push({ id: `partner:${q.id}`, pts, color: q.color, width: 1.5, dash: PARTNER_DASH })
  }
  return out
}

export interface Box {
  min: { x: number; y: number }
  max: { x: number; y: number }
}

/**
 * The box a sequence's dots occupy — and its rings, when they are shown —
 * padded so a constant sequence still has a height to frame. Null when no
 * term is finite.
 */
export function sequenceBox(q: BoardSequence, c: CompiledSequence): Box | null {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const take = (xs: readonly number[], ys: readonly number[]): void => {
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i]
      const y = ys[i]
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  take(c.ns, c.values)
  if (q.showSums) take(c.ns, c.sums)
  if (q.series && c.sigma) {
    take(c.sigma.ns, c.sigma.sums)
    if (c.sigma.bound !== null) take([c.sigma.N + 3], [c.sigma.sums[c.sigma.sums.length - 1]])
    const S = c.sigma.analysis.sum?.value
    if (typeof S === 'number' && Number.isFinite(S) && seriesConverges(c.sigma.analysis.verdict)) {
      take([c.sigma.ns[0] ?? c.ns[0]], [S])
    }
  }
  if (!(minX <= maxX)) return null
  // The axis is part of the picture of a sequence: include y = 0 when the
  // terms sit near it, so 20, 10, 5, 2.5 … is seen approaching the axis.
  if (minY > 0 && minY < (maxY - minY) * 2) minY = 0
  if (maxY < 0 && -maxY < (maxY - minY) * 2) maxY = 0
  const padX = maxX > minX ? 0.5 : 1
  const padY = maxY > minY ? (maxY - minY) * 0.08 : Math.max(1, Math.abs(minY) * 0.1)
  return { min: { x: minX - padX, y: minY - padY }, max: { x: maxX + padX, y: maxY + padY } }
}

/** What the presentation legend says for each visible sequence. */
export function sequenceLegend(
  qs: readonly BoardSequence[],
  compiled: ReadonlyMap<string, CompiledSequence>,
): LegendEntry[] {
  const out: LegendEntry[] = []
  for (const q of qs) {
    if (!q.visible) continue
    const c = compiled.get(q.id)
    if (!c || !c.seq || !c.seq.latex) continue
    out.push({ id: q.id, color: q.color, tex: c.seq.latex, text: q.src })
  }
  return out
}

// ---------------------------------------------------------------------------
// The builder (Build ▾ → Sequence)
// ---------------------------------------------------------------------------

export type SeqTab = 'arithmetic' | 'geometric' | 'explicit' | 'recursive' | 'list'

export const SEQ_TABS: readonly { tab: SeqTab; label: string }[] = [
  { tab: 'arithmetic', label: 'Arithmetic' },
  { tab: 'geometric', label: 'Geometric' },
  { tab: 'explicit', label: 'Explicit' },
  { tab: 'recursive', label: 'Recursive' },
  { tab: 'list', label: 'From terms' },
]

export interface SeqDraft {
  tab: SeqTab
  name: string
  /** Arithmetic / geometric: the first term and d or r. */
  a1: string
  step: string
  /** How an arithmetic / geometric sequence is written: explicit or recursive. */
  form: 'explicit' | 'recursive'
  /** Explicit: the right side of aₙ = … */
  formula: string
  /** Recursive: a₁, an optional a₂, and the rule. */
  r1: string
  r2: string
  rule: string
  /** From terms: the list as pasted. */
  list: string
  /** The index window. */
  from: string
  to: string
}

export function blankSeqDraft(name = 'a'): SeqDraft {
  return {
    tab: 'arithmetic',
    name,
    a1: '3',
    step: '4',
    form: 'explicit',
    formula: '3 + 4(n - 1)',
    r1: '3',
    r2: '',
    rule: `${name}_n + 4`,
    list: '3, 7, 11, 15',
    from: '1',
    to: '10',
  }
}

/** Fibonacci, filled into the Recursive tab. */
export function fibonacciDraft(d: SeqDraft): SeqDraft {
  const L = d.name || 'a'
  return { ...d, tab: 'recursive', r1: '1', r2: '1', rule: `${L}_(n+1) + ${L}_n` }
}

/** The line a draft stands for, or the reason it cannot be one yet. */
export function draftSource(d: SeqDraft): { src: string | null; error: string | null } {
  const L = (d.name || 'a').trim()
  if (!/^[A-Za-z]$/.test(L) || NOT_A_NAME.has(L)) {
    return { src: null, error: 'A sequence is named by one letter, like a, b or u.' }
  }
  const t = (s: string): string => s.trim()
  switch (d.tab) {
    case 'arithmetic':
    case 'geometric': {
      if (t(d.a1) === '') return { src: null, error: 'Type the first term.' }
      if (t(d.step) === '') {
        return { src: null, error: d.tab === 'arithmetic' ? 'Type the common difference d.' : 'Type the common ratio r.' }
      }
      let src = ''
      try {
        src = sequenceSource({ name: L, kind: d.tab, a1: t(d.a1), step: t(d.step), form: d.form })
      } catch {
        src = ''
      }
      return src ? { src, error: null } : { src: null, error: 'This sequence could not be written.' }
    }
    case 'explicit':
      if (t(d.formula) === '') return { src: null, error: `Type ${L}ₙ as a formula in n.` }
      return { src: `${L}_n = ${t(d.formula)}`, error: null }
    case 'recursive': {
      if (t(d.r1) === '') return { src: null, error: `Type ${L}₁.` }
      if (t(d.rule) === '') return { src: null, error: 'Type the rule.' }
      if (t(d.r2) === '') return { src: `${L}_1 = ${t(d.r1)}, ${L}_(n+1) = ${t(d.rule)}`, error: null }
      return { src: `${L}_1 = ${t(d.r1)}, ${L}_2 = ${t(d.r2)}, ${L}_(n+2) = ${t(d.rule)}`, error: null }
    }
    case 'list':
      if (!isTermList(d.list)) return { src: null, error: 'Type at least three terms, separated by commas.' }
      return { src: d.list.trim(), error: null }
  }
}

/** The draft's index window, or why it is not one. */
export function draftWindow(d: SeqDraft): { n0: number; count: number } | { error: string } {
  const a = Number(d.from.trim().replace('−', '-'))
  const b = Number(d.to.trim().replace('−', '-'))
  if (d.from.trim() === '' || !Number.isInteger(a)) return { error: 'n starts at a whole number.' }
  if (d.to.trim() === '' || !Number.isInteger(b)) return { error: 'n ends at a whole number.' }
  if (b < a) return { error: 'n has to end after it starts.' }
  if (b - a + 1 > SEQ_COUNT_MAX) return { error: `At most ${SEQ_COUNT_MAX} terms.` }
  return { n0: clampSeqN0(a), count: clampSeqCount(b - a + 1) }
}

/** Everything the builder previews: the card of the sequence it would add. */
export function seqPreview(
  d: SeqDraft,
): { src: string | null; error: string | null; card: SequenceCardData | null; window: { n0: number; count: number } | null } {
  const made = draftSource(d)
  if (!made.src) return { src: null, error: made.error, card: null, window: null }
  const p = readSequence(made.src)
  if (!p.ok) return { src: made.src, error: sequenceError(p), card: null, window: null }
  const w = draftWindow(d)
  if ('error' in w) return { src: made.src, error: w.error, card: null, window: null }
  const q: BoardSequence = {
    id: 'preview',
    src: made.src,
    color: '#4f9cf9',
    visible: true,
    n0: w.n0,
    count: w.count,
    showPartner: false,
    showSums: false,
    params: p.seq.defaultParams.slice(),
  }
  return { src: made.src, error: null, card: sequenceCard(q, compileSequence(q)), window: w }
}

// ---------------------------------------------------------------------------
// The series Σ aₙ ("Σ Show series" on the card)
//
// The analysis itself is src/core/series.ts. What lives here is the board's
// half: where the series starts (the window's first index — so typing
// "n from 2" on the card starts Σ 1/(n ln n) at 2), how far the partial sums
// reach (the N slider), what the card prints, and what the board draws: the
// partial sums (n, Sₙ) as squares in a companion colour, optionally joined,
// the dashed line y = S when the series converges, the band S ± |a_(N+1)| of
// an alternating series, and the staircase of stacked bars.
// ---------------------------------------------------------------------------

export interface CompiledSeries {
  analysis: SeriesAnalysis
  src: SeriesSource
  k0: number
  /** The partial sums run to S_N, N clamped to [Nmin, Nmax]. */
  N: number
  Nmin: number
  Nmax: number
  /** k₀ … N and S_k₀ … S_N. */
  ns: number[]
  sums: number[]
  /** |a_(N+1)| when the alternating series error bound applies at this N; else null. */
  bound: number | null
}

/** The slider's range for a series from k₀: 1 … 200 from n = 1. */
export function seriesRange(k0: number): { min: number; max: number } {
  return { min: k0, max: k0 + SERIES_N_SPAN - 1 }
}

/** What "Σ Show series" switches on: S_N at the last term the window shows. */
export function defaultSeriesView(q: Pick<BoardSequence, 'n0' | 'count'>): SeqSeriesView {
  const k0 = clampSeqN0(q.n0)
  const r = seriesRange(k0)
  const N = Math.min(r.max, Math.max(r.min, k0 + clampSeqCount(q.count) - 1))
  return { N, connect: false, bars: false }
}

/**
 * The partial sums' colour: a different palette colour from the terms, far
 * from it in hue (blue terms → amber sums), so the two sets read apart on the
 * projector — and, because it is a palette colour, it maps to its print
 * counterpart on paper. Under SAT / AP (mono) the marker shape tells them apart.
 */
export function seriesColor(color: string): string {
  const i = CURVE_COLORS.indexOf(color)
  if (i >= 0) return CURVE_COLORS[SERIES_PARTNER[i]]
  return color.toLowerCase() === '#f9a825' ? '#4f9cf9' : '#f9a825'
}

/**
 * Palette index → its partner's index, chosen by hue so the two never sit
 * next to each other on the wheel: blue↔amber, red→teal, green→purple,
 * purple→lime, teal→pink, pink→teal, lime→purple.
 */
const SERIES_PARTNER: readonly number[] = [3, 5, 4, 0, 7, 6, 5, 4]

/**
 * The explicit formula as typed — "1/(n ln n)" out of "a_n = 1/(n ln n), n >= 2" —
 * for the integral test's "f(x) = 1/(x ln x)". Null for anything else.
 */
export function plainFormula(src: string): string | null {
  const m = /^\s*[A-Za-z]\s*(?:_\s*\{?\s*\(?\s*[nkijm]\s*\)?\s*\}?|\(\s*[nkijm]\s*\)|[ₙₖ])\s*=\s*(.+)$/.exec(src)
  if (!m) return null
  let rhs = m[1]
  if (/[,;]|\bfor\b|\{/.test(rhs)) {
    rhs = rhs
      .replace(/\{[^}]*\}\s*$/, '')
      .replace(/\s+for\s+.*$/, '')
      .replace(/[,;]\s*[^,;]*[<>≤≥][^,;]*$/, '')
  }
  rhs = rhs.trim()
  if (rhs === '' || /[,;{}]/.test(rhs) || /_/.test(rhs)) return null
  return rhs
}

const ANALYSIS_CACHE = new Map<string, SeriesAnalysis>()
const ANALYSIS_CACHE_MAX = 64

function compileSeries(q: BoardSequence, seq: SequenceDef, params: number[], name: string): CompiledSeries | null {
  const view = q.series
  if (!view) return null
  const k0 = clampSeqN0(q.n0)
  const r = seriesRange(k0)
  const N = Math.min(r.max, Math.max(r.min, Number.isFinite(view.N) ? Math.round(view.N) : r.min))
  let src: SeriesSource
  try {
    const plain = seq.kind === 'explicit' ? plainFormula(q.src) : null
    src = seriesSource(seq, params, k0, plain)
    if (name !== src.name) src = { ...src, name }
  } catch {
    return null
  }
  const key = `${q.src}\u0000${params.join(',')}\u0000${k0}\u0000${name}`
  let analysis = ANALYSIS_CACHE.get(key)
  if (!analysis) {
    analysis = analyzeSeries(src)
    if (ANALYSIS_CACHE.size >= ANALYSIS_CACHE_MAX) ANALYSIS_CACHE.clear()
    ANALYSIS_CACHE.set(key, analysis)
  }
  const sums = partialSumsTo(src, N)
  const ns = sums.map((_, i) => k0 + i)
  let bound: number | null = null
  if (analysis.boundFrom !== null && N >= analysis.boundFrom) {
    const b = Math.abs(src.term(N + 1))
    bound = Number.isFinite(b) ? b : null
  }
  return { analysis, src, k0, N, Nmin: r.min, Nmax: r.max, ns, sums, bound }
}

/** Is the verdict one of the three "converges"? */
export function seriesConverges(v: SeriesVerdict): boolean {
  return v === 'converges' || v === 'converges-absolutely' || v === 'converges-conditionally' || v === 'finite'
}

export interface SeriesTestRow {
  id: SeriesTestId
  name: string
  outcome: SeriesOutcome
  outcomeText: string
  reason: string
}

export interface SeriesCardData {
  /** KaTeX: \sum_{n=1}^{\infty} \frac{1}{n^{2}} */
  tex: string
  N: number
  Nmin: number
  Nmax: number
  /** "S₂₀" */
  sNLabel: string
  /** "1627/2520 ≈ 0.645635", "≈ 1.596163" */
  sNText: string
  /** "S = π²/6 ≈ 1.644934", or null when no sum is given. */
  sumText: string | null
  sumHow: string | null
  /** Why a convergent series has no sum shown. */
  sumNote: string | null
  verdict: SeriesVerdict
  verdictText: string
  /** The test the verdict rests on ("p-series"), or null. */
  testName: string | null
  justification: string
  tests: SeriesTestRow[]
  /** "|S − S₂₀| ≤ |a₂₁| = 1/21 ≈ 0.047619" for an alternating series. */
  bound: string | null
  /** "S − S₂₀ ≈ 0.0234 (actual)" beside the bound, when S is known. */
  actual: string | null
  problem: string | null
  connect: boolean
  bars: boolean
}

function withApprox(text: string, v: number): string {
  if (text.startsWith('≈')) return text
  const a = approxText(v, 7)
  return a === text ? text : `${text} ≈ ${a}`
}

/** What the Series section prints, already worked out. */
export function seriesCard(q: BoardSequence, c: CompiledSequence): SeriesCardData | null {
  const s = c.sigma
  if (!s || !q.series) return null
  const A = s.analysis
  const sN = s.sums[s.sums.length - 1]
  const sNLabel = `S${subscript(s.N)}`
  let sNText = Number.isFinite(sN) ? `≈ ${approxText(sN, 7)}` : 'undefined'
  if (Number.isFinite(sN)) {
    const ex = exactPartialSum(s.src, s.N)
    if (ex && ex.exact) sNText = withApprox(ex.text, sN)
  }
  const sum = A.sum
  const sumText = sum && Number.isFinite(sum.value) ? `S = ${sum.exact ? withApprox(sum.text, sum.value) : sum.text}` : null
  let bound: string | null = null
  let actual: string | null = null
  if (s.bound !== null) {
    const nxt = `${c.name}${subscript(s.N + 1)}`
    const bt = termText(s.bound)
    bound = `|S ${MINUS} ${sNLabel}| ≤ |${nxt}| = ${withApprox(bt, s.bound)}`
    if (sum && Number.isFinite(sum.value) && Number.isFinite(sN)) {
      actual = `actual |S ${MINUS} ${sNLabel}| ≈ ${approxText(Math.abs(sum.value - sN), 4)}`
    }
  }
  return {
    tex: A.tex,
    N: s.N,
    Nmin: s.Nmin,
    Nmax: s.Nmax,
    sNLabel,
    sNText,
    sumText,
    sumHow: sum ? sum.how : null,
    sumNote: A.sumNote,
    verdict: A.verdict,
    verdictText: A.verdictText,
    testName: A.decidedBy ? SERIES_TEST_NAMES[A.decidedBy] : null,
    justification: A.justification,
    tests: A.tests.map((t) => ({
      id: t.id,
      name: t.name,
      outcome: t.outcome,
      outcomeText: OUTCOME_TEXT[t.outcome],
      reason: t.reason,
    })),
    bound,
    actual,
    problem: A.problem,
    connect: q.series.connect,
    bars: q.series.bars,
  }
}

/** The id of a sequence's series set on the board: never an object. */
export function seriesSetId(id: string): string {
  return `${id}:series`
}

/** The partial sums (n, Sₙ) of every visible sequence whose series is shown: squares. */
export function seriesScatter(
  qs: readonly BoardSequence[],
  compiled: ReadonlyMap<string, CompiledSequence>,
): ScatterSet[] {
  const out: ScatterSet[] = []
  for (const q of qs) {
    const c = compiled.get(q.id)
    const s = c?.sigma
    if (!c || !s || !q.series) continue
    out.push({
      id: seriesSetId(q.id),
      xs: s.ns,
      ys: s.sums,
      color: seriesColor(q.color),
      visible: q.visible,
      marker: 'square',
      label: `S${subscript('n')} = Σ ${c.name}${subscript('k')}`,
    })
  }
  return out
}

/** Half the width of one staircase bar, in index units. */
export const SERIES_BAR_HALF = 0.34
/** The band and the bars' fill alpha. */
export const SERIES_BAND_FILL = 0.2
export const SERIES_BAR_FILL = 0.3

/**
 * The series' figure content, as overlays (so the export draws it by the same
 * field the screen does): the staircase bars, the line joining the partial
 * sums, the band S ± |a_(N+1)|, the dashed y = S and its chip.
 */
export function seriesOverlays(
  qs: readonly BoardSequence[],
  compiled: ReadonlyMap<string, CompiledSequence>,
): Overlay[] {
  const under: Overlay[] = []
  const marks: Overlay[] = []
  for (const q of qs) {
    if (!q.visible || !q.series) continue
    const c = compiled.get(q.id)
    const s = c?.sigma
    if (!c || !s) continue
    const color = seriesColor(q.color)
    const A = s.analysis
    const S = A.sum && seriesConverges(A.verdict) && Number.isFinite(A.sum.value) ? A.sum.value : null
    if (q.series.bars) {
      let prev = 0
      for (let i = 0; i < s.ns.length; i++) {
        const n = s.ns[i]
        const top = s.sums[i]
        if (!Number.isFinite(top)) break
        under.push({
          kind: 'path',
          points: [
            { x: n - SERIES_BAR_HALF, y: prev },
            { x: n + SERIES_BAR_HALF, y: prev },
            { x: n + SERIES_BAR_HALF, y: top },
            { x: n - SERIES_BAR_HALF, y: top },
          ],
          closed: true,
          fill: SERIES_BAR_FILL,
          alpha: 0.85,
          width: 1,
          color,
          under: true,
        })
        prev = top
      }
    }
    if (s.bound !== null) {
      const centre = S ?? s.sums[s.sums.length - 1]
      if (Number.isFinite(centre)) {
        const x0 = s.N - 0.5
        const x1 = Math.max(s.N + 3, c.ns.length ? c.ns[c.ns.length - 1] + 0.5 : s.N + 3)
        under.push({
          kind: 'path',
          points: [
            { x: x0, y: centre - s.bound },
            { x: x1, y: centre - s.bound },
            { x: x1, y: centre + s.bound },
            { x: x0, y: centre + s.bound },
          ],
          closed: true,
          fill: SERIES_BAND_FILL,
          alpha: 0,
          color,
          under: true,
        })
        marks.push({ kind: 'segment', from: { x: s.N, y: centre - s.bound }, to: { x: s.N, y: centre + s.bound }, color, width: 2 })
      }
    }
    if (q.series.connect && s.ns.length > 1) {
      const pts = s.ns.map((n, i) => ({ x: n, y: s.sums[i] })).filter((p) => Number.isFinite(p.y))
      marks.push({ kind: 'path', points: pts, color, width: 1.5, alpha: 0.9 })
    }
    if (S !== null) {
      marks.push({ kind: 'hline', y: S, color, dashed: true })
      const lastN = Math.max(s.N, c.ns.length ? c.ns[c.ns.length - 1] : s.N)
      marks.push({
        kind: 'label',
        at: { x: lastN + 1, y: S },
        text: `S = ${A.sum && A.sum.exact ? A.sum.text : approxText(S, 5)}`,
        dir: { x: 0.4, y: -1 },
        color,
      })
    }
  }
  return [...under, ...marks]
}
