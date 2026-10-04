// ============================================================================
// src/ui/answerSources.ts — where every revealed answer's text is read from.
//
// src/ui/revealedAnswers.ts turns one answer key into one line through a set
// of readers (AnswerSources). Two places need those readers:
//
//   * Present (src/app/usePresentAnswers.ts): the live board's hooks — the
//     cards' calculus rows, the selected card's Domain and Table panels, the
//     figures the board draws;
//   * the worksheet answer key (src/ui/docAnswers.ts): a document that is
//     only JSON in storage, rebuilt through the same pure helpers.
//
// Both hand their inputs to `answerSourcesOf`, so a value reads the same on
// the projector and on the printed key: one source of truth for the words.
// ============================================================================

import type { FittedCurve, ModelSpec, NLItem, Shape, SpecialPoint } from '../core/types'
import type { BoardData, BoardShape } from '../core/persist'
import type { Overlay } from '../render/overlays'
import type { UnitCircleFigure } from '../render/unitCircle'
import type { RelatedRatesFigure } from '../render/relatedRates'
import type { StatsFigure } from '../render/stats'
import { asymptoteTexts } from './CurveCard'
import { complexZerosOf } from './complexLinks'
import { zeroLine } from '../core/complexZeros'
import { familyFactLines } from './familyFacts'
import { writeStandard } from './conicLinks'
import { solveCached } from './nlSolve'
import { tableCalcAnswer } from './tableCalcLinks'
import type { AnswerSources } from './revealedAnswers'
import type { CardCalc } from './calcLinks'
import type { CirclePanel } from './circleLinks'
import type { TablePanel } from './valueTableLinks'
import type { SequenceCardData } from './seqLinks'
import type { FieldCardData } from './fieldLinks'
import type { SystemCardData } from './systemLinks'

const ORIGIN_WORD: Record<string, string> = {
  tangent: 'tangent line',
  derivative: 'derivative',
  accumulation: 'accumulation function',
  taylor: 'Taylor polynomial',
}

export type CalcLine = { label: string; value: string; curveId: string | null; board?: boolean }

/** linkId → what its card states, from the cards' own rows. */
export function calcLinesOf(cards: Readonly<Record<string, CardCalc>>): Map<string, CalcLine> {
  const out = new Map<string, CalcLine>()
  const put = (id: string, line: CalcLine): void => {
    if (!out.has(id)) out.set(id, line)
  }
  for (const [curveId, card] of Object.entries(cards)) {
    if (card.origin) {
      const o = card.origin
      put(o.linkId, { label: ORIGIN_WORD[o.kind] ?? o.kind, value: [o.text, ...(o.facts ?? [])].join(' · '), curveId, board: o.kind !== 'accumulation' })
    }
    for (const a of card.areas) put(a.linkId, { label: a.otherLabel ? `area between ${a.otherLabel}` : 'definite integral', value: a.text, curveId })
    for (const r of card.riemanns) put(r.linkId, { label: 'Riemann sum', value: r.text, curveId })
    for (const g of card.accums) put(g.linkId, { label: 'accumulation', value: [g.head, g.text].filter(Boolean).join(' · '), curveId })
    for (const t of card.taylors) put(t.linkId, { label: `Taylor ${t.name}`, value: [t.text, t.ioc ? t.iocText : ''].filter(Boolean).join(' · '), curveId })
    for (const s of card.secants) put(s.linkId, { label: s.head, value: [s.value ?? '', s.quotient?.text ?? '', s.line?.text ?? ''].filter(Boolean)[0] ?? '', curveId })
    for (const l of card.limits) put(l.linkId, { label: 'limit', value: l.head.text, curveId })
    for (const v of card.volumes) put(v.linkId, { label: v.head || 'volume', value: v.value ?? '', curveId })
    // A sign chart's answer is what it lets you conclude — each AP sentence
    // with its justification — not the chart's title.
    for (const s of card.signs) {
      const said = (s.conclusions ?? []).map((c) => c.text.trim()).filter(Boolean)
      put(s.linkId, { label: 'sign chart', value: said.length > 0 ? said.join(' ') : s.title, curveId, board: true })
    }
    for (const i of card.implicits ?? []) put(i.linkId, { label: 'dy/dx', value: `${i.slopeText} at ${i.pointText}`, curveId })
    for (const p of card.pcalcs ?? []) put(p.linkId, { label: `calculus at ${p.v} = ${p.tText}`, value: p.summary, curveId })
    for (const p of card.pbetweens ?? []) put(p.linkId, { label: 'polar area', value: p.summary, curveId })
  }
  return out
}

