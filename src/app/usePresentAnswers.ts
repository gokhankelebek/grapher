// ============================================================================
// src/app/usePresentAnswers.ts — reveal mode in presentation: the answers the
// class has seen, as lines for the board's "Revealed answers" panel.
//
// Presentation hides the sidebar, where most revealed values live (a sum, a
// domain, a classification). This hook reads each revealed key's value from
// what the cards themselves are built from (src/ui/revealedAnswers.ts maps a
// key to its line) — only while presentation AND reveal mode are both on, so
// an ordinary board pays nothing for it.
//
// Called once per render by App (src/App.tsx), after every hook it reads.
// ============================================================================

import { useMemo } from 'react'
import { asymptoteTexts } from '../ui/CurveCard'
import { complexZerosOf } from '../ui/complexLinks'
import { zeroLine } from '../core/complexZeros'
import { familyFactLines } from '../ui/familyFacts'
import { oneToOneText, setRowText } from '../ui/domainLinks'
import { writeStandard } from '../ui/conicLinks'
import { solveCached } from '../ui/nlSolve'
import { revealedLines } from '../ui/revealedAnswers'
import type { AnswerLine, AnswerSources } from '../ui/revealedAnswers'
import type { CardCalc } from '../ui/calcLinks'
import type { CirclePanel } from '../ui/circleLinks'
import type { TablePanel } from '../ui/valueTableLinks'
import type { Overlay } from '../render/overlays'
import type { Shape } from '../core/types'
import type { RevealInventory } from '../ui/reveal'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'
import type { SessionStateApi } from './useSessionState'
import type { ModelsApi } from './useModels'
import type { BoardOverlaysApi } from './useBoardOverlays'
import type { DomainPanelApi } from './useDomainPanel'
import type { ValueTablesApi } from './useValueTables'
import type { CircleViewsApi } from './useCircleViews'
import type { DataTablesApi } from './useDataTables'
import type { FieldsApi } from './useFields'
import type { InequalitySystemApi } from './useInequalitySystem'
import type { UnitCircleApi } from './useUnitCircle'
import type { RelatedRatesApi } from './useRelatedRates'
import type { StatsApi } from './useStats'
import type { SelectionMarksApi } from './useSelectionMarks'
import type { CurveNamesApi } from './useCurveNames'

export interface PresentAnswersDeps {
  board: BoardStateApi
  docState: DocumentStateApi
  session: SessionStateApi
  derived: ModelsApi
  overlaysApi: BoardOverlaysApi
  panel: DomainPanelApi
  valueTablesApi: ValueTablesApi
  circleViewsApi: CircleViewsApi
  tables: DataTablesApi
  fieldsApi: FieldsApi
  system: InequalitySystemApi
  unitCircle: UnitCircleApi
  rates: RelatedRatesApi
  statsApi: StatsApi
  marks: SelectionMarksApi
  naming: CurveNamesApi
  revealInv: RevealInventory | null
}

const ORIGIN_WORD: Record<string, string> = {
  tangent: 'tangent line',
  derivative: 'derivative',
  accumulation: 'accumulation function',
  taylor: 'Taylor polynomial',
}

type CalcLine = { label: string; value: string; curveId: string | null; board?: boolean }

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
    for (const s of card.signs) put(s.linkId, { label: 'sign chart', value: s.title, curveId, board: true })
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

