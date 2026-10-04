// ============================================================================
// Document menu → "Share link…": this document as a link, or as a QR code for
// the projector.
//
// The link carries the whole document in its fragment (src/core/share.ts), so
// nothing is uploaded anywhere and no account is needed. Two switches decide
// what a student gets: "View only" (a read-only view with Make a copy) and
// "Open in reveal mode" (the answers hidden behind "?" marks). Both together
// is the STUDENT view: no teacher note, no teacher tools, no "All".
//
// A view-only link leaves the teacher note out unless "Include teacher note"
// is ticked (never in reveal mode: a note holds answers), and an optional
// one-line "Question for students" rides in the link as a banner.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { useDialogFocus } from './useDialogFocus'
import type { ShareFlags } from '../core/share'
import { QUESTION_MAX, SHARE_WARN_LENGTH, buildShareLink, cleanQuestion, shareLengthVerdict } from '../core/share'
import type { QrCode } from '../core/qr'
import { byteCapacity, encodeQrBest, qrSvgPath } from '../core/qr'

interface Props {
  /** The document's name, for the heading. */
  name: string
  /** The document as serializeDoc writes it, taken when the dialog opened. */
  json: string
  /** The page address the link is built on (location.href). */
  baseHref: string
  onClose(): void
}

/** Hosts a student's device cannot reach: the link would open nothing for them. */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '127.0.0.1' ||
    h === '[::1]' ||
    h === '::1' ||
    h.endsWith('.local') ||
    h === '0.0.0.0'
  )
}

/** Above this version a QR code is dense enough to need projecting large. */
const DENSE_QR_VERSION = 25

type Copy = 'idle' | 'copied' | 'failed'

/** Whether a document's JSON carries a teacher note (only then is there a note to include). */
export function docHasNote(json: string): boolean {
  try {
    const note = (JSON.parse(json) as { board?: { note?: unknown } } | null)?.board?.note
    return typeof note === 'string' && note.trim() !== ''
  } catch {
    return false
  }
}

