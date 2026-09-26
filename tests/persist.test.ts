// ============================================================================
// tests/persist.test.ts — document persistence (src/core/persist.ts).
//
// Pure serialization only: no DOM, no localStorage. The storage adapter is
// exercised here through a minimal in-memory mock of the Storage interface.
//
// The stakes: this is the code that stands between a teacher and losing an
// afternoon's work, so the load path is tested against hostile input — corrupt
// JSON, truncated records, unknown versions, wrong types in every field.
// ============================================================================

import { describe, it, expect } from 'vitest'
import type { FitResult, FittedCurve, ModelSpec, Vec2 } from '../src/core/types'
import { MODELS } from '../src/core/fit/models'
import { parseExpression } from '../src/core/parse'
import {
  SCHEMA_VERSION,
  MAX_STORED_STROKE,
  boardToStored,
  createDoc,
  decimate,
  deserializeDoc,
  docFromBoard,
  emptyBoard,
  hydrateDoc,
  serializeDoc,
} from '../src/core/persist'
import type { BoardInput, DocMeta, StoredDoc } from '../src/core/persist'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function curve(over: Partial<FittedCurve> & Pick<FittedCurve, 'id' | 'modelId'>): FittedCurve {
  return {
    params: [1, 2],
    kind: 'explicit',
    domain: [-3, 3],
    color: '#4f9cf9',
    strokeWidth: 2.5,
    visible: true,
    error: 0.0123,
    ...over,
  } as FittedCurve
}

