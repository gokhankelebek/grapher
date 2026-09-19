import type { ReactNode } from 'react'

interface Props {
  sidebarOpen: boolean
  canUndo: boolean
  canRedo: boolean
  showAnalysis: boolean
  onToggleAnalysis(): void
  /** Ground the on-screen canvas is drawn on. */
  canvasTheme: 'dark' | 'light'
  onToggleCanvasTheme(): void
  /** Document name + save state + documents menu. */
  docMenu?: ReactNode
  /** Download ▾ — the way out of the app. */
  exportMenu?: ReactNode
  onToggleSidebar(): void
  onUndo(): void
  onRedo(): void
}

/**
 * The toolbar, after two controls left it.
 *
 * Draw/Pan is gone because the canvas is modeless: Space or a middle-drag or
 * two fingers pan, a tap selects, a tap on nothing deselects. A mode that was
 * needed once in seven flows cost a curve every time it was set wrong.
 *
 * Clear is gone because a destructive button beside Undo is a live-demo
 * landmine — "Remove all curves" now lives in the document menu behind a
 * confirm, which is one extra click for the once-a-lesson case and no clicks
 * at all for the accident.
 */
export function Toolbar({
  sidebarOpen,
  canUndo,
  canRedo,
  showAnalysis,
  onToggleAnalysis,
  canvasTheme,
  onToggleCanvasTheme,
  docMenu,
  exportMenu,
  onToggleSidebar,
  onUndo,
  onRedo,
}: Props) {
  return (
    <div className="toolbar">
      <button
        className="tb-btn tb-icon"
        onClick={onToggleSidebar}
        title={sidebarOpen ? 'Hide sidebar (\\)' : 'Show sidebar (\\)'}
        aria-label="Toggle sidebar"
        aria-pressed={sidebarOpen}
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

      <button
        className={`tb-btn tb-toggle${showAnalysis ? ' tb-toggle-on' : ''}`}
        onClick={onToggleAnalysis}
        aria-pressed={showAnalysis}
        title={showAnalysis ? 'Hide analysis markers (A)' : 'Show analysis markers (A)'}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M3 17c3.5 0 5-10 9-10s5.5 5 9 5"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <circle cx="7.6" cy="12.4" r="2.1" fill="currentColor" />
          <circle cx="16.4" cy="9.6" r="2.1" fill="currentColor" />
        </svg>
        Analysis
      </button>

      <button
        className="tb-btn tb-icon"
        onClick={onToggleCanvasTheme}
        aria-pressed={canvasTheme === 'light'}
        data-testid="canvas-theme"
        data-canvas-theme={canvasTheme}
        title={canvasTheme === 'light' ? 'Canvas: light' : 'Canvas: dark'}
        aria-label="Toggle canvas background"
      >
        {canvasTheme === 'light' ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.7" />
            <path
              d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M20.5 14.6A8.8 8.8 0 0 1 9.4 3.5a8.8 8.8 0 1 0 11.1 11.1Z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      <div className="tb-sep" />

      <button className="tb-btn" onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z)">
        Undo
      </button>
      <button className="tb-btn" onClick={onRedo} disabled={!canRedo} title="Redo (⇧⌘Z)">
        Redo
      </button>

      <div className="tb-sep" />

      {exportMenu}
    </div>
  )
}
