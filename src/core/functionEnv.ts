// ============================================================================
// Functions that use other functions (src/core/functionEnv.ts)
//
//     g(x) = 2f(x − 1) + 3        h(x) = f(g(x))        k(x) = f'(x)
//     p(x) = f(x)·g(x)            q(x) = f(x) − g(x)    f^-1 as a curve
//
// Every curve on the board may carry a NAME (f, g, h …). A typed expression
// can call a named curve like any built-in function; the call is evaluated
// against that curve's CURRENT formula and parameters, so dragging f's
// slider moves g live.
//
// PARSER (src/core/parse/index.ts, additive — the core agent's file):
//   parseExpression(src, env?) — a second, optional argument.
//     Without env, or when env does not define a name, every input parses
//     EXACTLY as before: `a(x + 1)` is still the slider a times (x + 1).
//     With env defining f, `f(u)` is a call: evaluated through env.eval,
//     rendered f\left(u\right). `f'(u)`, `f''(u)` are the first and second
//     derivative of the named curve (numeric, Richardson, from env.eval).
//     A named call inside the curve's OWN definition (f(x) = f(x − 1) + 1)
//     is a positioned error ("f cannot use itself"), and so is a name that
//     is not a function of one variable (a circle).
//   The resulting ModelSpec closes over `env`, not over a snapshot, so a
//   change to f is seen by g on its next evaluation without re-parsing.
//
//   export function referencedNames(src): string[]
//       the curve names a source line calls (f, g in "f(g(x)) + g'(x)"),
//       found WITHOUT an env — every single letter immediately followed by
//       "(" or "'(" that is not a built-in function and not the line's own
//       head — so the App can order and wire curves before parsing them.
//   export function dependencyOrder(defs): DependencyOrder
//       topological order of named definitions; cycles reported with the
//       names on the cycle, in order ("f → g → f").
//   export function inverseRelation(curve, models, range): InverseRelation
//       the inverse of ANY explicit curve as a relation: a parametric curve
//       (x, y) = (f(t), t) over t ∈ range, plus whether f is one-to-one on
//       that range (the horizontal line test) and, when it is not, the
//       widest intervals around 0 on which it is (for "restrict the domain
//       to x ≥ 0" advice), found from the sign changes of f′.
// ============================================================================

import type { FittedCurve, ModelSpec, Vec2 } from './types'
import { namedCallSites, richardsonD1 } from './parse'
import { verifiedExact } from './exact'

/** What a typed expression may call by name. */
export interface FunctionEnv {
  /** True when `name` is a curve that can be called as a function of x. */
  has(name: string): boolean
  /** f(x) at the curve's current parameters; NaN where undefined. */
  eval(name: string, x: number): number
}

export interface NamedDef {
  name: string
  /** The names it calls (referencedNames of its source). */
  uses: string[]
}

export interface DependencyOrder {
  /** Names in an order where every name comes after the names it uses. */
  order: string[]
  /** Each cycle as the names along it, first repeated last: ["f","g","f"]. */
  cycles: string[][]
}

export interface InverseRelation {
  /** A parametric ModelSpec for (f(t), t), params = [] — register under an id. */
  makeModel(modelId: string): ModelSpec
  tRange: [number, number]
  oneToOne: boolean
  /** Intervals of x on which f is one-to-one (monotone), widest first. */
  monotoneIntervals: [number, number][]
  /** Teacher sentence: "f is one-to-one, so its inverse is a function" /
   *  "f fails the horizontal line test — restrict its domain to x ≥ 0". */
  sentence: string
}

// ----------------------------------------------------------------------------
// referencedNames
// ----------------------------------------------------------------------------

/**
 * The curve names `src` calls, unique, in order of first appearance.
 *
 * Found without an env, by the parser's own tokenizer: every single letter
 * that is not a built-in name (x, y, r, t, e, and the functions) and is
 * followed IMMEDIATELY by `(`, `'(` or `''(` — so `f'(x)` names f, `2f(x − 1)`
 * names f, `f (x)` (a space) names nothing, exactly as the parser reads them.
 * The line's own head is left out (g of `g(x) = f(x) + 1`, everywhere on the
 * line), as is the base of `log_b(x)`.
 *
 * `a(x + 1)` DOES list a: without an env nobody can tell a slider times a
 * bracket from a call, and the App intersects this list with the names that
 * exist, so a slider a is simply never matched.
 */
