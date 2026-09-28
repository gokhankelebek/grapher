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
// "Data table" is the one action: it adds a table to the list and selects it.
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
          {onDataAdd && (
            <>
              <div className="card-menu-sep" role="separator" />
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
