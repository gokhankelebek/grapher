// ============================================================================
// src/core/probability.ts — exact probability for NC Math 2 (S-CP.1, 3–8).
//
//   Frac              exact fractions (bigint), parsed from "3/10", "0.35",
//                     "35%" or "12"; written "3/10", decimals and percents
//                     secondary
//   twoWay*           a two-way table of counts: marginal totals, joint,
//                     marginal and conditional probabilities ("the fraction
//                     of B's outcomes that are also in A"), relative
//                     frequencies, and the independence check worded for a
//                     SAMPLE
//   parseEvent        a small parser for event expressions over A, B, C:
//                     ∪ ∩ ᶜ ' and / or / not, − and parentheses
//   vennProb          the probability of an event as a sum of regions, and
//                     the Addition Rule (or the complement rule) written out
//   buildTree         a tree diagram: from a bag (counts per colour, draws,
//                     with or without replacement) or typed stages; the path
//                     products by the Multiplication Rule; an event as a sum
//                     of paths
//
// Pure: nothing here knows about the board, the card or the document.
// ============================================================================

// ---------------------------------------------------------------------------
// Exact fractions
// ---------------------------------------------------------------------------

export interface Frac {
  n: bigint
  /** Always > 0. */
  d: bigint
}

const babs = (a: bigint): bigint => (a < 0n ? -a : a)
function gcd(a: bigint, b: bigint): bigint {
  a = babs(a)
  b = babs(b)
  while (b) [a, b] = [b, a % b]
  return a
}

export function frac(n: bigint | number, d: bigint | number = 1n): Frac {
  let N = typeof n === 'bigint' ? n : BigInt(Math.round(n))
  let D = typeof d === 'bigint' ? d : BigInt(Math.round(d))
  if (D === 0n) throw new Error('zero denominator')
  if (D < 0n) {
    N = -N
    D = -D
  }
  const g = gcd(N, D) || 1n
  return { n: N / g, d: D / g }
}

export const ZERO = frac(0)
export const ONE = frac(1)
export const add = (a: Frac, b: Frac): Frac => frac(a.n * b.d + b.n * a.d, a.d * b.d)
export const sub = (a: Frac, b: Frac): Frac => frac(a.n * b.d - b.n * a.d, a.d * b.d)
export const mul = (a: Frac, b: Frac): Frac => frac(a.n * b.n, a.d * b.d)
export const div = (a: Frac, b: Frac): Frac => frac(a.n * b.d, a.d * b.n)
export const eq = (a: Frac, b: Frac): boolean => a.n === b.n && a.d === b.d
export const isZero = (a: Frac): boolean => a.n === 0n
export const toNum = (a: Frac): number => Number(a.n) / Number(a.d)
export const sum = (list: readonly Frac[]): Frac => list.reduce(add, ZERO)
export const isInt = (a: Frac): boolean => a.d === 1n

const MINUS = '−'

/** "3/10", "−1/2", "4". */
export function fracText(a: Frac): string {
  const s = a.d === 1n ? `${babs(a.n)}` : `${babs(a.n)}/${a.d}`
  return a.n < 0n ? `${MINUS}${s}` : s
}

/** "\frac{3}{10}". */
export function fracTex(a: Frac): string {
  const s = a.d === 1n ? `${babs(a.n)}` : `\\frac{${babs(a.n)}}{${a.d}}`
  return a.n < 0n ? `-${s}` : s
}

/** Does p/q terminate within `digits` decimals? */
function terminates(a: Frac, digits: number): boolean {
  return (a.n * 10n ** BigInt(digits)) % a.d === 0n
}

/**
 * The decimal: exact when it terminates within 4 places ("0.45", "0.3"), else
 * "≈ 0.6667". `pad` keeps at least two places ("0.30"), as a probability is
 * usually written.
 */
export function decText(a: Frac, pad = true): string {
  const v = toNum(a)
  if (terminates(a, 4)) {
    let s = String(Number(v.toFixed(4)))
    if (pad && !isInt(a)) {
      const dot = s.indexOf('.')
      if (dot >= 0 && s.length - dot - 1 < 2) s += '0'
    }
    return s.replace('-', MINUS)
  }
  return `≈ ${v.toFixed(4).replace('-', MINUS)}`
}

/** "45%", "≈ 66.7%". */
export function pctText(a: Frac): string {
  const p = mul(a, frac(100))
  if (terminates(p, 2)) return `${String(Number(toNum(p).toFixed(2))).replace('-', MINUS)}%`
  return `≈ ${toNum(p).toFixed(1).replace('-', MINUS)}%`
}

/** "3/10 = 0.30 = 30%" (or "1" alone, "0" alone). */
export function fracAll(a: Frac): string {
  if (isInt(a)) return fracText(a)
  const d = decText(a)
  return `${fracText(a)} ${d.startsWith('≈') ? d : `= ${d}`} ${pctText(a).startsWith('≈') ? `(${pctText(a)})` : `= ${pctText(a)}`}`
}

/** "6/20 = 3/10" when it reduces, else "3/10". */
export function ratioText(num: number | bigint, den: number | bigint): string {
  const N = BigInt(num)
  const D = BigInt(den)
  if (D === 0n) return `${N}/0`
  const f = frac(N, D)
  const raw = `${N}/${D}`
  return f.n === N && f.d === D ? raw : `${raw} = ${fracText(f)}`
}

