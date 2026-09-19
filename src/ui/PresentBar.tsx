import { useEffect, useRef, useState } from 'react'
import { MAX_PRESENT_SCALE, MIN_PRESENT_SCALE } from './storage'
import { TOOLBAR_IDLE_MS } from './present'

interface Props {
  scale: number
  canUndo: boolean
  onScale(next: number): void
  onUndo(): void
  onExit(): void
}

const STEP = 0.5

/**
 * The toolbar, in presentation mode: five small controls in a corner, which
 * fade out when the pointer stops and come back the moment it moves.
 *
 * The full toolbar is 44px tall across the whole top of the window — measured
 * at 12% of the plot's height, and the top of the plot is exactly where a
 * maximum, a crest or an asymptote's approach lives. During a demo it is in
 * the way of the thing being demonstrated. Fading rather than hiding keeps the
 * escape route discoverable: a teacher who has forgotten Esc only has to move
 * the mouse.
 *
 * It is never removed from the DOM while the mode is on, so keyboard focus and
 * the accessibility tree keep working when the pixels are transparent.
 */
export function PresentBar({ scale, canUndo, onScale, onUndo, onExit }: Props) {
  const [awake, setAwake] = useState(true)
  const timerRef = useRef(0)
  /** Focus inside the cluster pins it up: a control being used must not fade. */
  const [pinned, setPinned] = useState(false)

  useEffect(() => {
    const wake = (): void => {
      setAwake(true)
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setAwake(false), TOOLBAR_IDLE_MS)
    }
    wake()
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    window.addEventListener('keydown', wake)
    return () => {
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('keydown', wake)
      window.clearTimeout(timerRef.current)
    }
  }, [])

  const up = awake || pinned

  return (
    <div
      className={`present-bar${up ? ' present-bar-awake' : ''}`}
      data-testid="present-bar"
      data-awake={up ? 'yes' : 'no'}
      onFocus={() => setPinned(true)}
      onBlur={() => setPinned(false)}
      onPointerEnter={() => setPinned(true)}
      onPointerLeave={() => setPinned(false)}
    >
      <button
        className="present-btn"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (⌘Z)"
        aria-label="Undo"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M3 6.5h6.2a3.3 3.3 0 0 1 0 6.6H6M3 6.5l3-3M3 6.5l3 3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div className="present-size" role="group" aria-label="Presentation size">
        <button
          className="present-btn"
          onClick={() => onScale(scale - STEP)}
          disabled={scale <= MIN_PRESENT_SCALE + 1e-6}
          title="Smaller type on the board"
          aria-label="Smaller presentation type"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <span className="present-size-value" data-testid="present-scale">
          {scale.toFixed(1)}×
        </span>
        <button
          className="present-btn"
          onClick={() => onScale(scale + STEP)}
          disabled={scale >= MAX_PRESENT_SCALE - 1e-6}
          title="Bigger type on the board"
          aria-label="Bigger presentation type"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M8 3.5v9M3.5 8h9"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <button
        className="present-btn present-exit"
        onClick={onExit}
        title="Leave presentation (Esc or F)"
        data-testid="present-exit"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M6 2.5H3.2A.7.7 0 0 0 2.5 3.2V6M10 2.5h2.8a.7.7 0 0 1 .7.7V6M13.5 10v2.8a.7.7 0 0 1-.7.7H10M6 13.5H3.2a.7.7 0 0 1-.7-.7V10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Exit
      </button>
    </div>
  )
}