export function referencedNames(src: string): string[] {
  const { head, sites } = namedCallSites(src)
  const out: string[] = []
  for (const s of sites) {
    if (s.name !== head && !out.includes(s.name)) out.push(s.name)
  }
  return out
}

// ----------------------------------------------------------------------------
// dependencyOrder
// ----------------------------------------------------------------------------

/**
 * Kahn's algorithm over the named definitions.
 *
 * An edge is drawn only to a name that IS in `defs` — a call of an unknown
 * name is the App's error to report, not a cycle. Among names that are ready
 * at the same time, input order is kept, so the result is stable as lines are
 * edited. A repeated name merges its `uses`.
 *
 * Names that sit on a cycle, or depend on one, cannot be ordered; they are
 * appended to `order` in input order (so every name still appears exactly
 * once), and each cycle is reported as the names along it, first repeated
 * last — ["f", "g", "f"] means f uses g and g uses f; ["f", "f"] is a name
 * that uses itself.
 */
export function dependencyOrder(defs: readonly NamedDef[]): DependencyOrder {
  const names: string[] = []
  const uses = new Map<string, Set<string>>()
  for (const d of defs) {
    if (!d || typeof d.name !== 'string') continue
    let u = uses.get(d.name)
    if (!u) { u = new Set(); uses.set(d.name, u); names.push(d.name) }
    for (const n of d.uses ?? []) u.add(n)
  }
  const index = new Map(names.map((n, i) => [n, i]))
  const indeg = new Map<string, number>(names.map((n) => [n, 0]))
  const dependents = new Map<string, string[]>(names.map((n) => [n, []]))
  for (const n of names) {
    for (const u of uses.get(n)!) {
      if (!index.has(u)) continue // unknown: not an edge
      dependents.get(u)!.push(n)
      indeg.set(n, indeg.get(n)! + 1)
    }
  }

  const byInput = (a: string, b: string): number => index.get(a)! - index.get(b)!
  const ready = names.filter((n) => indeg.get(n) === 0)
  const order: string[] = []
  while (ready.length > 0) {
    const n = ready.shift()!
    order.push(n)
    for (const m of dependents.get(n)!) {
      const k = indeg.get(m)! - 1
      indeg.set(m, k)
      if (k === 0) { ready.push(m); ready.sort(byInput) }
    }
  }

  const placed = new Set(order)
  const stuck = names.filter((n) => !placed.has(n))
  const cycles: string[][] = []
  if (stuck.length > 0) {
    const stuckSet = new Set(stuck)
    const seenCycle = new Set<string>()
    const state = new Map<string, 1 | 2>() // 1 = on the path, 2 = done
    const path: string[] = []
    const visit = (n: string): void => {
      state.set(n, 1)
      path.push(n)
      const next = [...uses.get(n)!].filter((u) => stuckSet.has(u)).sort(byInput)
      for (const u of next) {
        const s = state.get(u)
        if (s === 1) {
          const loop = path.slice(path.indexOf(u))
          // one rotation per cycle: start at the name typed first
          let r = 0
          for (let i = 1; i < loop.length; i++) if (byInput(loop[i], loop[r]) < 0) r = i
          const rotated = [...loop.slice(r), ...loop.slice(0, r)]
          const key = rotated.join('\u0000')
          if (!seenCycle.has(key)) { seenCycle.add(key); cycles.push([...rotated, rotated[0]]) }
        } else if (s === undefined) {
          visit(u)
        }
      }
      path.pop()
      state.set(n, 2)
    }
    for (const n of stuck) if (!state.has(n)) visit(n)
    order.push(...stuck)
  }
  return { order, cycles }
}

// ----------------------------------------------------------------------------
// inverseRelation — the horizontal line test, read off the sign of f′
// ----------------------------------------------------------------------------

