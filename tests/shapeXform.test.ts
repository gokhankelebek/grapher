// ============================================================================
// tests/shapeXform.test.ts — transformations of shapes as the BOARD holds
// them: the typed command and the card's exact inputs, linked images that
// follow their pre-image (A′B′C′, then A″B″C″), persistence (written only when
// present — old documents byte-identical), the delete cascade, reveal mode and
// the student copy, the screen-reader description, the pgfplots export, the
// card data (rule, checks, symmetry, compare) and the commands.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { BoardInput, BoardShape, DocMeta } from '../src/core/persist'
import { cleanXform, deserializeDoc, docFromBoard, serializeDoc, shapeToStored, storedToShape } from '../src/core/persist'
import {
  defaultOp,
  looksLikeXformCommand,
  opCommand,
  parseAngle,
  parseMirrorLine,
  parsePointRef,
  parseScale,
  parseXformCommand,
  resolveOp,
} from '../src/core/parse/xform'
import { compileShapes, sceneShapes, shapeCard, shapeLegend } from '../src/ui/shapeLinks'
import { aidsOf, defaultAids, imageDependents, shapeByName, withAids } from '../src/ui/shapeXform'
import { applyReveal, maskShapes, shapeAnswerSpots, shapeKey } from '../src/ui/reveal'
import type { SceneReveal } from '../src/ui/reveal'
import { docFigure, docModelFromJSON } from '../src/ui/docScene'
import { describeShapes } from '../src/core/describeAdapters'
import { describeBoard } from '../src/ui/boardDescription'
import { toPgfplots } from '../src/ui/pgfplotsExport'
import { availability, COMMANDS, COMMAND_BY_ID, HELP_SECTIONS } from '../src/ui/commands'
import type { CommandContext } from '../src/ui/commands'
import type { Shape } from '../src/core/types'

const META: DocMeta = { id: 'doc1', name: 'Transformations', createdAt: 1000, modifiedAt: 1000 }

const base = (over: Partial<BoardShape> = {}): BoardShape => ({
  id: 'S1',
  src: 'ABC = (1,2) (4,2) (4,6)',
  params: [],
  color: '#4f9cf9',
  fill: false,
  visible: true,
  ...over,
})

const image = (id: string, of: string, op: BoardShape['xform'] extends infer X ? (X extends { op: infer O } ? O : never) : never, src = 'image'): BoardShape =>
  base({ id, src, color: '#f97316', xform: { of, op } })

function board(over: Partial<BoardInput> = {}): BoardInput {
  return {
    curves: [],
    styles: {},
    candidates: new Map(),
    exprSources: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 40 },
    selectedId: null,
    mode: 'draw',
    ...over,
  }
}

const ROT = image('I1', 'S1', { t: 'rotate', angle: '90', about: '(0, 0)' }, 'rotate ABC 90° about (0, 0)')
const REF = image('I2', 'I1', { t: 'reflect', line: 'y = x' }, 'reflect A′B′C′ across y = x')

function built(list: BoardShape[], id: string): Shape {
  const c = compileShapes(list).get(id)
  if (!c?.shape) throw new Error(`no shape ${id}: ${c?.error}`)
  return c.shape
}

// ---------------------------------------------------------------------------

