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
import type { FittedCurve, ModelSpec, ParsedPlot } from '../src/core/types'
import { parseExpression } from '../src/core/parse'
import { analyzeCurve } from '../src/core/analyze'
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
