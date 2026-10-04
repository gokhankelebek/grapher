// ============================================================================
// src/core/tidy.ts — "Tidy to nice numbers" for a SKETCHED curve.
//
// A teacher hand-draws a parabola and the fitter, being honest, reports
// y = 0.99251x² + 0.03295x − 3.9329. What the teacher meant was y = x² − 4.
// tidyOffer() decides whether to offer that one click, and what it says.
//
// HOW
//   Each supported family is rewritten in the form a teacher reads (the
//   "teacher parameters"): slope/intercept, expanded or vertex-form
//   polynomial, A·sin(b(x − h)) + d, a·e^{bx} + c or a·B^x + c,
//   a·f(x − h) + k, a circle's centre and radius. Those parameters are
//   snapped one at a time, most structural first (frequency before phase,
//   base before amplitude, leading coefficient before constant), and after
//   every snap the parameters still free are RE-SOLVED against the ink
//   (linear least squares wherever the family is linear in them). That is
//   what makes the search robust to correlated coefficients: once a = 1 is
//   fixed, the intercept is re-estimated for a = 1, not inherited from the
//   a = 0.99251 fit. Each parameter is offered a handful of nearby simple
//   values — 0, the integers either side, and the nearest half, third and
//   quarter (plus 1/5…1/10 for a small coefficient; π-multiples for a
//   phase, π-periods for a frequency, ln-of-a-nice-base for an exponential
//   rate, √n for a radius) — and every combination is scored.
//
//   Each value carries a COST: 0 → 0, integer → 1, half → 2,
//   third/quarter → 3, small unit fraction → 3.5 (see `ratCost` and the
//   per-family cost tables). The offer is the lowest-cost combination that
//   passes the acceptance rule below, ties broken by smaller rms. Zero is
//   the cheapest value of all, which is how a term like 0.03295x is
//   removed: zero is tried, and kept whenever the ink does not object.
//   Costs are per family where the family has its own idea of simple: a
//   phase of π/4 beats a phase of 1 radian, e^{±x} and 2^x beat e^{2x/3},
//   r² = 5 is nearly as simple as r = 3, and a cosine is written when its
//   shift is simpler than the sine's.
//
//   The search is exhaustive over those candidates (no pruning: the re-solve
//   minimises vertical residuals but acceptance is judged on normal ones, so
//   a node's estimate is not a bound). 1–12 ms per call on a 160-point
//   stroke, poly4 the slowest; MAX_LEAVES caps a pathological case.
//
// HOW THE FIT IS MEASURED
//   `rms` (reported) is measured the way recognize() measures σ
//   (FittedCurve.error): the vertical residual RMS over EVERY ink point for
//   explicit families, the radial residual |dist − r| for a circle.
//
//   ACCEPTANCE uses the same residuals turned toward the curve's normal:
//   each vertical residual is divided by √(1 + f′(x)²) — its first-order
//   (Sampson) distance — both for the tidy candidate and for the current
//   params (σₙ). Vertical residuals blow up wherever a curve is steep: near
//   a recip's pole, a log's asymptote, the vertical tangent of a cube root,
//   the arms of a narrow parabola. Measured that way, a snapped pole 0.03
//   to the side of a hand-drawn one looked like a miss of several units
//   (2/(x − 1) + 3 refused, 2cbrt(x − 1) refused), while the same inflation
//   of σ waved through tidies that visibly did NOT fit (2/(x − 1) + 3 tidied
//   to 6/x + 2). Normal distances put every family on one footing: a
//   correct tidy of a jittered sketch measures 0.6–1.6 σₙ in every family.
//
//   Where an explicit model is undefined at an ink point (left of a sqrt's
//   branch point, left of a log's asymptote, exactly on a recip's pole) the
//   residual is the HORIZONTAL distance to the curve instead of
//   recognize()'s 1e6 sentinel. The fitter pins b at or left of the ink, so
//   its own σ never meets the case; a snapped b = −2 against ink that
//   starts at x = −2.02 does, and is two hundredths off, not a million.
//
// ACCEPTANCE RULE (tuned in tests/tidy.test.ts)
//
//     rmsₙ(tidy) ≤ max(2.5·σₙ, 0.5% of the ink's bounding-box diagonal)
//
//   σₙ is measured fresh on the ink from the current params. curve.error is
//   only a staleness check: if σₙ > 2·curve.error (or > 5% of the
//   diagonal) the curve was edited away from its ink and null is returned
//   rather than a tidy that would snap it back. Measured, 20
//   seeds each, jitter 0.03 through the real stroke pipeline + recognize():
//
//   * Correct tidies (x² − 4, 2(x − 1)² − 3, x/2 − 3, x³ − 3x,
//     2sin(x − π/4), −cos(πx/2), eˣ, 3·2ˣ − 1, circles, 2|x − 1| + 3,
//     √(x + 2) − 1, ln(x − 1), 2/(x − 1) + 3, ∛x, 2∛(x − 1)): rmsₙ
//     ≤ 1.6 σₙ and ≤ 0.39% of the diagonal.
//   * The motivating parabola (fit 0.99251x² + 0.03295x − 3.9329, σ 0.025,
//     ink x ∈ [−3, 3]) against x² − 4: up to 3.4 σₙ — a systematic miss, the
//     way real hands miss — but only 0.30–0.35% of the diagonal. It passes on
//     the diagonal term.
//   * The nearest WRONG tidies: 1.15x² → (5/4)x² at 3.1–5.2 σₙ and
//     0.67–0.79%; 1.3sin(1.3x) + 0.4 → (4/3)sin(4x/3) + 1/3 at 3.9–6.8 σₙ
//     and 0.67–0.79%; slope 0.62 → 2/3 at ≈ 15 σₙ and 2.3%; 1.3x² → x² at
//     ≈ 10 σₙ and 2.4%. All refused.
//   The spec's starting point (2.5σ, 1.2% of the diagonal, vertical) let the
//   wrong ones through on the diagonal term; 0.5% sits between 0.39% and
//   0.67%. Note 1.3x² IS tidied — to (4/3)x², 2.5% away and within 2.1 σₙ:
//   a third is a simple value and the ink cannot tell the two apart.
//
// NOT OFFERED (null) when: the curve is not a sketch (typed `expr_N`, no
// ink, too little ink), the ink is stale (above), the family is unsupported (gauss, logistic, power,
// ellipse, polar, Fourier, vline), a parameter is not finite, no
// combination passes the rule, or the best combination IS the current
// curve (already tidy — nothing to do). Never throws.
//
// OUTPUT FORMATS (src parses with parseExpression; text is the same
// function as a Unicode button label, with U+2212 minus and superscripts)
//   line     y = 2x + 1            | y = (1/2)x - 3       → y = ½x − 3
//   poly2    y = x^2 - 4           | y = 2(x - 1)^2 - 3   → y = 2(x − 1)² − 3
//            (vertex form is used when it is at least as simple; expanded
//             otherwise — x² − 2x stays expanded, x² + 2x + 1 → (x + 1)²)
//   poly3/4  y = x^3 - 3x         | y = (1/4)x^4 - 2x^2
//   sine     y = 2sin(x) + 1 | y = 3sin(2x) | y = 2sin(x - pi/4) → 2sin(x − π/4)
//            y = sin((pi/2)(x - 1/2)) | y = -cos(pi x/2) → −cos(πx/2)
//            (a cosine is used when its shift is simpler: sin(π/2·(x − 1))
//             IS −cos(πx/2); the phase is always the principal one)
//   exp      y = e^x | y = e^(-x) + 2 | y = 3(2)^x - 1 → y = 3·2ˣ − 1
//   circle   x^2 + y^2 = 9        | (x - 1)^2 + (y + 2)^2 = 4 | x^2 + y^2 = 5
//   abs      y = 2|x - 1| + 3     sqrt  y = sqrt(x + 2) - 1  → √(x + 2) − 1
//   cbrt     y = cbrt(x)  → ∛x    log   y = ln(x - 1)
//   recip    y = 2/(x - 1) + 3    | y = 1/(2(x - 1))
// ============================================================================

