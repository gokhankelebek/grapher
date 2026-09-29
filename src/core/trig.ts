// ============================================================================
// src/core/trig.ts — the unit circle's mathematics (AP Precalculus Unit 3,
// NC Math 3).
//
//   exactTrig(fn, k)        sin, cos, tan, csc, sec, cot of kπ/12 as exact
//                           strings ("(√6−√2)/4", "−2√3/3"), null = undefined
//   specialIndex(θ)         k when θ is a multiple of π/12, else null
//   angleText(θ, deg)       "5π/6", "−π/4", "150°"; decimals otherwise
//   referenceAngle(θ)       θ′ in [0, π/2]
//   quadrantOf(θ)           1–4, or the axis the terminal side lies on
//   parseAngle(src, deg)    "5pi/6", "-π/4", "150°", "2.4" → radians
//   parseTrigValue(src)     "1/2", "-√3/2", "sqrt(2)/2" → number
//   inverseTrig(fn, v)      the principal value, its range, and the other
//                           solution in [0, 2π)
//   snapTheta(θ, rPx)       π/4 and π/6 multiples first, then π/12, within px
//   dragTheta(prev, φ, rPx) the angle a drag reaches, keeping the winding
//
// Nothing here knows about the board. Every string is plain Unicode with a
// true minus (U+2212), the way the card and the board chips print numbers.
// ============================================================================

export type TrigFn = 'sin' | 'cos' | 'tan' | 'csc' | 'sec' | 'cot'
export type UnwrapFn = 'sin' | 'cos' | 'tan'
export type InvFn = 'sin' | 'cos' | 'tan'

export const TWO_PI = Math.PI * 2
/** One step of the special-angle lattice: π/12 = 15°. */
export const STEP = Math.PI / 12
const MINUS = '−'

/** An exact value: Unicode text, KaTeX, and the number it stands for. */
export interface TrigExact {
  text: string
  tex: string
  value: number
}

interface Mag {
  pos: TrigExact
  neg: TrigExact
}

const R2 = Math.SQRT2
const R3 = Math.sqrt(3)
const R6 = Math.sqrt(6)

function mag(text: string, neg: string, tex: string, negTex: string, value: number): Mag {
  return { pos: { text, tex, value }, neg: { text: neg, tex: negTex, value: -value } }
}

const ZERO = mag('0', '0', '0', '0', 0)
const ONE = mag('1', `${MINUS}1`, '1', '-1', 1)
const TWO = mag('2', `${MINUS}2`, '2', '-2', 2)
const HALF = mag('1/2', `${MINUS}1/2`, '\\frac{1}{2}', '-\\frac{1}{2}', 0.5)
const R2_2 = mag('√2/2', `${MINUS}√2/2`, '\\frac{\\sqrt{2}}{2}', '-\\frac{\\sqrt{2}}{2}', R2 / 2)
const R3_2 = mag('√3/2', `${MINUS}√3/2`, '\\frac{\\sqrt{3}}{2}', '-\\frac{\\sqrt{3}}{2}', R3 / 2)
const R3_3 = mag('√3/3', `${MINUS}√3/3`, '\\frac{\\sqrt{3}}{3}', '-\\frac{\\sqrt{3}}{3}', R3 / 3)
const SQ2 = mag('√2', `${MINUS}√2`, '\\sqrt{2}', '-\\sqrt{2}', R2)
const SQ3 = mag('√3', `${MINUS}√3`, '\\sqrt{3}', '-\\sqrt{3}', R3)
const R3x2_3 = mag('2√3/3', `${MINUS}2√3/3`, '\\frac{2\\sqrt{3}}{3}', '-\\frac{2\\sqrt{3}}{3}', (2 * R3) / 3)
// The π/12 family: sin 15° = (√6 − √2)/4, tan 15° = 2 − √3, sec 15° = √6 − √2.
const S15 = mag(
  '(√6−√2)/4',
  '(√2−√6)/4',
  '\\frac{\\sqrt{6}-\\sqrt{2}}{4}',
  '\\frac{\\sqrt{2}-\\sqrt{6}}{4}',
  (R6 - R2) / 4,
)
const S75 = mag(
  '(√6+√2)/4',
  `${MINUS}(√6+√2)/4`,
  '\\frac{\\sqrt{6}+\\sqrt{2}}{4}',
  '-\\frac{\\sqrt{6}+\\sqrt{2}}{4}',
  (R6 + R2) / 4,
)
const T15 = mag('2−√3', '√3−2', '2-\\sqrt{3}', '\\sqrt{3}-2', 2 - R3)
const T75 = mag('2+√3', `${MINUS}2−√3`, '2+\\sqrt{3}', '-2-\\sqrt{3}', 2 + R3)
const K15 = mag('√6−√2', '√2−√6', '\\sqrt{6}-\\sqrt{2}', '\\sqrt{2}-\\sqrt{6}', R6 - R2)
const K75 = mag('√6+√2', `${MINUS}√6−√2`, '\\sqrt{6}+\\sqrt{2}', '-\\sqrt{6}-\\sqrt{2}', R6 + R2)

