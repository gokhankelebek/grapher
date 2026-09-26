// ============================================================================
// tests/nameLinks.test.ts — functions that use other functions, the App half.
//
//   f(x) = x^2    g(x) = 2f(x − 1) + 3    h(x) = f(g(x))    k(x) = f'(x)
//
// What the board promises about NAMES and the lines that CALL them:
//
//   - a curve's letter is stored and never shifts when curves are added,
//     removed or reordered; a typed head claims its letter;
//   - a rename rewrites every line that calls the old letter, in one patch;
//   - a line's model evaluates through the live board, so f's slider moves g;
//   - cycles, missing names and non-functions are errors in words, and a line
//     whose f was deleted comes back when f does;
//   - "Show inverse" on any function is a link whose curve follows f live;
//   - all of it survives a save and a load, and a document from before names
//     serialises byte-for-byte as it always did.
// ============================================================================

import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CurveCard } from '../src/ui/CurveCard'
import { ExprInput } from '../src/ui/ExprInput'
import type { FittedCurve, ModelSpec } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import {
  boardLetters,
  boundCalls,
  callableNames,
  createResolver,
  dependencyKeys,
  ensureCalls,
  ensureNames,
  inverseDependents,
  inverseInfo,
  inverseRange,
  inverseSpec,
  legacyNames,
  lineEnv,
  lineErrors,
  nameProblem,
  orphanNotice,
  planClaim,
  planRename,
  rewriteName,
  sliderLetters,
  type NameState,
} from '../src/ui/nameLinks'
import { curveNames } from '../src/render/curveNames'
import {
  boardToStored,
  deserializeDoc,
  docFromBoard,
  serializeDoc,
  type BoardInput,
  type CalcLink,
  type DocMeta,
  type InverseLink,
} from '../src/core/persist'

// ---------------------------------------------------------------------------
// a tiny board: typed lines with live models, and sketches
// ---------------------------------------------------------------------------

interface Board {
  curves: FittedCurve[]
  names: Record<string, string>
  calls: Record<string, string[]>
  models: Record<string, ModelSpec>
  sources: Record<string, string>
}

function curve(id: string, over: Partial<FittedCurve> = {}): FittedCurve {
  return {
    id,
    modelId: 'poly2',
    params: [0, 0, 1],
    kind: 'explicit',
    domain: null,
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
    ...over,
  }
}

function makeBoard(): Board & {
  resolve: ReturnType<typeof createResolver>
  type(id: string, src: string, name?: string): void
  set(id: string, params: number[]): void
  at(id: string, x: number): number
} {
  const b: Board = { curves: [], names: {}, calls: {}, models: { ...MODELS }, sources: {} }
  const resolve = createResolver(() => ({ curves: b.curves, names: b.names, models: b.models }))
  let n = 0
  return Object.assign(b, {
    resolve,
    /** Type a line the way the App does: decide its calls, parse with its env. */
    type(id: string, src: string, name?: string): void {
      const lineCalls = boundCalls(src, { letters: boardLetters(b.names, b.calls, name) })
      const head = /^\s*([A-Za-z])\s*\(\s*x\s*\)\s*=/.exec(src)?.[1] ?? null
      const o = parseExpression(src, lineEnv(resolve, lineCalls, head))
      if (!o.ok) throw new Error(o.error)
      const modelId = `expr_${++n}`
      b.models = { ...b.models, [modelId]: o.plot.makeModel(modelId) }
      b.curves = [
        ...b.curves.filter((c) => c.id !== id),
        curve(id, { modelId, params: o.plot.defaultParams.slice() }),
      ]
      b.sources = { ...b.sources, [id]: src }
      if (lineCalls.length > 0) b.calls = { ...b.calls, [id]: lineCalls }
      b.names = { ...b.names, [id]: name ?? head ?? '?' }
    },
    /** A slider drag: a NEW curve array, exactly as applyState makes one. */
    set(id: string, params: number[]): void {
      b.curves = b.curves.map((c) => (c.id === id ? { ...c, params } : c))
    },
    at(id: string, x: number): number {
      const c = b.curves.find((k) => k.id === id)!
      return b.models[c.modelId].evalExplicit!(c.params, x)
    },
  })
}

// ---------------------------------------------------------------------------
// names are stable
// ---------------------------------------------------------------------------

