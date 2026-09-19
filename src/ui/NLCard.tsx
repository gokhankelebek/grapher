import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { NLItem } from '../core/types'
import type { CurveStyle } from '../core/persist'
import { NL_BAR_WIDTH, NL_MAX_BAR_WIDTH, NL_MIN_BAR_WIDTH } from '../render/numberline'
import { Latex } from './Latex'
import { parseNumeric } from './numeric'
import { itemEquationText } from './equationText'
import { ENDPOINT_TIP, ENDPOINT_TIP_TEXT, TIP_MS, takeTip } from './coach'
import {
  answerClipboardText,
  answerInequalityText,
  answerNotationText,
  answerPieces,
  nlInequality,
  nlNotation,
} from './nlText'
import { AnswerContext } from './answerContext'

// Re-exported so the two notations keep one importable home while callers
// that already knew them here carry on working.
export { nlInequality, nlNotation }

interface Props {
  item: NLItem
  style: CurveStyle | undefined
  selected: boolean
  onSelect(): void
  onDelete(): void
  onCycleColor(): void
  onToggleEnd(end: 'lo' | 'hi' | 'point'): void
  /** Type an exact endpoint. `null` sets that end unbounded (an arrow). */
  onSetBound(end: 'lo' | 'hi' | 'point', value: number | null): void
  onLabel(label: string): void
  /**
   * Restate this item as an inequality or an interval. Returns the parser's
   * error message to show, or null when it was accepted.
   */
  onEquationCommit(src: string): string | null
  onDash(dash: number[] | undefined): void
  onOpacity(opacity: number): void
  onWidth(width: number): void
  onStyleEditStart(): void
  onStyleEditEnd(): void
}

const DASH_STYLES: { key: string; label: string; title: string; dash: number[] | undefined }[] = [
  { key: 'solid', label: '━', title: 'Solid bar', dash: undefined },
  { key: 'dashed', label: '╍ ╍', title: 'Dashed bar', dash: [10, 7] },
  { key: 'dotted', label: '· · ·', title: 'Dotted bar', dash: [2, 6] },
]

function fillStyle(value: number, min: number, max: number): CSSProperties {
  const span = max - min || 1
  const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100))
  return { '--fill': `${pct}%` } as CSSProperties
}

/** One endpoint: its value (typeable) and its closed/open state (clickable). */
function EndpointRow({
  end,
  label,
  value,
  closed,
  unbounded,
  color,
  onToggle,
  onSet,
}: {
  end: 'lo' | 'hi' | 'point'
  label: string
  value: number | null
  closed: boolean
  unbounded: boolean
  color: string
  onToggle(): void
  onSet(v: number | null): void
}) {
  const [editing, setEditing] = useState<{ text: string; bad: boolean } | null>(null)
  const [tip, setTip] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Once per session, and counted in coach.ts rather than here: the canvas
  // teaches the same fact over the dot itself, and a teacher must not be told
  // twice.
  const maybeTip = (): void => {
    if (unbounded || !takeTip(ENDPOINT_TIP)) return
    setTip(true)
    window.setTimeout(() => setTip(false), TIP_MS)
  }

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (): void => {
    if (!editing) return
    const raw = editing.text.trim()
    if (raw === '' || /^[-−]?(inf|infty|infinity|∞)$/i.test(raw.replace('−', '-'))) {
      setEditing(null)
      onSet(null)
      return
    }
    const v = parseNumeric(raw.replace(/−/g, '-'))
    if (v === null) {
      setEditing({ ...editing, bad: true })
      return
    }
    setEditing(null)
    onSet(v)
  }

  return (
    <div className="nl-end-row">
      <span className="nl-end-label">{label}</span>
      {editing ? (
        <input
          ref={inputRef}
          className={`nl-end-input${editing.bad ? ' nl-end-input-bad' : ''}`}
          type="text"
          inputMode="decimal"
          spellCheck={false}
          autoComplete="off"
          aria-label={`${label} value`}
          aria-invalid={editing.bad || undefined}
          value={editing.text}
          onChange={(e) => setEditing({ text: e.target.value, bad: false })}
          // Tapping outside ABANDONS the edit. On a tablet there is no Esc,
          // so the only way out of a field that commits on blur is to commit
          // a value you did not want; every inline editor on a card now
          // cancels the same way, and Return is the way to mean it.
          onBlur={() => setEditing(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(null)
            }
          }}
        />
      ) : (
        <button
          className="nl-end-value"
          title={
            unbounded
              ? 'Unbounded — type a number to give this end a value'
              : 'Click to type an exact value (or “inf” for an arrow)'
          }
          onClick={() => setEditing({ text: unbounded ? '' : String(value ?? 0), bad: false })}
        >
          {unbounded ? (end === 'lo' ? '−∞' : '∞') : String(value ?? 0).replace('-', '−')}
        </button>
      )}
      <button
        className={`nl-dot-toggle${closed ? ' nl-dot-closed' : ''}`}
        style={{ ['--dot' as string]: color } as CSSProperties}
        disabled={unbounded}
        title={
          unbounded
            ? 'An unbounded end is an arrow — it has no dot'
            : closed
              ? 'Closed (included) — click to open it'
              : 'Open (excluded) — click to close it'
        }
        aria-pressed={closed}
        aria-label={`${label} is ${closed ? 'closed' : 'open'}`}
        onMouseEnter={maybeTip}
        onFocus={maybeTip}
        onClick={onToggle}
      >
        <span className="nl-dot-glyph" aria-hidden="true" />
        {closed ? 'included' : 'excluded'}
      </button>
      {tip && (
        <span className="nl-coach" role="status">
          {ENDPOINT_TIP_TEXT}
        </span>
      )}
    </div>
  )
}

