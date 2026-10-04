import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { BUILD_SECTIONS, buildSectionOrder } from './courses'
import type { BuildSectionId, CourseId } from './courses'
import { useMenuKeys } from './useMenuKeys'

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
//
// SECTIONS. The menu is grouped — Functions, Calculus, Geometry, Statistics &
// probability, Number line — and the teacher's courses (Prefs.courses, via
// BuildFocus below; src/ui/courses.ts) decide which sections come first and
// which wait under "More…". Nothing is ever left out: "More…" opens the rest
// in place, and ⌘K finds every item regardless. With no courses chosen every
// section is shown, as before, only grouped.
// ============================================================================

/**
 * What the App tells the Build menu without threading it through the
 * sidebar: the teacher's courses, and the actions that live outside the
 * builders (the + box with a line typed in it, the number line's solver).
 */
export interface BuildFocusValue {
  courses?: readonly CourseId[]
  /** Open the + box with `seed` typed in it ("dy/dx = ", "ABC = "). */
  onTypeLine?(seed: string): void
  /** Switch to the number line and open its inequality box. */
  onSolveInequality?(): void
}

export const BuildFocus = createContext<BuildFocusValue>({})

/** One row of the menu, resolved. */
interface BuildRow {
  testId: string
  label: string
  section: BuildSectionId
  /** A builder that stays open (a radio item, ticked when open) or an action. */
  on?: boolean
  run: () => void
  title?: string
}

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
  initialOpen = false,
}: Props & { /** Render open (tests). */ initialOpen?: boolean }) {
  const focus = useContext(BuildFocus)
  const [open, setOpen] = useState(initialOpen)
  const [showMore, setShowMore] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const close = useCallback((): void => setOpen(false), [])
  useMenuKeys(open, menuRef, btnRef, close)

  useEffect(() => {
    if (!open) {
      setShowMore(false)
      return
    }
    const onDown = (e: PointerEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  const anyOpen = factorOpen || expOpen || logisticOpen || logOpen || sinOpen || transformOpen || piecewiseOpen || conicOpen || motionOpen || seqOpen

  const rows = buildRows(
    {
      factorOpen, expOpen, logisticOpen, logOpen, sinOpen, transformOpen, piecewiseOpen, conicOpen, motionOpen, seqOpen,
      onFactorToggle, onExpToggle, onLogisticToggle, onLogToggle, onSinToggle, onTransformToggle, onPiecewiseToggle,
      onConicToggle, onMotionToggle, onSeqToggle, onDataAdd, onUnitCircleAdd, onRelatedRatesAdd, onNormalAdd,
      onSimulationAdd, onDataPlotAdd, onProbabilityAdd,
    },
    focus,
  )
  const { shown, more } = buildSectionOrder(focus.courses)
  const hasRows = (sec: BuildSectionId): boolean => rows.some((r) => r.section === sec)
  const shownSecs = shown.filter(hasRows)
  const moreSecs = more.filter(hasRows)

  const item = (r: BuildRow): JSX.Element => (
    <button
      key={r.testId}
      type="button"
      role={r.on === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={r.on === undefined ? undefined : r.on}
      data-testid={r.testId}
      title={r.title}
      className={`card-menu-item build-item${r.on ? ' build-item-on' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        setOpen(false)
        r.run()
      }}
    >
      {r.label}
    </button>
  )

  const section = (sec: BuildSectionId): JSX.Element => {
    const title = BUILD_SECTIONS.find((x) => x.id === sec)?.title ?? sec
    return (
      <div key={sec} className="build-sec" role="group" aria-label={title} data-section={sec}>
        <div className="build-sec-title" aria-hidden="true">
          {title}
        </div>
        {rows.filter((r) => r.section === sec).map(item)}
      </div>
    )
  }

  return (
    <div className="build-wrap" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={`add-btn factor-btn build-btn${anyOpen ? ' factor-open' : ''}`}
        title="Build a function, a figure, a data display or a calculus object from what you state"
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
        <div className="card-menu build-menu" role="menu" aria-label="Build" ref={menuRef}>
          {shownSecs.map(section)}
          {moreSecs.length > 0 &&
            (showMore ? (
              <div className="build-more-body" data-testid="build-more-body">
                {moreSecs.map(section)}
              </div>
            ) : (
              <button
                type="button"
                role="menuitem"
                aria-expanded={false}
                data-testid="build-more"
                className="card-menu-item build-item build-more"
                title={`Also here: ${moreSecs.map((s) => BUILD_SECTIONS.find((x) => x.id === s)?.title).join(', ')}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMore(true)
                  // Keep the keyboard where the new items are.
                  window.setTimeout(
                    () => menuRef.current?.querySelector<HTMLElement>('.build-more-body [role^="menuitem"]')?.focus(),
                    0,
                  )
                }}
              >
                More…
                <span className="build-more-hint">
                  {moreSecs.map((s) => BUILD_SECTIONS.find((x) => x.id === s)?.title).join(' · ')}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

/**
 * Every row the menu can show, in its section and in section order. A row
 * whose callback the sidebar did not pass is left out (a read-only board).
 * Exported for the tests: the order a teacher sees.
 */
export function buildRows(p: Props, focus: BuildFocusValue = {}): BuildRow[] {
  const rows: BuildRow[] = []
  const add = (
    section: BuildSectionId,
    testId: string,
    label: string,
    run: (() => void) | undefined,
    on?: boolean,
    title?: string,
  ): void => {
    if (run) rows.push({ section, testId, label, run, ...(on !== undefined ? { on } : {}), ...(title ? { title } : {}) })
  }
  const seed = (s: string): (() => void) | undefined => (focus.onTypeLine ? () => focus.onTypeLine?.(s) : undefined)
  // ---- Functions
  add('functions', 'build-roots', 'From roots (polynomial / rational)', p.onFactorToggle, p.factorOpen)
  add('functions', 'build-exp', 'Exponential', p.onExpToggle, p.expOpen)
  add('functions', 'build-log', 'Logarithmic', p.onLogToggle, p.logOpen ?? false)
  add('functions', 'build-sin', 'Sinusoidal', p.onSinToggle, p.sinOpen ?? false)
  add('functions', 'build-transform', 'Transformation', p.onTransformToggle, p.transformOpen ?? false)
  add('functions', 'build-piecewise', 'Piecewise / step', p.onPiecewiseToggle, p.piecewiseOpen ?? false)
  add('functions', 'build-motion', 'Parametric / polar', p.onMotionToggle, p.motionOpen ?? false)
  add('functions', 'build-seq', 'Sequence', p.onSeqToggle, p.seqOpen ?? false)
  add('functions', 'build-unit-circle', 'Unit circle', p.onUnitCircleAdd, undefined,
    'The unit circle: P(θ) = (cos θ, sin θ), the reference triangle and angle, exact values, the unwrapped sin / cos / tan graph and inverse trig')
  add('functions', 'build-data', 'Data table & regression', p.onDataAdd, undefined,
    'A table of x and y — type it or paste two columns from a spreadsheet — then fit a regression')
  // ---- Calculus
  add('calculus', 'build-slope-field', 'Slope field (dy/dx = …)', seed('dy/dx = '), undefined,
    'Type dy/dx = … and get its slope field; tap to draw solutions')
  add('calculus', 'build-logistic', 'Logistic', p.onLogisticToggle, p.logisticOpen ?? false)
  add('calculus', 'build-related-rates', 'Related rates', p.onRelatedRatesAdd, undefined,
    'Related rates: a sliding ladder, a cone tank, a shadow, a ripple or a balloon — animated in time, with the relation, its derivative and the live rates')
  // ---- Geometry
  add('geometry', 'build-shape', 'Triangle or polygon (ABC = …)', seed('ABC = '), undefined,
    'Type ABC = (0,0) (4,0) (4,3) — its card measures sides, slopes, angles, perimeter and area')
  add('geometry', 'build-segment', 'Segment (AB = …)', seed('AB = '), undefined,
    'Type AB = (1,2) (4,6) — the exact length, midpoint, slope and the line through it')
  add('geometry', 'build-conic', 'Conic section', p.onConicToggle, p.conicOpen ?? false)
  // ---- Statistics & probability
  add('stats', 'build-data-plot', 'One-variable data', p.onDataPlotAdd, undefined,
    'Paste a list (or several) for a dot plot, histogram and box plots — the summary, shape, outliers and a comparison')
  add('stats', 'build-probability', 'Probability', p.onProbabilityAdd, undefined,
    'A two-way table, a Venn diagram or a tree diagram')
  add('stats', 'build-normal', 'Normal distribution', p.onNormalAdd, undefined,
    'N(μ, σ): shade a probability, read the z-scores, find the value for a percentile, show the empirical rule')
  add('stats', 'build-simulation', 'Simulation', p.onSimulationAdd, undefined,
    'Repeated samples of means or proportions with the margin of error, or a randomisation test')
  // ---- Number line
  add('numberline', 'build-nl-solve', 'Solve an inequality', focus.onSolveInequality, undefined,
    'Switch to the number line and type an inequality: critical values, a sign chart and the solution set')
  return rows
}