describe('ensureNames — letters are handed out once and never shift', () => {
  const src = {}

  it('hands out f, g, h in sidebar order to curves that have none', () => {
    const cs = [curve('a'), curve('b'), curve('c')]
    expect(ensureNames({}, { curves: cs, sources: src })).toEqual({ a: 'f', b: 'g', c: 'h' })
  })

  it('removing a curve does not rename the ones after it', () => {
    const cs = [curve('a'), curve('b'), curve('c')]
    const names = ensureNames({}, { curves: cs, sources: src })
    const after = ensureNames(names, { curves: [cs[0], cs[2]], sources: src })
    expect(after).toEqual({ a: 'f', c: 'h' })
    // and the freed letter is the next one handed out
    const more = ensureNames(after, { curves: [cs[0], cs[2], curve('d')], sources: src })
    expect(more.d).toBe('g')
  })

  it('reordering the sidebar changes nothing', () => {
    const cs = [curve('a'), curve('b'), curve('c')]
    const names = ensureNames({}, { curves: cs, sources: src })
    expect(ensureNames(names, { curves: [cs[2], cs[0], cs[1]], sources: src })).toBe(names)
  })

  it('returns the very same object when nothing changed (a slider frame)', () => {
    const cs = [curve('a')]
    const names = ensureNames({}, { curves: cs, sources: src })
    const moved = [{ ...cs[0], params: [1, 2, 3] }]
    expect(ensureNames(names, { curves: moved, sources: src })).toBe(names)
  })

  it('a typed head claims its letter', () => {
    const cs = [curve('a'), curve('b')]
    expect(ensureNames({}, { curves: cs, sources: { b: 'f(x) = x^2' } })).toEqual({ b: 'f', a: 'g' })
  })

  it('skips letters a line is waiting for, and reserved slider letters', () => {
    const cs = [curve('line'), curve('sk')]
    const names = ensureNames(
      { line: 'g' },
      { curves: cs, sources: {}, calls: { line: ['f'] } },
      () => ['h'],
    )
    // f is awaited by g's line, h is a slider: the sketch gets k
    expect(names.sk).toBe('k')
  })

  it('tangents, derivatives, inverses and implicit curves hold no letter', () => {
    const cs = [
      curve('a'),
      curve('tan', { modelId: 'line', params: [0, 1] }),
      curve('d'),
      curve('inv', { kind: 'parametric', modelId: 'inv_1' }),
      curve('circ', { kind: 'implicit', modelId: 'circle' }),
    ]
    const calc: CalcLink[] = [
      { kind: 'tangent', id: 't1', parentId: 'a', curveId: 'tan', x: 1 },
      { kind: 'derivative', id: 'd1', parentId: 'a', curveId: 'd' },
    ]
    const inverses: InverseLink[] = [{ id: 'i1', parentId: 'a', curveId: 'inv', from: -5, to: 5 }]
    expect(ensureNames({}, { curves: cs, sources: {}, calc, inverses })).toEqual({ a: 'f' })
  })

  it('a hidden curve keeps its letter', () => {
    const cs = [curve('a', { visible: false }), curve('b')]
    const names = ensureNames({ a: 'f' }, { curves: cs, sources: {} })
    expect(names).toEqual({ a: 'f', b: 'g' })
  })

  it('an old document seeds from the letters the board used to derive', () => {
    const cs = [curve('a'), curve('b'), curve('c', { visible: false })]
    const board = { curves: cs, sources: { b: 'f(x) = x^3' } }
    const seed = legacyNames(curveNames(cs, board.sources), board)
    expect(seed).toEqual({ a: 'g', b: 'f' })
    // and the hidden one gets a letter of its own, once
    expect(ensureNames(seed, board)).toEqual({ a: 'g', b: 'f', c: 'h' })
  })

  it('drops the calls of lines that left the board', () => {
    const cs = [curve('g')]
    const calls = { g: ['f'], gone: ['f'] }
    expect(ensureCalls(calls, cs, { g: 'g(x) = f(x)' })).toEqual({ g: ['f'] })
    const kept = { g: ['f'] }
    expect(ensureCalls(kept, cs, { g: 'g(x) = f(x)' })).toBe(kept)
  })
})

// ---------------------------------------------------------------------------
// which letters a line calls
// ---------------------------------------------------------------------------

