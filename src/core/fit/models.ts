// ============================================================================
// Model family registry. Each ModelSpec provides eval (matching its kind),
// KaTeX-renderable latex with nicely formatted numbers, and slider metadata
// centered on the current parameter values.
// ============================================================================

import type { ModelSpec, ParamMeta, Vec2 } from '../types'
import { conicToCenterForm } from './optimize'

// ---------------------------------------------------------------------------
// Number / term formatting
// ---------------------------------------------------------------------------

/** Round to `sig` significant digits and render KaTeX-safe (no bare 1e-7). */
export function fmt(v: number, sig = 4): string {
  if (!Number.isFinite(v)) return '0'
  if (v === 0 || Math.abs(v) < 1e-300) return '0'
  let r = Number(v.toPrecision(sig))
  if (Object.is(r, -0)) r = 0
  const a = Math.abs(r)
  if (a === 0) return '0'
  if (a >= 1e-4 && a < 1e7) {
    const s = String(r)
    if (!s.includes('e')) return s
  }
  const exp = Math.floor(Math.log10(a))
  let mant = Number((r / Math.pow(10, exp)).toPrecision(sig))
  if (Math.abs(mant) >= 10) mant = Number((mant / 10).toPrecision(sig)) // rounding edge
  return `${mant} \\cdot 10^{${exp}}`
}

const NEGLIGIBLE = 1e-12

/**
 * Format one term `±coef·body`. `leading` renders "-2.3x"/"2.3x", otherwise
 * " + 2.3x"/" - 2.3x". Drops "1·" (renders "x" not "1x"). Returns '' when the
 * coefficient is negligible (unless it is a lone constant and `keepZero`).
 */
function term(v: number, body: string, leading: boolean): string {
  if (Math.abs(v) < NEGLIGIBLE) return ''
  const av = Math.abs(v)
  const avStr = fmt(av)
  const isOne = avStr === '1'
  const core = body === '' ? avStr : isOne ? body : `${avStr}${body}`
  if (leading) return v < 0 ? `-${core}` : core
  return v < 0 ? ` - ${core}` : ` + ${core}`
}

/** Sum of terms; bodies[i] pairs with coeffs[i]. Falls back to '0'. */
function termSum(coeffs: number[], bodies: string[]): string {
  let out = ''
  for (let i = 0; i < coeffs.length; i++) {
    out += term(coeffs[i], bodies[i], out === '')
  }
  return out === '' ? '0' : out
}

/** Ascending coefficients -> "y = c_n x^{n} + ... + c_0". */
function polyLatex(c: number[]): string {
  const coeffs: number[] = []
  const bodies: string[] = []
  for (let i = c.length - 1; i >= 0; i--) {
    coeffs.push(c[i] ?? 0)
    bodies.push(i === 0 ? '' : i === 1 ? 'x' : `x^{${i}}`)
  }
  return `y = ${termSum(coeffs, bodies)}`
}

/** "(x - 1.2)" style inner expression, collapsing when the shift is ~0. */
function shifted(variable: string, center: number): string {
  if (Math.abs(center) < NEGLIGIBLE) return variable
  return center > 0
    ? `${variable} - ${fmt(center)}`
    : `${variable} + ${fmt(-center)}`
}

/** "(x - 1.2)^2" -> "\left(x - 1.2\right)^{2}" or "x^{2}" when centered. */
function shiftedSq(variable: string, center: number): string {
  const inner = shifted(variable, center)
  return inner === variable ? `${variable}^{2}` : `\\left(${inner}\\right)^{2}`
}

/** Horner evaluation of ascending coefficients. */
function horner(c: number[], x: number): number {
  let v = 0
  for (let i = c.length - 1; i >= 0; i--) v = v * x + c[i]
  return v
}

// ---------------------------------------------------------------------------
// Slider metadata
// ---------------------------------------------------------------------------

function metaFor(name: string, v: number): ParamMeta {
  const span = Math.max(Math.abs(v) * 2, 1)
  return { name, min: v - span, max: v + span, step: span / 100 }
}

// ---------------------------------------------------------------------------
// Translation helpers (drag-editing): exact rigid shifts of the curve
// ---------------------------------------------------------------------------

function polyMulLocal(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0)
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j]
  }
  return out
}

