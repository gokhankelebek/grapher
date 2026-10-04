// ============================================================================
// src/ui/AboutDialog.tsx — Settings → About & privacy.
//
// The product name, the promise, the privacy details (the same sentence as
// the landing page's footer, from src/brand.ts), where the source lives and
// where feedback goes. Nothing here is fetched: it is all in the bundle.
// ============================================================================

import { useRef } from 'react'
import { BRAND, FEEDBACK_URL, ISSUES_URL, PRIVACY_LINE, REPO_URL, TAGLINE, TRUST_LINE } from '../brand'
import { useDialogFocus } from './useDialogFocus'

interface Props {
  /** Save a backup: every document, as one file. Absent: not offered (a student). */
  onBackup?(): void
  onClose(): void
}

export function AboutDialog({ onBackup, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref, onClose, { fallback: '#board-canvas' })
  const feedback = FEEDBACK_URL || ISSUES_URL
  return (
    <div className="share-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="share-dialog about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        tabIndex={-1}
        data-testid="about-dialog"
        onKeyDown={(e) => {
          if (e.key !== 'Tab' && e.key !== 'Escape') e.stopPropagation()
        }}
      >
        <div className="share-head">
          <h2 id="about-title" className="share-title">
            About {BRAND}
          </h2>
          <button className="share-x" onClick={onClose} aria-label="Close" title="Close (Esc)">
            ×
          </button>
        </div>
        <p className="about-tag">{TAGLINE}</p>
        <p className="about-trust">{TRUST_LINE}</p>
        <div className="about-block">
          <h3 className="about-h">Privacy</h3>
          <p className="share-lede">{PRIVACY_LINE}</p>
          <p className="share-lede">
            A share link carries the graph inside the link itself. Because your graphs live in this browser only, save
            a backup now and then — a cleared browser or a new Chromebook starts empty.
          </p>
          {onBackup && (
            <button type="button" className="about-action" onClick={onBackup}>
              Save a backup (.json)
            </button>
          )}
        </div>
        <ul className="about-links">
          <li>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
              Source on GitHub
            </a>
          </li>
          <li>
            <a href={feedback} target="_blank" rel="noopener noreferrer" data-testid="about-feedback">
              {FEEDBACK_URL ? 'Send feedback' : 'Feedback and bug reports (GitHub issues)'}
            </a>
          </li>
        </ul>
      </div>
    </div>
  )
}
