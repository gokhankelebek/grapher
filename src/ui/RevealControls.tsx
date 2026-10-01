// ============================================================================
// src/ui/RevealControls.tsx — reveal mode's buttons.
//
// One set of controls in two places: a pill on the board while reveal mode is
// on (the editing view), and a group inside the PresentBar in presentation,
// sized for a room (44 px targets). The keys do the same things from anywhere:
// R toggles the mode, → / PageDown reveal the next answer, ← / PageUp take the
// last one back — a presentation clicker's forward and back buttons.
// ============================================================================

export interface RevealControlsProps {
  on: boolean
  /** Answers still hidden, of how many. */
  hidden: number
  total: number
  /** "?" marks drawn where hidden answers sit. */
  positions: boolean
  onToggle(): void
  onNext(): void
  onAll(): void
  onReset(): void
  onPositions(): void
}

export function RevealControls({
  on,
  hidden,
  total,
  positions,
  onToggle,
  onNext,
  onAll,
  onReset,
  onPositions,
  present = false,
}: RevealControlsProps & { present?: boolean }) {
  return (
    <div
      className={present ? 'present-reveal' : 'reveal-controls'}
      role="group"
      aria-label="Reveal answers"
      data-testid={present ? 'present-reveal' : 'reveal-controls'}
    >
      <button
        type="button"
        className={`reveal-btn${on ? ' reveal-btn-on' : ''}`}
        aria-pressed={on}
        data-testid="reveal-toggle"
        title={on ? 'Leave reveal mode — show every answer (R)' : 'Reveal mode: hide the answers, then reveal them one at a time (R)'}
        onClick={onToggle}
      >
        Reveal
      </button>
      {on && (
        <>
          <span className="reveal-bar-count" data-testid="reveal-count" title="Answers still hidden">
            {`${hidden}/${total}`}
          </span>
          <button
            type="button"
            className="reveal-btn reveal-btn-primary"
            data-testid="reveal-next"
            disabled={hidden === 0}
            title="Reveal the next answer (→ or PageDown)"
            onClick={onNext}
          >
            Next ›
          </button>
          <button
            type="button"
            className="reveal-btn"
            data-testid="reveal-all"
            disabled={hidden === 0}
            title="Reveal every answer"
            onClick={onAll}
          >
            All
          </button>
          <button
            type="button"
            className="reveal-btn"
            data-testid="reveal-reset"
            disabled={hidden === total}
            title="Hide every answer again"
            onClick={onReset}
          >
            Reset
          </button>
          <button
            type="button"
            className={`reveal-btn${positions ? ' reveal-btn-on' : ''}`}
            aria-pressed={positions}
            data-testid="reveal-positions"
            title={
              positions
                ? 'Hide the positions too — no “?” where the answers are'
                : 'Show a “?” where each hidden answer is'
            }
            onClick={onPositions}
          >
            ?
          </button>
        </>
      )}
    </div>
  )
}
