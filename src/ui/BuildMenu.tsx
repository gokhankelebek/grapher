import { useEffect, useRef, useState } from 'react'

// ============================================================================
// src/ui/BuildMenu.tsx — "Build ▾" on the sidebar header.
//
// The header has room for "+" and one more control, and there is more than one
// way to BUILD a function from what a teacher states: from its roots (a
// polynomial or a rational function), as an exponential (a starting value
// and a rate) and as a logarithm (its base, asymptote and shifts). One small menu instead of a button per builder. Each item opens
// its editor at the top of the list; choosing the one already open closes it.
// ============================================================================

interface Props {
  factorOpen: boolean
  expOpen: boolean
  logOpen?: boolean
  onFactorToggle?(): void
  onExpToggle?(): void
  onLogToggle?(): void
}

export function BuildMenu({
  factorOpen,
  expOpen,
  logOpen = false,
  onFactorToggle,
  onExpToggle,
  onLogToggle,
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

  const anyOpen = factorOpen || expOpen || logOpen
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
        title="Build a function from what you state: its roots, a starting value and a rate, or a logarithm's base and asymptote"
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
        </div>
      )}
    </div>
  )
}
