import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMenuKeys } from './useMenuKeys'

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
  /** "?": the help sheet — everything Grapher can do (src/ui/HelpSheet.tsx). */
  onHelp?(): void
  /** ⋯ → Describe this graph: the board in words, with Copy. */
  onDescribe?(): void
  /** ⋯ → Colour-blind-safe curve colours (a preference). */
  curvePalette?: 'standard' | 'safe'
  onCurvePalette?(next: 'standard' | 'safe'): void
  /**
   * A student's view (a view-only share link in reveal mode): no Analysis
   * switch and no Undo / Redo — the teacher set the board up for them.
   */
  student?: boolean
  /** Examples: the gallery of ready-to-teach boards, one click from anywhere. */
  onExamples?(): void
  /** The rest of the settings menu: courses, backups, About, Feedback. */
  settings?: SettingsItems
  /** The product name shown at the left. */
  brand?: string
}

/** What the settings menu offers besides the accessibility tools. */
export interface SettingsItems {
  /** "Your courses: AP Calculus · AP Precalculus", or '' when none are chosen. */
  coursesLabel?: string
  /** Settings → Your courses… */
  onCourses?(): void
  /** The one-time tip for a teacher who was never asked: "Tell Grapher what you teach". */
  tipDue?: boolean
  onDismissTip?(): void
  /** Save a backup (every document) / Restore from backup… */
  onBackup?(): void
  onRestore?(): void
  /** About & privacy… */
  onAbout?(): void
  /** Where Feedback goes (a mailto:, a form, or the issue tracker). */
  feedbackHref?: string
  /** The product's name, for the tip. */
  brand?: string
}

/**
 * The toolbar's settings menu (the gear): the person's settings in one place —
 * their courses, the canvas theme, the accessibility tools ("Describe this
 * graph", colour-blind-safe colours), backups, About & privacy, Feedback.
 * It replaced two buttons (the moon and a ⋯ whose only item was
 * accessibility). Everything in it is also in ⌘K.
 */
