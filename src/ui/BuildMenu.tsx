import { useEffect, useRef, useState } from 'react'

// ============================================================================
// src/ui/BuildMenu.tsx — "Build ▾" on the sidebar header.
//
// The header has room for "+" and one more control, and there is more than one
// way to BUILD a function from what a teacher states: from its roots (a
// polynomial or a rational function), as an exponential (a starting value
// and a rate), as a logistic (L, k and y(0), the way a BC problem states it), as a logarithm (its base, asymptote and shifts), as a
// sinusoid (amplitude, period, phase shift, midline) and as a transformed
// parent (a·f(b(x − h)) + k, from a gallery of sixteen), as a piecewise or
// step function, piece by piece in a table, and as a conic section (from its
// center, vertices, foci or directrix, or a pasted general form), and as a
// parametric or polar curve (a named family or x(t), y(t) / r(θ)). One small menu instead
// of a button per builder. Each item opens
// its editor at the top of the list; choosing the one already open closes it.
// "Sequence" builds an arithmetic, geometric, explicit, recursive or listed
// sequence — dots (n, aₙ), not a curve.
// "Data table" is an action: it adds a table to the list and selects it.
// "Unit circle" is one too: it puts THE unit circle on the board (one per
// board — a second press selects the one already there). "Related rates"
// likewise puts the related-rates problem on the board.
// ============================================================================

interface Props {
  factorOpen: boolean
  expOpen: boolean
  logisticOpen?: boolean
  logOpen?: boolean
  sinOpen?: boolean
  transformOpen?: boolean
  piecewiseOpen?: boolean
  conicOpen?: boolean
  motionOpen?: boolean
  seqOpen?: boolean
  onFactorToggle?(): void
  onExpToggle?(): void
  /** "Logistic": L, k and y(0), the way a BC problem states it. */
  onLogisticToggle?(): void
  onLogToggle?(): void
  onSinToggle?(): void
  onTransformToggle?(): void
  onPiecewiseToggle?(): void
  onConicToggle?(): void
  onMotionToggle?(): void
  /** "Sequence": the builder for arithmetic, geometric, explicit, recursive and listed sequences. */
  onSeqToggle?(): void
  /** Add a data table to the list (an action, not an editor that stays open). */
  onDataAdd?(): void
  /** Put the unit circle on the board, or select the one already there. */
  onUnitCircleAdd?(): void
  /** Put a related-rates problem on the board, or select the one already there. */
  onRelatedRatesAdd?(): void
  /** Put a normal distribution on the board (Math 3 / AP Precalc statistics). */
  onNormalAdd?(): void
  /** Put a sampling simulation on the board. */
  onSimulationAdd?(): void
  /** Put a one-variable data plot on the board (dot plot, histogram, box plots — NC Math 1). */
  onDataPlotAdd?(): void
  /** Put a probability object on the board (two-way table, Venn diagram, tree diagram — NC Math 2). */
  onProbabilityAdd?(): void
}

