// ============================================================================
// src/ui/ExportMenu.tsx — the way out of the app.
//
// ONE control: Download ▾. The primary click downloads the PNG, which is what
// a teacher building a worksheet does every single time; the caret holds the
// two things they do occasionally — copy it to the clipboard instead, and set
// the size and background, which are chosen once per document and then reused.
//
// Two buttons side by side cost 148px of a toolbar that had 680px of controls
// in a 704px canvas, and the second one was pressed far less than the first.
// ============================================================================

import { useEffect, useId, useRef, useState } from 'react'
import { EXPORT_SCALES, MAX_EXPORT_MARGIN, MAX_EXPORT_WIDTH, MIN_EXPORT_WIDTH } from './renderBoard'
import { ASPECTS, ASPECT_LABELS } from './exportFit'
import type { AspectKey, FitExportSettings } from './exportFit'
import type {
  AxisUnitChoice,
  AxisUnitChoices,
  BoardGrid,
  ResolvedAxisUnits,
} from '../core/persist'
import type { FigureStyleId, Theme } from '../core/types'
import { RULINGS } from './boardGrid'
import type { WheelPref } from './gestures'

const WHEEL_PREFS: { value: WheelPref; label: string; title: string }[] = [
  { value: 'auto', label: 'Auto', title: 'Zoom for a mouse wheel, scroll for a trackpad' },
  { value: 'zoom', label: 'Zoom', title: 'A plain wheel always zooms, anchored on the cursor' },
  { value: 'pan', label: 'Scroll', title: 'A plain wheel always moves the board' },
]
import { FigurePicker } from './FigurePicker'
import { WindowPanel } from './WindowPanel'
import type { ViewSettings } from './WindowPanel'
import { backgroundLockedNote, fixesBackground } from './figureStyle'

/** What the Copy button is currently saying. */
export type CopyState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'copied' }
  /** Clipboard refused; the PNG was downloaded instead and we say so. */
  | { kind: 'fell-back'; reason: string }

interface Props {
  settings: FitExportSettings
  /** True when there is something on the board to frame. */
  hasContent: boolean
  /**
   * Output pixel size a setting would produce. A function rather than a value:
   * it depends on the live viewport, which pan/zoom change without re-rendering
   * the app, so it must be asked for at the moment it is shown.
   */
  sizeOf(settings: FitExportSettings): { w: number; h: number }
  copyState: CopyState
  /**
   * The document's per-axis units, or null on a board that has no axes to
   * measure (a number line) — the section is then not drawn at all.
   *
   * This panel is where it lives because the toolbar has no room: it was cut
   * from 680px to 524px in a 704px canvas last wave and must not grow back, and
   * a units control is a once-a-lesson decision, which is exactly what this
   * caret already holds. It is also the one panel where the choice can be seen
   * next to what it does to the PNG.
   */
  axisUnits: AxisUnitChoices | null
  /** What 'auto' currently comes out as, so the control can say so. */
  resolvedAxisUnits: ResolvedAxisUnits
  onAxisUnit(axis: 'x' | 'y', choice: AxisUnitChoice): void
  /**
   * Which RULING the board is drawn on, or null on a board that has no grid
   * to rule (a number line) — the row is then not drawn at all.
   *
   * Beside the axis units because it is the same kind of decision, made in the
   * same breath and about the same thing: how this board is MEASURED. A polar
   * lesson sets the ruling and the θ axis together, and they belong in one
   * panel rather than one here and one three menus away.
   */
  grid: BoardGrid | null
  onGrid(next: BoardGrid): void
  /**
   * Axes (Equal · Independent) and the TI WINDOW, or null on a board with no
   * y to scale (a number line). Beside the ruling: both say how the board is
   * MEASURED, and the polar ruling and Independent axes exclude each other.
   */
  view?: ViewSettings | null
  /** What a plain mouse wheel does on the board (a global preference). */
  wheel: WheelPref
  onWheel(next: WheelPref): void
  /**
   * WHICH LOOK the board is drawn in, or null on a board that has no figure
   * style to be drawn in (a number line) — the section is then not drawn.
   *
   * First in the panel, above even Copy, because it is the decision every
   * other one here is made INSIDE: the size, the framing and the ground of an
   * SAT figure are not the same questions as those of a screen figure, and the
   * thumbnails answer "what am I about to paste into the worksheet" before the
   * teacher has to ask it.
   */
  figure: FigureStyleId | null
  /** The live board theme, so the Screen thumbnail follows the theme toggle. */
  screenTheme: Theme
  /** The line printed under the figure. Empty means none. */
  caption: string
  /**
   * True while that line is the one the BOARD wrote — derived from the curves
   * on it and re-derived whenever they change — rather than the teacher's own
   * words. It is the default, and it is what the field's hint and its "↺ auto"
   * button are about.
   */
  captionAuto: boolean
  /**
   * Whether the board is showing the chosen style instead of the theme.
   *
   * A view of the document, never part of it: the style itself is output-only,
   * and this switch is how the teacher checks the PNG without leaving the dark
   * board they sketch on.
   */
  preview: boolean
  onFigure(next: FigureStyleId): void
  onCaption(next: string): void
  /** Give the caption back to the board, after the teacher wrote their own. */
  onCaptionAuto(): void
  onPreview(next: boolean): void
  onChange(next: FitExportSettings): void
  onExport(): void
  onCopy(): void
}