import type { FittedCurve, Vec2 } from './types'
import { MODELS } from './fit/models'
import { linearLeastSquares } from './fit/optimize'

export interface TidyOffer {
  /** The typed line the sketch becomes, parseable by parseExpression: "y = x^2 - 4" */
  src: string
  /** The same line as pretty Unicode for a button label: "y = x² − 4" */
  text: string
  /** The tidied parameters in the SAME model's param layout as curve.params */
  params: number[]
  /** RMS distance of the tidied curve from the ink, measured the way σ is */
  rms: number
  /** The family the params belong to (always curve.modelId). */
  modelId: string
  /**
   * The domain to give the tidied curve. Equal to curve.domain except for
   * sqrt and log, whose domain starts AT the branch point / asymptote b —
   * which the tidy may have moved.
   */
  domain: [number, number] | null
  /** Simplicity cost of the chosen combination (lower is simpler). */
  cost: number
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** rms_tidy ≤ max(SIGMA_K·σ, DIAG_FRAC·diag) — see the header. */
const SIGMA_K = 2.5
const DIAG_FRAC = 0.005

const MIN_INK = 8
/** σₙ beyond this fraction of the ink's diagonal: the ink is not this curve's. */
const STALE_FRAC = 0.05

// ---------------------------------------------------------------------------
// Nice numbers
// ---------------------------------------------------------------------------

/**
 * A simple value. `kind` says how to read p/q:
 *   rat  v = p/q            pi  v = (p/q)·π
 *   sqrt v = √(p/q)         ln  v = ln(p/q)
 * `tag` carries a family-specific rendering choice (sine: 'cos').
 */
interface Nice {
  v: number
  cost: number
  kind: 'rat' | 'pi' | 'sqrt' | 'ln'
  p: number
  q: number
  tag?: string
}

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b)
  while (b) { const t = a % b; a = b; b = t }
  return a || 1
}

function ratCost(p: number, q: number): number {
  if (p === 0) return 0
  if (q === 1) return 1
  if (q === 2) return 2
  if (q <= 4) return 3
  return 3.5
}

function rat(p: number, q: number): Nice {
  const g = gcd(p, q)
  const pp = p / g, qq = q / g
  return { v: pp / qq, cost: ratCost(pp, qq), kind: 'rat', p: pp, q: qq }
}

const BIG = 1e6

/** Keep the cheapest Nice per (kind, value). */
function dedupe(list: Nice[]): Nice[] {
  const out: Nice[] = []
  for (const n of list) {
    if (!Number.isFinite(n.v)) continue
    const i = out.findIndex(o => o.kind === n.kind && o.tag === n.tag && o.p === n.p && o.q === n.q)
    if (i < 0) out.push(n)
    else if (n.cost < out[i].cost) out[i] = n
  }
  return out
}

