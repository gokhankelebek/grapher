import { useEffect, useRef, useState } from 'react'

// ============================================================================
// src/ui/BuildMenu.tsx — "Build ▾" on the sidebar header.
//
// The header has room for "+" and one more control, and there is more than one
// way to BUILD a function from what a teacher states: from its roots (a
// polynomial or a rational function), as an exponential (a starting value
// and a rate), as a logarithm (its base, asymptote and shifts), as a
// sinusoid (amplitude, period, phase shift, midline) and as a transformed
// parent (a·f(b(x − h)) + k, from a gallery of sixteen). One small menu instead
// of a button per builder. Each item opens
// its editor at the top of the list; choosing the one already open closes it.
// "Data table" is the one action: it adds a table to the list and selects it.
// ============================================================================

interface Props {
  factorOpen: boolean
  expOpen: boolean
  logOpen?: boolean
  sinOpen?: boolean
  transformOpen?: boolean
  onFactorToggle?(): void
  onExpToggle?(): void
  onLogToggle?(): void
  onSinToggle?(): void
  onTransformToggle?(): void
  /** Add a data table to the list (an action, not an editor that stays open). */
  onDataAdd?(): void
}

export function BuildMenu({
  factorOpen,
  expOpen,
  logOpen = false,
  sinOpen = false,
  transformOpen = false,
  onFactorToggle,
  onExpToggle,
  onLogToggle,
  onSinToggle,
  onTransformToggle,
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

  const anyOpen = factorOpen || expOpen || logOpen || sinOpen || transformOpen
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
        title="Build a function from what you state: its roots, a starting value and a rate, a logarithm's base and asymptote, a sinusoid's amplitude and period, or a parent function transformed"
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
          {item('Logarithmic', logOpen, onLogToggle, 'build-log')}
          {item('Sinusoidal', sinOpen, onSinToggle, 'build-sin')}
          {item('Transformation', transformOpen, onTransformToggle, 'build-transform')}
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
