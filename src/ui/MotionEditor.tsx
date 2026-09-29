import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { CardSection, withoutDomainRange } from './CardSection'
import type { FittedCurve, ModelSpec } from '../core/types'
import { Latex } from './Latex'
import { ExpFacts, XField, badText } from './ExpEditor'
import {
  CUSTOM,
  MOTION_TABS,
  SPEEDS,
  VAR_OF,
  blankMotionDraft,
  clampT,
  defaultArea,
  defaultPlay,
  draftFamily,
  draftInterval,
  draftSource,
  familiesOf,
  familyValues,
  labeledText,
  motionInterval,
  motionPreview,
  motionReadouts,
  num,
  polarAreaText,
  readAreaBounds,
  safeDescribePolar,
  safeFeatures,
  safePolarArea,
  safeState,
  scaleText,
  setDraftInterval,
  setDraftValue,
  valueText,
} from './motionLinks'
import type { MotionDraft, MotionKind, MotionPlayState, MotionScales, MotionSpeed } from './motionLinks'
import type { ParamFeatures } from '../core/motion'

// ============================================================================
// src/ui/MotionEditor.tsx — parametric and polar curves, the AP Calculus BC
// way: a particle in the plane.
//
// The sibling of ConicEditor.tsx and SinEditor.tsx, in the same two places:
//
//   * MotionEditor, "Build ▾ → Parametric / polar". A DRAFT with two tabs —
//     Parametric (a family from PARAM_FAMILIES with its named fields, or
//     Custom x(t), y(t)) and Polar (POLAR_FAMILIES or Custom r(θ)) — each
//     with its interval. Live KaTeX, the features' sentences and, for polar,
//     what the curve is ("a rose with 3 petals of length 2"). Nothing reaches
//     the board until "Add to graph", which adds ONE typed line.
//   * MotionSection, on the card of any parametric or polar curve (typed,
//     built or a sketched polar family): the interval (a committed edit
//     restates the line), the features, and the player — a t / θ slider with
//     play / pause and a speed, the particle's readouts, and for polar the
//     shaded area ½∫r²dθ between two θ.
//
// The logic is pure and lives in src/ui/motionLinks.ts; the calculus in
// src/core/motion.ts. The App owns the player's state and the animation.
// ============================================================================

function Row({ tag, children }: { tag: string; children: ReactNode }) {
  return (
    <div className="fe-a-row">
      <span className="calc-tag mo-tag">{tag}</span>
      {children}
    </div>
  )
}

