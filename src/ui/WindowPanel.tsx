// ============================================================================
// src/ui/WindowPanel.tsx — Axes (Equal · Independent) and the TI-style WINDOW.
//
// Lives in Board & export settings beside the ruling, because it is the same
// kind of decision: how this board is MEASURED. The four fields show the view
// live — pan the board with the panel open and they follow — until the teacher
// types in one, and Apply (or Enter) sets the view to exactly what they say.
//
// The view moves without a React render (the stage keeps it in a ref), so the
// panel subscribes to view changes rather than being handed the numbers.
// ============================================================================

import { useCallback, useEffect, useId, useState } from 'react'
import type { AxesMode, ViewWindow } from './viewScale'
import { formatWindowValue } from './viewScale'
import { parseNumeric } from './numeric'

export interface ViewSettings {
  mode: AxesMode
  /** The polar ruling is on: Independent is unavailable (circles must stay circles). */
  polar: boolean
  onMode(next: AxesMode): void
  /** The window on screen right now. */
  read(): ViewWindow
  /** Called whenever the view moves; returns the unsubscribe. */
  subscribe(fn: () => void): () => void
  /** Set the view; an error string to show, or null when it was set. */
  onApply(w: ViewWindow): string | null
  /** TI ZSquare: equal axes, same centre, the whole window still in view. */
  onSquare(): void
}

const AXES: ReadonlyArray<{ value: AxesMode; label: string; title: string }> = [
  {
    value: 'equal',
    label: 'Equal',
    title: 'One unit is the same length on both axes — circles are round, slopes look like slopes',
  },
  {
    value: 'independent',
    label: 'Independent',
    title: 'Scale x and y separately — for data such as years against millions',
  },
]

const KEYS: ReadonlyArray<{ key: keyof ViewWindow; label: string }> = [
  { key: 'xMin', label: 'x min' },
  { key: 'xMax', label: 'x max' },
  { key: 'yMin', label: 'y min' },
  { key: 'yMax', label: 'y max' },
]

type Drafts = Partial<Record<keyof ViewWindow, string>>

export function WindowPanel({ view }: { view: ViewSettings }) {
  const uid = useId()
  const [, setTick] = useState(0)
  const [drafts, setDrafts] = useState<Drafts>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => view.subscribe(() => setTick((t) => t + 1)), [view])

  const live = view.read()
  const shown = (k: keyof ViewWindow): string => {
    const d = drafts[k]
    if (d !== undefined) return d
    const span = k === 'xMin' || k === 'xMax' ? live.xMax - live.xMin : live.yMax - live.yMin
    return formatWindowValue(live[k], span)
  }

  const apply = useCallback((): void => {
    const now = view.read()
    const next: ViewWindow = { ...now }
    for (const { key, label } of KEYS) {
      const d = drafts[key]
      if (d === undefined) continue
      const v = parseNumeric(d)
      if (v === null) {
        setError(`${label} has to be a number`)
        return
      }
      next[key] = v
    }
    const err = view.onApply(next)
    setError(err)
    if (err === null) setDrafts({})
  }, [drafts, view])

  return (
    <>
      <div className="exp-title">Axes</div>
      <div
        className="seg exp-seg"
        role="group"
        aria-label="Axes scale"
        data-testid="axes-mode"
        data-axes={view.mode}
      >
        {AXES.map((a) => {
          const locked = a.value === 'independent' && view.polar && view.mode !== 'independent'
          return (
            <button
              key={a.value}
              className={`seg-btn${view.mode === a.value ? ' seg-on' : ''}`}
              data-testid={`axes-mode-${a.value}`}
              aria-pressed={view.mode === a.value}
              disabled={locked}
              onClick={() => view.onMode(a.value)}
              title={locked ? 'The polar ruling needs equal axes' : a.title}
            >
              {a.label}
            </button>
          )
        })}
      </div>
      <div className="exp-note" data-testid="axes-note">
        {view.polar && view.mode === 'equal'
          ? 'The polar ruling needs equal axes — switch the ruling to Square to scale x and y independently.'
          : 'Drag along an axis’ numbers to stretch it, or ⇧-wheel for x and ⌥-wheel for y. A plain zoom keeps the ratio.'}
      </div>

      <div className="exp-menu-sep" />
      <div className="exp-title">Window</div>
      <form
        className="win-grid"
        data-testid="view-window"
        onSubmit={(e) => {
          e.preventDefault()
          apply()
        }}
      >
        {KEYS.map(({ key, label }) => (
          <label className="win-cell" htmlFor={`${uid}-${key}`} key={key}>
            <span className="win-label">{label}</span>
            <input
              id={`${uid}-${key}`}
              className="exp-num win-num"
              type="text"
              inputMode="decimal"
              spellCheck={false}
              autoComplete="off"
              value={shown(key)}
              data-testid={`view-window-${key}`}
              aria-invalid={error !== null && error.startsWith(label) ? true : undefined}
              onChange={(e) => {
                const v = e.target.value
                setDrafts((d) => ({ ...d, [key]: v }))
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  apply()
                }
              }}
            />
          </label>
        ))}
        <div className="win-actions">
          <button type="submit" className="seg-btn win-btn" data-testid="view-window-apply">
            Apply
          </button>
          <button
            type="button"
            className="seg-btn win-btn"
            data-testid="view-window-square"
            title="Equal axes, same centre, with the whole window still in view"
            onClick={() => {
              setDrafts({})
              setError(null)
              view.onSquare()
            }}
          >
            Square it
          </button>
          {Object.keys(drafts).length > 0 && (
            <button
              type="button"
              className="seg-btn win-btn"
              data-testid="view-window-revert"
              title="Show the view on screen again"
              onClick={() => {
                setDrafts({})
                setError(null)
              }}
            >
              Revert
            </button>
          )}
        </div>
      </form>
      {error ? (
        <div className="exp-note win-error" role="alert" data-testid="view-window-error">
          {error}
        </div>
      ) : (
        <div className="exp-note">
          The view on screen, live. Type the edges you want and press Enter — the axes become
          Independent when the window needs it. Views are not in the undo history.
        </div>
      )}
    </>
  )
}
