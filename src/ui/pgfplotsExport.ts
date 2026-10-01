// ============================================================================
// src/ui/pgfplotsExport.ts — the board as a pgfplots axis a teacher can EDIT.
//
// The TikZ export is the picture; this is the mathematics. It is built from
// the export SCENE (and the typed equations), not from the display list:
//
//   axis      xmin/xmax/ymin/ymax of the export window, axis lines=middle,
//             arrows and grid per the figure style, ticks where the canvas
//             puts them (π ticks as xtick + xticklabels, $-\frac{\pi}{2}$ …),
//             axis names, the origin's 0 or O;
//   curves    a typed explicit curve is \addplot {its expression}, translated
//             from the parser's own AST into pgfmath (^, sqrt, ln, log_b,
//             e^x → exp(x), |x| → abs, trig in radians via trig format
//             plots=rad) and CHECKED: the translation is evaluated against the
//             board's model at a spread of x before it is trusted. Piecewise
//             and restricted lines become one \addplot per piece. Domains are
//             split where the formula is undefined or has a pole. Anything else
//             — a sketch, a polar or implicit curve, a line that calls another
//             curve, floor/ceil/sign, inverse trig — is `coordinates {…}`
//             sampled exactly as the board draws it, a new \addplot wherever
//             the board lifts its pen (poles, jumps);
//   marks     analysis points, crossings, holes, piece and end dots as
//             `only marks` plots (mark=* filled, mark=o hollow);
//   asymptotes dashed; shaded areas via `fill between` (the fillbetween
//             library), Riemann rectangles as rectangles.
//
// Anything it does not translate is listed in a `% not exported:` comment, so
// the file never pretends to be the whole figure when it is not.
// ============================================================================

import type { FittedCurve, ModelSpec, SpecialPoint, Vec2, Viewport } from '../core/types'
import { ppuX, ppuY, toMath, toPrintColor } from '../core/types'
import type { ExprNode } from '../core/parse'
import { parseAst, piecewiseParts } from '../core/parse'
import { findAsymptotes, findHoles } from '../core/holes'
import type { BoardScene } from './renderBoard'
import { MONO_FILL_ALPHA, captionHeight } from './renderBoard'
import { drawCurve } from '../render/curves'
import { curveEndPoints, resolveEnds } from '../render/endCaps'
import { holeRange } from '../render/holes'
import { pieceMarks } from '../render/pieceDots'
import { OVERLAY_FILL_ALPHA } from '../render/overlays'
import type { InequalityInfo } from '../core/types'
import { regionPolygons } from '../core/inequality2d'
import {
  INEQ_DIM_ALPHA,
  INEQ_FILL_ALPHA,
  INEQ_MONO_ALPHA,
  INEQ_MONO_DIM_ALPHA,
  INEQ_MONO_SOLUTION_ALPHA,
  INEQ_SOLUTION_ALPHA,
  inequalityOf,
} from '../render/inequalities'
import type { GridStep, PiStep } from '../render/grid'
import {
  PI_LABEL_MIN_PX,
  UNIT_MIN_PX,
  isPiStep,
  minorTickLabel,
  pickPiTickStep,
  pickTickStep,
  tickLabel,
  unitTickStep,
} from '../render/grid'
import { VectorCtx } from '../render/vectorCtx'
import { parseColor } from '../render/vectorCtx'
import { cssHex, num } from '../render/vectorSvg'
import { texEscapeText, texLabel } from '../render/texText'
import { textWidthEstimate } from '../render/fontMetrics'
import { pointText } from './numeric'
import { PX_PER_CM } from './vectorExport'

// ---------------------------------------------------------------------------
// Expression translation
// ---------------------------------------------------------------------------

/** pgfmath expression tree: what gets written, and what gets checked. */
type Pgf =
  | { t: 'num'; v: number }
  | { t: 'x' }
  | { t: 'pi' }
  | { t: 'neg'; a: Pgf }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Pgf; b: Pgf }
  | { t: 'call'; fn: string; args: Pgf[] }
  /** (c < 0 ? -1 : 1) — the sign factor of a real odd root */
  | { t: 'sgn'; a: Pgf }

class Untranslatable extends Error {}

/** Functions the board's parser knows, as pgfmath names. Absent = not translated. */
const PGF_FN: Readonly<Record<string, string>> = {
  sin: 'sin', cos: 'cos', tan: 'tan', sec: 'sec', csc: 'cosec', cot: 'cot',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', sqrt: 'sqrt', abs: 'abs', ln: 'ln',
  log: 'log10', log10: 'log10', log2: 'log2', exp: 'exp', min: 'min', max: 'max',
}

/** Why a function is not written as an expression (it is sampled instead). */
const SAMPLED_FN: Readonly<Record<string, string>> = {
  floor: 'a step function (floor) is sampled so its jumps stay jumps',
  ceil: 'a step function (ceil) is sampled so its jumps stay jumps',
  sign: 'sign() is sampled so its jump stays a jump',
  asin: 'inverse trig is sampled (pgfplots versions disagree on its units)',
  acos: 'inverse trig is sampled (pgfplots versions disagree on its units)',
  atan: 'inverse trig is sampled (pgfplots versions disagree on its units)',
}

/** p/q in lowest terms with q ≤ 15, when v is one. */
function rational(v: number): [number, number] | null {
  for (let q = 1; q <= 15; q++) {
    const p = Math.round(v * q)
    if (Math.abs(p / q - v) < 1e-12) return [p, q]
  }
  return null
}

function constValue(n: Pgf): number | null {
  switch (n.t) {
    case 'num': return n.v
    case 'pi': return Math.PI
    case 'neg': { const a = constValue(n.a); return a === null ? null : -a }
    case 'bin': {
      const a = constValue(n.a)
      const b = constValue(n.b)
      if (a === null || b === null) return null
      switch (n.op) {
        case '+': return a + b
        case '-': return a - b
        case '*': return a * b
        case '/': return a / b
        case '^': return Math.pow(a, b)
      }
    }
    // eslint-disable-next-line no-fallthrough
    default: return null
  }
}