/** A free-text formula field (x(t), y(t), r(θ)): the parser, not evalText, judges it. */
function FormulaField({
  value,
  label,
  placeholder,
  inputRef,
  onChange,
}: {
  value: string
  label: string
  placeholder: string
  inputRef?: (el: HTMLInputElement | null) => void
  onChange(text: string): void
}) {
  return (
    <input
      ref={inputRef}
      className="calc-input fe-input xe-input mo-input-f"
      type="text"
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      aria-label={label}
      title={label}
      placeholder={placeholder}
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

// ============================================================================
// the "Build ▾ → Parametric / polar" card
// ============================================================================

interface EditorProps {
  /** Put the line on the board. Error to show, or null (the editor then closes). */
  onBuild(src: string, tab: MotionDraft['tab']): string | null
  onClose(): void
  /** Start from this draft (tests). */
  initial?: MotionDraft
}

export function MotionEditor({ onBuild, onClose, initial }: EditorProps) {
  const [draft, setDraft] = useState<MotionDraft>(() => initial ?? blankMotionDraft())
  const [buildError, setBuildError] = useState<string | null>(null)
  const firstRef = useRef<HTMLInputElement | null>(null)

  const fam = draftFamily(draft)
  useEffect(() => {
    firstRef.current?.focus()
    firstRef.current?.select()
  }, [draft.tab, fam?.id])

  const made = useMemo(() => draftSource(draft), [draft])
  const preview = useMemo(() => motionPreview(made.src, draft.tab, made.error), [made, draft.tab])
  const error = made.error ?? preview.error
  const canBuild = !error && preview.src !== null && preview.latex !== null

  const update = (next: MotionDraft): void => {
    setBuildError(null)
    setDraft(next)
  }
  const build = (): void => {
    if (!canBuild || !preview.src) return
    const err = onBuild(preview.src, draft.tab)
    if (err) setBuildError(err)
  }
  const focusFirst = (node: HTMLInputElement | null): void => {
    firstRef.current = node
  }

  const families = familiesOf(draft.tab)
  const famId = draft.tab === 'parametric' ? draft.paramFamily : draft.polarFamily
  const [lo, hi] = draftInterval(draft)
  const v = draft.tab === 'parametric' ? 't' : 'θ'
  const values = fam ? familyValues(draft, fam) : {}

  return (
    <div
      className="expr-card fe-card xe-card mo-card"
      data-testid="motion-editor"
      onKeyDown={(ev) => {
        if (ev.key === 'Escape') {
          ev.preventDefault()
          ev.stopPropagation()
          onClose()
        } else if (ev.key === 'Enter' && (ev.target as HTMLElement).tagName === 'INPUT') {
          ev.preventDefault()
          build()
        }
      }}
    >
      <div className="fe-head">
        <span className="fe-title">Parametric / polar</span>
        <button type="button" className="calc-drop fe-close" title="Close (Esc)" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="seg xe-tabs" role="tablist" aria-label="Parametric or polar">
        {MOTION_TABS.map((t) => (
          <button
            key={t.tab}
            type="button"
            role="tab"
            aria-selected={draft.tab === t.tab}
            data-tab={t.tab}
            className={`seg-btn xe-tab${draft.tab === t.tab ? ' seg-on' : ''}`}
            onClick={() => update({ ...draft, tab: t.tab })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="xe-body" data-testid={`motion-tab-${draft.tab}`}>
        <Row tag="curve">
          <select
            className="xe-select"
            aria-label={draft.tab === 'parametric' ? 'Parametric family' : 'Polar family'}
            data-testid="motion-family"
            value={famId}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              update(
                draft.tab === 'parametric'
                  ? { ...draft, paramFamily: e.target.value }
                  : { ...draft, polarFamily: e.target.value },
              )
            }
          >
            {families.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
            <option value={CUSTOM}>Custom</option>
          </select>
        </Row>

        {fam &&
          fam.params.map((p, i) => (
            <Row key={`${fam.id}:${p.name}`} tag={p.name}>
              <XField
                value={values[p.name]}
                mode="draft"
                label={p.label}
                className="fe-input-part"
                bad={badText(values[p.name])}
                inputRef={i === 0 ? focusFirst : undefined}
                onCommit={(text) => update(setDraftValue(draft, fam, p.name, text))}
              />
              <span className="mo-param-label">{p.label}</span>
            </Row>
          ))}

        {!fam && draft.tab === 'parametric' && (
          <>
            <Row tag="x(t) =">
              <FormulaField
                value={draft.customX}
                label="x as a formula in t"
                placeholder="2cos(t)"
                inputRef={focusFirst}
                onChange={(customX) => update({ ...draft, customX })}
              />
            </Row>
            <Row tag="y(t) =">
              <FormulaField
                value={draft.customY}
                label="y as a formula in t"
                placeholder="3sin(t)"
                onChange={(customY) => update({ ...draft, customY })}
              />
            </Row>
          </>
        )}
        {!fam && draft.tab === 'polar' && (
          <Row tag="r(θ) =">
            <FormulaField
              value={draft.customR}
              label="r as a formula in θ"
              placeholder="1 + 2cos(θ)"
              inputRef={focusFirst}
              onChange={(customR) => update({ ...draft, customR })}
            />
          </Row>
        )}

        <Row tag={`${v} from`}>
          <XField
            value={lo}
            mode="draft"
            label={`${v} from`}
            className="fe-input-part"
            bad={badText(lo)}
            onCommit={(text) => update(setDraftInterval(draft, 0, text))}
          />
          <span className="calc-tag">to</span>
          <XField
            value={hi}
            mode="draft"
            label={`${v} to`}
            className="fe-input-part"
            bad={badText(hi)}
            onCommit={(text) => update(setDraftInterval(draft, 1, text))}
          />
        </Row>
      </div>

      <div
        className="fe-preview"
        data-src={preview.src ?? undefined}
        aria-label={preview.src ?? 'No curve yet'}
      >
        {preview.latex ? <Latex tex={preview.latex} className="card-latex" /> : <span className="fe-preview-none">—</span>}
      </div>
      {preview.describe && (
        <div className="mo-describe" data-testid="motion-describe">
          {preview.describe}
        </div>
      )}
      <ExpFacts sentences={preview.sentences} features={[]} testPrefix="motion" />
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
// the Motion section on a card
// ============================================================================

/** Filled-track stop for a range input (the --fill token in CSS). */
function fillStyle(value: number, min: number, max: number): CSSProperties {
  const span = max - min || 1
  const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100))
  return { '--fill': `${pct}%` } as CSSProperties
}

/**
 * The feature rows a Motion section lists: start and end, and for a
 * parametric curve its horizontal / vertical tangents and singular points as
 * points. `covers` names the core sentence a row makes redundant.
 */
export function featureRows(
  f: ParamFeatures,
  kind: MotionKind,
): { key: string; label: string; items: string[]; covers?: RegExp }[] {
  const v = VAR_OF[kind]
  const out: { key: string; label: string; items: string[]; covers?: RegExp }[] = []
  if (f.start) out.push({ key: 'start', label: 'Starts', items: [labeledText(f.start, v)] })
  if (f.end) out.push({ key: 'end', label: 'Ends', items: [labeledText(f.end, v)] })
  if (kind === 'parametric') {
    if (f.horizontalTangents.length > 0) {
      out.push({
        key: 'htan',
        label: f.horizontalTangents.length > 1 ? 'Horizontal tangents' : 'Horizontal tangent',
        items: f.horizontalTangents.map((p) => labeledText(p, v)),
        covers: /^horizontal tangents? at/,
      })
    }
    if (f.verticalTangents.length > 0) {
      out.push({
        key: 'vtan',
        label: f.verticalTangents.length > 1 ? 'Vertical tangents' : 'Vertical tangent',
        items: f.verticalTangents.map((p) => labeledText(p, v)),
        covers: /^vertical tangents? at/,
      })
    }
  }
  if (f.singular.length > 0) {
    out.push({
      key: 'singular',
      label: f.singular.length > 1 ? 'Singular points' : 'Singular point',
      items: f.singular.map((p) => labeledText(p, v)),
    })
  }
  return out
}

interface SectionProps {
  curve: FittedCurve
  models: Record<string, ModelSpec>
  kind: MotionKind
  /** The typed line, when there is one (the polar sentence reads it). */
  src?: string
  /** Changes when a curve this one calls moves (its params stand still). */
  depKey?: string
  /** The player, as the App keeps it. Absent = at the start, paused, read-only. */
  play?: MotionPlayState
  /** The vectors' scales on this board (the App measures them). */
  scales?: MotionScales
  onPlay?(patch: Partial<MotionPlayState>): void
  /** Commit a new interval (typed line: restated; sketch: its domain). Error, or null. */
  onInterval?(lo: string, hi: string): string | null
}

export function MotionSection({ curve, models, kind, src, depKey, play, scales, onPlay, onInterval }: SectionProps) {
  const [error, setError] = useState<string | null>(null)
  const interval = motionInterval(curve)
  const [lo, hi] = interval
  const v = VAR_OF[kind]
  const state = play ?? defaultPlay(interval)
  const t = clampT(state.t, interval)

  // Everything read off the whole curve: recomputed when the curve moves.
  const sig = `${curve.modelId}|${curve.params.join(',')}|${lo},${hi}|${depKey ?? ''}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const features = useMemo(() => safeFeatures(curve, models), [sig, models])
  const describe = useMemo(() => (kind === 'polar' ? safeDescribePolar(src) : null), [kind, src])
  const now = useMemo(() => safeState(curve, models, t), [sig, models, t]) // eslint-disable-line react-hooks/exhaustive-deps
  const readouts = motionReadouts(now, kind)

  const area = kind === 'polar' ? state.area : null
  const areaBounds = area && area.on ? readAreaBounds(area.a, area.b) : null
  const areaRes = useMemo(
    () => (areaBounds && !('error' in areaBounds) ? safePolarArea(curve, models, areaBounds.a, areaBounds.b) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig, models, areaBounds && !('error' in areaBounds) ? `${areaBounds.a},${areaBounds.b}` : ''],
  )
  const areaText = polarAreaText(areaRes)

  const f = features
  const step = (hi - lo) / 1000
  const commitEnd = (end: 0 | 1) => (text: string): string | null => {
    if (!onInterval) return null
    const loT = end === 0 ? text : valueText(lo)
    const hiT = end === 1 ? text : valueText(hi)
    const err = onInterval(loT, hiT)
    setError(err)
    return err
  }

  // The points, where a coordinate says more than the sentence's t does; the
  // core's sentences say everything else (direction, arc length, the pole,
  // max |r|, the area and whether the curve retraces itself).
  const rows = f ? featureRows(f, kind) : []
  const sentences = f ? f.sentences.filter((t) => t.trim() !== '' && !rows.some((r) => r.covers?.test(t))) : []

  return (
    <CardSection kind={`motion`} title={`Motion · ${kind === 'parametric' ? 'parametric' : 'polar'}`} className="field-section fe-section xe-section mo-section" testId="motion-section" data={{ kind: kind }}>
          <div className="fe-a-row mo-interval" data-testid="motion-interval">
            <XField
              value={valueText(lo)}
              mode="commit"
              label={`${v} from`}
              className="fe-input-part"
              onCommit={onInterval ? commitEnd(0) : () => null}
            />
            <span className="calc-tag">≤ {v} ≤</span>
            <XField
              value={valueText(hi)}
              mode="commit"
              label={`${v} to`}
              className="fe-input-part"
              onCommit={onInterval ? commitEnd(1) : () => null}
            />
          </div>
          {error && <div className="expr-error">{error}</div>}
          {describe && (
            <div className="mo-describe" data-testid="motion-describe">
              {describe}
            </div>
          )}

          {rows.length > 0 && (
            <div className="mo-features" data-testid="motion-features">
              {rows.map((r) => (
                <div className="an-row" key={r.key} data-feature={r.key}>
                  <span className="an-label">{r.label}</span>
                  <span className="an-values mo-values">
                    {r.items.map((it, i) => (
                      <span key={i} className="mo-value">
                        {i < r.items.length - 1 ? `${it};` : it}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
          <ExpFacts sentences={sentences} features={[]} testPrefix="motion" />

          <div className="mo-player" data-testid="motion-player">
            <button
              type="button"
              className="calc-chip mo-play"
              data-testid="motion-play"
              aria-label={state.playing ? 'Pause' : 'Play'}
              title={state.playing ? 'Pause' : `Play: move the particle as ${v} increases`}
              disabled={!onPlay}
              onClick={(ev) => {
                ev.stopPropagation()
                if (!onPlay) return
                // from the end, play starts over
                const atEnd = t >= hi - step / 2
                onPlay(state.playing ? { playing: false } : { playing: true, t: atEnd ? lo : t })
              }}
            >
              {state.playing ? '⏸' : '▶'}
            </button>
            <input
              type="range"
              className="mo-slider"
              data-testid="motion-slider"
              aria-label={`${v} (the parameter)`}
              min={lo}
              max={hi}
              step={step}
              value={t}
              style={fillStyle(t, lo, hi)}
              disabled={!onPlay}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onPlay?.({ t: Number(e.target.value), playing: false })}
            />
            <div className="seg mo-speed" role="group" aria-label="Speed">
              {SPEEDS.map((s: MotionSpeed) => (
                <button
                  key={s}
                  type="button"
                  className={`seg-btn${state.speed === s ? ' seg-on' : ''}`}
                  aria-pressed={state.speed === s}
                  disabled={!onPlay}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    onPlay?.({ speed: s })
                  }}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>

          {readouts.length > 0 && (
            <div className="mo-readouts" data-testid="motion-readouts">
              {readouts.map((r) => (
                <div className="mo-readout" key={r.key} data-readout={r.key}>
                  <span className="mo-r-label">{r.label}</span> <span className="mo-r-value">{r.value}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mo-toggles">
            <label className="te-check" onClick={(ev) => ev.stopPropagation()}>
              <input
                type="checkbox"
                checked={state.accel}
                data-testid="motion-accel"
                disabled={!onPlay}
                onChange={(ev) => onPlay?.({ accel: ev.target.checked })}
              />
              <span>acceleration vector</span>
            </label>
            <label className="te-check" onClick={(ev) => ev.stopPropagation()}>
              <input
                type="checkbox"
                checked={state.exportParticle}
                data-testid="motion-export"
                disabled={!onPlay}
                onChange={(ev) => onPlay?.({ exportParticle: ev.target.checked })}
              />
              <span>show particle in export</span>
            </label>
          </div>
          {scales && (
            <div className="field-hint" data-testid="motion-scale">
              Velocity drawn {scaleText(scales.velocity)}
              {state.accel ? `, acceleration ${scaleText(scales.acceleration)}` : ''}; no arrow longer than a quarter
              of the board.
            </div>
          )}

          {kind === 'polar' && (
            <div className="mo-area" data-testid="motion-area">
              <label className="te-check" onClick={(ev) => ev.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={Boolean(area?.on)}
                  data-testid="motion-area-on"
                  disabled={!onPlay}
                  onChange={(ev) => {
                    if (!onPlay) return
                    if (!ev.target.checked) onPlay({ area: area ? { ...area, on: false } : null })
                    else onPlay({ area: area ? { ...area, on: true } : defaultArea(curve, models) })
                  }}
                />
                <span>shade area</span>
              </label>
              {area?.on && (
                <div className="fe-a-row mo-area-row">
                  <span className="calc-tag">θ from</span>
                  <XField
                    value={area.a}
                    mode="commit"
                    label="Shade from θ ="
                    className="fe-input-part"
                    onCommit={(text) => {
                      onPlay?.({ area: { ...area, a: text } })
                      return null
                    }}
                  />
                  <span className="calc-tag">to</span>
                  <XField
                    value={area.b}
                    mode="commit"
                    label="Shade to θ ="
                    className="fe-input-part"
                    onCommit={(text) => {
                      onPlay?.({ area: { ...area, b: text } })
                      return null
                    }}
                  />
                </div>
              )}
              {area?.on && areaBounds && 'error' in areaBounds && <div className="expr-error">{areaBounds.error}</div>}
              {area?.on && areaText && (
                <div className="mo-area-readout" data-testid="motion-area-readout">
                  {areaText}
                </div>
              )}
            </div>
          )}

          <div className="field-hint">
            {onPlay
              ? `Drag the particle on the board, or the slider. 1× moves ${v} ${
                  hi - lo <= 12 ? 'one unit per second' : `across the interval in 12 s`
                }.`
              : null}
          </div>
    </CardSection>
  )
}