function board(over: Partial<BoardInput> = {}): BoardInput {
  return {
    curves: [],
    styles: {},
    candidates: new Map<string, FitResult[]>(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    ...over,
  }
}

const META: DocMeta = { id: 'doc1', name: 'Lesson 1', createdAt: 1000, modifiedAt: 1000 }

/** Save a live board and read it straight back, the way a reload does. */
function roundTrip(input: BoardInput, meta: DocMeta = META) {
  const doc = docFromBoard(meta, input, 2000)
  const res = deserializeDoc(serializeDoc(doc))
  expect(res.board).not.toBeNull()
  return res
}

function strokeOf(n: number, f: (t: number) => Vec2): Vec2[] {
  return Array.from({ length: n }, (_, i) => f(i / (n - 1)))
}

// ---------------------------------------------------------------------------

describe('persist — round-trip fidelity', () => {
  it('preserves every field of a plain curve exactly', () => {
    const c = curve({
      id: 'c1',
      modelId: 'poly2',
      params: [1.5, -2.25, 0.125],
      domain: [-4.5, 6.25],
      color: '#f95f62',
      strokeWidth: 4.5,
      visible: false,
      error: 0.004321,
    })
    const res = roundTrip(board({ curves: [c] }))
    expect(res.board!.curves).toHaveLength(1)
    expect(res.board!.curves[0]).toMatchObject({
      id: 'c1',
      modelId: 'poly2',
      params: [1.5, -2.25, 0.125],
      kind: 'explicit',
      domain: [-4.5, 6.25],
      color: '#f95f62',
      strokeWidth: 4.5,
      visible: false,
      error: 0.004321,
    })
    expect(res.degraded).toBe(false)
    expect(res.problems).toEqual([])
  })

  // Every root family the recogniser can produce must survive a save/load.
  const families: { modelId: string; params: number[]; kind: FittedCurve['kind'] }[] = [
    { modelId: 'line', params: [0.5, -1.25], kind: 'explicit' },
    { modelId: 'poly2', params: [1, -2, 0.5], kind: 'explicit' },
    { modelId: 'poly3', params: [0.1, 0.2, 0.3, 0.4], kind: 'explicit' },
    { modelId: 'poly4', params: [0.1, 0.2, 0.3, 0.4, 0.5], kind: 'explicit' },
    { modelId: 'sine', params: [1.25, 2.5, 0.75, -0.5], kind: 'explicit' },
    { modelId: 'gauss', params: [2, 0.5, 1.5, 0.25], kind: 'explicit' },
    { modelId: 'exp', params: [1.5, 0.75, -0.25], kind: 'explicit' },
    { modelId: 'abs', params: [1.5, -1, 2], kind: 'explicit' },
    { modelId: 'logistic', params: [3, 1.2, 0.5, -1], kind: 'explicit' },
    { modelId: 'sqrt', params: [1.5, 2, -0.5, 0.25], kind: 'explicit' },
    { modelId: 'cbrt', params: [1.25, 1.5, 0.5, -0.75], kind: 'explicit' },
    { modelId: 'power', params: [1.5, 2.25, 0.5, 0.125], kind: 'explicit' },
    { modelId: 'vline', params: [2.5], kind: 'explicit' },
    { modelId: 'circle', params: [1.5, -2.25, 3.125], kind: 'implicit' },
    { modelId: 'ellipse', params: [1, 0.25, 1.5, -0.5, 0.75, -2], kind: 'implicit' },
    { modelId: 'polarRose', params: [2.5, 3, 0.25], kind: 'polar' },
    { modelId: 'limacon', params: [1.5, 0.75], kind: 'polar' },
    { modelId: 'spiral', params: [0.5, 0.25], kind: 'polar' },
    { modelId: 'fourier', params: [0.5, -0.25, 1.5, 0.75, -0.5, 0.25, 0.125, -0.0625], kind: 'parametric' },
  ]

  for (const fam of families) {
    it(`round-trips the ${fam.modelId} family with identical params`, () => {
      const c = curve({
        id: `c-${fam.modelId}`,
        modelId: fam.modelId,
        params: fam.params,
        kind: fam.kind,
        domain: fam.kind === 'explicit' ? [-2.5, 4.75] : [0, Math.PI * 2],
      })
      const res = roundTrip(board({ curves: [c] }))
      const back = res.board!.curves[0]
      expect(back.modelId).toBe(fam.modelId)
      expect(back.params).toEqual(fam.params)
      expect(back.kind).toBe(fam.kind)
      expect(back.domain).toEqual(c.domain)
      // and the family still evaluates through the real model registry
      if (MODELS[fam.modelId]) expect(typeof MODELS[fam.modelId].latex(back.params)).toBe('string')
    })
  }

  it('keeps full double precision on params (typed exact values must not drift)', () => {
    const exact = [2 * Math.PI, Math.SQRT2, 1 / 3, 6.283185307179587]
    const res = roundTrip(board({ curves: [curve({ id: 'c1', modelId: 'sine', params: exact })] }))
    expect(res.board!.curves[0].params).toEqual(exact)
    expect(res.board!.curves[0].params[0]).toBe(2 * Math.PI)
  })

  it('round-trips styles, viewport, selection and mode', () => {
    const c = curve({ id: 'c1', modelId: 'line' })
    const res = roundTrip(
      board({
        curves: [c],
        styles: { c1: { dash: [8, 6], opacity: 0.45 } },
        viewport: { center: { x: -3.5, y: 7.25 }, pxPerUnit: 137.5 },
        selectedId: 'c1',
        mode: 'pan',
      }),
    )
    expect(res.board!.styles.c1).toEqual({ dash: [8, 6], opacity: 0.45 })
    expect(res.board!.viewport).toEqual({ center: { x: -3.5, y: 7.25 }, pxPerUnit: 137.5 })
    expect(res.board!.selectedId).toBe('c1')
    expect(res.board!.mode).toBe('pan')
  })

  // --- curve end caps ------------------------------------------------------
  //
  // 'auto' is not a value the document carries: it IS the absence of a choice,
  // the state in which the figure style answers for the end. So a style that
  // says nothing must serialise to exactly the bytes it did before end caps
  // existed — a teacher's 2024 worksheet cannot start growing new keys.

  it('round-trips a chosen cap on each end', () => {
    const res = roundTrip(
      board({
        curves: [curve({ id: 'c1', modelId: 'line' })],
        styles: { c1: { ends: { start: 'open', end: 'closed' } } },
      }),
    )
    expect(res.board!.styles.c1).toEqual({ ends: { start: 'open', end: 'closed' } })
  })

  it('carries an end cap on a curve that has no other style at all', () => {
    const res = roundTrip(
      board({
        curves: [curve({ id: 'c1', modelId: 'line' })],
        styles: { c1: { ends: { end: 'arrow' } } },
      }),
    )
    expect(res.board!.styles.c1).toEqual({ ends: { end: 'arrow' } })
  })

  it("writes no `ends` key for a curve whose ends are both 'auto'", () => {
    const doc = docFromBoard(
      META,
      board({
        curves: [curve({ id: 'c1', modelId: 'line' })],
        styles: { c1: { dash: [8, 6], ends: { start: 'auto', end: 'auto' } } },
      }),
      2000,
    )
    expect(serializeDoc(doc)).not.toContain('ends')
    const back = deserializeDoc(serializeDoc(doc))
    expect(back.board!.styles.c1).toEqual({ dash: [8, 6] })
  })

  it('serialises a document without end caps byte-for-byte as it did before', () => {
    const plain = board({
      curves: [curve({ id: 'c1', modelId: 'line' })],
      styles: { c1: { dash: [8, 6], opacity: 0.45 } },
    })
    const before = serializeDoc(docFromBoard(META, plain, 2000))
    // Read it back and write it again: a load/save cycle must not touch a byte.
    const reloaded = deserializeDoc(before)
    const after = serializeDoc(
      docFromBoard(META, { ...plain, styles: reloaded.board!.styles }, 2000),
    )
    expect(after).toBe(before)
    expect(before).not.toContain('ends')
  })

  it('drops an unknown end cap rather than guessing at it', () => {
    const doc = docFromBoard(
      META,
      board({ curves: [curve({ id: 'c1', modelId: 'line' })], styles: { c1: { opacity: 0.5 } } }),
      2000,
    )
    const raw = JSON.parse(serializeDoc(doc)) as StoredDoc
    const style = raw.board.curves[0].style as unknown as Record<string, unknown>
    style.ends = { start: 'squiggle', end: 'closed' }
    const res = deserializeDoc(JSON.stringify(raw))
    expect(res.board!.styles.c1).toEqual({ opacity: 0.5, ends: { end: 'closed' } })
  })

  it('reads an ends record that is not an object as no ends at all', () => {
    const doc = docFromBoard(
      META,
      board({ curves: [curve({ id: 'c1', modelId: 'line' })], styles: { c1: { opacity: 0.5 } } }),
      2000,
    )
    const raw = JSON.parse(serializeDoc(doc)) as StoredDoc
    const style = raw.board.curves[0].style as unknown as Record<string, unknown>
    style.ends = 'arrow'
    const res = deserializeDoc(JSON.stringify(raw))
    expect(res.board!.styles.c1).toEqual({ opacity: 0.5 })
  })

  it('round-trips the recognize() candidate list', () => {
    const cands: FitResult[] = [
      { modelId: 'sine', params: [1, 2, 0, 0], kind: 'explicit', domain: [-3, 3], error: 0.01, score: -12.5 },
      { modelId: 'poly2', params: [1, 0, 0.5], kind: 'explicit', domain: [-3, 3], error: 0.08, score: -4.25 },
    ]
    const res = roundTrip(
      board({ curves: [curve({ id: 'c1', modelId: 'sine' })], candidates: new Map([['c1', cands]]) }),
    )
    const back = res.board!.candidates.get('c1')!
    expect(back).toHaveLength(2)
    expect(back[0].modelId).toBe('sine')
    expect(back[0].params).toEqual([1, 2, 0, 0])
    expect(back[1].error).toBeCloseTo(0.08, 6)
    expect(back[1].score).toBeCloseTo(-4.25, 6)
  })

  it('drops selection that refers to a curve that no longer exists', () => {
    const res = roundTrip(board({ curves: [curve({ id: 'c1', modelId: 'line' })], selectedId: 'ghost' }))
    expect(res.board!.selectedId).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('persist — typed expressions (the closure problem)', () => {
  /** Build the live state for a typed equation the way App.addExpression does. */
  function typedBoard(source: string, modelId = 'expr_1') {
    const outcome = parseExpression(source)
    if (!outcome.ok) throw new Error(`fixture failed to parse: ${source}`)
    const spec = outcome.plot.makeModel(modelId)
    const c = curve({
      id: 'e1',
      modelId,
      params: outcome.plot.defaultParams.slice(),
      kind: outcome.plot.kind,
      domain: outcome.plot.domain,
      error: 0,
    })
    return { spec, input: board({ curves: [c], exprSources: { e1: source } }) }
  }

  function sample(spec: ModelSpec, params: number[]): number[] {
    const xs = [-2.5, -1, -0.25, 0, 0.5, 1.25, 3]
    if (spec.evalExplicit) return xs.map((x) => spec.evalExplicit!(params, x))
    if (spec.evalPolar) return xs.map((t) => spec.evalPolar!(params, t))
    if (spec.evalParametric) return xs.flatMap((t) => { const p = spec.evalParametric!(params, t); return [p.x, p.y] })
    return []
  }

  it('rebuilds a typed model that evaluates identically to the one that was saved', () => {
    const { spec, input } = typedBoard('2*sin(3*x) + 1')
    const before = sample(spec, input.curves[0].params)

    const res = roundTrip(input)
    const rebuilt = res.board!.extraModels['expr_1']
    expect(rebuilt).toBeDefined()

    const after = sample(rebuilt, res.board!.curves[0].params)
    expect(after).toHaveLength(before.length)
    after.forEach((v, i) => expect(v).toBeCloseTo(before[i], 12))
    expect(res.board!.brokenExpr).toEqual({})
    expect(res.degraded).toBe(false)
  })

  it('rebuilds typed models across kinds and keeps user-edited params', () => {
    for (const src of ['a*x^2 + b', 'r = 1 + cos(theta)', 'x^2 + y^2 = 4', 'sqrt(x) + 1']) {
      const { spec, input } = typedBoard(src, 'expr_2')
      // pretend the user dragged the sliders after typing it
      const edited = input.curves[0].params.map((p, i) => p + (i + 1) * 0.375)
      input.curves[0] = { ...input.curves[0], params: edited }
      const before = sample(spec, edited)

      const res = roundTrip(input)
      const rebuilt = res.board!.extraModels['expr_2']
      expect(rebuilt, `model missing for ${src}`).toBeDefined()
      expect(res.board!.curves[0].params).toEqual(edited)
      const after = sample(rebuilt, res.board!.curves[0].params)
      after.forEach((v, i) => {
        if (Number.isFinite(before[i])) expect(v).toBeCloseTo(before[i], 12)
      })
    }
  })

  it('keeps the source text so the equation can be shown and re-saved', () => {
    const { input } = typedBoard('2*sin(3*x) + 1')
    const res = roundTrip(input)
    expect(res.board!.exprSources.e1).toBe('2*sin(3*x) + 1')
    // and it survives a second save cycle driven by the restored state
    const again = roundTrip(
      board({ curves: res.board!.curves, exprSources: res.board!.exprSources }),
    )
    expect(again.board!.extraModels['expr_1']).toBeDefined()
  })

  it('restores the expression counter so new equations do not collide', () => {
    const { input } = typedBoard('x + 1', 'expr_7')
    input.exprSources = { e1: 'x + 1' }
    const res = roundTrip(input)
    expect(res.board!.exprCounter).toBe(7)
  })

  it('degrades an unparseable equation to a visible broken curve, keeping the card', () => {
    const doc = docFromBoard(META, board({
      curves: [curve({ id: 'e1', modelId: 'expr_1', params: [1] })],
      exprSources: { e1: 'y = ((((' },
    }))
    const res = deserializeDoc(serializeDoc(doc))
    // the curve is still there — not silently vanished
    expect(res.board!.curves).toHaveLength(1)
    expect(res.board!.curves[0].id).toBe('e1')
    // ...but flagged, with its source kept so the UI can show it
    expect(res.board!.brokenExpr.e1).toBeTruthy()
    expect(res.board!.exprSources.e1).toBe('y = ((((')
    expect(res.board!.extraModels['expr_1']).toBeUndefined()
    expect(res.degraded).toBe(true)
    expect(res.problems.join(' ')).toContain('((((')
  })

  it('a broken equation does not stop the rest of the board loading', () => {
    const doc = docFromBoard(META, board({
      curves: [
        curve({ id: 'e1', modelId: 'expr_1', params: [1] }),
        curve({ id: 'c2', modelId: 'sine', params: [1, 2, 0, 0] }),
      ],
      exprSources: { e1: '@@@ not an equation @@@' },
    }))
    const res = deserializeDoc(serializeDoc(doc))
    expect(res.board!.curves.map((c) => c.id)).toEqual(['e1', 'c2'])
    expect(res.board!.curves[1].params).toEqual([1, 2, 0, 0])
  })
})

// ---------------------------------------------------------------------------

describe('persist — hostile input never throws', () => {
  const hostile: [string, string][] = [
    ['empty string', ''],
    ['whitespace', '   '],
    ['not json', 'not json at all {{{'],
    ['truncated json', '{"version":1,"id":"a","board":{"curves":[{"id":"c1",'],
    ['json null', 'null'],
    ['json number', '42'],
    ['json string', '"hello"'],
    ['json array', '[1,2,3]'],
    ['empty object', '{}'],
    ['board is a string', '{"version":1,"board":"nope"}'],
    ['curves is an object', '{"version":1,"board":{"curves":{"a":1}}}'],
    ['null curve entries', '{"version":1,"board":{"curves":[null,null]}}'],
    ['nan-ish params', '{"version":1,"board":{"curves":[{"id":"c","modelId":"line","kind":"explicit","params":["x"]}]}}'],
    ['viewport wrong type', '{"version":1,"board":{"curves":[],"viewport":"far away"}}'],
    ['deeply nested junk', JSON.stringify({ version: 1, board: { curves: [{ a: { b: { c: [1, 2, 3] } } }] } })],
  ]

  for (const [label, blob] of hostile) {
    it(`survives ${label}`, () => {
      expect(() => deserializeDoc(blob)).not.toThrow()
      const res = deserializeDoc(blob)
      expect(res.problems.length).toBeGreaterThan(0)
      // either nothing could be salvaged, or what came back is coherent
      if (res.board) {
        expect(Array.isArray(res.board.curves)).toBe(true)
        for (const c of res.board.curves) {
          expect(c.params.every(Number.isFinite)).toBe(true)
        }
      }
    })
  }

  it('keeps the valid curves and drops only the damaged ones', () => {
    const good = curve({ id: 'good1', modelId: 'sine', params: [1, 2, 0, 0] })
    const good2 = curve({ id: 'good2', modelId: 'line', params: [1, 0] })
    const doc: unknown = {
      version: SCHEMA_VERSION,
      id: 'd',
      name: 'Mixed',
      createdAt: 1,
      modifiedAt: 2,
      board: {
        curves: [
          { id: 'bad1' }, // no modelId/kind/params
          boardToStored(board({ curves: [good] })).curves[0],
          null,
          { id: 'bad2', modelId: 'line', kind: 'nonsense', params: [1, 2] },
          boardToStored(board({ curves: [good2] })).curves[0],
          { id: 'bad3', modelId: 'line', kind: 'explicit', params: [1, Number.NaN] },
        ],
        viewport: { cx: 0, cy: 0, ppu: 60 },
        selectedId: null,
        mode: 'draw',
      },
    }
    const res = hydrateDoc(doc)
    expect(res.board!.curves.map((c) => c.id)).toEqual(['good1', 'good2'])
    expect(res.degraded).toBe(true)
    expect(res.problems.join(' ')).toMatch(/damaged/i)
  })

  it('reads a document from an unknown newer version without throwing, and says so', () => {
    const doc = docFromBoard(META, board({ curves: [curve({ id: 'c1', modelId: 'line' })] }))
    const future = { ...doc, version: SCHEMA_VERSION + 99, board: { ...doc.board, futureField: true } }
    const res = deserializeDoc(JSON.stringify(future))
    expect(res.board!.curves).toHaveLength(1)
    expect(res.degraded).toBe(true)
    expect(res.problems.join(' ')).toMatch(/newer version/i)
  })

  it('treats a missing version as an older format and upgrades it', () => {
    const doc = docFromBoard(META, board({ curves: [curve({ id: 'c1', modelId: 'line' })] }))
    const legacy = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>
    delete legacy.version
    const res = deserializeDoc(JSON.stringify(legacy))
    expect(res.board!.curves).toHaveLength(1)
    expect(res.problems.join(' ')).toMatch(/upgraded/i)
  })

  it('repairs missing per-curve fields with sane defaults', () => {
    const res = hydrateDoc({
      version: SCHEMA_VERSION,
      board: { curves: [{ id: 'c1', modelId: 'line', kind: 'explicit', params: [1, 2] }] },
    })
    const c = res.board!.curves[0]
    expect(c.color).toMatch(/^#/)
    expect(c.strokeWidth).toBeGreaterThan(0)
    expect(c.visible).toBe(true)
    expect(c.error).toBe(0)
    expect(c.domain).toBeNull()
  })

  it('clamps an absurd stored zoom into the usable range', () => {
    const res = hydrateDoc({
      version: SCHEMA_VERSION,
      board: { curves: [], viewport: { cx: 0, cy: 0, ppu: 1e300 } },
    })
    expect(res.board!.viewport.pxPerUnit).toBeLessThanOrEqual(1e9)
    expect(res.board!.viewport.pxPerUnit).toBeGreaterThan(0)
  })

  it('never lets a duplicate id create two cards for one curve', () => {
    const stored = boardToStored(board({ curves: [curve({ id: 'dup', modelId: 'line' })] })).curves[0]
    const res = hydrateDoc({
      version: SCHEMA_VERSION,
      board: { curves: [stored, { ...stored }], viewport: { cx: 0, cy: 0, ppu: 60 } },
    })
    expect(res.board!.curves).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------

describe('persist — stroke rounding and size', () => {
  it('keeps rounded coordinates within tolerance of the original', () => {
    const pts = strokeOf(60, (t) => ({ x: -3 + 6 * t + 0.000061234, y: Math.sin(t * 7) * 1.23456789 }))
    const res = roundTrip(board({ curves: [curve({ id: 'c1', modelId: 'sine', sourceStroke: pts })] }))
    const back = res.board!.curves[0].sourceStroke!
    expect(back).toHaveLength(pts.length)
    back.forEach((p, i) => {
      expect(p.x).toBeCloseTo(pts[i].x, 4)
      expect(p.y).toBeCloseTo(pts[i].y, 4)
      expect(Math.abs(p.x - pts[i].x)).toBeLessThanOrEqual(5e-5)
      expect(Math.abs(p.y - pts[i].y)).toBeLessThanOrEqual(5e-5)
    })
  })

  it('thins long strokes to the storage cap, keeping both endpoints', () => {
    const pts = strokeOf(900, (t) => ({ x: t * 10 - 5, y: Math.cos(t * 3) }))
    const thin = decimate(pts)
    expect(thin.length).toBeLessThanOrEqual(MAX_STORED_STROKE)
    expect(thin[0]).toEqual(pts[0])
    expect(thin[thin.length - 1]).toEqual(pts[pts.length - 1])

    const res = roundTrip(board({ curves: [curve({ id: 'c1', modelId: 'sine', sourceStroke: pts })] }))
    const back = res.board!.curves[0].sourceStroke!
    expect(back.length).toBeLessThanOrEqual(MAX_STORED_STROKE)
    expect(back[0].x).toBeCloseTo(pts[0].x, 4)
    expect(back[back.length - 1].x).toBeCloseTo(pts[pts.length - 1].x, 4)
  })

  it('is stable across repeated save cycles (already-thinned strokes do not shrink further)', () => {
    const pts = strokeOf(900, (t) => ({ x: t * 10 - 5, y: Math.cos(t * 3) }))
    const first = roundTrip(board({ curves: [curve({ id: 'c1', modelId: 'sine', sourceStroke: pts })] }))
    const len1 = first.board!.curves[0].sourceStroke!.length
    const second = roundTrip(board({ curves: first.board!.curves }))
    expect(second.board!.curves[0].sourceStroke!).toHaveLength(len1)
    expect(second.board!.curves[0].sourceStroke).toEqual(first.board!.curves[0].sourceStroke)
  })

  it('keeps a realistic lesson board comfortably inside a localStorage budget', () => {
    // 20 hand-drawn curves, 200 raw points each — a busy lesson page.
    const curves = Array.from({ length: 20 }, (_, i) =>
      curve({
        id: `c${i}`,
        modelId: 'sine',
        params: [1.234567, 2.345678, 0.456789, -1.5],
        sourceStroke: strokeOf(200, (t) => ({ x: -4 + 8 * t, y: Math.sin(t * 6 + i) * 2.3456789 })),
      }),
    )
    const cands: FitResult[] = Array.from({ length: 9 }, (_, k) => ({
      modelId: 'sine', params: [1, 2, 0, 0], kind: 'explicit', domain: [-4, 4], error: 0.01 * k, score: -k,
    }))
    const candidates = new Map(curves.map((c) => [c.id, cands] as const))
    const json = serializeDoc(docFromBoard(META, board({ curves, candidates })))
    // Well under the ~5MB localStorage ceiling, leaving room for many documents.
    expect(json.length).toBeLessThan(200_000)
  })
})

// ---------------------------------------------------------------------------

describe('persist — document records', () => {
  it('stamps a new document with the current schema version and timestamps', () => {
    const doc = createDoc('Lesson 2', emptyBoard(), 12345)
    expect(doc.version).toBe(SCHEMA_VERSION)
    expect(doc.name).toBe('Lesson 2')
    expect(doc.createdAt).toBe(12345)
    expect(doc.modifiedAt).toBe(12345)
    expect(doc.id).toBeTruthy()
    expect(doc.board.curves).toEqual([])
  })

  it('gives every new document a distinct id', () => {
    const ids = new Set(Array.from({ length: 200 }, () => createDoc('x', emptyBoard()).id))
    expect(ids.size).toBe(200)
  })

  it('preserves identity and creation time while advancing modifiedAt', () => {
    const doc = docFromBoard(META, board(), 9999)
    expect(doc.id).toBe('doc1')
    expect(doc.name).toBe('Lesson 1')
    expect(doc.createdAt).toBe(1000)
    expect(doc.modifiedAt).toBe(9999)
  })

  it('recovers the document name and dates through a full round-trip', () => {
    const res = roundTrip(board(), { id: 'd7', name: 'Conics', createdAt: 111, modifiedAt: 222 })
    expect(res.meta).toMatchObject({ id: 'd7', name: 'Conics', createdAt: 111 })
  })

  it('substitutes a name for a record that lost one', () => {
    const res = hydrateDoc({ version: SCHEMA_VERSION, id: 'x', board: emptyBoard() })
    expect(res.meta!.name).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// The storage adapter is browser code, but its contract — "a write that exceeds
// quota must be reported, never swallowed" — is testable against a mock.
// ---------------------------------------------------------------------------

describe('persist — quota behaviour against a mocked Storage', () => {
  class MockStorage {
    private map = new Map<string, string>()
    constructor(private budget = Infinity) {}
    get length(): number { return this.map.size }
    key(i: number): string | null { return [...this.map.keys()][i] ?? null }
    getItem(k: string): string | null { return this.map.get(k) ?? null }
    removeItem(k: string): void { this.map.delete(k) }
    clear(): void { this.map.clear() }
    setItem(k: string, v: string): void {
      const used = [...this.map.entries()].reduce(
        (n, [key, val]) => n + (key === k ? 0 : key.length + val.length), 0)
      if (used + k.length + v.length > this.budget) {
        const err = new DOMException('exceeded the quota', 'QuotaExceededError')
        throw err
      }
      this.map.set(k, v)
    }
  }

  it('throws a recognisable QuotaExceededError the adapter can catch', () => {
    const s = new MockStorage(200)
    const doc = docFromBoard(META, board({
      curves: [curve({ id: 'c1', modelId: 'sine', sourceStroke: strokeOf(200, (t) => ({ x: t, y: t })) })],
    }))
    let caught: unknown = null
    try {
      s.setItem('grapher.doc.doc1', serializeDoc(doc))
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(DOMException)
    expect((caught as DOMException).name).toBe('QuotaExceededError')
  })

  it('a document that fits is stored and reads back identically', () => {
    const s = new MockStorage(5_000_000)
    const doc = docFromBoard(META, board({ curves: [curve({ id: 'c1', modelId: 'sine' })] }))
    s.setItem('grapher.doc.doc1', serializeDoc(doc))
    const res = deserializeDoc(s.getItem('grapher.doc.doc1')!)
    expect(res.board!.curves[0].id).toBe('c1')
    expect(res.degraded).toBe(false)
  })

  it('a half-written record is detected rather than crashing the load', () => {
    const s = new MockStorage()
    const doc = docFromBoard(META, board({ curves: [curve({ id: 'c1', modelId: 'sine' })] }))
    const json = serializeDoc(doc)
    s.setItem('grapher.doc.doc1', json.slice(0, Math.floor(json.length * 0.6))) // interrupted write
    const res = deserializeDoc(s.getItem('grapher.doc.doc1')!)
    expect(res.board).toBeNull()
    expect(res.problems.join(' ')).toMatch(/corrupt/i)
  })
})