/** The three states, in the order the segment shows them. */
const UNIT_CHOICES: ReadonlyArray<{ value: AxisUnitChoice; label: string; title: string }> = [
  { value: 'auto', label: 'Auto', title: 'Let the board choose: π as soon as a trig curve is on it' },
  { value: 'decimal', label: '1', title: 'Always the 1–2–5 ladder: 1, 2, 5, 10 …' },
  { value: 'pi', label: 'π', title: 'Always multiples of π: π/2, π, 3π/2, 2π …' },
]

export function ExportMenu({
  settings,
  hasContent,
  sizeOf,
  copyState,
  axisUnits,
  resolvedAxisUnits,
  onAxisUnit,
  grid,
  onGrid,
  view = null,
  wheel,
  onWheel,
  figure,
  screenTheme,
  caption,
  captionAuto,
  preview,
  onFigure,
  onCaption,
  onCaptionAuto,
  onPreview,
  onChange,
  onExport,
  onCopy,
}: Props) {
  const [open, setOpen] = useState(false)
  const size = sizeOf(settings)
  /**
   * A figure style OWNS the ground of the EXPORT — an SAT figure is on white
   * whatever this says — so the control is disabled rather than hidden, with
   * the reason beside it. Hiding it would leave the teacher hunting for a
   * setting they remember being here, and silently ignoring it would be worse.
   */
  const groundLocked = figure !== null && fixesBackground(figure)
  const [widthDraft, setWidthDraft] = useState<string>('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const uid = useId()

  useEffect(() => {
    setWidthDraft(settings.width === null ? '' : String(settings.width))
  }, [settings.width])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const commitWidth = (raw: string): void => {
    const t = raw.trim()
    if (t === '') {
      onChange({ ...settings, width: null })
      return
    }
    const n = Number(t)
    if (!Number.isFinite(n)) {
      setWidthDraft(settings.width === null ? '' : String(settings.width))
      return
    }
    onChange({
      ...settings,
      width: Math.round(Math.min(MAX_EXPORT_WIDTH, Math.max(MIN_EXPORT_WIDTH, n))),
    })
  }

  // The fall-back case says DOWNLOADED, and the board says why in a toast that
  // is raised at the same moment: a Copy control that flips to "Downloaded"
  // with no reason on screen is the thing a reviewer could not explain.
  const copyLabel =
    copyState.kind === 'copied'
      ? 'Copied to clipboard'
      : copyState.kind === 'fell-back'
        ? 'Downloaded instead'
        : copyState.kind === 'working'
          ? 'Copying…'
          : 'Copy to clipboard'

  return (
    <div className="exp" ref={wrapRef}>
      <button
        className="tb-btn tb-primary exp-main"
        onClick={onExport}
        data-testid="export-png"
        title={`Download the figure as a PNG (${size.w}×${size.h} px)`}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M8 1.8v8.4M4.6 7l3.4 3.4L11.4 7M2.4 13.2h11.2"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Download
      </button>

      <button
        className={`exp-caret${open ? ' exp-caret-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Board and export settings"
        title={`Figure style, copy to clipboard, axis units, ruling, axes and window, export settings — ${size.w}×${size.h} px`}
        data-testid="export-settings"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="exp-menu" role="dialog" aria-label="Board and export settings">
          {figure && (
            <>
              <FigurePicker
                value={figure}
                screenTheme={screenTheme}
                caption={caption}
                captionAuto={captionAuto}
                preview={preview}
                onPick={onFigure}
                onCaption={onCaption}
                onCaptionAuto={onCaptionAuto}
                onPreview={onPreview}
              />
              <div className="exp-menu-sep" />
            </>
          )}

          <button
            className="exp-item"
            onClick={onCopy}
            disabled={copyState.kind === 'working'}
            data-testid="export-copy"
            data-copy-state={copyState.kind}
            title="Copy the figure to the clipboard, ready to paste into a document"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="5.2" y="5.2" width="8.3" height="8.3" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M10.8 5.2V4a1.6 1.6 0 0 0-1.6-1.6H4A1.6 1.6 0 0 0 2.4 4v5.2A1.6 1.6 0 0 0 4 10.8h1.2"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
            {copyLabel}
          </button>

          {axisUnits && (
            <>
              <div className="exp-menu-sep" />
              <div className="exp-title">Axis units</div>
              {(['x', 'y'] as const).map((axis) => {
                const choice = axisUnits[axis]
                const resolved = resolvedAxisUnits[axis]
                return (
                  <div className="exp-axis" key={axis}>
                    <span className="exp-axis-name">{axis}</span>
                    <div
                      className="seg exp-seg exp-axis-seg"
                      role="group"
                      aria-label={`${axis} axis units`}
                      data-testid={`axis-units-${axis}`}
                      data-choice={choice}
                      data-resolved={resolved}
                    >
                      {UNIT_CHOICES.map((u) => (
                        <button
                          key={u.value}
                          className={`seg-btn${choice === u.value ? ' seg-on' : ''}`}
                          data-testid={`axis-units-${axis}-${u.value}`}
                          aria-pressed={choice === u.value}
                          onClick={() => onAxisUnit(axis, u.value)}
                          title={u.title}
                        >
                          {u.label}
                        </button>
                      ))}
                    </div>
                    <span className="exp-axis-read" data-testid={`axis-units-${axis}-readout`}>
                      {resolved === 'pi' ? 'π' : '1'}
                      {choice === 'auto' ? ' (auto)' : ''}
                    </span>
                  </div>
                )
              })}
              <div className="exp-note">
                Auto follows the board: a sine or a typed sin/cos/tan puts the x-axis in π, and
                removing it puts it back. Shift+P cycles the x-axis. The PNG is measured the same
                way the screen is.
              </div>
            </>
          )}

          {grid && (
            <>
              <div className="exp-menu-sep" />
              <div className="exp-title">Ruling</div>
              <div
                className="seg exp-seg"
                role="group"
                aria-label="Board ruling"
                data-testid="board-grid"
                data-grid={grid}
              >
                {RULINGS.map((r) => (
                  <button
                    key={r.value}
                    className={`seg-btn${grid === r.value ? ' seg-on' : ''}`}
                    data-testid={`board-grid-${r.value}`}
                    aria-pressed={grid === r.value}
                    onClick={() => onGrid(r.value)}
                    title={r.title}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <div className="exp-note">
                Polar draws circles of constant r and spokes of constant θ, which is how a rose or
                a limaçon is actually read. The axis units still apply — π along x puts the spokes
                at π/6, π/4, π/3. The PNG is ruled the same way the screen is.
              </div>
            </>
          )}

          {view && (
            <>
              <div className="exp-menu-sep" />
              <WindowPanel view={view} />
            </>
          )}

          <div className="exp-menu-sep" />
          <div className="exp-title">Mouse wheel</div>
          <div
            className="seg exp-seg"
            role="group"
            aria-label="Mouse wheel"
            data-testid="wheel-pref"
            data-wheel={wheel}
          >
            {WHEEL_PREFS.map((w) => (
              <button
                key={w.value}
                className={`seg-btn${wheel === w.value ? ' seg-on' : ''}`}
                data-testid={`wheel-pref-${w.value}`}
                aria-pressed={wheel === w.value}
                onClick={() => onWheel(w.value)}
                title={w.title}
              >
                {w.label}
              </button>
            ))}
          </div>
          <div className="exp-note">
            Auto zooms for a mouse wheel and scrolls for a trackpad's two-finger swipe. A pinch
            or ⌘-wheel always zooms both axes. On the graph, ⇧-wheel stretches x and ⌥-wheel
            stretches y; on a number line ⇧-wheel scrolls.
          </div>

          <div className="exp-menu-sep" />
          <div className="exp-title">Output size</div>
          <div className="seg exp-seg" role="group" aria-label="Export scale">
            {EXPORT_SCALES.map((sc) => (
              <button
                key={sc}
                className={`seg-btn${settings.width === null && settings.scale === sc ? ' seg-on' : ''}`}
                data-testid={`export-scale-${sc}`}
                onClick={() => onChange({ ...settings, scale: sc, width: null })}
                title={`${sc}× the on-screen size`}
              >
                {sc}×
              </button>
            ))}
          </div>

          <label className="exp-row" htmlFor={`${uid}-w`}>
            <span className="exp-label">Exact width</span>
            <input
              id={`${uid}-w`}
              className="exp-num"
              type="number"
              inputMode="numeric"
              min={MIN_EXPORT_WIDTH}
              max={MAX_EXPORT_WIDTH}
              step={10}
              placeholder="auto"
              value={widthDraft}
              data-testid="export-width"
              onChange={(e) => setWidthDraft(e.target.value)}
              onBlur={(e) => commitWidth(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitWidth((e.target as HTMLInputElement).value)
                }
              }}
            />
            <span className="exp-unit">px</span>
          </label>

          <label className="exp-row" htmlFor={`${uid}-m`}>
            <span className="exp-label">Margin</span>
            <input
              id={`${uid}-m`}
              className="exp-num"
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_EXPORT_MARGIN}
              step={4}
              value={settings.margin}
              data-testid="export-margin"
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n)) {
                  onChange({
                    ...settings,
                    margin: Math.round(Math.min(MAX_EXPORT_MARGIN, Math.max(0, n))),
                  })
                }
              }}
            />
            <span className="exp-unit">px</span>
          </label>

          <div className="exp-menu-sep" />
          <div className="exp-title">Framing</div>
          <label className="exp-check" htmlFor={`${uid}-fit`}>
            <input
              id={`${uid}-fit`}
              type="checkbox"
              className="exp-checkbox"
              checked={settings.fit}
              data-testid="export-fit"
              disabled={!hasContent}
              onChange={(e) => onChange({ ...settings, fit: e.target.checked })}
            />
            <span className="exp-check-body">
              <span className="exp-check-label">Fit to content</span>
              <span className="exp-check-note">
                {hasContent
                  ? 'Frame everything on the board instead of the window.'
                  : 'Nothing on the board to frame yet.'}
              </span>
            </span>
          </label>

          <div
            className="seg exp-seg exp-seg-wrap"
            role="group"
            aria-label="Export shape"
            data-testid="export-aspect"
          >
            {ASPECTS.map((a: AspectKey) => (
              <button
                key={a}
                className={`seg-btn${settings.aspect === a ? ' seg-on' : ''}`}
                data-testid={`export-aspect-${a}`}
                disabled={!settings.fit}
                onClick={() => onChange({ ...settings, aspect: a })}
                title={
                  a === 'auto'
                    ? 'Keep the shape the board has on screen'
                    : `Letterbox the fitted figure into ${ASPECT_LABELS[a]}`
                }
              >
                {ASPECT_LABELS[a]}
              </button>
            ))}
          </div>

          <div className="exp-menu-sep" />
          <div className="exp-title">Background</div>
          <div
            className="seg exp-seg"
            role="group"
            aria-label="Export background"
            data-locked={groundLocked ? 'figure' : undefined}
          >
            <button
              className={`seg-btn${!groundLocked && settings.theme === 'light' ? ' seg-on' : ''}`}
              data-testid="export-theme-light"
              disabled={groundLocked}
              onClick={() => onChange({ ...settings, theme: 'light' })}
              title="White ground with print-safe curve colours — for worksheets and copiers"
            >
              Light
            </button>
            <button
              className={`seg-btn${!groundLocked && settings.theme === 'dark' ? ' seg-on' : ''}`}
              data-testid="export-theme-dark"
              disabled={groundLocked}
              onClick={() => onChange({ ...settings, theme: 'dark' })}
              title="Match the screen — for slides on a dark background"
            >
              Dark
            </button>
          </div>
          {figure && groundLocked && (
            <div className="exp-note" data-testid="export-theme-locked">
              {backgroundLockedNote(figure)} Put the figure back on Screen to choose a ground.
            </div>
          )}

          <div className="exp-readout" data-testid="export-readout">
            {size.w} × {size.h} px
            {settings.width === null ? '' : ' (exact)'}
          </div>
        </div>
      )}
    </div>
  )
}