describe('the typed command and the exact inputs', () => {
  it('reads the four commands, primes typed as apostrophes', () => {
    expect(parseXformCommand('rotate ABC 90° about (0, 0)')).toEqual({ target: 'ABC', op: { t: 'rotate', angle: '90', about: '(0, 0)' } })
    expect(parseXformCommand("reflect A'B'C' across y = x")).toEqual({ target: 'A′B′C′', op: { t: 'reflect', line: 'y = x' } })
    expect(parseXformCommand('translate ABC by <3, -2>')).toEqual({ target: 'ABC', op: { t: 'translate', by: ['3', '-2'] } })
    expect(parseXformCommand('dilate ABC by 1/2 about (1, 1)')).toEqual({ target: 'ABC', op: { t: 'dilate', k: '1/2', about: '(1, 1)' } })
    expect(parseXformCommand('dilate PQRS with scale factor 3 centered at P')).toEqual({ target: 'PQRS', op: { t: 'dilate', k: '3', about: 'P' } })
    expect(parseXformCommand('rotate ABC by -90')).toEqual({ target: 'ABC', op: { t: 'rotate', angle: '-90', about: '(0, 0)' } })
    expect(looksLikeXformCommand('rotate ABC 90')).toBe(true)
    expect(looksLikeXformCommand('y = x^2')).toBe(false)
    expect(looksLikeXformCommand("A'B'C' = rotate ABC 90")).toBe(true)
    expect('error' in parseXformCommand('rotate ABC')).toBe(true)
    expect('error' in parseXformCommand('reflect')).toBe(true)
  })

  it('opCommand and parseXformCommand agree', () => {
    for (const t of ['translate', 'reflect', 'rotate', 'dilate'] as const) {
      const op = defaultOp(t)
      const back = parseXformCommand(opCommand(op, 'ABC'))
      expect(back).toEqual({ target: 'ABC', op })
    }
  })

  it('mirror lines in every form a class writes', () => {
    const line = (s: string) => {
      const r = parseMirrorLine(s, new Map([['A', { x: 0, y: 1 }], ['B', { x: 2, y: 5 }]]))
      return 'line' in r ? r.line : r.error
    }
    expect(line('x-axis')).toEqual({ kind: 'x-axis' })
    expect(line('the y axis')).toEqual({ kind: 'y-axis' })
    expect(line('y = x')).toEqual({ kind: 'y=x' })
    expect(line('y = -x')).toEqual({ kind: 'y=-x' })
    expect(line('y=−x')).toEqual({ kind: 'y=-x' })
    expect(line('x = 3')).toEqual({ kind: 'x=k', k: 3 })
    expect(line('y = -1/2')).toEqual({ kind: 'y=k', k: -0.5 })
    expect(line('y = 0')).toEqual({ kind: 'x-axis' })
    expect(line('y = 2x + 1')).toEqual({ kind: 'line', p: { x: 0, y: 1 }, q: { x: 1, y: 3 } })
    expect(line('(0, 1) (2, 5)')).toEqual({ kind: 'line', p: { x: 0, y: 1 }, q: { x: 1, y: 3 } })
    expect(line('line AB')).toEqual({ kind: 'line', p: { x: 0, y: 1 }, q: { x: 1, y: 3 } })
    expect(line('(0,0), (3,3)')).toEqual({ kind: 'y=x' })
    expect(line('y = x^2')).toMatch(/curve, not a line/)
    expect(line('banana')).toMatch(/Type a line/)
  })

  it('angles, scale factors and centres', () => {
    expect(parseAngle('90')).toEqual({ deg: 90 })
    expect(parseAngle('90°')).toEqual({ deg: 90 })
    expect(parseAngle('90 cw')).toEqual({ deg: -90 })
    expect('deg' in parseAngle('pi/2') && Math.abs((parseAngle('pi/2') as { deg: number }).deg - 90) < 1e-9).toBe(true)
    expect(parseScale('1/2')).toEqual({ k: 0.5 })
    expect(parseScale('-3')).toEqual({ k: -3 })
    expect('error' in parseScale('0')).toBe(true)
    expect(parsePointRef('')).toEqual({ p: { x: 0, y: 0 } })
    expect(parsePointRef('origin')).toEqual({ p: { x: 0, y: 0 } })
    expect(parsePointRef('(1, -2)')).toEqual({ p: { x: 1, y: -2 } })
    expect(parsePointRef("A'", new Map([['A′', { x: 5, y: 6 }]]))).toEqual({ p: { x: 5, y: 6 } })
    expect('error' in parsePointRef('Q')).toBe(true)
    expect(resolveOp({ t: 'translate', by: ['3', 'x'] })).toMatchObject({ error: expect.stringMatching(/vertical shift/) })
  })
})

