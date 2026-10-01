// ============================================================================
// src/app/useExport.ts — export: the export scene, PNG, clipboard, vector formats and LaTeX.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { DARK_THEME, ppuX } from '../core/types'
import type { BoardKind } from '../core/types'
import { signBandHeight } from '../render/signChart'
import { toPdf } from '../render/vectorPdf'
import { toSvg } from '../render/vectorSvg'
import { toTikz } from '../render/vectorTikz'
import { drawContextMarkers } from '../ui/AnalysisOverlay'
import { constructionPoints } from '../ui/conicLinks'
import { unionBoxes } from '../ui/curveState'
import { dataBox } from '../ui/dataLinks'
import { clampFitSettings, contentBounds, exportViewport } from '../ui/exportFit'
import type { FitExportSettings } from '../ui/exportFit'
import type { CopyState } from '../ui/ExportMenu'
import { solveSpan } from '../ui/fieldLinks'
import { exportLook } from '../ui/figureStyle'
import { crossingsClearOf } from '../ui/intersections'
import { toPgfplots } from '../ui/pgfplotsExport'
import { relatedRatesBox } from '../ui/relatedRatesLinks'
import {
  canvasToPngBlob,
  captionHeight,
  exportGeometry,
  exportTheme,
  renderBoardToCanvas,
  sceneInk,
} from '../ui/renderBoard'
import type { BoardScene } from '../ui/renderBoard'
import { applyReveal } from '../ui/reveal'
import { partnerPolylines, sequenceBox } from '../ui/seqLinks'
import { hasExportSettings, readExportSettings, writeExportSettings } from '../ui/storage'
import { unitCircleBox } from '../ui/unitCircleLinks'
import { exportFileName, physicalViewport, PX_PER_CM, recordScene } from '../ui/vectorExport'
import type { ExportFormat } from '../ui/vectorExport'
import type { Box } from '../ui/viewScale'
import { EMPTY_ANALYSIS } from './constants'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'
import type { SessionStateApi } from './useSessionState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { NoticesApi } from './useNotices'
import type { CalcLinksApi } from './useCalcLinks'
import type { FieldsApi } from './useFields'
import type { ShapesApi } from './useShapes'
import type { DataTablesApi } from './useDataTables'
import type { UnitCircleApi } from './useUnitCircle'
import type { RelatedRatesApi } from './useRelatedRates'
import type { InequalitySystemApi } from './useInequalitySystem'
import type { BoardOverlaysApi } from './useBoardOverlays'
import type { SelectionMarksApi } from './useSelectionMarks'
import type { CurveNamesApi } from './useCurveNames'
import type { BoardLookApi } from './useBoardLook'
import type { RevealModeApi } from './useRevealMode'

/** What useExport reads from the hooks App calls before it. */
export interface ExportDeps {
  board: BoardStateApi
  docState: DocumentStateApi
  session: SessionStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  notices: NoticesApi
  calc: CalcLinksApi
  fieldsApi: FieldsApi
  shapesApi: ShapesApi
  tables: DataTablesApi
  unitCircle: UnitCircleApi
  rates: RelatedRatesApi
  system: InequalitySystemApi
  overlaysApi: BoardOverlaysApi
  marks: SelectionMarksApi
  naming: CurveNamesApi
  lookApi: BoardLookApi
  revealMode: RevealModeApi
}