function toPgf(n: ExprNode, param: (name: string) => number): Pgf {
  switch (n.t) {
    case 'num': return { t: 'num', v: n.v }
    case 'const':
      if (n.name === 'pi') return { t: 'pi' }
      if (n.name === 'tau') return { t: 'bin', op: '*', a: { t: 'num', v: 2 }, b: { t: 'pi' } }
      return { t: 'call', fn: 'exp', args: [{ t: 'num', v: 1 }] }
    case 'var':
      if (n.name !== 'x') throw new Untranslatable(`the variable ${n.name}`)
      return { t: 'x' }
    case 'param': {
      const v = param(n.name)
      if (!Number.isFinite(v)) throw new Untranslatable(`the slider ${n.name}`)
      return { t: 'num', v }
    }
    case 'neg': return { t: 'neg', a: toPgf(n.a, param) }
    case 'bin': {
      if (n.op === '^') {
        // e^u is exp(u): pgfmath's e^… works, but exp is what a reader expects.
        if (n.a.t === 'const' && n.a.name === 'e') return { t: 'call', fn: 'exp', args: [toPgf(n.b, param)] }
        const base = toPgf(n.a, param)
        const exp = toPgf(n.b, param)
        // u^(p/q), q odd: the board's real root, defined for u < 0 as well.
        const ev = constValue(exp)
        if (ev !== null && !Number.isInteger(ev)) {
          const r = rational(ev)
          if (r && r[1] % 2 === 1) {
            const mag: Pgf = { t: 'bin', op: '^', a: { t: 'call', fn: 'abs', args: [base] }, b: exp }
            return Math.abs(r[0]) % 2 === 1 ? { t: 'bin', op: '*', a: { t: 'sgn', a: base }, b: mag } : mag
          }
        }
        return { t: 'bin', op: '^', a: base, b: exp }
      }
      return { t: 'bin', op: n.op, a: toPgf(n.a, param), b: toPgf(n.b, param) }
    }
    case 'call': {
      if (n.fn === 'log_') {
        // log_b(u) = ln(u)/ln(b)
        const b = toPgf(n.args[0], param)
        const u = toPgf(n.args[1], param)
        return { t: 'bin', op: '/', a: { t: 'call', fn: 'ln', args: [u] }, b: { t: 'call', fn: 'ln', args: [b] } }
      }
      if (n.fn === 'cbrt') {
        const u = toPgf(n.args[0], param)
        return {
          t: 'bin', op: '*', a: { t: 'sgn', a: u },
          b: { t: 'bin', op: '^', a: { t: 'call', fn: 'abs', args: [u] }, b: { t: 'bin', op: '/', a: { t: 'num', v: 1 }, b: { t: 'num', v: 3 } } },
        }
      }
      const fn = PGF_FN[n.fn]
      if (!fn) throw new Untranslatable(SAMPLED_FN[n.fn] ?? `the function ${n.fn}`)
      return { t: 'call', fn, args: n.args.map((a) => toPgf(a, param)) }
    }
    case 'ucall':
      throw new Untranslatable(`a call of ${n.name}`)
  }
}

/** Evaluate the pgfmath tree in JS, with pgfmath's semantics. */
function evalPgf(n: Pgf, x: number): number {
  switch (n.t) {
    case 'num': return n.v
    case 'x': return x
    case 'pi': return Math.PI
    case 'neg': return -evalPgf(n.a, x)
    case 'sgn': return evalPgf(n.a, x) < 0 ? -1 : 1
    case 'bin': {
      const a = evalPgf(n.a, x)
      const b = evalPgf(n.b, x)
      switch (n.op) {
        case '+': return a + b
        case '-': return a - b
        case '*': return a * b
        case '/': return a / b
        case '^': return Math.pow(a, b)
      }
    }
    // eslint-disable-next-line no-fallthrough
    case 'call': {
      const v = n.args.map((a) => evalPgf(a, x))
      switch (n.fn) {
        case 'sin': return Math.sin(v[0])
        case 'cos': return Math.cos(v[0])
        case 'tan': return Math.tan(v[0])
        case 'sec': return 1 / Math.cos(v[0])
        case 'cosec': return 1 / Math.sin(v[0])
        case 'cot': return Math.cos(v[0]) / Math.sin(v[0])
        case 'sinh': return Math.sinh(v[0])
        case 'cosh': return Math.cosh(v[0])
        case 'tanh': return Math.tanh(v[0])
        case 'sqrt': return Math.sqrt(v[0])
        case 'abs': return Math.abs(v[0])
        case 'ln': return Math.log(v[0])
        case 'log10': return Math.log10(v[0])
        case 'log2': return Math.log2(v[0])
        case 'exp': return Math.exp(v[0])
        case 'min': return Math.min(v[0], v[1])
        case 'max': return Math.max(v[0], v[1])
      }
      return Number.NaN
    }
  }
  return Number.NaN
}

/** A pgfmath number: plain decimal, never exponent notation. */
function pgfNum(v: number): string {
  if (!Number.isFinite(v)) return '0'
  if (Math.abs(v) < 1e-12) return '0'
  const digits = Math.max(0, Math.min(12, 10 - Math.floor(Math.log10(Math.abs(v)))))
  let s = v.toFixed(digits)
  if (s.includes('.')) s = s.replace(/\.?0+$/, '')
  return s === '-0' ? '0' : s
}

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 }

/**
 * Binding strength. A negation or a negative literal binds LOOSEST of all as
 * an operand, so it is always parenthesised there: pgfmath is not trusted
 * with `x*-2` or `2^-x`.
 */
function prec(n: Pgf): number {
  if (n.t === 'bin') return PREC[n.op]
  if (n.t === 'neg') return 0.5
  if (n.t === 'num' && n.v < 0) return 0.5
  return 5
}

/** a + (−b) is a − b, and a − (−b) is a + b: how a reader writes it. */
function negated(n: Pgf): Pgf | null {
  if (n.t === 'neg') return n.a
  if (n.t === 'num' && n.v < 0) return { t: 'num', v: -n.v }
  return null
}

/** pgfmath source for a tree. Parenthesises generously: pgfmath is not C. */
function writePgf(n: Pgf): string {
  const wrap = (c: Pgf, min: number): string => (prec(c) <= min ? `(${writePgf(c)})` : writePgf(c))
  switch (n.t) {
    case 'num': return pgfNum(n.v)
    case 'x': return 'x'
    case 'pi': return 'pi'
    case 'neg': return `-${wrap(n.a, 4)}`
    case 'sgn': return `(${wrap(n.a, 4)} < 0 ? -1 : 1)`
    case 'call': return `${n.fn}(${n.args.map(writePgf).join(', ')})`
    case 'bin': {
      switch (n.op) {
        case '+': {
          const m = negated(n.b)
          return m ? `${wrap(n.a, 0)} - ${wrap(m, 1)}` : `${wrap(n.a, 0)} + ${wrap(n.b, 0.5)}`
        }
        case '-': {
          const m = negated(n.b)
          return m ? `${wrap(n.a, 0)} + ${wrap(m, 0.5)}` : `${wrap(n.a, 0)} - ${wrap(n.b, 1)}`
        }
        case '*': return `${wrap(n.a, 1)}*${wrap(n.b, 2)}`
        case '/': return `${wrap(n.a, 1)}/${wrap(n.b, 2)}`
        case '^': return `${wrap(n.a, 4)}^${wrap(n.b, 4)}`
      }
    }
  }
  return '0'
}

/** Does the tree mention a periodic function (wants more samples)? */
function wiggly(n: Pgf): boolean {
  if (n.t === 'call') return ['sin', 'cos', 'tan', 'sec', 'cosec', 'cot'].includes(n.fn) || n.args.some(wiggly)
  if (n.t === 'bin') return wiggly(n.a) || wiggly(n.b)
  if (n.t === 'neg' || n.t === 'sgn') return wiggly(n.a)
  return false
}

/** One translated formula and the x-interval it applies on. */
export interface PgfPiece {
  expr: string
  tree: Pgf
  lo: number
  hi: number
}

export type Translation =
  | { ok: true; pieces: PgfPiece[] }
  | { ok: false; reason: string }

/**
 * The right-hand side a typed line plots: `y = …`, `f(x) = …`, or a bare
 * expression. Null when the line is some other kind of equation.
 */