/** q(x) = p(x − dx) + dy, exact via binomial expansion (ascending coeffs). */
function translatePolyCoeffs(c: number[], dx: number, dy: number): number[] {
  const out = new Array<number>(c.length).fill(0)
  let acc: number[] = [1] // (x − dx)^j, expanded
  for (let j = 0; j < c.length; j++) {
    for (let i = 0; i < acc.length; i++) out[i] += c[j] * acc[i]
    if (j < c.length - 1) acc = polyMulLocal(acc, [-dx, 1])
  }
  out[0] += dy
  return out
}

function centeredMeta(names: string[], params: number[]): ParamMeta[] {
  return names.map((name, i) => metaFor(name, params[i] ?? 0))
}

function polyModel(id: string, name: string, degree: number): ModelSpec {
  const names = ['a', 'b', 'c', 'd', 'e'].slice(0, degree + 1)
  return {
    id,
    kind: 'explicit',
    name,
    evalExplicit: (p, x) => horner(p, x),
    latex: p => polyLatex(p),
    // ascending storage, but present sliders highest-degree first, matching latex
    paramMeta: p =>
      names.map((nm, i) => {
        const idx = degree - i
        return metaFor(nm, p[idx] ?? 0)
      }),
    translate: (p, dx, dy) => translatePolyCoeffs(p, dx, dy),
  }
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export const MODELS: Record<string, ModelSpec> = {
  // -------------------------------------------------------------- explicit --
  line: {
    id: 'line',
    kind: 'explicit',
    name: 'Line',
    // params: [b, m] ascending -> y = m x + b
    evalExplicit: (p, x) => horner(p, x),
    latex: p => polyLatex(p),
    paramMeta: p => [metaFor('m', p[1] ?? 0), metaFor('b', p[0] ?? 0)],
    translate: (p, dx, dy) => translatePolyCoeffs(p, dx, dy),
  },

  poly2: polyModel('poly2', 'Parabola', 2),
  poly3: polyModel('poly3', 'Cubic', 3),
  poly4: polyModel('poly4', 'Quartic', 4),

  sine: {
    id: 'sine',
    kind: 'explicit',
    name: 'Sinusoid',
    // params: [a, b, c, d] -> a·sin(bx + c) + d
    evalExplicit: (p, x) => p[0] * Math.sin(p[1] * x + p[2]) + p[3],
    latex: p => {
      const [a, b, c, d] = p
      const inner = termSum([b, c], ['x', ''])
      const sinTerm = `\\sin\\left(${inner}\\right)`
      return `y = ${termSum([a, d], [sinTerm, ''])}`
    },
    paramMeta: p => centeredMeta(['a', 'b', 'c', 'd'], p),
    // a·sin(b(x−dx) + c) + d + dy
    translate: (p, dx, dy) => [p[0], p[1], p[2] - p[1] * dx, p[3] + dy],
  },

  gauss: {
    id: 'gauss',
    kind: 'explicit',
    name: 'Gaussian',
    // params: [a, b, c, d] -> a·exp(−((x−b)/c)²) + d
    evalExplicit: (p, x) => {
      const z = (x - p[1]) / p[2]
      return p[0] * Math.exp(-z * z) + p[3]
    },
    latex: p => {
      const [a, b, c, d] = p
      const expTerm = `e^{-\\left(\\frac{${shifted('x', b)}}{${fmt(c)}}\\right)^{2}}`
      return `y = ${termSum([a, d], [expTerm, ''])}`
    },
    paramMeta: p => centeredMeta(['a', 'b', 'c', 'd'], p),
    translate: (p, dx, dy) => [p[0], p[1] + dx, p[2], p[3] + dy],
  },

  exp: {
    id: 'exp',
    kind: 'explicit',
    name: 'Exponential',
    // params: [a, b, c] -> a·exp(bx) + c
    evalExplicit: (p, x) => p[0] * Math.exp(p[1] * x) + p[2],
    latex: p => {
      const [a, b, c] = p
      const expTerm = `e^{${term(b, 'x', true) || '0'}}`
      return `y = ${termSum([a, c], [expTerm, ''])}`
    },
    paramMeta: p => centeredMeta(['a', 'b', 'c'], p),
    // a·e^{b(x−dx)} + c + dy  =  (a·e^{−b·dx})·e^{bx} + (c + dy), exact
    translate: (p, dx, dy) => {
      const a2 = p[0] * Math.exp(-p[1] * dx)
      return [Number.isFinite(a2) ? a2 : p[0], p[1], p[2] + dy]
    },
  },

  abs: {
    id: 'abs',
    kind: 'explicit',
    name: 'Absolute value',
    // params: [a, b, c] -> a·|x−b| + c
    evalExplicit: (p, x) => p[0] * Math.abs(x - p[1]) + p[2],
    latex: p => {
      const [a, b, c] = p
      const absTerm = `\\left|${shifted('x', b)}\\right|`
      return `y = ${termSum([a, c], [absTerm, ''])}`
    },
    paramMeta: p => centeredMeta(['a', 'b', 'c'], p),
    translate: (p, dx, dy) => [p[0], p[1] + dx, p[2] + dy],
  },

  logistic: {
    id: 'logistic',
    kind: 'explicit',
    name: 'Logistic',
    // params: [a, b, c, d] -> a / (1 + exp(−b(x−c))) + d
    evalExplicit: (p, x) => p[0] / (1 + Math.exp(-p[1] * (x - p[2]))) + p[3],
    latex: p => {
      const [a, b, c, d] = p
      const inner = shifted('x', c)
      const bAbs = fmt(Math.abs(b))
      const bCoef = bAbs === '1' ? '' : bAbs
      const sign = b >= 0 ? '-' : ''
      const frac = `\\frac{${fmt(a)}}{1 + e^{${sign}${bCoef}\\left(${inner}\\right)}}`
      const tail = term(d, '', false)
      return `y = ${frac}${tail}`
    },
    paramMeta: p => centeredMeta(['a', 'b', 'c', 'd'], p),
    translate: (p, dx, dy) => [p[0], p[1], p[2] + dx, p[3] + dy],
  },

  // ------------------------------------------------------------ parametric --
  vline: {
    id: 'vline',
    kind: 'parametric',
    name: 'Vertical line',
    // params: [a] -> t ↦ (a, t)
    evalParametric: (p, t): Vec2 => ({ x: p[0], y: t }),
    latex: p => `x = ${fmt(p[0])}`,
    paramMeta: p => centeredMeta(['a'], p),
    translate: (p, dx, _dy) => [p[0] + dx],
  },

  // -------------------------------------------------------------- implicit --
  circle: {
    id: 'circle',
    kind: 'implicit',
    name: 'Circle',
    // params: [a, b, r] -> (x−a)² + (y−b)² − r² = 0
    evalImplicit: (p, x, y) => {
      const dx = x - p[0], dy = y - p[1]
      return dx * dx + dy * dy - p[2] * p[2]
    },
    latex: p => {
      const [a, b, r] = p
      return `${shiftedSq('x', a)} + ${shiftedSq('y', b)} = ${fmt(r * r)}`
    },
    paramMeta: p => {
      const r = Math.abs(p[2] ?? 1)
      const span = Math.max(r * 2, 1)
      return [
        metaFor('a', p[0] ?? 0),
        metaFor('b', p[1] ?? 0),
        { name: 'r', min: Math.max(span / 200, r - span), max: r + span, step: span / 100 },
      ]
    },
    translate: (p, dx, dy) => [p[0] + dx, p[1] + dy, p[2]],
  },

  ellipse: {
    id: 'ellipse',
    kind: 'implicit',
    name: 'Ellipse',
    // params: [A, B, C, D, E, F] -> Ax² + Bxy + Cy² + Dx + Ey + F = 0
    evalImplicit: (p, x, y) =>
      p[0] * x * x + p[1] * x * y + p[2] * y * y + p[3] * x + p[4] * y + p[5],
    latex: p => {
      const [A, B, C, D, E, F] = p
      const axisAligned = Math.abs(B) < 0.02 * (Math.abs(A) + Math.abs(C) + 1e-300)
      if (axisAligned) {
        const cf = conicToCenterForm([A, 0, C, D, E, F])
        if (cf) {
          return (
            `\\frac{${shiftedSq('x', cf.cx)}}{${fmt(cf.rx * cf.rx)}} + ` +
            `\\frac{${shiftedSq('y', cf.cy)}}{${fmt(cf.ry * cf.ry)}} = 1`
          )
        }
      }
      // general conic form; scale so the largest quadratic coefficient is 1
      const scale = Math.max(Math.abs(A), Math.abs(B), Math.abs(C)) || 1
      const s = (A >= 0 ? 1 : -1) / scale
      const lhs = termSum(
        [A * s, B * s, C * s, D * s, E * s],
        ['x^{2}', 'xy', 'y^{2}', 'x', 'y'],
      )
      return `${lhs} = ${fmt(-F * s)}`
    },
    paramMeta: p => centeredMeta(['A', 'B', 'C', 'D', 'E', 'F'], p),
    // Q'(x, y) = Q(x − dx, y − dy), expanded exactly
    translate: (p, dx, dy) => {
      const [A, B, C, D, E, F] = p
      return [
        A,
        B,
        C,
        D - 2 * A * dx - B * dy,
        E - B * dx - 2 * C * dy,
        F + A * dx * dx + B * dx * dy + C * dy * dy - D * dx - E * dy,
      ]
    },
  },

  // ----------------------------------------------------------------- polar --
  polarRose: {
    id: 'polarRose',
    kind: 'polar',
    name: 'Rose',
    // params: [a, k, c] -> r = a·cos(kθ + c)  (c: phase, hand roses are rotated)
    evalPolar: (p, theta) => p[0] * Math.cos(Math.round(p[1]) * theta + (p[2] ?? 0)),
    latex: p => {
      const k = Math.round(p[1])
      const c = p[2] ?? 0
      const kStr = k === 1 ? '' : String(k)
      const inner =
        Math.abs(c) < 1e-4
          ? `${kStr}\\theta`
          : `${kStr}\\theta ${c > 0 ? '+' : '-'} ${fmt(Math.abs(c))}`
      return `r = ${term(p[0], `\\cos\\left(${inner}\\right)`, true) || '0'}`
    },
    paramMeta: p => {
      const c = p[2] ?? 0
      return [
        metaFor('a', p[0] ?? 1),
        { name: 'k', min: 1, max: 8, step: 1 },
        { name: 'c', min: c - Math.PI, max: c + Math.PI, step: Math.PI / 100 },
      ]
    },
  },

  limacon: {
    id: 'limacon',
    kind: 'polar',
    name: 'Limaçon',
    // params: [a, b] -> r = a + b·cos(θ)
    evalPolar: (p, theta) => p[0] + p[1] * Math.cos(theta),
    latex: p => `r = ${termSum([p[0], p[1]], ['', '\\cos\\theta'])}`,
    paramMeta: p => centeredMeta(['a', 'b'], p),
  },

  spiral: {
    id: 'spiral',
    kind: 'polar',
    name: 'Spiral',
    // params: [a, b] -> r = a + b·θ
    evalPolar: (p, theta) => p[0] + p[1] * theta,
    latex: p => `r = ${termSum([p[0], p[1]], ['', '\\theta'])}`,
    paramMeta: p => centeredMeta(['a', 'b'], p),
  },

  // ------------------------------------------------------------- universal --
  fourier: {
    id: 'fourier',
    kind: 'parametric',
    name: 'Fourier curve',
    // params: [cx, cy, ax1, bx1, ay1, by1, ax2, ...] for N harmonics
    evalParametric: (p, t): Vec2 => {
      const N = Math.floor((p.length - 2) / 4)
      let x = p[0]
      let y = p[1]
      for (let n = 1; n <= N; n++) {
        const o = 2 + (n - 1) * 4
        const cn = Math.cos(n * t)
        const sn = Math.sin(n * t)
        x += p[o] * cn + p[o + 1] * sn
        y += p[o + 2] * cn + p[o + 3] * sn
      }
      return { x, y }
    },
    latex: p => {
      const N = Math.floor((p.length - 2) / 4)
      if (N < 1) return `\\text{Fourier}(0)`
      const [cx, cy, ax, bx, ay, by] = p
      const dots = N > 1 ? ' + \\cdots' : ''
      const xPart = termSum([cx, ax, bx], ['', '\\cos t', '\\sin t'])
      const yPart = termSum([cy, ay, by], ['', '\\cos t', '\\sin t'])
      return (
        `\\text{Fourier}(N{=}${N}):\\; ` +
        `x \\approx ${xPart}${dots},\\;\\; y \\approx ${yPart}${dots}`
      )
    },
    paramMeta: p => {
      const N = Math.floor((p.length - 2) / 4)
      const metas: ParamMeta[] = [metaFor('c_x', p[0] ?? 0), metaFor('c_y', p[1] ?? 0)]
      for (let n = 1; n <= N; n++) {
        const o = 2 + (n - 1) * 4
        metas.push(
          metaFor(`a_{x${n}}`, p[o] ?? 0),
          metaFor(`b_{x${n}}`, p[o + 1] ?? 0),
          metaFor(`a_{y${n}}`, p[o + 2] ?? 0),
          metaFor(`b_{y${n}}`, p[o + 3] ?? 0),
        )
      }
      return metas
    },
    translate: (p, dx, dy) => {
      const out = p.slice()
      out[0] = (out[0] ?? 0) + dx
      out[1] = (out[1] ?? 0) + dy
      return out
    },
  },
}
