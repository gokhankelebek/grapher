// ============================================================================
// src/app/useBoardRefs.ts — the mirror refs every callback reads the live board through.
//
// Undo/redo stacks, per-kind content refs, the calculus sync's caches, the
// autosave's bookkeeping and the state the last load put on the board.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useRef, useState } from 'react'
import type {
  AxisUnitChoices,
  BoardGrid,
  BoardIneqSystem,
  DocMeta,
  InverseLink,
  StyleMap,
} from '../core/persist'
import type { BoardKind, FigureStyleId, FitResult, FittedCurve, NLItem, Vec2 } from '../core/types'
import type { CalcLink } from '../ui/calcLinks'
import { makeFitCache } from '../ui/dataLinks'
import type { BoardData } from '../ui/dataLinks'
import type { BoardField } from '../ui/fieldLinks'
import type { BoardRelatedRates } from '../ui/relatedRatesLinks'
import type { BoardSequence } from '../ui/seqLinks'
import type { BoardShape } from '../ui/shapeLinks'
import type { BoardUnitCircle } from '../ui/unitCircleLinks'
import type { CurveEdit, Snapshot } from './types'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'
import type { SessionStateApi } from './useSessionState'

/** What useBoardRefs reads from the hooks App calls before it. */
export interface BoardRefsDeps {
  board: BoardStateApi
  docState: DocumentStateApi
  session: SessionStateApi
}