function plottedSide(lhs: ExprNode, rhs: ExprNode | null): ExprNode | null {
  if (rhs === null) return lhs
  if (lhs.t === 'var' && lhs.name === 'y') return rhs
  // f(x) = … reads (without an env) as the product f·x
  if (lhs.t === 'bin' && lhs.op === '*' && lhs.b.t === 'var' && lhs.b.name === 'x' && lhs.a.t === 'param') return rhs
  return null
}

/** Check a translation against the board's own model at a spread of x. */
function agrees(tree: Pgf, f: (x: number) => number, lo: number, hi: number): boolean {
  let checked = 0
  const n = 13
  for (let i = 0; i < n; i++) {
    const x = lo + ((i + 0.37) / n) * (hi - lo)
    const want = f(x)
    if (!Number.isFinite(want)) continue
    const got = evalPgf(tree, x)
    if (!Number.isFinite(got)) return false
    if (Math.abs(got - want) > 1e-7 * (1 + Math.abs(want))) return false
    checked++
  }
  return checked > 0
}

/**
 * A typed explicit curve as pgfmath, piece by piece over [lo, hi]. Checked
 * against the model; `ok: false` says why it has to be sampled instead.
 */
export function translateCurve(
  src: string,
  model: ModelSpec,
  params: readonly number[],
  lo: number,
  hi: number,
): Translation {
  const meta = (() => {
    try {
      return model.paramMeta([...params])
    } catch {
      return []
    }
  })()
  const param = (name: string): number => {
    const i = meta.findIndex((m) => m.name === name)
    return i >= 0 ? params[i] : Number.NaN
  }
  const f = (x: number): number => {
    try {
      return model.evalExplicit ? model.evalExplicit([...params], x) : Number.NaN
    } catch {
      return Number.NaN
    }
  }
  try {
    const parts = piecewiseParts(src)
    if (parts) {
      const branches = parts.branches.map((b) => {
        const ast = parseAst(b.expr)
        if (!ast.ok) throw new Untranslatable('a piece the parser reads differently')
        const side = plottedSide(ast.lhs, ast.rhs)
        if (!side) throw new Untranslatable('a piece that is not y = …')
        return toPgf(side, param)
      })
      const infos = model.pieces ? model.pieces([...params]) : []
      if (infos.length === 0) throw new Untranslatable('a piecewise line with no pieces')
      const out: PgfPiece[] = []
      for (const info of infos) {
        const a = Math.max(lo, info.lo)
        const b = Math.min(hi, info.hi)
        if (!(b > a)) continue
        const tree = branches.find((t) => agrees(t, f, a, b))
        if (!tree) throw new Untranslatable('a piece whose formula did not check out')
        out.push({ expr: writePgf(tree), tree, lo: a, hi: b })
      }
      return { ok: true, pieces: out }
    }
    const ast = parseAst(src)
    if (!ast.ok) return { ok: false, reason: 'the parser reads it only with the board’s functions' }
    const side = plottedSide(ast.lhs, ast.rhs)
    if (!side) return { ok: false, reason: 'it is not of the form y = …' }
    const tree = toPgf(side, param)
    if (!agrees(tree, f, lo, hi)) return { ok: false, reason: 'the translation did not match the board' }
    return { ok: true, pieces: [{ expr: writePgf(tree), tree, lo, hi }] }
  } catch (err) {
    return { ok: false, reason: err instanceof Untranslatable ? err.message : 'it could not be read' }
  }
}

/**
 * Where f is defined (finite) inside [lo, hi], split at the given poles: the
 * sub-intervals an \addplot's domain can safely run over. Edges are located by
 * bisection and pulled a hair inside.
 */
export function definedIntervals(
  f: (x: number) => number,
  lo: number,
  hi: number,
  cuts: readonly number[] = [],
): Array<[number, number]> {
  if (!(hi > lo)) return []
  const N = 600
  const span = hi - lo
  const ok = (x: number): boolean => Number.isFinite(f(x))
  const edge = (a: number, b: number): number => {
    // a is on one side, b on the other; return the defined side's end
    const aOk = ok(a)
    let l = a
    let r = b
    for (let i = 0; i < 50; i++) {
      const m = (l + r) / 2
      if (ok(m) === aOk) l = m
      else r = m
    }
    return aOk ? l : r
  }
  const runs: Array<[number, number]> = []
  let start: number | null = ok(lo) ? lo : null
  let prevX = lo
  for (let i = 1; i <= N; i++) {
    const x = lo + (span * i) / N
    const d = ok(x)
    if (start === null && d) start = edge(prevX, x)
    else if (start !== null && !d) {
      runs.push([start, edge(prevX, x)])
      start = null
    }
    prevX = x
  }
  if (start !== null) runs.push([start, hi])
  // Split at poles and removable holes.
  const gap = span * 1e-4
  const out: Array<[number, number]> = []
  for (const [a, b] of runs) {
    let s = a
    for (const c of [...cuts].sort((p, q) => p - q)) {
      if (c <= s + gap || c >= b - gap) continue
      out.push([s, c - gap])
      s = c + gap
    }
    out.push([s, b])
  }
  // Pull each edge a hair inside, so the domain written does not round out of it.
  const pad = span * 1e-6
  return out
    .map(([a, b]): [number, number] => [a === lo ? a : a + pad, b === hi ? b : b - pad])
    .filter(([a, b]) => b - a > span * 1e-5)
}

// ---------------------------------------------------------------------------
// Sampled fallback: the board's own polyline
// ---------------------------------------------------------------------------

/** Douglas–Peucker in screen px. */
function simplify(pts: Vec2[], tol: number): Vec2[] {
  if (pts.length <= 2) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack: Array<[number, number]> = [[0, pts.length - 1]]
  while (stack.length > 0) {
    const [i, j] = stack.pop() as [number, number]
    const a = pts[i]
    const b = pts[j]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    let far = -1
    let best = tol
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((pts[k].x - a.x) * dy - (pts[k].y - a.y) * dx) / len
      if (d > best) {
        best = d
        far = k
      }
    }
    if (far >= 0) {
      keep[far] = 1
      stack.push([i, far], [far, j])
    }
  }
  return pts.filter((_, i) => keep[i] === 1)
}

/** Join runs whose ends touch (an implicit curve comes out as many short runs). */
function chain(runs: Vec2[][]): Vec2[][] {
  const eps = 0.05
  const near = (a: Vec2, b: Vec2): boolean => Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps
  const left = runs.filter((r) => r.length >= 2).map((r) => r.slice())
  const out: Vec2[][] = []
  while (left.length > 0) {
    let cur = left.shift() as Vec2[]
    let grew = true
    while (grew) {
      grew = false
      for (let i = 0; i < left.length; i++) {
        const r = left[i]
        const end = cur[cur.length - 1]
        if (near(end, r[0])) cur = cur.concat(r.slice(1))
        else if (near(end, r[r.length - 1])) cur = cur.concat(r.slice(0, -1).reverse())
        else if (near(cur[0], r[r.length - 1])) cur = r.slice(0, -1).concat(cur)
        else if (near(cur[0], r[0])) cur = r.slice(1).reverse().concat(cur)
        else continue
        left.splice(i, 1)
        grew = true
        break
      }
    }
    out.push(cur)
  }
  return out
}

