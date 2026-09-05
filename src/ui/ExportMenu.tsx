// ============================================================================
// src/ui/ExportMenu.tsx — the way out of the app.
//
// Download and Copy sit in the toolbar, side by side, not behind a menu: the
// exit IS the product for a teacher building a worksheet, and burying it costs
// them a trip every single figure. Only the SETTINGS hide behind the caret,
// because they are set once per document and then reused.
// ============================================================================

import { useEffect, useId, useRef, useState } from 'react'
import type { ExportSettings } from './renderBoard'
import { EXPORT_SCALES, MAX_EXPORT_MARGIN, MAX_EXPORT_WIDTH, MIN_EXPORT_WIDTH } from './renderBoard'

/** What the Copy button is currently saying. */
export type CopyState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'copied' }
  /** Clipboard refused; the PNG was downloaded instead and we say so. */
  | { kind: 'fell-back'; reason: string }

interface Props {
  settings: ExportSettings
  /**
   * Output pixel size a setting would produce. A function rather than a value:
   * it depends on the live viewport, which pan/zoom change without re-rendering
   * the app, so it must be asked for at the moment it is shown.
   */
  sizeOf(settings: ExportSettings): { w: number; h: number }
  copyState: CopyState
  onChange(next: ExportSettings): void
  onExport(): void
  onCopy(): void
}

export function ExportMenu({ settings, sizeOf, copyState, onChange, onExport, onCopy }: Props) {
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

  const copyLabel =
    copyState.kind === 'copied'
      ? 'Copied'
      : copyState.kind === 'fell-back'
        ? 'Downloaded'
        : copyState.kind === 'working'
          ? 'Copying…'
          : 'Copy'

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
        className={`tb-btn exp-copy${copyState.kind === 'copied' ? ' exp-copy-done' : ''}`}
        onClick={onCopy}
        disabled={copyState.kind === 'working'}
        data-testid="export-copy"
        data-copy-state={copyState.kind}
        title="Copy the figure to the clipboard, ready to paste into a document"
      >
        {copyState.kind === 'copied' ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3 8.4l3.2 3.2L13 4.8"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="5.2" y="5.2" width="8.3" height="8.3" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M10.8 5.2V4a1.6 1.6 0 0 0-1.6-1.6H4A1.6 1.6 0 0 0 2.4 4v5.2A1.6 1.6 0 0 0 4 10.8h1.2"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        )}
        {copyLabel}
      </button>

      <button
        className={`exp-caret${open ? ' exp-caret-open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Export settings"
        title={`Export settings — ${size.w}×${size.h} px`}
        data-testid="export-settings"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="exp-menu" role="dialog" aria-label="Export settings">
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
          <div className="exp-note">
            Remembered with this document, so every figure in a worksheet comes out the same size.
          </div>
        </div>
      )}
    </div>
  )
}