/**
 * A typed number, exactly: "12", "0.35", ".5", "3/10", "1 1/2" (mixed), "35%".
 * Null when it is not one. Never negative unless typed so.
 */
export function parseFrac(text: string): Frac | null {
  const t = text.trim().replace(/\s+/g, ' ').replace(/[−–]/g, '-')
  if (!t) return null
  const pct = /%$/.test(t)
  const body = pct ? t.slice(0, -1).trim() : t
  let f: Frac | null = null
  const dec = /^(-?)(\d*)(?:\.(\d+))?$/.exec(body)
  const fr = /^(-?)(\d+)\s*\/\s*(\d+)$/.exec(body)
  const mixed = /^(-?)(\d+) (\d+)\s*\/\s*(\d+)$/.exec(body)
  if (dec && (dec[2] || dec[3])) {
    const whole = dec[2] || '0'
    const part = dec[3] ?? ''
    const n = BigInt(whole + part)
    f = frac(dec[1] ? -n : n, 10n ** BigInt(part.length))
  } else if (fr) {
    if (BigInt(fr[3]) === 0n) return null
    const n = BigInt(fr[2])
    f = frac(fr[1] ? -n : n, BigInt(fr[3]))
  } else if (mixed) {
    if (BigInt(mixed[4]) === 0n) return null
    const v = add(frac(BigInt(mixed[2])), frac(BigInt(mixed[3]), BigInt(mixed[4])))
    f = mixed[1] ? frac(-v.n, v.d) : v
  }
  if (!f) return null
  return pct ? div(f, frac(100)) : f
}

// ---------------------------------------------------------------------------
// Two-way tables
// ---------------------------------------------------------------------------

export interface TwoWay {
  rows: readonly string[]
  cols: readonly string[]
  /** counts[row][col], whole numbers ≥ 0. */
  counts: readonly (readonly number[])[]
}

export interface TwoWayTotals {
  rowTotals: number[]
  colTotals: number[]
  grand: number
}

const cnt = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0)

export function twoWayTotals(t: TwoWay): TwoWayTotals {
  const R = t.rows.length
  const C = t.cols.length
  const rowTotals = new Array<number>(R).fill(0)
  const colTotals = new Array<number>(C).fill(0)
  for (let i = 0; i < R; i++) {
    for (let j = 0; j < C; j++) {
      const v = cnt(t.counts[i]?.[j])
      rowTotals[i] += v
      colTotals[j] += v
    }
  }
  return { rowTotals, colTotals, grand: rowTotals.reduce((a, b) => a + b, 0) }
}

/** A probability as the fraction of some outcomes: its numerator and denominator as counted, and the value. */
export interface Ratio {
  num: number
  den: number
  /** Null when den = 0. */
  p: Frac | null
}

const ratio = (num: number, den: number): Ratio => ({ num, den, p: den > 0 ? frac(num, den) : null })

export type Given = 'B' | 'A'

export interface TwoWayFacts {
  totals: TwoWayTotals
  /** A is row `a`, B is column `b`. */
  a: number
  b: number
  joint: Ratio
  pA: Ratio
  pB: Ratio
  /** P(A|B) = n(A and B) / n(B). */
  aGivenB: Ratio
  /** P(B|A) = n(A and B) / n(A). */
  bGivenA: Ratio
  /** P(A or B) = P(A) + P(B) − P(A and B). */
  union: Ratio
  indep: Independence | null
}

export function twoWayFacts(t: TwoWay, a: number, b: number): TwoWayFacts {
  const totals = twoWayTotals(t)
  const ai = Math.max(0, Math.min(t.rows.length - 1, a))
  const bj = Math.max(0, Math.min(t.cols.length - 1, b))
  const n = cnt(t.counts[ai]?.[bj])
  const N = totals.grand
  const RA = totals.rowTotals[ai] ?? 0
  const CB = totals.colTotals[bj] ?? 0
  const joint = ratio(n, N)
  const pA = ratio(RA, N)
  const pB = ratio(CB, N)
  return {
    totals,
    a: ai,
    b: bj,
    joint,
    pA,
    pB,
    aGivenB: ratio(n, CB),
    bGivenA: ratio(n, RA),
    union: ratio(RA + CB - n, N),
    indep: joint.p && pA.p && pB.p ? independence(pA.p, pB.p, joint.p, CB > 0 ? frac(n, CB) : null, RA > 0 ? frac(n, RA) : null) : null,
  }
}

export type RelView = 'count' | 'joint' | 'row' | 'col'

/** One cell (or total) as the relative-frequency view shows it: the fraction, or null when its whole is 0. */
export function relCell(t: TwoWay, totals: TwoWayTotals, view: RelView, i: number, j: number): Frac | null {
  // i = rows.length is the totals row; j = cols.length the totals column
  const R = t.rows.length
  const C = t.cols.length
  const v = i < R && j < C ? cnt(t.counts[i]?.[j]) : i < R ? totals.rowTotals[i] : j < C ? totals.colTotals[j] : totals.grand
  if (view === 'count') return frac(v)
  const den = view === 'joint' ? totals.grand : view === 'row' ? (i < R ? totals.rowTotals[i] : totals.grand) : j < C ? totals.colTotals[j] : totals.grand
  return den > 0 ? frac(v, den) : null
}

