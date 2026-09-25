import { useEffect, useMemo, useRef, useState } from 'react'
import type { LogSpec } from '../core/logarithmic'
import { Latex } from './Latex'
import { ExpFacts, XField, badText } from './ExpEditor'
import {
  BASE_CHOICES,
  LOG_FIELD_LABEL,
  REBASE_CHOICES,
  baseName,
  blankLogDraft,
  chosenSource,
  commitLogSpec,
  logPreview,
  logSpecFromDraft,
  rebaseKeyOf,
  rebaseTo,
  safeLogFeatures,
  logFacts,
  setLogField,
  switchLogTab,
} from './logLinks'
import type {
  BaseKey,
  InverseSource,
  LogDraft,
  LogField,
  LogParamFields,
  LogPointFields,
  LogTab,
  RebaseKey,
} from './logLinks'

// ============================================================================
// src/ui/LogEditor.tsx — a logarithmic function, stated the precalculus way.
//
//     y = a·log_b(c(x − h)) + k
//
// The sibling of ExpEditor.tsx, in the same two places:
//
//   * LogEditor, "Build ▾ → Logarithmic". A DRAFT with three tabs over ONE
//     function — Parameters, Two points, and Inverse of… (an exponential on
//     the board) — switching between Parameters and Two points re-seeds the
//     new tab from the curve the old one made, so the preview never jumps.
//     Nothing reaches the board until "Add to graph".
//   * LogSection, on the card of any typed curve that reads back as a
//     logarithm — including a hand-typed ln(x - 1) + 2. COMMITTED: a field is
//     an edit on Enter or blur, "write in base" rewrites the same function in
//     another base, "Show inverse" adds its exponential inverse and y = x.
//
// Both only ever produce an ordinary typed equation (src/core/logarithmic.ts
// writes it). The logic is pure and lives in src/ui/logLinks.ts.
// ============================================================================

const TABS: { tab: LogTab; label: string }[] = [
  { tab: 'params', label: 'Parameters' },
  { tab: 'points', label: 'Two points' },
  { tab: 'inverse', label: 'Inverse of…' },
]

