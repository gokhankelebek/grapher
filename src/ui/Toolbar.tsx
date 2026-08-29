import type { ReactNode } from 'react'
import type { Mode } from '../App'

interface Props {
  mode: Mode
  sidebarOpen: boolean
  canUndo: boolean
  canRedo: boolean
  hasCurves: boolean
  /** Document name + save state + documents menu. */
  docMenu?: ReactNode
  onMode(mode: Mode): void
  onToggleSidebar(): void
  onUndo(): void
  onRedo(): void
  onClear(): void
  onExport(): void
}

export function Toolbar({
  mode,
  sidebarOpen,
  canUndo,
  canRedo,
  hasCurves,
  docMenu,
  onMode,
  onToggleSidebar,
  onUndo,
  onRedo,
  onClear,
  onExport,
}: Props) {
  return (
    <div className="toolbar">
      <button
        className="tb-btn tb-icon"
        onClick={onToggleSidebar}
        title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        aria-label="Toggle sidebar"
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
          <rect x="1" y="2" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
          <line x1="5.5" y1="2.5" x2="5.5" y2="12.5" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>

      <div className="brand" title="Grapher — sketch to math">
        Grapher
      </div>

      {docMenu && (
        <>
          <div className="tb-sep" />
          {docMenu}
        </>
      )}

      <div className="tb-sep" />

      <div className="seg" role="group" aria-label="Interaction mode">
        <button
          className={`seg-btn${mode === 'draw' ? ' seg-on' : ''}`}
          onClick={() => onMode('draw')}
          title="Draw mode (D) — sketch curves, hold Space to pan"
        >
          <svg className="seg-glyph" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
          Draw
        </button>
        <button
          className={`seg-btn${mode === 'pan' ? ' seg-on' : ''}`}
          onClick={() => onMode('pan')}
          title="Pan mode (P) — drag to move, click a curve to select"
        >
          <svg className="seg-glyph" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M18 11V8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15V6.5a1.5 1.5 0 0 1 3 0V11m0 0V4.5a1.5 1.5 0 0 1 3 0V11m0 0V5.5a1.5 1.5 0 0 1 3 0V11"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Pan
        </button>
      </div>

      <div className="tb-sep" />

      <button className="tb-btn" onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z)">
        Undo
      </button>
      <button className="tb-btn" onClick={onRedo} disabled={!canRedo} title="Redo (⇧⌘Z)">
        Redo
      </button>
      <button className="tb-btn" onClick={onClear} disabled={!hasCurves} title="Remove all curves (undoable)">
        Clear
      </button>

      <div className="tb-sep" />

      <button className="tb-btn tb-primary" onClick={onExport} title="Export current view as PNG (2×)">
        Export PNG
      </button>
    </div>
  )
}