/** Samples of f′ across the range. */
const INV_SAMPLES = 400
/** |f′| below this fraction of its typical size carries no sign (x³ at 0). */
const INV_FLAT_SLOPE = 1e-9
/** Two samples this close (relative) are the same height: a flat stretch. */
const INV_FLAT_STEP = 1e-13
/** Bisection / golden-section iterations — past double precision on any range. */
const INV_ITER = 80

type EdgeKind = 'edge' | 'critical' | 'pole' | 'gap'

interface MonoPiece {
  lo: number
  hi: number
  loKind: EdgeKind
  hiKind: EdgeKind
  /** direction of f on the piece; 0 = no evidence either way */
  sign: -1 | 0 | 1
  /** f stands still somewhere on it (floor's treads): not one-to-one there */
  flat?: boolean
  fmin: number
  fmax: number
}

const MINUS = '−'

/** A plain number for a sentence: 3 decimals at most, a real minus sign. */
function plainNumber(v: number): string {
  const r = Math.round(v * 1000) / 1000
  const s = String(Object.is(r, -0) ? 0 : r)
  return s.startsWith('-') ? MINUS + s.slice(1) : s
}

/** The latex of "x = f(y)": the curve's own formula with x and y traded. */
function inverseLatex(spec: ModelSpec | undefined, params: number[]): string {
  let tex = ''
  try { tex = spec ? spec.latex(params) : '' } catch { tex = '' }
  const eq = tex.indexOf('=')
  const lhs = eq >= 0 ? tex.slice(0, eq).trim() : ''
  // only a formula that is plainly "y = …" / "f(x) = …" / a bare body
  if (eq >= 0 && !/^(y|[A-Za-z]\\left\(x\\right\))$/.test(lhs)) return 'x = f\\left(y\\right)'
  const body = (eq >= 0 ? tex.slice(eq + 1) : tex).trim()
  if (body === '' || /(^|[^A-Za-z\\])y(?![A-Za-z])/.test(body)) return 'x = f\\left(y\\right)'
  // a standalone x (not inside \exp, \max, …) becomes y
  return `x = ${body.replace(/(?<![A-Za-z\\])x(?![A-Za-z])/g, 'y')}`
}

/**
 * The inverse of an explicit curve as a relation, and whether it is a
 * function.
 *
 * The relation is the parametric curve (x, y) = (f(t), t) over t ∈ `range`
 * clipped to the curve's domain — every inverse, one-to-one or not, is that
 * reflection. Its model reads f through the curve's model with the params the
 * curve has NOW (`curve.params` is copied here; rebuild after a slider move).
 *
 * The horizontal line test: f′ (Richardson) is sampled at ~400 points and the
 * range cut into pieces where its sign is constant — at turning points
 * (located by bisecting f′ and snapped to π/2, 1/3, √2 … by exact.ts when f′
 * vanishes there), at poles and jumps (f moving against its own slope), and at
 * the edges of where f is defined. |f′| below ε carries no sign (x³ at 0 is
 * not a turning point), and a stretch where f does not move at all is flat, so
 * f is not one-to-one. f is one-to-one when there is no flat stretch and the
 * pieces' ranges of values do not overlap — which is what lets 1/x (two
 * decreasing pieces, a pole between) pass and tan fail.
 *
 * `monotoneIntervals` are the pieces, widest first (ties: nearer 0 first).
 * The sentence advises the piece containing 0 — the one starting at 0 when 0
 * is a turning point, so x² reads "restrict its domain to x ≥ 0" and sin
 * reads "to −π/2 ≤ x ≤ π/2". A side of that piece that is only the edge of
 * the range is left open. `name` is the curve's letter for the sentence.
 */