export function useExport({ board, docState, session, refs, derived, notices, calc, fieldsApi, shapesApi, tables, unitCircle, rates, system, overlaysApi, marks, naming, lookApi, revealMode }: ExportDeps) {
  const { kind } = board
  const { docMeta } = docState
  const { setExportSettings, setCopyState } = session
  const {
    curvesRef, itemsRef, kindRef, stylesRef, selectedRef, exprSourcesRef, dataRef, seqRef, ucRef,
    rrRef, boardCurveNamesRef, boardGridRef, figureStyleRef, docMetaRef,
  } = refs
  const { modelsRef, analysisRef, axisUnitsRef, vpRef } = derived
  const { showToast } = notices
  const { crossSpanRef } = calc
  const { eulerPathsRef, fieldSceneRef, fieldPolylinesRef } = fieldsApi
  const { shapeSceneRef } = shapesApi
  const { seqCompiledRef, scatterSceneRef } = tables
  const { ucFiguresRef } = unitCircle
  const { rrFiguresRef } = rates
  const { ineqSolutionRef } = system
  const {
    exportSettingsRef, exportFormatRef, latexWidthRef, showAnalysisRef, contextAnalysisRef,
    overlaysRef,
  } = overlaysApi
  const { constructionSceneRef, constructionConicsRef, motionExportRef, copyTimerRef } = marks
  const { signFiguresRef } = naming
  const { captionTextRef, crossingsRef } = lookApi
  const { sceneRevealRef } = revealMode

  /**
   * The box every visible thing on the board occupies, in math coords — the
   * same measurement "Fit to curves" makes, so the exported frame and the
   * button that frames the screen agree by construction.
   */
  const exportContent = useCallback(() => {
    const vp = vpRef.current
    const half = vp.widthPx / 2 / vp.pxPerUnit
    const box = contentBounds({
      kind: kindRef.current,
      curves: curvesRef.current,
      items: itemsRef.current,
      models: modelsRef.current,
      window: [vp.center.x - half, vp.center.x + half],
    })
    if (kindRef.current !== 'cartesian') return box
    // A scatter plot is the figure too: a fitted export frames the points.
    // So is a conic's construction when it is on: its foci and box.
    const construction = constructionConicsRef.current.map((c): Box | null => {
      const pts = constructionPoints(c.spec)
      if (pts.length === 0) return null
      const xs = pts.map((p) => p.x)
      const ys = pts.map((p) => p.y)
      return {
        min: { x: Math.min(...xs), y: Math.min(...ys) },
        max: { x: Math.max(...xs), y: Math.max(...ys) },
      }
    })
    const seqBoxes = seqRef.current
      .filter((q) => q.visible)
      .map((q) => {
        const c = seqCompiledRef.current.get(q.id)
        return c ? sequenceBox(q, c) : null
      })
    const ucBoxes = ucRef.current.filter((u) => u.hidden !== true).map((u) => unitCircleBox(u))
    const rrBoxes = rrRef.current.filter((r) => r.hidden !== true).map((r) => relatedRatesBox(r))
    return unionBoxes([box, ...dataRef.current.filter((d) => d.visible).map(dataBox), ...construction, ...seqBoxes, ...ucBoxes, ...rrBoxes])
  }, [])

  const buildExportScene = useCallback(
    (settings: FitExportSettings, physicalCm?: number): BoardScene => {
    // PDF / TikZ / pgfplots: the same window laid out at the paper width (see
    // src/ui/vectorExport.ts). Everything below frames and draws it as usual.
    const vp =
      physicalCm !== undefined
        ? physicalViewport(vpRef.current, physicalCm, settings.margin)
        : vpRef.current
    const sel = curvesRef.current.find((c) => c.id === selectedRef.current) ?? null
    // The LOOK the teacher chose, in full — this is the scene it was chosen
    // FOR. The preview switch has no say here: it is a way of looking at this
    // answer on the board, never a way of changing it.
    const { figure, caption } = exportLook({
      style: figureStyleRef.current,
      caption: captionTextRef.current,
      cartesian: kindRef.current === 'cartesian',
    })
    // Not the window — the FIGURE. A number line exported as the window was
    // a 40px strip in a 2206x1826 image; a graph was whatever happened to be
    // on screen when Download was pressed.
    const content = settings.fit ? exportContent() : null
    // A caption is drawn inside this rect, so a frame fitted to the curves
    // has to be told to leave room for it — ALL of it: a long caption wraps
    // (up to three lines) at the plot's width, so the band is measured at the
    // width the frame will have. The width does not depend on the band (the
    // band comes out of the scale, not the size), so one pass without it says.
    let capPx = 0
    if (caption !== '') {
      const plain = exportViewport(vp, settings, content, kindRef.current, itemsRef.current, 0)
      capPx = captionHeight(null, caption, plain.widthPx)
    }
    // Sign-chart strips take a band above the caption's; a frame fitted to the
    // curves leaves room for it the same way.
    if (kindRef.current === 'cartesian' && signFiguresRef.current.length > 0) {
      capPx += signBandHeight(signFiguresRef.current, null)
    }
    const evp = exportViewport(vp, settings, content, kindRef.current, itemsRef.current, capPx)
    // A sequence's dashed partner is part of the figure: sampled across THIS
    // frame, which is not the screen's window when the export is fitted.
    const partners =
      kindRef.current === 'cartesian'
        ? partnerPolylines(
            seqRef.current,
            seqCompiledRef.current,
            solveSpan([
              evp.center.x - evp.widthPx / 2 / ppuX(evp),
              evp.center.x + evp.widthPx / 2 / ppuX(evp),
            ]),
          )
        : []
    const exportAnalysis =
      kindRef.current === 'cartesian' &&
      showAnalysisRef.current &&
      sel &&
      sel.visible &&
      analysisRef.current.length > 0
        ? { curve: sel, points: analysisRef.current }
        : null
    const scene: BoardScene = {
      vp: evp,
      // A figure style owns the ground; the Background control is disabled and
      // says so while one is on. Without a style this is exactly what it was.
      theme: figure
        ? figure.theme
        : exportTheme(settings, DARK_THEME),
      kind: kindRef.current,
      items: itemsRef.current,
      curves: curvesRef.current,
      styles: stylesRef.current,
      models: modelsRef.current,
      analysis: exportAnalysis,
      // Where the curves cross is a fact about the FIGURE, not a note the
      // editor is keeping, so the PNG gets the same list the screen drew, by
      // the same field — there is no second place that could forget it. And
      // by the same rule: a crossing on the selected curve's own marker
      // yields to it, so the file has one chip there too.
      intersections:
        kindRef.current === 'cartesian' &&
        (showAnalysisRef.current || (figure != null && figure.curveEnds === 'marked'))
          ? crossingsClearOf(
              crossingsRef.current,
              exportAnalysis ? exportAnalysis.points : EMPTY_ANALYSIS,
              crossSpanRef.current,
            )
          : undefined,
      // The screen palette is tuned against near-black and washes out on white
      // (amber lands near 1.7:1 — a copier renders it as nothing), so a light
      // export swaps every curve for its print counterpart.
      printColors: figure ? true : settings.theme === 'light',
      // The PNG is measured the way the screen is. This is the whole point of
      // there being one scene type: a π axis a teacher set for a trig lesson
      // has to be π in the file they paste into the worksheet.
      axisUnits: axisUnitsRef.current,
      // The shaded integral and the Riemann rectangles ARE the figure on a
      // calculus board. A PNG that dropped them would be the same bug the
      // analysis markers once had.
      overlays: overlaysRef.current,
      // A slope field and the solution curves through it ARE the figure on a
      // differential-equations board — there is often nothing else on it at
      // all — so they go into the exported scene by the same field the screen
      // uses rather than by a second code path that could forget them.
      fields: fieldSceneRef.current,
      // A conic's construction is exported only when its card says "show
      // construction" — then it is figure content, by the same two fields
      // the screen draws it with (polylines: directrix, asymptotes, box;
      // shapes: the foci F₁, F₂ and the vertices as points).
      // A particle is exported only when its card says "show particle in
      // export" — then it, its vectors and a polar curve's ray are figure
      // content by the same fields the screen draws them with.
      // A sequence's continuous partner, when its card says "show continuous
      // partner", is figure content by the same field again.
      polylines:
        constructionSceneRef.current.polylines.length > 0 || motionExportRef.current || partners.length > 0
          ? [
              ...fieldPolylinesRef.current,
              ...constructionSceneRef.current.polylines,
              ...(motionExportRef.current?.polylines ?? []),
              ...partners,
            ]
          : fieldPolylinesRef.current,
      // Euler's method is the figure on an Euler lesson: the path, its dots
      // and its "h = 0.5" tag go into the PNG by the same field the screen
      // draws them with (their true solutions ride in the polylines above).
      ...(eulerPathsRef.current.length > 0 ? { eulers: eulerPathsRef.current } : {}),
      // A triangle, a vector, a labelled point ARE the figure on a geometry
      // board — often the only thing on it — so they go into the exported
      // scene by the same field the screen uses rather than by a second code
      // path that could forget them.
      shapes:
        constructionSceneRef.current.shapes.length > 0 || motionExportRef.current
          ? [
              ...shapeSceneRef.current,
              ...constructionSceneRef.current.shapes,
              ...(motionExportRef.current?.shapes ?? []),
            ]
          : shapeSceneRef.current,
      // And the data: a scatter plot and its residuals are the lesson on a
      // regression board, so the PNG gets the same sets the screen drew.
      ...(scatterSceneRef.current.length > 0 ? { scatter: scatterSceneRef.current } : {}),
      // And the unit circle: the circle, its triangle, its labels and the
      // unwrapped graph are the figure on a trig board.
      ...(ucFiguresRef.current.length > 0 ? { unitCircles: ucFiguresRef.current } : {}),
      // And the related-rates picture and its mini-graph.
      ...(rrFiguresRef.current.length > 0 ? { relatedRates: rrFiguresRef.current } : {}),
      // And the sign charts' strips, along the bottom of the figure.
      ...(kindRef.current === 'cartesian' && signFiguresRef.current.length > 0
        ? { signCharts: signFiguresRef.current }
        : {}),
      // And the inequality system's solution region, as the screen shows it.
      ...(ineqSolutionRef.current ? { inequalitySolution: true } : {}),
      // And on the ruling the screen is on: a polar board exported on squares
      // would be a different picture of the same curve.
      grid: boardGridRef.current,
      // The LOOK, and the line printed under the figure. Both are the
      // document's, and both live HERE rather than on the board: the style is
      // what the teacher is exporting, not what they are drawing on. "Preview
      // on board" shows this same answer on the canvas for as long as it is on.
      ...(figure ? { figure } : {}),
      ...(caption !== '' ? { caption } : {}),
      // And who is who: under a marked style with two or more named curves,
      // each one's letter is drawn beside it. Absent under the screen look, so
      // an unstyled PNG is the command stream it always was.
      ...(figure ? { curveNames: boardCurveNamesRef.current } : {}),
      chrome: null,
    }
    // Reveal mode: the file is what the screen shows — hidden answers stay
    // hidden and their "?" marks are drawn — which makes a student copy in
    // one click. No rings: a file has no "a moment ago".
    const r = sceneRevealRef.current
    return r ? applyReveal(scene, { ...r, fresh: undefined, now: undefined }) : scene
    },
    [exportContent],
  )

  /**
   * The scene's analysis field describes ONE curve, so the other visible
   * curves' markers are drawn on top of the same picture, in the same
   * geometry — the export says exactly what the screen says. Shared by the
   * PNG and the vector formats, drawn in plot coordinates.
   */
  const paintExportExtras = useCallback(
    (ctx: CanvasRenderingContext2D, scene: BoardScene, settings: FitExportSettings): void => {
      const extra = contextAnalysisRef.current
      if (extra.length === 0 || kindRef.current !== 'cartesian' || !showAnalysisRef.current) return
      // The figure's own ink: black under SAT/AP, the print palette on white.
      const ink = sceneInk(scene)
      for (const m of extra) {
        drawContextMarkers(ctx, scene.vp, m.points, ink(m.curve.color), scene.theme.bg)
      }
    },
    [],
  )

  const renderExportCanvas = useCallback((): HTMLCanvasElement | null => {
    const settings = clampFitSettings(exportSettingsRef.current)
    const scene = buildExportScene(settings)
    const out = renderBoardToCanvas(scene, settings)
    if (!out) return null
    const extra = contextAnalysisRef.current
    if (extra.length > 0 && kindRef.current === 'cartesian' && showAnalysisRef.current) {
      const ctx = out.canvas.getContext('2d')
      if (ctx) {
        const geo = out.geometry
        ctx.save()
        ctx.setTransform(geo.scale, 0, 0, geo.scale, geo.margin, geo.margin)
        ctx.beginPath()
        ctx.rect(0, 0, scene.vp.widthPx, scene.vp.heightPx)
        ctx.clip()
        paintExportExtras(ctx, scene, settings)
        ctx.restore()
      }
    }
    return out.canvas
  }, [buildExportScene, paintExportExtras])

  const pngFileName = useCallback((): string => {
    const safe = docMetaRef.current.name.replace(/[^\w\d\-. ]+/g, '_').trim()
    return `${safe || 'grapher'}.png`
  }, [])

  const downloadBlob = useCallback(
    (blob: Blob, name?: string): void => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name ?? pngFileName()
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
    [pngFileName],
  )

  const exportPNG = useCallback((): void => {
    const canvas = renderExportCanvas()
    if (!canvas) {
      showToast('Couldn’t render the figure for export.')
      return
    }
    void canvasToPngBlob(canvas).then((blob) => {
      if (!blob) {
        showToast('Couldn’t render the figure for export.')
        return
      }
      downloadBlob(blob)
    })
  }, [renderExportCanvas, downloadBlob, showToast])

  const flashCopy = useCallback((next: CopyState): void => {
    setCopyState(next)
    window.clearTimeout(copyTimerRef.current)
    copyTimerRef.current = window.setTimeout(() => setCopyState({ kind: 'idle' }), 2200)
  }, [])

  useEffect(() => () => window.clearTimeout(copyTimerRef.current), [])

  /**
   * Why the clipboard can refuse, in the browser's own terms. Checked BEFORE
   * trying, so the honest message is available even where the attempt would
   * throw synchronously.
   */
  const clipboardBlockedBecause = (): string | null => {
    if (typeof window === 'undefined') return 'there is no browser here'
    if (!window.isSecureContext) {
      return 'this page isn’t on a secure (https) connection'
    }
    if (typeof window.ClipboardItem !== 'function') {
      return 'this browser can’t put images on the clipboard'
    }
    if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function') {
      return 'this browser has no clipboard write access'
    }
    return null
  }

  const describeClipboardError = (err: unknown): string => {
    const name = err instanceof Error ? err.name : ''
    if (name === 'NotAllowedError') {
      return 'the browser blocked it (the page has to be focused, and copying has to come from a click)'
    }
    if (name === 'SecurityError') return 'the browser blocked it for security reasons'
    if (name === 'DataError' || name === 'NotSupportedError') {
      return 'this browser won’t accept a PNG on the clipboard'
    }
    return 'the browser refused'
  }

  /**
   * Copy the figure to the clipboard, ready to paste into Word or Docs.
   *
   * Everything up to `clipboard.write` runs SYNCHRONOUSLY inside the click:
   * Safari treats an `await` as the end of the user gesture and rejects the
   * write, so the ClipboardItem is built around a PROMISE of the blob rather
   * than the blob itself. Every failure path ends in a download plus a message
   * saying what happened — a Copy button that quietly does nothing is worse
   * than no Copy button.
   */
  const copyPNG = useCallback((): void => {
    const canvas = renderExportCanvas()
    if (!canvas) {
      showToast('Couldn’t render the figure to copy.')
      return
    }
    const blobPromise = canvasToPngBlob(canvas).then((b) => {
      if (!b) throw new Error('png encode failed')
      return b
    })

    const fallBack = (reason: string): void => {
      blobPromise.then(
        (blob) => {
          downloadBlob(blob)
          flashCopy({ kind: 'fell-back', reason })
          showToast(`Couldn’t copy — ${reason}. Downloaded the PNG instead.`)
        },
        () => {
          flashCopy({ kind: 'idle' })
          showToast('Couldn’t produce a PNG to copy or download.')
        },
      )
    }

    const blocked = clipboardBlockedBecause()
    if (blocked !== null) {
      fallBack(blocked)
      return
    }

    setCopyState({ kind: 'working' })
    const done = (): void => {
      flashCopy({ kind: 'copied' })
      showToast('Copied the figure — paste it into a document.', { ms: 2600 })
    }

    try {
      const item = new ClipboardItem({ 'image/png': blobPromise })
      navigator.clipboard.write([item]).then(done, (err: unknown) => {
        // Some browsers accept a resolved Blob but not a promise of one; that
        // second attempt is outside the gesture, so it may itself be refused.
        blobPromise.then(
          (blob) => {
            try {
              navigator.clipboard
                .write([new ClipboardItem({ 'image/png': blob })])
                .then(done, () => fallBack(describeClipboardError(err)))
            } catch {
              fallBack(describeClipboardError(err))
            }
          },
          () => fallBack('the PNG could not be encoded'),
        )
      })
    } catch (err) {
      fallBack(describeClipboardError(err))
    }
  }, [renderExportCanvas, downloadBlob, flashCopy, showToast])

  // ------------------------------------------------------------ vector export
  //
  // SVG, PDF and TikZ are the SAME picture as the PNG: the export scene goes
  // through renderBoard into a recording context (src/render/vectorCtx.ts) and
  // the display list is written out. pgfplots is the mathematics instead,
  // built from the scene and the typed equations (src/ui/pgfplotsExport.ts).

  /** The source text / bytes of a vector format, or null when there is nothing to draw. */
  const buildVectorExport = useCallback(
    (format: Exclude<ExportFormat, 'png'>): { data: string | Uint8Array; mime: string } | null => {
      const settings = clampFitSettings(exportSettingsRef.current)
      const title = docMetaRef.current.name
      try {
        if (format === 'svg') {
          const scene = buildExportScene(settings)
          const list = recordScene(scene, settings.margin, (ctx) => paintExportExtras(ctx, scene, settings))
          const geo = exportGeometry(scene.vp, settings)
          return {
            data: toSvg(list, { pixelWidth: geo.w, pixelHeight: geo.h, title }),
            mime: 'image/svg+xml',
          }
        }
        const scene = buildExportScene(settings, latexWidthRef.current)
        if (format === 'pgfplots') {
          const extra =
            kindRef.current === 'cartesian' && showAnalysisRef.current ? contextAnalysisRef.current : []
          return {
            data: toPgfplots(scene, {
              widthCm: latexWidthRef.current,
              sources: exprSourcesRef.current,
              extraMarkers: extra,
              title,
            }),
            mime: 'application/x-tex',
          }
        }
        const list = recordScene(scene, settings.margin, (ctx) => paintExportExtras(ctx, scene, settings))
        if (format === 'pdf') return { data: toPdf(list, { title }), mime: 'application/pdf' }
        return { data: toTikz(list, { title }), mime: 'application/x-tex' }
      } catch {
        return null
      }
    },
    [buildExportScene, paintExportExtras],
  )

  const exportVector = useCallback(
    (format: Exclude<ExportFormat, 'png'>): void => {
      const out = buildVectorExport(format)
      if (!out) {
        showToast('Couldn’t render the figure for export.')
        return
      }
      const part = out.data as BlobPart
      downloadBlob(new Blob([part], { type: out.mime }), exportFileName(docMetaRef.current.name, format))
    },
    [buildVectorExport, downloadBlob, showToast],
  )

  /** Download in the chosen format — the primary click. */
  const exportCurrent = useCallback((): void => {
    const f = exportFormatRef.current
    if (f === 'png') exportPNG()
    else if (f === 'pgfplots' && kindRef.current !== 'cartesian') exportVector('tikz')
    else exportVector(f)
  }, [exportPNG, exportVector])

  const [latexCopyState, setLatexCopyState] = useState<CopyState>({ kind: 'idle' })
  const latexCopyTimerRef = useRef(0)
  useEffect(() => () => window.clearTimeout(latexCopyTimerRef.current), [])

  /** Put the TikZ / pgfplots source on the clipboard; download it if the clipboard refuses. */
  const copyLatex = useCallback((): void => {
    const f = exportFormatRef.current
    const format: 'tikz' | 'pgfplots' = f === 'pgfplots' && kindRef.current === 'cartesian' ? 'pgfplots' : 'tikz'
    const out = buildVectorExport(format)
    if (!out || typeof out.data !== 'string') {
      showToast('Couldn’t produce the LaTeX to copy.')
      return
    }
    const text = out.data
    const flash = (next: CopyState): void => {
      setLatexCopyState(next)
      window.clearTimeout(latexCopyTimerRef.current)
      latexCopyTimerRef.current = window.setTimeout(() => setLatexCopyState({ kind: 'idle' }), 2200)
    }
    const fallBack = (reason: string): void => {
      downloadBlob(new Blob([text], { type: 'application/x-tex' }), exportFileName(docMetaRef.current.name, format))
      flash({ kind: 'fell-back', reason })
      showToast(`Couldn’t copy — ${reason}. Downloaded the .tex file instead.`)
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      fallBack('this browser has no clipboard write access')
      return
    }
    setLatexCopyState({ kind: 'working' })
    navigator.clipboard.writeText(text).then(
      () => {
        flash({ kind: 'copied' })
        showToast(
          format === 'tikz'
            ? 'Copied the TikZ picture — paste it into your .tex file.'
            : 'Copied the pgfplots axis — paste it into your .tex file.',
          { ms: 2600 },
        )
      },
      (err: unknown) => fallBack(describeClipboardError(err)),
    )
  }, [buildVectorExport, downloadBlob, showToast])

  /** The physical size of a PDF / TikZ / pgfplots figure, in cm, margins included. */
  const physicalSizeOf = useCallback(
    (s: FitExportSettings, widthCm: number): { w: number; h: number } => {
      const base = physicalViewport(vpRef.current, widthCm, s.margin)
      const vp = exportViewport(base, s, s.fit ? exportContent() : null, kindRef.current, itemsRef.current)
      const m = exportFormatRef.current === 'pgfplots' ? 0 : 2 * s.margin
      return { w: (vp.widthPx + m) / PX_PER_CM, h: (vp.heightPx + m) / PX_PER_CM }
    },
    [exportContent],
  )

  /**
   * Output pixel size for a candidate setting. A function, not a memo: the
   * viewport is a mutable ref that pan/zoom/resize change without re-rendering
   * App, so the readout has to be computed when it is about to be shown.
   */
  const exportSizeOf = useCallback(
    (s: FitExportSettings): { w: number; h: number } => {
      const vp = exportViewport(
        vpRef.current,
        s,
        s.fit ? exportContent() : null,
        kindRef.current,
        itemsRef.current,
      )
      const geo = exportGeometry(vp, s)
      return { w: geo.w, h: geo.h }
    },
    [exportContent],
  )

  const changeExportSettings = useCallback((next: FitExportSettings): void => {
    const clean = clampFitSettings(next)
    setExportSettings(clean)
    writeExportSettings(docMetaRef.current.id, clean)
  }, [])

  /**
   * Export settings follow the DOCUMENT: a worksheet's figures have to come out
   * the same size as each other. A document that has none yet inherits the last
   * settings used, so the choice is made once and then stops being a decision.
   */
  const exportDocRef = useRef<string | null>(null)
  const exportKindRef = useRef<BoardKind | null>(null)
  useEffect(() => {
    const sameDoc = exportDocRef.current === docMeta.id
    if (sameDoc && exportKindRef.current === kind) return
    exportDocRef.current = docMeta.id
    exportKindRef.current = kind
    // The kind decides only the FRAMING default (a number line is nearly all
    // whitespace in any window); size, margin and ground still come from the
    // last document worked on, so a worksheet's figures match.
    //
    // A board that CHANGES kind re-reads that default too — a graph turned
    // into a number line would otherwise keep exporting the window, which is
    // the 90%-whitespace strip this option exists to stop. Once the teacher
    // has stated a framing for this document, it is theirs and nothing here
    // overrules it.
    if (sameDoc && hasExportSettings(docMeta.id)) return
    setExportSettings(readExportSettings(docMeta.id, kind))
  }, [docMeta.id, kind])

  return {
    exportPNG, copyPNG, exportVector, exportCurrent, latexCopyState, copyLatex, physicalSizeOf,
    exportSizeOf, changeExportSettings,
  }
}

export type ExportApi = ReturnType<typeof useExport>
