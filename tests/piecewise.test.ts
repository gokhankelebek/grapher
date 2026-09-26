// ============================================================================
// tests/piecewise.test.ts — restricted domains and piecewise functions
// (src/core/parse/index.ts + src/core/parse/condition.ts).
//
// The shapes a teacher actually types:
//   y = x^2 {0 <= x < 3}      y = x^2, 0 <= x < 3      y = x^2 for x > 0
//   y = { x^2 if x < 0 ; 2x if x >= 0 }
//   y = piecewise(x^2, x < 0, 2x, x >= 0)
//
// Two claims are worth more than the syntax table, and both are tested here:
// the FIRST matching branch wins, and where no branch matches the function is
// undefined (NaN) rather than quietly joined up.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FittedCurve, ModelSpec, ParsedPlot, SpecialPoint } from '../src/core/types'
import { compileExpr, parseExpression } from '../src/core/parse'
import {
  breakpoints,
  piecewiseSource,
  readPiecewise,
  stepSpec,
  type PiecewiseSpec,
} from '../src/core/piecewise'
import { makeRng } from './helpers'
import { analyzeCurve, zeroIntervals } from '../src/core/analyze'
import { compileLatex } from './latexEval'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function plot(src: string): ParsedPlot {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(`expected "${src}" to parse, got: ${r.error}`)
  return r.plot
}

function err(src: string): { error: string; pos?: number } {
  const r = parseExpression(src)
  if (r.ok) throw new Error(`expected "${src}" to fail, but it parsed as ${r.plot.latex}`)
  return { error: r.error, pos: r.pos }
}

/** The compiled explicit evaluator of a parsed source. */
function fn(src: string, params?: number[]): (x: number) => number {
  const p = plot(src)
  expect(p.kind).toBe('explicit')
  const spec = p.makeModel('t')
  const ps = params ?? p.defaultParams
  return (x: number) => spec.evalExplicit!(ps, x)
}

function polarFn(src: string): (theta: number) => number {
  const p = plot(src)
  expect(p.kind).toBe('polar')
  const spec = p.makeModel('t')
  return (th: number) => spec.evalPolar!(p.defaultParams, th)
}

const SAMPLES = [-4, -3, -2.5, -1, -0.75, -0.25, -1e-9, 0, 1e-9, 0.25, 0.5, 1, 1.5, 2, 2.999, 3, 3.5, 5]

/** Same number, or NaN on both sides — a gap has to round-trip as a gap. */
function same(a: number, b: number): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) return true
  return a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
}

/** Pull `\begin{cases} B & C \\ B & C \end{cases}` back apart. */
function casesRows(latex: string): { body: string; cond: string }[] {
  const m = /\\begin\{cases\}([\s\S]*)\\end\{cases\}/.exec(latex)
  if (!m) throw new Error(`not a cases table: ${latex}`)
  return m[1].split('\\\\').map((row) => {
    const i = row.indexOf('&')
    if (i < 0) throw new Error(`row without a condition column: ${row}`)
    return { body: row.slice(0, i).trim(), cond: row.slice(i + 1).trim() }
  })
}

/**
 * Read a printed condition back into a predicate. Deliberately hand-written
 * rather than routed through the parser under test: the point is to check
 * that what was PRINTED is what is computed.
 */
function condPred(tex: string): (x: number) => boolean {
  if (tex === '\\text{otherwise}') return () => true
  const s = tex
    .replace(/\\leq/g, '<=')
    .replace(/\\geq/g, '>=')
    .replace(/\\neq/g, '!=')
    .replace(/\\pi/g, String(Math.PI))
    .replace(/\\infty/g, 'Infinity')
    .trim()
  const chain = /^(\S+)\s*(<=|<)\s*[A-Za-z\\]+\s*(<=|<)\s*(\S+)$/.exec(s)
  if (chain) {
    const lo = Number(chain[1])
    const hi = Number(chain[4])
    const loOk = chain[2] === '<=' ? (x: number) => x >= lo : (x: number) => x > lo
    const hiOk = chain[3] === '<=' ? (x: number) => x <= hi : (x: number) => x < hi
    return (x) => loOk(x) && hiOk(x)
  }
  const one = /^[A-Za-z\\]+\s*(<=|<|>=|>|=|!=)\s*(\S+)$/.exec(s)
  if (one) {
    const b = Number(one[2])
    switch (one[1]) {
      case '<': return (x) => x < b
      case '<=': return (x) => x <= b
      case '>': return (x) => x > b
      case '>=': return (x) => x >= b
      case '=': return (x) => x === b
      default: return (x) => x !== b
    }
  }
  throw new Error(`cannot read the printed condition "${tex}"`)
}

function curveOf(p: ParsedPlot, id = 'pw'): { curve: FittedCurve; models: Record<string, ModelSpec> } {
  const spec = p.makeModel(id)
  return {
    curve: {
      id: 'test-curve',
      modelId: id,
      params: p.defaultParams,
      kind: p.kind,
      domain: p.domain,
      color: '#4f9cf9',
      strokeWidth: 2.5,
      visible: true,
      error: 0,
    },
    models: { [id]: spec },
  }
}

// ---------------------------------------------------------------------------
// 1. Domain restriction on an explicit curve
// ---------------------------------------------------------------------------

describe('restricted domain — the spellings a teacher reaches for', () => {
  const SPELLINGS = [
    'y = x^2 {0 <= x < 3}',
    'y = x^2, 0 <= x < 3',
    'y = x^2 for 0 <= x < 3',
    'y = x^2 if 0 <= x < 3',
    'y = x^2 where 0 <= x < 3',
    'y = x^2 when 0 <= x < 3',
    'y = x^2 {[0, 3)}',
  ]

  for (const src of SPELLINGS) {
    it(`accepts "${src}"`, () => {
      const p = plot(src)
      expect(p.kind).toBe('explicit')
      expect(p.domain).toEqual([0, 3])
    })
  }

  it('every spelling produces the same curve, to the character', () => {
    const first = plot(SPELLINGS[0])
    for (const src of SPELLINGS.slice(1)) {
      const p = plot(src)
      expect(p.latex).toBe(first.latex)
      expect(p.domain).toEqual(first.domain)
      expect(p.paramNames).toEqual(first.paramNames)
    }
  })

  it('records the open end in the latex, since domain cannot carry it', () => {
    expect(plot('y = x^2 {0 <= x < 3}').latex).toBe('y = x^{2},\\ x \\in [0, 3)')
    expect(plot('y = x^2 {0 < x <= 3}').latex).toBe('y = x^{2},\\ x \\in (0, 3]')
    expect(plot('y = x^2 {0 <= x <= 3}').latex).toBe('y = x^{2},\\ x \\in [0, 3]')
  })

  it('a bounded restriction leaves the evaluator alone — the domain says it all', () => {
    // Nothing is gated away, so the renderer clips by domain and the domain
    // handles stay draggable.
    const f = fn('y = x^2 {0 <= x < 3}')
    expect(f(1)).toBe(1)
    expect(f(4)).toBe(16)
  })

  it('a half-open restriction is carried by the evaluator instead', () => {
    const f = fn('y = sqrt(x) {x >= 0}')
    expect(plot('y = sqrt(x) {x >= 0}').domain).toBe(null)
    expect(Number.isNaN(f(-1))).toBe(true)
    expect(f(0)).toBe(0)
    expect(f(4)).toBe(2)
    expect(plot('y = sqrt(x) {x >= 0}').latex).toBe('y = \\sqrt{x},\\ x \\in [0, \\infty)')
  })

  it('"y = x^2 {0 < x}" is fine', () => {
    const f = fn('y = x^2 {0 < x}')
    expect(Number.isNaN(f(-1))).toBe(true)
    expect(Number.isNaN(f(0))).toBe(true)
    expect(f(2)).toBe(4)
  })

  it('restricts a polar curve on theta', () => {
    const p = plot('r = 1 + cos(theta) {0 <= theta <= pi}')
    expect(p.kind).toBe('polar')
    expect(p.domain![0]).toBe(0)
    expect(p.domain![1]).toBeCloseTo(Math.PI, 12)
    expect(p.latex).toBe('r = 1+\\cos\\left(\\theta\\right),\\ \\theta \\in [0, \\pi]')
    const r = polarFn('r = 1 + cos(theta) {0 <= theta <= pi}')
    expect(r(0)).toBeCloseTo(2, 12)
  })

  it('an unbounded theta end falls back to the default turn', () => {
    const p = plot('r = 2 {theta >= pi}')
    expect(p.domain![0]).toBeCloseTo(Math.PI, 12)
    expect(p.domain![1]).toBeCloseTo(2 * Math.PI, 12)
  })

  it('bounds may be constant expressions', () => {
    const p = plot('y = sin(x) {0 <= x <= 2pi}')
    expect(p.domain![1]).toBeCloseTo(2 * Math.PI, 12)
    expect(p.latex).toBe('y = \\sin\\left(x\\right),\\ x \\in [0, 2\\pi]')
  })

  it('keeps free constants and their slider defaults', () => {
    const p = plot('y = a x + b {0 <= x <= 4}')
    expect(p.paramNames).toEqual(['a', 'b'])
    expect(p.defaultParams).toEqual([1, 1])
    const spec = p.makeModel('t')
    expect(spec.evalExplicit!([3, 2], 2)).toBe(8)
  })

  it('restricts a function definition, keeping the f(x) head', () => {
    const p = plot('f(x) = x^2 {0 <= x < 3}')
    expect(p.latex).toBe('f\\left(x\\right) = x^{2},\\ x \\in [0, 3)')
    expect(p.domain).toEqual([0, 3])
    expect(p.paramNames).toEqual([])
  })

  it('restricts a curve written in t', () => {
    const p = plot('y = t^2 {t > 0}')
    expect(p.kind).toBe('explicit')
    const f = p.makeModel('t').evalExplicit!
    expect(Number.isNaN(f([], -2))).toBe(true)
    expect(f([], 2)).toBe(4)
  })
})

