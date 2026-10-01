// ============================================================================
// src/app/useBoardOverlays.ts — what the board draws: overlays, and the cards' calculus facts.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useMemo, useRef } from 'react'
import { levelCrossings } from '../core/domainRange'
import { MODELS } from '../core/fit/models'
import type { FittedCurve } from '../core/types'
import { curveNames } from '../render/curveNames'
import { cardCalc, overlaysFor } from '../ui/calcLinks'
import type { CardCalc } from '../ui/calcLinks'
import type { BetweenInfo } from '../ui/CurveCard'
import { explicitF, familyF, hltVerdict, reflectProbe } from '../ui/domainLinks'
import { curveEquationText } from '../ui/equationText'
import type { FitExportSettings } from '../ui/exportFit'
import { isImplicitCurve } from '../ui/implicitLinks'
import { inverseColor } from '../ui/logLinks'
import { areaOverlayFor, motionKindOf } from '../ui/motionLinks'
import type { Overlay } from '../ui/renderBoard'
import { seriesOverlays } from '../ui/seqLinks'
import { signRange } from '../ui/signChartLinks'
import { keepStableEntries } from '../ui/stableProps'
import type { ExportFormat } from '../ui/vectorExport'
import { betweenCardInfo } from './between'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'
import type { SessionStateApi } from './useSessionState'
import type { ModelsApi } from './useModels'
import type { CalcLinksApi } from './useCalcLinks'
import type { DataTablesApi } from './useDataTables'
import type { DomainLensApi } from './useDomainLens'
import type { InequalitySystemApi } from './useInequalitySystem'

/** What useBoardOverlays reads from the hooks App calls before it. */
export interface BoardOverlaysDeps {
  board: BoardStateApi
  docState: DocumentStateApi
  session: SessionStateApi
  derived: ModelsApi
  calc: CalcLinksApi
  tables: DataTablesApi
  domain: DomainLensApi
  system: InequalitySystemApi
}

