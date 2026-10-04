import { useEffect, useRef } from 'react'
import type { CSSProperties, MutableRefObject } from 'react'
import { Latex } from './Latex'
import type { LegendEntry } from './present'
import { legendNudge, xLabelBand } from './present'
import { useInk } from './inkContext'
import type { Viewport } from '../core/types'
import { ppuX, ppuY, toScreen } from '../core/types'
import { LABEL_PX } from '../render/grid'

interface Props {
  entries: readonly LegendEntry[]
  /**
   * The presentation type scale. It sets the legend's font size INLINE rather
   * than in the stylesheet, because it is a runtime number: the stylesheet's
   * type scale tops out at 17px, and this text has to be read from the back of
   * a room at whatever size the teacher chose for their own.
   */
  type: number
  /** Which corner it sits in. The plot usually leaves one of them free. */
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  onCycleCorner(): void
  /**
   * The graph board's view. Given, the legend keeps off the x axis's tick
   * numbers: in a bottom corner it steps up above them (or below them, when
   * there is no room above), wherever a pan or zoom has put the axis.
   */
  vpRef?: MutableRefObject<Viewport>
  /** A sign chart's band under the board, which the numbers sit above (px). */
  bottomInset?: number
}

/**
 * The legend: each visible curve's equation as a chip in its own colour.
 *
 * DOM, not canvas, for two reasons. It is SCREEN-ONLY — the export has its own
 * light theme and its own composition, and a legend baked into the figure
 * would land in a worksheet uninvited. And the equations are KaTeX, which is
 * already how every other equation in this app is set; re-implementing maths
 * typesetting on a 2D context to say the same thing would be a second, worse
 * renderer of the one thing the app is about.
 *
 * It is the whole reason presentation mode can hide the sidebar. Without it,
 * hiding the cards leaves four anonymous coloured lines.
 */
export function PresentLegend({ entries, type, corner, onCycleCorner, vpRef, bottomInset = 0 }: Props) {
  const ink = useInk()
  const ref = useRef<HTMLDivElement>(null)
  const shiftRef = useRef(0)
  const empty = entries.length === 0
  // Followed every frame, but only recomputed when something it reads moved:
  // the board pans without re-rendering the App, so a render-time check
  // would leave the legend on the numbers after a drag.
  useEffect(() => {
    if (!vpRef || empty) return
    // What is applied now (a remounted legend starts unmoved).
    shiftRef.current = Number(ref.current?.dataset.nudge || 0)
    let raf = 0
    let last = ''
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const el = ref.current
      const canvas = document.getElementById('board-canvas')
      if (!el || !canvas) return
      const vp = vpRef.current
      const c = canvas.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      const sig = `${vp.center.x}|${vp.center.y}|${ppuX(vp)}|${ppuY(vp)}|${vp.heightPx}|${c.top}|${r.height}|${corner}|${type}|${bottomInset}`
      if (sig === last) return
      last = sig
      const axisY = toScreen({ x: 0, y: 0 }, vp).y
      const band = xLabelBand(axisY, vp.heightPx, type, LABEL_PX, bottomInset)
      const at = r.top - c.top - shiftRef.current
      const dy = Math.round(legendNudge(corner, { top: at, bottom: at + r.height }, band, vp.heightPx))
      if (dy !== shiftRef.current) {
        shiftRef.current = dy
        el.style.transform = dy !== 0 ? `translateY(${dy}px)` : ''
        el.dataset.nudge = String(dy)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [vpRef, empty, corner, type, bottomInset])
  if (empty) return null
  return (
    <div
      ref={ref}
      className={`present-legend present-legend-${corner}`}
      data-testid="present-legend"
      data-legend-px={Math.round(13 * type)}
      style={{ fontSize: `${Math.round(13 * type)}px` }}
      role="list"
      aria-label="Equations on this board"
    >
      {entries.map((e) => (
        <div
          key={e.id}
          role="listitem"
          className="present-chip"
          data-curve-color={e.color}
          style={{ '--curve': ink(e.color) } as CSSProperties}
        >
          <span className="present-chip-swatch" aria-hidden="true" />
          <Latex tex={e.tex} className="present-chip-tex" />
        </div>
      ))}
      <button
        className="present-legend-move"
        title="Move the legend to another corner"
        aria-label="Move the legend to another corner"
        onClick={onCycleCorner}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}