export function inverseRelation(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  range: [number, number],
  name = 'f',
): InverseRelation {
  const spec: ModelSpec | undefined = models ? models[curve.modelId] : undefined
  const params = Array.isArray(curve.params) ? curve.params.slice() : []
  const ev = spec && curve.kind === 'explicit' ? spec.evalExplicit : undefined

  let lo = Math.min(range[0], range[1])
  let hi = Math.max(range[0], range[1])
  if (curve.domain) {
    lo = Math.max(lo, Math.min(curve.domain[0], curve.domain[1]))
    hi = Math.min(hi, Math.max(curve.domain[0], curve.domain[1]))
  }
  const tRange: [number, number] = [lo, hi]

  const f = (x: number): number => {
    if (!ev) return Number.NaN
    let v: unknown
    try { v = ev.call(spec, params, x) } catch { return Number.NaN }
    return typeof v === 'number' ? v : Number.NaN
  }
  const latex = inverseLatex(spec, params)
  const makeModel = (modelId: string): ModelSpec => ({
    id: modelId,
    kind: 'parametric',
    name: 'Inverse',
    evalParametric: (_p: number[], t: number): Vec2 => ({ x: f(t), y: t }),
    latex: () => latex,
    paramMeta: () => [],
  })

  const none = (sentence: string): InverseRelation => ({
    makeModel, tRange, oneToOne: false, monotoneIntervals: [], sentence,
  })
  if (!ev) return none(`Only a function y = ${name}(x) has an inverse drawn this way`)
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) {
    return none(`${name} has no stretch of x to reflect here`)
  }

  const { pieces, flat, slopeScale } = monotonePieces(f, lo, hi)
  const mono = pieces.filter((p) => p.sign !== 0 && !p.flat && p.hi - p.lo > 1e-12 * (hi - lo))
  if (mono.length === 0) {
    return none(
      flat
        ? `${name} fails the horizontal line test — it takes one value on a whole stretch of x, so its inverse is not a function`
        : `${name} is not defined on this stretch of x`,
    )
  }

  let oneToOne = !flat
  for (let i = 0; oneToOne && i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i], b = pieces[j]
      if (!(a.fmax >= a.fmin) || !(b.fmax >= b.fmin)) continue
      const ov = Math.min(a.fmax, b.fmax) - Math.max(a.fmin, b.fmin)
      const tol = 1e-9 * (1 + Math.max(Math.abs(a.fmin), Math.abs(a.fmax), Math.abs(b.fmin), Math.abs(b.fmax)))
      if (ov > tol) { oneToOne = false; break }
    }
  }

  // snap every cut to the number a teacher would write
  const textOf = new Map<number, string>()
  const snap = (x: number, kind: EdgeKind): number => {
    if (kind === 'edge') return x
    const check = (c: number): boolean => {
      if (kind === 'critical') {
        const d = richardsonD1(f, c)
        return Number.isFinite(d) && Math.abs(d) <= 1e-7 * (1 + slopeScale)
      }
      const here = Number.isFinite(f(c))
      if (kind === 'pole') return !here || Math.abs(f(c)) > 1e8 * (1 + Math.abs(f(x + 1e-3 * (1 + Math.abs(x)))))
      const dx = 1e-7 * (1 + Math.abs(c))
      return here !== Number.isFinite(f(c - dx)) || here !== Number.isFinite(f(c + dx))
    }
    const form = verifiedExact(x, check)
    if (form) { textOf.set(form.value, form.text); return form.value }
    return x
  }
  for (const p of mono) {
    p.lo = snap(p.lo, p.loKind)
    p.hi = snap(p.hi, p.hiKind)
  }
  const numText = (v: number): string => textOf.get(v) ?? plainNumber(v)

  const sorted = mono.slice().sort((a, b) => {
    const w = (b.hi - b.lo) - (a.hi - a.lo)
    if (Math.abs(w) > 1e-9 * (hi - lo)) return w
    return Math.abs(a.lo + a.hi) - Math.abs(b.lo + b.hi)
  })
  const monotoneIntervals = sorted.map((p): [number, number] => [p.lo, p.hi])

  if (oneToOne) {
    return {
      makeModel, tRange, oneToOne, monotoneIntervals,
      sentence: `${name} is one-to-one, so its inverse is a function`,
    }
  }

  const pick =
    sorted.find((p) => p.lo < 0 && 0 < p.hi) ??
    sorted.find((p) => p.lo === 0) ??
    sorted.find((p) => p.hi === 0) ??
    sorted[0]
  const closedAt = (x: number, kind: EdgeKind): boolean =>
    kind === 'critical' || (kind === 'gap' && Number.isFinite(f(x)))
  const showLo = pick.loKind !== 'edge'
  const showHi = pick.hiKind !== 'edge'
  const loOp = closedAt(pick.lo, pick.loKind) ? '≤' : '<'
  const hiOp = closedAt(pick.hi, pick.hiKind) ? '≤' : '<'
  let cond: string
  if (showLo && showHi) cond = `${numText(pick.lo)} ${loOp} x ${hiOp} ${numText(pick.hi)}`
  else if (showLo) cond = `x ${loOp === '≤' ? '≥' : '>'} ${numText(pick.lo)}`
  else if (showHi) cond = `x ${hiOp} ${numText(pick.hi)}`
  else cond = `${numText(pick.lo)} ≤ x ≤ ${numText(pick.hi)}`
  return {
    makeModel, tRange, oneToOne, monotoneIntervals,
    sentence: `${name} fails the horizontal line test — restrict its domain to ${cond}`,
  }
}

