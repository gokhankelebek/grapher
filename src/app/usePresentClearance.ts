// ============================================================================
// src/app/usePresentClearance.ts — Present + Reveal: the view makes room for
// the "Revealed" panel (src/ui/presentClearance.ts says how and why).
//
// After each reveal (the panel's size changes with every answer) the panel
// and the board are measured, and if the figure's content meets the panel the
// view pans — or, when it must, shrinks — until it does not. When the panel
// goes away (Reset, Reveal off, leaving Present) the view the teacher had is
// put back, unless they have moved it themselves since; then their view stays.
//
// Called once per render by App (src/App.tsx), after usePresentAnswers.
// ============================================================================

import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { Viewport } from '../core/types'
import type { Box } from '../ui/viewScale'
import { applyClearance, contentRect, panelClearance, restoreView, sameView, snapView } from '../ui/presentClearance'
import type { ViewSnap } from '../ui/presentClearance'

export interface PresentClearanceDeps {
  /** Present, reveal mode, a graph board, and at least one answer on the panel. */
  active: boolean
  /** How many answers the panel lists (it grows with each). */
  lines: number
  /** The presentation type scale. */
  type: number
  vpRef: MutableRefObject<Viewport>
  fitContentBox(): Box | null
  viewMoved(): void
}

export function usePresentClearance({ active, lines, type, vpRef, fitContentBox, viewMoved }: PresentClearanceDeps): void {
  /** The view before the first move, and the view the last move left. */
  const savedRef = useRef<{ view: ViewSnap; applied: ViewSnap } | null>(null)
  const fitRef = useRef(fitContentBox)
  fitRef.current = fitContentBox
  const movedRef = useRef(viewMoved)
  movedRef.current = viewMoved

  useEffect(() => {
    if (!active) {
      const s = savedRef.current
      savedRef.current = null
      if (s && sameView(snapView(vpRef.current), s.applied)) {
        restoreView(vpRef.current, s.view)
        movedRef.current()
      }
      return
    }
    // Two frames: the panel is in the DOM and laid out at its new size.
    let raf = window.requestAnimationFrame(() => {
      raf = window.requestAnimationFrame(measure)
    })
    function measure(): void {
      const panel = document.querySelector('[data-testid="present-answers"]')
      const canvas = document.getElementById('board-canvas')
      if (!panel || !canvas) return
      const box = fitRef.current()
      if (!box) return
      const vp = vpRef.current
      const c = canvas.getBoundingClientRect()
      const p = panel.getBoundingClientRect()
      const content = contentRect(box, vp, type)
      const move = panelClearance(
        content,
        { left: p.left - c.left, right: p.right - c.left, top: p.top - c.top, bottom: p.bottom - c.top },
        vp.widthPx,
      )
      if (!move) return
      const before = snapView(vp)
      const prior = savedRef.current
      applyClearance(vp, content, move)
      // A view the teacher moved since the last clearance is the one to return to.
      savedRef.current = { view: prior && sameView(before, prior.applied) ? prior.view : before, applied: snapView(vp) }
      movedRef.current()
    }
    return () => window.cancelAnimationFrame(raf)
  }, [active, lines, type, vpRef])
}