describe('boundCalls — call or slider, decided when the line is typed', () => {
  const none = new Set<string>()

  it('f, g, h read as calls even before they exist', () => {
    expect(boundCalls('h(x) = f(g(x))', { letters: none })).toEqual(['f', 'g'])
  })

  it('a(x + 1) stays a slider times a bracket', () => {
    expect(boundCalls('y = a(x + 1)^2 + k', { letters: none })).toEqual([])
  })

  it('any letter a curve is named becomes a call', () => {
    expect(boundCalls('y = 2s(x) + 1', { letters: new Set(['s']) })).toEqual(['s'])
  })

  it('a prime makes it a call', () => {
    expect(boundCalls("y = q'(x)", { letters: none })).toEqual(['q'])
  })

  it('never the line’s own head', () => {
    expect(boundCalls('g(x) = g(x - 1) + f(x)', { letters: new Set(['g']) })).toEqual(['f'])
  })

  it('an edit keeps what the line meant: old calls stay calls, old sliders stay sliders', () => {
    expect(boundCalls('y = q(x) + h(x)', { letters: none, prevCalls: ['q'], prevSliders: new Set(['h']) })).toEqual([
      'q',
    ])
  })
})

// ---------------------------------------------------------------------------
// the env follows the board
// ---------------------------------------------------------------------------

describe('the resolver — g sees f as f is NOW', () => {
  it('g(x) = 2f(x − 1) + 3 follows f’s slider without being rebuilt', () => {
    const b = makeBoard()
    b.type('F', 'f(x) = a x^2')
    b.type('G', 'g(x) = 2f(x - 1) + 3')
    expect(b.calls.G).toEqual(['f'])
    expect(b.at('G', 3)).toBeCloseTo(2 * 4 + 3)
    const gModel = b.curves.find((c) => c.id === 'G')!.modelId
    b.set('F', [5]) // a = 5
    expect(b.curves.find((c) => c.id === 'G')!.modelId).toBe(gModel)
    expect(b.at('G', 3)).toBeCloseTo(2 * 5 * 4 + 3)
  })

  it('composition and derivatives: f(g(x)), f\'(x)', () => {
    const b = makeBoard()
    b.type('F', 'f(x) = x^2')
    b.type('G', 'g(x) = x + 1')
    b.type('H', 'h(x) = f(g(x))')
    b.type('K', "k(x) = f'(x)")
    expect(b.at('H', 2)).toBeCloseTo(9)
    expect(b.at('K', 3)).toBeCloseTo(6, 6)
  })

  it('a sketch is its fitted model, NaN off the stretch that was drawn', () => {
    const b = makeBoard()
    b.curves = [curve('S', { domain: [-2, 2] })]
    b.names = { S: 'f' }
    b.type('G', 'y = 2f(x)', 'g')
    expect(b.at('G', 1)).toBeCloseTo(2)
    expect(Number.isNaN(b.at('G', 3))).toBe(true)
  })

  it('a hidden f is still callable', () => {
    const b = makeBoard()
    b.type('F', 'f(x) = x + 10')
    b.curves = b.curves.map((c) => ({ ...c, visible: false }))
    b.type('G', 'g(x) = f(x)')
    expect(b.at('G', 1)).toBeCloseTo(11)
  })

  it('a cycle is NaN, not a stack overflow', () => {
    const b = makeBoard()
    b.type('F', 'f(x) = g(x) + 1')
    b.type('G', 'g(x) = 2f(x)')
    expect(Number.isNaN(b.at('F', 1))).toBe(true)
    expect(Number.isNaN(b.at('G', 1))).toBe(true)
  })

  it('a line cannot call itself — the parser says so', () => {
    const b = makeBoard()
    b.type('F', 'f(x) = x')
    const o = parseExpression('f(x) = f(x - 1) + 1', lineEnv(b.resolve, [], 'f'))
    expect(o.ok).toBe(false)
  })

  it('dependencyKeys move when f moves, so g’s memos do too', () => {
    const b = makeBoard()
    b.type('F', 'f(x) = a x^2')
    b.type('G', 'g(x) = 2f(x - 1) + 3')
    b.type('H', 'h(x) = g(x) + 1')
    const before = dependencyKeys(b.curves, b.names, b.calls)
    b.set('F', [3])
    const after = dependencyKeys(b.curves, b.names, b.calls)
    expect(after.G).not.toBe(before.G)
    // transitively: h calls g, g calls f
    expect(after.H).not.toBe(before.H)
    expect(after.F).toBeUndefined()
  })

  it('the equation box offers the functions of x, in sidebar order', () => {
    const cs = [curve('a'), curve('p', { kind: 'polar' }), curve('b')]
    expect(callableNames(cs, { a: 'f', p: 'g', b: 'h' })).toEqual(['f', 'h'])
  })
})

// ---------------------------------------------------------------------------
// errors, order, cycles
// ---------------------------------------------------------------------------

