import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExpSpec } from '../core/exponential'
import { Latex } from './Latex'
import {
  EXP_FIELD_LABEL,
  RATE_KINDS,
  blankDraft,
  commitExpSpec,
  expPreview,
  featureLines,
  isBaseE,
  rateFormOf,
  rateFormOptions,
  rewriteRate,
  safeFeatures,
  safeSource,
  safeRate,
  setExpField,
  specFromDraft,
  switchTab,
} from './expLinks'
import type {
  ExpDraft,
  ExpField,
  ExpTab,
  ParamFields,
  PointFields,
  RateFields,
  RateForm,
  RateKind,
} from './expLinks'
import { evalText } from './factorLinks'

// ============================================================================
// src/ui/ExpEditor.tsx — an exponential function, stated the precalculus way.
//
//     y = a·b^((x − h)/p) + k
//
// Two places, like the roots editor next door (FactorEditor.tsx):
//
//   * ExpEditor, "Build ▾ → Exponential" at the top of the list. A DRAFT with
//     three tabs — Rate ("starts at 200, half-life 5.7"), Two points, and the
//     Parameters themselves — that all edit ONE function: switching tab
//     re-seeds the new tab's fields from the curve the old one made, so the
//     preview never jumps. Nothing reaches the board until "Add to graph".
//   * ExpSection, on the card of any typed curve that reads back as an
//     exponential. COMMITTED: a field is an edit on Enter or blur, the "rate
//     as" picker rewrites the same function in another statement of its rate,
//     and each is one undo entry through the App's in-place restate path.
//
// Both only ever produce an ordinary typed equation (src/core/exponential.ts
// writes it). The logic is pure and lives in src/ui/expLinks.ts.
// ============================================================================

type Mode = 'draft' | 'commit'

/** One typed value — a draft's is the state; a card's commits on Enter/blur. */
export function XField({
  value,
  mode,
  label,
  bad,
  className,
  inputRef,
  placeholder,
  onCommit,
}: {
  value: string
  mode: Mode
  label: string
  bad?: boolean
  className?: string
  inputRef?: (el: HTMLInputElement | null) => void
  placeholder?: string
  onCommit(text: string): string | null | void
}) {
  const [text, setText] = useState(value)
  const [refused, setRefused] = useState(false)
  useEffect(() => {
    setText(value)
    setRefused(false)
  }, [value])

  const commit = (): void => {
    const t = text.trim()
    if (t === value.trim()) {
      setRefused(false)
      return
    }
    if (t !== 'e' && evalText(t) === null) {
      setRefused(true)
      return
    }
    const r = onCommit(t)
    setRefused(typeof r === 'string')
  }

  const draft = mode === 'draft'
  const isBad = bad || refused
  return (
    <input
      ref={inputRef}
      className={`calc-input fe-input xe-input${className ? ` ${className}` : ''}${
        isBad ? ' fe-input-bad' : ''
      }`}
      type="text"
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      aria-label={label}
      title={label}
      aria-invalid={isBad ? true : undefined}
      placeholder={placeholder}
      // A card's value is whatever the line says (647.7, 1.01392): the field
      // grows to show it rather than clipping it.
      style={draft ? undefined : { width: `calc(${Math.min(12, Math.max(3, text.length + 1))}ch + 12px)` }}
      value={draft ? value : text}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        if (draft) onCommit(e.target.value)
        else {
          setText(e.target.value)
          setRefused(false)
        }
      }}
      onKeyDown={(e) => {
        if (draft) return
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setText(value)
          setRefused(false)
        }
      }}
      onBlur={() => {
        if (!draft) commit()
      }}
    />
  )
}

/** A field in a draft is red when it has text that is not a number. */
export function badText(t: string): boolean {
  return t.trim() !== '' && t.trim() !== 'e' && evalText(t) === null
}

const TABS: { tab: ExpTab; label: string }[] = [
  { tab: 'rate', label: 'Rate' },
  { tab: 'points', label: 'Two points' },
  { tab: 'params', label: 'Parameters' },
]

