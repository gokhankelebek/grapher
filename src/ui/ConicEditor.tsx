import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CardSection } from './CardSection'
import type { ConicSpec } from '../core/conics'
import { Latex } from './Latex'
import { ExpFacts, XField, badText } from './ExpEditor'
import {
  CONIC_FIELD_LABEL,
  CONIC_TABS,
  KIND_NAME,
  badPoint,
  blankConicDraft,
  commitConicSpec,
  conicFieldText,
  conicFieldsOf,
  conicPreview,
  conicSpecFromDraft,
  conicValues,
  parabolaOpens,
  prettyConic,
  safeConicFeatures,
  safeConicSource,
  setConicField,
  setHyperbolaOpens,
  setParabolaOpens,
} from './conicLinks'
import type {
  CircleFields,
  ConicDraft,
  ConicField,
  ConicSectionInfo,
  EllipseFields,
  FociFields,
  HyperbolaFields,
  ParabolaFields,
  ParabolaOpens,
} from './conicLinks'

// ============================================================================
// src/ui/ConicEditor.tsx — a conic section, stated the Math 3 way.
//
// The sibling of SinEditor.tsx and TransformEditor.tsx, in the same two places:
//
//   * ConicEditor, "Build ▾ → Conic". A DRAFT with six tabs — Circle, Ellipse,
//     Hyperbola, Parabola (each from the points a textbook gives), Foci (the
//     locus definitions: sum → ellipse, difference → hyperbola) and Equation
//     (a pasted general form, completed to standard form). Point fields take
//     "(2, -1)" and expressions. Nothing reaches the board until "Add to
//     graph", which adds the STANDARD form.
//   * ConicSection, on the card of any typed curve the core reads as a conic
//     — standard or general form, including a hand-typed
//     x^2 + y^2 - 4x + 6y - 3 = 0. COMMITTED: a field is an edit on Enter or
//     blur, "write in standard form" restates a general-form line in place;
//     each is one undo entry. A ROTATED conic (an xy term) is read in its own
//     axes x′, y′ — θ, h′, k′, a, b (or p) as read-only fields, the
//     discriminant sentence, and its center, vertices, foci, asymptotes,
//     directrix in x, y — and is changed by retyping the line (no field
//     edits, no board handles). A degenerate quadratic gets the
//     discriminant sentence, read-only.
//
// Both only ever produce an ordinary typed equation (src/core/conics.ts
// writes it). The logic is pure and lives in src/ui/conicLinks.ts.
// ============================================================================

/** A point field in a draft: "(2, -1)", red while it is not a point. */
function PointField({
  value,
  label,
  onChange,
  inputRef,
}: {
  value: string
  label: string
  onChange(text: string): void
  inputRef?: (el: HTMLInputElement | null) => void
}) {
  return (
    <XField
      value={value}
      mode="draft"
      label={`${label} — (x, y)`}
      className="co-input-pt"
      bad={badPoint(value)}
      inputRef={inputRef}
      placeholder="(x, y)"
      onCommit={onChange}
    />
  )
}

function Row({ tag, children }: { tag: string; children: ReactNode }) {
  return (
    <div className="fe-a-row">
      <span className="calc-tag co-tag">{tag}</span>
      {children}
    </div>
  )
}