describe('lineErrors — what a line that cannot be drawn says', () => {
  it('"f is not defined" until f appears', () => {
    const b = makeBoard()
    b.type('H', 'h(x) = f(x) + 1')
    expect(lineErrors(b)).toEqual({ H: 'f is not defined' })
    expect(Number.isNaN(b.at('H', 2))).toBe(true)
    b.type('F', 'f(x) = x^2')
    expect(lineErrors(b)).toEqual({})
    expect(b.at('H', 2)).toBeCloseTo(5)
  })

  it('"f and g use each other" on every line of the cycle', () => {
    const b = makeBoard()
    b.type('F', 'f(x) = g(x) + 1')
    b.type('G', 'g(x) = 2f(x)')
    b.type('K', 'k(x) = g(x) + 1', 'k')
    const errs = lineErrors(b)
    expect(errs.F).toBe('f and g use each other')
    expect(errs.G).toBe('f and g use each other')
    // downstream of the cycle, but not on it
    expect(errs.K).toBe("Uses g, which can't be drawn")
  })

  it('a longer cycle is named in full', () => {
    const b = makeBoard()
    b.type('F', 'f(x) = g(x)')
    b.type('G', 'g(x) = h(x)')
    b.type('H', 'h(x) = f(x)')
    expect(lineErrors(b).G).toBe('f, g and h use each other')
  })

  it('"f is a circle — …" for a letter that is not a function of x', () => {
    const b = makeBoard()
    b.curves = [curve('C', { kind: 'implicit', modelId: 'circle', params: [0, 0, 1] })]
    b.names = { C: 'f' }
    b.calls = { G: ['f'] }
    b.curves.push(curve('G', { modelId: 'poly1', params: [0, 1] }))
    expect(lineErrors(b).G).toBe('f is a circle — only functions of x can be used as f(…)')
    b.curves[0] = { ...b.curves[0], kind: 'polar', modelId: 'rose' }
    expect(lineErrors(b).G).toBe('f is a polar curve — only functions of x can be used as f(…)')
  })

  it('downstream errors follow the dependency order', () => {
    const b = makeBoard()
    b.type('G', 'g(x) = f(x) + 1')
    b.type('H', 'h(x) = g(x) + 1')
    const errs = lineErrors(b)
    expect(errs.G).toBe('f is not defined')
    expect(errs.H).toBe("Uses g, which can't be drawn")
  })
})

// ---------------------------------------------------------------------------
// deletion and undo
// ---------------------------------------------------------------------------