/**
 * Nearby simple rationals: 0, floor/ceil, nearest half/third/quarter, and
 * the nearest unit fraction 1/5…1/10 for a small value.
 */
function ratCands(v: number, opts: { zero?: boolean; maxDen?: number; nonzero?: boolean } = {}): Nice[] {
  if (!Number.isFinite(v) || Math.abs(v) > BIG) return []
  const maxDen = opts.maxDen ?? 4
  const out: Nice[] = []
  if (opts.zero !== false && !opts.nonzero) out.push(rat(0, 1))
  out.push(rat(Math.floor(v), 1), rat(Math.ceil(v), 1))
  for (let q = 2; q <= maxDen; q++) out.push(rat(Math.round(v * q), q))
  if (maxDen >= 4 && v !== 0 && Math.abs(v) < 0.3) {
    const k = Math.round(1 / Math.abs(v))
    if (k >= 5 && k <= 10) out.push(rat(Math.sign(v), k))
  }
  return dedupe(out.filter(n => !(opts.nonzero && n.p === 0)))
}

/** Multiples of π with a small denominator near v: kπ/d, d ∈ {1, 2, 3, 4, 6}. */
function piCands(v: number): Nice[] {
  if (!Number.isFinite(v)) return []
  const out: Nice[] = []
  for (const d of [1, 2, 3, 4, 6]) {
    const k = Math.round((v / Math.PI) * d)
    if (k === 0) continue
    const g = gcd(k, d)
    const p = k / g, q = d / g
    const cost = q === 1 ? 2 : q === 2 ? 2 : 3
    out.push({ v: (p / q) * Math.PI, cost, kind: 'pi', p, q })
  }
  return dedupe(out)
}

// ---------------------------------------------------------------------------
// Pretty printing
// ---------------------------------------------------------------------------

const MINUS = '−'
const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶',
  '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', x: 'ˣ',
}
const sup = (s: string) => s.split('').map(ch => SUP[ch] ?? ch).join('')

const VULGAR: Record<string, string> = {
  '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾', '1/5': '⅕',
  '2/5': '⅖', '3/5': '⅗', '4/5': '⅘', '1/6': '⅙', '5/6': '⅚', '1/7': '⅐',
  '1/8': '⅛', '3/8': '⅜', '5/8': '⅝', '7/8': '⅞', '1/9': '⅑', '1/10': '⅒',
}

interface Str { src: string; text: string }

/** |n| as a bare number: "3", "1/2"/"½", "pi/4"/"π/4". */
function absNum(n: Nice): Str {
  const p = Math.abs(n.p), q = n.q
  if (n.kind === 'pi') {
    const head = p === 1 ? '' : String(p)
    return q === 1
      ? { src: `${head}pi`, text: `${head}π` }
      : { src: `${head}pi/${q}`, text: `${head}π/${q}` }
  }
  if (q === 1) return { src: String(p), text: String(p) }
  return { src: `${p}/${q}`, text: VULGAR[`${p}/${q}`] ?? `${p}/${q}` }
}

/** "x", "x - 1", "x + 1/2", "x - pi/4" (no parentheses). */
function shiftStr(v: string, h: Nice): Str {
  if (h.p === 0) return { src: v, text: v }
  const a = absNum(h)
  return h.v > 0
    ? { src: `${v} - ${a.src}`, text: `${v} ${MINUS} ${a.text}` }
    : { src: `${v} + ${a.src}`, text: `${v} + ${a.text}` }
}

/** "(x - 1)" or "x" when there is no shift. */
function shiftParen(v: string, h: Nice): Str {
  const s = shiftStr(v, h)
  return h.p === 0 ? s : { src: `(${s.src})`, text: `(${s.text})` }
}

/**
 * One signed term coef·body. Empty when coef is 0. A coefficient of ±1 is
 * dropped in front of a body; a fraction is parenthesised in src
 * ("(1/2)x^2") and becomes a vulgar glyph in text ("½x²") when one exists.
 */
function termStr(coef: Nice, body: Str, leading: boolean): Str {
  if (coef.p === 0) return { src: '', text: '' }
  const neg = coef.v < 0
  const a = absNum(coef)
  let core: Str
  if (body.src === '') core = a
  else if (Math.abs(coef.p) === 1 && coef.q === 1 && coef.kind === 'rat') core = body
  else if (coef.q === 1) core = { src: a.src + body.src, text: a.text + body.text }
  else {
    const g = VULGAR[`${Math.abs(coef.p)}/${coef.q}`]
    core = {
      src: `(${a.src})${body.src}`,
      text: (g ?? `(${a.text})`) + body.text,
    }
  }
  if (leading) return neg ? { src: `-${core.src}`, text: `${MINUS}${core.text}` } : core
  return neg
    ? { src: ` - ${core.src}`, text: ` ${MINUS} ${core.text}` }
    : { src: ` + ${core.src}`, text: ` + ${core.text}` }
}

/** Sum of terms; '0' when every coefficient vanished. */
function sumStr(terms: Array<[Nice, Str]>): Str {
  let src = '', text = ''
  for (const [c, b] of terms) {
    const t = termStr(c, b, src === '')
    src += t.src
    text += t.text
  }
  return src === '' ? { src: '0', text: '0' } : { src, text }
}

const yEq = (s: Str): Str => ({ src: `y = ${s.src}`, text: `y = ${s.text}` })
const EMPTY: Str = { src: '', text: '' }

