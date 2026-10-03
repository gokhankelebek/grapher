import { useEffect, useRef, useState } from 'react'
import type { BoardKind } from '../core/types'
import type { DocMeta } from '../core/persist'
import { describeCounts } from './docName'

export type SaveState = 'saved' | 'saving' | 'error'

interface Props {
  name: string
  currentId: string | null
  docs: DocMeta[]
  saveState: SaveState
  /** What kind of board the open document is — names what "remove all" removes. */
  kind: BoardKind
  /** True when there is anything on the board to remove. */
  hasContent: boolean
  onRename(name: string): void
  onNew(kind: BoardKind): void
  /** Wipe this board's contents. Destructive, confirmed, and undoable. */
  onClearBoard(): void
  onOpen(id: string): void
  onDuplicate(): void
  onDelete(id: string): void
  onExport(): void
  onImport(file: File): void
  /** Open the worksheet builder: several documents' figures on one page. */
  onWorksheet?(): void
  /** Open the examples gallery: ready-made boards, opened as copies. */
  onExamples?(): void
  /** Open "Graph from item…": paste an item bank record, graph what it defines. */
  onGraphFromItem?(): void
  /** Open the share dialog: this document as a link (or a QR code). */
  onShare?(): void
  /**
   * The open document came from a share link and is not in this browser's
   * documents: 'edit' can be changed (and is saved as a copy if it is),
   * 'view' is a read-only student view. Absent = an ordinary document.
   */
  shared?: 'edit' | 'view' | null
  /** Save the shared document into this browser's documents. */
  onMakeCopy?(): void
}

function relativeTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return 'never'
  const diff = Date.now() - ts
  const min = Math.round(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * The kind of board a row is, as a glyph.
 *
 * A row used to be a name and a relative time, and when four boards are all
 * called "Untitled" the only thing distinguishing them is "just now" versus
 * "4 min ago". What actually tells them apart is what they ARE — a graph or a
 * number line — and what is on them.
 */
function KindIcon({ kind }: { kind: BoardKind }) {
  return kind === 'number-line' ? (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.5 8h13M2.6 6.6 1.3 8l1.3 1.4M13.4 6.6 14.7 8l-1.3 1.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="8" r="2" fill="currentColor" />
      <circle cx="11" cy="8" r="1.7" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ) : (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.2 2v11.8h11.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path
        d="M3.6 11.4c2.1 0 2.6-6.4 4.6-6.4s2.5 3.2 4.6 3.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function DocMenu({
  name,
  currentId,
  docs,
  saveState,
  kind,
  hasContent,
  onRename,
  onNew,
  onClearBoard,
  onOpen,
  onDuplicate,
  onDelete,
  onExport,
  onImport,
  onWorksheet,
  onExamples,
  onGraphFromItem,
  onShare,
  shared = null,
  onMakeCopy,
}: Props) {
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(name)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [renaming])

  // Close the menu on an outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setConfirmId(null)
        setConfirmClear(false)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false)
        setConfirmId(null)
        setConfirmClear(false)
      }
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const commitRename = (): void => {
    const next = draft.trim()
    setRenaming(false)
    if (next && next !== name) onRename(next)
    else setDraft(name)
  }

  const pick = (fn: () => void) => () => {
    setOpen(false)
    setConfirmId(null)
    setConfirmClear(false)
    fn()
  }

  const clearTitle = kind === 'number-line' ? 'Remove everything on the line' : 'Remove all curves'

  return (
    <div className="doc" ref={wrapRef}>
      {renaming ? (
        <input
          ref={inputRef}
          className="doc-rename"
          value={draft}
          maxLength={80}
          aria-label="Document name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitRename()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setDraft(name)
              setRenaming(false)
            }
          }}
        />
      ) : (
        <button
          className="doc-name"
          title={shared === 'view' ? 'A shared graph (view only)' : 'Rename this document'}
          disabled={shared === 'view'}
          onClick={() => {
            setDraft(name)
            setRenaming(true)
          }}
        >
          {name}
        </button>
      )}

      {/* Only the states worth a teacher's attention. A permanent "saved"
          badge is a promise nobody asked for taking up room beside the name
          every second of the lesson; "saving…" and "unsaved" are news. */}
      {shared && (
        <span
          className="doc-shared"
          data-testid="doc-shared-badge"
          title={
            shared === 'view'
              ? 'Opened from a share link, view only. Make a copy to keep it and edit it.'
              : 'Opened from a share link. It is not in your documents until you make a copy — editing it saves one automatically when you switch away.'
          }
        >
          {shared === 'view' ? 'Shared · view only' : 'Shared'}
        </span>
      )}

      {!shared && saveState !== 'saved' && (
        <span
          className={`doc-save doc-save-${saveState}`}
          title={saveState === 'error' ? 'Your latest changes are not saved' : 'Saving…'}
        >
          {saveState === 'error' ? 'unsaved' : 'saving…'}
        </span>
      )}

      <button
        className={`doc-caret${open ? ' doc-caret-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Document menu"
        title="Documents"
        onClick={() => {
          setOpen((o) => !o)
          setConfirmId(null)
          setConfirmClear(false)
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="doc-menu" role="menu">
          <div className="doc-menu-actions">
            {shared && onMakeCopy && (
              <button
                className="doc-item doc-item-strong"
                role="menuitem"
                data-testid="doc-make-copy"
                title="Save this shared graph into your own documents"
                onClick={pick(onMakeCopy)}
              >
                Make a copy
              </button>
            )}
            {onShare && (
              <button
                className="doc-item"
                role="menuitem"
                data-testid="open-share"
                title="A link (or a QR code) that opens exactly this graph — no account needed"
                onClick={pick(onShare)}
              >
                Share link…
              </button>
            )}
            <button className="doc-item" role="menuitem" onClick={pick(() => onNew('cartesian'))}>
              New graph
            </button>
            <button
              className="doc-item"
              role="menuitem"
              onClick={pick(() => onNew('number-line'))}
            >
              New number line
            </button>
            {onExamples && (
              <button
                className="doc-item"
                role="menuitem"
                title="Ready-to-teach boards for each unit — each opens as a copy in your documents"
                data-testid="open-examples"
                onClick={pick(onExamples)}
              >
                Examples…
              </button>
            )}
            {onGraphFromItem && (
              <button
                className="doc-item"
                role="menuitem"
                title="Paste an item bank stem or %%% ITEM record — its definitions open as a new graph"
                data-testid="open-graph-from-item"
                onClick={pick(onGraphFromItem)}
              >
                Graph from item…
              </button>
            )}
            {!shared && (
              <button className="doc-item" role="menuitem" onClick={pick(onDuplicate)}>
                Duplicate
              </button>
            )}
            {onWorksheet && (
              <button
                className="doc-item"
                role="menuitem"
                title="Put figures from several documents on one printable page"
                data-testid="open-worksheet"
                onClick={pick(onWorksheet)}
              >
                Worksheet…
              </button>
            )}
            {/* "Save a backup…" writes a DOCUMENT; Download writes a PNG. The
                old wording ("Export to file…") was being read as the picture. */}
            <button className="doc-item" role="menuitem" onClick={pick(onExport)}>
              Save a backup…
            </button>
            <button className="doc-item" role="menuitem" onClick={() => fileRef.current?.click()}>
              Import from file…
            </button>
            {shared === 'view' ? null : confirmClear ? (
              <div className="doc-confirm doc-confirm-clear">
                <span className="doc-confirm-text">{clearTitle}?</span>
                <button
                  className="doc-confirm-yes"
                  onClick={() => {
                    setConfirmClear(false)
                    setOpen(false)
                    onClearBoard()
                  }}
                >
                  Remove
                </button>
                <button className="doc-confirm-no" onClick={() => setConfirmClear(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="doc-item tb-danger"
                role="menuitem"
                disabled={!hasContent}
                title={`${clearTitle} (undoable)`}
                onClick={() => setConfirmClear(true)}
              >
                {clearTitle}
              </button>
            )}
          </div>

          <div className="doc-menu-sep" />
          <div className="doc-menu-title">Saved documents</div>
          <div className="doc-list">
            {docs.length === 0 && <div className="doc-empty">No saved documents yet.</div>}
            {docs.map((d) => (
              <div key={d.id} className={`doc-row${d.id === currentId ? ' doc-row-current' : ''}`}>
                {confirmId === d.id ? (
                  <div className="doc-confirm">
                    <span className="doc-confirm-text">Delete “{d.name}”?</span>
                    <button
                      className="doc-confirm-yes"
                      onClick={() => {
                        setConfirmId(null)
                        setOpen(false)
                        onDelete(d.id)
                      }}
                    >
                      Delete
                    </button>
                    <button className="doc-confirm-no" onClick={() => setConfirmId(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      className="doc-open"
                      role="menuitem"
                      title={`Open “${d.name}”${
                        d.counts ? ` — ${describeCounts(d.kind ?? 'cartesian', d.counts)}` : ''
                      }`}
                      onClick={pick(() => onOpen(d.id))}
                    >
                      <span className="doc-open-icon" aria-hidden="true">
                        <KindIcon kind={d.kind ?? 'cartesian'} />
                      </span>
                      <span className="doc-open-name">{d.name}</span>
                      {d.counts && (
                        <span className="doc-open-count">
                          {describeCounts(d.kind ?? 'cartesian', d.counts)}
                        </span>
                      )}
                      <span className="doc-open-date">{relativeTime(d.modifiedAt)}</span>
                    </button>
                    <button
                      className="doc-del"
                      title={`Delete “${d.name}”`}
                      aria-label={`Delete ${d.name}`}
                      onClick={() => setConfirmId(d.id)}
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = '' // allow re-importing the same file
          setOpen(false)
          if (f) onImport(f)
        }}
      />
    </div>
  )
}