/**
 * The curve as the board draws it, in math coordinates: one run per pen-down
 * stretch, so a pole or a jump is a new \addplot.
 */
export function sampledRuns(curve: FittedCurve, models: Record<string, ModelSpec>, vp: Viewport): Vec2[][] {
  const rec = new VectorCtx(vp.widthPx, vp.heightPx)
  drawCurve(rec as unknown as CanvasRenderingContext2D, { ...curve, visible: true }, models, vp, false, null)
  const runs: Vec2[][] = []
  for (const it of rec.list().items) {
    if (it.t !== 'path' || !it.stroke) continue
    let cur: Vec2[] = []
    for (const s of it.segs) {
      if (s.k === 'M') {
        if (cur.length > 1) runs.push(cur)
        cur = [{ x: s.x, y: s.y }]
      } else if (s.k === 'L' || s.k === 'C' || s.k === 'A') {
        cur.push({ x: s.x, y: s.y })
      }
    }
    if (cur.length > 1) runs.push(cur)
  }
  const joined = curve.kind === 'implicit' ? chain(runs) : runs
  return joined.map((r) => simplify(r, 0.25).map((p) => toMath(p, vp)))
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface PgfplotsOptions {
  /** Physical width of the whole figure; the axis box is the plot rect of the scene. */
  widthCm?: number
  /** Typed sources by curve id (the App's exprSources). */
  sources?: Readonly<Record<string, string>>
  /** Markers of the other visible curves (the App's context analysis). */
  extraMarkers?: ReadonlyArray<{ curve: FittedCurve; points: readonly SpecialPoint[] }>
  /** For the header comment. */
  title?: string
}

/** Coordinates per line in a coordinates {…} block. */
const PER_LINE = 6

export function toPgfplots(scene: BoardScene, opts: PgfplotsOptions = {}): string {
  const notExported: string[] = []
  const vp = scene.vp
  const ppx = ppuX(vp)
  const ppy = ppuY(vp)
  const xmin = vp.center.x - vp.widthPx / 2 / ppx
  const xmax = vp.center.x + vp.widthPx / 2 / ppx
  const captioned = typeof scene.caption === 'string' && scene.caption.trim() !== ''
  const band = captioned ? captionHeight(scene.present, scene.caption, vp.widthPx) : 0
  const ymin = vp.center.y - (vp.heightPx / 2 - band) / ppy
  const ymax = vp.center.y + vp.heightPx / 2 / ppy
  const spanY = ymax - ymin
  const fig = scene.figure ?? null
  const theme = fig ? fig.theme : scene.theme
  const bgLum = (() => {
    const c = parseColor(theme.bg)
    return c ? (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255 : 1
  })()
  const lightGround = bgLum > 0.5
  const print = scene.printColors === true || lightGround
  const mono = fig?.curveInk === 'mono'
  const ink = (c: string): string => (mono ? theme.axis : print ? toPrintColor(c) : c)
  const fillAlpha = (a?: number): number => (mono ? MONO_FILL_ALPHA : a ?? OVERLAY_FILL_ALPHA)
  const P = (x: number, y: number): string => `(${pgfNum(round(x))},${pgfNum(round(y))})`
  const round = (v: number): number => Math.round(v * 1e5) / 1e5

  // ---- colours -----------------------------------------------------------
  const colours = new Map<string, string>()
  const colour = (css: string): string => {
    const c = parseColor(css) ?? { r: 0, g: 0, b: 0, a: 1 }
    const hex = cssHex(c).slice(1).toUpperCase()
    if (hex === '000000') return 'black'
    if (hex === 'FFFFFF') return 'white'
    let name = colours.get(hex)
    if (!name) {
      name = `gr${colours.size + 1}`
      colours.set(hex, name)
    }
    return name
  }

  const lines: string[] = []
  const add = (s: string): void => {
    lines.push(`  ${s}`)
  }
  const coords = (pts: readonly Vec2[]): string => {
    const cs = pts.map((p) => P(p.x, p.y))
    const out: string[] = []
    for (let i = 0; i < cs.length; i += PER_LINE) out.push(cs.slice(i, i + PER_LINE).join(' '))
    return out.join('\n    ')
  }
  // One mark per point and style, one label per point and text: the analysis
  // list can name a point twice (a vertex that is also the y-intercept).
  const markSeen = new Set<string>()
  const labelSeen = new Set<string>()
  const marks = (pts: readonly Vec2[], col: string, hollow: boolean | 'diamond', size = 1.8): void => {
    const m = hollow === 'diamond' ? 'mark=diamond*' : hollow ? `mark=o, mark options={fill=white}` : 'mark=*'
    const style = `only marks, ${m}, mark size=${hollow === 'diamond' ? size + 0.4 : size}pt, color=${colour(col)}`
    const inside = pts.filter((p) => {
      if (!(p.x >= xmin && p.x <= xmax && p.y >= ymin && p.y <= ymax)) return false
      const key = `${style}|${P(p.x, p.y)}`
      if (markSeen.has(key)) return false
      markSeen.add(key)
      return true
    })
    if (inside.length === 0) return
    add(`\\addplot[${style}, forget plot] coordinates {${coords(inside)}};`)
  }
  const label = (at: Vec2, text: string, col: string, anchor = 'south west'): void => {
    const body = texLabel(text)
    if (body === '' || at.x < xmin || at.x > xmax || at.y < ymin || at.y > ymax) return
    const where = `${pgfNum(round(at.x))},${pgfNum(round(at.y))}`
    if (labelSeen.has(`${where}|${body}`)) return
    labelSeen.add(`${where}|${body}`)
    add(`\\node[anchor=${anchor}, inner sep=2pt, font=\\footnotesize, text=${colour(col)}] at (axis cs:${where}) {${body}};`)
  }

  const usesFillBetween = { on: false }

  if (scene.kind === 'number-line') {
    return [
      '% Grapher figure as pgfplots.',
      '% not exported: a number-line board has no pgfplots form. Use the TikZ export,',
      '% which draws the number line exactly as it is on the board.',
      '',
    ].join('\n')
  }
  if (scene.grid === 'polar') notExported.push('the polar ruling (drawn here on cartesian axes)')

  // ---- overlays (under the curves) --------------------------------------
  const curveById = new Map(scene.curves.map((c) => [c.id, c]))
  const translations = new Map<string, Translation>()
  const translationOf = (c: FittedCurve): Translation => {
    const got = translations.get(c.id)
    if (got) return got
    const src = opts.sources?.[c.id]
    const model = scene.models[c.modelId]
    let t: Translation
    if (c.kind !== 'explicit') t = { ok: false, reason: `a ${c.kind} curve is sampled` }
    else if (!src) t = { ok: false, reason: 'a sketched curve has no typed equation' }
    else if (!model) t = { ok: false, reason: 'no model' }
    else {
      const [dlo, dhi] = c.domain ?? [-Infinity, Infinity]
      t = translateCurve(src, model, c.params, Math.max(xmin, dlo), Math.min(xmax, dhi))
    }
    translations.set(c.id, t)
    return t
  }
  /** One curve's values on [a, b] as an \addplot body: an expression if it has one. */
  const boundary = (c: FittedCurve | null, a: number, b: number): string => {
    if (c === null) return `{0}`
    const t = translationOf(c)
    if (t.ok && t.pieces.length === 1) return `{${t.pieces[0].expr}}`
    const model = scene.models[c.modelId]
    const pts: Vec2[] = []
    for (let i = 0; i <= 100; i++) {
      const x = a + ((b - a) * i) / 100
      let y = Number.NaN
      try {
        y = model?.evalExplicit ? model.evalExplicit(c.params, x) : Number.NaN
      } catch {
        y = Number.NaN
      }
      if (Number.isFinite(y)) pts.push({ x, y: Math.max(ymin - 2 * spanY, Math.min(ymax + 2 * spanY, y)) })
    }
    return `coordinates {${coords(pts)}}`
  }

  let areaN = 0
  for (const ov of scene.overlays ?? []) {
    switch (ov.kind) {
      case 'area': {
        const c = curveById.get(ov.curveId)
        if (!c || !c.visible || c.kind !== 'explicit') {
          notExported.push('a shaded area on a curve that is hidden or not y = f(x)')
          break
        }
        const other = ov.against ? curveById.get(ov.against) ?? null : null
        const a = Math.max(xmin, Math.min(ov.from, ov.to))
        const b = Math.min(xmax, Math.max(ov.from, ov.to))
        if (!(b > a)) break
        areaN++
        const col = colour(ink(ov.color ?? c.color))
        usesFillBetween.on = true
        add(`% shaded area ${areaN}: x from ${pgfNum(round(a))} to ${pgfNum(round(b))}`)
        add(`\\addplot[draw=none, name path=area${areaN}top, domain=${pgfNum(round(a))}:${pgfNum(round(b))}, samples=101, forget plot] ${boundary(c, a, b)};`)
        add(`\\addplot[draw=none, name path=area${areaN}bot, domain=${pgfNum(round(a))}:${pgfNum(round(b))}, samples=101, forget plot] ${boundary(other, a, b)};`)
        add(`\\addplot[fill=${col}, fill opacity=${num(fillAlpha(ov.alpha), 3)}, draw=none, forget plot] fill between[of=area${areaN}top and area${areaN}bot];`)
        break
      }
      case 'rects': {
        const c = curveById.get(ov.curveId)
        const col = colour(ink(ov.color ?? c?.color ?? '#000000'))
        add('% Riemann rectangles')
        for (const r of ov.rects) {
          add(`\\draw[fill=${col}, fill opacity=${num(fillAlpha(), 3)}, draw=${col}] ${P(r.x0, 0)} rectangle ${P(r.x1, r.height)};`)
        }
        break
      }
      case 'region': {
        const col = colour(ink(ov.color ?? '#000000'))
        add(`\\fill[${col}, fill opacity=${num(fillAlpha(ov.alpha), 3)}] ${ov.boundary.map((p) => P(p.x, p.y)).join(' -- ')} -- cycle;`)
        break
      }
      case 'segment': {
        const c = ov.curveId ? curveById.get(ov.curveId) : undefined
        const col = colour(ink(ov.color ?? c?.color ?? '#000000'))
        add(`\\draw[${col}${ov.dashed ? ', dashed' : ''}] ${P(ov.from.x, ov.from.y)} -- ${P(ov.to.x, ov.to.y)};`)
        break
      }
      case 'line': {
        const c = ov.curveId ? curveById.get(ov.curveId) : undefined
        const col = colour(ink(ov.color ?? c?.color ?? '#000000'))
        add(`\\addplot[${col}${ov.dashed ? ', dashed' : ''}, domain=${pgfNum(round(xmin))}:${pgfNum(round(xmax))}, samples=2, forget plot] {${pgfNum(ov.at.y)} + ${pgfNum(ov.slope)}*(x - ${pgfNum(ov.at.x)})};`)
        break
      }
      case 'hline': {
        const c = ov.curveId ? curveById.get(ov.curveId) : undefined
        const col = colour(ink(ov.color ?? c?.color ?? '#000000'))
        add(`\\addplot[${col}${ov.dashed ? ', dashed' : ''}, forget plot] coordinates {${P(xmin, ov.y)} ${P(xmax, ov.y)}};`)
        break
      }
      case 'dot': {
        const c = ov.curveId ? curveById.get(ov.curveId) : undefined
        marks([ov.at], ink(ov.color ?? c?.color ?? '#000000'), ov.hollow === true)
        break
      }
      case 'label': {
        const c = ov.curveId ? curveById.get(ov.curveId) : undefined
        label(ov.at, ov.text, ink(ov.color ?? c?.color ?? theme.label))
        break
      }
      case 'path': {
        const c = ov.curveId ? curveById.get(ov.curveId) : undefined
        const col = colour(ink(ov.color ?? c?.color ?? '#000000'))
        const o = [col]
        if (ov.dashed) o.push('dashed')
        if (ov.fill !== undefined) o.push(`fill=${col}`, `fill opacity=${num(fillAlpha(ov.alpha), 3)}`)
        add(`\\draw[${o.join(', ')}] ${ov.points.map((p) => P(p.x, p.y)).join(' -- ')}${ov.closed ? ' -- cycle' : ''};`)
        break
      }
      default:
        notExported.push(`an overlay of kind "${ov.kind}"`)
    }
  }

  if ((scene.fields ?? []).some((f) => f.visible)) notExported.push('the slope field (the TikZ export draws it)')

  for (const pl of scene.polylines ?? []) {
    if (pl.pts.length < 2) continue
    add(`\\addplot[${colour(ink(pl.color))}${pl.dash && pl.dash.length > 0 ? ', dashed' : ''}, forget plot] coordinates {${coords(pl.pts)}};`)
  }

  // ---- two-variable inequalities: the shaded regions -----------------------
  // Each visible inequality's side as filled polygons (the same per-column
  // region the board fills), under the curves; the system's common region
  // darker. Hatching has no plain-pgfplots form and is left to TikZ/SVG.
  {
    const box = { x0: xmin, x1: xmax, y0: ymin, y1: ymax }
    const live: { c: FittedCurve; info: InequalityInfo }[] = []
    for (const c of scene.curves) {
      if (!c.visible) continue
      const info = inequalityOf(c, scene.models)
      if (info && info.parts.length > 0) live.push({ c, info })
    }
    const system = scene.inequalitySolution === true && live.length >= 2
    const own = mono ? (system ? INEQ_MONO_DIM_ALPHA : INEQ_MONO_ALPHA) : system ? INEQ_DIM_ALPHA : INEQ_FILL_ALPHA
    const fillPolys = (polys: Vec2[][], col: string, alpha: number): void => {
      for (const poly of polys) {
        if (poly.length < 3) continue
        add(`\\fill[${col}, fill opacity=${num(alpha, 3)}] ${poly.map((p) => P(p.x, p.y)).join(' -- ')} -- cycle;`)
      }
    }
    const ropts = { cols: 160, rows: 120 }
    for (const { c, info } of live) {
      add(`% inequality region: ${texCommentSafe(opts.sources?.[c.id] ?? '')}`)
      fillPolys(regionPolygons(info.parts, box, ropts), colour(ink(c.color)), own)
    }
    if (system) {
      add('% solution region of the system (every inequality holds)')
      fillPolys(
        regionPolygons(live.flatMap((l) => l.info.parts), box, ropts),
        colour(mono ? theme.axis : lightGround ? theme.label : '#e6eaf5'),
        mono ? INEQ_MONO_SOLUTION_ALPHA : INEQ_SOLUTION_ALPHA,
      )
      notExported.push("the solution region's hatching (it is shaded darker instead)")
    }
  }

  // ---- curves --------------------------------------------------------------
  const holesAll: Array<{ at: Vec2; col: string }> = []
  const dotsAll: Array<{ at: Vec2; col: string; closed: boolean }> = []
  for (const c of scene.curves) {
    if (!c.visible) continue
    const model = scene.models[c.modelId]
    if (!model) continue
    const style = scene.styles[c.id]
    const col = colour(ink(c.color))
    const o: string[] = [col]
    const w = style?.width ?? (fig ? fig.curveWidth : c.strokeWidth)
    o.push(w > 3.2 ? 'very thick' : 'thick')
    const ineq = inequalityOf(c, scene.models)
    if ((style?.dash && style.dash.length > 0) || (ineq && ineq.parts.length > 0 && ineq.parts.every((p) => p.strict))) o.push('dashed')
    if (ineq && ineq.parts.some((p) => p.strict) && ineq.parts.some((p) => !p.strict)) {
      notExported.push('a compound inequality with one dashed and one solid boundary (both drawn solid)')
    }
    if (style?.opacity !== undefined && style.opacity < 1) o.push(`opacity=${num(style.opacity, 3)}`)
    const name = fig && fig.curveEnds === 'marked' ? scene.curveNames?.[c.id] : undefined
    const src = opts.sources?.[c.id]
    add(`% ${c.kind} curve${name ? ` ${name}` : ''}${src ? `: ${src.replace(/[\r\n]+/g, ' ')}` : ''}`)

    // End caps (marked figures, and anything the teacher set by hand).
    let ends: ReturnType<typeof curveEndPoints> | null = null
    let caps: ReturnType<typeof resolveEnds> | null = null
    try {
      // An inequality's boundary runs off the board as part of a REGION:
      // no arrowheads (the board draws none either).
      if (!ineq) {
        ends = curveEndPoints(c, scene.models, vp)
        caps = resolveEnds(style, c, fig, ends)
      }
    } catch {
      ends = null
    }

    const t = translationOf(c)
    let lastPlot = -1
    if (t.ok) {
      let cuts: number[] = []
      try {
        cuts = model.singularities ? model.singularities([...c.params], [xmin, xmax]) : []
      } catch {
        cuts = []
      }
      const f = (x: number): number => {
        try {
          return model.evalExplicit ? model.evalExplicit(c.params, x) : Number.NaN
        } catch {
          return Number.NaN
        }
      }
      const plots: Array<{ expr: string; lo: number; hi: number; tree: Pgf }> = []
      for (const p of t.pieces) {
        for (const [a, b] of definedIntervals(f, p.lo, p.hi, cuts)) plots.push({ expr: p.expr, lo: a, hi: b, tree: p.tree })
      }
      // An arrow ends the plot where the graph leaves the board.
      const arrowStart = caps?.start === 'arrow' && ends?.start?.kind === 'exit'
      const arrowEnd = caps?.end === 'arrow' && ends?.end?.kind === 'exit'
      if (plots.length > 0 && arrowStart && ends?.start) {
        const x = toMath(ends.start.at, vp).x
        if (x > plots[0].lo && x < plots[0].hi) plots[0].lo = x
      }
      if (plots.length > 0 && arrowEnd && ends?.end) {
        const x = toMath(ends.end.at, vp).x
        const last = plots[plots.length - 1]
        if (x > last.lo && x < last.hi) last.hi = x
      }
      plots.forEach((p, i) => {
        const frac = (p.hi - p.lo) / Math.max(1e-9, xmax - xmin)
        const samples = Math.max(25, Math.min(401, Math.round((wiggly(p.tree) ? 241 : 121) * Math.min(1, frac * 1.5))))
        const po = [...o]
        const first = i === 0 && arrowStart
        const last = i === plots.length - 1 && arrowEnd
        if (first || last) po.push(first && last ? '<->' : first ? '<-' : '->')
        // Rounded INWARD, so a domain edge never lands outside where the
        // formula is defined (sqrt(x − 2) must not be asked for x = 1.99999).
        po.push(
          `domain=${pgfNum(Math.ceil(p.lo * 1e5) / 1e5)}:${pgfNum(Math.floor(p.hi * 1e5) / 1e5)}`,
          `samples=${samples}`,
          `restrict y to domain=${pgfNum(round(ymin - 4 * spanY))}:${pgfNum(round(ymax + 4 * spanY))}`,
        )
        add(`\\addplot[${po.join(', ')}] {${p.expr}};`)
        lastPlot = lines.length - 1
      })
    } else {
      add(`% sampled from the board: ${t.reason}`)
      const runs = sampledRuns(c, scene.models, vp)
      for (const run of runs) {
        if (run.length < 2) continue
        add(`\\addplot[${o.join(', ')}] coordinates {${coords(run)}};`)
        lastPlot = lines.length - 1
      }
      if (caps && (caps.start === 'arrow' || caps.end === 'arrow')) notExported.push('arrowheads on sampled curves')
    }
    if (name && lastPlot >= 0) {
      lines[lastPlot] = lines[lastPlot].replace(/;$/, ` node[pos=0.92, anchor=south east, font=\\footnotesize] {${texLabel(name)}};`)
    }

    // Dots at the ends, holes, piece and jump dots.
    if (ends && caps) {
      for (const [cap, at] of [[caps.start, ends.start], [caps.end, ends.end]] as const) {
        if (!at || (cap !== 'open' && cap !== 'closed')) continue
        dotsAll.push({ at: toMath(at.at, vp), col: ink(c.color), closed: cap === 'closed' })
      }
    }
    let pieceDots: Vec2[] = []
    try {
      const pm = pieceMarks(c, scene.models, vp, 1)
      if (pm) {
        for (const d of pm.dots) dotsAll.push({ at: { x: d.x, y: d.y }, col: ink(c.color), closed: d.closed })
        pieceDots = [...pm.dots.map((d) => ({ x: d.x, y: d.y })), ...pm.joins.map((j) => toMath(j, vp))]
      }
    } catch {
      pieceDots = []
    }
    const range = holeRange(vp)
    if (range) {
      try {
        for (const h of findHoles(c, scene.models, range)) {
          const taken = [...pieceDots, ...dotsAll.map((d) => d.at)].some(
            (p) => Math.abs(p.x - h.x) * ppx < 1 && Math.abs(p.y - h.y) * ppy < 1,
          )
          if (!taken) holesAll.push({ at: { x: h.x, y: h.y }, col: ink(c.color) })
        }
      } catch {
        /* no holes */
      }
      if (fig && fig.curveEnds === 'marked') {
        try {
          for (const a of findAsymptotes(c, scene.models, range)) {
            if (a.kind === 'vertical') {
              if (a.x < xmin || a.x > xmax) continue
              add(`\\addplot[${col}, dashed, thin, forget plot] coordinates {${P(a.x, ymin)} ${P(a.x, ymax)}};`)
            } else if (Math.abs(a.dir.x) > 1e-12) {
              const m = a.dir.y / a.dir.x
              const yAt = (x: number): number => a.a.y + m * (x - a.a.x)
              add(`\\addplot[${col}, dashed, thin, forget plot] coordinates {${P(xmin, yAt(xmin))} ${P(xmax, yAt(xmax))}};`)
            } else {
              add(`\\addplot[${col}, dashed, thin, forget plot] coordinates {${P(a.a.x, ymin)} ${P(a.a.x, ymax)}};`)
            }
          }
        } catch {
          /* no asymptotes */
        }
      }
    }
  }

  // ---- data, Euler, shapes ------------------------------------------------------
  for (const s of scene.scatter ?? []) {
    if (!s.visible) continue
    const pts: Vec2[] = []
    for (let i = 0; i < Math.min(s.xs.length, s.ys.length); i++) pts.push({ x: s.xs[i], y: s.ys[i] })
    marks(pts, ink(s.color), s.marker === 'ring', 1.5)
  }
  for (const e of scene.eulers ?? []) {
    if (e.pts.length === 0) continue
    add(`\\addplot[${colour(ink(e.color))}${e.dash && e.dash.length > 0 ? ', dashed' : ''}, mark=*, mark size=1.3pt, forget plot] coordinates {${coords(e.pts)}};`)
    if (e.tag) label(e.pts[e.pts.length - 1], e.tag, ink(e.color))
  }
  for (const sh of scene.shapes ?? []) {
    if (!sh.visible) continue
    const col = colour(ink(sh.color))
    switch (sh.kind) {
      case 'point':
        marks([sh.at], ink(sh.color), false)
        if (sh.label) label(sh.at, sh.label, ink(sh.color))
        break
      case 'segment':
        add(`\\draw[${col}, thick] ${P(sh.a.x, sh.a.y)} -- ${P(sh.b.x, sh.b.y)};`)
        break
      case 'vector':
        add(`\\draw[${col}, thick, ->] ${P(sh.tail.x, sh.tail.y)} -- ${P(sh.tail.x + sh.v.x, sh.tail.y + sh.v.y)};`)
        if (sh.label) label({ x: sh.tail.x + sh.v.x / 2, y: sh.tail.y + sh.v.y / 2 }, sh.label, ink(sh.color))
        break
      case 'polygon': {
        const fill = sh.fill ? `, fill=${col}, fill opacity=${num(fillAlpha(), 3)}` : ''
        add(`\\draw[${col}, thick${fill}] ${sh.pts.map((p) => P(p.x, p.y)).join(' -- ')} -- cycle;`)
        sh.labels?.forEach((l, i) => {
          if (l && sh.pts[i]) label(sh.pts[i], l, ink(sh.color))
        })
        break
      }
    }
  }

  // ---- unit circles and related rates ------------------------------------------
  // The unit circle's core is plain geometry in axis coordinates: the circle
  // (sampled, so a stretched board shows the ellipse it really is), the
  // initial side and the terminal radius, and P(θ) with its chip. The rest of
  // the lesson (angle arc, reference triangle, ASTC, tan, unwrap, inverse) is
  // the TikZ export's, and the header says so.
  for (const f of scene.unitCircles ?? []) {
    if (!f?.visible || ![f.center.x, f.center.y, f.theta].every(Number.isFinite)) continue
    const col = colour(ink(f.color))
    const { x: cx, y: cy } = f.center
    const ring: Vec2[] = []
    for (let i = 0; i < 96; i++) {
      const t = (i / 96) * 2 * Math.PI
      ring.push({ x: cx + Math.cos(t), y: cy + Math.sin(t) })
    }
    const p = { x: cx + Math.cos(f.theta), y: cy + Math.sin(f.theta) }
    add(`% unit circle ${texCommentSafe(f.id)}`)
    const around: string[] = []
    for (let i = 0; i < ring.length; i += PER_LINE) around.push(ring.slice(i, i + PER_LINE).map((q) => P(q.x, q.y)).join(' -- '))
    add(`\\draw[${col}, thick] ${around.join(' --\n    ')} -- cycle;`)
    add(`\\draw[${col}, thick] ${P(cx, cy)} -- ${P(cx + 1, cy)};`)
    add(`\\draw[${col}, thick] ${P(cx, cy)} -- ${P(p.x, p.y)};`)
    marks([p], ink(f.color), false, 2.2)
    label(p, f.pointText, ink(f.color), Math.cos(f.theta) >= 0 ? 'south west' : 'south east')
    const extras =
      f.show.triangle || f.show.ref || f.show.astc || f.show.tan || f.unwrap !== null || f.inv !== null || Math.abs(f.theta) > 1e-9
    if (extras) notExported.push("the unit circle's angle arc, triangle and guides (use TikZ for this figure)")
  }
  if ((scene.relatedRates ?? []).some((r) => r?.visible)) {
    notExported.push('the related-rates scenario (use TikZ for this figure)')
  }

  // ---- marks and labels on top ------------------------------------------------
  for (const h of holesAll) marks([h.at], h.col, true)
  for (const d of dotsAll) marks([d.at], d.col, !d.closed)

  const filled = fig?.pointStyle === 'filled'
  const pointMarks = (points: readonly SpecialPoint[], col: string, labels: boolean): void => {
    for (const p of points) {
      if (!p?.pos || !Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y)) continue
      if (p.kind !== 'hole') {
        if (filled) marks([p.pos], col, false)
        else if (p.kind === 'zero') marks([p.pos], col, true)
        else if (p.kind === 'inflection') marks([p.pos], col, 'diamond')
        else marks([p.pos], col, false)
      }
      if (labels) {
        const text = pointText(p, { decimal: false }) + (p.kind === 'zero' && p.tangent ? ' (touches)' : '')
        label(p.pos, text, theme.label)
      }
    }
  }
  const an = scene.analysis
  if (an && an.curve.visible) pointMarks(an.points, ink(an.curve.color), true)
  for (const m of opts.extraMarkers ?? []) {
    if (m.curve.visible) pointMarks(m.points, ink(m.curve.color), false)
  }
  const shown = new Set(scene.curves.filter((c) => c.visible).map((c) => c.id))
  const crossings = (scene.intersections ?? []).filter((m) => shown.has(m.curveId) && shown.has(m.point.withId ?? ''))
  if (crossings.length > 0) pointMarks(crossings.map((m) => m.point), theme.axis, true)
  // Reveal mode: a hidden answer's place, as the board marks it — a small
  // hollow disc with a "?" (src/ui/reveal.ts).
  for (const m of scene.revealMarks ?? []) {
    if (m.ghost || m.nl || !Number.isFinite(m.pos.x) || !Number.isFinite(m.pos.y)) continue
    if (m.pos.x < xmin || m.pos.x > xmax || m.pos.y < ymin || m.pos.y > ymax) continue
    const col = colour(ink(m.color))
    add(`\\node[circle, draw=${col}, fill=white, inner sep=0.6pt, minimum size=9pt, font=\\scriptsize\\bfseries, text=${col}] at (axis cs:${pgfNum(round(m.pos.x))},${pgfNum(round(m.pos.y))}) {?};`)
  }

  // ---- axis ------------------------------------------------------------------
  const st = fig ?? null
  const spacing = st?.spacing ?? 'auto'
  const numbers = st?.numbers ?? 'major'
  const gridKind = st?.grid ?? 'lines'
  const units = scene.axisUnits ?? {}
  const typeScale = Math.min(6, Math.max(0.5, scene.present?.type ?? 1))
  const strokeScale = Math.min(6, Math.max(0.5, scene.present?.stroke ?? 1))
  const stepFor = (u: string | undefined, ppu: number): GridStep | PiStep => {
    const pi = u === 'pi' ? pickPiTickStep(ppu, PI_LABEL_MIN_PX * typeScale) : null
    if (spacing === 'unit') return unitTickStep(ppu, UNIT_MIN_PX * strokeScale, pi)
    return pi ?? pickTickStep(ppu)
  }
  const THIN = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
  const ticksFor = (
    step: GridStep | PiStep,
    lo: number,
    hi: number,
    ppu: number,
    horizontal: boolean,
  ): { major: Array<{ v: number; text: string }>; minor: number[] } => {
    const minor = step.major / step.minorDiv
    const minors: number[] = []
    const m0 = Math.ceil(lo / minor - 1e-9)
    const m1 = Math.floor(hi / minor + 1e-9)
    if (m1 - m0 <= 2000) for (let m = m0; m <= m1; m++) minors.push(m * minor)
    const major: Array<{ v: number; text: string }> = []
    const edge = 14 / ppu
    if (numbers === 'unit') {
      const all: Array<{ m: number; text: string }> = []
      for (let m = m0; m <= m1 && m1 - m0 <= 2000; m++) if (m !== 0) all.push({ m, text: minorTickLabel(step, m) })
      const widest = all.reduce((w, t) => Math.max(w, textWidthEstimate(t.text, 'sans-serif') * 11 * typeScale), 0)
      const room = horizontal ? widest + 8 * typeScale : 11 * typeScale * 1.6
      const f = THIN.find((k) => k * minor * ppu >= room) ?? THIN[THIN.length - 1]
      for (const t of all) if (((t.m % f) + f) % f === 0) major.push({ v: t.m * minor, text: t.text })
    } else {
      const k0 = Math.ceil(lo / step.major - 1e-9)
      const k1 = Math.floor(hi / step.major + 1e-9)
      for (let k = k0; k <= k1 && k1 - k0 <= 2000; k++) if (k !== 0) major.push({ v: k * step.major, text: tickLabel(step, k) })
    }
    const kept = major.filter((t) => t.v > lo + edge && t.v < hi - edge)
    const majorSet = new Set(kept.map((t) => t.v.toFixed(9)))
    return { major: kept, minor: minors.filter((v) => !majorSet.has(v.toFixed(9))) }
  }
  const xs = ticksFor(stepFor(units.x, ppx), xmin, xmax, ppx, true)
  const ys = ticksFor(stepFor(units.y, ppy), ymin, ymax, ppy, false)
  const list = (vs: readonly number[]): string => vs.map((v) => pgfNum(round(v))).join(', ')

  const arrows = st?.arrows ?? 'four'
  const axisOpts: string[] = [
    `width=${num(vp.widthPx / PX_PER_CM, 2)}cm`,
    `height=${num((vp.heightPx - band) / PX_PER_CM, 2)}cm`,
    'scale only axis',
    `xmin=${pgfNum(round(xmin))}, xmax=${pgfNum(round(xmax))}`,
    `ymin=${pgfNum(round(ymin))}, ymax=${pgfNum(round(ymax))}`,
    'axis lines=middle',
    `axis line style={${arrows === 'four' ? '<->' : arrows === 'positive' ? '->' : '-'}, color=${colour(theme.axis)}}`,
    `xtick={${list(xs.major.map((t) => t.v))}}`,
    `xticklabels={${xs.major.map((t) => `{${texLabel(t.text)}}`).join(', ')}}`,
    `ytick={${list(ys.major.map((t) => t.v))}}`,
    `yticklabels={${ys.major.map((t) => `{${texLabel(t.text)}}`).join(', ')}}`,
    `minor xtick={${list(xs.minor)}}`,
    `minor ytick={${list(ys.minor)}}`,
    `tick label style={font=\\footnotesize, text=${colour(theme.label)}}`,
    `tick style={color=${colour(theme.axis)}}`,
  ]
  if (gridKind === 'lines') {
    axisOpts.push(
      'grid=both',
      `major grid style={color=${colour(theme.gridMajor)}}`,
      `minor grid style={color=${colour(theme.gridMinor)}}`,
    )
  } else {
    axisOpts.push('grid=none')
    if (gridKind === 'none') axisOpts.push('minor tick length=0pt, major tick length=0pt')
  }
  if (st?.axisNames) {
    axisOpts.push(
      'xlabel={$x$}, ylabel={$y$}',
      'every axis x label/.style={at={(ticklabel* cs:1)}, anchor=west}',
      'every axis y label/.style={at={(ticklabel* cs:1)}, anchor=south}',
    )
  }
  axisOpts.push('trig format plots=rad', 'unbounded coords=jump', 'clip=true')
  if (st?.font === 'serif') axisOpts.push('font=\\rmfamily')

  // The origin: O in the exam style, 0 otherwise — once, below-left.
  if (xmin < 0 && xmax > 0 && ymin < 0 && ymax > 0) {
    add(`\\node[anchor=north east, inner sep=2pt, font=\\footnotesize, text=${colour(theme.label)}] at (axis cs:0,0) {${st?.originLabel ? '$O$' : '$0$'}};`)
  }

  if (captioned) notExported.push(`the caption, which belongs in \\caption{…}: "${scene.caption}"`)

  // ---- file ----------------------------------------------------------------------
  const widthCm = opts.widthCm ?? vp.widthPx / PX_PER_CM
  const head: string[] = [
    `% Grapher figure${opts.title ? ` "${texCommentSafe(opts.title)}"` : ''} as pgfplots, ${num(widthCm, 1)} cm wide.`,
    '% Preamble:',
    '%   \\usepackage{pgfplots}',
    '%   \\pgfplotsset{compat=1.18}',
  ]
  if (usesFillBetween.on) head.push('%   \\usepgfplotslibrary{fillbetween}')
  head.push('% Compiles with pdflatex. Edit the \\addplot lines freely: typed equations are written as formulas.')
  for (const n of [...new Set(notExported)]) head.push(`% not exported: ${texCommentSafe(n)}`)
  head.push('\\begin{tikzpicture}')
  for (const [hex, name] of colours) head.push(`  \\definecolor{${name}}{HTML}{${hex}}`)
  head.push('\\begin{axis}[')
  head.push(axisOpts.map((o) => `  ${o}`).join(',\n'))
  head.push(']')
  return [...head, ...lines, '\\end{axis}', '\\end{tikzpicture}', ''].join('\n')
}

/** A comment line cannot end early; strip line breaks (and every other control character). */
function texCommentSafe(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ')
}

/** Re-exported for tests: the prose escaper the labels use. */
export { texEscapeText }
