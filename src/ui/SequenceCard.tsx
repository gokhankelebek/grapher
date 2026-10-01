import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Latex } from './Latex'
import { ParamRow } from './CurveCard'
import { coord } from './fieldLinks'
import { seriesKey } from './reveal'
import { SeriesSection } from './SeriesSection'
import { seriesColor, subscript } from './seqLinks'
import type { BoardSequence, SeqSeriesView, SequenceCardData } from './seqLinks'

// ============================================================================
// src/ui/SequenceCard.tsx — a sequence in the sidebar list.
//
// In the SAME list as the curves, the fields, the shapes and the tables, with
// the same colour dot, the same ⋯ menu and the same click-to-edit definition,
// because on the board it is the same kind of object: something a teacher
// typed, can recolour, hide and throw away.
//
// What a sequence has that nothing else does is DISCRETE: an index window
// (n from … to …), a table of its terms and partial sums, what kind of
// sequence it is (d or r, and both formulas), and what its series does. Two
// toggles draw the continuous partner (dashed) and the partial sums (rings).
//
// Nothing here computes anything. The terms, the classification and the
// series line arrive already worked out (src/ui/seqLinks.ts), so the card and
// the dots cannot disagree.
// ============================================================================

/** More rows than this are not listed; the dots are still drawn. */
const MAX_TABLE_ROWS = 60

interface Props {
  seq: BoardSequence
  card: SequenceCardData
  selected: boolean
  onSelect(): void
  onDelete(): void
  onDuplicate(): void
  onToggleVisible(): void
  onCycleColor(): void
  /** Frame the terms (and the partial sums when shown). */
  onZoom(): void
  onParamChange(index: number, value: number): void
  onParamEditStart(): void
  onParamEditEnd(): void
  onParamSetExact(index: number, value: number): void
  /** Retype the definition. The parser's complaint, or null when accepted. */
  onEquationCommit(src: string): string | null
  /** A new index window. Refusal, or null. */
  onWindow(n0: number, count: number): string | null
  onTogglePartner(): void
  onToggleSums(): void
  /** "Σ Show series": on with the default view, or off. */
  onToggleSeries?(): void
  /** A change to the series view; `live` inside a slider drag. */
  onSeriesChange?(patch: Partial<SeqSeriesView>, live?: boolean): void
}