// ---------------------------------------------------------------------------
// Ink & measurement
// ---------------------------------------------------------------------------

interface Ink {
  pts: Vec2[]
  xs: number[]
  ys: number[]
  diag: number
}

function rmsOf(res: number[]): number {
  if (res.length === 0) return Infinity
  let s = 0
  for (const r of res) s += r * r
  return Math.sqrt(s / res.length)
}

/**
 * Horizontal distance from (x, y) to the curve, for an ink point where the
 * explicit model is undefined. Only these three families have a hole a
 * point can fall into; anything else falls back to recognize()'s sentinel.
 */
function horizontalMiss(modelId: string, p: number[], x: number, y: number): number {
  const [a, b, c] = p
  if (!(Math.abs(a) > 0)) return BIG
  const u = (y - c) / a
  let xc: number
  if (modelId === 'sqrt') xc = b + (u > 0 ? u * u : 0)
  else if (modelId === 'log') xc = b + Math.exp(Math.min(u, 50))
  else if (modelId === 'recip') xc = Number.isFinite(1 / (y - c)) ? b + a / (y - c) : b
  else return BIG
  const d = Math.abs(xc - x)
  return Number.isFinite(d) ? d : BIG
}

/**
 * RMS of the model on the ink. `normal` false: the way σ is measured
 * (vertical residual; radial for a circle). `normal` true: each vertical
 * residual divided by √(1 + f′(x)²) — its first-order distance along the
 * normal, which is what decides acceptance (see header).
 */