/** First-quadrant magnitudes at jπ/12, j = 0…6. null = undefined there. */
const Q1: Record<TrigFn, readonly (Mag | null)[]> = {
  sin: [ZERO, S15, HALF, R2_2, R3_2, S75, ONE],
  cos: [ONE, S75, R3_2, R2_2, HALF, S15, ZERO],
  tan: [ZERO, T15, R3_3, ONE, SQ3, T75, null],
  cot: [null, T75, SQ3, ONE, R3_3, T15, ZERO],
  csc: [null, K75, TWO, SQ2, R3x2_3, K15, ONE],
  sec: [ONE, K15, R3x2_3, SQ2, TWO, K75, null],
}

/** Reduce k (any integer) to its reference index j ∈ 0…6 and the signs of sin and cos. */
function reduce(k: number): { j: number; s: 1 | -1; c: 1 | -1 } {
  const m = ((Math.round(k) % 24) + 24) % 24
  if (m <= 6) return { j: m, s: 1, c: 1 }
  if (m <= 12) return { j: 12 - m, s: 1, c: -1 }
  if (m <= 18) return { j: m - 12, s: -1, c: -1 }
  return { j: 24 - m, s: -1, c: 1 }
}

/**
 * The exact value of fn(kπ/12), or null where it is undefined (tan π/2,
 * csc 0 …). Every one of the 24 multiples in a turn, and any k beyond.
 */
export function exactTrig(fn: TrigFn, k: number): TrigExact | null {
  const { j, s, c } = reduce(k)
  const m = Q1[fn][j]
  if (!m) return null
  const sign = fn === 'sin' || fn === 'csc' ? s : fn === 'cos' || fn === 'sec' ? c : s * c
  if (m.pos.value === 0) return m.pos
  return sign > 0 ? m.pos : m.neg
}

/** k when θ is kπ/12 (to 1e-9), else null. */
export function specialIndex(theta: number): number | null {
  if (!Number.isFinite(theta)) return null
  const k = Math.round(theta / STEP)
  return Math.abs(theta - k * STEP) <= 1e-9 * Math.max(1, Math.abs(theta)) ? k : null
}

function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) [a, b] = [b, a % b]
  return a
}

/** "5π/6", "−π/4", "0", "2π", "13π/6" for kπ/12. */
export function piText(k: number): string {
  if (k === 0) return '0'
  const g = gcd(k, 12)
  const p = k / g
  const q = 12 / g
  const sign = p < 0 ? MINUS : ''
  const a = Math.abs(p)
  const num = a === 1 ? 'π' : `${a}π`
  return q === 1 ? `${sign}${num}` : `${sign}${num}/${q}`
}