export function SequenceCard({
  seq,
  card,
  selected,
  onSelect,
  onDelete,
  onDuplicate,
  onToggleVisible,
  onCycleColor,
  onZoom,
  onParamChange,
  onParamEditStart,
  onParamEditEnd,
  onParamSetExact,
  onEquationCommit,
  onWindow,
  onTogglePartner,
  onToggleSums,
  onToggleSeries = () => {},
  onSeriesChange = () => {},
}: Props) {
  // ---- the ⋯ menu (identical behaviour to a curve's, deliberately)
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        menuBtnRef.current?.focus()
      }
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!selected && menuOpen) setMenuOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const copyLatex = (): void => {
    try {
      void navigator.clipboard?.writeText(card.latex || seq.src)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

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

  // ---- the definition, click to edit
  const [eqEdit, setEqEdit] = useState<{ text: string; error: string | null } | null>(null)
  const eqInputRef = useRef<HTMLInputElement>(null)
  const eqOpen = eqEdit !== null
  useEffect(() => {
    if (eqOpen) {
      eqInputRef.current?.focus()
      eqInputRef.current?.select()
    }
  }, [eqOpen])
  const commitEqEdit = (): void => {
    if (!eqEdit) return
    const err = onEquationCommit(eqEdit.text)
    if (err) setEqEdit({ ...eqEdit, error: err })
    else setEqEdit(null)
  }

  // ---- the index window: two whole numbers, committed on Enter or blur
  const last = seq.n0 + seq.count - 1
  const [win, setWin] = useState<{ from: string; to: string; error: string | null }>(() => ({
    from: String(seq.n0),
    to: String(last),
    error: null,
  }))
  useEffect(() => {
    setWin({ from: String(seq.n0), to: String(last), error: null })
  }, [seq.n0, last])
  const commitWindow = (): void => {
    const a = Number(win.from.trim().replace('−', '-'))
    const b = Number(win.to.trim().replace('−', '-'))
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      setWin({ ...win, error: 'n runs between whole numbers.' })
      return
    }
    if (b < a) {
      setWin({ ...win, error: 'n has to end after it starts.' })
      return
    }
    if (a === seq.n0 && b === last) {
      setWin({ ...win, error: null })
      return
    }
    const err = onWindow(a, b - a + 1)
    setWin(err ? { ...win, error: err } : { ...win, error: null })
  }
  const windowInput = (which: 'from' | 'to'): JSX.Element => (
    <input
      className={`calc-input seq-n-input${win.error ? ' fe-input-bad' : ''}`}
      type="text"
      inputMode="numeric"
      spellCheck={false}
      autoComplete="off"
      aria-label={which === 'from' ? 'n from' : 'n to'}
      data-testid={`seq-n-${which}`}
      value={win[which]}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setWin({ ...win, [which]: e.target.value, error: null })}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          commitWindow()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setWin({ from: String(seq.n0), to: String(last), error: null })
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      onBlur={commitWindow}
    />
  )

  const L = card.name
  const an = `${L}${subscript('n')}`
  const shown = card.rows.slice(0, MAX_TABLE_ROWS)

  return (
    <div
      className={`card field-card seq-card${selected ? ' card-selected' : ''}${
        seq.visible ? '' : ' card-hidden'
      }${card.error ? ' card-broken-state' : ''}`}
      style={{ '--curve': seq.color } as CSSProperties}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Sequence ${L}${seq.visible ? '' : ', hidden'}`}
      data-testid="seq-card"
      onClick={onSelect}
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
          style={{ background: seq.color }}
          title="Change colour"
          aria-label="Change sequence colour"
          onClick={(e) => {
            e.stopPropagation()
            onCycleColor()
          }}
        />
        <span className="model-name">Sequence {an}</span>
        {card.error && (
          <span className="err-badge err-badge-bad" title={card.error}>
            can’t draw
          </span>
        )}
        {!seq.visible && <span className="card-flag">hidden</span>}

        <div className="card-menu-wrap" ref={menuRef}>
          <button
            ref={menuBtnRef}
            type="button"
            className={`card-menu-btn${menuOpen ? ' card-menu-btn-open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Sequence menu"
            title="More — hide, zoom to terms, duplicate, copy LaTeX, delete"
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
              {menuItem(seq.visible ? 'Hide' : 'Show', onToggleVisible)}
              {menuItem('Zoom to terms', onZoom)}
              {menuItem('Duplicate', onDuplicate)}
              {menuItem(copied ? 'Copied' : 'Copy LaTeX', copyLatex)}
              {menuItem('Delete', onDelete, 'card-menu-danger')}
            </div>
          )}
        </div>
      </div>

      <div className="card-eq-line">
        {eqEdit ? (
          <input
            ref={eqInputRef}
            className={`expr-input card-formula-input${eqEdit.error ? ' expr-input-bad' : ''}`}
            type="text"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="Sequence definition"
            aria-invalid={eqEdit.error ? true : undefined}
            value={eqEdit.text}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setEqEdit({ text: e.target.value, error: null })}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                commitEqEdit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setEqEdit(null)
              }
            }}
            onBlur={() => setEqEdit(null)}
          />
        ) : (
          <button
            type="button"
            className="card-formula card-formula-btn card-eq"
            title="Click to edit this sequence"
            data-testid="seq-def"
            onClick={(e) => {
              e.stopPropagation()
              onSelect()
              setEqEdit({ text: seq.src, error: null })
            }}
          >
            {card.error || !card.latex ? (
              <code className="card-broken-src">{seq.src}</code>
            ) : (
              <Latex tex={card.latex} className="card-latex" />
            )}
          </button>
        )}
      </div>

      {eqEdit && (
        <div className="card-eq-foot" onClick={(e) => e.stopPropagation()}>
          {eqEdit.error && <div className="expr-error">{eqEdit.error}</div>}
          <div className="expr-hint">Enter saves · Esc cancels</div>
        </div>
      )}

      {card.error && !eqEdit && (
        <div className="card-broken">
          <span className="card-broken-why">
            This sequence can’t be read ({card.error}). Nothing is drawn for it — retype it to bring
            it back.
          </span>
        </div>
      )}

      {!card.error && card.classText && (
        <div className="seq-class" data-testid="seq-class">
          <span className="seq-class-kind">{card.classText}</span>
          {card.explicit && (
            <>
              <span className="seq-sep"> · </span>
              <span className="seq-formula">{card.explicit}</span>
            </>
          )}
          {card.recursive && (
            <>
              <span className="seq-sep"> · </span>
              <span className="seq-formula">{card.recursive}</span>
            </>
          )}
        </div>
      )}
      {!card.error && card.seriesLine && (
        <div className="seq-series" data-testid="seq-series">
          {card.seriesLine}
        </div>
      )}
      {!card.error && !selected && card.sigma && (
        <div className="seq-series seq-series-verdict" data-testid="seq-series-verdict">
          Σ: {card.sigma.verdictText}
          {card.sigma.testName ? ` (${card.sigma.testName})` : ''}
          {card.sigma.sumText ? ` · ${card.sigma.sumText}` : ''}
        </div>
      )}

      {selected && !card.error && (
        <div className="card-body" onClick={(e) => e.stopPropagation()}>
          {card.params.length > 0 && (
            <div className="param-list">
              {card.params.map((p, i) => (
                <ParamRow
                  key={`${p.name}-${i}`}
                  name={p.name}
                  value={p.value}
                  text={coord(p.value)}
                  min={p.meta.min}
                  max={p.meta.max}
                  step={p.meta.step}
                  onChange={(v) => onParamChange(i, v)}
                  onEditStart={onParamEditStart}
                  onCommit={onParamEditEnd}
                  onEditEnd={onParamEditEnd}
                  onSetExact={(v) => onParamSetExact(i, v)}
                />
              ))}
            </div>
          )}

          <div className="fe-a-row seq-window" data-testid="seq-window">
            <span className="calc-tag">n from</span>
            {windowInput('from')}
            <span className="calc-tag">to</span>
            {windowInput('to')}
          </div>
          {win.error && <div className="expr-error">{win.error}</div>}

          <div className="seq-table-wrap">
            <table className="seq-table" data-testid="seq-table">
              <thead>
                <tr>
                  <th>n</th>
                  <th>{an}</th>
                  <th title={seq.n0 === 1 ? 'The partial sum of the first n terms' : `The sum from n = ${seq.n0}`}>
                    S{subscript('n')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.n}>
                    <td className="seq-n">{String(r.n).replace('-', '−')}</td>
                    <td>{r.aText}</td>
                    <td className="seq-s">{r.sText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {card.rows.length > MAX_TABLE_ROWS && (
              <div className="field-hint">
                …and {card.rows.length - MAX_TABLE_ROWS} more terms, drawn but not listed here.
              </div>
            )}
          </div>

          {(card.closedForm || (card.seriesNote && !card.sigma)) && (
            <div className="field-hint seq-note" data-testid="seq-note">
              {card.closedForm && <div>{card.closedForm}</div>}
              {/* the Series section below says it properly, test by test */}
              {card.seriesNote && !card.sigma && <div>{card.seriesNote}</div>}
            </div>
          )}

          <div className="seq-toggles">
            <label
              className="te-check"
              title={
                card.hasPartner
                  ? `The function behind the dots: ${card.partner ?? ''}`
                  : card.partnerNote ??
                    'Only an arithmetic, geometric or quadratic sequence has a continuous partner'
              }
              onClick={(ev) => ev.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={seq.showPartner}
                disabled={!card.hasPartner && !seq.showPartner}
                data-testid="seq-partner"
                onChange={onTogglePartner}
              />
              <span>show continuous partner</span>
            </label>
            <label className="te-check" onClick={(ev) => ev.stopPropagation()}>
              <input type="checkbox" checked={seq.showSums} data-testid="seq-sums" onChange={onToggleSums} />
              <span>show partial sums</span>
            </label>
            <label
              className="te-check"
              title="The infinite series Σ aₙ: partial sums on the board, its sum, and the convergence tests"
              onClick={(ev) => ev.stopPropagation()}
            >
              <input type="checkbox" checked={!!seq.series} data-testid="seq-series-toggle" onChange={onToggleSeries} />
              <span>Σ show series</span>
            </label>
          </div>
          {card.partnerNote && (
            <div className="field-hint seq-partner-src" data-testid="seq-partner-note">
              {card.partnerNote}
            </div>
          )}
          {seq.showPartner && card.partner && (
            <div className="field-hint seq-partner-src" data-testid="seq-partner-src">
              Dashed: {card.partner.replace(/-/g, '−')}
            </div>
          )}
          {card.sigma && (
            <SeriesSection
              answerKey={seriesKey(seq.id)}
              data={card.sigma}
              color={seriesColor(seq.color)}
              onChange={onSeriesChange}
              onRemove={onToggleSeries}
              onEditStart={onParamEditStart}
              onEditEnd={onParamEditEnd}
            />
          )}
        </div>
      )}
    </div>
  )
}