// ---------------------------------------------------------------------------
// Independence
// ---------------------------------------------------------------------------

export interface Independence {
  independent: boolean
  /** The two comparisons, as sentences: "P(A|B) = 9/20 = 0.45 ≠ P(A) = 3/10 = 0.30". */
  conditional: string
  product: string
  /** The verdict, careful about a sample. */
  verdict: string
  /** Close but not equal: a note that a sample rarely matches exactly. */
  close: boolean
}

/** "9/20 = 0.45", "1/2 = 0.50", "2/3 ≈ 0.6667", "1". */
export function fd(a: Frac): string {
  if (isInt(a)) return fracText(a)
  const d = decText(a)
  return d.startsWith('≈') ? `${fracText(a)} ${d}` : `${fracText(a)} = ${d}`
}

/**
 * Are A and B independent? Exactly when P(A|B) = P(A) — equivalently
 * P(A and B) = P(A)·P(B). Both comparisons are stated; the verdict speaks of
 * the sample (or the model) the numbers come from, never of the population.
 */
export function independence(pA: Frac, pB: Frac, pAB: Frac, aGivenB: Frac | null, bGivenA: Frac | null, opts: { a?: string; b?: string; sample?: boolean } = {}): Independence {
  const A = opts.a ?? 'A'
  const B = opts.b ?? 'B'
  const where = opts.sample === false ? 'In this model' : 'In this sample'
  const prod = mul(pA, pB)
  const independent = eq(pAB, prod)
  const rel = independent ? '=' : '≠'
  let conditional: string
  if (aGivenB) conditional = `P(${A}|${B}) = ${fd(aGivenB)} ${rel} P(${A}) = ${fd(pA)}`
  else if (bGivenA) conditional = `P(${B}|${A}) = ${fd(bGivenA)} ${rel} P(${B}) = ${fd(pB)}`
  else conditional = ''
  const product = `P(${A} and ${B}) = ${fd(pAB)} ${rel} P(${A})·P(${B}) = ${fd(pA)} · ${fd(pB)} = ${fd(prod)}`
  const close = !independent && Math.abs(toNum(pAB) - toNum(prod)) < 0.01 && (!aGivenB || Math.abs(toNum(aGivenB) - toNum(pA)) < 0.03)
  const head = independent ? `${where}, ${A} and ${B} are independent` : `${where}, ${A} and ${B} are not independent`
  const verdict = conditional ? `${head}: ${conditional}.` : `${head}: ${product}.`
  return { independent, conditional, product, verdict, close }
}

// ---------------------------------------------------------------------------
// Event expressions (Venn diagrams)
// ---------------------------------------------------------------------------

export type EventNode =
  | { k: 'set'; i: number }
  | { k: 'all' }
  | { k: 'none' }
  | { k: 'not'; x: EventNode }
  | { k: 'and'; l: EventNode; r: EventNode }
  | { k: 'or'; l: EventNode; r: EventNode }
  | { k: 'minus'; l: EventNode; r: EventNode }

export const SET_LETTERS = ['A', 'B', 'C'] as const

type Tok = { t: 'set'; i: number } | { t: 'all' } | { t: 'none' } | { t: 'or' } | { t: 'and' } | { t: 'minus' } | { t: 'not' } | { t: 'comp' } | { t: '(' } | { t: ')' }

/** What a Venn event says to "A | B" or "A given B". */
export const CONDITIONAL_HINT =
  'Venn events are sets; “|” means “given”. For P(A | B) use the two-way table, or type A ∩ B and B here and divide P(A ∩ B) by P(B).'

