import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Vec2 } from '../core/types'
import { formatSig, parseNumeric } from './numeric'

export interface HandleField {
  key: string
  label: string
  value: number
  /** Rendered after the input (e.g. the degree sign for angles). */
  suffix?: string
}

interface Props {
  title: string
  fields: HandleField[]
  /** Handle position in stage (css px) coordinates. */
  anchor: Vec2
  /** Stage size, used to keep the popover on screen. */
  bounds: { w: number; h: number }
  color: string
  /**
   * skipSnap is TRUE by default here, inverting the drag convention. Dragging is
   * an imprecise gesture, so magnetizing the result to a round value helps; a
   * typed value is already exact, and snapping it destroys the fact the user
   * just stated (2*pi became 6.25, and snapping a sine's frequency slid a crest
   * typed at x=1 to 0.999615). Hold Alt to snap a typed value on purpose.
   */
  onCommit(values: number[], skipSnap: boolean): void
  onCancel(): void
  /**
   * Footer text. Defaults to the handle-drag wording. Callers that never snap
   * (an analysis feature is a stated fact, not a dragged approximation) must
   * pass their own, or the popover would promise a modifier that does nothing.
   */
  hint?: string
}

const DEFAULT_HINT = 'Enter to set exactly · ⌥Enter snaps · Esc cancels'

const GAP = 12
const EDGE = 6

/**
 * Small floating editor anchored to a control handle: type exact values for
 * whatever the handle means (x/y, a radius, an angle, a domain end).
 */
export function HandleInput({
  title,
  fields,
  anchor,
  bounds,
  color,
  onCommit,
  onCancel,
  hint = DEFAULT_HINT,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const inputsRef = useRef<(HTMLInputElement | null)[]>([])
  const [texts, setTexts] = useState<string[]>(() => fields.map((f) => formatSig(f.value)))
  const [bad, setBad] = useState<boolean[]>(() => fields.map(() => false))
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null)

  // Anchor above-right of the handle, flipping/clamping to stay in the stage.
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left = anchor.x + GAP
    if (left + w > bounds.w - EDGE) left = anchor.x - GAP - w
    left = Math.max(EDGE, Math.min(left, Math.max(EDGE, bounds.w - w - EDGE)))
    let top = anchor.y - GAP - h
    if (top < EDGE) top = anchor.y + GAP
    top = Math.max(EDGE, Math.min(top, Math.max(EDGE, bounds.h - h - EDGE)))
    setPlaced({ left, top })
  }, [anchor.x, anchor.y, bounds.w, bounds.h])

  // Focus + select the first field so typing replaces the current value.
  useLayoutEffect(() => {
    const first = inputsRef.current[0]
    if (first) {
      first.focus()
      first.select()
    }
  }, [])

  const commit = (skipSnap: boolean): void => {
    const parsed = texts.map(parseNumeric)
    const nextBad = parsed.map((v) => v === null)
    if (nextBad.some(Boolean)) {
      setBad(nextBad)
      const firstBad = nextBad.indexOf(true)
      inputsRef.current[firstBad]?.focus()
      inputsRef.current[firstBad]?.select()
      return
    }
    onCommit(parsed as number[], skipSnap)
  }

  const onFieldKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, i: number): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit(!e.altKey)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'Tab') {
      // Keep focus inside the popover.
      const last = fields.length - 1
      if (!e.shiftKey && i === last) {
        e.preventDefault()
        inputsRef.current[0]?.focus()
        inputsRef.current[0]?.select()
      } else if (e.shiftKey && i === 0) {
        e.preventDefault()
        inputsRef.current[last]?.focus()
        inputsRef.current[last]?.select()
      }
    }
  }

  return (
    <div
      ref={boxRef}
      className="handle-pop"
      role="dialog"
      aria-label={`Set ${title}`}
      style={
        {
          left: placed ? placed.left : anchor.x + GAP,
          top: placed ? placed.top : anchor.y + GAP,
          visibility: placed ? 'visible' : 'hidden',
          '--curve': color,
        } as CSSProperties
      }
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="handle-pop-title">{title}</div>
      <div className="handle-pop-fields">
        {fields.map((f, i) => (
          <label className="handle-pop-field" key={f.key}>
            <span className="handle-pop-label">{f.label}</span>
            <input
              ref={(el) => {
                inputsRef.current[i] = el
              }}
              className={`handle-pop-input${bad[i] ? ' handle-pop-input-bad' : ''}`}
              type="text"
              inputMode="decimal"
              spellCheck={false}
              autoComplete="off"
              aria-label={f.label}
              aria-invalid={bad[i] || undefined}
              value={texts[i]}
              onChange={(e) => {
                const next = texts.slice()
                next[i] = e.target.value
                setTexts(next)
                if (bad[i]) {
                  const nb = bad.slice()
                  nb[i] = false
                  setBad(nb)
                }
              }}
              onKeyDown={(e) => onFieldKeyDown(e, i)}
            />
            {f.suffix && <span className="handle-pop-suffix">{f.suffix}</span>}
          </label>
        ))}
      </div>
      {/*
        Commit and cancel as BUTTONS, not only as keys.

        On an iPad there is no Esc and no Option: the hint underneath promised
        two modifiers that a soft keyboard does not have, so a typed value
        could be committed (Return exists) but never abandoned — the only way
        out of this popover was to commit a value you did not want and undo it.
        Under `pointer: coarse` these are 44px targets; with a mouse they are
        small, because there the keys really are faster.
      */}
      <div className="handle-pop-foot">
        <div className="handle-pop-hint">{hint}</div>
        <div className="handle-pop-acts">
          <button
            type="button"
            className="handle-pop-act handle-pop-cancel"
            data-testid="handle-cancel"
            title="Cancel (Esc)"
            aria-label="Cancel"
            onClick={onCancel}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="handle-pop-act handle-pop-ok"
            data-testid="handle-commit"
            title="Set this value (Enter)"
            aria-label="Set this value"
            onClick={() => commit(true)}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M3.2 8.6l3 3 6.6-7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