describe('linked images on the board', () => {
  it('builds A′B′C′ under R_{90°, O} and A″B″C″ from it, primes and all', () => {
    const list = [base(), ROT, REF]
    const c = compileShapes(list)
    const a = c.get('I1')!
    expect(a.shape?.kind === 'polygon' && a.shape.pts).toEqual([{ x: -2, y: 1 }, { x: -2, y: 4 }, { x: -6, y: 4 }])
    expect(a.shape?.kind === 'polygon' && a.shape.labels).toEqual(['A′', 'B′', 'C′'])
    expect(a.shape?.kind === 'polygon' && a.shape.dashed).toBe(true)
    expect(a.latex).toBe("\\triangle A'B'C' = R_{90^\\circ,\\,O}\\left(\\triangle ABC\\right)")
    expect(a.xform?.rule.text).toBe('(x, y) → (−y, x)')
    expect(a.xform?.rigid).toBe(true)
    const b = c.get('I2')!
    expect(b.shape?.kind === 'polygon' && b.shape.labels).toEqual(['A″', 'B″', 'C″'])
    expect(b.shape?.kind === 'polygon' && b.shape.pts).toEqual([{ x: 1, y: -2 }, { x: 4, y: -2 }, { x: 4, y: -6 }])
    // the chain from △ABC is a single reflection across the x-axis
    expect(b.xform?.chain?.name.text).toBe('r_{y=x} ∘ R_{90°, O}')
    expect(b.xform?.chain?.rule.text).toBe('(x, y) → (x, −y)')
    expect(b.xform?.chain?.single).toBe('a reflection across the x-axis')
    expect(shapeLegend(list, c).map((l) => l.tex)).toEqual(['\\triangle ABC', "\\triangle A'B'C'", "\\triangle A''B''C''"])
  })

  it('follows its pre-image: a moved vertex moves both images', () => {
    const moved = [base({ src: 'ABC = (2,1) (4,2) (4,6)' }), ROT, REF]
    const b = built(moved, 'I2')
    expect(b.kind === 'polygon' && b.pts[0]).toEqual({ x: 2, y: -1 })
  })

  it('a second image of the same figure takes the next primes, in board order', () => {
    const dil = image('I3', 'S1', { t: 'dilate', k: '1/2', about: '(1, 1)' })
    const s = built([base(), ROT, REF, dil], 'I3')
    expect(s.kind === 'polygon' && s.labels).toEqual(['A‴', 'B‴', 'C‴'])
    expect(s.kind === 'polygon' && s.pts).toEqual([{ x: 1, y: 1.5 }, { x: 2.5, y: 1.5 }, { x: 2.5, y: 3.5 }])
    expect(s.kind === 'polygon' && s.aids?.rays?.length).toBe(3)
    expect(s.kind === 'polygon' && s.aids?.center).toEqual({ at: { x: 1, y: 1 }, label: '(1, 1)' })
  })

  it('rotates about a named point, and reports a missing parent, a bad op and a loop', () => {
    const P = base({ id: 'P', src: 'P = (1, 1)' })
    const about = image('I1', 'S1', { t: 'rotate', angle: '180', about: 'P' })
    const s = built([base(), P, about], 'I1')
    expect(s.kind === 'polygon' && s.pts[0]).toEqual({ x: 1, y: 0 })
    expect(compileShapes([ROT]).get('I1')?.error).toMatch(/not on the board/)
    expect(compileShapes([base(), image('I1', 'S1', { t: 'reflect', line: 'banana' })]).get('I1')?.error).toMatch(/Type a line/)
    const loop = [image('X', 'Y', defaultOp('rotate')), image('Y', 'X', defaultOp('rotate'))]
    expect(compileShapes(loop).get('X')?.error).toMatch(/loops/)
  })

  it('segments and points have images too; vectors do not offer the tool', () => {
    const seg = base({ id: 'G', src: 'AB = (0,0) (2,0)' })
    const t = built([seg, image('I', 'G', { t: 'translate', by: ['1', '3'] })], 'I')
    expect(t.kind === 'segment' && [t.a, t.b, t.labels]).toEqual([{ x: 1, y: 3 }, { x: 3, y: 3 }, ['A′', 'B′']])
    expect(t.kind === 'segment' && t.aids?.vector).toEqual({ tail: { x: 0, y: 0 }, v: { x: 1, y: 3 }, label: '⟨1, 3⟩' })
    const p = built([base({ id: 'P', src: 'P = (2, 5)' }), image('I', 'P', { t: 'reflect', line: 'x-axis' })], 'I')
    expect(p.kind === 'point' && [p.at, p.label]).toEqual([{ x: 2, y: -5 }, 'P′'])
    const v = base({ id: 'V', src: 'v = <3, 4>' })
    expect(shapeCard(v, compileShapes([v])).canTransform).toBe(false)
  })

  it('the typed name finds the figure', () => {
    const list = [...compileShapes([base(), ROT]).values()].map((c) => ({ id: c.id, shape: c.shape }))
    expect(shapeByName('ABC', list)).toBe('S1')
    expect(shapeByName('A′B′C′', list)).toBe('I1')
    expect(shapeByName('△ABC', list)).toBe('S1')
    expect(shapeByName('XYZ', list)).toBeNull()
  })
})