function Choice<T extends string>({
  value,
  label,
  options,
  onChange,
  testId,
}: {
  value: T
  label: string
  options: { value: T; label: string }[]
  onChange(v: T): void
  testId?: string
}) {
  return (
    <select
      className="xe-select"
      aria-label={label}
      data-testid={testId}
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

const OPENS: { value: ParabolaOpens; label: string }[] = [
  { value: 'up', label: 'up' },
  { value: 'down', label: 'down' },
  { value: 'left', label: 'left' },
  { value: 'right', label: 'right' },
]

// ============================================================================
// the "Build ▾ → Conic" card
// ============================================================================

interface EditorProps {
  /** Put the standard form on the board. Error to show, or null (the editor then closes). */
  onBuild(src: string): string | null
  onClose(): void
  /** Start from this draft (tests). */
  initial?: ConicDraft
}

export function ConicEditor({ onBuild, onClose, initial }: EditorProps) {
  const [draft, setDraft] = useState<ConicDraft>(() => initial ?? blankConicDraft())
  const [buildError, setBuildError] = useState<string | null>(null)
  const firstRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    firstRef.current?.focus()
    firstRef.current?.select()
  }, [draft.tab])

  const made = useMemo(() => conicSpecFromDraft(draft), [draft])
  const preview = useMemo(() => conicPreview(made.spec, made.error), [made])
  const error = made.error ?? preview.error
  const canBuild = !error && preview.src !== null && made.spec !== null

  const patch = <K extends 'circle' | 'ellipse' | 'hyperbola' | 'parabola' | 'foci' | 'equation'>(
    tab: K,
    p: Partial<ConicDraft[K]>,
  ): void => {
    setBuildError(null)
    setDraft((d) => ({ ...d, [tab]: { ...d[tab], ...p } }))
  }
  const ci = (p: Partial<CircleFields>) => patch('circle', p)
  const el = (p: Partial<EllipseFields>) => patch('ellipse', p)
  const hy = (p: Partial<HyperbolaFields>) => patch('hyperbola', p)
  const pa = (p: Partial<ParabolaFields>) => patch('parabola', p)
  const fo = (p: Partial<FociFields>) => patch('foci', p)

  const build = (): void => {
    if (!canBuild || !preview.src) return
    const err = onBuild(preview.src)
    if (err) setBuildError(err)
  }

  const focusFirst = (node: HTMLInputElement | null): void => {
    firstRef.current = node
  }
  const { circle: c, ellipse: e, hyperbola: h, parabola: p, foci: f } = draft

  return (
    <div
      className="expr-card fe-card xe-card co-card"
      data-testid="conic-editor"
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
        <span className="fe-title">Conic</span>
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

      <div className="seg xe-tabs co-tabs" role="tablist" aria-label="Which conic">
        {CONIC_TABS.map((t) => (
          <button
            key={t.tab}
            type="button"
            role="tab"
            aria-selected={draft.tab === t.tab}
            data-tab={t.tab}
            className={`seg-btn xe-tab${draft.tab === t.tab ? ' seg-on' : ''}`}
            onClick={() => {
              setBuildError(null)
              setDraft((d) => ({ ...d, tab: t.tab }))
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {draft.tab === 'circle' && (
        <div className="xe-body" data-testid="conic-tab-circle">
          <Row tag="center">
            <PointField value={c.center} label="Center" inputRef={focusFirst} onChange={(center) => ci({ center })} />
          </Row>
          <Row tag="and">
            <Choice
              value={c.by}
              label="And"
              testId="conic-circle-by"
              options={[
                { value: 'radius', label: 'the radius' },
                { value: 'point', label: 'a point on it' },
              ]}
              onChange={(by) => ci({ by })}
            />
            {c.by === 'radius' ? (
              <XField
                value={c.radius}
                mode="draft"
                label="Radius"
                className="fe-input-part"
                bad={badText(c.radius)}
                onCommit={(radius) => ci({ radius })}
              />
            ) : (
              <PointField value={c.point} label="A point on the circle" onChange={(point) => ci({ point })} />
            )}
          </Row>
        </div>
      )}

      {draft.tab === 'ellipse' && (
        <div className="xe-body" data-testid="conic-tab-ellipse">
          <Row tag="center">
            <PointField value={e.center} label="Center" inputRef={focusFirst} onChange={(center) => el({ center })} />
          </Row>
          <Row tag="vertex">
            <PointField value={e.vertex} label="A vertex (end of the major axis)" onChange={(vertex) => el({ vertex })} />
          </Row>
          <Row tag="and">
            <Choice
              value={e.by}
              label="And"
              testId="conic-ellipse-by"
              options={[
                { value: 'focus', label: 'a focus' },
                { value: 'coVertex', label: 'a co-vertex' },
                { value: 'e', label: 'the eccentricity' },
              ]}
              onChange={(by) => el({ by })}
            />
            {e.by === 'focus' && <PointField value={e.focus} label="A focus" onChange={(focus) => el({ focus })} />}
            {e.by === 'coVertex' && (
              <PointField value={e.coVertex} label="A co-vertex (end of the minor axis)" onChange={(coVertex) => el({ coVertex })} />
            )}
            {e.by === 'e' && (
              <XField
                value={e.e}
                mode="draft"
                label="Eccentricity e = c/a (0 ≤ e < 1)"
                className="fe-input-part"
                bad={badText(e.e)}
                onCommit={(v) => el({ e: v })}
              />
            )}
          </Row>
        </div>
      )}

      {draft.tab === 'hyperbola' && (
        <div className="xe-body" data-testid="conic-tab-hyperbola">
          <Row tag="center">
            <PointField value={h.center} label="Center" inputRef={focusFirst} onChange={(center) => hy({ center })} />
          </Row>
          <Row tag="vertex">
            <PointField value={h.vertex} label="A vertex" onChange={(vertex) => hy({ vertex })} />
          </Row>
          <Row tag="and">
            <Choice
              value={h.by}
              label="And"
              testId="conic-hyperbola-by"
              options={[
                { value: 'focus', label: 'a focus' },
                { value: 'slope', label: 'an asymptote’s slope' },
                { value: 'e', label: 'the eccentricity' },
              ]}
              onChange={(by) => hy({ by })}
            />
            {h.by === 'focus' && <PointField value={h.focus} label="A focus" onChange={(focus) => hy({ focus })} />}
            {h.by === 'slope' && (
              <XField
                value={h.slope}
                mode="draft"
                label="Slope of an asymptote (±)"
                className="fe-input-part"
                bad={badText(h.slope)}
                onCommit={(slope) => hy({ slope })}
              />
            )}
            {h.by === 'e' && (
              <XField
                value={h.e}
                mode="draft"
                label="Eccentricity e = c/a (e > 1)"
                className="fe-input-part"
                bad={badText(h.e)}
                onCommit={(v) => hy({ e: v })}
              />
            )}
          </Row>
        </div>
      )}

      {draft.tab === 'parabola' && (
        <div className="xe-body" data-testid="conic-tab-parabola">
          <Row tag="from">
            <Choice
              value={p.by}
              label="From"
              testId="conic-parabola-by"
              options={[
                { value: 'vertex-focus', label: 'vertex and focus' },
                { value: 'focus-directrix', label: 'focus and directrix' },
                { value: 'vertex-point', label: 'vertex, a point, and which way it opens' },
              ]}
              onChange={(by) => pa({ by })}
            />
          </Row>
          {p.by !== 'focus-directrix' && (
            <Row tag="vertex">
              <PointField value={p.vertex} label="Vertex" inputRef={focusFirst} onChange={(vertex) => pa({ vertex })} />
            </Row>
          )}
          {p.by !== 'vertex-point' && (
            <Row tag="focus">
              <PointField
                value={p.focus}
                label="Focus"
                inputRef={p.by === 'focus-directrix' ? focusFirst : undefined}
                onChange={(focus) => pa({ focus })}
              />
            </Row>
          )}
          {p.by === 'focus-directrix' && (
            <Row tag="directrix">
              <input
                className={`calc-input fe-input xe-input co-input-line${
                  p.directrix.trim() !== '' && !/^\s*[xy]\s*=|=\s*[xy]\s*$/i.test(p.directrix) ? ' fe-input-bad' : ''
                }`}
                type="text"
                spellCheck={false}
                autoComplete="off"
                aria-label="Directrix — a line, y = −2 or x = 3"
                title="Directrix — a line, y = −2 or x = 3"
                placeholder="y = -2"
                value={p.directrix}
                onClick={(ev) => ev.stopPropagation()}
                onChange={(ev) => pa({ directrix: ev.target.value })}
              />
            </Row>
          )}
          {p.by === 'vertex-point' && (
            <>
              <Row tag="through">
                <PointField value={p.point} label="A point on the parabola" onChange={(point) => pa({ point })} />
              </Row>
              <Row tag="opens">
                <Choice value={p.opens} label="Opens" testId="conic-parabola-opens" options={OPENS} onChange={(opens) => pa({ opens })} />
              </Row>
            </>
          )}
        </div>
      )}

      {draft.tab === 'foci' && (
        <div className="xe-body" data-testid="conic-tab-foci">
          <Row tag="F₁">
            <PointField value={f.f1} label="First focus" inputRef={focusFirst} onChange={(f1) => fo({ f1 })} />
            <span className="calc-tag co-tag">F₂</span>
            <PointField value={f.f2} label="Second focus" onChange={(f2) => fo({ f2 })} />
          </Row>
          <Row tag="the">
            <Choice
              value={f.by}
              label="The distances to the foci"
              testId="conic-foci-by"
              options={[
                { value: 'sum', label: 'sum of the distances' },
                { value: 'difference', label: 'difference of the distances' },
              ]}
              onChange={(by) => fo({ by })}
            />
            <span className="calc-tag">is</span>
            {f.by === 'sum' ? (
              <XField
                value={f.sum}
                mode="draft"
                label="Sum of the distances (2a)"
                className="fe-input-part"
                bad={badText(f.sum)}
                onCommit={(sum) => fo({ sum })}
              />
            ) : (
              <XField
                value={f.difference}
                mode="draft"
                label="Difference of the distances (2a)"
                className="fe-input-part"
                bad={badText(f.difference)}
                onCommit={(difference) => fo({ difference })}
              />
            )}
          </Row>
          <div className="field-hint">
            Every point whose distances to F₁ and F₂ add to the sum is an ellipse; whose distances
            differ by the difference, a hyperbola.
          </div>
        </div>
      )}

      {draft.tab === 'equation' && (
        <div className="xe-body" data-testid="conic-tab-equation">
          <input
            ref={focusFirst}
            className="calc-input fe-input xe-input co-input-eq"
            type="text"
            spellCheck={false}
            autoComplete="off"
            aria-label="An equation in x and y — general or standard form"
            title="An equation in x and y — general or standard form"
            placeholder="9x^2 + 4y^2 - 36x + 8y + 4 = 0"
            value={draft.equation.text}
            onClick={(ev) => ev.stopPropagation()}
            onChange={(ev) => patch('equation', { text: ev.target.value })}
          />
          {made.classSentence && (
            <div className="co-class" data-testid="conic-class-sentence">
              {made.classSentence}
            </div>
          )}
          {made.spec && preview.src && (
            <div className="field-hint">Completing the square — Add puts this standard form on the graph:</div>
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
        {preview.kind && <span className="co-kind" data-testid="conic-kind">{KIND_NAME[preview.kind]}</span>}
      </div>
      <ExpFacts sentences={preview.sentences} features={[]} testPrefix="conic" />
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
// the Conic section on a typed curve's card
// ============================================================================

interface SectionProps {
  info: ConicSectionInfo
  /** Rewrite the curve's line in place. Error message, or null. */
  onRestate?(src: string, label: string): string | null
  /** The construction (foci, directrix, asymptotes, box) is figure content: drawn always, exported. */
  construction?: boolean
  onConstruction?(on: boolean): void
}

export function ConicSection({ info, onRestate, construction = false, onConstruction }: SectionProps) {
  const [error, setError] = useState<string | null>(null)
  const spec: ConicSpec | null = info.kind === 'conic' ? info.spec : null
  useEffect(() => setError(null), [spec])
  const kindName = info.kind === 'conic' ? KIND_NAME[info.spec.kind] : info.kind === 'rotated' ? KIND_NAME[info.rot.kind] : null

  const title = `Conic${kindName ? ` · ${kindName}` : ''}${info.kind === 'rotated' ? `, rotated ${info.rot.degreesText}` : ''}`
  const CLS = 'field-section fe-section xe-section co-section'

  if (info.kind === 'class') {
    return (
      <CardSection kind="conic" title={title} className={CLS} testId="conic-section">
        <div className="co-class" data-testid="conic-class">
          {info.sentence}
        </div>
      </CardSection>
    )
  }

  if (info.kind === 'rotated') {
    const r = info.rot
    const ro = (tag: string, value: string, label: string, key: string) => (
      <span key={key} className="co-field">
        <span className="calc-tag">{tag}</span>
        <input
          className="calc-input fe-input xe-input fe-input-part co-readonly"
          type="text"
          readOnly
          tabIndex={-1}
          aria-label={label}
          title={label}
          data-testid={`conic-rotated-${key}`}
          value={value}
          style={{ width: `calc(${Math.min(12, Math.max(3, value.length + 1))}ch + 12px)` }}
          onClick={(ev) => ev.stopPropagation()}
        />
      </span>
    )
    return (
      <CardSection
        kind="conic"
        title={title}
        className={CLS}
        testId="conic-section"
        data={{ kind: r.kind, rotated: 'true' }}
      >
            <div className="co-class" data-testid="conic-class">
              {info.sentence}
            </div>
            <div className="fe-a-row co-fields" data-testid="conic-rotated-fields">
              {ro('θ =', r.thetaText, 'The rotation angle θ of the axes x′, y′ (cot 2θ = (A − C)/B)', 'theta')}
              {conicFieldsOf(r.spec).map((fd) =>
                ro(
                  fd.tag.replace(/^([hkabp])/, (l) => (l === 'h' || l === 'k' ? `${l}′` : l)),
                  prettyConic(conicFieldText(r.spec, fd.field)),
                  `${fd.label} — in the rotated axes x′, y′ (read-only)`,
                  fd.field,
                ),
              )}
            </div>
            <ExpFacts sentences={r.features.sentences} features={[]} testPrefix="conic" />
            {onConstruction && (
              <label className="te-check" onClick={(ev) => ev.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={construction}
                  data-testid="conic-construction"
                  onChange={(ev) => onConstruction(ev.target.checked)}
                />
                <span>
                  show construction (foci
                  {r.kind === 'parabola' ? ', directrix' : r.kind === 'hyperbola' ? ', asymptotes, box' : ''}) in exports
                </span>
              </label>
            )}
            <div className="field-hint">
              Its axes are tilted {r.degreesText}: h′, k′ are the center’s coordinates along x′, y′. These are read-only —
              retype the equation to change the conic.
            </div>
      </CardSection>
    )
  }

  const s = info.spec
  const commit = (next: ConicSpec | null, label: string): string | null => {
    if (!onRestate) return null
    const err = commitConicSpec(s, next, label, { restate: onRestate })
    setError(err)
    return err
  }
  const field = (f: ConicField) => (text: string): string | null =>
    commit(setConicField(s, f, text), CONIC_FIELD_LABEL[f])
  const features = safeConicFeatures(s)
  const fields = conicFieldsOf(s)
  const standard = info.general ? safeConicSource(s) : null
  const v = conicValues(s)

  return (
    <CardSection kind="conic" title={title} className={CLS} testId="conic-section" data={{ kind: s.kind }}>
          <div className="fe-a-row co-fields">
            {fields.map((fd) => (
              <span key={fd.field} className="co-field">
                <span className="calc-tag">{fd.tag}</span>
                <XField
                  value={conicFieldText(s, fd.field)}
                  mode="commit"
                  label={fd.label}
                  className="fe-input-part"
                  onCommit={field(fd.field)}
                />
              </span>
            ))}
          </div>
          {s.kind === 'hyperbola' && (
            <div className="fe-a-row">
              <span className="calc-tag">opens</span>
              <Choice
                value={v.opens}
                label="Opens (switching changes the graph)"
                testId="conic-opens"
                options={[
                  { value: 'x', label: 'left and right' },
                  { value: 'y', label: 'up and down' },
                ]}
                onChange={(to) => {
                  if (to !== v.opens) commit(setHyperbolaOpens(s, to), 'switch opening')
                }}
              />
            </div>
          )}
          {s.kind === 'parabola' && (
            <div className="fe-a-row">
              <span className="calc-tag">opens</span>
              <Choice
                value={parabolaOpens(s)}
                label="Opens (switching changes the graph)"
                testId="conic-opens"
                options={OPENS}
                onChange={(to) => commit(setParabolaOpens(s, to), 'switch opening')}
              />
            </div>
          )}
          {standard && onRestate && (
            <div className="fe-a-row">
              <button
                type="button"
                className="calc-chip co-write"
                data-testid="conic-write-standard"
                title={`Restate this line as ${standard}`}
                onClick={(ev) => {
                  ev.stopPropagation()
                  const err = onRestate(standard, 'write in standard form')
                  setError(err)
                }}
              >
                write in standard form
              </button>
            </div>
          )}
          <ExpFacts sentences={features ? features.sentences : []} features={[]} testPrefix="conic" />
          {error && <div className="expr-error">{error}</div>}
          {onConstruction && s.kind !== 'circle' && (
            <label className="te-check" onClick={(ev) => ev.stopPropagation()}>
              <input
                type="checkbox"
                checked={construction}
                data-testid="conic-construction"
                onChange={(ev) => onConstruction(ev.target.checked)}
              />
              <span>show construction (foci{s.kind === 'parabola' ? ', directrix' : s.kind === 'hyperbola' ? ', asymptotes, box' : ''}) in exports</span>
            </label>
          )}
          <div className="field-hint">
            {s.kind === 'parabola'
              ? 'Drag the vertex (h, k) or the focus (p) on the board.'
              : s.kind === 'circle'
                ? 'Drag the center (h, k) or the point on the right (r) on the board.'
                : 'Drag the center (h, k), the ends of the axes (a, b) or a focus (c) on the board.'}
          </div>
    </CardSection>
  )
}
