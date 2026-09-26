// ============================================================================
// tests/seqLinks.test.ts — the App's half of sequences and series.
//
// The mathematics (parsing, terms, classification, series, partner) is tested
// beside core. What is tested HERE is what a teacher touches: which lines the
// equation box routes to the sequence parser (and which it must NEVER steal
// from the curves), the letters a sequence answers to, the dots and rings on
// the board, the dashed partner, the frame "Zoom to terms" asks for, the
// builder's lines, persistence (old documents byte-for-byte unchanged), and
// the card's markup.
// ============================================================================

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FitResult, FittedCurve } from '../src/core/types'
import {
  deserializeDoc,
  docFromBoard,
  serializeDoc,
  sequenceToStored,
  storedToSequence,
} from '../src/core/persist'
import type { BoardInput, BoardSequence, DocMeta, StoredDoc } from '../src/core/persist'
import {
  blankSeqDraft,
  compileSequence,
  compileSequences,
  curveNameClash,
  defaultWindow,
  draftSource,
  draftWindow,
  fibonacciDraft,
  headLetter,
  isTermList,
  looksLikeSequence,
  nextSequenceLetter,
  partnerPolylines,
  readSequence,
  renameSequenceSrc,
  seqName,
  seqPreview,
  sequenceBox,
  sequenceCard,
  sequenceError,
  sequenceLegend,
  sequenceLetters,
  sequenceNameClash,
  sequenceScatter,
  subscript,
  sumsSetId,
  termText,
} from '../src/ui/seqLinks'
import { SequenceCard } from '../src/ui/SequenceCard'
import { SequenceEditor } from '../src/ui/SequenceEditor'
import { BuildMenu } from '../src/ui/BuildMenu'