/** The base picker, with the "other b" field beside it when chosen. */
function BasePicker({
  base,
  other,
  onChange,
}: {
  base: BaseKey
  other: string
  onChange(patch: { base?: BaseKey; other?: string }): void
}) {
  return (
    <>
      <span className="calc-tag">base</span>
      <select
        className="xe-select"
        aria-label="Base"
        value={base}
        onChange={(e) => onChange({ base: e.target.value as BaseKey })}
      >
        {BASE_CHOICES.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
      {base === 'other' && (
        <>
          <span className="calc-tag">b =</span>
          <XField
            value={other}
            mode="draft"
            label="Base b"
            className="fe-input-part"
            bad={badText(other)}
            onCommit={(t) => onChange({ other: t })}
          />
        </>
      )}
    </>
  )
}

// ============================================================================
// the "Build ▾ → Logarithmic" card
// ============================================================================

interface EditorProps {
  /** Put it on the board. Error to show, or null (the editor then closes). */
  onBuild(spec: LogSpec): string | null
  onClose(): void
  /** The exponentials on the board "Inverse of…" can pick. */
  sources?: readonly InverseSource[]
  /** Start from this draft (tests). */
  initial?: LogDraft
}

export function LogEditor({ onBuild, onClose, sources = [], initial }: EditorProps) {
  const [draft, setDraft] = useState<LogDraft>(() => initial ?? blankLogDraft())
  const [buildError, setBuildError] = useState<string | null>(null)
  const firstRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    firstRef.current?.focus()
    firstRef.current?.select()
  }, [])

  const made = useMemo(() => logSpecFromDraft(draft, sources), [draft, sources])
  const preview = useMemo(() => logPreview(made.spec, made.error), [made])
  const error = made.error ?? preview.error
  const canBuild = !error && preview.src !== null && made.spec !== null

  const setParams = (patch: Partial<LogParamFields>): void => {
    setBuildError(null)
    setDraft((d) => ({ ...d, carried: null, params: { ...d.params, ...patch } }))
  }
  const setPoints = (patch: Partial<LogPointFields>): void => {
    setBuildError(null)
    setDraft((d) => ({ ...d, carried: null, points: { ...d.points, ...patch } }))
  }

  const build = (): void => {
    if (!canBuild || !made.spec) return
    const err = onBuild(made.spec)
    if (err) setBuildError(err)
  }

  const pa = draft.params
  const pt = draft.points
  const chosen = chosenSource(draft.inverse, sources)

  return (
    <div
      className="expr-card fe-card xe-card le-card"
      data-testid="log-editor"
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
        <span className="fe-title">Logarithmic</span>
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
              setDraft((d) => switchLogTab(d, t.tab, sources))
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {draft.tab === 'params' && (
        <div className="xe-body" data-testid="log-tab-params">
          <div className="xe-formula">y = a·log_b(c(x − h)) + k</div>
          <div className="fe-a-row">
            <BasePicker base={pa.base} other={pa.other} onChange={(p) => setParams(p)} />
          </div>
          <div className="fe-a-row">
            <span className="calc-tag">a =</span>
            <XField
              value={pa.a}
              mode="draft"
              label="a"
              className="fe-input-part"
              bad={badText(pa.a)}
              inputRef={(el) => {
                firstRef.current = el
              }}
              onCommit={(a) => setParams({ a })}
            />
            <span className="calc-tag">c =</span>
            <XField
              value={pa.c}
              mode="draft"
              label="c"
              className="fe-input-part"
              bad={badText(pa.c)}
              onCommit={(c) => setParams({ c })}
            />
          </div>
          <div className="fe-a-row">
            <span className="calc-tag">h =</span>
            <XField
              value={pa.h}
              mode="draft"
              label="h (asymptote x = h)"
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

      {draft.tab === 'points' && (
        <div className="xe-body" data-testid="log-tab-points">
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
            <span className="calc-tag">asymptote x =</span>
            <XField
              value={pt.h}
              mode="draft"
              label="Vertical asymptote h"
              className="fe-input-part"
              bad={badText(pt.h)}
              onCommit={(h) => setPoints({ h })}
            />
            <BasePicker base={pt.base} other={pt.other} onChange={(p) => setPoints(p)} />
          </div>
        </div>
      )}

      {draft.tab === 'inverse' && (
        <div className="xe-body" data-testid="log-tab-inverse">
          {sources.length > 0 ? (
            <div className="fe-a-row">
              <span className="calc-tag">inverse of</span>
              <select
                className="xe-select le-source"
                aria-label="Inverse of which exponential"
                value={chosen?.id ?? ''}
                onChange={(e) => {
                  const id = e.target.value
                  setBuildError(null)
                  setDraft((d) => ({ ...d, carried: null, inverse: { sourceId: id } }))
                }}
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="field-hint" data-testid="log-inverse-none">
              There is no exponential on the board yet. Type one (y = 2^x) or build one with
              Build ▾ → Exponential, then come back here.
            </div>
          )}
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
      <ExpFacts sentences={preview.sentences} features={preview.features} testPrefix="log" />
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
// the Logarithmic section on a typed curve's card
// ============================================================================

interface SectionProps {
  spec: LogSpec
  /** Rewrite the curve's line in place. Error message, or null. */
  onRestate(src: string, label: string): string | null
  /** "Show inverse": add the exact inverse (an exponential) and y = x. */
  onShowInverse?(): void
}

export function LogSection({ spec, onRestate, onShowInverse }: SectionProps) {
  const [open, setOpen] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setError(null), [spec])

  const commit = (next: LogSpec | null, label: string): string | null => {
    const err = commitLogSpec(spec, next, label, { restate: onRestate })
    setError(err)
    return err
  }
  const field = (f: LogField) => (text: string): string | null =>
    commit(setLogField(spec, f, text), LOG_FIELD_LABEL[f])

  const facts = logFacts(safeLogFeatures(spec))
  const current = rebaseKeyOf(spec)

  return (
    <div className="field-section fe-section xe-section le-section" data-testid="log-section">
      <button
        type="button"
        className="an-title fe-toggle"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        Logarithmic <span className="fe-caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          <div className="fe-a-row">
            <span className="calc-tag">a =</span>
            <XField value={spec.a} mode="commit" label="Vertical stretch a" className="fe-input-part" onCommit={field('a')} />
            <span className="calc-tag">base</span>
            <XField value={spec.b} mode="commit" label="Base b (e for ln)" className="fe-input-part" onCommit={field('b')} />
            <span className="calc-tag">c =</span>
            <XField value={spec.c || '1'} mode="commit" label="Horizontal scale c" className="fe-input-part" onCommit={field('c')} />
          </div>
          <div className="fe-a-row">
            <span className="calc-tag">asymptote x =</span>
            <XField value={spec.h || '0'} mode="commit" label="Vertical asymptote h" className="fe-input-part" onCommit={field('h')} />
            <span className="calc-tag">k =</span>
            <XField value={spec.k || '0'} mode="commit" label="Vertical shift k" className="fe-input-part" onCommit={field('k')} />
          </div>
          <div className="fe-a-row">
            <span className="calc-tag">write in base</span>
            <select
              className="xe-select"
              aria-label="Write in base"
              data-testid="log-rebase"
              value={current}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const to = e.target.value as RebaseKey
                if (to === current || to === 'keep') return
                commit(rebaseTo(spec, to), `write in ${baseName(to)}`)
              }}
            >
              {REBASE_CHOICES.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.key === 'keep' ? `keep (${baseName(spec.b)})` : o.label}
                </option>
              ))}
            </select>
          </div>
          <ExpFacts sentences={facts.sentences} features={facts.features} testPrefix="log" />
          {error && <div className="expr-error">{error}</div>}
          {onShowInverse && (
            <div className="fe-a-row">
              <button
                type="button"
                className="calc-chip xe-inverse"
                data-testid="log-show-inverse"
                title="Add the inverse function (an exponential) and the mirror line y = x"
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
            Drag the asymptote on the x-axis, the anchor point or the base point on the board.
          </div>
        </>
      )}
    </div>
  )
}