export function useBoardOverlays({ board, docState, session, derived, calc, tables, domain, system }: BoardOverlaysDeps) {
  const { curves, kind, motionPlay, motionPlayRef, lens, calcLinks, sequences, playEpoch } = board
  const { exprSources, displaySources, names, calls, inverses } = docState
  const { markersOn, canvasTheme, exportFormat, latexWidthCm, exportSettings } = session
  const { models, depKeys, contextAnalysis } = derived
  const { curveLabel, crossSpan, implicitBox } = calc
  const { seqCompiled } = tables
  const { baseModelOf, inverseSourceOf } = domain
  const { sysOverlays } = system

  // ------------------------------------------------------------------ export
  //
  // The exported PNG is not a second rendering of the board — it is the SAME
  // scene handed to the same renderBoard() the canvas uses, with two things
  // swapped: the theme (light, print-safe colours) and `chrome: null`, which
  // drops handles, hover/selection halos and live ink. Anything the teacher can
  // see that is part of the figure — grid, curves with their dash/opacity/width,
  // analysis markers and labels — is therefore in the file by construction, and
  // cannot silently go missing the way it did when export had its own code.
  const exportSettingsRef = useRef<FitExportSettings>(exportSettings)
  exportSettingsRef.current = exportSettings
  const exportFormatRef = useRef<ExportFormat>(exportFormat)
  exportFormatRef.current = exportFormat
  const latexWidthRef = useRef<number>(latexWidthCm)
  latexWidthRef.current = latexWidthCm
  const showAnalysisRef = useRef(markersOn)
  showAnalysisRef.current = markersOn
  const canvasThemeRef = useRef(canvasTheme)
  canvasThemeRef.current = canvasTheme
  const contextAnalysisRef = useRef(contextAnalysis)

  // ------------------------------------------------- what the board draws
  //
  // The shading and the rectangles are FIGURE, not chrome: they carry the
  // mathematics the lesson is about, so they go into the scene and reach the
  // exported PNG through exactly the same field the screen uses.
  /**
   * A polar curve's "shade area from θ = a to b": a region fanned from the
   * pole — the pole, r(θ) from a to b, back to the pole. FIGURE content (the
   * AP polar-area picture), drawn selected or not and exported. Keyed on the
   * area settings alone, so a playing particle does not re-sample it.
   */
  const motionAreaKey = Object.entries(motionPlay)
    .filter(([, p]) => p.area?.on)
    .map(([id, p]) => `${id}:${p.area!.a}:${p.area!.b}`)
    .join('|')
  const motionAreaOverlays = useMemo<Overlay[]>(() => {
    if (kind !== 'cartesian' || motionAreaKey === '') return []
    const out: Overlay[] = []
    for (const c of curves) {
      const p = motionPlayRef.current[c.id]
      if (!p?.area?.on || !c.visible || motionKindOf(c, models) !== 'polar') continue
      const r = areaOverlayFor(c, models, p.area)
      if (r) out.push({ kind: 'region', boundary: r.boundary, color: c.color, alpha: 0.28 })
    }
    return out
  }, [kind, curves, models, motionAreaKey])
  // A Taylor error band is sampled across the padded view, so it is the one
  // overlay that has to follow a pan — and only it asks for the span.
  const bandSpan = calcLinks.some((l) => l.kind === 'taylor' && l.band === true) ? crossSpan : null
  // --------------------------------------------- the Domain section on the board
  //
  // Figure content, like a shaded integral: a switch on a card puts it on the
  // board AND in the export (under SAT / AP it comes out in the mono ink).
  //   ghost    a restricted function's whole graph, faint and dashed, behind it
  //   hlt      the horizontal line test: the line, and a dot at every crossing —
  //            warning-coloured at two or more, the passing colour otherwise
  //   reflect  (a, f(a)), its mirror (f(a), a), and the segment across y = x

  /** What the ghost of the cut-off part draws: a typed line's body, or a sketch's family everywhere. */
  const ghostFunctionOf = useCallback(
    (curve: FittedCurve): ((x: number) => number) | null => {
      if (curve.kind !== 'explicit') return null
      if (curve.modelId.startsWith('expr_') && exprSources[curve.id]) {
        const spec = baseModelOf(curve)
        const ev = spec?.evalExplicit
        if (!spec || !ev) return null
        const params = curve.params.slice()
        return (x: number): number => {
          try {
            const v = ev.call(spec, params, x)
            return typeof v === 'number' ? v : Number.NaN
          } catch {
            return Number.NaN
          }
        }
      }
      if (MODELS[curve.modelId] && curve.domain) return familyF(curve, models)
      return null
    },
    // exprSources / calls: the body (and what it calls) is what the ghost draws.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exprSources, calls, baseModelOf, models],
  )

  const domainOverlays = useMemo<Overlay[]>(() => {
    if (kind !== 'cartesian') return []
    const ids = Object.keys(lens)
    if (ids.length === 0) return []
    const out: Overlay[] = []
    const marks: Overlay[] = []
    for (const c of curves) {
      const l = lens[c.id]
      if (!l || !c.visible || c.kind !== 'explicit') continue
      if (l.ghost) {
        const g = ghostFunctionOf(c)
        if (g) out.push({ kind: 'ghost', curveId: c.id, f: g })
      }
      if (l.hlt !== undefined) {
        let xs: number[] = []
        try {
          xs = levelCrossings(c, models, l.hlt, crossSpan)
        } catch {
          xs = []
        }
        const v = hltVerdict(xs)
        marks.push({ kind: 'hline', curveId: c.id, y: l.hlt, color: v.color })
        for (const x of xs) marks.push({ kind: 'dot', curveId: c.id, at: { x, y: l.hlt }, color: v.color })
      }
      if (l.reflect !== undefined) {
        const f = explicitF(c, models)
        const pr = f ? reflectProbe(f, l.reflect) : null
        if (pr) {
          marks.push({ kind: 'segment', curveId: c.id, from: pr.p, to: pr.q, dashed: true })
          marks.push({ kind: 'dot', curveId: c.id, at: pr.p })
          marks.push({ kind: 'dot', curveId: c.id, at: pr.q, color: inverseColor(c.color), hollow: false })
        }
      }
    }
    return out.length + marks.length === 0 ? [] : [...out, ...marks]
    // depKeys: a line that calls f moves when f does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, lens, curves, models, crossSpan, ghostFunctionOf, depKeys])

  /** Σ aₙ on the board: staircase bars, the joined sums, the band, y = S. */
  const seriesMarks = useMemo<Overlay[]>(
    () => (kind === 'cartesian' && sequences.some((q) => q.series) ? seriesOverlays(sequences, seqCompiled) : []),
    [kind, sequences, seqCompiled],
  )

  /**
   * The equations of the implicit curves that carry a tangent, as typed (or
   * as their family prints them): what dy/dx is differentiated from.
   */
  const implicitSources = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    if (kind !== 'cartesian') return out
    for (const l of calcLinks) {
      if (l.kind !== 'tangent' || out[l.parentId] !== undefined) continue
      const c = curves.find((cc) => cc.id === l.parentId)
      if (!c || !isImplicitCurve(c, models) || (calls[c.id]?.length ?? 0) > 0) continue
      const src = inverseSourceOf(c)
      if (src) out[c.id] = src
    }
    return out
    // exprSources: a retyped equation keeps its curve id.
  }, [kind, calcLinks, curves, models, calls, inverseSourceOf, exprSources])

  const overlays = useMemo<Overlay[]>(() => {
    const base =
      kind === 'cartesian'
        ? overlaysFor(calcLinks, curves, models, bandSpan, { sources: implicitSources, box: implicitBox }, depKeys)
        : []
    const more = motionAreaOverlays.length + domainOverlays.length + sysOverlays.length + seriesMarks.length
    if (more === 0) return base
    // The ghost goes first (under everything else); the marks sort themselves
    // onto the curves by kind.
    return [...domainOverlays, ...base, ...motionAreaOverlays, ...sysOverlays, ...seriesMarks]
    // depKeys: a secant, limit or volume on p(x) = h(x) + 1 moves when h is retyped.
  }, [kind, calcLinks, curves, models, motionAreaOverlays, bandSpan, domainOverlays, sysOverlays, seriesMarks, implicitSources, implicitBox, depKeys])
  const overlaysRef = useRef<Overlay[]>(overlays)
  overlaysRef.current = overlays

  /**
   * The x-range sign charts are analysed over: the view joined with
   * [−10, 10] (signRange). Only its two numbers are state, so a pan inside
   * [−10, 10] — or any pan on a board with no sign chart — changes nothing.
   */
  const hasSignCharts = calcLinks.some((l) => l.kind === 'signchart')
  const signLo = hasSignCharts ? signRange(crossSpan)[0] : -10
  const signHi = hasSignCharts ? signRange(crossSpan)[1] : 10
  const signSpan = useMemo<[number, number]>(() => [signLo, signHi], [signLo, signHi])

  /** Everything the cards say about calculus, computed once for all of them. */
  const calcCardsPrevRef = useRef<Record<string, CardCalc> | null>(null)
  const calcCards = useMemo<Record<string, CardCalc>>(() => {
    if (kind !== 'cartesian') return {}
    // The board's own letters, so an accumulation reads "g(x) = ∫₀ˣ f(t) dt"
    // with the names on the figure. Only asked for when there is one.
    // The STORED letters too, so "f isn't differentiable at a = 1" names the
    // curve by the letter its own card wears.
    const letters = calcLinks.some(
      (l) =>
        l.kind === 'accumulation' ||
        l.kind === 'taylor' ||
        l.kind === 'secant' ||
        l.kind === 'limit' ||
        l.kind === 'volume' ||
        l.kind === 'signchart' ||
        l.kind === 'polarbetween',
    )
      ? curveNames(curves, { ...displaySources, ...exprSources }, calcLinks, names, inverses)
      : {}
    // A volume writes its integral with the typed formulas — R(x) = √x, not
    // f(x) — for the curves that are typed lines and call no other curve.
    const sources: Record<string, string> = {}
    for (const l of calcLinks) {
      if (l.kind !== 'volume') continue
      for (const id of [l.parentId, l.otherId]) {
        if (!id || sources[id] !== undefined) continue
        const c = curves.find((cc) => cc.id === id)
        if (!c || !c.modelId.startsWith('expr_') || (calls[id]?.length ?? 0) > 0) continue
        const src = inverseSourceOf(c)
        if (src) sources[id] = src
      }
    }
    for (const [id, src] of Object.entries(implicitSources)) if (sources[id] === undefined) sources[id] = src
    // Parametric / polar calculus writes dy/dx from the typed line itself —
    // interval and all — or, for a sketched polar family, from its equation.
    // A line that calls another curve is measured, never written.
    for (const l of calcLinks) {
      if (l.kind !== 'pcalc' && l.kind !== 'polarbetween') continue
      for (const id of l.kind === 'polarbetween' ? [l.parentId, l.otherId] : [l.parentId]) {
        if (sources[id] !== undefined || (calls[id]?.length ?? 0) > 0) continue
        const c = curves.find((cc) => cc.id === id)
        if (!c) continue
        let src: string | null = exprSources[c.id] ?? null
        if (!src && !c.modelId.startsWith('expr_')) {
          try {
            src = curveEquationText(c, models[c.modelId])
          } catch {
            src = null
          }
        }
        if (src) sources[id] = src
      }
    }
    // A hidden parent has no board letter; its CARD's name stands in for it
    // (stored letter, typed head, or the letter it would wear if shown), so
    // a limit on a hidden h is "lim h(x)", never "lim f(x)".
    const hiddenParent = calcLinks.some((l) => {
      const c = curves.find((cc) => cc.id === l.parentId)
      return c !== undefined && !c.visible
    })
    const cardLetters = hiddenParent
      ? curveNames(
          curves.map((c) => (c.visible ? c : { ...c, visible: true })),
          { ...displaySources, ...exprSources },
          calcLinks,
          names,
          inverses,
        )
      : {}
    const out = cardCalc(
      calcLinks,
      curves,
      models,
      curveLabel,
      letters,
      calls,
      sources,
      implicitBox,
      depKeys,
      cardLetters,
      signSpan,
    )
    // Undo/redo's epoch: the Taylor ▶ demo is keyed on it (see playEpoch).
    if (playEpoch !== 0) for (const card of Object.values(out)) card.epoch = playEpoch
    // A card whose rows came out the same keeps the same object, so its
    // memoised card skips the render (src/ui/stableProps.ts).
    const stable = keepStableEntries(calcCardsPrevRef.current, out)
    calcCardsPrevRef.current = stable
    return stable
  }, [
    playEpoch,
    depKeys,
    kind,
    calcLinks,
    curves,
    models,
    curveLabel,
    displaySources,
    exprSources,
    calls,
    names,
    inverses,
    inverseSourceOf,
    implicitSources,
    implicitBox,
    signSpan,
  ])
  const calcFor = useCallback(
    (id: string): CardCalc | undefined => calcCards[id],
    [calcCards],
  )

  /**
   * What each card knows about areas BETWEEN curves.
   *
   * Two separate facts, neither of which is about the curve's own links, which
   * is why they are not in CardCalc: whether the board currently holds a
   * second curve to point at (the menu item's whole condition), and whether
   * this curve is the far side of a region some other card owns.
   */
  const betweenPrevRef = useRef<Record<string, BetweenInfo> | null>(null)
  const betweenCards = useMemo<Record<string, BetweenInfo>>(() => {
    const out = kind === 'cartesian' ? betweenCardInfo(curves, models, calcLinks, curveLabel) : {}
    const stable = keepStableEntries(betweenPrevRef.current, out)
    betweenPrevRef.current = stable
    return stable
  }, [kind, curves, models, calcLinks, curveLabel])

  const betweenFor = useCallback(
    (id: string): BetweenInfo | undefined => betweenCards[id],
    [betweenCards],
  )

  return {
    exportSettingsRef, exportFormatRef, latexWidthRef, showAnalysisRef, contextAnalysisRef,
    overlays, overlaysRef, hasSignCharts, signSpan, calcCards, calcFor, betweenCards, betweenFor,
  }
}

export type BoardOverlaysApi = ReturnType<typeof useBoardOverlays>