function measure(modelId: string, params: number[], ink: Ink, normal = false): number {
  if (!params.every(Number.isFinite)) return Infinity
  if (modelId === 'circle') {
    const [a, b, r] = params
    return rmsOf(ink.pts.map(pt => Math.hypot(pt.x - a, pt.y - b) - Math.abs(r)))
  }
  const ev = MODELS[modelId]?.evalExplicit
  if (!ev) return Infinity
  const res: number[] = []
  for (const pt of ink.pts) {
    const fx = ev(params, pt.x)
    const v = pt.y - fx
    if (!Number.isFinite(v)) {
      res.push(horizontalMiss(modelId, params, pt.x, pt.y))
      continue
    }
    if (!normal) { res.push(v); continue }
    const h = 1e-5 * Math.max(1, Math.abs(pt.x))
    const fp = ev(params, pt.x + h)
    const fm = ev(params, pt.x - h)
    const slope = Number.isFinite(fp) && Number.isFinite(fm) ? (fp - fm) / (2 * h)
      : Number.isFinite(fp) ? (fp - fx) / h
      : Number.isFinite(fm) ? (fx - fm) / h
      : 0
    res.push(Number.isFinite(slope) ? v / Math.sqrt(1 + slope * slope) : v)
  }
  return rmsOf(res)
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

/**
 * One way of writing a family. Teacher parameters are snapped in order
 * 0…n−1; `cond(fixed)` re-estimates ALL n given the first fixed.length
 * snapped values (continuous estimates for the rest), `cands(i, est, fixed)`
 * proposes simple values for parameter i near its estimate.
 */
interface Form {
  n: number
  cond(fixed: Nice[]): number[] | null
  cands(i: number, est: number, fixed: Nice[]): Nice[]
  toModel(t: Nice[]): number[] | null
  render(t: Nice[]): Str
  /** Added to the cost: a small preference between equally simple forms. */
  bias?: number
}

const POW_BODY = (k: number): Str =>
  k === 0 ? EMPTY : k === 1 ? { src: 'x', text: 'x' } : { src: `x^${k}`, text: `x${sup(String(k))}` }

/** Least squares of (y − offset(x)) on the given basis over finite rows. */
function lsq(ink: Ink, basis: (x: number) => number[], offset: (x: number) => number): number[] | null {
  const rows: number[][] = []
  const ys: number[] = []
  for (let i = 0; i < ink.xs.length; i++) {
    const r = basis(ink.xs[i])
    const o = offset(ink.xs[i])
    if (!r.every(Number.isFinite) || !Number.isFinite(o)) continue
    rows.push(r)
    ys.push(ink.ys[i] - o)
  }
  if (rows.length < Math.max(3, (rows[0]?.length ?? 0) + 1)) return null
  const sol = linearLeastSquares(rows, ys)
  return sol && sol.every(Number.isFinite) ? sol : null
}

/** Expanded polynomial of degree `deg`; teacher params highest power first. */
function polyExpanded(deg: number, params: number[], ink: Ink): Form {
  // teacher index i ↔ power deg − i
  return {
    n: deg + 1,
    cond(fixed) {
      if (fixed.length === 0) return Array.from({ length: deg + 1 }, (_, i) => params[deg - i])
      const j = fixed.length
      if (j > deg) return fixed.map(f => f.v)
      const freePows = Array.from({ length: deg + 1 - j }, (_, k) => deg - j - k)
      const sol = lsq(
        ink,
        x => freePows.map(pw => Math.pow(x, pw)),
        x => fixed.reduce((s, f, i) => s + f.v * Math.pow(x, deg - i), 0),
      )
      return sol ? [...fixed.map(f => f.v), ...sol] : null
    },
    cands(i, est) {
      return ratCands(est, { nonzero: i === 0 })
    },
    toModel(t) {
      return Array.from({ length: deg + 1 }, (_, pw) => t[deg - pw].v)
    },
    render(t) {
      return yEq(sumStr(t.map((c, i) => [c, POW_BODY(deg - i)] as [Nice, Str])))
    },
  }
}

/** a(x − h)² + k; teacher params [a, h, k]. */
function polyVertex(params: number[], ink: Ink): Form | null {
  const [c0, c1, c2] = params
  if (!(Math.abs(c2) > 0)) return null
  return {
    n: 3,
    bias: -0.01, // equally simple: say it the way it was drawn, around its vertex
    cond(fixed) {
      if (fixed.length === 0) {
        const h = -c1 / (2 * c2)
        return [c2, h, c0 - c2 * h * h]
      }
      const a = fixed[0].v
      if (fixed.length === 1) {
        const sol = lsq(ink, x => [x, 1], x => a * x * x)
        if (!sol) return null
        const h = -sol[0] / (2 * a)
        return [a, h, sol[1] - a * h * h]
      }
      const h = fixed[1].v
      if (fixed.length === 2) {
        const sol = lsq(ink, () => [1], x => a * (x - h) * (x - h))
        return sol ? [a, h, sol[0]] : null
      }
      return fixed.map(f => f.v)
    },
    cands(i, est) {
      return ratCands(est, { nonzero: i === 0 })
    },
    toModel(t) {
      const [a, h, k] = t.map(n => n.v)
      return [a * h * h + k, -2 * a * h, a]
    },
    render(t) {
      const [a, h, k] = t
      const inner = shiftParen('x', h)
      const body = { src: `${inner.src}^2`, text: `${inner.text}²` }
      return yEq(sumStr([[a, body], [k, EMPTY]]))
    },
  }
}

/** A·sin(b(x − h)) + d (or A·cos(b(x − g)) + d); teacher params [b, h, A, d]. */
function sineForm(params: number[], ink: Ink): Form | null {
  let [A, b, c] = params
  const d = params[3]
  if (!(Math.abs(b) > 0) || !(Math.abs(A) > 0)) return null
  if (b < 0) { A = -A; b = -b; c = -c }
  if (A < 0) { A = -A; c += Math.PI }
  return {
    n: 4,
    cond(fixed) {
      if (fixed.length === 0) return [b, -c / b, A, d]
      const bb = fixed[0].v
      if (fixed.length === 1) {
        const sol = lsq(ink, x => [Math.sin(bb * x), Math.cos(bb * x), 1], () => 0)
        if (!sol) return null
        const amp = Math.hypot(sol[0], sol[1])
        const ph = Math.atan2(sol[1], sol[0])
        return [bb, -ph / bb, amp, sol[2]]
      }
      const h = fixed[1].v
      if (fixed.length === 2) {
        const sol = lsq(ink, x => [Math.sin(bb * (x - h)), 1], () => 0)
        return sol ? [bb, h, sol[0], sol[1]] : null
      }
      const amp = fixed[2].v
      if (fixed.length === 3) {
        const sol = lsq(ink, () => [1], x => amp * Math.sin(bb * (x - h)))
        return sol ? [bb, h, amp, sol[0]] : null
      }
      return fixed.map(f => f.v)
    },
    cands(i, est, fixed) {
      if (i === 0) {
        // a plain frequency, or a period that is a whole number (b = 2π/P)
        const out = ratCands(est, { nonzero: true }).filter(n => n.v > 0)
        const P0 = (2 * Math.PI) / est
        for (const P of new Set([Math.floor(P0), Math.ceil(P0), Math.round(P0)])) {
          if (!(P >= 1) || P > 60) continue
          const g = gcd(2, P)
          const p = 2 / g, q = P / g
          const cost = P === 2 ? 1.5 : P === 1 || P === 4 ? 2 : P === 3 || P === 6 || P === 8 ? 2.5 : 3
          out.push({ v: (p / q) * Math.PI, cost, kind: 'pi', p, q })
        }
        return dedupe(out)
      }
      if (i === 1) {
        // h is free modulo half a period (A's sign absorbs the other half),
        // so only the principal shift, |h| ≤ P/4, is ever written: a shift of
        // 11/2 that happens to sit within 0.002 of π/4 − 2π is not a phase a
        // teacher means. A cosine reads h + P/4 as its shift.
        const bN = fixed[0]
        const P = (2 * Math.PI) / bN.v
        const H = P / 2
        const reach = H / 2 + 1e-9
        // in radians (plain b) a phase of π/2 or π/4 is the natural one, and
        // a phase of 1 is not; with a π-frequency the shift is a plain number
        const near = (v: number): Nice[] =>
          bN.kind === 'pi'
            ? ratCands(v)
            : [
                ...ratCands(v, { maxDen: 2 }).map(n => ({ ...n, cost: n.p === 0 ? 0 : n.cost + 1 })),
                ...piCands(v).map(n => ({ ...n, cost: n.q <= 2 ? 1.5 : 2 })),
              ]
        const out: Nice[] = []
        for (let k = -3; k <= 3; k++) {
          for (const n of near(est + k * H)) {
            if (Math.abs(n.v) <= reach) out.push(n)
          }
          for (const n of near(est + P / 4 + k * H)) {
            if (Math.abs(n.v) <= reach) {
              out.push({ ...n, v: n.v - P / 4, tag: 'cos', cost: n.cost + 0.05 })
            }
          }
        }
        return dedupe(out)
      }
      if (i === 2) return ratCands(est, { nonzero: true })
      return ratCands(est)
    },
    toModel(t) {
      const [bb, h, amp, dd] = t.map(n => n.v)
      return [amp, bb, -bb * h, dd]
    },
    render(t) {
      const [bN, hN, amp, dd] = t
      const fn = hN.tag === 'cos' ? 'cos' : 'sin'
      // the shift as written: the cosine's own g = h + P/4
      const shift: Nice = hN.tag === 'cos'
        ? { ...hN, v: hN.v + Math.PI / (2 * bN.v) }
        : hN
      let arg: Str
      if (shift.p === 0) {
        // b·x
        if (bN.kind === 'rat') {
          if (bN.q === 1) arg = bN.p === 1 ? { src: 'x', text: 'x' } : { src: `${bN.p}x`, text: `${bN.p}x` }
          else {
            const num = bN.p === 1 ? 'x' : `${bN.p}x`
            arg = { src: `${num}/${bN.q}`, text: `${num}/${bN.q}` }
          }
        } else {
          const head = bN.p === 1 ? '' : String(bN.p)
          arg = bN.q === 1
            ? { src: `${head}pi x`, text: `${head}πx` }
            : { src: `${head}pi x/${bN.q}`, text: `${head}πx/${bN.q}` }
        }
      } else {
        const inner = shiftStr('x', shift)
        if (bN.kind === 'rat' && bN.p === 1 && bN.q === 1) arg = inner
        else {
          const a = absNum(bN)
          const coef = bN.q === 1 ? a : { src: `(${a.src})`, text: `(${a.text})` }
          arg = { src: `${coef.src}(${inner.src})`, text: `${coef.text}(${inner.text})` }
        }
      }
      const body = { src: `${fn}(${arg.src})`, text: `${fn}(${arg.text})` }
      return yEq(sumStr([[amp, body], [dd, EMPTY]]))
    },
  }
}

/** Nice exponential bases B (b = ln B) and what each costs. */
const BASES: Array<[number, number, number]> = [
  [2, 1, 1], [1, 2, 1], [3, 1, 1.5], [1, 3, 1.5], [10, 1, 1.5], [1, 10, 1.5],
  [4, 1, 2], [1, 4, 2], [5, 1, 2], [1, 5, 2], [3, 2, 3], [2, 3, 3],
]

/** a·e^{bx} + c or a·B^x + c; teacher params [b, a, c]. */
function expForm(params: number[], ink: Ink): Form | null {
  const [a0, b0, c0] = params
  if (!(Math.abs(b0) > 0) || !(Math.abs(a0) > 0)) return null
  return {
    n: 3,
    cond(fixed) {
      if (fixed.length === 0) return [b0, a0, c0]
      const b = fixed[0].v
      if (fixed.length === 1) {
        const sol = lsq(ink, x => [Math.exp(b * x), 1], () => 0)
        return sol ? [b, sol[0], sol[1]] : null
      }
      const a = fixed[1].v
      if (fixed.length === 2) {
        const sol = lsq(ink, () => [1], x => a * Math.exp(b * x))
        return sol ? [b, a, sol[0]] : null
      }
      return fixed.map(f => f.v)
    },
    cands(i, est) {
      if (i === 0) {
        const out: Nice[] = ratCands(est, { nonzero: true }).map(n => ({
          ...n,
          // e^{±x} is the simplest exponential there is
          cost: Math.abs(n.p) === 1 && n.q === 1 ? 1 : n.q === 1 ? 1.5 : n.cost,
        }))
        const ranked = BASES
          .map(([p, q, cost]) => ({ v: Math.log(p / q), cost, kind: 'ln' as const, p, q }))
          .sort((x, y) => Math.abs(x.v - est) - Math.abs(y.v - est))
        out.push(...ranked.slice(0, 3))
        return dedupe(out)
      }
      if (i === 1) return ratCands(est, { nonzero: true })
      return ratCands(est)
    },
    toModel(t) {
      return [t[1].v, t[0].v, t[2].v]
    },
    render(t) {
      const [bN, aN, cN] = t
      let body: Str
      if (bN.kind === 'ln') {
        // a·B^x: "2^x", "3(2)^x" → "3·2ˣ", "(1/2)^x" → "(½)ˣ", "(1/2)(3)^x" → "½·3ˣ"
        const base = absNum(rat(bN.p, bN.q))
        const unitA = Math.abs(aN.p) === 1 && aN.q === 1
        if (bN.q !== 1) body = { src: `(${base.src})^x`, text: `(${base.text})ˣ` }
        else if (unitA) body = { src: `${base.src}^x`, text: `${base.text}ˣ` }
        else body = { src: `(${base.src})^x`, text: `·${base.text}ˣ` }
      } else {
        // e^{bx}
        const neg = bN.v < 0
        const p = Math.abs(bN.p), q = bN.q
        const sgn = neg ? '-' : ''
        if (q === 1) {
          const k = p === 1 ? 'x' : `${p}x`
          body = {
            src: p === 1 && !neg ? 'e^x' : `e^(${sgn}${k})`,
            text: `e${sup(sgn + k)}`,
          }
        } else {
          const num = p === 1 ? 'x' : `${p}x`
          body = { src: `e^(${sgn}${num}/${q})`, text: `e^(${neg ? MINUS : ''}${num}/${q})` }
        }
      }
      return yEq(sumStr([[aN, body], [cN, EMPTY]]))
    },
  }
}

/** (x − a)² + (y − b)² = r²; teacher params [a, b, r]. */
function circleForm(params: number[], ink: Ink): Form | null {
  const [a0, b0] = params
  const r0 = Math.abs(params[2])
  if (!(r0 > 0)) return null
  const meanDist = (a: number, b: number) => {
    let s = 0
    for (const pt of ink.pts) s += Math.hypot(pt.x - a, pt.y - b)
    return s / ink.pts.length
  }
  return {
    n: 3,
    cond(fixed) {
      if (fixed.length === 0) return [a0, b0, r0]
      if (fixed.length === 1) return [fixed[0].v, b0, meanDist(fixed[0].v, b0)]
      if (fixed.length === 2) return [fixed[0].v, fixed[1].v, meanDist(fixed[0].v, fixed[1].v)]
      return fixed.map(f => f.v)
    },
    cands(i, est) {
      if (i < 2) return ratCands(est, { maxDen: 2 })
      // r² a whole number (x² + y² = 5), or r itself a half/third/quarter
      const out: Nice[] = []
      const r2 = est * est
      for (const k of new Set([Math.floor(r2), Math.ceil(r2), Math.round(r2)])) {
        if (k < 1) continue
        const s = Math.round(Math.sqrt(k))
        out.push({ v: Math.sqrt(k), cost: s * s === k ? 1 : 1.5, kind: 'sqrt', p: k, q: 1 })
      }
      for (const n of ratCands(est, { nonzero: true })) {
        if (n.v > 0 && n.q > 1) {
          out.push({ v: n.v, cost: n.cost, kind: 'sqrt', p: n.p * n.p, q: n.q * n.q })
        }
      }
      return dedupe(out)
    },
    toModel(t) {
      return [t[0].v, t[1].v, t[2].v]
    },
    render(t) {
      const [a, b, r] = t
      const sq = (v: string, h: Nice): Str => {
        const inner = shiftParen(v, h)
        return { src: `${inner.src}^2`, text: `${inner.text}²` }
      }
      const X = sq('x', a), Y = sq('y', b)
      const rhs = r.q === 1 ? String(r.p) : `${r.p}/${r.q}`
      return { src: `${X.src} + ${Y.src} = ${rhs}`, text: `${X.text} + ${Y.text} = ${rhs}` }
    },
  }
}

type Shifted = 'abs' | 'sqrt' | 'cbrt' | 'log' | 'recip'
const SHIFTED_F: Record<Shifted, (u: number) => number> = {
  abs: Math.abs,
  sqrt: u => (u < 0 ? Number.NaN : Math.sqrt(u)),
  cbrt: Math.cbrt,
  log: u => (u > 0 ? Math.log(u) : Number.NaN),
  recip: u => (u === 0 ? Number.NaN : 1 / u),
}

/** a·f(x − b) + c; teacher params [b, a, c]. */
function shiftedForm(id: Shifted, params: number[], ink: Ink): Form | null {
  const [a0, b0, c0] = params
  if (!(Math.abs(a0) > 0)) return null
  const f = SHIFTED_F[id]
  return {
    n: 3,
    cond(fixed) {
      if (fixed.length === 0) return [b0, a0, c0]
      const b = fixed[0].v
      if (fixed.length === 1) {
        const sol = lsq(ink, x => [f(x - b), 1], () => 0)
        return sol ? [b, sol[0], sol[1]] : null
      }
      const a = fixed[1].v
      if (fixed.length === 2) {
        const sol = lsq(ink, () => [1], x => a * f(x - b))
        return sol ? [b, a, sol[0]] : null
      }
      return fixed.map(n => n.v)
    },
    cands(i, est) {
      return ratCands(est, { nonzero: i === 1 })
    },
    toModel(t) {
      return [t[1].v, t[0].v, t[2].v]
    },
    render(t) {
      const [b, a, c] = t
      if (id === 'recip') {
        // the numerator IS the coefficient: "2/(x - 1)", "1/(2(x - 1))"
        const neg = a.v < 0
        const p = Math.abs(a.p), q = a.q
        const sh = shiftStr('x', b)
        let den: Str
        if (q === 1) den = b.p === 0 ? sh : { src: `(${sh.src})`, text: `(${sh.text})` }
        else den = b.p === 0
          ? { src: `(${q}x)`, text: `(${q}x)` }
          : { src: `(${q}(${sh.src}))`, text: `(${q}(${sh.text}))` }
        const head: Str = {
          src: `${neg ? '-' : ''}${p}/${den.src}`,
          text: `${neg ? MINUS : ''}${p}/${den.text}`,
        }
        const tail = termStr(c, EMPTY, false)
        return yEq({ src: head.src + tail.src, text: head.text + tail.text })
      }
      const inner = shiftStr('x', b)
      let body: Str
      if (id === 'abs') body = { src: `|${inner.src}|`, text: `|${inner.text}|` }
      else if (id === 'sqrt') {
        body = { src: `sqrt(${inner.src})`, text: b.p === 0 ? '√x' : `√(${inner.text})` }
      } else if (id === 'cbrt') {
        body = { src: `cbrt(${inner.src})`, text: b.p === 0 ? '∛x' : `∛(${inner.text})` }
      } else body = { src: `ln(${inner.src})`, text: `ln(${inner.text})` }
      return yEq(sumStr([[a, body], [c, EMPTY]]))
    },
  }
}

function formsFor(modelId: string, params: number[], ink: Ink): Form[] {
  switch (modelId) {
    case 'line': return [polyExpanded(1, params, ink)]
    case 'poly2': {
      const v = polyVertex(params, ink)
      return v ? [polyExpanded(2, params, ink), v] : [polyExpanded(2, params, ink)]
    }
    case 'poly3': return [polyExpanded(3, params, ink)]
    case 'poly4': return [polyExpanded(4, params, ink)]
    case 'sine': { const f = sineForm(params, ink); return f ? [f] : [] }
    case 'exp': { const f = expForm(params, ink); return f ? [f] : [] }
    case 'circle': { const f = circleForm(params, ink); return f ? [f] : [] }
    case 'abs': case 'sqrt': case 'cbrt': case 'log': case 'recip': {
      const f = shiftedForm(modelId, params, ink)
      return f ? [f] : []
    }
    default: return []
  }
}

const PARAM_COUNT: Record<string, number> = {
  line: 2, poly2: 3, poly3: 4, poly4: 5, sine: 4, exp: 3, circle: 3,
  abs: 3, sqrt: 3, cbrt: 3, log: 3, recip: 3,
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

interface Leaf {
  t: Nice[]
  form: Form
  model: number[]
  rms: number
  cost: number
}

/** Hard cap on leaves scored per form, so a pathological stroke stays fast. */
const MAX_LEAVES = 20000

function searchForm(modelId: string, form: Form, ink: Ink, tol: number, out: Leaf[]): void {
  let leaves = 0
  const walk = (fixed: Nice[]): void => {
    if (leaves >= MAX_LEAVES) return
    if (fixed.length === form.n) {
      leaves++
      const raw = form.toModel(fixed)
      if (!raw || !raw.every(Number.isFinite)) return
      const model = raw.map(v => (v === 0 ? 0 : v)) // no −0 from a vanished term
      const rms = measure(modelId, model, ink, true)
      if (!(rms <= tol)) return
      const cost = fixed.reduce((s, n) => s + n.cost, 0) + (form.bias ?? 0)
      out.push({ t: fixed, form, model, rms, cost })
      return
    }
    const est = form.cond(fixed)
    if (!est || !est.every(Number.isFinite)) return
    const i = fixed.length
    for (const c of form.cands(i, est[i], fixed)) walk([...fixed, c])
  }
  walk([])
}

function sameParams(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!(Math.abs(a[i] - b[i]) <= 1e-9 * Math.max(1, Math.abs(a[i]), Math.abs(b[i])))) return false
  }
  return true
}