/** A table part as one line ("f(0) = 1, f(1) = 2, …"). */
export function tablePartText(p: TablePanel | null | undefined, part: string): string | null {
  if (!p) return null
  if (part === 'values') {
    const rows = p.rows.slice(0, 6).map((r) => `${p.name}(${r.x.text}) = ${r.y.text}`)
    return rows.length > 0 ? rows.join(', ') + (p.rows.length > 6 ? ', …' : '') : null
  }
  if (part === 'eval') return p.evaluate && p.evaluate.ok ? p.evaluate.text : null
  if (part === 'compare') return p.compare?.sentence ?? p.compare?.crossings ?? null
  if (part === 'divide') {
    const w = p.division?.work
    return w ? `${w.statement} · ${w.verdict}` : null
  }
  return null
}

type Report = { error: string } | object | null
const ok = (r: Report): boolean => r !== null && !('error' in (r as object))

/** A circle theorems part as one line. */
export function circlePartText(p: CirclePanel | null | undefined, part: string, src: string | undefined): string | null {
  if (part === 'square') return writeStandard(src)
  if (!p) return null
  const any = p as unknown as Record<string, Report>
  const r = any[part]
  if (!ok(r)) return null
  if (part === 'angles' && p.angles && 'central' in p.angles) return `central ${p.angles.central.text} · inscribed ${p.angles.inscribed.text}`
  if (part === 'tangent' && p.tangent && 'line' in p.tangent) return p.tangent.line.slopeIntercept.text
  if (part === 'sector' && p.sector && 'arc' in p.sector) return `arc ${p.sector.arc.text} · area ${p.sector.area.text}`
  if (part === 'chords' && p.chords && 'product' in p.chords) {
    const m = p.chords.product as unknown as { text?: string } | number
    return typeof m === 'number' ? String(m) : (m.text ?? null)
  }
  if (part === 'external' && p.external && 'length' in p.external) {
    const m = p.external.length as unknown as { text?: string } | number
    return `TA = TB = ${typeof m === 'number' ? String(m) : (m.text ?? '')}`
  }
  return null
}

/** A shape's measurement part as one line, from the shape as the board draws it (unmasked). */
export function shapePartText(s: Shape | undefined, part: string): string | null {
  if (!s || s.kind === 'vector') return null
  const m = s.measure
  const list = (l: readonly (string | null)[] | undefined): string | null => {
    const t = (l ?? []).filter((x): x is string => typeof x === 'string' && x !== '')
    return t.length > 0 ? t.join(', ') : null
  }
  if (part === 'image') return 'drawn on the board'
  if (part === 'symmetry') return s.aids?.symText?.text ?? 'lines of symmetry drawn on the board'
  if (!m) return null
  switch (part) {
    case 'lengths':
      return list(m.lengths)
    case 'slopes':
      return list(m.slopes)
    case 'angles':
      return list(m.angles)
    case 'midpoints':
      return list(m.midpoints)
    case 'marks':
      return 'congruence marks drawn on the board'
    case 'area':
    case 'class': {
      const t = (m.summary ?? []).filter((l) => l.part === part).map((l) => l.text)
      return t.length > 0 ? t.join(' · ') : null
    }
    case 'pair':
      return m.pair ? [m.pair.length, m.pair.slope, m.pair.midpoint].filter(Boolean).join(' · ') || null : null
    case 'line':
      return m.equation ?? null
    default:
      return null
  }
}

/** A curve's Domain rows, as text (null when the card states none for it). */
export type DomainRows = { domain: string | null; range: string | null; oneToOne: string | null; inverse: string | null }

