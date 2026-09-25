import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent as ReactClipboardEvent, CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { parseDataText } from '../core/data'
import type { DataParse } from '../core/data'
import { Latex } from './Latex'
import {
  KIND_NAME,
  KIND_TI,
  REG_DIGITS_MAX,
  REG_DIGITS_MIN,
  cellIsBad,
  isMultiCellPaste,
  pasteReport,
  regressionMenu,
  statText,
} from './dataLinks'
import type {
  BoardData,
  DataCardData,
  DataMarker,
  PasteMode,
  RegressionChoice,
  RegressionKind,
  RegressionRow,
} from './dataLinks'

// ============================================================================
// src/ui/DataCard.tsx — a data table in the sidebar.
//
// In the SAME list as the curves, the slope fields and the shapes, with the
// same colour dot, the same ⋯ menu, because on the board it is the same kind
// of object: something a teacher put there, can recolour, hide and throw away.
//
// What a table has that nothing else does is a GRID — two columns of the
// teacher's own text, typed or pasted from a spreadsheet — and a list of the
// regressions fitted to it. Each regression is an ordinary typed curve with a
// card of its own further up the list; what this card shows about it is what
// a TI-84 prints after ExpReg: the equation, r and r², labelled the same way.
//
// Nothing here computes anything. The numbers, the fits and the readouts
// arrive already worked out (src/ui/dataLinks.ts), so the card and the
// picture cannot disagree about which rows were plotted.
// ============================================================================

/** More rows than this are not rendered as inputs; pasting still edits them. */
const MAX_GRID_ROWS = 300

const MARKERS: { marker: DataMarker; label: string; glyph: string }[] = [
  { marker: 'dot', label: 'Dots', glyph: '●' },
  { marker: 'ring', label: 'Rings', glyph: '○' },
  { marker: 'cross', label: 'Crosses', glyph: '×' },
  { marker: 'square', label: 'Squares', glyph: '■' },
]

interface Props {
  data: BoardData
  /** Everything this card prints, already computed. */
  card: DataCardData
  selected: boolean
  onSelect(): void
  onDelete(): void
  onDuplicate(): void
  onToggleVisible(): void
  onCycleColor(): void
  /** Frame this table's points. */
  onZoom(): void
  onMarker(marker: DataMarker): void
  /** One cell's text. Typing in the row past the end adds a row. */
  onCell(row: number, col: 'x' | 'y', text: string): void
  /** A column header — the axis label. */
  onLabel(col: 'x' | 'y', text: string): void
  onRemoveRow(row: number): void
  /** A parsed paste, replacing the rows or appended to them. */
  onPaste(parse: DataParse, mode: PasteMode): void
  /** Fit a model and put its curve on the board. Error to show, or null. */
  onAddRegression(kind: RegressionKind): string | null
  onRemoveRegression(regId: string): void
  onDigits(regId: string, digits: number): void
  onResiduals(regId: string): void
  /** Re-attach a detached regression: its curve follows the table again. */
  onRefit(regId: string): void
}