function tokenize(src: string, sets: number): Tok[] | string {
  const out: Tok[] = []
  const operandEnded = (): boolean => {
    const last = out[out.length - 1]
    return !!last && (last.t === 'set' || last.t === 'all' || last.t === 'none' || last.t === ')' || last.t === 'comp')
  }
  // "A | B" is a conditional probability, never a union: say so rather
  // than shade A ∪ B for a student who meant P(A | B).
  if (/[|∣]/.test(src) || /\bgiven\b/i.test(src)) return CONDITIONAL_HINT
  let i = 0
  const s = src
  while (i < s.length) {
    const ch = s[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    const rest = s.slice(i)
    const word = /^[A-Za-z]+/.exec(rest)?.[0] ?? ''
    const lower = word.toLowerCase()
    if (ch === '∪' || ch === '⋃' || ch === '+') {
      out.push({ t: 'or' })
      i++
    } else if (ch === '∩' || ch === '⋂' || ch === '&' || ch === '∧') {
      out.push({ t: 'and' })
      i++
    } else if (ch === '∨') {
      out.push({ t: 'or' })
      i++
    } else if (ch === '\\' || ch === '−' || ch === '-' || ch === '–') {
      out.push({ t: 'minus' })
      i++
    } else if (ch === '~' || ch === '¬') {
      out.push({ t: 'not' })
      i++
    } else if (ch === 'ᶜ' || ch === '\'' || ch === '′' || ch === '’' || ch === '̅') {
      out.push({ t: 'comp' })
      i++
    } else if (ch === '^') {
      const m = /^\^\s*(?:\{\s*[cC]\s*\}|[cC]|')/.exec(rest)
      if (!m) return 'After ^ write c, as in Aᶜ = A^c.'
      out.push({ t: 'comp' })
      i += m[0].length
    } else if (ch === '(' || ch === '[') {
      out.push({ t: '(' })
      i++
    } else if (ch === ')' || ch === ']') {
      out.push({ t: ')' })
      i++
    } else if (ch === '∅' || ch === 'Ø' || ch === 'ø') {
      out.push({ t: 'none' })
      i++
    } else if (lower === 'or' || lower === 'union' || lower === 'cup') {
      out.push({ t: 'or' })
      i += word.length
    } else if (lower === 'and' || lower === 'intersect' || lower === 'cap') {
      out.push({ t: 'and' })
      i += word.length
    } else if (lower === 'not') {
      out.push({ t: 'not' })
      i += word.length
    } else if (word.length > 0 && operandEnded() && (word[0] === 'U' || word[0] === 'u') && word.length >= 1) {
      // "A U B": U after an operand is a union
      out.push({ t: 'or' })
      i += 1
    } else if (word.length > 0 && operandEnded() && word[0] === 'n') {
      // "A n B": n after an operand is an intersection
      out.push({ t: 'and' })
      i += 1
    } else if (word.length > 0 && operandEnded() && word[0] === 'c' && out[out.length - 1].t !== 'comp') {
      // "Ac" read as Aᶜ
      out.push({ t: 'comp' })
      i += 1
    } else if (word.length > 0) {
      const c = word[0]
      const up = c.toUpperCase()
      const k = (SET_LETTERS as readonly string[]).indexOf(up)
      if (k >= 0) {
        if (k >= sets) return `There is no ${up} in a ${sets === 2 ? 'two' : 'three'}-set diagram.`
        if (operandEnded()) return `Put ∪ or ∩ between the events (before ${up}).`
        out.push({ t: 'set', i: k })
      } else if (up === 'S' || up === 'U') {
        if (operandEnded()) return `Put ∪ or ∩ between the events (before ${up}).`
        out.push({ t: 'all' })
      } else {
        return `“${word}” is not an event here: use ${SET_LETTERS.slice(0, sets).join(', ')}, ∪ ∩ ᶜ, and / or / not and parentheses.`
      }
      i += 1
    } else {
      return `“${ch}” is not understood here.`
    }
  }
  return out
}

export type ParseResult = { ok: true; node: EventNode } | { ok: false; error: string }

/**
 * Parse an event: complement binds tightest, then ∩, then ∪ and − (left to
 * right). "A ∩ B'", "not (A or B)", "A n Bc", "(A ∪ B)ᶜ", "A − B".
 */
export function parseEvent(src: string, sets: 2 | 3): ParseResult {
  if (!src.trim()) return { ok: false, error: 'Type an event, such as A ∩ Bᶜ.' }
  const toks = tokenize(src, sets)
  if (typeof toks === 'string') return { ok: false, error: toks }
  let p = 0
  const peek = (): Tok | undefined => toks[p]
  const fail = (m: string): never => {
    throw new Error(m)
  }
  const primary = (): EventNode => {
    const t = toks[p++]
    if (!t) return fail('The event ends too soon.')
    if (t.t === 'set') return { k: 'set', i: t.i }
    if (t.t === 'all') return { k: 'all' }
    if (t.t === 'none') return { k: 'none' }
    if (t.t === '(') {
      const e = union()
      if (peek()?.t !== ')') fail('A “(” is not closed.')
      p++
      return e
    }
    if (t.t === 'not') return { k: 'not', x: factor() }
    return fail('An event is missing (before an operator, or after one).')
  }
  const factor = (): EventNode => {
    let e = primary()
    while (peek()?.t === 'comp') {
      p++
      e = { k: 'not', x: e }
    }
    return e
  }
  const inter = (): EventNode => {
    let e = factor()
    while (peek()?.t === 'and') {
      p++
      e = { k: 'and', l: e, r: factor() }
    }
    return e
  }
  const union = (): EventNode => {
    let e = inter()
    for (;;) {
      const t = peek()?.t
      if (t === 'or') {
        p++
        e = { k: 'or', l: e, r: inter() }
      } else if (t === 'minus') {
        p++
        e = { k: 'minus', l: e, r: inter() }
      } else break
    }
    return e
  }
  try {
    const node = union()
    if (p < toks.length) return { ok: false, error: toks[p].t === ')' ? 'A “)” has no “(”.' : 'Put ∪ or ∩ between the events.' }
    return { ok: true, node }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** Atoms are numbered by membership bits: bit 0 = in A, bit 1 = in B, bit 2 = in C; atom 0 is outside every set. */
export const atomCount = (sets: 2 | 3): number => (sets === 2 ? 4 : 8)

/** The atoms an event contains, as a bit mask over atom numbers. */
export function eventAtoms(node: EventNode, sets: 2 | 3): number {
  const n = atomCount(sets)
  const all = (1 << n) - 1
  const go = (e: EventNode): number => {
    switch (e.k) {
      case 'all':
        return all
      case 'none':
        return 0
      case 'set': {
        let m = 0
        for (let a = 0; a < n; a++) if (a & (1 << e.i)) m |= 1 << a
        return m
      }
      case 'not':
        return all & ~go(e.x)
      case 'and':
        return go(e.l) & go(e.r)
      case 'or':
        return go(e.l) | go(e.r)
      case 'minus':
        return go(e.l) & ~go(e.r)
    }
  }
  return go(node)
}

const prec = (e: EventNode): number => (e.k === 'or' || e.k === 'minus' ? 1 : e.k === 'and' ? 2 : 3)

/** The event written properly: "A ∩ Bᶜ", "(A ∪ B)ᶜ", "Aᶜ ∩ Bᶜ". `names` are the letters (default A, B, C). */
export function eventText(e: EventNode, names: readonly string[] = SET_LETTERS): string {
  const wrap = (x: EventNode, min: number): string => (prec(x) < min ? `(${eventText(x, names)})` : eventText(x, names))
  switch (e.k) {
    case 'set':
      return names[e.i] ?? '?'
    case 'all':
      return 'S'
    case 'none':
      return '∅'
    case 'not':
      return e.x.k === 'set' || e.x.k === 'all' || e.x.k === 'none' ? `${eventText(e.x, names)}ᶜ` : `(${eventText(e.x, names)})ᶜ`
    case 'and':
      return `${wrap(e.l, 2)} ∩ ${wrap(e.r, 3)}`
    case 'or':
      return `${wrap(e.l, 1)} ∪ ${wrap(e.r, 2)}`
    case 'minus':
      return `${wrap(e.l, 1)} − ${wrap(e.r, 2)}`
  }
}

/** In words, for a screen reader: "A and not B", "not (A or B)". */
export function eventWords(e: EventNode, names: readonly string[] = SET_LETTERS): string {
  const wrap = (x: EventNode, min: number): string => (prec(x) < min ? `(${eventWords(x, names)})` : eventWords(x, names))
  switch (e.k) {
    case 'set':
      return names[e.i] ?? '?'
    case 'all':
      return 'any outcome'
    case 'none':
      return 'no outcome'
    case 'not':
      return e.x.k === 'set' ? `not ${eventWords(e.x, names)}` : `not (${eventWords(e.x, names)})`
    case 'and':
      return `${wrap(e.l, 2)} and ${wrap(e.r, 3)}`
    case 'or':
      return `${wrap(e.l, 1)} or ${wrap(e.r, 2)}`
    case 'minus':
      return `${wrap(e.l, 1)} but not ${wrap(e.r, 2)}`
  }
}

/** One atom by its membership: "A ∩ Bᶜ ∩ C"; atom 0 of two sets is "Aᶜ ∩ Bᶜ". */
export function atomText(atom: number, sets: 2 | 3): string {
  return SET_LETTERS.slice(0, sets)
    .map((l, i) => (atom & (1 << i) ? l : `${l}ᶜ`))
    .join(' ∩ ')
}

/** One atom as a teacher says it: "A only", "A and B only", "all three", "neither", "none of them". */
export function atomName(atom: number, sets: 2 | 3): string {
  const ins = SET_LETTERS.slice(0, sets).filter((_, i) => atom & (1 << i))
  if (ins.length === 0) return sets === 2 ? 'neither' : 'none'
  if (ins.length === sets) return sets === 2 ? 'A and B' : 'all three'
  return `${ins.join(' and ')} only`
}

// ---------------------------------------------------------------------------
// Venn probabilities
// ---------------------------------------------------------------------------

export interface VennRegions {
  sets: 2 | 3
  /** One exact value per atom (counts, or probabilities adding to 1). */
  values: readonly Frac[]
}

export interface VennTotals {
  total: Frac
  /** Counts (every region a whole number) or probabilities. */
  counts: boolean
  /** Probabilities that do not add to 1 (they are scaled by the total). */
  offBy: Frac | null
}

export function vennTotals(r: VennRegions): VennTotals {
  const total = sum(r.values.slice(0, atomCount(r.sets)))
  const counts = r.values.slice(0, atomCount(r.sets)).every(isInt)
  const offBy = !counts && !eq(total, ONE) ? total : null
  return { total, counts, offBy }
}

/** P(event): the regions' sum over the total. Null when the total is 0. */
export function probOfAtoms(mask: number, r: VennRegions): Frac | null {
  const t = vennTotals(r)
  if (isZero(t.total)) return null
  let s = ZERO
  for (let a = 0; a < atomCount(r.sets); a++) if (mask & (1 << a)) s = add(s, r.values[a] ?? ZERO)
  return div(s, t.total)
}

/** The regions' own sum (a count, or a probability). */
export function atomsSum(mask: number, r: VennRegions): Frac {
  let s = ZERO
  for (let a = 0; a < atomCount(r.sets); a++) if (mask & (1 << a)) s = add(s, r.values[a] ?? ZERO)
  return s
}

export interface VennWorking {
  /** The event, written properly. */
  text: string
  mask: number
  p: Frac | null
  /** "P(A ∪ B) = P(A) + P(B) − P(A ∩ B)" — the rule, when one applies. */
  rule: string
  /** The rule with the numbers: "= 3/10 + 1/2 − 1/5 = 3/5". */
  ruleNumbers: string
  /** The sum of regions: "(12 + 8 + 5) / 50 = 25/50 = 1/2". */
  regions: string
}

function flattenOr(e: EventNode): EventNode[] {
  return e.k === 'or' ? [...flattenOr(e.l), ...flattenOr(e.r)] : [e]
}

const P = (e: EventNode): string => `P(${eventText(e)})`

export function vennWorking(node: EventNode, r: VennRegions): VennWorking {
  const mask = eventAtoms(node, r.sets)
  const text = eventText(node)
  const p = probOfAtoms(mask, r)
  const t = vennTotals(r)
  const pm = (m: number): Frac => probOfAtoms(m, r) ?? ZERO
  const pe = (e: EventNode): Frac => pm(eventAtoms(e, r.sets))
  let rule = ''
  let ruleNumbers = ''
  if (p) {
    if (node.k === 'or') {
      const ops = flattenOr(node)
      if (ops.length === 2) {
        const [X, Y] = ops
        const XY: EventNode = { k: 'and', l: X, r: Y }
        rule = `${P(node)} = ${P(X)} + ${P(Y)} − ${P(XY)}`
        ruleNumbers = `= ${fracText(pe(X))} + ${fracText(pe(Y))} − ${fracText(pe(XY))} = ${fracText(p)}`
      } else if (ops.length === 3) {
        const [X, Y, Z] = ops
        const and = (l: EventNode, rr: EventNode): EventNode => ({ k: 'and', l, r: rr })
        const pairs = [and(X, Y), and(X, Z), and(Y, Z)]
        const all3 = and(and(X, Y), Z)
        rule = `${P(node)} = ${P(X)} + ${P(Y)} + ${P(Z)} − ${pairs.map(P).join(' − ')} + ${P(all3)}`
        ruleNumbers = `= ${[X, Y, Z].map((e) => fracText(pe(e))).join(' + ')} − ${pairs.map((e) => fracText(pe(e))).join(' − ')} + ${fracText(pe(all3))} = ${fracText(p)}`
      }
    } else if (node.k === 'not') {
      rule = `${P(node)} = 1 − ${P(node.x)}`
      ruleNumbers = `= 1 − ${fracText(pe(node.x))} = ${fracText(p)}`
    }
  }
  // the sum of regions
  const parts: string[] = []
  for (let a = 0; a < atomCount(r.sets); a++) if (mask & (1 << a)) parts.push(fracText(r.values[a] ?? ZERO))
  let regions: string
  const s = atomsSum(mask, r)
  if (!p) regions = 'The regions add to 0, so there is no probability yet.'
  else if (parts.length === 0) regions = `No region is in ${text}: P = 0.`
  else if (t.counts) {
    regions = parts.length > 1 ? `(${parts.join(' + ')})/${fracText(t.total)} = ${ratioText(s.n, t.total.n)}` : ratioText(s.n, t.total.n)
  } else {
    regions = parts.length > 1 ? `${parts.join(' + ')} = ${fracText(s)}` : `${fracText(s)}`
    if (t.offBy) regions += ` (÷ ${fracText(t.total)}, the regions’ total) = ${fracText(p)}`
  }
  return { text, mask, p, rule, ruleNumbers, regions }
}

/** The regions of a two-set diagram from a two-way table: A = row a, B = column b. */
export function regionsFromTable(t: TwoWay, a: number, b: number): Frac[] {
  const f = twoWayFacts(t, a, b)
  const n = cnt(t.counts[f.a]?.[f.b])
  const RA = f.totals.rowTotals[f.a] ?? 0
  const CB = f.totals.colTotals[f.b] ?? 0
  const N = f.totals.grand
  // atom 0 neither, 1 A only, 2 B only, 3 both
  return [frac(N - RA - CB + n), frac(RA - n), frac(CB - n), frac(n)]
}

// ---------------------------------------------------------------------------
// Tree diagrams
// ---------------------------------------------------------------------------

export interface BagColor {
  name: string
  count: number
}

export interface Branch {
  /** Outcome name ("Red"). */
  name: string
  /** Index of the outcome in its stage's list (the colour's index for a bag). */
  k: number
  p: Frac
  /** As written on the branch: "2/4" for a bag (unsimplified, so the draw shows), the typed text otherwise. */
  label: string
  /** Raw numerator / denominator when the branch is a count over a count. */
  raw: { num: number; den: number } | null
}

export interface TreeNode {
  /** Path key: outcome indices joined by "." ("0.1"); '' for the root. */
  key: string
  depth: number
  branches: { b: Branch; child: TreeNode }[]
}

export interface Leaf {
  key: string
  /** Outcome per stage. */
  path: Branch[]
  p: Frac
  /** "3/5 · 2/4 = 6/20 = 3/10". */
  product: string
  /** "P(R then B) = P(R)·P(B | R) = 3/5 · 2/4 = 3/10". */
  rule: string
  /** "RB", "Red, Blue". */
  short: string
  long: string
}

export interface TreeResult {
  root: TreeNode
  leaves: Leaf[]
  stages: number
  /** Stage names ("Draw 1"). */
  stageNames: string[]
  /** Problems with typed probabilities ("Stage 2 after H adds to 9/10, not 1"). */
  problems: string[]
  /** Every stage uses the same outcome list (so "same" / "different" presets make sense). */
  sameOutcomes: boolean
  /** Every stage's probabilities are the same whatever came before. */
  independent: boolean
}

/** Short names: the first letter of each outcome when those are distinct, else the names. */
export function shortNames(names: readonly string[]): string[] {
  const first = names.map((n) => (n.trim()[0] ?? '?').toUpperCase())
  return new Set(first).size === first.length ? first : names.map((n) => n.trim() || '?')
}

/**
 * Every path is computed: 4 outcomes over 3 stages (or 4 colours over 3
 * draws) is 4³ = 64. Nothing is ever cut — a tree that drops paths gets every
 * event's probability wrong. The FIGURE decides how much it can label
 * (src/ui/probLinks.ts TREE_LABEL_MAX); the arithmetic is always complete.
 */
export const MAX_LEAVES = 64
export const MAX_STAGES = 3
export const MAX_OUTCOMES = 4

function finishLeaf(path: Branch[], key: string, shorts: string[][], stageNames: string[]): Leaf {
  const p = path.reduce((acc, b) => mul(acc, b.p), ONE)
  const allRaw = path.every((b) => b.raw)
  const labels = path.map((b) => b.label)
  let product = labels.join(' · ')
  if (allRaw && path.length > 1) {
    const num = path.reduce((a, b) => a * (b.raw as { num: number }).num, 1)
    const den = path.reduce((a, b) => a * (b.raw as { den: number }).den, 1)
    product += ` = ${ratioText(num, den)}`
  } else if (path.length > 1 || labels[0] !== fracText(p)) {
    product += ` = ${fracText(p)}`
  }
  const sh = path.map((b, i) => shorts[i]?.[b.k] ?? b.name)
  const sep = sh.every((s) => s.length === 1) ? '' : ', '
  const terms = path.map((b, i) => (i === 0 ? `P(${sh[0]})` : `P(${sh[i]} | ${sh.slice(0, i).join(sep)})`))
  const rule = `P(${sh.join(sep)}) = ${terms.join('·')} = ${product}`
  void stageNames
  return { key, path, p, product, rule, short: sh.join(sep), long: path.map((b) => b.name).join(', ') }
}

/**
 * A bag of coloured objects, `draws` draws, with or without replacement.
 * Branches with nothing left to draw are left off (probability 0).
 */
export function bagTree(colors: readonly BagColor[], draws: number, replace: boolean): TreeResult {
  const cs = colors.map((c) => ({ name: c.name.trim() || '?', count: Math.max(0, Math.round(c.count)) }))
  const k = Math.max(1, Math.min(MAX_STAGES, Math.round(draws)))
  const names = cs.map((c) => c.name)
  const sh = shortNames(names)
  const shorts = Array.from({ length: k }, () => sh)
  const stageNames = Array.from({ length: k }, (_, i) => `Draw ${i + 1}`)
  const leaves: Leaf[] = []
  const problems: string[] = []
  const total0 = cs.reduce((a, c) => a + c.count, 0)
  if (total0 === 0) problems.push('The bag is empty.')
  else if (!replace && total0 < k) problems.push(`Only ${total0} in the bag, so ${k} draws without replacement are impossible.`)
  const grow = (counts: number[], depth: number, key: string, path: Branch[]): TreeNode => {
    const node: TreeNode = { key, depth, branches: [] }
    if (depth === k) {
      leaves.push(finishLeaf(path, key, shorts, stageNames))
      return node
    }
    const T = counts.reduce((a, b) => a + b, 0)
    if (T === 0) return node
    counts.forEach((c, i) => {
      if (c <= 0) return
      const b: Branch = { name: cs[i].name, k: i, p: frac(c, T), label: `${c}/${T}`, raw: { num: c, den: T } }
      const next = replace ? counts : counts.map((x, j) => (j === i ? x - 1 : x))
      const ck = key ? `${key}.${i}` : `${i}`
      node.branches.push({ b, child: grow(next, depth + 1, ck, [...path, b]) })
    })
    return node
  }
  const root = total0 > 0 && (replace || total0 >= k) ? grow(cs.map((c) => c.count), 0, '', []) : { key: '', depth: 0, branches: [] }
  return { root, leaves, stages: k, stageNames, problems, sameOutcomes: true, independent: replace }
}

export interface TreeStage {
  name: string
  outcomes: readonly string[]
  /** probs[node][branch] as typed; one row when `same` (independent of what came before). */
  probs: readonly (readonly string[])[]
  same: boolean
}

/** How many nodes a stage has: the product of the earlier stages' outcome counts. */
export function stageNodes(stages: readonly TreeStage[], s: number): number {
  let n = 1
  for (let i = 0; i < s; i++) n *= Math.max(1, stages[i].outcomes.length)
  return n
}

/** A tree typed stage by stage: each node's branch probabilities (or one row shared by every node). */
export function manualTree(stages: readonly TreeStage[]): TreeResult {
  const st = stages.slice(0, MAX_STAGES).filter((s) => s.outcomes.length > 0)
  const shorts = st.map((s) => shortNames(s.outcomes))
  const stageNames = st.map((s, i) => s.name || `Stage ${i + 1}`)
  const problems: string[] = []
  const leaves: Leaf[] = []
  // `index`: the node's place among its stage's nodes, in path order (its row of probabilities)
  const grow = (depth: number, key: string, path: Branch[], index: number): TreeNode => {
    const node: TreeNode = { key, depth, branches: [] }
    if (depth === st.length) {
      leaves.push(finishLeaf(path, key, shorts, stageNames))
      return node
    }
    const s = st[depth]
    const row = s.same ? s.probs[0] : s.probs[index]
    const ps = s.outcomes.map((_, i) => parseFrac(row?.[i] ?? '') ?? null)
    const where = depth === 0 ? '' : ` after ${path.map((b, i) => shorts[i][b.k]).join('')}`
    if (ps.some((p) => p === null)) problems.push(`${stageNames[depth]}${s.same || depth === 0 ? '' : where}: type every branch’s probability.`)
    else {
      const tot = sum(ps as Frac[])
      if (!eq(tot, ONE)) problems.push(`${stageNames[depth]}${s.same || depth === 0 ? '' : where}: the branches add to ${fracText(tot)}, not 1.`)
      if ((ps as Frac[]).some((p) => p.n < 0n)) problems.push(`${stageNames[depth]}: a probability is negative.`)
    }
    s.outcomes.forEach((name, i) => {
      const p = ps[i] ?? ZERO
      const text = (row?.[i] ?? '').trim()
      const b: Branch = { name: name.trim() || '?', k: i, p, label: text || '?', raw: null }
      const ck = key ? `${key}.${i}` : `${i}`
      node.branches.push({ b, child: grow(depth + 1, ck, [...path, b], index * s.outcomes.length + i) })
    })
    return node
  }
  const root = st.length > 0 ? grow(0, '', [], 0) : { key: '', depth: 0, branches: [] }
  const first = st[0]?.outcomes.join('|')
  const sameOutcomes = st.every((s) => s.outcomes.join('|') === first)
  const independent = st.every((s) => s.same)
  return { root, leaves, stages: st.length, stageNames, problems, sameOutcomes, independent }
}

/** An event on a tree: a set of leaves by key. Its probability and the sum written out. */
export interface TreeEvent {
  p: Frac
  /** "P(RR) + P(RB) + P(BR)". */
  terms: string
  /** "3/10 + 3/10 + 3/10 = 9/10". */
  numbers: string
  /** "1 − P(BB) = 1 − 1/10 = 9/10", when fewer leaves are left out than are in. */
  complement: string
}

export function treeEvent(tree: TreeResult, keys: readonly string[]): TreeEvent {
  const set = new Set(keys)
  const ins = tree.leaves.filter((l) => set.has(l.key))
  const outs = tree.leaves.filter((l) => !set.has(l.key))
  const p = sum(ins.map((l) => l.p))
  const terms = ins.length === 0 ? '0' : ins.map((l) => `P(${l.short})`).join(' + ')
  const numbers = ins.length === 0 ? '0' : ins.length === 1 ? fracText(p) : `${ins.map((l) => fracText(l.p)).join(' + ')} = ${fracText(p)}`
  let complement = ''
  if (ins.length > 1 && outs.length > 0 && outs.length < ins.length) {
    const q = sum(outs.map((l) => l.p))
    const qTerms = outs.map((l) => `P(${l.short})`).join(' + ')
    complement = `1 − ${outs.length > 1 ? `(${qTerms})` : qTerms} = 1 − ${fracText(q)} = ${fracText(sub(ONE, q))}`
  }
  return { p, terms, numbers, complement }
}

export type PresetKind = 'all' | 'atLeast' | 'exactly1' | 'none' | 'same' | 'different'

export interface Preset {
  id: string
  /** "both red", "at least one red". */
  name: string
  keys: string[]
}

/**
 * Ready-made events over the outcome names along each path: "both Red",
 * "at least one Red", "exactly one Red", "no Red", and — when every stage
 * has the same outcomes — "same colour" / "different colours".
 */
export function treePresets(tree: TreeResult, colourWord = 'outcome'): Preset[] {
  if (tree.leaves.length === 0) return []
  const names = new Map<string, string>()
  for (const l of tree.leaves) for (const b of l.path) names.set(b.name.toLowerCase(), b.name)
  const out: Preset[] = []
  const k = tree.stages
  const allWord = k === 2 ? 'both' : k === 1 ? '' : 'all'
  const count = (l: Leaf, name: string): number => l.path.filter((b) => b.name.toLowerCase() === name).length
  for (const [low, name] of names) {
    const keys = (f: (c: number) => boolean): string[] => tree.leaves.filter((l) => f(count(l, low))).map((l) => l.key)
    if (k === 1) {
      out.push({ id: `all:${low}`, name, keys: keys((c) => c === 1) })
      continue
    }
    out.push({ id: `all:${low}`, name: `${allWord} ${name}`, keys: keys((c) => c === k) })
    out.push({ id: `atLeast:${low}`, name: `at least one ${name}`, keys: keys((c) => c >= 1) })
    out.push({ id: `exactly1:${low}`, name: `exactly one ${name}`, keys: keys((c) => c === 1) })
    out.push({ id: `none:${low}`, name: `no ${name}`, keys: keys((c) => c === 0) })
  }
  if (k >= 2 && tree.sameOutcomes) {
    const same = tree.leaves.filter((l) => l.path.every((b) => b.name === l.path[0].name)).map((l) => l.key)
    out.push({ id: 'same', name: `same ${colourWord}`, keys: same })
    out.push({ id: 'different', name: `different ${colourWord}s`, keys: tree.leaves.filter((l) => !same.includes(l.key)).map((l) => l.key) })
  }
  return out.filter((p) => p.keys.length > 0)
}