/** Everything the readers read: the live board's hooks, or a stored document rebuilt. */
export interface AnswerInputs {
  curves: readonly FittedCurve[]
  models: Record<string, ModelSpec>
  /** The letters on the figure (f, g, f′ …). */
  boardNames: Readonly<Record<string, string>>
  /** The stored letters, for a curve the figure does not name. */
  names: Readonly<Record<string, string>>
  exprSources: Readonly<Record<string, string>>
  pointOf(key: string): SpecialPoint | null
  domainRows(curveId: string): DomainRows | null
  calcLines: ReadonlyMap<string, CalcLine>
  tablePanelFor(curveId: string): TablePanel | null | undefined
  circlePanelFor(curveId: string): CirclePanel | null | undefined
  overlays: readonly Overlay[]
  ucFigures: readonly UnitCircleFigure[]
  rrFigures: readonly RelatedRatesFigure[]
  statsFigs: readonly StatsFigure[]
  seqCardFor(id: string): SequenceCardData | undefined
  fieldCardFor(id: string): FieldCardData | undefined
  sysCard: SystemCardData | null | undefined
  /** The shapes as the board draws them (unmasked). */
  screenShapes: readonly Shape[]
  /** The stored shapes (a colour when the drawn one is gone). */
  shapes: readonly BoardShape[]
  dataSets: readonly BoardData[]
  items: readonly NLItem[]
  /**
   * What a curve IS, when a sign chart on it says so ("the graph of f′ is
   * shown": the link's `as`). Absent or null: the curve is f itself.
   */
  signAs?(curveId: string): 'f1' | 'f2' | null
}

/** The name a curve's own facts go by: f′ for a curve a sign chart takes as f′, f″ as f″. */
export function takenAsName(name: string, as: 'f1' | 'f2' | null | undefined): string {
  return as === 'f1' ? `${name}′` : as === 'f2' ? `${name}″` : name
}

/**
 * The curve each sign chart says a curve IS (src/core/persist.ts SignChartLink.as):
 * curve id → 'f1' | 'f2', for the curves taken as a derivative.
 */
export function signAsOf(links: readonly { kind: string; parentId: string; as?: 'f1' | 'f2' }[]): Map<string, 'f1' | 'f2'> {
  const out = new Map<string, 'f1' | 'f2'>()
  for (const l of links) if (l.kind === 'signchart' && l.as && !out.has(l.parentId)) out.set(l.parentId, l.as)
  return out
}

/**
 * A Domain row that names its function ("f⁻¹(x) = …", "f isn’t one-to-one —
 * …") renamed to what the curve is taken as.
 */