/**
 * The tidy version of a sketched curve, or null when there is nothing to
 * offer (not a sketch, unsupported family, already tidy, or no tidy version
 * fits the ink well). Never throws.
 */
export function tidyOffer(curve: FittedCurve): TidyOffer | null {
  try {
    return tidyOfferUnsafe(curve)
  } catch {
    return null
  }
}

function tidyOfferUnsafe(curve: FittedCurve): TidyOffer | null {
  const modelId = curve?.modelId
  if (typeof modelId !== 'string' || !(modelId in PARAM_COUNT)) return null
  const params = curve.params
  if (!Array.isArray(params) || params.length !== PARAM_COUNT[modelId]) return null
  if (!params.every(v => typeof v === 'number' && Number.isFinite(v))) return null
  const raw = curve.sourceStroke
  if (!Array.isArray(raw)) return null
  const pts = raw.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
  if (pts.length < MIN_INK) return null

  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
  for (const p of pts) {
    if (p.x < xMin) xMin = p.x
    if (p.x > xMax) xMax = p.x
    if (p.y < yMin) yMin = p.y
    if (p.y > yMax) yMax = p.y
  }
  const diag = Math.hypot(xMax - xMin, yMax - yMin)
  if (!(diag > 0) || !Number.isFinite(diag)) return null
  const ink: Ink = { pts, xs: pts.map(p => p.x), ys: pts.map(p => p.y), diag }

  const sigma = measure(modelId, params, ink, true)
  if (!Number.isFinite(sigma)) return null
  // Stale ink: the curve was edited (a slider, a drag that left the ink
  // behind) and no longer describes what was drawn. A fresh fit always has
  // σₙ ≤ curve.error (a normal residual never exceeds the vertical one), so
  // twice the stored σ — or 5% of the ink's size — means the ink is about
  // some other curve, and tidying toward it would undo the teacher's edit.
  const stored = curve.error
  if (Number.isFinite(stored) && stored >= 0 && sigma > 2 * stored + 1e-9 * diag) return null
  if (sigma > STALE_FRAC * diag) return null
  const tol = Math.max(SIGMA_K * sigma, DIAG_FRAC * diag)

  const leaves: Leaf[] = []
  for (const form of formsFor(modelId, params, ink)) searchForm(modelId, form, ink, tol, leaves)
  if (leaves.length === 0) return null

  leaves.sort((a, b) => a.cost - b.cost || a.rms - b.rms)
  const best = leaves[0]
  if (sameParams(best.model, params)) return null

  const s = best.form.render(best.t)
  let domain = curve.domain ? [curve.domain[0], curve.domain[1]] as [number, number] : null
  if ((modelId === 'sqrt' || modelId === 'log') && domain) {
    const b = best.model[1]
    domain = [b, Math.max(domain[1], b)]
  }
  return {
    src: s.src,
    text: s.text,
    params: best.model,
    rms: measure(modelId, best.model, ink),
    modelId,
    domain,
    cost: best.cost,
  }
}