/** Bisect g to a sign change inside [a, b] (g(a), g(b) of opposite sign). */
function bisectSign(g: (x: number) => number, a: number, b: number): number {
  let lo = a, hi = b
  const sLo = Math.sign(g(lo))
  for (let i = 0; i < INV_ITER; i++) {
    const m = 0.5 * (lo + hi)
    if (m === lo || m === hi) break
    const v = g(m)
    if (v === 0) return m
    if (!Number.isFinite(v)) { hi = m; continue }
    if (Math.sign(v) === sLo) lo = m
    else hi = m
  }
  return 0.5 * (lo + hi)
}

/**
 * A jump of f inside [a, b], where f otherwise moves in direction `sg`: keep
 * the half across which f moves AGAINST its slope (tan from +∞ to −∞).
 */
function bisectJump(f: (x: number) => number, a: number, b: number, sg: number): number {
  let lo = a, hi = b
  for (let i = 0; i < INV_ITER; i++) {
    const m = 0.5 * (lo + hi)
    if (m === lo || m === hi) break
    const fm = f(m)
    if (!Number.isFinite(fm) || (fm - f(lo)) * sg < 0) hi = m
    else lo = m
  }
  return 0.5 * (lo + hi)
}

/** Golden-section minimum of g on [a, b]. */
function goldenMin(g: (x: number) => number, a: number, b: number): number {
  const phi = 0.6180339887498949
  let lo = a, hi = b
  let x1 = hi - (hi - lo) * phi, x2 = lo + (hi - lo) * phi
  let g1 = g(x1), g2 = g(x2)
  for (let i = 0; i < INV_ITER; i++) {
    if (!(g1 >= g2)) { hi = x2; x2 = x1; g2 = g1; x1 = hi - (hi - lo) * phi; g1 = g(x1) }
    else { lo = x1; x1 = x2; g1 = g2; x2 = lo + (hi - lo) * phi; g2 = g(x2) }
    if (hi - lo <= 1e-15 * Math.max(1, Math.abs(lo))) break
  }
  return 0.5 * (lo + hi)
}

