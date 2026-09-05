import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { NLItem } from '../core/types'
import { intervalNotation } from '../core/types'
import type { CurveStyle } from '../core/persist'
import { NL_BAR_WIDTH, NL_MAX_BAR_WIDTH, NL_MIN_BAR_WIDTH } from '../render/numberline'
import { Latex } from './Latex'
import { parseNumeric } from './numeric'

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

function trimNum(v: number): string {
  const s = v.toPrecision(6)
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/** What this item says, in the notation the worksheet asks for. */
export function nlNotation(item: NLItem): string {
  return item.kind === 'point' ? `\\{${trimNum(item.x)}\\}` : intervalNotation(item)
}

/** The same thing again as an inequality, which is how it was probably asked. */
export function nlInequality(item: NLItem): string {
  if (item.kind === 'point') return `x ${item.closed ? '=' : '\\neq'} ${trimNum(item.x)}`
  const parts: string[] = []
  if (item.lo !== null) parts.push(`${trimNum(item.lo)} ${item.loClosed ? '\\le' : '<'} x`)
  if (item.hi !== null) {
    if (parts.length > 0) {
      parts[0] = `${parts[0]} ${item.hiClosed ? '\\le' : '<'} ${trimNum(item.hi)}`
    } else {
      parts.push(`x ${item.hiClosed ? '\\le' : '<'} ${trimNum(item.hi)}`)
    }
  }
  return parts[0] ?? 'x \\in \\mathbb{R}'
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
  const inputRef = useRef<HTMLInputElement>(null)

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
          onBlur={commit}
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
        onClick={onToggle}
      >
        <span className="nl-dot-glyph" aria-hidden="true" />
        {closed ? 'included' : 'excluded'}
      </button>
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
  onDash,
  onOpacity,
  onWidth,
  onStyleEditStart,
  onStyleEditEnd,
}: Props) {
  const [labelDraft, setLabelDraft] = useState<string | null>(null)
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
        <div className="card-formula">
          <Latex tex={nlNotation(item)} className="card-latex" />
        </div>
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
      </div>

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
              onBlur={() => {
                if (labelDraft !== null) onLabel(labelDraft)
                setLabelDraft(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
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
