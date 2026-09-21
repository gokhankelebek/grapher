// ============================================================================
// src/ui/FigurePicker.tsx — choosing the LOOK of the board, by looking at it.
//
// Four thumbnails, each one a real board: the same renderBoard() the canvas and
// the PNG go through, handed the same tiny scene with a different `figure` on
// it. So the picture in the panel cannot drift from what the export does —
// there is no second drawing of an SAT grid anywhere, and an icon that lied
// would be found only after a worksheet was printed.
//
// Below them, the one line that says what the thumbnail cannot show (every
// curve goes black), the switch that puts the look on the BOARD for a moment,
// and — for a style that carries one — the caption that will be printed under
// the figure.
//
// The style is what the PNG and the clipboard copy come out looking like; the
// board keeps the teacher's own theme while they draw on it. "Preview on
// board" is the way to check the one against the other, and it is deliberately
// a switch rather than the default: sketching an SAT figure means sketching on
// the dark board and exporting white, not drawing black on white all lesson.
// ============================================================================

import { useEffect, useId, useRef } from 'react'
import { FIGURE_STYLES } from '../core/types'
import type { FigureStyleId, Theme } from '../core/types'
import { renderBoard } from './renderBoard'
import { FIGURE_BLURB, FIGURE_CHOICES, sampleScene } from './figureStyle'
import { MAX_CAPTION_CHARS } from '../core/persist'

/** CSS px. The nominal cell; the canvas is fluid and measures itself, because
 *  the panel's scrollbar takes a couple of px and a thumbnail resampled by 2%
 *  is a blurry claim about how the renderer draws a hairline. */
const THUMB_W = 96
const THUMB_H = 64

function Thumb({ id, screenTheme }: { id: FigureStyleId; screenTheme: Theme }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const paint = (): void => {
      const w = Math.max(1, Math.round(canvas.getBoundingClientRect().width || THUMB_W))
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(THUMB_H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      try {
        renderBoard(ctx, sampleScene(id, screenTheme, w, THUMB_H))
      } catch {
        // A thumbnail that could not be drawn must not take the panel with it.
        ctx.fillStyle = screenTheme.bg
        ctx.fillRect(0, 0, w, THUMB_H)
      }
    }
    paint()
    // Setting the backing store does not change the CSS box, so this cannot
    // feed itself; it fires when the panel opens at its real width.
    const ro = new ResizeObserver(paint)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [id, screenTheme])
  return (
    <canvas
      ref={ref}
      className="fig-thumb-canvas"
      style={{ height: `${THUMB_H}px` }}
      data-testid={`figure-thumb-${id}`}
      aria-hidden="true"
    />
  )
}

interface Props {
  value: FigureStyleId
  /** The live board theme, so the Screen thumbnail follows the theme toggle. */
  screenTheme: Theme
  caption: string
  /**
   * True while the caption is the one the BOARD wrote, from the curves on it.
   *
   * The field shows the same words either way — what changes is what happens
   * NEXT: an auto caption keeps following the curves (add a curve and it says
   * "Graphs of f and g"), and an overridden one never moves again.
   */
  captionAuto: boolean
  /**
   * Whether the board is currently showing this style instead of the theme.
   *
   * NOT part of the document: it is a way of looking at the board for a
   * minute, and a document that reopened tomorrow in preview would have
   * silently turned the style back into something the board wears.
   */
  preview: boolean
  onPick(id: FigureStyleId): void
  onCaption(next: string): void
  /** Hand the caption back to the board. */
  onCaptionAuto(): void
  onPreview(next: boolean): void
}

export function FigurePicker({
  value,
  screenTheme,
  caption,
  captionAuto,
  preview,
  onPick,
  onCaption,
  onCaptionAuto,
  onPreview,
}: Props) {
  const uid = useId()
  return (
    <>
      <div className="exp-title">Figure style</div>
      <div
        className="fig-grid"
        role="radiogroup"
        aria-label="Figure style"
        data-testid="figure-style"
        data-figure={value}
      >
        {FIGURE_CHOICES.map((id) => {
          const style = FIGURE_STYLES[id]
          const on = value === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`fig-thumb${on ? ' fig-thumb-on' : ''}`}
              data-testid={`figure-style-${id}`}
              title={FIGURE_BLURB[id]}
              onClick={() => onPick(id)}
            >
              <Thumb id={id} screenTheme={screenTheme} />
              <span className="fig-thumb-name">{style.name}</span>
            </button>
          )
        })}
      </div>

      <div className="exp-note" data-testid="figure-style-note">
        {FIGURE_BLURB[value]}
      </div>

      {value !== 'screen' && (
        <label className="exp-check" htmlFor={`${uid}-prev`}>
          <input
            id={`${uid}-prev`}
            type="checkbox"
            className="exp-checkbox"
            checked={preview}
            data-testid="figure-preview"
            onChange={(e) => onPreview(e.target.checked)}
          />
          <span className="exp-check-body">
            <span className="exp-check-label">Preview on board</span>
            <span className="exp-check-note" data-testid="figure-preview-note">
              {preview
                ? `Previewing the ${FIGURE_STYLES[value].name} figure — the board goes back to your theme when you close this`
                : `The ${FIGURE_STYLES[value].name} style is how the PNG and the copy come out; the board keeps your theme. Tick this to see it.`}
            </span>
          </span>
        </label>
      )}

      {/* The caption FOLLOWS the board until the teacher writes their own:
          "Graph of f" on a one-curve board, "Graphs of f, g, and f′" on the
          board this figure is actually of. So the field says which of the two
          it is showing — a quiet "auto" while the board owns the words, and
          the one button that gives them back once the teacher has taken
          them. Without that, an overridden caption is indistinguishable from
          a following one until a curve is added and it fails to move. */}
      {value !== 'screen' && (
        <label className="exp-row fig-caption-row" htmlFor={`${uid}-cap`}>
          <span className="exp-label">Caption</span>
          <input
            id={`${uid}-cap`}
            className="exp-text"
            type="text"
            maxLength={MAX_CAPTION_CHARS}
            placeholder="none"
            value={caption}
            data-testid="figure-caption"
            data-caption-auto={captionAuto ? 'yes' : 'no'}
            onChange={(e) => onCaption(e.target.value)}
          />
          {captionAuto ? (
            <span className="fig-caption-auto" data-testid="figure-caption-hint">
              auto
            </span>
          ) : (
            <button
              type="button"
              className="fig-caption-reset"
              data-testid="figure-caption-reset"
              title="Let the caption follow the board again"
              onClick={(e) => {
                e.preventDefault()
                onCaptionAuto()
              }}
            >
              ↺ auto
            </button>
          )}
        </label>
      )}
    </>
  )
}