/** KaTeX for kπ/12: "\frac{5\pi}{6}". */
export function piTex(k: number): string {
  if (k === 0) return '0'
  const g = gcd(k, 12)
  const p = k / g
  const q = 12 / g
  const sign = p < 0 ? '-' : ''
  const a = Math.abs(p)
  const num = a === 1 ? '\\pi' : `${a}\\pi`
  return q === 1 ? `${sign}${num}` : `${sign}\\frac{${num}}{${q}}`
}

/** A decimal with a true minus, trimmed: 2.4, −0.6435. */
export function dec(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return '—'
  if (Math.abs(v) < 1e-12) return '0'
  let s = v.toFixed(digits)
  if (s.includes('.')) s = s.replace(/\.?0+$/, '')
  if (s === '-0') return '0'
  return s.startsWith('-') ? MINUS + s.slice(1) : s
}

/** Degrees, to one decimal unless whole: "150°", "−45°", "137.5°". */
export function degText(theta: number): string {
  const d = (theta * 180) / Math.PI
  const r = Math.round(d)
  if (Math.abs(d - r) <= 1e-7 * Math.max(1, Math.abs(d))) return `${dec(r, 0)}°`
  return `${dec(d, 1)}°`
}

/**
 * The angle as a teacher writes it: an exact multiple of π when θ is on the
 * π/12 lattice ("5π/6"), degrees in degree mode ("150°"), a decimal otherwise.
 */
export function angleText(theta: number, deg = false): string {
  if (deg) return degText(theta)
  const k = specialIndex(theta)
  if (k !== null) return piText(k)
  return dec(theta, 4)
}

/** Wrap into [0, 2π). */
export function norm2pi(theta: number): number {
  const t = theta % TWO_PI
  const r = t < 0 ? t + TWO_PI : t
  // 2π − 1e-16 is 2π to anyone reading the board.
  return Math.abs(r - TWO_PI) < 1e-12 ? 0 : r
}

/** Wrap into (−π, π]. */
export function wrapPi(a: number): number {
  let t = (a + Math.PI) % TWO_PI
  if (t <= 0) t += TWO_PI
  return t - Math.PI
}

export type Quadrant =
  | { kind: 'quadrant'; q: 1 | 2 | 3 | 4 }
  | { kind: 'axis'; axis: '+x' | '+y' | '-x' | '-y' }

const AXIS_EPS = 1e-9

/** Which quadrant the terminal side is in — or which axis it lies along. */
export function quadrantOf(theta: number): Quadrant {
  const t = norm2pi(theta)
  const near = (a: number): boolean => Math.abs(t - a) <= AXIS_EPS || Math.abs(t - a - TWO_PI) <= AXIS_EPS
  if (near(0)) return { kind: 'axis', axis: '+x' }
  if (near(Math.PI / 2)) return { kind: 'axis', axis: '+y' }
  if (near(Math.PI)) return { kind: 'axis', axis: '-x' }
  if (near((3 * Math.PI) / 2)) return { kind: 'axis', axis: '-y' }
  if (t < Math.PI / 2) return { kind: 'quadrant', q: 1 }
  if (t < Math.PI) return { kind: 'quadrant', q: 2 }
  if (t < (3 * Math.PI) / 2) return { kind: 'quadrant', q: 3 }
  return { kind: 'quadrant', q: 4 }
}

/** "Quadrant II", "on the positive y-axis". */
export function quadrantText(q: Quadrant): string {
  if (q.kind === 'quadrant') return `Quadrant ${['I', 'II', 'III', 'IV'][q.q - 1]}`
  const words: Record<string, string> = {
    '+x': 'on the positive x-axis',
    '+y': 'on the positive y-axis',
    '-x': 'on the negative x-axis',
    '-y': 'on the negative y-axis',
  }
  return words[q.axis]
}

/**
 * The reference angle θ′: the acute angle between the terminal side and the
 * x-axis, in [0, π/2]. On an axis it is 0 (the x-axis) or π/2 (the y-axis).
 */