export function usePresentAnswers(deps: PresentAnswersDeps): AnswerLine[] {
  const { board, docState, session, derived, overlaysApi, panel, valueTablesApi, circleViewsApi } = deps
  const { tables, fieldsApi, system, unitCircle, rates, statsApi, marks, naming, revealInv } = deps
  const { curves, items, shapes } = board
  const { exprSources, names } = docState
  const { reveal, presentMode, setNotation } = session
  const { models } = derived
  const { calcCards, overlays } = overlaysApi
  const { domainPanel } = panel
  const { tablePanelFor } = valueTablesApi
  const { circlePanelFor } = circleViewsApi
  const { seqCardFor } = tables
  const { fieldCardFor } = fieldsApi
  const { sysCard } = system
  const { ucFigures } = unitCircle
  const { rrFigures } = rates
  const { statsFigs } = statsApi
  const { screenShapes } = marks
  const { boardCurveNames } = naming

  const on = presentMode && reveal.on && revealInv !== null
  const calcLines = useMemo(() => (on ? calcLinesOf(calcCards) : new Map<string, CalcLine>()), [on, calcCards])

  return useMemo<AnswerLine[]>(() => {
    if (!on || !revealInv) return []
    const curveById = new Map(curves.map((c) => [c.id, c]))
    const sources: AnswerSources = {
      curve(id) {
        const c = curveById.get(id)
        if (!c) return null
        return { name: boardCurveNames[id] ?? names[id] ?? 'the curve', color: c.color }
      },
      point: (key) => revealInv.pointOf(key),
      asymptotes(id) {
        const c = curveById.get(id)
        return c ? asymptoteTexts(c, models) : []
      },
      domain(id) {
        const p = domainPanel
        if (!p || p.ownerId !== id) return null
        return {
          domain: setRowText(p.domain, setNotation),
          range: setRowText(p.range, setNotation),
          oneToOne: oneToOneText(p.oneToOne),
          inverse: p.inverse?.text ? `${p.name}⁻¹(x) = ${p.inverse.text}` : (p.inverse?.why ?? null),
        }
      },
      complex(id) {
        const c = curveById.get(id)
        const z = c ? complexZerosOf(c, models) : null
        if (!z) return null
        return `${z.degree} zeros (${z.real} real, ${z.nonReal} non-real): ${z.zeros.map(zeroLine).join('; ')}`
      },
      family(id) {
        const c = curveById.get(id)
        return c ? familyFactLines(c.kind, exprSources[id]) : []
      },
      calc: (linkId) => calcLines.get(linkId) ?? null,
      table: (id, part) => tablePartText(tablePanelFor(id), part),
      circle: (id, part) => circlePartText(circlePanelFor(id) ?? null, part, exprSources[id]),
      chips(key) {
        return overlays
          .filter((ov: Overlay) => ov.kind === 'label' && ov.answer === key)
          .map((ov) => (ov as { text?: string }).text ?? '')
      },
      object(key) {
        const [head, id, part] = key.split(':')
        if (head === 'uc') {
          const f = ucFigures.find((u) => u.id === id)
          if (!f) return null
          return {
            label: `Unit circle · ${f.thetaText}`,
            value: [f.pointText, f.cosText, f.sinText, f.tanText].filter(Boolean).join(' · '),
            color: f.color,
            board: true,
          }
        }
        if (head === 'rr') {
          const f = rrFigures.find((r) => r.id === id)
          if (!f) return null
          return { label: 'Related rates', value: f.title?.text ?? (f.answers ?? []).join(' · '), color: f.color, board: true }
        }
        if (head === 'stat') {
          const f = statsFigs.find((s) => s.id === id)
          if (!f) return null
          return { label: f.title.question || 'Statistics', value: f.title.answer.replace(/^\s*·\s*/, ''), color: f.color, board: true }
        }
        if (head === 'series') {
          const sig = seqCardFor(id)?.sigma
          if (!sig) return null
          const sn = sig.sNText.startsWith('≈') ? `${sig.sNLabel} ${sig.sNText}` : `${sig.sNLabel} = ${sig.sNText}`
          return { label: 'Series', value: [sn, sig.sumText, sig.verdictText].filter(Boolean).join(' · ') }
        }
        if (head === 'euler') {
          const runs = fieldCardFor(id)?.eulers ?? []
          const t = runs.filter((r) => r.approx).map((r) => `${r.approx?.lhs} ≈ ${r.approx?.value.text}`)
          return { label: 'Euler’s method', value: t.join(' · '), color: runs[0]?.color ?? null }
        }
        if (head === 'system') {
          const lp = sysCard?.lp
          if (!lp) return null
          const corners = lp.region.vertices.map((v) => v.label).join('  ')
          const best = lp.objective?.result?.sentence ?? ''
          return { label: 'Linear programming', value: [best, corners ? `corners ${corners}` : ''].filter(Boolean).join(' · '), board: true }
        }
        if (head === 'shape') {
          const s = screenShapes.find((x) => x.id === id)
          const label =
            s && s.kind === 'polygon' && s.labels && s.labels.length > 0
              ? s.labels.join('')
              : s && s.kind === 'point' && s.label
                ? s.label
                : 'Shape'
          return { label, value: shapePartText(s, part), color: s?.color ?? shapes.find((x) => x.id === id)?.color ?? null, board: true }
        }
        if (head === 'solve') {
          // a number line's solved inequality (or a solved equation's candidate on the graph)
          const it = items.find((i) => i.id === id)
          if (it && it.kind === 'solve') {
            const r = solveCached(it.src)
            return { label: it.label ?? it.src, value: r.ok ? r.solution.text : null, color: it.color, board: true }
          }
          return null
        }
        return null
      },
    }
    return revealedLines(reveal, revealInv.order, sources)
  }, [
    on, revealInv, reveal, curves, items, shapes, boardCurveNames, names, models, domainPanel, setNotation,
    exprSources, calcLines, tablePanelFor, circlePanelFor, overlays, ucFigures, rrFigures, statsFigs,
    seqCardFor, fieldCardFor, sysCard, screenShapes,
  ])
}