/**
 * A number-line item's card. It answers the two questions a worksheet asks —
 * what interval is this, and is each end in or out — and lets both be stated
 * exactly rather than only dragged.
 */
export function NLCard({
  item,
  style,
  selected,
  onSelect,
  onDelete,
  onCycleColor,
  onToggleEnd,
  onSetBound,
  onLabel,
  onEquationCommit,
  onDash,
  onOpacity,
  onWidth,
  onStyleEditStart,
  onStyleEditEnd,
}: Props) {
  const [labelDraft, setLabelDraft] = useState<string | null>(null)

  // Click the notation to restate the whole set — the same gesture as a curve
  // card's equation, reading the same language the "+" box takes.
  const [eqEdit, setEqEdit] = useState<{ text: string; error: string | null } | null>(null)
  const eqInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (eqEdit) {
      eqInputRef.current?.focus()
      eqInputRef.current?.select()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eqEdit !== null])

  const commitEqEdit = (): void => {
    if (!eqEdit) return
    const err = onEquationCommit(eqEdit.text)
    if (err) setEqEdit({ ...eqEdit, error: err })
    else setEqEdit(null)
  }

  /**
   * Copy the NOTATION, as text.
   *
   * Copy was PNG-only, and a picture is not what goes into an answer key —
   * "(−∞, −2) ∪ [3, ∞)" is, and it had to be retyped, brackets and all. Both
   * forms go on the clipboard, one per line, because which one the worksheet
   * asks for is not knowable from here and deleting a line is cheaper than
   * writing one.
   */
  // The whole answer this item is a piece of — a union is one answer in two
  // items, and an answer key wants both of them.
  const board = useContext(AnswerContext)
  const answer = useMemo(() => {
    const found = answerPieces(board.items, board.styles, item.id)
    return found.length > 0 ? found : [item]
  }, [board.items, board.styles, item])
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(copyTimer.current), [])

  const copyNotation = (): void => {
    const text = answerClipboardText(answer)
    const done = (): void => {
      setCopied(true)
      window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600)
    }
    try {
      const writer = navigator.clipboard?.writeText
      if (typeof writer === 'function') {
        navigator.clipboard.writeText(text).then(done, () => setCopied(false))
        return
      }
    } catch {
      /* fall through to the legacy path */
    }
    // Older WebViews and any page the Clipboard API refuses: a hidden
    // textarea and execCommand still work, and silently doing nothing does not.
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      done()
    } catch {
      setCopied(false)
    }
  }

  const activeDashKey =
    style?.dash && style.dash.length > 0
      ? style.dash[0] > 4
        ? 'dashed'
        : 'dotted'
      : 'solid'

  return (
    <div
      className={`card nl-card${selected ? ' card-selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${item.kind === 'point' ? 'Point' : 'Interval'} ${nlNotation(item)}`}
      data-item-id={item.id}
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
          style={{ background: item.color }}
          title="Change colour"
          aria-label="Change item colour"
          onClick={(e) => {
            e.stopPropagation()
            onCycleColor()
          }}
        />
        {eqEdit ? (
          <input
            ref={eqInputRef}
            className={`expr-input card-formula-input${eqEdit.error ? ' expr-input-bad' : ''}`}
            type="text"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="Solution set"
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
            className="card-formula card-formula-btn"
            title="Click to restate this set — an inequality, an interval or a set of points"
            onClick={(e) => {
              e.stopPropagation()
              onSelect()
              setEqEdit({ text: itemEquationText(item), error: null })
            }}
          >
            <Latex tex={nlNotation(item)} className="card-latex" />
          </button>
        )}
        {!eqEdit && (
        <button
          className={`icon-btn nl-copy${copied ? ' nl-copy-done' : ''}`}
          data-testid="nl-copy-notation"
          data-copied={copied ? 'yes' : 'no'}
          title={`Copy “${answerNotationText(answer)}” and “${answerInequalityText(
            answer,
          )}” as text`}
          aria-label="Copy the interval notation as text"
          onClick={(e) => {
            e.stopPropagation()
            copyNotation()
          }}
        >
          {copied ? (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M3.2 8.6l3 3 6.6-7"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect
                x="5.2"
                y="5.2"
                width="8.3"
                height="8.3"
                rx="1.6"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M10.8 5.2V4a1.6 1.6 0 0 0-1.6-1.6H4A1.6 1.6 0 0 0 2.4 4v5.2A1.6 1.6 0 0 0 4 10.8h1.2"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>
        )}
        {!eqEdit && (
        <button
          className="icon-btn del"
          title="Delete this item (Del)"
          aria-label="Delete item"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        )}
      </div>

      {eqEdit && (
        <div className="card-eq-foot" onClick={(e) => e.stopPropagation()}>
          {eqEdit.error && <div className="expr-error">{eqEdit.error}</div>}
          <div className="expr-hint">
            Enter saves · Esc cancels · try “x &lt; 3”, “[-2, 5)”, “x ≤ -2 or x &gt; 4”
          </div>
        </div>
      )}

      <div className="card-sub">
        <span className="model-name">{item.kind === 'point' ? 'Point' : 'Interval'}</span>
        <span className="err-badge nl-ineq" title="The same set, written as an inequality">
          <Latex tex={nlInequality(item)} />
        </span>
      </div>

      {selected && (
        <div className="card-body" onClick={(e) => e.stopPropagation()}>
          <div className="nl-ends">
            {item.kind === 'point' ? (
              <EndpointRow
                end="point"
                label="at"
                value={item.x}
                closed={item.closed}
                unbounded={false}
                color={item.color}
                onToggle={() => onToggleEnd('point')}
                onSet={(v) => onSetBound('point', v)}
              />
            ) : (
              <>
                <EndpointRow
                  end="lo"
                  label="from"
                  value={item.lo}
                  closed={item.loClosed}
                  unbounded={item.lo === null}
                  color={item.color}
                  onToggle={() => onToggleEnd('lo')}
                  onSet={(v) => onSetBound('lo', v)}
                />
                <EndpointRow
                  end="hi"
                  label="to"
                  value={item.hi}
                  closed={item.hiClosed}
                  unbounded={item.hi === null}
                  color={item.color}
                  onToggle={() => onToggleEnd('hi')}
                  onSet={(v) => onSetBound('hi', v)}
                />
              </>
            )}
          </div>

          <label className="nl-label-row">
            <span className="nl-label-tag">Label</span>
            <input
              className="nl-label-input"
              type="text"
              maxLength={60}
              spellCheck={false}
              placeholder="e.g. domain of f"
              value={labelDraft ?? item.label ?? ''}
              onChange={(e) => setLabelDraft(e.target.value)}
              // Blur abandons, Return saves — the same rule as every other
              // inline editor here, so "tap somewhere else" always means the
              // same thing whichever field a teacher is in.
              onBlur={() => setLabelDraft(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (labelDraft !== null) onLabel(labelDraft)
                  setLabelDraft(null)
                  e.currentTarget.blur()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setLabelDraft(null)
                  e.currentTarget.blur()
                }
              }}
            />
          </label>

          <div className="style-row">
            <input
              type="range"
              className="style-slider"
              title="Bar thickness"
              aria-label="Bar thickness"
              min={NL_MIN_BAR_WIDTH}
              max={NL_MAX_BAR_WIDTH}
              step={0.5}
              value={style?.width ?? NL_BAR_WIDTH}
              style={fillStyle(style?.width ?? NL_BAR_WIDTH, NL_MIN_BAR_WIDTH, NL_MAX_BAR_WIDTH)}
              onPointerDown={onStyleEditStart}
              onPointerUp={onStyleEditEnd}
              onKeyDown={onStyleEditStart}
              onKeyUp={onStyleEditEnd}
              onBlur={onStyleEditEnd}
              onChange={(e) => onWidth(Number(e.target.value))}
            />
            <div className="dash-seg" role="group" aria-label="Bar style">
              {DASH_STYLES.map((d) => (
                <button
                  key={d.key}
                  className={`dash-btn${activeDashKey === d.key ? ' dash-on' : ''}`}
                  title={d.title}
                  disabled={item.kind === 'point'}
                  onClick={() => onDash(d.dash)}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <input
              type="range"
              className="style-slider"
              title="Opacity"
              aria-label="Opacity"
              min={0.1}
              max={1}
              step={0.05}
              value={style?.opacity ?? 1}
              style={fillStyle(style?.opacity ?? 1, 0.1, 1)}
              onPointerDown={onStyleEditStart}
              onPointerUp={onStyleEditEnd}
              onKeyDown={onStyleEditStart}
              onKeyUp={onStyleEditEnd}
              onBlur={onStyleEditEnd}
              onChange={(e) => onOpacity(Number(e.target.value))}
            />
          </div>
        </div>
      )}
    </div>
  )
}