/** The sentences and features under a preview or on a card. */
export function ExpFacts({
  sentences,
  features,
  testPrefix = 'exp',
}: {
  sentences: string[]
  features: string[]
  testPrefix?: string
}) {
  if (sentences.length === 0 && features.length === 0) return null
  return (
    <div className="xe-facts">
      {sentences.length > 0 && (
        <ul className="xe-sentences" data-testid={`${testPrefix}-sentences`}>
          {sentences.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
      {features.length > 0 && (
        <ul className="xe-features" data-testid={`${testPrefix}-features`}>
          {features.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ============================================================================
// the "Build ▾ → Exponential" card
// ============================================================================

interface EditorProps {
  /** Put it on the board. Error to show, or null (the editor then closes). */
  onBuild(spec: ExpSpec): string | null
  onClose(): void
  /** Start from this draft (tests). */
  initial?: ExpDraft
}

export function ExpEditor({ onBuild, onClose, initial }: EditorProps) {
  const [draft, setDraft] = useState<ExpDraft>(() => initial ?? blankDraft())
  const [buildError, setBuildError] = useState<string | null>(null)
  const [shiftOpen, setShiftOpen] = useState(
    () => (initial?.rate.h ?? '0').trim() !== '0' || (initial?.rate.k ?? '0').trim() !== '0',
  )
  const firstRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    firstRef.current?.focus()
    firstRef.current?.select()
  }, [])

  const made = useMemo(() => specFromDraft(draft), [draft])
  const preview = useMemo(() => expPreview(made.spec, made.error), [made])
  const error = made.error ?? preview.error
  const canBuild = !error && preview.src !== null && made.spec !== null

  const setRate = (patch: Partial<RateFields>): void => {
    setBuildError(null)
    setDraft((d) => ({ ...d, carried: null, rate: { ...d.rate, ...patch } }))
  }
  const setPoints = (patch: Partial<PointFields>): void => {
    setBuildError(null)
    setDraft((d) => ({ ...d, carried: null, points: { ...d.points, ...patch } }))
  }
  const setParams = (patch: Partial<ParamFields>): void => {
    setBuildError(null)
    setDraft((d) => ({ ...d, carried: null, params: { ...d.params, ...patch } }))
  }

  const build = (): void => {
    if (!canBuild || !made.spec) return
    const err = onBuild(made.spec)
    if (err) setBuildError(err)
  }

  const r = draft.rate
  const pt = draft.points
  const pa = draft.params
  const per = (value: string, onCommit: (t: string) => void): JSX.Element => (
    <>
      <span className="calc-tag">per</span>
      <XField
        value={value}
        mode="draft"
        label="Period (units)"
        className="fe-input-part"
        bad={badText(value)}
        onCommit={onCommit}
      />
      <span className="calc-tag">{value.trim() === '1' ? 'unit' : 'units'}</span>
    </>
  )

  return (
    <div
      className="expr-card fe-card xe-card"
      data-testid="exp-editor"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault()
          build()
        }
      }}
    >
      <div className="fe-head">
        <span className="fe-title">Exponential</span>
        <button
          type="button"
          className="calc-drop fe-close"
          title="Close (Esc)"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="seg xe-tabs" role="tablist" aria-label="State it by">
        {TABS.map((t) => (
          <button
            key={t.tab}
            type="button"
            role="tab"
            aria-selected={draft.tab === t.tab}
            data-tab={t.tab}
            className={`seg-btn xe-tab${draft.tab === t.tab ? ' seg-on' : ''}`}
            onClick={() => {
              setBuildError(null)
              setDraft((d) => switchTab(d, t.tab))
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {draft.tab === 'rate' && (
        <div className="xe-body" data-testid="exp-tab-rate">
          <div className="fe-a-row">
            <span className="calc-tag">Starts at</span>
            <XField
              value={r.init}
              mode="draft"
              label="Starts at (initial value)"
              bad={badText(r.init)}
              inputRef={(el) => {
                firstRef.current = el
              }}
              onCommit={(init) => setRate({ init })}
            />
            {r.h.trim() !== '' && r.h.trim() !== '0' && (
              <span className="calc-tag">at x = {r.h}</span>
            )}
          </div>
          <div className="fe-a-row">
            <select
              className="xe-select"
              aria-label="State the rate as"
              value={r.kind}
              onChange={(e) => setRate({ kind: e.target.value as RateKind })}
            >
              {RATE_KINDS.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                </option>
              ))}
            </select>
            {r.kind === 'factor' && (
              <>
                <span className="calc-tag">b =</span>
                <XField
                  value={r.b}
                  mode="draft"
                  label="Growth factor b"
                  bad={badText(r.b)}
                  onCommit={(b) => setRate({ b })}
                />
                {per(r.per, (p) => setRate({ per: p }))}
              </>
            )}
            {r.kind === 'percent' && (
              <>
                <XField
                  value={r.pct}
                  mode="draft"
                  label="Percent"
                  className="fe-input-part"
                  bad={badText(r.pct)}
                  onCommit={(pct) => setRate({ pct })}
                />
                <span className="calc-tag">%</span>
                <select
                  className="xe-select"
                  aria-label="Grows or decays"
                  value={r.grows ? 'grows' : 'decays'}
                  onChange={(e) => setRate({ grows: e.target.value === 'grows' })}
                >
                  <option value="grows">grows</option>
                  <option value="decays">decays</option>
                </select>
                {per(r.per, (p) => setRate({ per: p }))}
              </>
            )}
            {(r.kind === 'doubling' || r.kind === 'half-life') && (
              <>
                <XField
                  value={r.time}
                  mode="draft"
                  label={r.kind === 'doubling' ? 'Doubling time' : 'Half-life'}
                  bad={badText(r.time)}
                  onCommit={(time) => setRate({ time })}
                />
                <span className="calc-tag">units</span>
              </>
            )}
            {r.kind === 'continuous' && (
              <>
                <span className="calc-tag">r =</span>
                <XField
                  value={r.r}
                  mode="draft"
                  label="Continuous rate r"
                  bad={badText(r.r)}
                  onCommit={(v) => setRate({ r: v })}
                />
              </>
            )}
          </div>
          {shiftOpen ? (
            <div className="fe-a-row">
              <span className="calc-tag">asymptote y =</span>
              <XField
                value={r.k}
                mode="draft"
                label="Horizontal asymptote k"
                className="fe-input-part"
                bad={badText(r.k)}
                onCommit={(k) => setRate({ k })}
              />
              <span className="calc-tag">shift h =</span>
              <XField
                value={r.h}
                mode="draft"
                label="Horizontal shift h"
                className="fe-input-part"
                bad={badText(r.h)}
                onCommit={(h) => setRate({ h })}
              />
            </div>
          ) : (
            <button
              type="button"
              className="calc-chip fe-add xe-shift"
              onClick={() => setShiftOpen(true)}
            >
              + shift / asymptote
            </button>
          )}
        </div>
      )}

      {draft.tab === 'points' && (
        <div className="xe-body" data-testid="exp-tab-points">
          <div className="fe-a-row">
            <span className="calc-tag">through</span>
            <span className="field-sol-pt">
              (
              <XField
                value={pt.x1}
                mode="draft"
                label="x₁"
                className="fe-input-part"
                bad={badText(pt.x1)}
                onCommit={(x1) => setPoints({ x1 })}
              />
              <span className="calc-tag">,</span>
              <XField
                value={pt.y1}
                mode="draft"
                label="y₁"
                className="fe-input-part"
                bad={badText(pt.y1)}
                onCommit={(y1) => setPoints({ y1 })}
              />
              )
            </span>
            <span className="calc-tag">and</span>
            <span className="field-sol-pt">
              (
              <XField
                value={pt.x2}
                mode="draft"
                label="x₂"
                className="fe-input-part"
                bad={badText(pt.x2)}
                onCommit={(x2) => setPoints({ x2 })}
              />
              <span className="calc-tag">,</span>
              <XField
                value={pt.y2}
                mode="draft"
                label="y₂"
                className="fe-input-part"
                bad={badText(pt.y2)}
                onCommit={(y2) => setPoints({ y2 })}
              />
              )
            </span>
          </div>
          <div className="fe-a-row">
            <span className="calc-tag">asymptote y =</span>
            <XField
              value={pt.k}
              mode="draft"
              label="Horizontal asymptote k"
              className="fe-input-part"
              bad={badText(pt.k)}
              onCommit={(k) => setPoints({ k })}
            />
          </div>
        </div>
      )}

      {draft.tab === 'params' && (
        <div className="xe-body" data-testid="exp-tab-params">
          <div className="xe-formula">y = a·b^((x − h)/p) + k</div>
          <div className="fe-a-row">
            <span className="calc-tag">a =</span>
            <XField
              value={pa.a}
              mode="draft"
              label="a"
              className="fe-input-part"
              bad={badText(pa.a)}
              onCommit={(a) => setParams({ a })}
            />
            <span className="calc-tag">b =</span>
            <XField
              value={pa.b}
              mode="draft"
              label="b"
              className="fe-input-part"
              bad={badText(pa.b)}
              onCommit={(b) => setParams({ b })}
            />
            {pa.b.trim() === 'e' ? (
              <>
                <span className="calc-tag">r =</span>
                <XField
                  value={pa.r}
                  mode="draft"
                  label="Continuous rate r"
                  className="fe-input-part"
                  bad={badText(pa.r)}
                  onCommit={(v) => setParams({ r: v })}
                />
              </>
            ) : (
              <>
                <span className="calc-tag">p =</span>
                <XField
                  value={pa.p}
                  mode="draft"
                  label="p"
                  className="fe-input-part"
                  bad={badText(pa.p)}
                  onCommit={(p) => setParams({ p })}
                />
              </>
            )}
          </div>
          <div className="fe-a-row">
            <span className="calc-tag">h =</span>
            <XField
              value={pa.h}
              mode="draft"
              label="h"
              className="fe-input-part"
              bad={badText(pa.h)}
              onCommit={(h) => setParams({ h })}
            />
            <span className="calc-tag">k =</span>
            <XField
              value={pa.k}
              mode="draft"
              label="k"
              className="fe-input-part"
              bad={badText(pa.k)}
              onCommit={(k) => setParams({ k })}
            />
          </div>
        </div>
      )}

      <div
        className="fe-preview"
        data-src={preview.src ?? undefined}
        data-tex={preview.latex ?? undefined}
        aria-label={preview.src ?? 'No equation yet'}
      >
        {preview.latex ? (
          <Latex tex={preview.latex} className="card-latex" />
        ) : (
          <span className="fe-preview-none">—</span>
        )}
      </div>
      <ExpFacts sentences={preview.sentences} features={preview.features} />
      {(error || buildError) && <div className="expr-error">{buildError ?? error}</div>}

      <div className="fe-actions">
        <span className="expr-hint">Enter adds · Esc closes</span>
        <button type="button" className="fe-build" disabled={!canBuild} onClick={build}>
          Add to graph
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// the Exponential section on a typed curve's card
// ============================================================================

interface SectionProps {
  spec: ExpSpec
  /** Rewrite the curve's line in place. Error message, or null. */
  onRestate(src: string, label: string): string | null
  /** "Show inverse": add the exact inverse (a logarithm) and y = x. */
  onShowInverse?(): void
}

export function ExpSection({ spec, onRestate, onShowInverse }: SectionProps) {
  const [open, setOpen] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setError(null), [spec])

  const commit = (next: ExpSpec | null, label: string): string | null => {
    const err = commitExpSpec(spec, next, label, { restate: onRestate })
    setError(err)
    return err
  }
  const field = (f: ExpField) => (text: string): string | null =>
    commit(setExpField(spec, f, text), EXP_FIELD_LABEL[f])

  const rate = safeRate(spec)
  const features = featureLines(safeFeatures(spec))
  // The line cannot always say which statement it is — y = 100(1.05)^x is a
  // factor AND a percent — so the picker remembers what the teacher chose for
  // as long as the line is the one that choice wrote.
  const [chosen, setChosen] = useState<{ form: RateForm; src: string | null } | null>(null)
  const here = safeSource(spec)
  const form = chosen && chosen.src === here ? chosen.form : rateFormOf(spec)
  const baseE = isBaseE(spec)

  return (
    <div className="field-section fe-section xe-section" data-testid="exp-section">
      <button
        type="button"
        className="an-title fe-toggle"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        Exponential <span className="fe-caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          <div className="fe-a-row">
            <span className="calc-tag">a =</span>
            <XField value={spec.a} mode="commit" label="Initial value a" className="fe-input-part" onCommit={field('a')} />
            <span className="calc-tag">b =</span>
            <XField value={spec.b} mode="commit" label="Growth factor b" className="fe-input-part" onCommit={field('b')} />
            {baseE ? (
              <>
                <span className="calc-tag">r =</span>
                <XField
                  value={spec.rate ?? ''}
                  mode="commit"
                  label="Continuous rate r"
                  className="fe-input-part"
                  onCommit={field('rate')}
                />
              </>
            ) : (
              <>
                <span className="calc-tag">per</span>
                <XField value={spec.p || '1'} mode="commit" label="Period p" className="fe-input-part" onCommit={field('p')} />
                <span className="calc-tag">{(spec.p || '1').trim() === '1' ? 'unit' : 'units'}</span>
              </>
            )}
          </div>
          <div className="fe-a-row">
            <span className="calc-tag">h =</span>
            <XField value={spec.h || '0'} mode="commit" label="Horizontal shift h" className="fe-input-part" onCommit={field('h')} />
            <span className="calc-tag">asymptote y =</span>
            <XField value={spec.k || '0'} mode="commit" label="Horizontal asymptote k" className="fe-input-part" onCommit={field('k')} />
          </div>
          <div className="fe-a-row">
            <span className="calc-tag">rate as</span>
            <select
              className="xe-select"
              aria-label="State the rate as"
              value={form}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const to = e.target.value as RateForm
                if (to === form) return
                const next = rewriteRate(spec, to)
                if (!commit(next, 'restate rate') && next) {
                  setChosen({ form: to, src: safeSource(next) })
                }
              }}
            >
              {rateFormOptions(spec).map((o) => (
                <option key={o.form} value={o.form}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <ExpFacts sentences={rate?.sentences ?? []} features={features} />
          {error && <div className="expr-error">{error}</div>}
          {onShowInverse && (
            <div className="fe-a-row">
              <button
                type="button"
                className="calc-chip xe-inverse"
                data-testid="exp-show-inverse"
                title="Add the inverse function (a logarithm) and the mirror line y = x"
                onClick={(e) => {
                  e.stopPropagation()
                  onShowInverse()
                }}
              >
                Show inverse
              </button>
            </div>
          )}
          <div className="field-hint">
            Drag the asymptote, the y-intercept or the point one period later on the board.
          </div>
        </>
      )}
    </div>
  )
}
