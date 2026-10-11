// ============================================================================
// tests/revealLeak.test.ts — no gallery board says an answer in reveal mode.
//
// Every example is loaded, framed and drawn three ways through the board's own
// renderer (src/ui/renderBoard.ts, into a recording canvas):
//
//   open      the answers shown, with each curve's selection marks — what the
//             board draws while that curve is selected (src/ui/familyMarks.ts:
//             a sinusoid's key points, a conic's foci …, src/ui/motionLinks.ts:
//             a parametric curve's features)
//   student   the student copy: no answers at all
//   reveal    the open scene in reveal mode with nothing revealed, through the
//             same filter the screen and every export use (applyReveal)
//
// An "answer label" is text the open board draws and the student copy does
// not. Reveal mode, before anything is revealed, may draw none of them — only
// "?" marks and what the student copy has. The m3-tide-sinusoid board once
// broke this: the sinusoid's key point "(12, 8)" stayed on while the other
// answers were hidden.
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { FittedCurve, ModelSpec, SpecialPoint } from '../src/core/types'
import { analyzeCurve } from '../src/core/analyze'
import { EXAMPLE_DEFS, buildExample } from '../src/examples'
import { docFigure, docModelFromJSON } from '../src/ui/docScene'
import type { DocModel } from '../src/ui/docScene'
import { answerLabel, boardLabelScale, boardPointText, renderBoard } from '../src/ui/renderBoard'
import type { BoardScene } from '../src/ui/renderBoard'
import { REVEAL_OFF, applyReveal, buildInventory, isHidden } from '../src/ui/reveal'
import type { SceneReveal } from '../src/ui/reveal'
import { boardMarks, familyMarks } from '../src/ui/familyMarks'
import { motionKindOf, motionMarks, safeFeatures } from '../src/ui/motionLinks'
import { solveCached, solveXs } from '../src/ui/nlSolve'
import { MockCtx, withMockPath2D } from './mockCanvas'

const ON = { ...REVEAL_OFF, on: true }

const analyze = (c: FittedCurve, models: Record<string, ModelSpec>): SpecialPoint[] => {
  try {
    return analyzeCurve(c, models)
  } catch {
    return []
  }
}

/** Every text the renderer draws for a scene, once each. */
function texts(scene: BoardScene): Set<string> {
  const ctx = withMockPath2D(() => {
    const c = new MockCtx()
    renderBoard(c as unknown as CanvasRenderingContext2D, scene)
    return c
  })
  return new Set(ctx.texts.map((t) => t.text.trim()).filter((t) => t !== ''))
}

type Context = { curve: FittedCurve; points: SpecialPoint[] }[]

/** Each visible curve's analyzer points, exactly as the open figure has them (the answers). */
function answerLists(m: DocModel): Map<string, SpecialPoint[]> {
  const open = docFigure(m, { style: 'screen', answers: true, caption: '', keyLine: false })
  const out = new Map<string, SpecialPoint[]>()
  if (open.scene.analysis) out.set(open.scene.analysis.curve.id, open.scene.analysis.points)
  for (const c of open.context) out.set(c.curve.id, c.points)
  for (const c of m.board.curves) if (c.visible && !out.has(c.id)) out.set(c.id, analyze(c, m.models))
  return out
}

/** The selected curve's family and motion marks — the board's selection marks (src/ui/familyMarks.ts). */
function selectionLayers(m: DocModel, sel: FittedCurve, gated: boolean) {
  const mk = motionKindOf(sel, m.models)
  const f = mk ? safeFeatures(sel, m.models) : null
  return familyMarks(sel, m.board.exprSources[sel.id], {
    calls: (m.board.calls[sel.id]?.length ?? 0) > 0,
    hidden: gated ? (k) => isHidden(ON, k) : undefined,
    transform: true,
    motion: f && mk ? motionMarks(f, mk) : [],
  })
}

/** The scene the board draws with `sel` selected: no printed key, the other curves as context. */
function boardScene(m: DocModel, sel: FittedCurve | null, lists: Map<string, SpecialPoint[]>, gated: boolean): { scene: BoardScene; context: Context } {
  const open = docFigure(m, { style: 'screen', answers: true, caption: '', keyLine: false })
  const scene: BoardScene = { ...open.scene, answerKey: undefined }
  scene.analysis = sel ? { curve: sel, points: boardMarks(lists.get(sel.id) ?? [], selectionLayers(m, sel, gated), true) } : null
  const context: Context = m.board.curves
    .filter((c) => c.visible && c.id !== sel?.id)
    .map((c) => ({ curve: c, points: lists.get(c.id) ?? [] }))
    .filter((c) => c.points.length > 0)
  return { scene, context }
}