export function referenceAngle(theta: number): number {
  const t = norm2pi(theta)
  let r: number
  if (t <= Math.PI / 2) r = t
  else if (t <= Math.PI) r = Math.PI - t
  else if (t <= (3 * Math.PI) / 2) r = t - Math.PI
  else r = TWO_PI - t
  // Land exactly on the lattice when θ was on it: 5π/6 → π/6, not 0.5235987755982987.
  const k = specialIndex(r)
  return k !== null ? k * STEP : r
}

/** The x-axis direction the reference angle is measured from: 0 or π (math angle). */
export function referenceBase(theta: number): number {
  const t = norm2pi(theta)
  return t > Math.PI / 2 && t < (3 * Math.PI) / 2 ? Math.PI : 0
}

/** θ − 2π and θ + 2π, and θ wrapped into [0, 2π). */
export function coterminal(theta: number): { minus: number; plus: number; principal: number } {
  const principal = norm2pi(theta)
  const k = specialIndex(principal)
  return {
    minus: theta - TWO_PI,
    plus: theta + TWO_PI,
    principal: k !== null ? k * STEP : principal,
  }
}

/** sin, cos, … of θ: exact on the π/12 lattice, a decimal otherwise, null where undefined. */
export interface TrigReading {
  fn: TrigFn
  exact: boolean
  text: string
  tex: string
  value: number | null
}

const UNDEFINED_EPS = 1e-12

export function trigAt(fn: TrigFn, theta: number): TrigReading {
  const k = specialIndex(theta)
  if (k !== null) {
    const e = exactTrig(fn, k)
    return e
      ? { fn, exact: true, text: e.text, tex: e.tex, value: e.value }
      : { fn, exact: true, text: 'undefined', tex: '\\text{undefined}', value: null }
  }
  const s = Math.sin(theta)
  const c = Math.cos(theta)
  let v: number
  switch (fn) {
    case 'sin':
      v = s
      break
    case 'cos':
      v = c
      break
    case 'tan':
      v = Math.abs(c) < UNDEFINED_EPS ? NaN : s / c
      break
    case 'cot':
      v = Math.abs(s) < UNDEFINED_EPS ? NaN : c / s
      break
    case 'sec':
      v = Math.abs(c) < UNDEFINED_EPS ? NaN : 1 / c
      break
    case 'csc':
      v = Math.abs(s) < UNDEFINED_EPS ? NaN : 1 / s
      break
  }
  if (!Number.isFinite(v)) return { fn, exact: false, text: 'undefined', tex: '\\text{undefined}', value: null }
  const t = dec(v, 4)
  return { fn, exact: false, text: t, tex: t.replace(MINUS, '-'), value: v }
}

// ---------------------------------------------------------------------------
// Reading what a teacher types
// ---------------------------------------------------------------------------

/**
 * A plain constant expression → number, without the parser: digits, + − * /,
 * parentheses, π / pi, √n / √(…) / sqrt(…), and implicit products ("5pi",
 * "2√3"). Returns null for anything else.
 */
