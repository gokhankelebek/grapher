import { useEffect, useRef, useState } from 'react'
import type { BoardKind } from '../core/types'
import type { DocMeta } from '../core/persist'

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
          title="Rename this document"
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
      {saveState !== 'saved' && (
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
            <button className="doc-item" role="menuitem" onClick={pick(onDuplicate)}>
              Duplicate
            </button>
            {/* "Save a backup…" writes a DOCUMENT; Download writes a PNG. The
                old wording ("Export to file…") was being read as the picture. */}
            <button className="doc-item" role="menuitem" onClick={pick(onExport)}>
              Save a backup…
            </button>
            <button className="doc-item" role="menuitem" onClick={() => fileRef.current?.click()}>
              Import from file…
            </button>
            {confirmClear ? (
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
                      title={`Open “${d.name}”`}
                      onClick={pick(() => onOpen(d.id))}
                    >
                      <span className="doc-open-name">{d.name}</span>
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