export function DataCard({
  data,
  card,
  selected,
  onSelect,
  onDelete,
  onDuplicate,
  onToggleVisible,
  onCycleColor,
  onZoom,
  onMarker,
  onCell,
  onLabel,
  onRemoveRow,
  onPaste,
  onAddRegression,
  onRemoveRegression,
  onDigits,
  onResiduals,
  onRefit,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)

  // ---- the ⋯ menu (identical behaviour to a curve's, deliberately)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  // ---- Regression ▾
  const [regOpen, setRegOpen] = useState(false)
  const [regError, setRegError] = useState<string | null>(null)
  const regRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen && !regOpen) return
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node
      if (menuOpen && !menuRef.current?.contains(t)) setMenuOpen(false)
      if (regOpen && !regRef.current?.contains(t)) setRegOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (menuOpen) menuBtnRef.current?.focus()
        setMenuOpen(false)
        setRegOpen(false)
      }
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen, regOpen])

  useEffect(() => {
    if (!selected) {
      setMenuOpen(false)
      setRegOpen(false)
    }
  }, [selected])

  const menuItem = (label: string, run: () => void, extra = ''): JSX.Element => (
    <button
      type="button"
      role="menuitem"
      className={`card-menu-item${extra ? ` ${extra}` : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        setMenuOpen(false)
        run()
      }}
    >
      {label}
    </button>
  )

  // ---- pasting
  //
  // A spreadsheet paste anywhere in the card goes through parseDataText; a
  // single value pasted into one cell is just typing. When the table already
  // has rows the teacher chooses: Replace them, or Append.
  const [pasteBox, setPasteBox] = useState<string | null>(null)
  const [pending, setPending] = useState<DataParse | null>(null)
  const [report, setReport] = useState<string[] | null>(null)
  const empty = data.rows.every((r) => r.x.trim() === '' && r.y.trim() === '')

  const takeText = (text: string): void => {
    let parse: DataParse
    try {
      parse = parseDataText(text)
    } catch {
      setReport(['That paste could not be read.'])
      return
    }
    if (!parse.ok) {
      setPending(null)
      setReport(pasteReport(parse))
      return
    }
    if (empty) {
      onPaste(parse, 'replace')
      setPending(null)
      setPasteBox(null)
      setReport(pasteReport(parse))
      return
    }
    setPending(parse)
    setReport(null)
  }

  const choose = (mode: PasteMode): void => {
    if (!pending) return
    onPaste(pending, mode)
    setReport(pasteReport(pending))
    setPending(null)
    setPasteBox(null)
  }

  const onPasteEvent = (e: ReactClipboardEvent<HTMLDivElement>): void => {
    const text = e.clipboardData?.getData('text/plain') ?? ''
    if (!isMultiCellPaste(text)) return
    e.preventDefault()
    e.stopPropagation()
    onSelect()
    takeText(text)
  }

  // ---- the grid's keyboard: Enter moves down a row, Shift+Enter up, like a
  // spreadsheet; Tab is the browser's own (x -> y -> next row's x).
  const focusCell = (row: number, col: 'x' | 'y'): void => {
    const el = rootRef.current?.querySelector<HTMLInputElement>(`[data-cell="${row}:${col}"]`)
    if (el) {
      el.focus()
      el.select()
    }
  }
  const cellKey = (e: ReactKeyboardEvent<HTMLInputElement>, row: number, col: 'x' | 'y'): void => {
    e.stopPropagation()
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = e.key === 'Enter' && e.shiftKey ? row - 1 : row + 1
      if (next >= 0) window.setTimeout(() => focusCell(next, col), 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (row > 0) focusCell(row - 1, col)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      ;(e.target as HTMLInputElement).blur()
    }
  }

  const skippedRows = useMemo(
    () => new Set(card.columns.skipped.map((s) => s.row - 1)),
    [card.columns.skipped],
  )

  const shown = data.rows.slice(0, MAX_GRID_ROWS)
  const phantom = data.rows.length < MAX_GRID_ROWS ? data.rows.length : -1

  const cellInput = (row: number, col: 'x' | 'y', value: string): JSX.Element => (
    <input
      className={`data-cell${cellIsBad(value) ? ' data-cell-bad' : ''}`}
      type="text"
      inputMode="decimal"
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      data-cell={`${row}:${col}`}
      aria-label={`Row ${row + 1} ${col === 'x' ? data.xLabel || 'x' : data.yLabel || 'y'}`}
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onCell(row, col, e.target.value)}
      onKeyDown={(e) => cellKey(e, row, col)}
    />
  )

  const headerInput = (col: 'x' | 'y', value: string): JSX.Element => (
    <input
      className="data-cell data-head-cell"
      type="text"
      spellCheck={false}
      autoComplete="off"
      aria-label={col === 'x' ? 'x column label' : 'y column label'}
      title="The column's name — the axis label"
      value={value}
      placeholder={col}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onLabel(col, e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          focusCell(0, col)
        }
      }}
    />
  )

  // ---- Regression ▾, computed only while it is open
  const choices = useMemo<RegressionChoice[]>(
    () => (regOpen ? regressionMenu(card.columns) : []),
    [regOpen, card.columns],
  )
  const pick = (kind: RegressionKind): void => {
    const err = onAddRegression(kind)
    setRegError(err)
    if (!err) setRegOpen(false)
  }

  const count = card.count
  const hasResiduals = data.regressions.some((r) => r.residuals && !r.detached)

  return (
    <div
      ref={rootRef}
      className={`card field-card data-card${selected ? ' card-selected' : ''}${
        data.visible ? '' : ' card-hidden'
      }`}
      style={{ '--curve': data.color } as CSSProperties}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${data.name}, ${count} point${count === 1 ? '' : 's'}${data.visible ? '' : ', hidden'}`}
      data-testid="data-card"
      onClick={onSelect}
      onPaste={onPasteEvent}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <div className="card-head">
        <button
          className="color-dot"
          style={{ background: data.color }}
          title="Change colour"
          aria-label="Change table colour"
          onClick={(e) => {
            e.stopPropagation()
            onCycleColor()
          }}
        />
        <span className="model-name">{data.name}</span>
        <span className="calc-tag data-count">
          {count} point{count === 1 ? '' : 's'}
        </span>
        {!data.visible && <span className="card-flag">hidden</span>}

        <div className="card-menu-wrap" ref={menuRef}>
          <button
            ref={menuBtnRef}
            type="button"
            className={`card-menu-btn${menuOpen ? ' card-menu-btn-open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Table menu"
            title="More — hide, zoom to data, duplicate, delete"
            onClick={(e) => {
              e.stopPropagation()
              onSelect()
              setMenuOpen((o) => !o)
            }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="card-menu" role="menu" onClick={(e) => e.stopPropagation()}>
              {menuItem(data.visible ? 'Hide' : 'Show', onToggleVisible)}
              {menuItem('Zoom to data', onZoom)}
              {menuItem('Duplicate', onDuplicate)}
              {menuItem('Delete', onDelete, 'card-menu-danger')}
            </div>
          )}
        </div>
      </div>

      {card.regressions.length > 0 && (
        <div className="data-regs" data-testid="data-regs">
          {card.regressions.map((row) => (
            <RegressionLine
              key={row.reg.id}
              row={row}
              selected={selected}
              onRemove={() => onRemoveRegression(row.reg.id)}
              onDigits={(d) => onDigits(row.reg.id, d)}
              onResiduals={() => onResiduals(row.reg.id)}
              onRefit={() => onRefit(row.reg.id)}
            />
          ))}
        </div>
      )}

      {selected && (
        <div className="card-body" onClick={(e) => e.stopPropagation()}>
          <div className="data-grid-wrap">
            <table className="data-grid" data-testid="data-grid">
              <thead>
                <tr>
                  <th className="data-idx" aria-hidden="true" />
                  <th>{headerInput('x', data.xLabel)}</th>
                  <th>{headerInput('y', data.yLabel)}</th>
                  <th className="data-drop-col" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={i} className={skippedRows.has(i) ? 'data-row-skipped' : undefined}>
                    <td className="data-idx">{i + 1}</td>
                    <td>{cellInput(i, 'x', r.x)}</td>
                    <td>{cellInput(i, 'y', r.y)}</td>
                    <td className="data-drop-col">
                      <button
                        type="button"
                        className="calc-drop"
                        tabIndex={-1}
                        aria-label={`Remove row ${i + 1}`}
                        title="Remove this row"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemoveRow(i)
                        }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
                {phantom >= 0 && (
                  <tr key={phantom} className="data-row-new">
                    <td className="data-idx">{phantom + 1}</td>
                    <td>{cellInput(phantom, 'x', '')}</td>
                    <td>{cellInput(phantom, 'y', '')}</td>
                    <td className="data-drop-col" />
                  </tr>
                )}
              </tbody>
            </table>
            {data.rows.length > MAX_GRID_ROWS && (
              <div className="field-hint">
                …and {data.rows.length - MAX_GRID_ROWS} more rows, plotted but not listed here.
              </div>
            )}
          </div>

          {card.columns.skipped.length > 0 && (
            <div className="field-hint data-skipped" data-testid="data-skipped">
              {card.columns.skipped.slice(0, 4).map((s) => (
                <div key={s.row}>
                  Row {s.row} is not plotted: {s.reason}.
                </div>
              ))}
              {card.columns.skipped.length > 4 && (
                <div>…and {card.columns.skipped.length - 4} more.</div>
              )}
            </div>
          )}

          <div className="data-actions">
            <button
              type="button"
              className="calc-chip"
              data-testid="data-paste-btn"
              title="Paste two columns from a spreadsheet — or press ⌘V / Ctrl+V anywhere in this table"
              onClick={() => {
                setPasteBox((b) => (b === null ? '' : null))
                setPending(null)
              }}
            >
              Paste data
            </button>
            <div className="data-reg-wrap" ref={regRef}>
              <button
                type="button"
                className={`calc-chip${regOpen ? ' calc-chip-on' : ''}`}
                aria-haspopup="menu"
                aria-expanded={regOpen}
                data-testid="data-reg-btn"
                title="Fit a model to this data — the fit becomes a curve that follows the table"
                onClick={() => {
                  setRegError(null)
                  setRegOpen((o) => !o)
                }}
              >
                Regression ▾
              </button>
              {regOpen && (
                <div className="card-menu data-reg-menu" role="menu" aria-label="Regression">
                  {choices.map((c, i) => {
                    const firstRefused = !c.ok && (i === 0 || choices[i - 1].ok)
                    const on = card.onBoard.has(c.kind)
                    return (
                      <div key={c.kind}>
                        {firstRefused && i > 0 && <div className="card-menu-sep" />}
                        <button
                          type="button"
                          role="menuitem"
                          disabled={!c.ok || on}
                          data-testid={`data-reg-${c.kind}`}
                          className={`card-menu-item data-reg-item${c.ok ? '' : ' data-reg-refused'}`}
                          title={c.ok ? `${KIND_TI[c.kind]} on a TI-84` : c.reason}
                          onClick={(e) => {
                            e.stopPropagation()
                            pick(c.kind)
                          }}
                        >
                          <span className="data-reg-item-name">
                            {KIND_NAME[c.kind]}
                            {on && <span className="calc-note"> · on the board</span>}
                          </span>
                          {c.ok && c.r2 !== undefined && (
                            <span className="data-reg-item-r2">r² {statText(c.r2)}</span>
                          )}
                          {!c.ok && c.reason && <span className="data-reg-why">{c.reason}</span>}
                        </button>
                      </div>
                    )
                  })}
                  {regError && <div className="expr-error">{regError}</div>}
                </div>
              )}
            </div>
          </div>

          {pasteBox !== null && !pending && (
            <div className="data-paste" data-testid="data-paste">
              <textarea
                className="data-paste-text"
                rows={4}
                spellCheck={false}
                aria-label="Paste data"
                placeholder={'Paste two columns here\nYear\tPop\n0\t3\n1\t6.1'}
                value={pasteBox}
                autoFocus
                onChange={(e) => setPasteBox(e.target.value)}
                onPaste={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Escape') setPasteBox(null)
                }}
              />
              <div className="fe-actions">
                <button type="button" className="calc-chip" onClick={() => setPasteBox(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="fe-build"
                  data-testid="data-paste-read"
                  disabled={pasteBox.trim() === ''}
                  onClick={() => takeText(pasteBox)}
                >
                  {empty ? 'Add rows' : 'Read'}
                </button>
              </div>
            </div>
          )}

          {pending && (
            <div className="data-paste data-paste-ask" data-testid="data-paste-ask">
              <div className="field-hint">
                {pending.xs.length} row{pending.xs.length === 1 ? '' : 's'} read. This table already
                has data:
              </div>
              <div className="fe-actions">
                <button type="button" className="calc-chip" onClick={() => setPending(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="calc-chip"
                  data-testid="data-paste-append"
                  onClick={() => choose('append')}
                >
                  Append
                </button>
                <button
                  type="button"
                  className="fe-build"
                  data-testid="data-paste-replace"
                  onClick={() => choose('replace')}
                >
                  Replace
                </button>
              </div>
            </div>
          )}

          {report && report.length > 0 && (
            <div className="field-hint data-report" data-testid="data-report">
              {report.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
              <button type="button" className="calc-chip data-report-x" onClick={() => setReport(null)}>
                OK
              </button>
            </div>
          )}

          <div className="field-section">
            <div className="an-title">Points</div>
            <div className="field-spacing" role="group" aria-label="Marker">
              {MARKERS.map((m) => {
                const on = (data.marker ?? 'dot') === m.marker
                return (
                  <button
                    key={m.marker}
                    type="button"
                    className={`calc-chip${on ? ' calc-chip-on' : ''}`}
                    aria-pressed={on}
                    title={m.label}
                    onClick={() => onMarker(m.marker)}
                  >
                    {m.glyph} {m.label}
                  </button>
                )
              })}
            </div>
            {count === 0 && (
              <div className="field-hint">
                Type x and y in the grid, or paste two columns from a spreadsheet. The first row can
                be the column names.
              </div>
            )}
            {hasResiduals && (
              <div className="field-hint">
                Residuals: each point’s vertical distance to the fitted curve.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** One regression on the card: equation, r / r², digits, residuals, ×. */
function RegressionLine({
  row,
  selected,
  onRemove,
  onDigits,
  onResiduals,
  onRefit,
}: {
  row: RegressionRow
  selected: boolean
  onRemove(): void
  onDigits(d: number): void
  onResiduals(): void
  onRefit(): void
}) {
  const { reg, status, readout } = row
  if (status === 'missing') return null
  const digits = reg.digits
  return (
    <div
      className={`data-reg${status === 'ok' ? '' : ` data-reg-${status}`}`}
      data-testid="data-reg-row"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="calc-line">
        <span className="data-reg-kind">{KIND_NAME[reg.kind]}</span>
        <span className="calc-tag">{KIND_TI[reg.kind]}</span>
        {status === 'detached' && <span className="card-flag">detached</span>}
        {status === 'failed' && <span className="card-flag">hidden</span>}
        <button
          type="button"
          className="calc-drop data-reg-drop"
          aria-label={`Remove the ${KIND_NAME[reg.kind].toLowerCase()} regression`}
          title={
            status === 'detached'
              ? 'Forget this regression (the curve stays, as an ordinary curve)'
              : 'Remove this regression and its curve'
          }
          onClick={onRemove}
        >
          ×
        </button>
      </div>
      {row.latex && (
        <div className="data-reg-eq">
          <Latex tex={row.latex} className="card-latex" />
        </div>
      )}
      {status === 'ok' && readout && (
        <div className="data-reg-stats">
          <span className="calc-read" data-testid="data-reg-stat">
            {readout.main}
          </span>
          {readout.on && <span className="calc-note">{readout.on}</span>}
          {readout.data && <div className="calc-note data-reg-data">{readout.data}</div>}
        </div>
      )}
      {status === 'failed' && row.reason && (
        <div className="data-reg-why-line">Hidden — {row.reason}</div>
      )}
      {status === 'detached' && (
        <div className="field-hint">
          Its equation was edited by hand, so it no longer follows this table.{' '}
          <button type="button" className="calc-chip" onClick={onRefit}>
            Re-fit
          </button>
        </div>
      )}
      {selected && status !== 'detached' && (
        <div className="calc-controls data-reg-controls">
          <span className="calc-tag">digits</span>
          <button
            type="button"
            className="calc-chip"
            aria-label="Fewer digits"
            disabled={digits <= REG_DIGITS_MIN}
            onClick={() => onDigits(digits - 1)}
          >
            −
          </button>
          <span className="calc-n-value data-digits">{digits}</span>
          <button
            type="button"
            className="calc-chip"
            aria-label="More digits"
            disabled={digits >= REG_DIGITS_MAX}
            onClick={() => onDigits(digits + 1)}
          >
            +
          </button>
          <button
            type="button"
            className={`calc-chip${reg.residuals ? ' calc-chip-on' : ''}`}
            aria-pressed={reg.residuals}
            data-testid="data-reg-residuals"
            title="Draw each point's residual to this curve"
            onClick={onResiduals}
          >
            residuals
          </button>
        </div>
      )}
      {selected && status === 'ok' && row.notes.length > 0 && (
        <div className="field-hint data-reg-notes">
          {row.notes.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}
    </div>
  )
}
