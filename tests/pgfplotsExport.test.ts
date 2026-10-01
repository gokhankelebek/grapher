// ============================================================================
// tests/pgfplotsExport.test.ts — the semantic LaTeX export.
//
// The claim this file holds: a typed curve reaches pgfplots as ITS FORMULA —
// translated from the parser's AST and checked against the board's own model
// — and everything that cannot be a formula still reaches it honestly, as the
// board's own samples, split wherever the board lifts its pen.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { definedIntervals, toPgfplots, translateCurve } from '../src/ui/pgfplotsExport'
import { parseExpression } from '../src/core/parse'
import { FIGURE_STYLES, LIGHT_THEME } from '../src/core/types'
import type { FittedCurve, ModelSpec, Viewport } from '../src/core/types'
import type { BoardScene } from '../src/ui/renderBoard'

function model(src: string): { model: ModelSpec; params: number[]; domain: [number, number] | null } {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(`${src}: ${r.error}`)
  return { model: r.plot.makeModel('m'), params: r.plot.defaultParams, domain: r.plot.domain }
}

function tr(src: string, lo = -5, hi = 5): string[] {
  const m = model(src)
  const t = translateCurve(src, m.model, m.params, lo, hi)
  if (!t.ok) throw new Error(`${src}: ${t.reason}`)
  return t.pieces.map((p) => p.expr)
}

describe('typed expressions → pgfmath', () => {
  it('translates the everyday forms', () => {
    expect(tr('y = x^2')).toEqual(['x^2'])
    expect(tr('y = x^2 - 3')).toEqual(['x^2 - 3'])
    expect(tr('y = sin(x)')).toEqual(['sin(x)'])
    expect(tr('y = sqrt(x - 2)', 2, 6)).toEqual(['sqrt(x - 2)'])
    expect(tr('y = e^(-x)')).toEqual(['exp(-x)'])
    expect(tr('y = ln(x)', 0.1, 5)).toEqual(['ln(x)'])
    expect(tr('y = |x|')).toEqual(['abs(x)'])
    expect(tr('y = 2cos(3x) + 1')).toEqual(['2*cos(3*x) + 1'])
    expect(tr('f(x) = (x - 1)/(x + 2)')).toEqual(['(x - 1)/(x + 2)'])
  })

  it('handles logs in any base, the real cube root, and sliders by value', () => {
    expect(tr('y = log_2(x)', 0.5, 5)).toEqual(['ln(x)/ln(2)'])
    expect(tr('y = log(x)', 0.5, 5)).toEqual(['log10(x)'])
    // x^(1/3) is real for x < 0 on the board, so it is on the page too
    expect(tr('y = x^(1/3)')).toEqual(['(x < 0 ? -1 : 1)*abs(x)^(1/3)'])
    const m = model('y = a x^2 + b')
    const params = m.model.paramMeta(m.params).map((p) => (p.name === 'a' ? 0.5 : -2))
    const t = translateCurve('y = a x^2 + b', m.model, params, -3, 3)
    expect(t.ok && t.pieces[0].expr).toBe('0.5*x^2 - 2')
  })

  it('splits a piecewise line into one formula per piece', () => {
    const src = 'y = piecewise(x^2, x < 0, 2x + 1, x >= 0)'
    const m = model(src)
    const t = translateCurve(src, m.model, m.params, -4, 4)
    expect(t.ok).toBe(true)
    if (!t.ok) return
    expect(t.pieces.map((p) => p.expr)).toEqual(['x^2', '2*x + 1'])
    expect(t.pieces[0].lo).toBe(-4)
    expect(t.pieces[0].hi).toBe(0)
    expect(t.pieces[1].lo).toBe(0)
    expect(t.pieces[1].hi).toBe(4)
  })

  it('a restricted line keeps its interval', () => {
    const src = 'y = x^2 {0 <= x <= 2}'
    const m = model(src)
    const t = translateCurve(src, m.model, m.params, -4, 4)
    expect(t.ok && t.pieces.map((p) => [p.expr, p.lo, p.hi])).toEqual([['x^2', 0, 2]])
  })

  it('refuses what pgfplots would draw wrongly, and says why', () => {
    const m = model('y = floor(x)')
    const t = translateCurve('y = floor(x)', m.model, m.params, -3, 3)
    expect(t.ok).toBe(false)
    if (!t.ok) expect(t.reason).toMatch(/step function/)
    const a = model('y = arctan(x)')
    const u = translateCurve('y = arctan(x)', a.model, a.params, -3, 3)
    expect(u.ok).toBe(false)
  })

  it('finds where a formula is defined, and splits at poles', () => {
    const f = (x: number): number => Math.sqrt(x - 2)
    const iv = definedIntervals(f, -5, 5)
    expect(iv.length).toBe(1)
    expect(iv[0][0]).toBeGreaterThanOrEqual(2)
    expect(iv[0][0]).toBeLessThan(2.001)
    expect(Number.isFinite(f(iv[0][0]))).toBe(true)
    const g = (x: number): number => 1 / (x - 1)
    const jv = definedIntervals(g, -5, 5, [1])
    expect(jv.length).toBe(2)
    expect(jv[0][1]).toBeLessThan(1)
    expect(jv[1][0]).toBeGreaterThan(1)
  })
})

