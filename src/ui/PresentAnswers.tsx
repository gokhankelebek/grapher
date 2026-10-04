// ============================================================================
// src/ui/PresentAnswers.tsx — "Revealed answers", on the board in presentation.
//
// Reveal mode's values mostly live on the cards, and presentation hides the
// cards — so on a projector Next used to change a counter and nothing else.
// In presentation + reveal mode this panel lists every answer revealed so
// far, in the order it was revealed, the newest highlighted (and announced
// to a screen reader). It is set at the presentation's type scale, beside
// the board in the corner the legend leaves free, in the board's own dark
// glass. DOM, not canvas: it never reaches an export.
//
// The lines come from src/ui/revealedAnswers.ts (one per answer key).
// ============================================================================

import type { CSSProperties } from 'react'
import type { AnswerLine } from './revealedAnswers'
import { panelWindow } from './revealedAnswers'
import { useInk } from './inkContext'

interface Props {
  lines: readonly AnswerLine[]
  /** How many answers there are in all (the counter's N). */
  total: number
  /** The presentation type scale (the legend's). */
  type: number
  /** The side the legend leaves free. */
  side: 'left' | 'right'
}

export function PresentAnswers({ lines, total, type, side }: Props) {
  const ink = useInk()
  if (lines.length === 0) return null
  const { shown, earlier } = panelWindow(lines)
  const newest = lines[lines.length - 1]
  // The value at 11px × the type scale (27.5px at the 2.5× default); the
  // small print beside it in proportion, never under the app's 11px floor.
  const px = Math.max(13, Math.round(11 * type))
  const small = { fontSize: `${Math.max(11, Math.round(px * 0.6))}px` }
  // Earlier answers step down so the newest one leads and the panel stays
  // narrow beside the board; still well above the 1:1 type.
  const earlierValue = { fontSize: `${Math.max(12, Math.round(px * 0.72))}px` }
  const tiny = { fontSize: `${Math.max(11, Math.round(px * 0.5))}px` }
  return (
    <section
      className={`present-answers present-answers-${side}`}
      data-testid="present-answers"
      data-answer-px={px}
      style={{ fontSize: `${px}px` }}
      aria-label="Revealed answers"
    >
      <div className="present-answers-head" style={tiny}>
        <span>Revealed</span>
        <span className="present-answers-count" data-testid="present-answers-count">
          {lines.length} of {total}
        </span>
      </div>
      {earlier > 0 && (
        <div className="present-answers-earlier" data-testid="present-answers-earlier" style={tiny}>
          + {earlier} earlier
        </div>
      )}
      <ol className="present-answers-list">
        {shown.map((l) => {
          const isNew = l.key === newest.key
          return (
            <li
              key={l.key}
              className={`present-answer${isNew ? ' present-answer-new' : ''}`}
              data-answer-key={l.key}
              data-place={l.place}
              style={l.color ? ({ '--curve': ink(l.color) } as CSSProperties) : undefined}
            >
              <span className="present-answer-label" style={small}>
                {l.label}
              </span>
              <span className="present-answer-value" style={isNew ? undefined : earlierValue}>
                {l.value}
              </span>
            </li>
          )
        })}
      </ol>
      {/* The newest answer, said once, for a screen reader. */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {`${newest.label}: ${newest.value}`}
      </div>
    </section>
  )
}
