import type { CSSProperties } from 'react'
import { Latex } from './Latex'
import type { LegendEntry } from './present'

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
export function PresentLegend({ entries, type, corner, onCycleCorner }: Props) {
  if (entries.length === 0) return null
  return (
    <div
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
          style={{ '--curve': e.color } as CSSProperties}
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