export function ShareDialog({ name, json, baseHref, onClose }: Props) {
  const [flags, setFlags] = useState<ShareFlags>({ view: false, reveal: false })
  const [question, setQuestion] = useState('')
  const hasNote = useMemo(() => docHasNote(json), [json])
  /** What the link is built from: the switches, and the question as it will travel. */
  const linkFlags = useMemo<ShareFlags>(() => {
    const q = cleanQuestion(question)
    return {
      view: flags.view,
      reveal: flags.reveal,
      ...(flags.view && !flags.reveal && flags.note && hasNote ? { note: true } : {}),
      ...(q ? { question: q } : {}),
    }
  }, [flags, question, hasNote])
  const [link, setLink] = useState<{ url: string; length: number } | null>(null)
  const [copy, setCopy] = useState<Copy>('idle')
  const [showQr, setShowQr] = useState(false)
  const fieldRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // (Re)build the link whenever a switch changes. Async: CompressionStream.
  useEffect(() => {
    let live = true
    setCopy('idle')
    buildShareLink(baseHref, json, linkFlags)
      .then((l) => {
        if (live) setLink({ url: l.url, length: l.length })
      })
      .catch(() => {
        if (live) setLink(null)
      })
    return () => {
      live = false
    }
  }, [baseHref, json, linkFlags])

  useDialogFocus(dialogRef, onClose, { escape: false, autoFocus: false })
  useEffect(() => {
    dialogRef.current?.focus()
    // Captured at the window and stopped: while the dialog is up, the board's
    // single-key shortcuts (R, F, Delete…) must not fire behind it. Default
    // actions — Tab, Space on a checkbox, ⌘C in the link — still happen.
    const onKey = (e: KeyboardEvent): void => {
      e.stopPropagation()
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const verdict = link ? shareLengthVerdict(link.length) : null
  const local = useMemo(() => {
    try {
      return isLocalHost(new URL(baseHref).hostname)
    } catch {
      return false
    }
  }, [baseHref])

  const qr = useMemo<{ code: QrCode } | { error: string } | null>(() => {
    if (!showQr || !link) return null
    const code = encodeQrBest(link.url)
    if (code) return { code }
    return {
      error: `This link is too long for a QR code: ${link.length.toLocaleString('en-US')} characters, and one code holds at most ${byteCapacity(40, 'L').toLocaleString('en-US')}. Share the link itself, or use Save a backup… for a big document.`,
    }
  }, [showQr, link])

  const doCopy = async (): Promise<void> => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopy('copied')
    } catch {
      // Clipboard API refused (an insecure origin, an old browser): select the
      // text and fall back to the legacy command.
      const el = fieldRef.current
      if (el) {
        el.focus()
        el.select()
        try {
          setCopy(document.execCommand('copy') ? 'copied' : 'failed')
        } catch {
          setCopy('failed')
        }
      } else setCopy('failed')
    }
  }

  const set = (k: 'view' | 'reveal' | 'note') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFlags((f) => ({ ...f, [k]: e.target.checked }))

  return (
    <div className="share-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`share-dialog${showQr ? ' share-dialog-qr' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        tabIndex={-1}
        ref={dialogRef}
        data-testid="share-dialog"
      >
        <div className="share-head">
          <h2 id="share-title" className="share-title">
            Share “{name}”
          </h2>
          <button className="share-x" onClick={onClose} aria-label="Close" title="Close (Esc)">
            ×
          </button>
        </div>

        {showQr ? (
          <div className="share-qr-panel">
            {qr && 'code' in qr ? (
              <>
                <svg
                  className="share-qr"
                  data-testid="share-qr"
                  viewBox={`0 0 ${qr.code.size + 8} ${qr.code.size + 8}`}
                  shapeRendering="crispEdges"
                  role="img"
                  aria-label="QR code for the share link"
                >
                  <rect width={qr.code.size + 8} height={qr.code.size + 8} fill="#fff" />
                  <path d={qrSvgPath(qr.code, 4)} fill="#000" />
                </svg>
                <p className="share-note">
                  Scan with a phone or tablet camera.
                  {qr.code.version > DENSE_QR_VERSION
                    ? ' This is a dense code — put it on the projector full screen, or share the link instead.'
                    : ''}
                  {flags.view ? ' Opens view only.' : ''}
                  {flags.reveal ? ' Opens in reveal mode.' : ''}
                  {linkFlags.question ? ' Shows your question.' : ''}
                </p>
              </>
            ) : qr && 'error' in qr ? (
              <p className="share-warn" role="alert">
                {qr.error}
              </p>
            ) : (
              <p className="share-note">Making the code…</p>
            )}
            <div className="share-actions">
              <button className="share-btn" onClick={() => setShowQr(false)}>
                Back to the link
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="share-lede">
              Anyone with this link opens their own copy of this graph — no account, nothing uploaded. The
              document travels inside the link itself.
            </p>

            <div className="share-options">
              <label className="share-check">
                <input type="checkbox" checked={flags.view} onChange={set('view')} data-testid="share-view" />
                <span>
                  <strong>View only</strong>
                  <span className="share-sub">
                    Students can look, zoom and reveal, but not change it. They can Make a copy.
                  </span>
                </span>
              </label>
              <label className="share-check">
                <input type="checkbox" checked={flags.reveal} onChange={set('reveal')} data-testid="share-reveal" />
                <span>
                  <strong>Open in reveal mode</strong>
                  <span className="share-sub">
                    The answers start hidden behind “?” marks.
                    {flags.view ? ' With View only, students step through them with Next — no All, no Reset.' : ''}
                  </span>
                </span>
              </label>
              {flags.view && hasNote && (
                <label className={`share-check${flags.reveal ? ' share-check-off' : ''}`}>
                  <input
                    type="checkbox"
                    checked={flags.note === true && !flags.reveal}
                    disabled={flags.reveal}
                    onChange={set('note')}
                    data-testid="share-note"
                  />
                  <span>
                    <strong>Include teacher note</strong>
                    <span className="share-sub">
                      {flags.reveal
                        ? 'Never shown in reveal mode — a note can give the answers away.'
                        : 'Off: students don’t see the note, and the link doesn’t carry it.'}
                    </span>
                  </span>
                </label>
              )}
            </div>

            <label className="share-question">
              <span className="share-question-label">
                Question for students <span className="share-sub">(optional · shown as a banner)</span>
              </span>
              <input
                className="share-question-input"
                type="text"
                value={question}
                maxLength={QUESTION_MAX}
                placeholder="e.g. Which sum is closer to the area, and why?"
                onChange={(e) => setQuestion(e.target.value)}
                data-testid="share-question"
              />
            </label>

            <div className="share-link-row">
              <input
                ref={fieldRef}
                className="share-link"
                readOnly
                value={link?.url ?? 'Building the link…'}
                aria-label="Share link"
                data-testid="share-link"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                className="share-btn share-primary"
                onClick={doCopy}
                disabled={!link}
                data-testid="share-copy"
              >
                {copy === 'copied' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="share-meta">
              <span data-testid="share-length">
                {link ? `${link.length.toLocaleString('en-US')} characters` : ''}
              </span>
              {copy === 'failed' && <span className="share-warn-inline">Couldn’t copy — select the link and copy it.</span>}
            </div>

            {verdict?.warning && (
              <p className="share-warn" role="alert" data-testid="share-long">
                {verdict.warning}
              </p>
            )}
            {local && (
              <p className="share-note" data-testid="share-local">
                This link points at this computer ({new URL(baseHref).host}), so it only opens here. To share
                with students, open Grapher from its published address first (see DEPLOY.md).
              </p>
            )}

            <div className="share-actions">
              <button
                className="share-btn"
                onClick={() => setShowQr(true)}
                disabled={!link}
                data-testid="share-qr-open"
                title="A QR code of this link, for the projector"
              >
                Share as QR code
              </button>
              <span className="share-spacer" />
              <span className="share-fine">
                Links over {SHARE_WARN_LENGTH.toLocaleString('en-US')} characters may be cut short by some LMS and
                email clients.
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
