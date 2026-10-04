// ============================================================================
// src/ui/RevealControls.tsx — reveal mode's buttons.
//
// One set of controls in two places: a pill on the board while reveal mode is
// on (the editing view), and a group inside the PresentBar in presentation,
// sized for a room (44 px targets). The keys do the same things from anywhere:
// R toggles the mode, → / PageDown reveal the next answer, ← / PageUp take the
// last one back — a presentation clicker's forward and back buttons.
//
// The counter says how far the class has got: "3 of 9 revealed" (it used to
// count what was still hidden, so it ran backwards as answers came out).
//
// A STUDENT (a view-only share link opened in reveal mode) gets Next and the
// counter only: Next checks their own work one answer at a time, while the
// Reveal switch, All and Reset would put every answer up in one tap.
// ============================================================================

/** "3 of 9 revealed" — the counter's words, everywhere it appears. */
export function revealCountText(hidden: number, total: number): string {
  const t = Math.max(0, Math.round(total))
  const shown = Math.min(t, Math.max(0, t - Math.round(hidden)))
  return `${shown} of ${t} revealed`
}

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
  student = false,
}: RevealControlsProps & { present?: boolean; student?: boolean }) {
  const count = (
    <span className="reveal-bar-count" data-testid="reveal-count" title="Answers revealed so far">
      {revealCountText(hidden, total)}
    </span>
  )
  const next = (
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
  )
  if (student) {
    if (!on) return null
    return (
      <div
        className={`${present ? 'present-reveal' : 'reveal-controls'} reveal-student`}
        role="group"
        aria-label="Check your answers"
        data-testid={present ? 'present-reveal' : 'reveal-controls'}
        data-student="true"
      >
        {count}
        {next}
      </div>
    )
  }
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
          {count}
          {next}
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