function revealOf(m: DocModel, scene: BoardScene, context: Context, lists: Map<string, SpecialPoint[]>): SceneReveal {
  const inv = buildInventory({
    curves: m.board.curves.filter((c) => c.visible).map((c) => ({ id: c.id, points: lists.get(c.id) ?? [] })),
    crossings: scene.intersections ?? [],
  })
  return {
    hidden: (k) => isHidden(ON, k),
    positions: true,
    pointKey: inv.answerKey,
    crossKey: inv.crossKey,
    context,
    nlMarks: (id) => {
      const it = m.board.items.find((i) => i.id === id)
      if (!it || it.kind !== 'solve') return []
      const res = solveCached(it.src)
      return res.ok ? solveXs(res) : []
    },
  }
}

/**
 * The texts that state an answer: every chip of an answer-keyed point (each
 * curve's analyzer points, the crossings, the family facts' marks), every
 * answer-keyed overlay label — and anything else the open board draws that
 * the student copy does not.
 */
function answerTexts(m: DocModel, scene: BoardScene, sel: FittedCurve | null, lists: Map<string, SpecialPoint[]>, given: Set<string>): Set<string> {
  const out = new Set<string>()
  const vp = scene.vp
  for (const c of m.board.curves) {
    if (!c.visible) continue
    const at = boardLabelScale(vp, c, m.models)
    const fam = selectionLayers(m, c, false)
    for (const p of [...(lists.get(c.id) ?? []), ...fam.sin, ...fam.conic, ...fam.logistic, ...fam.transform, ...fam.motion]) {
      out.add(boardPointText(p, at))
      out.add(answerLabel(p))
    }
  }
  for (const x of scene.intersections ?? []) out.add(answerLabel(x.point))
  for (const ov of scene.overlays ?? []) if (ov.kind === 'label' && ov.answer && 'text' in ov && typeof ov.text === 'string') out.add(ov.text)
  // the open board, labelled as a printed key labels it
  const { scene: os, context } = boardScene(m, sel, lists, false)
  for (const t of texts({ ...os, answerKey: { more: context, unlabelled: [] } })) out.add(t)
  for (const t of given) out.delete(t)
  out.delete('?')
  return out
}

/** Answer texts the reveal-mode board still draws with `sel` selected. */
function leaks(
  m: DocModel,
  sel: FittedCurve | null,
  gated: boolean,
  /** Narrow a curve's analyzer list (to stand for an analyzer window that stops short). */
  trim?: (curveId: string, points: SpecialPoint[]) => SpecialPoint[],
): string[] {
  const lists = answerLists(m)
  if (trim) for (const [id, pts] of lists) lists.set(id, trim(id, pts))
  const { scene, context } = boardScene(m, sel, lists, gated)
  const given = texts(docFigure(m, { style: 'screen', answers: false, caption: '', keyLine: false }).scene)
  const answers = answerTexts(m, scene, sel, lists, given)
  const shown = texts(applyReveal(scene, revealOf(m, scene, context, lists)))
  return [...shown].filter((t) => answers.has(t))
}

function load(json: string): DocModel {
  const m = docModelFromJSON(json)
  if (!m) throw new Error('example did not load')
  return m
}

describe('reveal mode, nothing revealed: no answer label on any gallery board', () => {
  for (const def of EXAMPLE_DEFS) {
    it(def.id, () => {
      const m = load(buildExample(def).json)
      const visible = m.board.curves.filter((c) => c.visible)
      // the board as it opens (its own selection), then each visible curve selected in turn
      const sels: (FittedCurve | null)[] = [m.board.curves.find((c) => c.id === m.board.selectedId) ?? null, ...visible]
      for (const sel of sels) expect(leaks(m, sel, true), `${def.id} · ${sel?.id ?? 'nothing'} selected`).toEqual([])
    })
  }

  it('the tide board as it was (no restriction): the key point (12, 8) leaked, and the family gate stops it', () => {
    const def = EXAMPLE_DEFS.find((d) => d.id === 'm3-tide-sinusoid')!
    // the board before its restriction: the analyzer's window stops short of
    // t = 12, so the sinusoid's key point there was drawn with no answer key
    const json = buildExample(def).json.replace('d(t) = 3sin(pi t/6) + 8 {0 <= t <= 24}', 'd(t) = 3sin(pi t/6) + 8')
    const m = load(json)
    const d = m.board.curves[0]
    expect(m.board.exprSources[d.id]).toBe('d(t) = 3sin(pi t/6) + 8')
    // the analyzer then looked at −10 ≤ t ≤ 10: no answer at t = 12
    const window = (_id: string, pts: SpecialPoint[]): SpecialPoint[] => pts.filter((p) => Math.abs(p.pos.x) <= 10)
    expect(leaks(m, d, false, window)).toEqual(['(12, 8)'])
    expect(leaks(m, d, true, window)).toEqual([])
    expect(leaks(m, d, true)).toEqual([])
  })

  it('a parametric curve’s features (its Motion section’s) hide with its family facts too', () => {
    const def = EXAMPLE_DEFS.find((d) => d.id === 'pc-u3-polar-limacon')!
    const m = load(buildExample(def).json)
    const e = m.board.curves[0]
    expect(leaks(m, e, false).length).toBeGreaterThan(0)
    expect(leaks(m, e, true)).toEqual([])
  })
})
