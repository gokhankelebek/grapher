import type { ReactNode } from 'react'
import type { BoardKind } from '../core/types'

/**
 * One board type, as the user meets it.
 *
 * Choosing the kind of board is the FIRST decision, not a setting — GraphFree,
 * the tool this replaces, opens on it ("Make a Graph → Cartesian / Polar /
 * Number Line / Semi-Log"). It lived in the document menu here, three clicks
 * behind a caret, which is why nobody found it.
 *
 * Polar and semi-log grids are planned. Adding one is adding a row to this
 * table and a branch to the board — nothing about the control changes.
 */
export interface BoardKindOption {
  kind: BoardKind
  /** Button text. These sit side by side, so keep it to a word or two. */
  label: string
  /** Tooltip: what the board is FOR, plus the promise that switching is safe. */
  title: string
  icon: ReactNode
}

const AxesIcon = (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2.5 13.5V2.5M2.5 13.5h11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M4 11.5c2.2 0 2.6-6 5-6 1.4 0 2.1 2 3.5 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
)

const LineIcon = (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M1.5 8h13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M2.6 6.6 1.4 8l1.2 1.4M13.4 6.6 14.6 8l-1.2 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="6" cy="8" r="2" fill="currentColor" />
    <circle cx="11" cy="8" r="1.7" stroke="currentColor" strokeWidth="1.3" />
  </svg>
)

export const BOARD_KINDS: BoardKindOption[] = [
  {
    kind: 'cartesian',
    label: 'Graph',
    title: 'Graph — sketch or type curves on an x–y grid. Switching keeps whatever is on the number line.',
    icon: AxesIcon,
  },
  {
    kind: 'number-line',
    label: 'Number line',
    title:
      'Number line — solution sets, domains and interval notation. Switching keeps whatever is on the graph.',
    icon: LineIcon,
  },
]

interface Props {
  kind: BoardKind
  onSetKind(kind: BoardKind): void
}

/** The board-type chooser, in the open where it is the first thing seen. */
export function BoardKindSwitch({ kind, onSetKind }: Props) {
  return (
    <div className="board-kind" role="group" aria-label="Board type">
      <div className="board-kind-seg">
        {BOARD_KINDS.map((opt) => {
          const on = opt.kind === kind
          return (
            <button
              key={opt.kind}
              type="button"
              className={`board-kind-btn${on ? ' board-kind-on' : ''}`}
              aria-pressed={on}
              title={opt.title}
              onClick={() => onSetKind(opt.kind)}
            >
              <span className="board-kind-icon" aria-hidden="true">
                {opt.icon}
              </span>
              <span className="board-kind-label">{opt.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