function sq(over: Partial<BoardSequence> = {}): BoardSequence {
  return {
    id: 'S1',
    src: 'a_n = 3 + 4(n - 1)',
    color: '#4f9cf9',
    visible: true,
    n0: 1,
    count: 10,
    showPartner: false,
    showSums: false,
    params: [],
    ...over,
  }
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

function curve(over: Partial<FittedCurve> = {}): FittedCurve {
  return {
    id: 'c1',
    modelId: 'expr_1',
    params: [],
    kind: 'explicit',
    domain: null,
    color: '#f97316',
    strokeWidth: 2.5,
    visible: true,
    error: 0,
    ...over,
  }
}

const META: DocMeta = { id: 'doc1', name: 'Lesson 1', createdAt: 1000, modifiedAt: 1000 }

const GEO = 'b_1 = 10, b_(n+1) = 0.5b_n'

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

describe('the equation box routes sequence lines here first', () => {
  it('takes explicit, recursive, function-notation and Unicode heads', () => {
    for (const src of [
      'a_n = 3 + 4(n - 1)',
      'a_{n} = n^2',
      'a(n) = 5(0.8)^(n-1)',
      'a_1 = 3, a_(n+1) = a_n + 4',
      'b_1 = 10, b_(n+1) = 0.5b_n',
      'a_0 = 1, a_(n+1) = 2a_n + 1',
      'a_1 = a_2 = 1, a_(n+2) = a_(n+1) + a_n',
      'a(1) = 3, a(n+1) = a(n) + 4',
      'u_k = 2k',
      'aₙ = 2n',
      'a_n = 3 +',
    ]) {
      expect(looksLikeSequence(src), src).toBe(true)
    }
  })

  it('takes a bare list of three or more numbers, with or without …', () => {
    expect(looksLikeSequence('3, 7, 11, 15')).toBe(true)
    expect(looksLikeSequence('2, 6, 18, 54')).toBe(true)
    expect(looksLikeSequence('1, 1/2, 1/4, …')).toBe(true)
    expect(looksLikeSequence('-1, 2, −4, ...')).toBe(true)
    expect(isTermList('3, 7, 11')).toBe(true)
  })

  it('never takes a bare pair: two numbers are a point, not a sequence', () => {
    expect(looksLikeSequence('1, 2')).toBe(false)
    expect(looksLikeSequence('3, 7, …')).toBe(false)
    expect(looksLikeSequence('(1, 2)')).toBe(false)
  })

  it('never steals a curve: a line with y = or f(x) = is a curve whatever follows', () => {
    for (const src of [
      'y = a(n+1)',
      'y = a_n',
      'f(x) = a(n + 1)',
      'g(x) = 2f(x - 1)',
      'r(θ) = 2cos(3θ)',
      'y = 2sin(3x) + 1',
      'x = 3',
      'y_1 = x^2',
      'a(x + 1)^2',
      'log_2(x)',
      'dy/dx = x - y',
      'ABC = (0,0) (4,0) (4,3)',
      '(1, 2)',
      'x^2 + y^2 = 9',
    ]) {
      expect(looksLikeSequence(src), src).toBe(false)
    }
  })

  it('reads a head letter without the parser, and a list is called a', () => {
    expect(headLetter('b_n = 2n')).toBe('b')
    expect(headLetter('u(n) = n')).toBe('u')
    expect(headLetter('3, 7, 11')).toBe('a')
    expect(headLetter('y = x')).toBeNull()
  })

  it('positions the parser’s complaint', () => {
    const p = readSequence('a_n = 3 +')
    expect(p.ok).toBe(false)
    expect(sequenceError(p)).toMatch(/position \d+/)
  })
})

// ---------------------------------------------------------------------------
// Letters
// ---------------------------------------------------------------------------

describe('a sequence answers to its own letter, apart from the curves', () => {
  it('names itself by its head letter; a list by the letter the board gave it', () => {
    expect(seqName(sq())).toBe('a')
    expect(seqName(sq({ src: GEO }))).toBe('b')
    expect(seqName(sq({ src: '2, 6, 18, 54', name: 'c' }))).toBe('c')
    expect(sequenceLetters([sq(), sq({ id: 'S2', src: GEO })])).toEqual(new Set(['a', 'b']))
  })

  it('refuses a letter a curve holds, and one another sequence holds', () => {
    expect(sequenceNameClash('f', ['f', 'g'], [])).toMatch(/f is the name of a curve/)
    expect(sequenceNameClash('a', [], ['a'])).toMatch(/already a sequence a/)
    expect(sequenceNameClash('a', ['f'], ['b'])).toBeNull()
    // and a curve refuses a sequence's letter
    expect(curveNameClash('a', new Set(['a']))).toMatch(/a is a sequence/)
    expect(curveNameClash('f', new Set(['a']))).toBeNull()
    expect(curveNameClash(null, new Set(['a']))).toBeNull()
  })

  it('offers the next free letter, skipping curve names and sequences', () => {
    expect(nextSequenceLetter([])).toBe('a')
    expect(nextSequenceLetter(['a', 'b', 'f'])).toBe('c')
  })

  it('renames only the sequence’s own letter in its line', () => {
    expect(renameSequenceSrc(GEO, 'b', 'c')).toBe('c_1 = 10, c_(n+1) = 0.5c_n')
    expect(renameSequenceSrc('a(n) = a(n - 1) + 2', 'a', 'u')).toBe('u(n) = u(n - 1) + 2')
    // the slider d in d(n − 1) is untouched
    expect(renameSequenceSrc('b_n = 3 + d(n - 1)', 'b', 'c')).toBe('c_n = 3 + d(n - 1)')
  })
})

// ---------------------------------------------------------------------------
// Compiling, the card's data
// ---------------------------------------------------------------------------

describe('a sequence is worked out from its line', () => {
  it('evaluates the window and the partial sums', () => {
    const c = compileSequence(sq())
    expect(c.error).toBeNull()
    expect(c.ns).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(c.values.slice(0, 4)).toEqual([3, 7, 11, 15])
    expect(c.sums[9]).toBe(210)
  })

  it('classifies arithmetic, with both formulas and the partner', () => {
    const card = sequenceCard(sq(), compileSequence(sq()))
    expect(card.classText).toBe('arithmetic, d = 4')
    expect(card.explicit).toBe('aₙ = 3 + 4(n − 1)')
    expect(card.recursive).toBe('a₁ = 3, aₙ₊₁ = aₙ + 4')
    expect(card.classLine).toBe('arithmetic, d = 4 · aₙ = 3 + 4(n − 1) · a₁ = 3, aₙ₊₁ = aₙ + 4')
    expect(card.seriesLine).toMatch(/^S₁₀ = 210/)
    expect(card.seriesLine).toMatch(/diverges/)
    expect(card.partner).toBe('y = 4x - 1')
  })

  it('classifies a geometric recursion in its own letter, with Σ = 20', () => {
    const q = sq({ src: GEO })
    const card = sequenceCard(q, compileSequence(q))
    expect(card.name).toBe('b')
    expect(card.classText).toBe('geometric, r = 1/2')
    expect(card.explicit).toMatch(/^bₙ = /)
    expect(card.recursive).toMatch(/^b₁ = 10/)
    expect(card.seriesLine).toMatch(/Σ = .*20 \(\|r\| < 1\)/)
  })

  it('reads a pasted list as geometric r = 3, with no infinite sum claimed', () => {
    const q = sq({ src: '2, 6, 18, 54', name: 'c' })
    const w = defaultWindow((readSequence(q.src) as { ok: true; seq: never }).seq, [])
    expect(w).toEqual({ n0: 1, count: 4 })
    const c = compileSequence({ ...q, count: 4 })
    const card = sequenceCard({ ...q, count: 4 }, c)
    expect(card.name).toBe('c')
    expect(card.classText).toBe('geometric, r = 3')
    expect(card.explicit).toMatch(/^cₙ = /)
    expect(card.seriesLine).toBe('S₄ = 80')
  })

  it('says neither for Fibonacci, and still lists its terms', () => {
    const q = sq({ src: 'a_1 = 1, a_2 = 1, a_(n+2) = a_(n+1) + a_n' })
    const card = sequenceCard(q, compileSequence(q))
    expect(card.rows.slice(0, 6).map((r) => r.aText)).toEqual(['1', '1', '2', '3', '5', '8'])
    expect(card.classText).toBe('neither arithmetic nor geometric')
    expect(card.hasPartner).toBe(false)
  })

  it('prints terms exactly where exact.ts knows them', () => {
    expect(termText(3)).toBe('3')
    expect(termText(-4)).toBe('−4')
    expect(termText(0.5)).toBe('1/2')
    expect(termText(1 / 3)).toBe('1/3')
    expect(termText(Math.SQRT2)).toBe('√2')
    expect(termText(Number.NaN)).toBe('—')
  })

  it('keeps a line that no longer parses, and says why', () => {
    const q = sq({ src: 'a_n = 3 +' })
    const c = compileSequence(q)
    expect(c.seq).toBeNull()
    expect(c.error).toMatch(/position/)
    expect(sequenceScatter([q], compileSequences([q]))).toEqual([])
  })

  it('runs its sliders', () => {
    const q = sq({ src: 'a_n = a + d(n - 1)', params: [2, 5] })
    const c = compileSequence(q)
    expect(c.values.slice(0, 3)).toEqual([2, 7, 12])
    const card = sequenceCard(q, c)
    expect(card.params.map((p) => p.name)).toEqual(['a', 'd'])
  })
})

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

describe('the dots, the rings and the dashed partner', () => {
  it('draws (n, aₙ) as dots, and (n, Sₙ) as rings when asked', () => {
    const q = sq({ src: GEO, showSums: true })
    const sets = sequenceScatter([q], compileSequences([q]))
    expect(sets).toHaveLength(2)
    const [dots, rings] = sets
    expect(dots).toMatchObject({ id: 'S1', color: '#4f9cf9', visible: true })
    expect(dots.marker).toBeUndefined()
    expect(dots.xs.slice(0, 3)).toEqual([1, 2, 3])
    expect(dots.ys.slice(0, 3)).toEqual([10, 5, 2.5])
    expect(rings).toMatchObject({ id: sumsSetId('S1'), marker: 'ring' })
    expect(rings.ys.slice(0, 3)).toEqual([10, 15, 17.5])
    // approaching 20, never past it
    expect(rings.ys[9]).toBeLessThan(20)
    expect(rings.ys[9]).toBeGreaterThan(19.9)
    // no rings without the toggle; a hidden sequence hides both
    expect(sequenceScatter([{ ...q, showSums: false }], compileSequences([q]))).toHaveLength(1)
    const hidden = sequenceScatter([{ ...q, visible: false }], compileSequences([q]))
    expect(hidden.every((s) => s.visible === false)).toBe(true)
  })

  it('draws the partner dashed through the dots, only when toggled on', () => {
    const q = sq()
    const off = partnerPolylines([q], compileSequences([q]), [-10, 10])
    expect(off).toEqual([])
    const on = { ...q, showPartner: true }
    const [line] = partnerPolylines([on], compileSequences([on]), [-10, 10])
    expect(line.id).toBe('partner:S1')
    expect(line.dash && line.dash.length).toBeGreaterThan(0)
    expect(line.color).toBe('#4f9cf9')
    // y = 4x − 1 through (1, 3) and (2, 7)
    for (const p of line.pts) expect(p.y).toBeCloseTo(4 * p.x - 1, 9)
    // not for a hidden sequence
    expect(partnerPolylines([{ ...on, visible: false }], compileSequences([on]), [-10, 10])).toEqual([])
  })

  it('draws the geometric partner as its exponential', () => {
    const q = sq({ src: GEO, showPartner: true })
    const [line] = partnerPolylines([q], compileSequences([q]), [0, 10], 10)
    for (const p of line.pts) expect(p.y).toBeCloseTo(10 * Math.pow(0.5, p.x - 1), 9)
  })

  it('frames the terms, the rings when shown, and the axis they approach', () => {
    const q = sq({ src: GEO })
    const box = sequenceBox(q, compileSequence(q))!
    expect(box.min.x).toBeLessThan(1)
    expect(box.max.x).toBeGreaterThan(10)
    expect(box.min.y).toBeLessThanOrEqual(0)
    expect(box.max.y).toBeGreaterThanOrEqual(10)
    const withSums = sequenceBox({ ...q, showSums: true }, compileSequence(q))!
    expect(withSums.max.y).toBeGreaterThan(19.9)
    expect(sequenceBox(sq({ src: 'a_n = 3 +' }), compileSequence(sq({ src: 'a_n = 3 +' })))).toBeNull()
  })

  it('names each visible sequence in the presentation legend', () => {
    const qs = [sq(), sq({ id: 'S2', src: GEO, visible: false })]
    const legend = sequenceLegend(qs, compileSequences(qs))
    expect(legend.map((l) => l.id)).toEqual(['S1'])
    expect(legend[0].tex).toContain('a_{n}')
  })
})

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

describe('Build ▾ → Sequence writes the line the equation box would take', () => {
  it('arithmetic and geometric, explicit or recursive', () => {
    const d = blankSeqDraft('a')
    expect(draftSource(d).src).toBe('a_n = 3 + 4(n - 1)')
    expect(draftSource({ ...d, form: 'recursive' }).src).toBe('a_1 = 3, a_(n+1) = a_n + 4')
    expect(draftSource({ ...d, tab: 'geometric', a1: '10', step: '0.5' }).src).toBe('a_n = 10(0.5)^(n - 1)')
  })

  it('explicit, recursive (one or two terms back) and a list', () => {
    const d = blankSeqDraft('b')
    expect(draftSource({ ...d, tab: 'explicit', formula: 'n^2' }).src).toBe('b_n = n^2')
    expect(draftSource({ ...d, tab: 'recursive', r1: '3', rule: 'b_n + 4' }).src).toBe('b_1 = 3, b_(n+1) = b_n + 4')
    const fib = fibonacciDraft(d)
    expect(fib.tab).toBe('recursive')
    expect(draftSource(fib).src).toBe('b_1 = 1, b_2 = 1, b_(n+2) = b_(n+1) + b_n')
    expect(readSequence(draftSource(fib).src!).ok).toBe(true)
    expect(draftSource({ ...d, tab: 'list', list: '3, 7, 11, 15' }).src).toBe('3, 7, 11, 15')
    expect(draftSource({ ...d, tab: 'list', list: '3, 7' }).error).toMatch(/three terms/)
  })

  it('checks the window and previews the card', () => {
    expect(draftWindow({ ...blankSeqDraft(), from: '1', to: '10' })).toEqual({ n0: 1, count: 10 })
    expect(draftWindow({ ...blankSeqDraft(), from: '5', to: '2' })).toEqual({ error: expect.stringMatching(/end after/) })
    const pv = seqPreview(blankSeqDraft('a'))
    expect(pv.error).toBeNull()
    expect(pv.card?.classText).toBe('arithmetic, d = 4')
    expect(pv.card?.rows.slice(0, 3).map((r) => r.aText)).toEqual(['3', '7', '11'])
  })

  it('renders every tab, and Build ▾ lists Sequence', () => {
    for (const tab of ['arithmetic', 'geometric', 'explicit', 'recursive', 'list'] as const) {
      const html = renderToStaticMarkup(
        createElement(SequenceEditor, { onBuild: () => null, onClose: () => {}, initial: { ...blankSeqDraft(), tab } }),
      )
      expect(html).toContain(`data-testid="seq-tab-${tab}"`)
    }
    const fib = renderToStaticMarkup(
      createElement(SequenceEditor, { onBuild: () => null, onClose: () => {}, initial: fibonacciDraft(blankSeqDraft()) }),
    )
    expect(fib).toMatch(/<td>5<\/td><td>8<\/td><\/tr>/)
    expect(fib).toContain('neither arithmetic nor geometric')
    expect(fib).toContain('data-testid="seq-preview-terms"')
    // The menu item exists (the menu itself opens on click).
    const menu = renderToStaticMarkup(createElement(BuildMenu, { factorOpen: false, expOpen: false, onSeqToggle: () => {} }))
    expect(menu).toContain('data-testid="build-btn"')
  })
})

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe('a sequence survives a save and a load', () => {
  it('omits every default, so an untouched toggle changes no bytes', () => {
    expect(sequenceToStored(sq())).toEqual({
      id: 'S1',
      src: 'a_n = 3 + 4(n - 1)',
      color: '#4f9cf9',
      n0: 1,
      count: 10,
    })
    expect(
      sequenceToStored(sq({ showPartner: true, showSums: true, visible: false, params: [2, 5], name: 'c' })),
    ).toEqual({
      id: 'S1',
      src: 'a_n = 3 + 4(n - 1)',
      color: '#4f9cf9',
      n0: 1,
      count: 10,
      params: [2, 5],
      partner: true,
      sums: true,
      hidden: true,
      name: 'c',
    })
  })

  it('serialises a document without sequences byte-for-byte as it did before', () => {
    const plain = board({ curves: [curve({ id: 'c1' })], exprSources: { c1: 'y = x' } })
    const a = serializeDoc(docFromBoard(META, plain, 2000))
    const withEmpty = serializeDoc(docFromBoard(META, { ...plain, sequences: [] }, 2000))
    expect(withEmpty).toBe(a)
    expect(a).not.toContain('"sequences"')
    const back = deserializeDoc(a)
    expect(back.board!.sequences).toEqual([])
    const again = serializeDoc(docFromBoard(META, { ...plain, sequences: back.board!.sequences }, 2000))
    expect(again).toBe(a)
  })

  it('round-trips the line, the window, the toggles, the sliders and a list’s letter', () => {
    const qs = [
      sq({ showPartner: true }),
      sq({ id: 'S2', src: GEO, showSums: true, visible: false, n0: 0, count: 25 }),
      sq({ id: 'S3', src: 'a_n = a + d(n - 1)', params: [2, 5] }),
      sq({ id: 'S4', src: '2, 6, 18, 54', count: 4, name: 'c' }),
    ]
    const json = serializeDoc(docFromBoard(META, board({ sequences: qs }), 2000))
    const back = deserializeDoc(json)
    expect(back.degraded).toBe(false)
    expect(back.board!.sequences).toEqual(qs)
  })

  it('keeps a line that no longer parses — it is text, and nothing is lost', () => {
    const q = sq({ src: 'a_n = 3 +' })
    const back = deserializeDoc(serializeDoc(docFromBoard(META, board({ sequences: [q] }), 2000)))
    expect(back.board!.sequences).toEqual([q])
  })

  it('drops an unreadable record and says so; survives a hostile blob', () => {
    const json = serializeDoc(docFromBoard(META, board({ sequences: [sq()] }), 2000))
    const raw = JSON.parse(json) as StoredDoc
    ;(raw.board.sequences as unknown[]).push({ id: 'S9' }, { id: 'S1', src: 'b_n = n' })
    const back = deserializeDoc(JSON.stringify(raw))
    expect(back.board!.sequences.map((q) => q.id)).toEqual(['S1'])
    expect(back.degraded).toBe(true)
    expect(back.problems.join(' ')).toMatch(/sequence could not be restored/)
    expect(back.problems.join(' ')).toMatch(/two objects claimed the same id/)

    expect(storedToSequence(null)).toEqual({ error: 'it was not readable' })
    const odd = storedToSequence({ id: 'x', src: 'a_n = n', n0: 2.6, count: 9999, params: [1, 'q'], color: 7, name: 'zz' })
    expect('sequence' in odd && odd.sequence).toEqual({
      id: 'x',
      src: 'a_n = n',
      color: '#4f9cf9',
      visible: true,
      n0: 3,
      count: 200,
      showPartner: false,
      showSums: false,
      params: [1, 1],
    })
  })
})

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

describe('the card', () => {
  const noop = (): void => {}
  const render = (q: BoardSequence, selected = true): string =>
    renderToStaticMarkup(
      createElement(SequenceCard, {
        seq: q,
        card: sequenceCard(q, compileSequence(q)),
        selected,
        onSelect: noop,
        onDelete: noop,
        onDuplicate: noop,
        onToggleVisible: noop,
        onCycleColor: noop,
        onZoom: noop,
        onParamChange: noop,
        onParamEditStart: noop,
        onParamEditEnd: noop,
        onParamSetExact: noop,
        onEquationCommit: () => null,
        onWindow: () => null,
        onTogglePartner: noop,
        onToggleSums: noop,
      }),
    )

  it('prints the terms table, the classification and the series line', () => {
    const html = render(sq())
    expect(html).toContain('Sequence a' + subscript('n'))
    expect(html).toContain('data-testid="seq-table"')
    // n | aₙ | Sₙ, row by row
    expect(html).toMatch(/<td class="seq-n">1<\/td><td>3<\/td><td class="seq-s">3<\/td>/)
    expect(html).toMatch(/<td class="seq-n">10<\/td><td>39<\/td><td class="seq-s">210<\/td>/)
    expect(html).toContain('arithmetic, d = 4')
    expect(html).toContain('aₙ = 3 + 4(n − 1)')
    expect(html).toContain('a₁ = 3, aₙ₊₁ = aₙ + 4')
    expect(html).toContain('S₁₀ = 210')
    expect(html).toContain('show continuous partner')
    expect(html).toContain('show partial sums')
  })

  it('prints Σ = 20 for the geometric series, and the dashed line when the partner is on', () => {
    const html = render(sq({ src: GEO, showPartner: true }))
    expect(html).toContain('geometric, r = 1/2')
    expect(html).toMatch(/Σ = [^<]*20 \(\|r\| &lt; 1\)/)
    expect(html).toContain('data-testid="seq-partner-src"')
    expect(html).toContain('10(1/2)^(x − 1)')
  })

  it('shows the classification but not the table when not selected', () => {
    const html = render(sq(), false)
    expect(html).toContain('data-testid="seq-class"')
    expect(html).not.toContain('data-testid="seq-table"')
  })

  it('says a broken line cannot be drawn and shows it as typed', () => {
    const html = render(sq({ src: 'a_n = 3 +' }))
    expect(html).toContain('can’t draw')
    expect(html).toContain('a_n = 3 +')
    expect(html).not.toContain('data-testid="seq-table"')
  })
})

describe('a negative ratio has no continuous partner, and the card says so', () => {
  it('geometric r = −2', () => {
    const q = sq({ src: 'a_n = 3(-2)^(n-1)', showPartner: true })
    const c = compileSequence(q)
    const card = sequenceCard(q, c)
    expect(card.classText).toBe('geometric, r = −2')
    expect(card.hasPartner).toBe(false)
    expect(card.partnerNote).toBe('no continuous partner: r < 0')
    expect(partnerPolylines([q], compileSequences([q]), [-5, 5])).toEqual([])
  })
})