describe('restricted domain — a punctured line is a note, not a hole', () => {
  const SRC = 'y = 1/x {x != 0}'

  it('leaves the curve unrestricted and says so on the card', () => {
    const p = plot(SRC)
    expect(p.domain).toBe(null)
    expect(p.latex).toBe('y = 1/x,\\ x \\neq 0')
  })

  it('does not fake a hole: the evaluator is the untouched 1/x', () => {
    const f = fn(SRC)
    expect(f(2)).toBe(0.5)
    expect(f(-2)).toBe(-0.5)
    expect(f(1e-9)).toBeCloseTo(1e9, 3)
    expect(f(0)).toBe(Infinity) // exactly what 1/x does, unmediated
  })
})

describe('restricted domain — a union is two pieces', () => {
  const SRC = 'y = 1/x {x < -1 or x > 2}'

  it('keeps both pieces alive and the space between them empty', () => {
    const f = fn(SRC)
    expect(f(-2)).toBe(-0.5)
    expect(f(4)).toBe(0.25)
    expect(Number.isNaN(f(0))).toBe(true)
    expect(Number.isNaN(f(-1))).toBe(true)
    expect(Number.isNaN(f(2))).toBe(true)
  })

  it('prints the union as interval notation', () => {
    expect(plot(SRC).latex).toBe('y = 1/x,\\ x \\in (-\\infty, -1) \\cup (2, \\infty)')
  })

  it('a bounded union still reports its overall extent as the domain', () => {
    const p = plot('y = x {0 < x < 1 or 2 < x < 3}')
    expect(p.domain).toEqual([0, 3])
    const f = p.makeModel('t').evalExplicit!
    expect(f([], 0.5)).toBe(0.5)
    expect(Number.isNaN(f([], 1.5))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. Piecewise functions
// ---------------------------------------------------------------------------

describe('piecewise — the spellings', () => {
  const SPELLINGS = [
    'y = { x^2 if x < 0 ; 2x if x >= 0 }',
    'y = { x^2, x < 0 ; 2x, x >= 0 }',
    'y = piecewise(x^2, x < 0, 2x, x >= 0)',
    'y = { x^2 when x < 0 ; 2x when x >= 0 }',
  ]

  for (const src of SPELLINGS) {
    it(`accepts "${src}"`, () => {
      const f = fn(src)
      expect(f(-2)).toBe(4)
      expect(f(-0.5)).toBe(0.25)
      expect(f(0)).toBe(0)
      expect(f(3)).toBe(6)
    })
  }

  it('every spelling prints the same cases table', () => {
    const want = 'y = \\begin{cases} x^{2} & x < 0 \\\\ 2x & x \\geq 0 \\end{cases}'
    for (const src of SPELLINGS) expect(plot(src).latex).toBe(want)
  })

  it('keeps the f(x) = head', () => {
    const p = plot('f(x) = { -x if x < 0 ; x if x >= 0 }')
    expect(p.latex).toBe(
      'f\\left(x\\right) = \\begin{cases} -x & x < 0 \\\\ x & x \\geq 0 \\end{cases}',
    )
    expect(p.paramNames).toEqual([])
    const f = p.makeModel('t').evalExplicit!
    for (const x of SAMPLES) expect(f([], x)).toBe(Math.abs(x))
  })

  it('accepts an otherwise / else final branch', () => {
    for (const word of ['otherwise', 'else']) {
      const f = fn(`y = { x^2 if x < 0 ; 2x ${word} }`)
      expect(f(-2)).toBe(4)
      expect(f(5)).toBe(10)
    }
    expect(plot('y = { x^2 if x < 0 ; 2x otherwise }').latex).toBe(
      'y = \\begin{cases} x^{2} & x < 0 \\\\ 2x & \\text{otherwise} \\end{cases}',
    )
  })

  it('piecewise() with an odd argument count ends in a default value', () => {
    const f = fn('y = piecewise(x^2, x < 0, 2x)')
    expect(f(-2)).toBe(4)
    expect(f(5)).toBe(10)
  })

  it('a bare body with no head is still y =', () => {
    const p = plot('{ x^2 if x < 0 ; 2x if x >= 0 }')
    expect(p.kind).toBe('explicit')
    expect(p.latex.startsWith('y = \\begin{cases}')).toBe(true)
  })

  it('does not re-parse per evaluation: 20k evaluations stay quick', () => {
    const f = fn('y = { x^2 if x < 0 ; 2x if 0 <= x < 3 ; 6 otherwise }')
    const t0 = Date.now()
    let acc = 0
    for (let i = 0; i < 20000; i++) acc += f((i % 800) / 100 - 4)
    expect(Number.isFinite(acc)).toBe(true)
    expect(Date.now() - t0).toBeLessThan(500)
  })
})

describe('piecewise — the first matching branch wins', () => {
  const SRC = 'y = { 1 if x < 5 ; 2 if x < 10 ; 3 otherwise }'

  it('overlapping conditions resolve top-down', () => {
    const f = fn(SRC)
    expect(f(0)).toBe(1)
    expect(f(4.999)).toBe(1)
    expect(f(5)).toBe(2)
    expect(f(9.999)).toBe(2)
    expect(f(10)).toBe(3)
  })

  it('the printed order is the evaluated order', () => {
    const rows = casesRows(plot(SRC).latex)
    expect(rows.map((r) => r.body)).toEqual(['1', '2', '3'])
    expect(rows.map((r) => r.cond)).toEqual(['x < 5', 'x < 10', '\\text{otherwise}'])
  })
})

describe('piecewise — an uncovered x is undefined, and says so', () => {
  const SRC = 'y = { x^2 if x < -1 ; 2x if x > 1 }'

  it('evaluates to NaN in the gap, which the renderer lifts the pen for', () => {
    const f = fn(SRC)
    expect(f(-2)).toBe(4)
    expect(Number.isNaN(f(-1))).toBe(true)
    expect(Number.isNaN(f(0))).toBe(true)
    expect(Number.isNaN(f(1))).toBe(true)
    expect(f(2)).toBe(4)
  })

  it('never invents a value at the branch boundary', () => {
    const f = fn('y = { -1 if x < 0 ; 1 if x > 0 }')
    expect(Number.isNaN(f(0))).toBe(true)
  })
})

describe('piecewise — one branch is exactly a restriction', () => {
  it('"{ x^2 if 0 <= x < 3 }" and "x^2 {0 <= x < 3}" are the same curve', () => {
    const a = plot('y = { x^2 if 0 <= x < 3 }')
    const b = plot('y = x^2 {0 <= x < 3}')
    expect(a.latex).toBe(b.latex)
    expect(a.domain).toEqual(b.domain)
    const fa = a.makeModel('t').evalExplicit!
    const fb = b.makeModel('t').evalExplicit!
    for (const x of SAMPLES) expect(same(fa([], x), fb([], x))).toBe(true)
  })

  it('a single unbounded branch prints as a restriction too', () => {
    expect(plot('y = { x^2 if x < 0 }').latex).toBe('y = x^{2},\\ x \\in (-\\infty, 0)')
  })
})

describe('piecewise — free constants are one shared, deduplicated list', () => {
  it('one slider per letter, in order of first appearance', () => {
    const p = plot('y = { a x if x < 0 ; b x if x >= 0 }')
    expect(p.paramNames).toEqual(['a', 'b'])
    expect(p.defaultParams).toEqual([1, 1])
    const f = p.makeModel('t').evalExplicit!
    expect(f([3, 5], -2)).toBe(-6)
    expect(f([3, 5], 2)).toBe(10)
  })

  it('a letter reused across branches is the SAME slider', () => {
    const p = plot('y = { a x if x < 0 ; a + b if x >= 0 }')
    expect(p.paramNames).toEqual(['a', 'b'])
    const f = p.makeModel('t').evalExplicit!
    expect(f([3, 7], -2)).toBe(-6)
    expect(f([3, 7], 2)).toBe(10)
  })

  it('indices follow first appearance even when the later branch leads', () => {
    const p = plot('y = { b x if x < 0 ; a x if x >= 0 }')
    expect(p.paramNames).toEqual(['b', 'a'])
    const f = p.makeModel('t').evalExplicit!
    expect(f([2, 5], -1)).toBe(-2) // b = 2
    expect(f([2, 5], 1)).toBe(5) // a = 5
  })

  it('paramMeta lines up with the shared list', () => {
    const p = plot('y = { a x if x < 0 ; b x if x >= 0 }')
    const meta = p.makeModel('t').paramMeta([3, 5])
    expect(meta.map((m) => m.name)).toEqual(['a', 'b'])
  })
})

describe('piecewise — domain is the overall extent', () => {
  it('bounded on both sides', () => {
    expect(plot('y = { x^2 if 0 <= x < 1 ; 2x if 1 <= x <= 4 }').domain).toEqual([0, 4])
  })

  it('unbounded either way is null', () => {
    expect(plot('y = { x^2 if x < 0 ; 2x if x >= 0 }').domain).toBe(null)
    expect(plot('y = { x^2 if x < 0 ; 2x if 0 <= x <= 3 }').domain).toBe(null)
  })

  it('polar branches keep the theta window', () => {
    const p = plot('r = { 1 if 0 <= theta < pi ; 2 if pi <= theta <= 2pi }')
    expect(p.kind).toBe('polar')
    expect(p.domain![0]).toBe(0)
    expect(p.domain![1]).toBeCloseTo(2 * Math.PI, 12)
    const r = p.makeModel('t').evalPolar!
    expect(r([], 0.5)).toBe(1)
    expect(r([], 4)).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 3. Analysis interplay
// ---------------------------------------------------------------------------

describe('piecewise and analyzeCurve', () => {
  it('a sign flip at a jump is NOT reported as a zero', () => {
    // f(x) = -1 for x < 0, +1 for x >= 0. It changes sign without ever being
    // zero; a naive bisection would plant a root at the jump.
    const p = plot('y = { -1 if x<0 ; 1 if x>=0 }')
    const { curve, models } = curveOf(p)
    const pts = analyzeCurve({ ...curve, domain: [-5, 5] }, models)
    expect(pts.filter((q) => q.kind === 'zero')).toEqual([])
  })

  it('still reports the honest y-intercept of that jump', () => {
    const p = plot('y = { -1 if x<0 ; 1 if x>=0 }')
    const { curve, models } = curveOf(p)
    const pts = analyzeCurve({ ...curve, domain: [-5, 5] }, models)
    const yi = pts.filter((q) => q.kind === 'y-intercept')
    expect(yi.map((q) => q.pos.y)).toEqual([1])
  })

  it('a restricted parabola is analyzed only inside its domain', () => {
    // y = x^2 - 1 has zeros at -1 and 1; restricted to [0, 3] only one is real.
    const p = plot('y = x^2 - 1 {0 <= x <= 3}')
    const { curve, models } = curveOf(p)
    const zeros = analyzeCurve(curve, models)
      .filter((q) => q.kind === 'zero')
      .map((q) => q.pos.x)
    expect(zeros.length).toBe(1)
    expect(zeros[0]).toBeCloseTo(1, 9)
  })

  it('analysis of a gapped piecewise never throws and finds no phantom roots', () => {
    const p = plot('y = { 1 if x < -1 ; 2 if x > 1 }')
    const { curve, models } = curveOf(p)
    const pts = analyzeCurve({ ...curve, domain: [-5, 5] }, models)
    expect(pts.filter((q) => q.kind === 'zero')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4. Errors, positioned and helpful
// ---------------------------------------------------------------------------

describe('errors', () => {
  it('an empty condition says what one looks like', () => {
    const e = err('y = x^2 {}')
    expect(e.error).toBe('Empty condition — write something like {0 < x < 3}')
    expect(e.pos).toBe(8) // the '{'
  })

  it('an empty condition after a comma is reported at the comma', () => {
    const e = err('y = x^2,   ')
    expect(e.error).toMatch(/Empty condition/)
    expect(e.pos).toBe(7)
  })

  it('a piece without a condition is named as such', () => {
    const e = err('y = { x^2 ; 2x }')
    expect(e.error).toBe("Each piece needs a condition — 'x^2 if x < 0'")
    expect(e.pos).toBe(6)
  })

  it('a piece without a formula is named as such', () => {
    const e = err('y = { if x < 0 ; 2x if x >= 0 }')
    expect(e.error).toMatch(/Each piece needs a formula/)
  })

  it('a mismatched brace points at the opener', () => {
    const e = err('y = x^2 {0<x<3')
    expect(e.error).toBe("Missing closing '}' for the '{' at position 8")
    expect(e.pos).toBe(8)
    const e2 = err('y = { x^2 if x < 0 ; 2x if x >= 0')
    expect(e2.pos).toBe(4)
  })

  it('a condition about another letter is refused, with its position', () => {
    const e = err('y = x^2 {t > 0}')
    expect(e.error).toMatch(/condition is about 't' but the equation is in 'x'/)
    expect(e.pos).toBe(9)
    const e2 = err('y = { x^2 if x < 0 ; 2x if n >= 0 }')
    expect(e2.error).toMatch(/condition is about 'n' but the equation is in 'x'/)
    expect(e2.pos).toBe(27)
  })

  it('a polar curve wants a theta condition', () => {
    const e = err('r = 1 + cos(theta) {x > 0}')
    expect(e.error).toMatch(/condition is about 'x' but the equation is in 'theta'/)
  })

  it('a condition that can never be true is refused', () => {
    const e = err('y = x^2 {x < 0 and x > 1}')
    expect(e.error).toMatch(/never true/)
  })

  it('an implicit relation cannot carry a domain', () => {
    const e = err('x^2 + y^2 = 4 {x > 0}')
    expect(e.error).toMatch(/needs an explicit curve/)
  })

  it('a head that is not y = or f(x) = is refused', () => {
    const e = err('2x = { x^2 if x < 0 ; 2x if x >= 0 }')
    expect(e.error).toMatch(/cannot be defined piecewise/)
  })

  it('a condition with no comparison keeps the inequality parser’s message', () => {
    const e = err('y = x^2 {3}')
    expect(e.error).toMatch(/no variable|comparison/)
  })

  it('reports a bad formula inside a branch at its real position', () => {
    const e = err('y = { sin if x < 0 ; 2x if x >= 0 }')
    expect(e.error).toMatch(/'sin' needs an argument/)
    expect(e.pos).toBe(6)
  })

  it('a trailing stray after the condition is refused', () => {
    const e = err('y = x^2 {x > 0} + 1')
    expect(e.error).toMatch(/after the condition/)
  })
})

// ---------------------------------------------------------------------------
// 5. Round-trip: what is printed is what is computed
// ---------------------------------------------------------------------------

describe('round-trip — the printed cases table IS the function', () => {
  const CASES = [
    'y = { x^2 if x < 0 ; 2x if x >= 0 }',
    'y = { -x if x < 0 ; x if x >= 0 }',
    'y = { x^2 if x < -1 ; 2x if x > 1 }',
    'y = { 1 if x < 5 ; 2 if x < 10 ; 3 otherwise }',
    'y = { sqrt(x) if 0 <= x <= 4 ; 2 otherwise }',
    'y = { x^2 if 0 <= x < 1 ; 2x if 1 <= x <= 4 }',
  ]

  for (const src of CASES) {
    it(`"${src}" re-reads from its own latex`, () => {
      const p = plot(src)
      const ev = p.makeModel('t').evalExplicit!
      const rows = casesRows(p.latex)
      const bodies = rows.map((r) => compileLatex(r.body))
      const preds = rows.map((r) => condPred(r.cond))
      for (const x of SAMPLES) {
        let want = Number.NaN
        for (let i = 0; i < rows.length; i++) {
          if (preds[i](x)) { want = bodies[i](x, 0, 0); break }
        }
        const got = ev([], x)
        expect(
          same(got, want),
          `at x=${x}: model ${got}, printed table ${want} (${p.latex})`,
        ).toBe(true)
      }
    })
  }

  it('the restriction form re-reads too, gaps included', () => {
    const p = plot('y = x^2 {0 <= x < 3}')
    expect(p.latex).toBe('y = x^{2},\\ x \\in [0, 3)')
    const body = compileLatex('x^{2}')
    const ev = p.makeModel('t').evalExplicit!
    for (const x of [0, 1, 2.999]) expect(ev([], x)).toBe(body(x, 0, 0))
    expect(p.domain).toEqual([0, 3])
  })

  it('a restricted curve survives re-parsing its own source', () => {
    // The equation editor seeds from exprSource, so the typed text has to come
    // back through the parser unchanged.
    for (const src of ['y = x^2 {0 <= x < 3}', 'y = { x^2 if x<0 ; 2x if x>=0 }']) {
      const a = plot(src)
      const b = plot(src)
      expect(a.latex).toBe(b.latex)
      const fa = a.makeModel('t').evalExplicit!
      const fb = b.makeModel('t').evalExplicit!
      for (const x of SAMPLES) expect(same(fa([], x), fb([], x))).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 6. Nothing else moved
// ---------------------------------------------------------------------------

describe('plain equations are untouched', () => {
  const PLAIN: [string, string][] = [
    ['y = x^2', 'y = x^{2}'],
    ['2x + 1', 'y = 2x+1'],
    ['f(x) = a x^2 + b', 'f\\left(x\\right) = a\\,x^{2}+b'],
    ['r = 1 + cos(theta)', 'r = 1+\\cos\\left(\\theta\\right)'],
    ['x^2 + y^2 = 4', 'x^{2}+y^{2} = 4'],
    ['min(x, 2)', 'y = \\min\\left(x,\\,2\\right)'],
    ['max(sin x, 0)', 'y = \\max\\left(\\sin\\left(x\\right),\\,0\\right)'],
  ]

  for (const [src, latex] of PLAIN) {
    it(`"${src}" parses exactly as before`, () => {
      const p = plot(src)
      expect(p.latex).toBe(latex)
      expect(p.domain).toEqual(src.startsWith('r =') ? [0, 2 * Math.PI] : null)
    })
  }

  it('y = x^2 still evaluates as a bare parabola everywhere', () => {
    const f = fn('y = x^2')
    for (const x of SAMPLES) expect(f(x)).toBe(x * x)
  })

  it('a comma inside a two-argument function is not a condition', () => {
    const f = fn('y = min(x, 2)')
    expect(f(5)).toBe(2)
    expect(f(-1)).toBe(-1)
    expect(plot('y = min(x, 2)').domain).toBe(null)
  })

  it('a function name containing a keyword is not a keyword', () => {
    expect(plot('y = floor(x)').latex).toBe('y = \\left\\lfloor x\\right\\rfloor')
    const f = fn('y = floor(x)')
    expect(f(2.7)).toBe(2)
  })

  it('the old error messages still come back for ordinary mistakes', () => {
    expect(err('y = sin').error).toMatch(/'sin' needs an argument/)
    expect(err('y = = 2').error).toMatch(/Unexpected/)
    expect(err('').error).toBe('Empty expression')
  })

  it('a pasted "x^{2}" is still the tokenizer’s complaint, not a condition', () => {
    const e = err('y = x^{2}')
    expect(e.error).toBe("Unexpected character '{' at position 6")
    expect(e.pos).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// 7. Odds and ends a teacher will type by accident
// ---------------------------------------------------------------------------

describe('shapes around the edges', () => {
  it('needs no whitespace at all', () => {
    const p = plot('y=x^2{0<x<3}')
    expect(p.domain).toEqual([0, 3])
    expect(p.latex).toBe('y = x^{2},\\ x \\in (0, 3)')
  })

  it('tolerates trailing whitespace after the condition', () => {
    expect(plot('y = x^2 {x>0}  ').domain).toBe(null)
    expect(plot('y = { x^2 if x < 0 ; 2x if x >= 0 } ').kind).toBe('explicit')
  })

  it('restricts a constant', () => {
    const f = fn('y = 2, x > 0')
    expect(Number.isNaN(f(-1))).toBe(true)
    expect(f(3)).toBe(2)
  })

  it('an "and" inside the condition is the inequality parser’s, not ours', () => {
    expect(plot('y = x^2 {x > 0 and x < 3}').domain).toEqual([0, 3])
  })

  it('a single-point condition is a single-point domain', () => {
    const p = plot('y = x {x = 2}')
    expect(p.domain).toEqual([2, 2])
    expect(p.latex).toBe('y = x,\\ x \\in \\{2\\}')
  })

  it('a second condition is refused rather than silently ignored', () => {
    expect(err('y = x^2 {0 <= x < 3} {x > 1}').error).toMatch(/after the condition/)
  })

  it('the function letter cannot double as a constant inside its own pieces', () => {
    expect(err('a(x) = { a x if x < 0 ; x if x >= 0 }').error).toMatch(
      /is the function's own name/,
    )
  })

  it('a free constant that is not the head letter is still a slider', () => {
    const p = plot('f(x) = { a x if x < 0 ; x if x >= 0 }')
    expect(p.paramNames).toEqual(['a'])
    const f = p.makeModel('t').evalExplicit!
    expect(f([4], -2)).toBe(-8)
    expect(f([4], 2)).toBe(2)
  })
})

// ===========================================================================
// ModelSpec.pieces — the parser reports each piece's interval and ends
// ===========================================================================

function piecesOf(src: string, params?: number[]) {
  const p = plot(src)
  const m = p.makeModel('t')
  return m.pieces?.(params ?? p.defaultParams)
}

const I = Infinity

describe('ModelSpec.pieces from the parser', () => {
  it('the header example: three pieces, ends as written', () => {
    expect(piecesOf('f(x) = {x^2 + 1 if x < 0, 3 if 0 <= x <= 2, -x + 5 if x > 2}')).toEqual([
      { lo: -I, hi: 0, loClosed: false, hiClosed: false },
      { lo: 0, hi: 2, loClosed: true, hiClosed: true },
      { lo: 2, hi: I, loClosed: false, hiClosed: false },
    ])
  })

  it('restricted domains, every spelling', () => {
    expect(piecesOf('y = x^2 {-2 < x < 3}')).toEqual([{ lo: -2, hi: 3, loClosed: false, hiClosed: false }])
    expect(piecesOf('y = x^2 {-2 <= x < 3}')).toEqual([{ lo: -2, hi: 3, loClosed: true, hiClosed: false }])
    expect(piecesOf('y = x^2, 0 <= x <= 3')).toEqual([{ lo: 0, hi: 3, loClosed: true, hiClosed: true }])
    expect(piecesOf('y = x^2 for x > 1')).toEqual([{ lo: 1, hi: I, loClosed: false, hiClosed: false }])
    expect(piecesOf('y = sqrt(x) if x >= 0')).toEqual([{ lo: 0, hi: I, loClosed: true, hiClosed: false }])
    expect(piecesOf('y = x^2 {[1, 5)}')).toEqual([{ lo: 1, hi: 5, loClosed: true, hiClosed: false }])
    expect(piecesOf('f(x) = x^2 {0 < x <= pi}')).toEqual([{ lo: 0, hi: Math.PI, loClosed: false, hiClosed: true }])
  })

  it('a union is split into its intervals', () => {
    expect(piecesOf('y = x^2 {x < -1 or x > 2}')).toEqual([
      { lo: -I, hi: -1, loClosed: false, hiClosed: false },
      { lo: 2, hi: I, loClosed: false, hiClosed: false },
    ])
  })

  it('an exclusion is not a piece end — it is left to the holes layer', () => {
    expect(piecesOf('y = 1/x {x != 0}')).toBeUndefined()
    expect(piecesOf('y = { (x^2 - 4)/(x - 2) if x != 2 }')).toBeUndefined()
    // ... unless another branch claims the point: then it is that branch's
    expect(piecesOf('y = { x^2 if x != 2 ; 5 otherwise }')).toEqual([
      { lo: -I, hi: I, loClosed: false, hiClosed: false },
      { lo: 2, hi: 2, loClosed: true, hiClosed: true },
    ])
    expect(piecesOf('y = { 5 if x = 2 ; x^2 if x != 2 }')).toEqual([
      { lo: -I, hi: 2, loClosed: false, hiClosed: false },
      { lo: 2, hi: 2, loClosed: true, hiClosed: true },
      { lo: 2, hi: I, loClosed: false, hiClosed: false },
    ])
  })

  it('each piece is what its branch OWNS: first match wins, otherwise takes the rest', () => {
    expect(piecesOf('y = { 1 if x < 5 ; 2 if x < 10 ; 3 otherwise }')).toEqual([
      { lo: -I, hi: 5, loClosed: false, hiClosed: false },
      { lo: 5, hi: 10, loClosed: true, hiClosed: false },
      { lo: 10, hi: I, loClosed: true, hiClosed: false },
    ])
    expect(piecesOf('y = piecewise(x^2, x < 0, 2x)')).toEqual([
      { lo: -I, hi: 0, loClosed: false, hiClosed: false },
      { lo: 0, hi: I, loClosed: true, hiClosed: false },
    ])
  })

  it('a bound may be a slider: the pieces and the evaluator follow it', () => {
    const p = plot('y = x^2 {0 <= x <= a}')
    expect(p.paramNames).toEqual(['a'])
    expect(p.latex).toBe('y = x^{2},\\ x \\in [0, a]')
    expect(p.domain).toBeNull()
    const m = p.makeModel('t')
    expect(m.pieces!([1])).toEqual([{ lo: 0, hi: 1, loClosed: true, hiClosed: true }])
    expect(m.pieces!([2.5])).toEqual([{ lo: 0, hi: 2.5, loClosed: true, hiClosed: true }])
    expect(m.evalExplicit!([1], 1.5)).toBeNaN()
    expect(m.evalExplicit!([2], 1.5)).toBe(2.25)
    expect(m.evalExplicit!([2], 2)).toBe(4)
    expect(m.evalExplicit!([2], -0.1)).toBeNaN()
  })

  it('slider bounds in a piecewise share the body sliders', () => {
    const p = plot('y = { a x if x < b ; 2 if x >= b }')
    expect(p.paramNames).toEqual(['a', 'b'])
    expect(p.latex).toBe('y = \\begin{cases} a\\,x & x < b \\\\ 2 & x \\geq b \\end{cases}')
    const m = p.makeModel('t')
    expect(m.pieces!([1, 3])).toEqual([
      { lo: -I, hi: 3, loClosed: false, hiClosed: false },
      { lo: 3, hi: I, loClosed: true, hiClosed: false },
    ])
    expect(m.evalExplicit!([1, 3], 2.5)).toBe(2.5)
    expect(m.evalExplicit!([1, 3], 3)).toBe(2)
    expect(m.evalExplicit!([1, 1], 2.5)).toBe(2)
    const q = plot('y = { x if x < a ; 2 if a <= x < b ; 3 otherwise }')
    expect(q.makeModel('t').pieces!([1, 4])).toEqual([
      { lo: -I, hi: 1, loClosed: false, hiClosed: false },
      { lo: 1, hi: 4, loClosed: true, hiClosed: false },
      { lo: 4, hi: I, loClosed: true, hiClosed: false },
    ])
  })

  it('slider bounds never rescue what was an error for another reason', () => {
    expect(err('y = x^2 {x < t}').error).toMatch(/Two different variables/)
    expect(err('y = x^2 {5 <= x < 2}').error).toMatch(/never true/)
    expect(err('r = 1 + cos(theta) {0 < theta < a}').error).toMatch(/variable|θ|theta/)
  })

  it('ordinary lines carry no pieces', () => {
    for (const src of ['y = x^2', 'f(x) = a x^2 + b', 'y = floor(x)', 'y = min(x, 2)', 'y = x^2 {x > -inf}']) {
      expect(plot(src).makeModel('t').pieces, src).toBeUndefined()
    }
    // polar and implicit: no pieces either
    expect(plot('r = 1 + cos(theta) {0 <= theta <= pi}').makeModel('t').pieces).toBeUndefined()
    expect(plot('x^2 + y^2 = 4').makeModel('t').pieces).toBeUndefined()
  })

  it('commas between the cases: the textbook listing reads as the semicolon one', () => {
    const a = plot('f(x) = {x^2 + 1 if x < 0, 3 if 0 <= x <= 2, -x + 5 if x > 2}')
    const b = plot('f(x) = { x^2 + 1 if x < 0 ; 3 if 0 <= x <= 2 ; -x + 5 if x > 2 }')
    expect(a.latex).toBe(b.latex)
    expect(a.latex).toMatch(/\\begin\{cases\}/)
    const fa = a.makeModel('a').evalExplicit!
    const fb = b.makeModel('b').evalExplicit!
    for (const x of SAMPLES) expect(same(fa([], x), fb([], x))).toBe(true)
    // the formula-comma-condition spelling keeps its meaning
    expect(plot('y = { x^2, x < 0 ; 2x, x >= 0 }').latex).toBe(plot('y = { x^2 if x < 0 ; 2x if x >= 0 }').latex)
    expect(plot('y = {x^2 if x < 0, 3 otherwise}').latex).toBe(plot('y = {x^2 if x < 0; 3 otherwise}').latex)
    // a comma inside a condition is still the condition parser's complaint
    expect(err('y = { x^2 if x < 0, x > 1 }').error).toMatch(/Unexpected ','/)
  })
})

// ===========================================================================
// piecewise.ts — source, read, breakpoints, step functions
// ===========================================================================

/**
 * The function a line draws: its evaluator, NaN outside the reported pieces
 * (a plain bounded restriction's evaluator is ungated — its domain clips it).
 */
function graph(src: string): (x: number) => number {
  const p = plot(src)
  const m = p.makeModel('g')
  const ps = m.pieces?.(p.defaultParams)
  return (x) => {
    if (ps && !ps.some((q) => (x > q.lo || (x === q.lo && q.loClosed)) && (x < q.hi || (x === q.hi && q.hiClosed)))) return NaN
    return m.evalExplicit!(p.defaultParams, x)
  }
}

/** The spec evaluated directly: the first piece containing x, else NaN. */
function specEval(spec: PiecewiseSpec, params: number[] = []): (x: number) => number {
  const num = (t: string | undefined, d: number) => {
    if (t === undefined) return d
    const c = compileExpr(t)
    if (!c.ok) throw new Error(c.error)
    return c.expr.ev(c.expr.paramNames.map((_, i) => params[i] ?? 1), NaN, NaN)
  }
  const ps = spec.pieces.map((p) => {
    const c = compileExpr(p.expr)
    if (!c.ok) throw new Error(`${p.expr}: ${c.error}`)
    return { lo: num(p.lo, -I), hi: num(p.hi, I), loC: p.loClosed, hiC: p.hiClosed, e: c.expr }
  })
  return (x) => {
    for (const p of ps) {
      if ((x > p.lo || (x === p.lo && p.loC)) && (x < p.hi || (x === p.hi && p.hiC))) {
        return p.e.ev(p.e.paramNames.map(() => 1), x, 0)
      }
    }
    return NaN
  }
}

/** evalPiece for breakpoints: piece i's own formula, anywhere. */
function evalPieceOf(spec: PiecewiseSpec): (i: number, x: number) => number {
  const fs = spec.pieces.map((p) => {
    const c = compileExpr(p.expr)
    if (!c.ok) throw new Error(c.error)
    return c.expr
  })
  return (i, x) => fs[i].ev(fs[i].paramNames.map(() => 1), x, 0)
}

const HEADER: PiecewiseSpec = {
  name: 'f',
  pieces: [
    { expr: 'x^2 + 1', hi: '0', loClosed: false, hiClosed: false },
    { expr: '3', lo: '0', hi: '2', loClosed: true, hiClosed: true },
    { expr: '-x + 5', lo: '2', loClosed: false, hiClosed: false },
  ],
}

describe('piecewiseSource', () => {
  it('writes the header example the textbook way, and it parses to a cases table', () => {
    const src = piecewiseSource(HEADER)
    expect(src).toBe('f(x) = {x^2 + 1 if x < 0, 3 if 0 <= x <= 2, -x + 5 if x > 2}')
    const p = plot(src)
    expect(p.latex).toBe(
      'f\\left(x\\right) = \\begin{cases} x^{2}+1 & x < 0 \\\\ 3 & 0 \\leq x \\leq 2 \\\\ -x+5 & x > 2 \\end{cases}',
    )
  })

  it('evaluates equal to the spec at 20 points', () => {
    const f = graph(piecewiseSource(HEADER))
    const g = specEval(HEADER)
    const xs = [-3, -2, -1, -0.5, -1e-9, 0, 1e-9, 0.5, 1, 1.5, 2 - 1e-9, 2, 2 + 1e-9, 2.5, 3, 4, 5, 7, -7, 10]
    expect(xs.length).toBe(20)
    for (const x of xs) expect(same(f(x), g(x)), `x = ${x}`).toBe(true)
  })

  const TABLE: [PiecewiseSpec, string][] = [
    [{ pieces: [{ expr: 'x^2', lo: '0', hi: '3', loClosed: true, hiClosed: false }] }, 'y = x^2 {0 <= x < 3}'],
    [{ name: 'g', pieces: [{ expr: 'sqrt(x)', lo: '0', loClosed: true, hiClosed: false }] }, 'g(x) = sqrt(x) {x >= 0}'],
    [{ pieces: [{ expr: 'x', loClosed: false, hiClosed: false }] }, 'y = x'],
    [{ pieces: [
      { expr: '5', lo: '2', hi: '2', loClosed: true, hiClosed: true },
      { expr: 'x^2', loClosed: false, hiClosed: false },
    ] }, 'y = {5 if x = 2, x^2 otherwise}'],
    [{ pieces: [
      { expr: '1', hi: '1/2', loClosed: false, hiClosed: true },
      { expr: '2', lo: '1/2', hi: 'sqrt(2)', loClosed: false, hiClosed: false },
      { expr: '3', lo: 'sqrt(2)', loClosed: true, hiClosed: false },
    ] }, 'y = {1 if x <= 1/2, 2 if 1/2 < x < sqrt(2), 3 if x >= sqrt(2)}'],
    [{ pieces: [
      { expr: 'x', loClosed: false, hiClosed: false },
      { expr: '2', lo: '0', loClosed: false, hiClosed: false },
    ] }, 'y = {x if -inf < x < inf, 2 if x > 0}'],
  ]
  for (const [spec, want] of TABLE) {
    it(`writes ${want}`, () => {
      expect(piecewiseSource(spec)).toBe(want)
      const f = graph(want)
      const g = specEval(spec)
      for (const x of [-3, -1, 0, 0.5, 1, Math.SQRT2, 1.5, 2, 2.9, 3, 4]) expect(same(f(x), g(x)), `x = ${x}`).toBe(true)
    })
  }
})

describe('readPiecewise', () => {
  const READ: [string, PiecewiseSpec][] = [
    ['f(x) = {x^2 + 1 if x < 0, 3 if 0 <= x <= 2, -x + 5 if x > 2}', HEADER],
    ['f(x) = { x^2 + 1 if x < 0 ; 3 if 0 <= x <= 2 ; -x + 5 if x > 2 }', HEADER],
    ['f(x) = piecewise(x^2 + 1, x < 0, 3, 0 <= x <= 2, -x + 5, x > 2)', HEADER],
    ['f(x) = { x^2 + 1, x < 0 ; 3, [0, 2] ; -x + 5, x > 2 }', HEADER],
    // written out of order: sorted by lo
    ['f(x) = { -x + 5 if x > 2 ; 3 if 0 <= x <= 2 ; x^2 + 1 if x < 0 }', HEADER],
    ['y = x^2 {-2 < x < 3}', { pieces: [{ expr: 'x^2', lo: '-2', hi: '3', loClosed: false, hiClosed: false }] }],
    ['y = x^2, 1/2 <= x < sqrt(2)', { pieces: [{ expr: 'x^2', lo: '1/2', hi: 'sqrt(2)', loClosed: true, hiClosed: false }] }],
    ['y = x^2 for x > 1', { pieces: [{ expr: 'x^2', lo: '1', loClosed: false, hiClosed: false }] }],
    ['y = { 1 if x < 5 ; 2 if x < 10 ; 3 otherwise }', { pieces: [
      { expr: '1', hi: '5', loClosed: false, hiClosed: false },
      { expr: '2', lo: '5', hi: '10', loClosed: true, hiClosed: false },
      { expr: '3', lo: '10', loClosed: true, hiClosed: false },
    ] }],
    // a union and an exclusion are split, one piece per interval
    ['y = x^2 {x < -1 or x > 2}', { pieces: [
      { expr: 'x^2', hi: '-1', loClosed: false, hiClosed: false },
      { expr: 'x^2', lo: '2', loClosed: false, hiClosed: false },
    ] }],
    ['y = { (x^2 - 1)/(x - 1) if x != 1 ; 5 if x = 1 }', { pieces: [
      { expr: '(x^2 - 1)/(x - 1)', hi: '1', loClosed: false, hiClosed: false },
      { expr: '5', lo: '1', hi: '1', loClosed: true, hiClosed: true },
      { expr: '(x^2 - 1)/(x - 1)', lo: '1', loClosed: false, hiClosed: false },
    ] }],
    // slider bounds: as typed, in the typed order
    ['y = { a x if x < b ; 2 if x >= b }', { pieces: [
      { expr: 'a x', hi: 'b', loClosed: false, hiClosed: false },
      { expr: '2', lo: 'b', loClosed: true, hiClosed: false },
    ] }],
    ['y = x^2 {0 <= x <= a}', { pieces: [{ expr: 'x^2', lo: '0', hi: 'a', loClosed: true, hiClosed: true }] }],
  ]
  for (const [src, want] of READ) {
    it(`reads ${src}`, () => {
      expect(readPiecewise(src)).toEqual(want)
    })
  }

  it('null for everything that is not a piecewise or restricted explicit line', () => {
    for (const src of [
      'y = x^2', 'x^2 + y^2 = 4', 'r = 1 + cos(theta) {0 <= theta <= pi}', 'y = t^2 {t > 0}',
      'y = x^2 {x < 0', 'y = { x^2 ; 2x }', '', 'hello', 'y = x^2 {3}',
    ]) {
      expect(readPiecewise(src), src).toBeNull()
    }
  })
})

describe('round trip on 200 random specs', () => {
  const rng = makeRng(2718)
  const ri = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1))
  const signed = (n: number) => (n < 0 ? ` - ${-n}` : ` + ${n}`)
  const EXPRS: (() => string)[] = [
    () => `${ri(2, 4)}x${signed(ri(-5, 5))}`,
    () => `x^2${signed(ri(-4, 4))}`,
    () => `-x^2${signed(ri(-4, 4))}`,
    () => `abs(x${signed(ri(-3, 3))})`,
    () => `sqrt(x${signed(ri(1, 6))})`,
    () => String(ri(-6, 6)),
    () => `1/2 x${signed(ri(-3, 3))}`,
  ]
  const BOUNDS = ['-4', '-3', '-5/2', '-2', '-1', '-1/2', '0', '1/2', '1', '3/2', '2', 'sqrt(5)', '3', '4', '5']
  const val = (t: string) => {
    const c = compileExpr(t)
    if (!c.ok) throw new Error(t)
    return c.expr.ev([], NaN, NaN)
  }

  function genSpec(): { spec: PiecewiseSpec; overlap: boolean } {
    const n = ri(2, 4)
    // 2n distinct increasing bound slots; piece i spans slots [2i, 2i+1] or
    // reaches into its neighbour (overlap) / stops short (gap)
    let idx = ri(0, 2)
    const pieces: PiecewiseSpec['pieces'] = []
    let overlap = false
    let prevHi: { v: number; closed: boolean } | null = null
    for (let i = 0; i < n; i++) {
      const lo = BOUNDS[Math.min(idx, BOUNDS.length - 1)]
      const step = ri(1, 3)
      const hiIdx = Math.min(idx + step, BOUNDS.length - 1)
      const hi = BOUNDS[hiIdx]
      if (val(lo) >= val(hi)) break
      const p = { expr: EXPRS[ri(0, EXPRS.length - 1)](), lo, hi, loClosed: rng() < 0.5, hiClosed: rng() < 0.5 } as PiecewiseSpec['pieces'][number]
      if (i === 0 && rng() < 0.4) { delete p.lo; p.loClosed = false }
      pieces.push(p)
      if (prevHi && (prevHi.v > val(lo) || (prevHi.v === val(lo) && prevHi.closed && p.loClosed))) overlap = true
      prevHi = { v: val(hi), closed: p.hiClosed }
      const r = rng()
      idx = r < 0.2 ? Math.max(0, hiIdx - 1) : r < 0.4 ? hiIdx + 1 : hiIdx // overlap / gap / touch
    }
    if (pieces.length >= 2 && rng() < 0.4) {
      const last = pieces[pieces.length - 1]
      delete last.hi
      last.hiClosed = false
    }
    // an overlap is only an overlap if the later piece actually starts inside
    return { spec: { pieces }, overlap }
  }

  it('source → read → source evaluates identically; without overlaps the table itself comes back', () => {
    let exact = 0
    let n = 0
    for (let t = 0; t < 200; t++) {
      const { spec, overlap } = genSpec()
      if (spec.pieces.length < 2) continue
      n++
      const src = piecewiseSource(spec)
      const f = graph(src)
      const g = specEval(spec)
      const xs: number[] = []
      for (let k = 0; k <= 40; k++) xs.push(-6 + 0.3 * k + 0.01)
      for (const b of BOUNDS) xs.push(val(b), val(b) - 1e-7, val(b) + 1e-7)
      for (const x of xs) expect(same(f(x), g(x)), `${src} at ${x}`).toBe(true)

      const back = readPiecewise(src)
      expect(back, src).not.toBeNull()
      const src2 = piecewiseSource(back!)
      const f2 = graph(src2)
      for (const x of xs) expect(same(f2(x), f(x)), `${src} → ${src2} at ${x}`).toBe(true)
      if (!overlap) {
        expect(back, src).toEqual(spec)
        exact++
      }
      // and reading is idempotent
      expect(readPiecewise(src2), src2).toEqual(back)
    }
    expect(n).toBeGreaterThan(150)
    expect(exact).toBeGreaterThan(50)
  })
})

describe('breakpoints', () => {
  const bps = (spec: PiecewiseSpec) => breakpoints(spec, evalPieceOf(spec))
  const read = (src: string) => {
    const s = readPiecewise(src)
    if (!s) throw new Error(`could not read ${src}`)
    return s
  }

  it('the header example: a jump of 2 at 0, continuous at 2 with the middle piece’s 3', () => {
    const b = bps(HEADER)
    expect(b.map((q) => q.x)).toEqual([0, 2])
    expect(b[0]).toMatchObject({ kind: 'jump', leftLimit: 1, rightLimit: 3, value: 3, xText: '0' })
    expect(b[0].sentence).toBe('jump of 2 at x = 0: left limit 1, right limit 3, f(0) = 3')
    expect(b[1]).toMatchObject({ kind: 'continuous', leftLimit: 3, rightLimit: 3, value: 3 })
    expect(b[1].sentence).toBe('continuous at x = 2')
  })

  it('removable: the limits agree, the value is elsewhere or missing', () => {
    const b = bps(read('y = {(x^2 - 1)/(x - 1) if x != 1; 5 if x = 1}'))
    expect(b).toHaveLength(1)
    expect(b[0]).toMatchObject({ kind: 'removable', leftLimit: 2, rightLimit: 2, value: 5 })
    expect(b[0].sentence).toBe('removable discontinuity at x = 1: limit 2, f(1) = 5')
    const c = bps(read('y = {x + 1 if x < 1, 2x if x > 1}'))
    expect(c[0]).toMatchObject({ kind: 'removable', value: null })
    expect(c[0].sentence).toBe('removable discontinuity at x = 1: limit 2, f(1) is not defined')
  })

  it('infinite: a side runs away', () => {
    const b = bps(read('y = {1/x if x < 0, x if x >= 0}'))
    expect(b[0]).toMatchObject({ kind: 'infinite', leftLimit: -Infinity, rightLimit: 0, value: 0 })
    expect(b[0].sentence).toBe('infinite discontinuity at x = 0')
    const ln = bps(read('y = {2 if x <= 0, ln(x) if x > 0}'))
    expect(ln[0]).toMatchObject({ kind: 'infinite', rightLimit: -Infinity })
  })

  it('gap: the pieces do not meet', () => {
    const b = bps(read('y = {x if x <= 2, 5 if x >= 3}'))
    expect(b.map((q) => q.kind)).toEqual(['gap', 'end'])
    expect(b[0].sentence).toBe('gap: f is not defined on 2 < x < 3')
    expect(b[1].sentence).toBe('f resumes at x = 3: right limit 5, f(3) = 5')
    const open = bps(read('y = {x if x < 2, 5 if x > 3}'))
    expect(open[0].sentence).toBe('gap: f is not defined on 2 ≤ x ≤ 3')
  })

  it('overlap: two pieces include the point and disagree', () => {
    const spec: PiecewiseSpec = { pieces: [
      { expr: 'x', hi: '2', loClosed: false, hiClosed: true },
      { expr: '5', lo: '2', loClosed: true, hiClosed: false },
    ] }
    const b = bps(spec)
    expect(b[0]).toMatchObject({ kind: 'overlap', value: 2 })
    expect(b[0].sentence).toBe('overlap at x = 2: two pieces both include x = 2 and disagree — f(2) = 2 and f(2) = 5')
    // two pieces claiming the same stretch with different formulas
    const wide = bps({ pieces: [
      { expr: '1', hi: '5', loClosed: false, hiClosed: false },
      { expr: '2', hi: '10', loClosed: false, hiClosed: false },
    ] })
    expect(wide[0].kind).toBe('overlap')
  })

  it('an overlap that agrees is fine, and says so', () => {
    const b = bps({ pieces: [
      { expr: 'x + 1', hi: '2', loClosed: false, hiClosed: true },
      { expr: '3', lo: '2', loClosed: true, hiClosed: false },
    ] })
    expect(b[0].kind).toBe('continuous')
    expect(b[0].sentence).toBe('continuous at x = 2 (two pieces include x = 2 and agree: f(2) = 3)')
  })

  it('bounded ends of the domain', () => {
    const b = bps(read('f(x) = x^2 {-2 < x <= 3}'))
    expect(b.map((q) => q.kind)).toEqual(['end', 'end'])
    expect(b[0].sentence).toBe('f starts at x = −2: right limit 4, f(−2) is not defined')
    expect(b[1].sentence).toBe('f ends at x = 3: left limit 9, f(3) = 9')
    const iso = bps({ pieces: [{ expr: '5', lo: '2', hi: '2', loClosed: true, hiClosed: true }] })
    expect(iso[0]).toMatchObject({ kind: 'end', value: 5 })
  })

  it('an open side takes the formula’s own value — or its limit where it has none', () => {
    // sin(x)/x has no value at 0: the limit 1 is extrapolated from inside
    const b = bps(read('y = {sin(x)/x if x < 0, 1 if x >= 0}'))
    expect(b[0]).toMatchObject({ kind: 'continuous', leftLimit: 1 })
    // floor steps exactly at the boundary: the limit from the left is 0, not floor(1) = 1
    const s = bps({ pieces: [
      { expr: 'floor(x)', hi: '1', loClosed: false, hiClosed: false },
      { expr: '1', lo: '1', loClosed: true, hiClosed: false },
    ] })
    expect(s[0]).toMatchObject({ kind: 'jump', leftLimit: 0, rightLimit: 1 })
  })

  it('exact text in the sentences', () => {
    const b = bps(read('y = {x^2 if x < sqrt(2), 1 if x >= sqrt(2)}'))
    expect(b[0].xText).toBe('√2')
    expect(b[0].sentence).toBe('jump of 1 at x = √2: left limit 2, right limit 1, f(√2) = 1')
  })
})

describe('stepSpec', () => {
  it('floor, the greatest-integer family a·floor(b(x − h)) + k', () => {
    expect(stepSpec('floor', {})).toBe('y = floor(x)')
    const src = stepSpec('floor', { a: '2', b: '1/2', h: '-1', k: '3' }) as string
    const f = fn(src)
    for (const x of [-3.2, -1, -0.5, 0, 0.99, 1, 2.5, 4]) expect(f(x)).toBe(2 * Math.floor(0.5 * (x + 1)) + 3)
    expect(plot(src).latex).toMatch(/\\lfloor/)
  })

  it('ceil', () => {
    expect(stepSpec('ceil', {})).toBe('y = ceil(x)')
    const f = fn(stepSpec('ceil', { a: '-1', h: '2', k: '1' }) as string)
    for (const x of [-1.5, 0, 1.2, 2, 2.01, 3.7]) expect(f(x)).toBe(-Math.ceil(x - 2) + 1)
  })

  it('round is floor(… + 1/2) — the parser has no round(); halves go up', () => {
    expect(stepSpec('round', {})).toBe('y = floor(x + 1/2)')
    const src = stepSpec('round', { a: '3', b: '2', k: '-1' }) as string
    const f = fn(src)
    for (const x of [-1.25, -0.75, -0.25, 0, 0.2, 0.25, 0.3, 1.75]) expect(f(x)).toBe(3 * Math.round(2 * x) - 1)
  })

  it('a table of constant values: the parking-fee shape', () => {
    const spec = stepSpec('table', { table: [
      { lo: '0', hi: '1', value: '5', loClosed: false, hiClosed: true },
      { lo: '1', hi: '2', value: '8', loClosed: false, hiClosed: true },
      { lo: '2', hi: '3', value: '11', loClosed: false, hiClosed: true },
    ] }) as PiecewiseSpec
    expect(spec.pieces).toEqual([
      { expr: '5', lo: '0', hi: '1', loClosed: false, hiClosed: true },
      { expr: '8', lo: '1', hi: '2', loClosed: false, hiClosed: true },
      { expr: '11', lo: '2', hi: '3', loClosed: false, hiClosed: true },
    ])
    const src = piecewiseSource(spec)
    expect(src).toBe('y = {5 if 0 < x <= 1, 8 if 1 < x <= 2, 11 if 2 < x <= 3}')
    const f = fn(src)
    expect(f(0)).toBeNaN()
    expect(f(0.5)).toBe(5)
    expect(f(1)).toBe(5)
    expect(f(1.01)).toBe(8)
    expect(f(3)).toBe(11)
    expect(readPiecewise(src)).toEqual(spec)
    const b = breakpoints(spec, evalPieceOf(spec))
    expect(b.map((q) => q.kind)).toEqual(['end', 'jump', 'jump', 'end'])
    expect(b[1].sentence).toBe('jump of 3 at x = 1: left limit 5, right limit 8, f(1) = 5')
    // an empty or infinite bound is an unbounded side
    const open = stepSpec('table', { table: [{ lo: '', hi: '0', value: '1', loClosed: true, hiClosed: false }, { lo: '0', hi: 'inf', value: '2', loClosed: true, hiClosed: true }] }) as PiecewiseSpec
    expect(open.pieces).toEqual([
      { expr: '1', hi: '0', loClosed: false, hiClosed: false },
      { expr: '2', lo: '0', loClosed: true, hiClosed: false },
    ])
  })
})

describe('analysis on a piecewise curve reports only points the curve reaches', () => {
  it('no minimum or inflection at the open end (0, 1) of x² + 1 on x < 0', async () => {
    const { parseExpression } = await import('../src/core/parse')
    const { analyzeCurve } = await import('../src/core/analyze')
    const r = parseExpression('f(x) = {x^2 + 1 if x < 0, 3 if 0 <= x <= 2, -x + 5 if x > 2}')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const spec = r.plot.makeModel('expr_1')
    const curve = {
      id: 'c', modelId: 'expr_1', params: r.plot.defaultParams, kind: r.plot.kind,
      domain: r.plot.domain, color: '#4f9cf9', strokeWidth: 2.5, visible: true, error: 0,
    } as never
    const pts = analyzeCurve(curve, { expr_1: spec })
    const atOpenEnd = pts.filter((p) => Math.abs(p.pos.x) < 1e-6 && Math.abs(p.pos.y - 1) < 1e-6)
    expect(atOpenEnd).toEqual([])
    expect(pts.some((p) => p.kind === 'zero' && Math.abs(p.pos.x - 5) < 1e-9)).toBe(true)
    expect(pts.some((p) => p.kind === 'y-intercept' && Math.abs(p.pos.y - 3) < 1e-9)).toBe(true)
  })
})

describe('analysis never reads a jump as a feature', () => {
  function analyze(src: string) {
    const { curve, models } = curveOf(plot(src))
    return { pts: analyzeCurve(curve, models), zi: zeroIntervals(curve, models), f: fn(src) }
  }
  const kinds = (pts: SpecialPoint[], k: SpecialPoint['kind']) => pts.filter((p) => p.kind === k)

  for (const src of [
    'f(x) = {x^2 + 1 if x <= 0, 3 if 0 < x <= 2, -x + 5 if x > 2}',
    'f(x) = {x^2 + 1 if x <= 0, 3 if 0 < x < 2, -x + 5 if x > 2}',
  ]) {
    it(`no inflection just right of the jump at 0: ${src}`, () => {
      const { pts } = analyze(src)
      // the reported bug: "Inflection (0.008333, 3.000)"
      expect(kinds(pts, 'inflection')).toEqual([])
      // nothing within a sampling step of the jump except points AT it
      for (const p of pts) {
        const d = Math.abs(p.pos.x)
        expect(d === 0 || d > 20 / 1200, `${p.kind} at ${p.pos.x}`).toBe(true)
      }
      // f(0) = 1 is below both sides (x² + 1 on the left, 3 on the right): a
      // genuine minimum, reported AT the seam
      const mins = kinds(pts, 'minimum')
      expect(mins.map((p) => [p.pos.x, p.pos.y])).toEqual([[0, 1]])
      expect(kinds(pts, 'zero').map((p) => p.pos.x)).toEqual([5])
    })
  }

  it('a jump between two parabola-ish pieces is not an inflection', () => {
    const { pts } = analyze('y = {x^2 - 4 if x < 1, x + 2 if x >= 1}')
    expect(kinds(pts, 'inflection')).toEqual([])
  })

  it('a continuous seam where concavity flips IS an inflection, exactly at the seam', () => {
    const { pts } = analyze('y = {x^2 if x < 0, -x^2 if x >= 0}')
    const infl = kinds(pts, 'inflection')
    expect(infl.map((p) => [p.pos.x, p.pos.y])).toEqual([[0, 0]])
  })

  it('a kink between two concave-up pieces is not an inflection', () => {
    const { pts } = analyze('y = {x^2 if x < 0, x^2 - x if x >= 0}')
    expect(kinds(pts, 'inflection')).toEqual([])
  })

  it('a zero piece is one zero interval; the isolated zero elsewhere stays', () => {
    const { pts, zi } = analyze('y = {x + 2 if x < -1, 0 if -1 <= x < 1, (x-1)^2 if x >= 1}')
    expect(zi).toEqual([{ lo: -1, hi: 1, loClosed: true, hiClosed: true }])
    expect(kinds(pts, 'zero').map((p) => p.pos.x)).toEqual([-2])
    // the flat bottom is not a run of minima
    for (const p of pts) {
      if (p.kind === 'y-intercept') continue
      expect(p.pos.x >= -1 && p.pos.x <= 1, `${p.kind} at ${p.pos.x}`).toBe(false)
    }
  })

  it('an excluded end is not a zero, whatever the evaluator hands back there', () => {
    const { pts } = analyze('y = x {0 < x < 3}')
    expect(kinds(pts, 'zero')).toEqual([])
  })
})