export function useBoardRefs({ board, docState, session }: BoardRefsDeps) {
  const { boardGrid, figureStyle, figureCaption } = board
  const { docMeta } = docState
  const { axisUnitChoice } = session

  const curvesRef = useRef<FittedCurve[]>([])
  const itemsRef = useRef<NLItem[]>([])
  const kindRef = useRef<BoardKind>('cartesian')
  const stylesRef = useRef<StyleMap>({})
  const selectedRef = useRef<string | null>(null)
  const undoRef = useRef<Snapshot[]>([])
  const redoRef = useRef<Snapshot[]>([])
  const preEditRef = useRef<Snapshot | null>(null)
  /**
   * A live edit (slider drag, handle drag, held arrow key) is in progress:
   * the bracket editStart … editEnd. State, not just the ref, so the dear
   * derived values throttled during it get their final pass on release.
   */
  const [gesturing, setGesturing] = useState(false)
  const candidatesRef = useRef<Map<string, FitResult[]>>(new Map())
  const exprCounterRef = useRef(0)
  const altRef = useRef(false)
  const snapTimerRef = useRef(0)
  const shakeTimerRef = useRef(0)
  const toastTimerRef = useRef(0)
  const exprSourcesRef = useRef<Record<string, string>>({})
  const brokenExprRef = useRef<Record<string, string>>({})
  const displaySourcesRef = useRef<Record<string, string>>({})
  const axisUnitChoiceRef = useRef<AxisUnitChoices>(axisUnitChoice)
  axisUnitChoiceRef.current = axisUnitChoice
  const editsRef = useRef<Record<string, CurveEdit[]>>({})
  const calcRef = useRef<CalcLink[]>([])
  const fieldsRef = useRef<BoardField[]>([])
  const shapesRef = useRef<BoardShape[]>([])
  const dataRef = useRef<BoardData[]>([])
  const seqRef = useRef<BoardSequence[]>([])
  const ucRef = useRef<BoardUnitCircle[]>([])
  const rrRef = useRef<BoardRelatedRates[]>([])
  const sysRef = useRef<BoardIneqSystem | null>(null)
  const namesRef = useRef<Record<string, string>>({})
  const callsRef = useRef<Record<string, string[]>>({})
  const inversesRef = useRef<InverseLink[]>([])
  /**
   * The board's derived curve letters (boardCurveNames, below), mirrored for the
   * callbacks declared above it. Assigned on every render where boardCurveNames
   * is computed.
   */
  const boardCurveNamesRef = useRef<Record<string, string>>({})
  /**
   * regressionId -> the equation the regression sync last wrote on (or found
   * on) its curve. A curve whose equation is neither that nor what the table
   * now says was edited by hand, and the regression lets go of it.
   */
  const regWrittenRef = useRef<Map<string, string>>(new Map())
  /** Regressions whose curve the BOARD hid because the fit stopped existing. */
  const regAutoHiddenRef = useRef<Set<string>>(new Set())
  /** Fits, cached on the numbers: the sync asks on every board change. */
  const fitCacheRef = useRef(makeFitCache())
  /**
   * The undo entry a run of typing in ONE cell folds into, and which cell it
   * is: every keystroke re-fits live, but one cell edit is one undo.
   */
  const cellFoldRef = useRef<{ key: string; snap: Snapshot } | null>(null)
  /** frameBox, reachable from the data handlers declared above it. */
  const frameBoxRef = useRef<(box: { min: Vec2; max: Vec2 }) => void>(() => {})
  const boardGridRef = useRef<BoardGrid>('cartesian')
  boardGridRef.current = boardGrid
  const figureStyleRef = useRef<FigureStyleId>('screen')
  figureStyleRef.current = figureStyle
  const figureCaptionRef = useRef<string | null>(null)
  figureCaptionRef.current = figureCaption
  /**
   * True once this document has been offered the polar ruling, so a board with
   * three roses on it asks once rather than three times. Reset by a load: the
   * next document has not been asked.
   */
  const polarOfferedRef = useRef(false)
  /** Highest dfdx_N registered, so a new derivative cannot collide with one. */
  const derivCounterRef = useRef(0)
  /**
   * linkId -> the parent state the dependent was last rebuilt from. The sync
   * pass compares against it, so a dependent is recomputed exactly when its
   * parent moved — and a derivative curve whose own slider the teacher dragged
   * is left alone until the parent says otherwise.
   */
  const calcSigRef = useRef<Map<string, string>>(new Map())
  /**
   * Each curve's domain the last time the calculus sync ran, so a limit that
   * sat on an end of the sketch can ride that end when it is dragged.
   */
  const calcDomainRef = useRef<Map<string, [number, number] | null>>(new Map())
  /**
   * Links whose curve the BOARD hid because the mathematics went away (a
   * tangent at a corner). Remembered so restoring it can never override a
   * teacher who hid the curve themselves.
   */
  const calcAutoHiddenRef = useRef<Set<string>>(new Set())
  /**
   * linkId -> the parent family a numerically-differentiated derivative's
   * closure was built from. It only has to be rebuilt when THAT changes; on a
   * slider tick the same closure with new params is the same mathematics.
   */
  const calcSpecOriginRef = useRef<Map<string, string>>(new Map())
  const docMetaRef = useRef<DocMeta>(docMeta)
  const saveTimerRef = useRef(0)
  /** Nothing may be written until the stored document has been read in. */
  const hydratedRef = useRef(false)
  /**
   * True once the open document actually exists in storage (loaded from it, or
   * written at least once). Only then can "the record is gone" mean another tab
   * deleted it rather than "we haven't saved it yet".
   */
  const docStoredRef = useRef(false)
  /** Skips the one autosave run that happens in the same pass as a load. */
  const skipAutosaveRef = useRef(false)
  /**
   * True from the moment the autosave effect sees a change (scheduleSave)
   * until a write succeeds; false again after a load. It is the autosave's own
   * notion of "changed", so switching documents does not re-write — and
   * re-stamp — a document nobody touched, which locked a second tab out of
   * saving ("changed in another tab").
   */
  const unsavedRef = useRef(false)
  /**
   * The exact state a load put on the board. While the board is still identical
   * to it, autosave stays quiet: re-writing a document just because it was
   * opened bumped its modifiedAt for no reason, which — now that writes are
   * checked against the stored stamp — made merely opening a second tab report
   * a conflict in the first.
   */
  const loadedStateRef = useRef<{
    curves: FittedCurve[]
    items: NLItem[]
    kind: BoardKind
    styles: StyleMap
    exprSources: Record<string, string>
    displaySources: Record<string, string>
    selectedId: string | null
    name: string
  } | null>(null)

  return {
    curvesRef, itemsRef, kindRef, stylesRef, selectedRef, undoRef, redoRef, preEditRef, gesturing,
    setGesturing, candidatesRef, exprCounterRef, altRef, snapTimerRef, shakeTimerRef, toastTimerRef,
    exprSourcesRef, brokenExprRef, displaySourcesRef, axisUnitChoiceRef, editsRef, calcRef,
    fieldsRef, shapesRef, dataRef, seqRef, ucRef, rrRef, sysRef, namesRef, callsRef, inversesRef,
    boardCurveNamesRef, regWrittenRef, regAutoHiddenRef, fitCacheRef, cellFoldRef, frameBoxRef,
    boardGridRef, figureStyleRef, figureCaptionRef, polarOfferedRef, derivCounterRef, calcSigRef,
    calcDomainRef, calcAutoHiddenRef, calcSpecOriginRef, docMetaRef, saveTimerRef, hydratedRef,
    docStoredRef, skipAutosaveRef, unsavedRef, loadedStateRef,
  }
}

export type BoardRefsApi = ReturnType<typeof useBoardRefs>
