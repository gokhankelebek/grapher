import { useEffect, useRef, useState } from 'react'
import type { DocMeta } from '../core/persist'

export type SaveState = 'saved' | 'saving' | 'error'

interface Props {
  name: string
  currentId: string | null
  docs: DocMeta[]
  saveState: SaveState
  onRename(name: string): void
  onNew(): void
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
  onRename,
  onNew,
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
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false)
        setConfirmId(null)
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
    fn()
  }

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

      <span
        className={`doc-save doc-save-${saveState}`}
        title={
          saveState === 'error'
            ? 'Your latest changes are not saved'
            : saveState === 'saving'
              ? 'Saving…'
              : 'All changes saved to this browser'
        }
      >
        {saveState === 'error' ? 'unsaved' : saveState === 'saving' ? 'saving…' : 'saved'}
      </span>

      <button
        className={`doc-caret${open ? ' doc-caret-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Document menu"
        title="Documents"
        onClick={() => {
          setOpen((o) => !o)
          setConfirmId(null)
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="doc-menu" role="menu">
          <div className="doc-menu-actions">
            <button className="doc-item" role="menuitem" onClick={pick(onNew)}>
              New document
            </button>
            <button className="doc-item" role="menuitem" onClick={pick(onDuplicate)}>
              Duplicate
            </button>
            <button className="doc-item" role="menuitem" onClick={pick(onExport)}>
              Export to file…
            </button>
            <button className="doc-item" role="menuitem" onClick={() => fileRef.current?.click()}>
              Import from file…
            </button>
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
