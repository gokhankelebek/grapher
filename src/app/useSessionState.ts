// ============================================================================
// src/app/useSessionState.ts — a person's habits and the session's switches.
//
// Preferences (analysis markers, canvas theme, export format, wheel, set
// notation, presentation size, recent commands), reveal mode's state, the
// axis-unit choice, export settings, presentation, the palette and help sheet.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useRef, useState } from 'react'
import { AUTO_AXIS_UNITS } from '../core/persist'
import type { AxisUnitChoices } from '../core/persist'
import type { SetNotation } from '../ui/domainLinks'
import type { FitExportSettings } from '../ui/exportFit'
import type { CopyState } from '../ui/ExportMenu'
import type { WheelPref } from '../ui/gestures'
import { REVEAL_OFF } from '../ui/reveal'
import type { RevealState } from '../ui/reveal'
import { readPrefs, updatePrefs } from '../ui/storage'
import type { ExportFormat } from '../ui/vectorExport'

export function useSessionState() {
  // ---- curve analysis (zeros, extrema, inflections)
  const [showAnalysis, setShowAnalysis] = useState<boolean>(() => readPrefs().showAnalysis)
  /**
   * Reveal mode (src/ui/reveal.ts): the board's computed answers hidden until
   * revealed one by one. SESSION-ONLY — one state per open document, kept in
   * memory while the tab lives and never written to the document or to prefs.
   */
  const [reveal, setReveal] = useState<RevealState>(REVEAL_OFF)
  const revealRef = useRef(reveal)
  revealRef.current = reveal
  /** Each document's reveal state this session, so switching back finds it as it was. */
  const revealByDocRef = useRef(new Map<string, RevealState>())
  /** key → when it was revealed: the board's ring and nothing else. */
  const revealFreshRef = useRef(new Map<string, number>())
  /**
   * Markers on the board: the teacher's Analysis switch, or reveal mode —
   * which is ABOUT the markers, so it shows their places whatever the switch
   * says. The switch's own pref is untouched.
   */
  const markersOn = showAnalysis || reveal.on
  /**
   * Ground the ON-SCREEN canvas is drawn on. Dark by default — the export has
   * its own, independent setting, because the two are answering different
   * questions ("what do I want to look at" vs "what goes on the paper").
   */
  const [canvasTheme, setCanvasTheme] = useState<'dark' | 'light'>(() => readPrefs().canvasTheme)
  /** What Download makes, and how wide a LaTeX-bound figure is: a person's habit, like `wheel`. */
  const [exportFormat, setExportFormatState] = useState<ExportFormat>(() => readPrefs().exportFormat)
  const changeExportFormat = useCallback((next: ExportFormat): void => {
    setExportFormatState(next)
    updatePrefs({ exportFormat: next })
  }, [])
  const [latexWidthCm, setLatexWidthState] = useState<number>(() => readPrefs().latexWidthCm)
  const changeLatexWidth = useCallback((cm: number): void => {
    setLatexWidthState(cm)
    updatePrefs({ latexWidthCm: cm })
  }, [])
  const [wheelPref, setWheelPrefState] = useState<WheelPref>(() => readPrefs().wheel)
  const setWheelPref = useCallback((next: WheelPref): void => {
    setWheelPrefState(next)
    updatePrefs({ wheel: next })
  }, [])
  /** Domain / range rows: interval notation or set-builder. A person's habit, remembered like `wheel`. */
  const [setNotation, setSetNotationState] = useState<SetNotation>(() => readPrefs().setNotation)
  const changeSetNotation = useCallback((next: SetNotation): void => {
    setSetNotationState(next)
    updatePrefs({ setNotation: next })
  }, [])
  /**
   * How each axis is MEASURED, as this document states it.
   *
   * 'auto' — the default, and both sides start there — means the board decides
   * from what is on it, every time the curve set changes: a sine lands and the
   * x-axis becomes π/2, π, 3π/2; the last trig curve is deleted and it goes
   * back to 1, 2, 3. 'decimal'/'pi' is the teacher overruling that, and the
   * override sticks until they hand the axis back to auto — a board that
   * argued back every time a sketch landed would be unusable mid-lesson.
   *
   * It belongs to the DOCUMENT (persist.ts), not to preferences: a trig lesson
   * is a trig lesson on any machine, while the next document is not.
   */
  const [axisUnitChoice, setAxisUnitChoice] = useState<AxisUnitChoices>(AUTO_AXIS_UNITS)
  const [exportSettings, setExportSettings] = useState<FitExportSettings>(() => ({
    ...readPrefs().exportDefaults,
  }))
  /**
   * Presentation mode: the board projected across a room. F enters and leaves,
   * Esc leaves. Nothing about it is written to the document — it is a way of
   * LOOKING at a board, not a property of one — except the size, which is a
   * fact about the teacher's room and is remembered in preferences.
   */
  const [presentMode, setPresentMode] = useState(false)
  const [presentType, setPresentType] = useState<number>(() => readPrefs().presentScale)
  /**
   * The command palette (⌘K, /) and the help sheet (?). `pick` opens the
   * palette straight into "which curve?" for one command (the help sheet's
   * "Do it" with nothing selected). Neither is part of the document.
   */
  const [palette, setPalette] = useState<{ key: number; pick?: string } | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [recentCommands, setRecentCommands] = useState<string[]>(() => readPrefs().recentCommands)
  /** Text the + box opens with when a palette command opened it ("dy/dx = "). */
  const [exprSeed, setExprSeed] = useState<{ text: string; key: number } | null>(null)
  const [legendCorner, setLegendCorner] = useState<
    'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  >('bottom-left')
  const [copyState, setCopyState] = useState<CopyState>({ kind: 'idle' })
  /** Index into the analysis array whose marker should be emphasised. */
  const [highlight, setHighlight] = useState<number | null>(null)
  /**
   * The board's answer to the last feature edit. A refusal is the solver's own
   * sentence, shown verbatim and left up until it is dismissed or superseded; a
   * side-effect report says what else moved and fades on its own. Never modal —
   * the teacher keeps typing either way.
   */
  const [featureNote, setFeatureNote] = useState<
    | {
        kind: 'refused'
        key: number
        reason: string
        nearest?: { curveId: string; params: number[]; domain: [number, number] | null }
      }
    | { kind: 'moved'; key: number; text: string }
    | null
  >(null)
  const featureNoteTimerRef = useRef(0)

  return {
    showAnalysis, setShowAnalysis, reveal, setReveal, revealRef, revealByDocRef, revealFreshRef,
    markersOn, canvasTheme, setCanvasTheme, exportFormat, changeExportFormat, latexWidthCm,
    changeLatexWidth, wheelPref, setWheelPref, setNotation, changeSetNotation, axisUnitChoice,
    setAxisUnitChoice, exportSettings, setExportSettings, presentMode, setPresentMode, presentType,
    setPresentType, palette, setPalette, helpOpen, setHelpOpen, recentCommands, setRecentCommands,
    exprSeed, setExprSeed, legendCorner, setLegendCorner, copyState, setCopyState, highlight,
    setHighlight, featureNote, setFeatureNote, featureNoteTimerRef,
  }
}

export type SessionStateApi = ReturnType<typeof useSessionState>