// ---------------------------------------------------------------------------
// Whole figures
// ---------------------------------------------------------------------------

const VP: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 40, widthPx: 640, heightPx: 400 }

function curve(id: string, src: string | null, m: ModelSpec, params: number[], color = '#4f9cf9'): FittedCurve {
  void src
  return { id, modelId: id, params, kind: 'explicit', domain: null, color, strokeWidth: 2.5, visible: true, error: 0 }
}

function scene(over: Partial<BoardScene>): BoardScene {
  return {
    vp: VP,
    theme: LIGHT_THEME,
    curves: [],
    styles: {},
    models: {},
    printColors: true,
    chrome: null,
    ...over,
  }
}

function balanced(tex: string): boolean {
  let depth = 0
  for (const line of tex.split('\n')) {
    const code = line.replace(/(^|[^\\])%.*$/, '$1')
    for (let i = 0; i < code.length; i++) {
      if (code[i] === '\\') {
        i++
        continue
      }
      if (code[i] === '{') depth++
      else if (code[i] === '}') depth--
      if (depth < 0) return false
    }
  }
  return depth === 0
}

function specialsEscaped(tex: string): boolean {
  for (const line of tex.split('\n')) {
    if (/^\s*%/.test(line)) continue
    if (/(^|[^\\])[#&]/.test(line) || /(^|[^\\])%/.test(line)) return false
  }
  return true
}

describe('pgfplots figure', () => {
  const quad = model('y = x^2 - 3')
  const sine = model('y = sin(x)')
  const both = scene({
    curves: [curve('f', 'y = x^2 - 3', quad.model, quad.params), curve('g', 'y = sin(x)', sine.model, sine.params, '#f95f62')],
    models: { f: quad.model, g: sine.model },
    figure: FIGURE_STYLES.sat,
    axisUnits: { x: 'pi' },
    overlays: [{ kind: 'area', curveId: 'f', from: -1, to: 1 }],
    curveNames: { f: 'f', g: 'g' },
  })
  const out = toPgfplots(both, { widthCm: 8, sources: { f: 'y = x^2 - 3', g: 'y = sin(x)' } })

  it('is an axis environment with the window, middle axes, and the preamble it needs', () => {
    expect(out).toContain('%   \\usepackage{pgfplots}')
    expect(out).toContain('%   \\pgfplotsset{compat=1.18}')
    expect(out).toContain('%   \\usepgfplotslibrary{fillbetween}')
    expect(out).toContain('\\begin{axis}[')
    expect(out).toContain('xmin=-8, xmax=8')
    expect(out).toContain('ymin=-5, ymax=5')
    expect(out).toContain('axis lines=middle')
    expect(out).toContain('trig format plots=rad')
    expect(out).toContain('grid=both')
    expect(out).toContain('xlabel={$x$}, ylabel={$y$}')
    expect(out).toContain('\\end{axis}\n\\end{tikzpicture}')
    expect(balanced(out)).toBe(true)
    expect(specialsEscaped(out)).toBe(true)
  })

  it('writes typed curves as their formulas', () => {
    expect(out).toMatch(/\\addplot\[black, thick, <->, domain=-?[\d.]+:[\d.]+, samples=\d+, restrict y to domain=[-\d.:]+\] \{x\^2 - 3\}/)
    expect(out).toMatch(/\\addplot\[black, thick, <->, domain=-8:8, samples=\d+, [^\]]+\] \{sin\(x\)\}/)
    // the curve's name where the board put it
    expect(out).toMatch(/\\node\[anchor=base[^\]]*\] at \(axis cs:[-\d.]+,[-\d.]+\) \{\$f\$\};/)
  })

  it('writes π ticks as xtick + xticklabels', () => {
    const xtick = /xtick=\{([^}]*)\}/.exec(out)![1].split(', ').map(Number)
    expect(xtick).toContain(Math.round((Math.PI / 2) * 1e5) / 1e5)
    expect(out).toContain('{$\\frac{\\pi}{2}$}')
    expect(out).toContain('{$-\\pi$}')
  })

  it('shades an area with fill between', () => {
    expect(out).toContain('name path=area1top')
    expect(out).toContain('name path=area1bot')
    expect(out).toMatch(/fill between\[of=area1top and area1bot\]/)
    expect(out).toMatch(/name path=area1top, domain=-1:1, samples=101, forget plot\] \{x\^2 - 3\}/)
    expect(out).toMatch(/name path=area1bot, domain=-1:1, samples=101, forget plot\] \{0\}/)
  })

  it('falls back to the board’s samples, with a new \\addplot at every pole', () => {
    const pole: ModelSpec = {
      id: 'p', kind: 'explicit', name: 'pole',
      evalExplicit: (_p, x) => 1 / (x - 1),
      latex: () => '', paramMeta: () => [],
    }
    const tex = toPgfplots(
      scene({ curves: [curve('p', null, pole, [])], models: { p: pole } }),
      { widthCm: 8, sources: {} },
    )
    expect(tex).toContain('% sampled from the board: a sketched curve has no typed equation')
    const plots = [...tex.matchAll(/\\addplot\[[^\]]*\] coordinates \{([^}]*)\};/g)].map((m) =>
      [...m[1].matchAll(/\(([-\d.]+),([-\d.]+)\)/g)].map((c) => [Number(c[1]), Number(c[2])]),
    )
    expect(plots.length).toBeGreaterThanOrEqual(2)
    for (const run of plots) {
      const xs = run.map((p) => p[0])
      // no run crosses the pole
      expect(Math.min(...xs) < 1 && Math.max(...xs) > 1).toBe(false)
    }
    expect(balanced(tex)).toBe(true)
  })

  it('splits a typed rational at its pole and marks its hole', () => {
    const src = 'y = (x^2 - 1)/(x - 1)'
    const r = model(src)
    const tex = toPgfplots(
      scene({ curves: [curve('r', src, r.model, r.params)], models: { r: r.model }, figure: FIGURE_STYLES.textbook }),
      { widthCm: 8, sources: { r: src } },
    )
    // two domains either side of x = 1, and an open mark at (1, 2)
    const domains = [...tex.matchAll(/(?<!to )domain=([-\d.]+):([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])
    expect(domains.length).toBe(2)
    expect(domains[0][1]).toBeLessThan(1)
    expect(domains[1][0]).toBeGreaterThan(1)
    expect(tex).toMatch(/mark=o, mark options=\{fill=white\}[^\n]*coordinates \{\(1,2\)\}/)
  })

  it('a vertical asymptote is dashed', () => {
    const src = 'y = 1/(x - 2)'
    const r = model(src)
    const tex = toPgfplots(
      scene({ curves: [curve('r', src, r.model, r.params)], models: { r: r.model }, figure: FIGURE_STYLES.ap }),
      { widthCm: 8, sources: { r: src } },
    )
    expect(tex).toMatch(/\\addplot\[[^\]]*dashed[^\]]*\] coordinates \{\(2,-5\) \(2,5\)\}/)
    expect(tex).toContain('grid=none')
    expect(tex).toContain('$O$')
  })

  it('says what it did not export', () => {
    const tex = toPgfplots(
      scene({
        caption: 'Graph of f',
        fields: [{ id: 's', f: () => 0, latex: '', color: '#000', visible: true }],
      }),
      { widthCm: 8 },
    )
    expect(tex).toContain('% not exported: the caption')
  })

  it('draws a slope field as the board’s own lattice of short segments', () => {
    const tex = toPgfplots(
      scene({ fields: [{ id: 's', f: (x: number) => x, latex: 'dy/dx = x', color: '#000', visible: true }] }),
      { widthCm: 8 },
    )
    expect(tex).not.toContain('not exported: the slope field')
    expect(tex).toContain('% slope field: dy/dx = x')
    const at = tex.indexOf('line width=0.4pt')
    const draw = tex.slice(at, tex.indexOf(';', at))
    expect(draw.match(/--/g)!.length).toBeGreaterThan(20)
  })
})
