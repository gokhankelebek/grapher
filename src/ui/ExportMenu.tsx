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
import type { AxisUnitChoice, AxisUnitChoices, ResolvedAxisUnits } from '../core/persist'

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
  onChange,
  onExport,
  onCopy,
}: Props) {
  const [open, setOpen] = useState(false)
  const size = sizeOf(settings)
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
        title={`Copy to clipboard, axis units, export settings — ${size.w}×${size.h} px`}
        data-testid="export-settings"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="exp-menu" role="dialog" aria-label="Board and export settings">
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
          <div className="seg exp-seg" role="group" aria-label="Export background">
            <button
              className={`seg-btn${settings.theme === 'light' ? ' seg-on' : ''}`}
              data-testid="export-theme-light"
              onClick={() => onChange({ ...settings, theme: 'light' })}
              title="White ground with print-safe curve colours — for worksheets and copiers"
            >
              Light
            </button>
            <button
              className={`seg-btn${settings.theme === 'dark' ? ' seg-on' : ''}`}
              data-testid="export-theme-dark"
              onClick={() => onChange({ ...settings, theme: 'dark' })}
              title="Match the screen — for slides on a dark background"
            >
              Dark
            </button>
          </div>

          <div className="exp-readout" data-testid="export-readout">
            {size.w} × {size.h} px
            {settings.width === null ? '' : ' (exact)'}
          </div>
        </div>
      )}
    </div>
  )
}