describe('deleting f leaves g waiting, and undo brings both back', () => {
  it('g turns into "f is not defined", NaN, and recovers on restore', () => {
    const b = makeBoard()
    b.type('F', 'f(x) = x^2')
    b.type('G', 'g(x) = 2f(x - 1) + 3')
    const snapshot = { curves: b.curves, names: b.names, calls: b.calls }

    // delete f: the curve goes, and its letter with it
    b.curves = b.curves.filter((c) => c.id !== 'F')
    b.names = ensureNames(b.names, { curves: b.curves, sources: b.sources, calls: b.calls })
    b.calls = ensureCalls(b.calls, b.curves, b.sources)
    expect(b.names).toEqual({ G: 'g' })
    expect(b.calls).toEqual({ G: ['f'] })
    expect(lineErrors(b)).toEqual({ G: 'f is not defined' })
    expect(Number.isNaN(b.at('G', 1))).toBe(true)

    // a new sketch is NOT handed the awaited f
    const sk = ensureNames(b.names, {
      curves: [...b.curves, curve('S')],
      sources: b.sources,
      calls: b.calls,
    })
    expect(sk.S).not.toBe('f')

    // undo: the snapshot comes back, and so does g
    Object.assign(b, snapshot)
    expect(lineErrors(b)).toEqual({})
    expect(b.at('G', 1)).toBeCloseTo(3)
  })

  it('the toast says who is waiting for what', () => {
    const names = { F: 'f', G: 'g', H: 'h', K: 'k' }
    const calls = { G: ['f'], H: ['f', 'g'], K: ['f'] }
    expect(orphanNotice(['F'], names, calls)).toBe(
      'g, h and k use f — they will reappear if f comes back',
    )
    expect(orphanNotice(['F'], { F: 'f', G: 'g' }, { G: ['f'] })).toBe(
      'g uses f — it will reappear if f comes back',
    )
    expect(orphanNotice(['G'], names, { K: ['f'] })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// renaming
// ---------------------------------------------------------------------------

function nameState(b: Board, displaySources: Record<string, string> = {}): NameState {
  return { names: b.names, exprSources: b.sources, displaySources, calls: b.calls }
}

describe('rename — every line that calls the old letter follows', () => {
  it('rewrites call sites by the tokenizer, primes and heads included', () => {
    expect(rewriteName('g(x) = 2f(x - 1) + 3', 'f', 'p', { calls: true })).toBe('g(x) = 2p(x - 1) + 3')
    expect(rewriteName("k(x) = f'(x) + f''(2x)", 'f', 'p', { calls: true })).toBe(
      "k(x) = p'(x) + p''(2x)",
    )
    expect(rewriteName('  f(x) = x^2', 'f', 'p', { head: true })).toBe('  p(x) = x^2')
    // sin( and a slider product are not calls of f
    expect(rewriteName('y = sin(x) + f x', 'f', 'p', { calls: true })).toBe('y = sin(x) + f x')
  })

  it('f → p rewrites g, h and k, and p’s own head, in ONE patch', () => {
    const b = makeBoard()
    b.type('F', 'f(x) = x^2')
    b.type('G', 'g(x) = 2f(x - 1) + 3')
    b.type('H', 'h(x) = f(g(x))')
    b.type('K', "k(x) = f'(x)")
    const before = nameState(b)
    const frozen = JSON.stringify(before)
    const plan = planRename(before, 'F', 'p')
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.state.names.F).toBe('p')
    expect(plan.state.exprSources).toEqual({
      F: 'p(x) = x^2',
      G: 'g(x) = 2p(x - 1) + 3',
      H: 'h(x) = p(g(x))',
      K: "k(x) = p'(x)",
    })
    expect(plan.state.calls).toEqual({ G: ['p'], H: ['p', 'g'], K: ['p'] })
    expect(plan.rewritten.sort()).toEqual(['F', 'G', 'H', 'K'])
    // Undo is one step: the state the rename started from is untouched, so the
    // snapshot taken before the commit restores the letter AND every line.
    expect(JSON.stringify(before)).toBe(frozen)
  })

  it('the rewritten lines still mean the same curve', () => {
    const b = makeBoard()
    b.type('F', 'f(x) = x^2')
    b.type('G', 'g(x) = 2f(x - 1) + 3')
    const plan = planRename(nameState(b), 'F', 'p')
    if ('error' in plan) throw new Error(plan.error)
    b.names = plan.state.names
    b.calls = plan.state.calls
    b.type('G', plan.state.exprSources.G, 'g')
    expect(b.at('G', 3)).toBeCloseTo(11)
  })

  it('refuses built-ins, taken letters, sliders and non-letters', () => {
    const b = makeBoard()
    b.type('F', 'f(x) = x^2')
    b.type('G', 'g(x) = f(x)')
    const st = nameState(b)
    expect(planRename(st, 'F', 'x')).toHaveProperty('error')
    expect(planRename(st, 'F', 'r')).toHaveProperty('error')
    expect(planRename(st, 'F', 'g')).toEqual({ error: 'g is already the name of another curve.' })
    expect(planRename(st, 'F', 'a', new Set(['a']))).toEqual({
      error: 'a is a slider on this board — pick another letter.',
    })
    expect(planRename(st, 'F', 'ff')).toHaveProperty('error')
    expect(nameProblem('q')).toBeNull()
  })

  it('renaming to its own letter is no change at all', () => {
    const b = makeBoard()
    b.type('F', 'f(x) = x^2')
    const st = nameState(b)
    const plan = planRename(st, 'F', 'f')
    expect('error' in plan ? null : plan.state).toBe(st)
  })
})

describe('a typed head claims its letter', () => {
  it('moves a curve that only had the letter automatically, with its callers', () => {
    // a sketch was f automatically; y = 2f(x) calls it; now f(x) = x^2 is typed
    const st: NameState = {
      names: { S: 'f', L: 'g' },
      exprSources: { L: 'y = 2f(x)', N: 'f(x) = x^2' },
      displaySources: {},
      calls: { L: ['f'] },
    }
    const claim = planClaim(st, 'N', 'f')
    if ('error' in claim) throw new Error(claim.error)
    expect(claim.state.names).toEqual({ S: 'h', L: 'g', N: 'f' })
    expect(claim.state.exprSources.L).toBe('y = 2h(x)')
    expect(claim.state.calls.L).toEqual(['h'])
    expect(claim.displaced).toEqual({ id: 'S', from: 'f', to: 'h' })
  })

  it('refuses a second definition of the same letter', () => {
    const st: NameState = {
      names: { A: 'f' },
      exprSources: { A: 'f(x) = x', N: 'f(x) = x^2' },
      displaySources: {},
      calls: {},
    }
    expect(planClaim(st, 'N', 'f')).toHaveProperty('error')
  })

  it('a retyped head renames, callers included', () => {
    const st: NameState = {
      names: { G: 'g', K: 'k' },
      exprSources: { G: 'p(x) = x + 1', K: 'k(x) = g(x)^2' },
      displaySources: {},
      calls: { K: ['g'] },
    }
    const claim = planClaim(st, 'G', 'p')
    if ('error' in claim) throw new Error(claim.error)
    expect(claim.state.names.G).toBe('p')
    expect(claim.state.exprSources.K).toBe('k(x) = p(x)^2')
  })
})

// ---------------------------------------------------------------------------
// sliders are reserved
// ---------------------------------------------------------------------------

describe('sliderLetters', () => {
  it('lists the single-letter sliders of typed lines', () => {
    const o = parseExpression('y = a(x - h)^2 + k')
    if (!o.ok) throw new Error(o.error)
    const models = { ...MODELS, e1: o.plot.makeModel('e1') }
    const cs = [curve('T', { modelId: 'e1', params: o.plot.defaultParams.slice() }), curve('S')]
    expect([...sliderLetters(cs, { T: 'y = a(x - h)^2 + k' }, models)].sort()).toEqual(['a', 'h', 'k'])
  })
})

// ---------------------------------------------------------------------------
// inverses
// ---------------------------------------------------------------------------

describe('Show inverse on any function', () => {
  it('x² fails the horizontal line test, x³ passes', () => {
    const sq = curve('F')
    const info = inverseInfo(sq, MODELS, { from: -6, to: 6 }, 'f')
    expect(info.oneToOne).toBe(false)
    expect(info.sentence).toBe('f fails the horizontal line test — restrict its domain to x ≥ 0')
    const cube = curve('C', { modelId: 'poly3', params: [0, 0, 0, 1] })
    const ok = inverseInfo(cube, MODELS, { from: -6, to: 6 }, 'g')
    expect(ok.sentence).toBe('g is one-to-one, so its inverse is a function')
  })

  it('the inverse curve reads its parent live: (f(t), t)', () => {
    let curves = [curve('F')]
    const spec = inverseSpec('inv_1', 'F', () => ({ curves, models: MODELS }), () => 'x = y^{2}')
    expect(spec.kind).toBe('parametric')
    expect(spec.evalParametric!([], 3)).toEqual({ x: 9, y: 3 })
    curves = [{ ...curves[0], params: [1, 0, 1] }] // f = x² + 1
    expect(spec.evalParametric!([], 3)).toEqual({ x: 10, y: 3 })
    curves = [] // parent deleted
    expect(Number.isNaN(spec.evalParametric!([], 3).x)).toBe(true)
  })

  it('reflects the sketch it was drawn from, or three windows of a typed line', () => {
    expect(inverseRange(curve('S', { domain: [2, -1] }), [-10, 10])).toEqual([-1, 2])
    expect(inverseRange(curve('F'), [-4, 6])).toEqual([-14, 16])
  })

  it('goes with its parent, and with itself', () => {
    const links: InverseLink[] = [
      { id: 'i1', parentId: 'F', curveId: 'FI', from: -5, to: 5 },
      { id: 'i2', parentId: 'G', curveId: 'GI', from: -5, to: 5 },
    ]
    expect(inverseDependents(links, new Set(['F']))).toEqual({
      linkIds: new Set(['i1']),
      curveIds: new Set(['FI']),
    })
    expect(inverseDependents(links, new Set(['GI'])).linkIds).toEqual(new Set(['i2']))
  })

  it('is called f⁻¹, after its parent’s stored letter', () => {
    const cs = [curve('F'), curve('FI', { kind: 'parametric', modelId: 'inv_i1' })]
    const names = curveNames(cs, {}, [], { F: 'p' }, [{ parentId: 'F', curveId: 'FI' }])
    expect(names).toEqual({ F: 'p', FI: 'p⁻¹' })
  })
})

describe('curveNames reads the stored letters', () => {
  it('a stored name wins over sidebar order, and f′ follows it', () => {
    const cs = [curve('a'), curve('b'), curve('d')]
    const links: CalcLink[] = [{ kind: 'derivative', id: 'l', parentId: 'b', curveId: 'd' }]
    expect(curveNames(cs, {}, links, { a: 'q', b: 'f' })).toEqual({ a: 'q', b: 'f', d: 'f′' })
  })
})

// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------

const META: DocMeta = { id: 'doc1', name: 'Functions', createdAt: 1000, modifiedAt: 1000 }

function typedCurve(id: string, src: string, calls: string[] = [], head?: string): {
  curve: FittedCurve
  src: string
} {
  const o = parseExpression(
    src,
    calls.length > 0 || head
      ? { has: (n) => calls.includes(n) || n === head, eval: () => Number.NaN }
      : undefined,
  )
  if (!o.ok) throw new Error(o.error)
  return { curve: curve(id, { modelId: `expr_${id}`, params: o.plot.defaultParams.slice() }), src }
}

function input(over: Partial<BoardInput> = {}): BoardInput {
  return {
    curves: [curve('a')],
    styles: {},
    candidates: new Map(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    ...over,
  }
}

describe('names, calls and inverses in the document', () => {
  it('a board without them writes exactly the bytes it always did', () => {
    const plain = serializeDoc(docFromBoard(META, input(), 2000))
    const empty = serializeDoc(
      docFromBoard(META, input({ names: {}, calls: {}, inverses: [] }), 2000),
    )
    expect(empty).toBe(plain)
    // The bytes a document from before names were stored always had.
    expect(plain).toBe(
      '{"version":2,"id":"doc1","name":"Functions","createdAt":1000,"modifiedAt":2000,"board":{"curves":[{"id":"a","modelId":"poly2","params":[0,0,1],"kind":"explicit","domain":null,"color":"#4f9cf9","strokeWidth":2.5,"visible":true,"error":0}],"viewport":{"cx":0,"cy":0,"ppu":60},"selectedId":null,"mode":"draw"}}',
    )
  })

  it('an old document loads with no stored names and nothing to report', () => {
    const back = deserializeDoc(serializeDoc(docFromBoard(META, input(), 2000)))
    expect(back.board?.names).toEqual({})
    expect(back.board?.calls).toEqual({})
    expect(back.board?.inverses).toEqual([])
    expect(back.problems).toEqual([])
  })

  it('round-trips f, g = 2f(x − 1) + 3 and k = f\'(x), live', () => {
    const f = typedCurve('F', 'f(x) = x^2', [], 'f')
    const g = typedCurve('G', 'g(x) = 2f(x - 1) + 3', ['f'], 'g')
    const k = typedCurve('K', "k(x) = f'(x)", ['f'], 'k')
    const sk = curve('S', { domain: [-1, 1] })
    const doc = docFromBoard(
      META,
      input({
        curves: [f.curve, g.curve, k.curve, sk],
        exprSources: { F: f.src, G: g.src, K: k.src },
        names: { F: 'f', G: 'g', K: 'k', S: 's' },
        calls: { G: ['f'], K: ['f'] },
      }),
      2000,
    )
    const stored = boardToStored(
      input({
        curves: [f.curve, g.curve],
        exprSources: { F: f.src, G: g.src },
        names: { F: 'f', G: 'g' },
        calls: { G: ['f'] },
      }),
    )
    expect(stored.curves[1]).toMatchObject({ name: 'g', calls: ['f'] })
    // a curve that calls nothing writes no calls key
    expect(stored.curves[0].calls).toBeUndefined()

    const back = deserializeDoc(serializeDoc(doc))
    expect(back.problems).toEqual([])
    const bd = back.board!
    expect(bd.names).toEqual({ F: 'f', G: 'g', K: 'k', S: 's' })
    expect(bd.calls).toEqual({ G: ['f'], K: ['f'] })
    // No brokenExpr: k = f'(x) is only an equation WITH its calls.
    expect(bd.brokenExpr).toEqual({})
    const ev = (id: string, x: number): number => {
      const c = bd.curves.find((q) => q.id === id)!
      return bd.extraModels[c.modelId].evalExplicit!(c.params, x)
    }
    expect(ev('G', 3)).toBeCloseTo(11)
    expect(ev('K', 3)).toBeCloseTo(6, 6)
  })

  it('a load given the board’s resolver builds models that read it live', () => {
    const f = typedCurve('F', 'f(x) = x^2', [], 'f')
    const g = typedCurve('G', 'g(x) = 2f(x - 1) + 3', ['f'], 'g')
    const json = serializeDoc(
      docFromBoard(
        META,
        input({
          curves: [f.curve, g.curve],
          exprSources: { F: f.src, G: g.src },
          names: { F: 'f', G: 'g' },
          calls: { G: ['f'] },
        }),
        2000,
      ),
    )
    let fValue = 1
    const back = deserializeDoc(json, { resolve: (n) => (n === 'f' ? fValue : Number.NaN) })
    const gc = back.board!.curves.find((c) => c.id === 'G')!
    const gm = back.board!.extraModels[gc.modelId]
    expect(gm.evalExplicit!(gc.params, 0)).toBeCloseTo(5)
    fValue = 10
    expect(gm.evalExplicit!(gc.params, 0)).toBeCloseTo(23)
  })

  it('inverse links round-trip; an inverse whose parent is gone goes too', () => {
    const inv = curve('FI', { kind: 'parametric', modelId: 'inv_i1', params: [], domain: [-5, 5] })
    const link: InverseLink = { id: 'i1', parentId: 'a', curveId: 'FI', from: -5, to: 5 }
    const json = serializeDoc(
      docFromBoard(META, input({ curves: [curve('a'), inv], inverses: [link], names: { a: 'f' } }), 2000),
    )
    expect(json).toContain('"inverses"')
    const back = deserializeDoc(json)
    expect(back.board?.inverses).toEqual([link])
    expect(back.problems).toEqual([])

    // the parent was lost: the link AND its curve go, loudly
    const orphan = JSON.parse(json)
    orphan.board.curves = orphan.board.curves.filter((c: { id: string }) => c.id !== 'a')
    const lost = deserializeDoc(JSON.stringify(orphan))
    expect(lost.board?.inverses).toEqual([])
    expect(lost.board?.curves.map((c) => c.id)).toEqual([])
    expect(lost.problems.length).toBeGreaterThan(0)
  })

  it('two curves claiming one letter: the second loses it', () => {
    const json = serializeDoc(
      docFromBoard(META, input({ curves: [curve('a'), curve('b')], names: { a: 'f', b: 'f' } }), 2000),
    )
    expect(deserializeDoc(json).board?.names).toEqual({ a: 'f' })
  })
})

// ---------------------------------------------------------------------------
// the card
// ---------------------------------------------------------------------------

const NOOP = (): void => {}

function renderCard(c: FittedCurve, over: Record<string, unknown> = {}): string {
  const props = {
    curve: c,
    models: MODELS,
    selected: false,
    candidates: [],
    snapMask: null,
    snapKey: 0,
    shaking: false,
    edited: false,
    analysis: [],
    onAnalysisHover: NOOP,
    onFeatureEdit: () => false,
    onSelect: NOOP,
    onDelete: NOOP,
    onDuplicate: NOOP,
    onToggleVisible: NOOP,
    onCycleColor: NOOP,
    onParamChange: NOOP,
    onParamEditStart: NOOP,
    onParamEditEnd: NOOP,
    onParamCommit: NOOP,
    onParamSetExact: NOOP,
    onApplyCandidate: NOOP,
    onEquationCommit: () => null,
    onStrokeWidth: NOOP,
    onDash: NOOP,
    onEnds: NOOP,
    onOpacity: NOOP,
    onAddCalc: NOOP,
    onAddAreaBetween: NOOP,
    onCalcChange: NOOP,
    onCalcRemove: NOOP,
    ...over,
  }
  return renderToStaticMarkup(
    createElement(CurveCard, props as unknown as Parameters<typeof CurveCard>[0]),
  )
}

describe('the card says who it is and why it is not drawn', () => {
  it('a stored name is a rename button; f⁻¹ is read-only', () => {
    const own = renderCard(curve('F'), { name: 'f', nameEditable: true, onRename: () => null })
    expect(own).toContain('name-chip-btn')
    expect(own).toMatch(/>f<\/button>/)
    const inv = renderCard(curve('FI'), { name: 'f⁻¹' })
    expect(inv).not.toContain('name-chip-btn')
    expect(inv).toContain('>f⁻¹</span>')
  })

  it('an error line in the broken state, and a note', () => {
    const html = renderCard(curve('G'), { name: 'g', linkError: 'p is not defined' })
    expect(html).toContain('card-broken-state')
    expect(html).toContain('p is not defined')
    const note = renderCard(curve('FI'), { note: 'f is one-to-one, so its inverse is a function' })
    expect(note).toContain('card-note')
    expect(note).toContain('one-to-one')
  })

  it('the equation box offers the board’s names', () => {
    const html = renderToStaticMarkup(
      createElement(ExprInput, { onSubmit: () => null, onClose: NOOP, names: ['f', 'g', 'h'] }),
    )
    expect(html).toContain('expr-names')
    expect(html.match(/expr-name-chip/g)).toHaveLength(3)
    const none = renderToStaticMarkup(createElement(ExprInput, { onSubmit: () => null, onClose: NOOP }))
    expect(none).not.toContain('expr-names')
  })
})