/** Cut [lo, hi] into the pieces on which f keeps one direction. */
function monotonePieces(
  f: (x: number) => number,
  lo: number,
  hi: number,
): { pieces: MonoPiece[]; flat: boolean; slopeScale: number } {
  const n = INV_SAMPLES
  const step = (hi - lo) / n
  const xs = new Array<number>(n + 1)
  const fs = new Array<number>(n + 1)
  const ds = new Array<number>(n + 1)
  for (let i = 0; i <= n; i++) {
    const x = i === n ? hi : lo + i * step
    xs[i] = x
    fs[i] = f(x)
    ds[i] = Number.isFinite(fs[i]) ? richardsonD1(f, x) : Number.NaN
  }
  const mags = ds.filter((d) => Number.isFinite(d) && d !== 0).map(Math.abs).sort((a, b) => a - b)
  const slopeScale = mags.length > 0 ? mags[Math.floor(mags.length / 2)] : 0
  const eps = INV_FLAT_SLOPE * slopeScale
  const sgn = ds.map((d): -1 | 0 | 1 => (!Number.isFinite(d) || Math.abs(d) <= eps ? 0 : d > 0 ? 1 : -1))
  const d = (x: number): number => richardsonD1(f, x)
  const finiteAt = (x: number): number => (Number.isFinite(f(x)) ? 1 : -1)
  const isCritical = (c: number): boolean => {
    const dc = d(c)
    return Number.isFinite(f(c)) && Number.isFinite(dc) && Math.abs(dc) <= 1e-6 * (1 + slopeScale)
  }

  const pieces: MonoPiece[] = []
  let cur: MonoPiece | null = null
  let flat = false
  let flatRun = 0
  let lastIdx = -1
  let lastSignIdx = -1
  const add = (p: MonoPiece, v: number): void => {
    if (!Number.isFinite(v)) return
    if (v < p.fmin) p.fmin = v
    if (v > p.fmax) p.fmax = v
  }
  const open = (x: number, kind: EdgeKind): MonoPiece => {
    const p: MonoPiece = { lo: x, hi: x, loKind: kind, hiKind: 'edge', sign: 0, fmin: Infinity, fmax: -Infinity }
    // a turning point or a defined edge belongs to the piece; a pole does not
    // (f there is whichever side's ±∞ the search happened to stop on)
    if (kind === 'critical' || kind === 'gap') add(p, f(x))
    return p
  }
  const close = (p: MonoPiece, x: number, kind: EdgeKind): void => {
    p.hi = x
    p.hiKind = kind
    if (kind === 'critical' || kind === 'gap') add(p, f(x))
    pieces.push(p)
  }

  // A sample that landed ON a pole (tan at the double nearest π/2 is −1.6e16,
  // finite) says nothing about direction; skip it and let the jump across
  // it be found from its neighbours.
  const mag = (v: number): number => (Number.isFinite(v) ? Math.abs(v) : 0)
  const spike = (i: number): boolean =>
    Math.abs(fs[i]) > 1e8 * (1 + mag(fs[i - 1]) + mag(fs[i + 1]))

  for (let i = 0; i <= n; i++) {
    if (cur && i < n && Number.isFinite(fs[i]) && spike(i)) continue
    if (!Number.isFinite(fs[i])) {
      if (cur) { close(cur, bisectSign(finiteAt, xs[lastIdx], xs[i]), 'gap'); cur = null }
      continue
    }
    let s = sgn[i]
    if (!cur) {
      cur = i === 0 ? open(xs[0], 'edge') : open(bisectSign(finiteAt, xs[i - 1], xs[i]), 'gap')
      flatRun = 0
      lastSignIdx = -1
    } else {
      const prev = fs[lastIdx]
      const df = fs[i] - prev
      if (Math.abs(df) <= INV_FLAT_STEP * Math.max(Math.abs(fs[i]), Math.abs(prev))) {
        if (++flatRun >= 2) { flat = true; cur.flat = true }
      } else {
        flatRun = 0
      }
      // A slope that disagrees with how f actually moved since the last sample
      // is not evidence: the difference straddled a pole (tan just left of
      // π/2 "slopes down"). A real turn shows up one sample later anyway.
      if (s !== 0 && df * s < 0) s = 0
      if (cur.sign !== 0 && s !== 0 && s !== cur.sign) {
        // f′ changed sign: a turning point (or a pole of even order, 1/x²)
        const c = bisectSign(d, xs[lastSignIdx], xs[i])
        const kind: EdgeKind = isCritical(c) ? 'critical' : 'pole'
        close(cur, c, kind)
        cur = open(c, kind)
      } else if (cur.sign !== 0 && df * cur.sign < 0 && flatRun === 0) {
        // f moved against its own slope: a turn f′ was too small to sign
        // (x¹⁰ at 0), or a jump — tan going from +∞ to −∞
        const sg = cur.sign
        const from = xs[lastSignIdx >= 0 ? lastSignIdx : lastIdx]
        const turn = goldenMin((x) => -sg * f(x), from, xs[i])
        const kind: EdgeKind = isCritical(turn) ? 'critical' : 'pole'
        const c = kind === 'critical' ? turn : bisectJump(f, from, xs[i], sg)
        close(cur, c, kind)
        cur = open(c, kind)
      }
    }
    add(cur, fs[i])
    if (s !== 0) {
      if (cur.sign === 0) cur.sign = s
      lastSignIdx = i
    }
    lastIdx = i
  }
  if (cur) close(cur, xs[n], 'edge')
  return { pieces, flat, slopeScale }
}