function renameRow(text: string | null, from: string, to: string): string | null {
  if (text === null || from === to || !text.startsWith(from)) return text
  const rest = text.slice(from.length)
  return /^(⁻¹|\s|’|')/.test(rest) ? to + rest : text
}

/** The readers revealedAnswers.ts turns keys into lines with. */
export function answerSourcesOf(i: AnswerInputs): AnswerSources {
  const curveById = new Map(i.curves.map((c) => [c.id, c]))
  const baseName = (id: string): string => i.boardNames[id] ?? i.names[id] ?? 'the curve'
  const asOf = (id: string): 'f1' | 'f2' | null => {
    try {
      return i.signAs?.(id) ?? null
    } catch {
      return null
    }
  }
  return {
    curve(id) {
      const c = curveById.get(id)
      if (!c) return null
      // The graph of f′ is shown: its zeros and extrema are f′'s, and say so.
      return { name: takenAsName(baseName(id), asOf(id)), color: c.color }
    },
    point: (key) => i.pointOf(key),
    asymptotes(id) {
      const c = curveById.get(id)
      return c ? asymptoteTexts(c, i.models) : []
    },
    domain(id) {
      const rows = i.domainRows(id)
      const as = asOf(id)
      if (!rows || !as) return rows
      const from = baseName(id)
      const to = takenAsName(from, as)
      return { ...rows, oneToOne: renameRow(rows.oneToOne, from, to), inverse: renameRow(rows.inverse, from, to) }
    },
    complex(id) {
      const c = curveById.get(id)
      const z = c ? complexZerosOf(c, i.models) : null
      if (!z) return null
      return `${z.degree} zeros (${z.real} real, ${z.nonReal} non-real): ${z.zeros.map(zeroLine).join('; ')}`
    },
    family(id) {
      const c = curveById.get(id)
      return c ? familyFactLines(c.kind, i.exprSources[id]) : []
    },
    calc: (linkId) => i.calcLines.get(linkId) ?? null,
    table: (id, part) => tablePartText(i.tablePanelFor(id), part),
    circle: (id, part) => circlePartText(i.circlePanelFor(id) ?? null, part, i.exprSources[id]),
    chips(key) {
      return i.overlays
        .filter((ov: Overlay) => ov.kind === 'label' && ov.answer === key)
        .map((ov) => (ov as { text?: string }).text ?? '')
    },
    object(key) {
      const [head, id, part] = key.split(':')
      if (head === 'uc') {
        const f = i.ucFigures.find((u) => u.id === id)
        if (!f) return null
        return {
          label: `Unit circle · ${f.thetaText}`,
          value: [f.pointText, f.cosText, f.sinText, f.tanText].filter(Boolean).join(' · '),
          color: f.color,
          board: true,
        }
      }
      if (head === 'rr') {
        const f = i.rrFigures.find((r) => r.id === id)
        if (!f) return null
        return { label: 'Related rates', value: f.title?.text ?? (f.answers ?? []).join(' · '), color: f.color, board: true }
      }
      if (head === 'stat') {
        const f = i.statsFigs.find((s) => s.id === id)
        if (!f) return null
        return { label: f.title.question || 'Statistics', value: f.title.answer.replace(/^\s*·\s*/, ''), color: f.color, board: true }
      }
      if (head === 'series') {
        const sig = i.seqCardFor(id)?.sigma
        if (!sig) return null
        const sn = sig.sNText.startsWith('≈') ? `${sig.sNLabel} ${sig.sNText}` : `${sig.sNLabel} = ${sig.sNText}`
        return { label: 'Series', value: [sn, sig.sumText, sig.verdictText].filter(Boolean).join(' · ') }
      }
      if (head === 'euler') {
        const runs = i.fieldCardFor(id)?.eulers ?? []
        const t = runs.filter((r) => r.approx).map((r) => `${r.approx?.lhs} ≈ ${r.approx?.value.text}`)
        return { label: 'Euler’s method', value: t.join(' · '), color: runs[0]?.color ?? null }
      }
      if (head === 'system') {
        const lp = i.sysCard?.lp
        if (!lp) return null
        const corners = lp.region.vertices.map((v) => v.label).join('  ')
        const best = lp.objective?.result?.sentence ?? ''
        return { label: 'Linear programming', value: [best, corners ? `corners ${corners}` : ''].filter(Boolean).join(' · '), board: true }
      }
      if (head === 'shape') {
        const s = i.screenShapes.find((x) => x.id === id)
        const label =
          s && s.kind === 'polygon' && s.labels && s.labels.length > 0
            ? s.labels.join('')
            : s && s.kind === 'point' && s.label
              ? s.label
              : 'Shape'
        return { label, value: shapePartText(s, part), color: s?.color ?? i.shapes.find((x) => x.id === id)?.color ?? null, board: true }
      }
      if (head === 'tcalc') {
        // calculus on a data table: the sum, the estimate, the average, a theorem
        const d = i.dataSets.find((t) => t.id === id)
        if (!d) return null
        const a = tableCalcAnswer(d, part)
        return { label: a.label, value: a.value, color: a.color, board: part === 'sum' || part === 'deriv' || part === 'avg' }
      }
      if (head === 'solve') {
        // a number line's solved inequality (or a solved equation's candidate on the graph)
        const it = i.items.find((x) => x.id === id)
        if (it && it.kind === 'solve') {
          const r = solveCached(it.src)
          return { label: it.label ?? it.src, value: r.ok ? r.solution.text : null, color: it.color, board: true }
        }
        return null
      }
      return null
    },
  }
}