describe('the image card', () => {
  it('states the rule, rigid or not, the image vertices and ✓ for what is preserved', () => {
    const list = [base(), image('I3', 'S1', { t: 'dilate', k: '1/2', about: '(1, 1)' })]
    const card = shapeCard(list[1], compileShapes(list))
    expect(card.noun).toBe('Image')
    expect(card.vertices).toEqual([])
    expect(card.image?.name.text).toBe('D_{1/2, (1, 1)}')
    expect(card.image?.rule.text).toBe('(x, y) → ((1/2)x + 1/2, (1/2)y + 1/2)')
    expect(card.image?.rigidText).toMatch(/^Not rigid: every length is multiplied by 1\/2/)
    expect(card.image?.vertexTexts).toEqual(['A′(1, 3/2)', 'B′(5/2, 3/2)', 'C′(5/2, 7/2)'])
    expect(card.image?.checks.every((x) => x.ok !== false)).toBe(true)
    expect(card.image?.checks.some((x) => x.text === 'The centre (1, 1) stays fixed')).toBe(true)
    expect(card.canTransform).toBe(true) // an image can be transformed again
  })

  it('symmetry and compare on a polygon card', () => {
    const sq = base({ id: 'Q', src: 'PQRS = (0,0) (2,0) (2,2) (0,2)', sym: true })
    const list = [base(), ROT, REF, sq]
    const c = compileShapes(list)
    const qs = c.get('Q')!.shape!
    expect(qs.kind === 'polygon' && qs.aids?.symLines?.length).toBe(4)
    expect(qs.kind === 'polygon' && qs.aids?.symText?.text).toBe('4 lines · order 4 (90°, 180°, 270°)')
    const card = shapeCard(base({ compare: 'I2' }), c)
    expect(card.symmetry?.summary).toBe('no lines · no turn')
    expect(card.compare?.choices.map((x) => x.label)).toEqual(['△A′B′C′', '△A″B″C″', 'PQRS'])
    expect(card.compare?.result?.report.relation).toBe('congruent')
    expect(card.compare?.result?.report.words).toBe('a reflection across the x-axis')
    expect(card.compare?.result?.triangle?.criteria[0].name).toBe('SSS')
  })
})