export function evalConst(src: string): number | null {
  const s = src
    .replace(/[−–]/g, '-')
    .replace(/×|·/g, '*')
    .replace(/÷/g, '/')
    .replace(/\s+/g, '')
    .toLowerCase()
  if (s === '') return null
  let i = 0
  const peek = (): string => s[i] ?? ''
  const atomStart = (ch: string): boolean => /[0-9.(π√]/.test(ch) || s.startsWith('pi', i) || s.startsWith('sqrt', i)

  function expr(): number | null {
    let v = term()
    if (v === null) return null
    while (peek() === '+' || peek() === '-') {
      const op = s[i++]
      const r = term()
      if (r === null) return null
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  function term(): number | null {
    let v = unary()
    if (v === null) return null
    for (;;) {
      if (peek() === '*' || peek() === '/') {
        const op = s[i++]
        const r = unary()
        if (r === null) return null
        v = op === '*' ? v * r : v / r
      } else if (atomStart(peek()) || s.startsWith('pi', i) || s.startsWith('sqrt', i)) {
        // Implicit product: 5pi, 2√3, 3(…).
        const r = power()
        if (r === null) return null
        v = v * r
      } else return v
    }
  }
  function unary(): number | null {
    if (peek() === '-') {
      i++
      const v = unary()
      return v === null ? null : -v
    }
    if (peek() === '+') {
      i++
      return unary()
    }
    return power()
  }
  function power(): number | null {
    const b = atom()
    if (b === null) return null
    if (peek() === '^') {
      i++
      const e = unary()
      if (e === null) return null
      return Math.pow(b, e)
    }
    return b
  }
  function atom(): number | null {
    const ch = peek()
    if (ch === '(') {
      i++
      const v = expr()
      if (v === null || peek() !== ')') return null
      i++
      return v
    }
    if (ch === 'π') {
      i++
      return Math.PI
    }
    if (s.startsWith('pi', i)) {
      i += 2
      return Math.PI
    }
    if (ch === '√' || s.startsWith('sqrt', i)) {
      i += ch === '√' ? 1 : 4
      const v = peek() === '(' ? atom() : number()
      return v === null ? null : Math.sqrt(v)
    }
    return number()
  }
  function number(): number | null {
    const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i))
    if (!m) return null
    i += m[0].length
    return Number(m[0])
  }
  const v = expr()
  if (v === null || i !== s.length || !Number.isFinite(v)) return null
  return v
}

/**
 * An angle as typed → radians. π anywhere means radians and ° anywhere means
 * degrees, whatever the mode; a bare number follows the mode ("150" in degree
 * mode is 150°, in radian mode 150 radians).
 */
export function parseAngle(src: string, degMode: boolean): number | null {
  let s = src.trim()
  if (s === '') return null
  s = s.replace(/^θ\s*=\s*/i, '').replace(/^theta\s*=\s*/i, '')
  let deg = degMode
  if (/°|deg(rees?)?\s*$/i.test(s)) {
    deg = true
    s = s.replace(/°/g, '').replace(/deg(rees?)?\s*$/i, '')
  } else if (/π|pi/i.test(s)) deg = false
  else if (/rad(ians?)?\s*$/i.test(s)) {
    deg = false
    s = s.replace(/rad(ians?)?\s*$/i, '')
  }
  const v = evalConst(s)
  if (v === null) return null
  const r = deg ? (v * Math.PI) / 180 : v
  // Snap what was meant exactly: "150°" is 5π/6 to the last bit.
  const k = specialIndex(r)
  return k !== null ? k * STEP : r
}

/** A value for sin⁻¹ / cos⁻¹ / tan⁻¹ as typed: "1/2", "−√3/2", "sqrt(2)/2", "-1". */
export function parseTrigValue(src: string): number | null {
  return evalConst(src)
}

// ---------------------------------------------------------------------------
// Inverse trig — the principal value
// ---------------------------------------------------------------------------

export interface InverseResult {
  ok: true
  fn: InvFn
  v: number
  /** The principal value: in [−π/2, π/2], [0, π] or (−π/2, π/2). */
  principal: number
  /**
   * The other solution of fn(θ) = v in [0, 2π) — the one NOT coterminal with
   * the principal value — or null when there is none (sin θ = 1 has one).
   */
  other: number | null
  /** "[−π/2, π/2]" … and whether each end is included. */
  range: { lo: number; hi: number; loOpen: boolean; hiOpen: boolean; text: string }
}

export type InverseOutcome = InverseResult | { ok: false; error: string }

export const INV_RANGE: Record<InvFn, InverseResult['range']> = {
  sin: { lo: -Math.PI / 2, hi: Math.PI / 2, loOpen: false, hiOpen: false, text: `[${MINUS}π/2, π/2]` },
  cos: { lo: 0, hi: Math.PI, loOpen: false, hiOpen: false, text: '[0, π]' },
  tan: { lo: -Math.PI / 2, hi: Math.PI / 2, loOpen: true, hiOpen: true, text: `(${MINUS}π/2, π/2)` },
}

/** Snap a computed angle onto the lattice when it is on it, so it prints exactly. */
function onLattice(a: number): number {
  const k = specialIndex(a)
  return k !== null ? k * STEP : a
}

export function inverseTrig(fn: InvFn, v: number): InverseOutcome {
  if (!Number.isFinite(v)) return { ok: false, error: 'That value is not a number.' }
  if ((fn === 'sin' || fn === 'cos') && Math.abs(v) > 1 + 1e-12) {
    return {
      ok: false,
      error: `${fn}⁻¹ is only defined for values from −1 to 1: no angle has ${fn} θ = ${dec(v)}.`,
    }
  }
  const x = Math.max(-1, Math.min(1, v))
  const principal = onLattice(fn === 'sin' ? Math.asin(x) : fn === 'cos' ? Math.acos(x) : Math.atan(v))
  // The other solution in one turn: sin θ = sin(π − θ), cos θ = cos(−θ), tan θ = tan(θ + π).
  const raw = fn === 'sin' ? Math.PI - principal : fn === 'cos' ? -principal : principal + Math.PI
  const otherN = onLattice(norm2pi(raw))
  const principalN = norm2pi(principal)
  const same = Math.abs(wrapPi(otherN - principalN)) < 1e-9
  return {
    ok: true,
    fn,
    v,
    principal,
    other: same ? null : otherN,
    range: INV_RANGE[fn],
  }
}

// ---------------------------------------------------------------------------
// Dragging the terminal point
// ---------------------------------------------------------------------------

/** Capture radius, in screen px along the circle, for π/4 and π/6 multiples. */
export const SNAP_MAIN_PX = 10
/** And for the remaining multiples of π/12 (15°, 75° …). */
export const SNAP_FINE_PX = 6

/**
 * Snap an angle to the special lattice. π/4 and π/6 multiples are tried
 * first with the wider capture, then any multiple of π/12 with the narrow
 * one; `rPx` is the circle's radius on screen, so the capture is measured
 * along the arc the finger actually travels.
 */
export function snapTheta(
  theta: number,
  rPx: number,
  mainPx = SNAP_MAIN_PX,
  finePx = SNAP_FINE_PX,
): number {
  if (!Number.isFinite(theta) || !(rPx > 0)) return theta
  const best = (step: number): number => Math.round(theta / step) * step
  const a = best(Math.PI / 4)
  const b = best(Math.PI / 6)
  const main = Math.abs(a - theta) <= Math.abs(b - theta) ? a : b
  if (Math.abs(main - theta) * rPx <= mainPx) return onLattice(main)
  const fine = best(STEP)
  if (Math.abs(fine - theta) * rPx <= finePx) return onLattice(fine)
  return theta
}

/**
 * The angle a drag reaches: `phi` is the pointer's direction from the centre
 * (atan2, in (−π, π]); the result is the angle nearest `prev` with that
 * direction, so dragging round past 2π keeps counting (13π/6, not π/6) — the
 * coterminal lesson — and then it is snapped.
 */
export function dragTheta(prev: number, phi: number, rPx: number): number {
  const base = Number.isFinite(prev) ? prev : 0
  const raw = base + wrapPi(phi - base)
  return snapTheta(raw, rPx)
}

// ---------------------------------------------------------------------------
// The special-angle table
// ---------------------------------------------------------------------------

/** The sixteen angles of the unit-circle chart, in k·π/12. */
export const SPECIAL_16: readonly number[] = [0, 2, 3, 4, 6, 8, 9, 10, 12, 14, 15, 16, 18, 20, 21, 22]

export interface SpecialRow {
  k: number
  theta: number
  rad: string
  deg: string
  cos: string
  sin: string
  tan: string
}

export function specialRows(): SpecialRow[] {
  return SPECIAL_16.map((k) => ({
    k,
    theta: k * STEP,
    rad: piText(k),
    deg: `${k * 15}°`,
    cos: exactTrig('cos', k)?.text ?? 'undefined',
    sin: exactTrig('sin', k)?.text ?? 'undefined',
    tan: exactTrig('tan', k)?.text ?? 'undefined',
  }))
}
