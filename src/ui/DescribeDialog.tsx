// ============================================================================
// src/ui/DescribeDialog.tsx — "Describe this graph".
//
// The board in words, as a screen reader hears it — and as a teacher wants it
// for alt text in a worksheet, an LMS or an accommodation plan. Two copies:
// the full description, and the one-line alt text. In reveal mode it is the
// student copy (no computed answers), and it says so.
//
// Opened from ⌘K, the help sheet and the toolbar's ⋯ menu.
// ============================================================================

import { useRef } from 'react'
import type { BoardDescription } from './boardDescription'
import { useDialogFocus } from './useDialogFocus'

interface Props {
  description: BoardDescription
  /** Reveal mode is on: the description leaves the answers out. */
  studentCopy: boolean
  onCopy(text: string, what: string): void
  onClose(): void
}

export function DescribeDialog({ description, studentCopy, onCopy, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(dialogRef, onClose, { fallback: '#board-canvas' })
  const paras = description.long.split(/\n\n+/).filter((p) => p.trim() !== '')

  return (
    <div className="share-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="share-dialog describe-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="describe-title"
        aria-describedby="describe-body"
        tabIndex={-1}
        ref={dialogRef}
        data-testid="describe-dialog"
        // The board's single-key shortcuts must not fire behind the dialog.
        onKeyDown={(e) => {
          if (e.key !== 'Tab' && e.key !== 'Escape') e.stopPropagation()
        }}
      >
        <div className="share-head">
          <h2 id="describe-title" className="share-title">
            Describe this graph
          </h2>
          <button className="share-x" onClick={onClose} aria-label="Close" title="Close (Esc)">
            ×
          </button>
        </div>
        <p className="share-lede">
          What a screen reader says about the board{studentCopy ? ' — reveal mode is on, so the answers are left out' : ''}.
          Copy it as alt text for a figure.
        </p>
        <div className="describe-body" id="describe-body" data-testid="describe-long" tabIndex={0}>
          {paras.length > 0 ? paras.map((p, i) => <p key={i}>{p}</p>) : <p>{description.figuredesc}</p>}
        </div>
        <div className="describe-alt">
          <span className="describe-alt-label">Alt text (one line)</span>
          <span className="describe-alt-text" data-testid="describe-alt">{description.figuredesc}</span>
        </div>
        <div className="share-actions">
          <button
            className="share-btn share-primary"
            data-testid="describe-copy"
            onClick={() => onCopy(description.long || description.figuredesc, 'the description')}
          >
            Copy description
          </button>
          <button
            className="share-btn"
            data-testid="describe-copy-alt"
            onClick={() => onCopy(description.figuredesc, 'the alt text')}
          >
            Copy alt text
          </button>
          <span className="share-spacer" />
          <button className="share-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