describe('persistence, delete and undo', () => {
  it('writes the link, the overlay and the comparison only when present', () => {
    expect(Object.keys(shapeToStored(base())).sort()).toEqual(['color', 'id', 'src'])
    expect(shapeToStored(ROT).xform).toEqual({ of: 'S1', op: { t: 'rotate', angle: '90', about: '(0, 0)' } })
    expect(shapeToStored(base({ sym: true })).sym).toBe(true)
    expect(shapeToStored(base({ compare: 'I1' })).compare).toBe('I1')
  })

  it('an old document is byte-identical', () => {
    const plain = serializeDoc(docFromBoard(META, board({ shapes: [base()] }), 2000))
    expect(plain).not.toMatch(/xform|"sym"|compare/)
    const again = serializeDoc(docFromBoard(META, board({ shapes: [{ ...base(), xform: undefined, sym: undefined, compare: undefined }] }), 2000))
    expect(again).toBe(plain)
  })

  it('round-trips images, chains, aids, the overlay and the comparison', () => {
    const list = [
      base({ sym: true, compare: 'I2' }),
      { ...ROT, xform: { ...ROT.xform!, aids: ['paths' as const, 'arc' as const] } },
      REF,
    ]
    const back = deserializeDoc(serializeDoc(docFromBoard(META, board({ shapes: list }), 2000)))
    expect(back.degraded).toBe(false)
    expect(back.board!.shapes).toEqual(list)
    const again = built(back.board!.shapes, 'I2')
    expect(again.kind === 'polygon' && again.labels).toEqual(['A″', 'B″', 'C″'])
  })

  it('cleans what it reads', () => {
    expect(cleanXform({ of: 'S1', op: { t: 'rotate', angle: '90', about: '(0,0)' }, aids: ['arc', 'junk', 'paths'] })).toEqual({
      of: 'S1',
      op: { t: 'rotate', angle: '90', about: '(0,0)' },
      aids: ['paths', 'arc'],
    })
    expect(cleanXform({ of: 'S1', op: { t: 'shear', k: '2' } })).toBeUndefined()
    expect(cleanXform({ of: '', op: defaultOp('rotate') })).toBeUndefined()
    expect(cleanXform({ of: 'S1', op: { t: 'translate', by: ['1'] } })).toBeUndefined()
    // an image's line is what it reads as; it need not parse as a shape
    const got = storedToShape({ id: 'I', src: 'rotate ABC 90° about (0, 0)', color: '#fff', xform: { of: 'S1', op: defaultOp('rotate') } })
    expect('shape' in got && got.shape.xform?.of).toBe('S1')
    expect('error' in storedToShape({ id: 'I', src: 'rotate', color: '#fff', xform: { of: 'S1' } })).toBe(true)
  })

  it('deleting a figure takes its images (and theirs) with it', () => {
    const list = [base(), ROT, REF, image('I3', 'S1', defaultOp('dilate')), base({ id: 'Z', src: 'P = (0, 0)' })]
    expect([...imageDependents(list, ['S1'])].sort()).toEqual(['I1', 'I2', 'I3'])
    expect([...imageDependents(list, ['I1'])]).toEqual(['I2'])
    expect(imageDependents(list, ['Z']).size).toBe(0)
  })

  it('aids: the default is not written', () => {
    expect(defaultAids('rotate')).toEqual(['arc'])
    const x = ROT.xform!
    expect(withAids(x, ['arc'])).toEqual(x)
    expect(withAids(x, ['arc', 'paths']).aids).toEqual(['paths', 'arc'])
    expect(aidsOf(withAids(x, []))).toEqual([])
  })
})

describe('reveal mode and the student copy', () => {
  const scene = (list: BoardShape[]) => sceneShapes(list, compileShapes(list))

  it('the image is the answer: hidden, only the given aids stay', () => {
    const refl = image('I', 'S1', { t: 'reflect', line: 'y = x' })
    const shapes = scene([base(), refl, image('T', 'S1', { t: 'translate', by: ['3', '-2'] })])
    const masked = maskShapes(shapes, (k) => k.endsWith(':image'))
    const r = masked[1]
    expect(r.kind === 'polygon' && r.figureHidden).toBe(true)
    expect(r.kind === 'polygon' && r.aids?.mirror?.label).toBe('y = x')
    const t = masked[2]
    expect(t.kind === 'polygon' && t.aids?.vector?.label).toBe('⟨3, −2⟩')
    expect(masked[0]).toEqual(shapes[0])
    expect(shapeAnswerSpots(shapes[1]).map((s) => s.part)).toEqual(['image'])
  })

  it('applyReveal hides the image and the symmetry lines, with a spot for each', () => {
    const shapes = scene([base({ sym: true }), ROT])
    const hidden = new Set([shapeKey('I1', 'image'), shapeKey('S1', 'symmetry')])
    const r: SceneReveal = { hidden: (k) => hidden.has(k), positions: true, pointKey: () => null, crossKey: (a, b) => `cross:${a}:${b}` }
    const out = applyReveal({ shapes, curves: [] } as never, r)
    const img = out.shapes![1]
    expect(img.kind === 'polygon' && img.figureHidden).toBe(true)
    expect(img.kind === 'polygon' && img.aids?.arc).toBeUndefined()
    expect(img.kind === 'polygon' && img.aids?.center?.label).toBe('O')
    expect(out.revealMarks?.map((m) => m.key).sort()).toEqual([shapeKey('I1', 'image'), shapeKey('S1', 'symmetry')])
    const sq = out.shapes![0]
    expect(sq.kind === 'polygon' && sq.aids?.symLines).toBeUndefined()
  })

  it('the student copy asks for the image; the key draws it', () => {
    const m = docModelFromJSON(serializeDoc(docFromBoard(META, board({ shapes: [base(), ROT] }), 2000)), { screen: { widthPx: 800, heightPx: 600 } })!
    const student = docFigure(m, { style: 'textbook', answers: false }).scene.shapes!
    const key = docFigure(m, { style: 'textbook', answers: true }).scene.shapes!
    expect(student[1].kind === 'polygon' && student[1].figureHidden).toBe(true)
    expect(key[1].kind === 'polygon' && key[1].figureHidden).toBeFalsy()
    const said = describeBoard(m, { answers: false }).long
    expect(said).toContain('The image of △ABC under a rotation of 90° counterclockwise about the origin is to be drawn.')
    expect(said).not.toContain('A′(')
    expect(describeBoard(m, { answers: true }).long).toContain('R_{90°, O}: (x, y) → (−y, x)')
  })
})