export function BuildMenu({
  factorOpen,
  expOpen,
  logisticOpen = false,
  logOpen = false,
  sinOpen = false,
  transformOpen = false,
  piecewiseOpen = false,
  conicOpen = false,
  motionOpen = false,
  seqOpen = false,
  onFactorToggle,
  onExpToggle,
  onLogisticToggle,
  onLogToggle,
  onSinToggle,
  onTransformToggle,
  onPiecewiseToggle,
  onConicToggle,
  onMotionToggle,
  onSeqToggle,
  onDataAdd,
  onUnitCircleAdd,
  onRelatedRatesAdd,
  onNormalAdd,
  onSimulationAdd,
  onDataPlotAdd,
  onProbabilityAdd,
}: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const anyOpen = factorOpen || expOpen || logisticOpen || logOpen || sinOpen || transformOpen || piecewiseOpen || conicOpen || motionOpen || seqOpen
  const item = (
    label: string,
    on: boolean,
    run: (() => void) | undefined,
    testId: string,
  ): JSX.Element | null =>
    run ? (
      <button
        type="button"
        role="menuitemradio"
        aria-checked={on}
        data-testid={testId}
        className={`card-menu-item build-item${on ? ' build-item-on' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(false)
          run()
        }}
      >
        {label}
      </button>
    ) : null

  return (
    <div className="build-wrap" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={`add-btn factor-btn build-btn${anyOpen ? ' factor-open' : ''}`}
        title="Build a function from what you state: its roots, a starting value and a rate, a logarithm's base and asymptote, a sinusoid's amplitude and period, a parent function transformed, a piecewise / step function piece by piece, a conic section from its center, vertices and foci, or a parametric or polar curve"
        aria-label="Build"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="build-btn"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        Build <span className="build-caret">▾</span>
      </button>
      {open && (
        <div className="card-menu build-menu" role="menu" aria-label="Build">
          {item('From roots (polynomial / rational)', factorOpen, onFactorToggle, 'build-roots')}
          {item('Exponential', expOpen, onExpToggle, 'build-exp')}
          {item('Logistic', logisticOpen, onLogisticToggle, 'build-logistic')}
          {item('Logarithmic', logOpen, onLogToggle, 'build-log')}
          {item('Sinusoidal', sinOpen, onSinToggle, 'build-sin')}
          {item('Transformation', transformOpen, onTransformToggle, 'build-transform')}
          {item('Piecewise / step', piecewiseOpen, onPiecewiseToggle, 'build-piecewise')}
          {item('Conic section', conicOpen, onConicToggle, 'build-conic')}
          {item('Parametric / polar', motionOpen, onMotionToggle, 'build-motion')}
          {item('Sequence', seqOpen, onSeqToggle, 'build-seq')}
          {(onDataAdd || onUnitCircleAdd || onRelatedRatesAdd || onNormalAdd || onSimulationAdd) && <div className="card-menu-sep" role="separator" />}
          {onUnitCircleAdd && (
            <button
              type="button"
              role="menuitem"
              data-testid="build-unit-circle"
              className="card-menu-item build-item"
              title="The unit circle: P(θ) = (cos θ, sin θ), the reference triangle and angle, exact values, the unwrapped sin / cos / tan graph and inverse trig"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                onUnitCircleAdd()
              }}
            >
              Unit circle
            </button>
          )}
          {onRelatedRatesAdd && (
            <button
              type="button"
              role="menuitem"
              data-testid="build-related-rates"
              className="card-menu-item build-item"
              title="Related rates: a sliding ladder, a cone tank, a shadow, a ripple or a balloon — animated in time, with the relation, its derivative and the live rates"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                onRelatedRatesAdd()
              }}
            >
              Related rates
            </button>
          )}
          {onDataPlotAdd && (
            <button
              type="button"
              role="menuitem"
              data-testid="build-data-plot"
              className="card-menu-item build-item"
              title="One-variable data: paste a list (or several) for a dot plot, histogram and box plots — the summary, shape, outliers and a comparison"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                onDataPlotAdd()
              }}
            >
              One-variable data
            </button>
          )}
          {onProbabilityAdd && (
            <button
              type="button"
              role="menuitem"
              data-testid="build-probability"
              className="card-menu-item build-item"
              title="Probability: a two-way table (conditional probability, independence), a Venn diagram (shade A ∩ Bᶜ, the Addition Rule) or a tree diagram (draws with or without replacement, the Multiplication Rule)"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                onProbabilityAdd()
              }}
            >
              Probability
            </button>
          )}
          {onNormalAdd && (
            <button
              type="button"
              role="menuitem"
              data-testid="build-normal"
              className="card-menu-item build-item"
              title="A normal distribution N(μ, σ): shade a probability, read the z-scores, find the value for a percentile, show the empirical rule"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                onNormalAdd()
              }}
            >
              Normal distribution
            </button>
          )}
          {onSimulationAdd && (
            <button
              type="button"
              role="menuitem"
              data-testid="build-simulation"
              className="card-menu-item build-item"
              title="Simulation: repeated samples of means or proportions with the margin of error, or a randomisation test comparing two treatments"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                onSimulationAdd()
              }}
            >
              Simulation
            </button>
          )}
          {onDataAdd && (
            <>
              <button
                type="button"
                role="menuitem"
                data-testid="build-data"
                className="card-menu-item build-item"
                title="A table of x and y — type it or paste two columns from a spreadsheet — then fit a regression"
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen(false)
                  onDataAdd()
                }}
              >
                Data table
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