function SettingsMenu({
  onDescribe,
  curvePalette,
  onCurvePalette,
  onHelp,
  canvasTheme,
  onToggleCanvasTheme,
  settings = {},
  student,
}: Pick<Props, 'onDescribe' | 'curvePalette' | 'onCurvePalette' | 'onHelp' | 'canvasTheme' | 'onToggleCanvasTheme' | 'settings' | 'student'>) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const close = useCallback((): void => setOpen(false), [])
  useMenuKeys(open, menuRef, btnRef, close)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])
  const pick = (fn?: () => void) => (): void => {
    setOpen(false)
    fn?.()
    // Back to the gear — unless what ran opened a dialog that took focus.
    window.setTimeout(() => {
      if (document.activeElement === document.body || !document.activeElement) btnRef.current?.focus()
    }, 0)
  }
  const safe = curvePalette === 'safe'
  const light = canvasTheme === 'light'
  const teacher = !student
  const tip = teacher && settings.tipDue && !!settings.onCourses
  return (
    <div className="tb-more tb-settings" ref={wrapRef}>
      <button
        ref={btnRef}
        className={`tb-btn tb-icon${tip ? ' tb-settings-tip' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={tip ? 'Settings (a tip is waiting)' : 'Settings'}
        title="Settings — your courses, theme, accessibility, backups, about"
        data-testid="toolbar-settings"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
            stroke="currentColor"
            strokeWidth="1.7"
          />
          <path
            d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4.9a7.7 7.7 0 0 0-2.6-1.5L14 2.4h-4l-.4 2.5A7.7 7.7 0 0 0 7 6.4l-2.4-.9-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-.9a7.7 7.7 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.7 7.7 0 0 0 2.6-1.5l2.4.9 2-3.4-2-1.6Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
        {tip && <span className="tb-tip-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="doc-menu tb-more-menu tb-settings-menu" role="menu" aria-label="Settings" ref={menuRef}>
          {tip && (
            <div className="tb-tip" data-testid="courses-tip">
              <button className="doc-item tb-tip-main" role="menuitem" onClick={pick(settings.onCourses)}>
                <strong>Tell {settings.brand ?? 'Grapher'} what you teach</strong>
                <span className="tb-tip-text">Your courses’ tools and examples come first.</span>
              </button>
              <button
                className="tb-tip-x"
                role="menuitem"
                aria-label="Dismiss the tip"
                title="Dismiss"
                onClick={() => settings.onDismissTip?.()}
              >
                ×
              </button>
            </div>
          )}
          {teacher && settings.onCourses && (
            <button className="doc-item tb-set-row" role="menuitem" data-testid="settings-courses" onClick={pick(settings.onCourses)}>
              <span>Your courses…</span>
              <span className="tb-set-val">{settings.coursesLabel || 'All'}</span>
            </button>
          )}
          <button
            className="doc-item"
            role="menuitemcheckbox"
            aria-checked={light}
            data-testid="canvas-theme"
            data-canvas-theme={canvasTheme}
            onClick={pick(onToggleCanvasTheme)}
          >
            <span className="tb-more-check" aria-hidden="true">{light ? '✓' : ''}</span>
            Light canvas
          </button>
          {(onDescribe || onCurvePalette) && <div className="doc-menu-sep" role="separator" />}
          {onDescribe && (
            <button className="doc-item" role="menuitem" data-testid="more-describe" onClick={pick(onDescribe)}>
              Describe this graph…
            </button>
          )}
          {onCurvePalette && (
            <button
              className="doc-item"
              role="menuitemcheckbox"
              aria-checked={safe}
              data-testid="more-colour-safe"
              onClick={pick(() => onCurvePalette(safe ? 'standard' : 'safe'))}
            >
              <span className="tb-more-check" aria-hidden="true">{safe ? '✓' : ''}</span>
              Color-blind-safe colors
            </button>
          )}
          {teacher && (settings.onBackup || settings.onRestore) && <div className="doc-menu-sep" role="separator" />}
          {teacher && settings.onBackup && (
            <button className="doc-item" role="menuitem" data-testid="settings-backup" onClick={pick(settings.onBackup)}>
              Save a backup (.json)
            </button>
          )}
          {teacher && settings.onRestore && (
            <button className="doc-item" role="menuitem" data-testid="settings-restore" onClick={pick(settings.onRestore)}>
              Restore from backup…
            </button>
          )}
          <div className="doc-menu-sep" role="separator" />
          {onHelp && (
            <button className="doc-item" role="menuitem" onClick={pick(onHelp)}>
              Keyboard and help…
            </button>
          )}
          {settings.onAbout && (
            <button className="doc-item" role="menuitem" data-testid="settings-about" onClick={pick(settings.onAbout)}>
              About &amp; privacy…
            </button>
          )}
          {teacher && settings.feedbackHref && (
            <a
              className="doc-item tb-set-link"
              role="menuitem"
              href={settings.feedbackHref}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="settings-feedback"
              onClick={() => setOpen(false)}
            >
              Feedback ↗
            </a>
          )}
        </div>
      )}
    </div>
  )
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
  onHelp,
  onDescribe,
  curvePalette,
  onCurvePalette,
  student = false,
  onExamples,
  settings,
  brand = 'Grapher',
}: Props) {
  return (
    <div className={`toolbar${student ? ' toolbar-student' : ''}`} data-student={student ? 'true' : undefined}>
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

      <div className="brand" title={`${brand} — sketch to math`}>
        {brand}
      </div>

      {docMenu && (
        <>
          <div className="tb-sep" />
          {docMenu}
        </>
      )}

      <div className="tb-sep" />

      {!student && (
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
      )}

      {onExamples && !student && (
        <button
          className="tb-btn tb-toggle tb-examples"
          onClick={onExamples}
          data-testid="toolbar-examples"
          title="Examples — ready-to-teach boards for every unit, each opens as your own copy"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1.6" y="2.2" width="5.4" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
            <rect x="9" y="2.2" width="5.4" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
            <rect x="1.6" y="8.8" width="5.4" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
            <rect x="9" y="8.8" width="5.4" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          <span className="tb-label">Examples</span>
        </button>
      )}

      {!student && (
        <>
          <div className="tb-sep" />

          {/* Words on a wide screen; on an iPad-wide toolbar the words go and
              the arrows stay (styles: .tb-undo .tb-label), so it fits one row. */}
          <button className="tb-btn tb-undo" onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo">
            <svg className="tb-undo-icon" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M5.5 3.5 2.5 6.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2.8 6.5h6.7a3.8 3.8 0 0 1 0 7.6H7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span className="tb-label">Undo</span>
          </button>
          <button className="tb-btn tb-undo" onClick={onRedo} disabled={!canRedo} title="Redo (⇧⌘Z)" aria-label="Redo">
            <svg className="tb-undo-icon" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="m10.5 3.5 3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M13.2 6.5H6.5a3.8 3.8 0 0 0 0 7.6H9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span className="tb-label">Redo</span>
          </button>
        </>
      )}

      {exportMenu && (
        <>
          <div className="tb-sep" />
          {exportMenu}
        </>
      )}

      <SettingsMenu
        onDescribe={onDescribe}
        curvePalette={curvePalette}
        onCurvePalette={onCurvePalette}
        onHelp={onHelp}
        canvasTheme={canvasTheme}
        onToggleCanvasTheme={onToggleCanvasTheme}
        settings={settings}
        student={student}
      />

      {onHelp && (
        <button
          className="tb-btn tb-icon tb-help"
          onClick={onHelp}
          data-testid="help-open"
          title="What Grapher can do (?) — and ⌘K to find any tool"
          aria-label="Help: what Grapher can do"
        >
          ?
        </button>
      )}
    </div>
  )
}