describe('descriptions and exports', () => {
  it('describeShapes says what the image is the image of, as an answer', () => {
    const list = [base(), ROT]
    const d = describeShapes(sceneShapes(list, compileShapes(list)))
    const said = d.find((x) => x.text.startsWith('△A′B′C′ is the image'))
    expect(said?.answer).toBe(true)
    expect(said?.text).toBe('△A′B′C′ is the image of △ABC under a rotation of 90° counterclockwise about the origin, drawn dashed: R_{90°, O}: (x, y) → (−y, x).')
    expect(d.some((x) => x.text === 'The centre O, the origin is marked.')).toBe(true)
  })

  it('pgfplots draws the image dashed, the mirror line, the arc and the symmetry lines', () => {
    const list = [base({ sym: true }), image('I', 'S1', { t: 'reflect', line: 'x = 6' }), image('J', 'S1', { t: 'rotate', angle: '90', about: '(0, 0)' })]
    const m = docModelFromJSON(serializeDoc(docFromBoard(META, board({ shapes: list, viewport: { center: { x: 2, y: 3 }, pxPerUnit: 40 } }), 2000)), { screen: { widthPx: 800, heightPx: 600 } })!
    const tex = toPgfplots(docFigure(m, { style: 'textbook', answers: true }).scene)
    expect(tex).toMatch(/\\draw\[gr\d, thick, dashed\] \(11,2\) -- \(8,2\)/)
    expect(tex).toMatch(/dashed, semithick\]/)
    expect(tex).toMatch(/semithick, ->\]/)
    expect(tex).toContain('x = 6')
    expect(tex).not.toContain('U+')
  })
})

describe('the commands', () => {
  it('registers Transform, Compare and Symmetry, with a Math 2 help section', () => {
    for (const id of ['shape-transform', 'shape-compare', 'shape-symmetry']) expect(COMMAND_BY_ID.get(id)?.target).toBe('shape')
    expect(HELP_SECTIONS.some((s) => s.course === 'NC Math 2' && s.entries.some((e) => 'id' in e && e.id === 'shape-compare'))).toBe(true)
    expect(COMMANDS.filter((c) => c.id.startsWith('shape-')).length).toBe(3)
  })

  it('runs on the selected figure and asks which one otherwise', () => {
    const opened: string[] = []
    const ctx = {
      board: 'cartesian',
      readOnly: false,
      selectedId: 'S1',
      shapes: [
        { id: 'S1', name: '△ABC', text: 'ABC = …', kind: 'polygon', image: false },
        { id: 'G', name: 'segment AB', text: 'AB = …', kind: 'segment', image: false },
      ],
      actions: { openShapeTool: (id: string, tool: string) => opened.push(`${id}:${tool}`) },
    } as unknown as CommandContext
    const sym = COMMAND_BY_ID.get('shape-symmetry')!
    expect(availability(sym, ctx)).toEqual({ state: 'ready', targetId: 'S1' })
    sym.run(ctx, 'S1')
    expect(opened).toEqual(['S1:symmetry'])
    const none = { ...ctx, selectedId: null } as CommandContext
    const a = availability(COMMAND_BY_ID.get('shape-compare')!, none)
    expect(a.state === 'pick' && a.candidates.map((c) => c.id)).toEqual(['S1', 'G'])
    expect(availability(sym, { ...ctx, selectedId: 'G' } as CommandContext)).toEqual({ state: 'hidden' })
  })
})
