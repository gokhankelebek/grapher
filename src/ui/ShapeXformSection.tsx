// ============================================================================
// src/ui/ShapeXformSection.tsx — transformations on a shape's card.
//
//   ▾ TRANSFORM                     (a point, segment or polygon — an image too)
//     [Translate] [Reflect] [Rotate] [Dilate]
//     rotate  [90] °  about [(0, 0)]          [90°] [180°] [270°] [−90°]
//     [Create A′B′C′]      or type: rotate ABC 90° about (0, 0)
//
//   ▾ TRANSFORMATION                (an image)
//     △A′B′C′ = R_{90°,O}(△ABC)    R_{90°, O}: (x, y) → (−y, x)
//     a rotation of 90° counterclockwise about the origin · rigid
//     A′(−2, 1)  B′(−2, 4)  C′(−6, 4)
//     ✓ A′B′ = AB = 3   ✓ ∠A′ = ∠A = 90°   ✓ …
//     Show on board  [Rotation arc] [Vertex paths]
//
//   ▾ SYMMETRY                       (a polygon)       ▾ COMPARE (segment, polygon)
//
// Every computed answer is wrapped for reveal mode under the shape's own keys
// (src/ui/reveal.ts shapeKey): 'image' for an image's rule and vertices — the
// same key that hides the dashed figure on the board — 'symmetry', 'compare'.
// What the TEACHER typed (the angle, k, the line) is never hidden.
// ============================================================================

import { useEffect, useState } from 'react'
import type { XformAid, XformOp } from '../core/types'
import type { ShapeXform } from '../core/persist'
import { defaultOp } from '../core/parse/xform'
import { primeName, siblingName } from '../core/transform2d'
import type { Motion, SymmetryReport } from '../core/transform2d'
import { motionName, motionRule, motionWords, sequenceName, sequenceWords } from '../core/transform2d'
import { CardSection } from './CardSection'
import { Latex } from './Latex'
import { Answer } from './RevealAnswer'
import { shapeKey } from './reveal'
import type { CompareCardData, XformReport } from './shapeXform'
import { aidChoices, aidsOf } from './shapeXform'

const KINDS: { t: XformOp['t']; label: string; hint: string }[] = [
  { t: 'translate', label: 'Translate', hint: 'Slide every point by the same vector ⟨a, b⟩' },
  { t: 'reflect', label: 'Reflect', hint: 'Flip across a line: an axis, y = x, x = k, y = mx + b, or two points' },
  { t: 'rotate', label: 'Rotate', hint: 'Turn about a point; positive angles are counterclockwise' },
  { t: 'dilate', label: 'Dilate', hint: 'Scale from a center by k (a fraction shrinks, a negative k goes through the center)' },
]

const stop = (e: { stopPropagation(): void }): void => e.stopPropagation()

// ---------------------------------------------------------------------------
// The op editor: one kind's inputs, exact text
// ---------------------------------------------------------------------------

function OpEditor({
  op,
  onChange,
  onSubmit,
}: {
  op: XformOp
  onChange(op: XformOp): void
  onSubmit(): void
}) {
  const input = (value: string, set: (v: string) => void, label: string, width: string, placeholder?: string) => (
    <input
      className="calc-input xform-input"
      style={{ width }}
      type="text"
      spellCheck={false}
      autoComplete="off"
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onClick={stop}
      onChange={(e) => set(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          onSubmit()
        }
      }}
    />
  )
  const quick = (items: { label: string; apply: XformOp }[]) => (
    <div className="xform-quick">
      {items.map((q) => (
        <button
          key={q.label}
          type="button"
          className="calc-chip"
          onClick={(e) => {
            e.stopPropagation()
            onChange(q.apply)
          }}
        >
          {q.label}
        </button>
      ))}
    </div>
  )
  switch (op.t) {
    case 'translate':
      return (
        <div className="calc-controls xform-row">
          <span className="measure-toggles-label">by ⟨</span>
          {input(op.by[0], (v) => onChange({ ...op, by: [v, op.by[1]] }), 'Horizontal shift a', '3.2rem', 'a')}
          <span className="calc-tag">,</span>
          {input(op.by[1], (v) => onChange({ ...op, by: [op.by[0], v] }), 'Vertical shift b', '3.2rem', 'b')}
          <span className="measure-toggles-label">⟩</span>
        </div>
      )
    case 'reflect':
      return (
        <>
          <div className="calc-controls xform-row">
            <span className="measure-toggles-label">across</span>
            {input(op.line, (v) => onChange({ ...op, line: v }), 'Line of reflection', '9rem', 'y = x')}
          </div>
          {quick(
            ['x-axis', 'y-axis', 'y = x', 'y = -x'].map((l) => ({ label: l.replace('-x', '−x'), apply: { t: 'reflect', line: l } })),
          )}
        </>
      )
    case 'rotate':
      return (
        <>
          <div className="calc-controls xform-row">
            {input(op.angle, (v) => onChange({ ...op, angle: v }), 'Angle in degrees', '3.6rem', '90')}
            <span className="measure-toggles-label">° about</span>
            {input(op.about, (v) => onChange({ ...op, about: v }), 'Center of rotation', '5.5rem', '(0, 0)')}
          </div>
          {quick(['90', '180', '270', '-90'].map((a) => ({ label: `${a.replace('-', '−')}°`, apply: { ...op, angle: a } })))}
        </>
      )
    case 'dilate':
      return (
        <>
          <div className="calc-controls xform-row">
            <span className="measure-toggles-label">k =</span>
            {input(op.k, (v) => onChange({ ...op, k: v }), 'Scale factor k', '3.6rem', '2')}
            <span className="measure-toggles-label">about</span>
            {input(op.about, (v) => onChange({ ...op, about: v }), 'Center of dilation', '5.5rem', '(0, 0)')}
          </div>
          {quick(['2', '3', '1/2', '-1'].map((k) => ({ label: `k = ${k.replace('-', '−')}`, apply: { ...op, k } })))}
        </>
      )
  }
}

function KindChips({ t, onPick }: { t: XformOp['t']; onPick(t: XformOp['t']): void }) {
  return (
    <div className="measure-toggles" role="group" aria-label="Transformation">
      {KINDS.map((k) => (
        <button
          key={k.t}
          type="button"
          className={`calc-chip${k.t === t ? ' calc-chip-on' : ''}`}
          aria-pressed={k.t === t}
          title={k.hint}
          data-testid={`xform-${k.t}`}
          onClick={(e) => {
            e.stopPropagation()
            onPick(k.t)
          }}
        >
          {k.label}
        </button>
      ))}
    </div>
  )
}

/** The editor's working copy: a fresh default when the kind changes. */
function useOpDraft(initial: XformOp): [XformOp, (op: XformOp) => void, (t: XformOp['t']) => void] {
  const [draft, setDraft] = useState<XformOp>(initial)
  const pick = (t: XformOp['t']): void => setDraft(t === draft.t ? draft : t === initial.t ? initial : defaultOp(t))
  return [draft, setDraft, pick]
}

// ---------------------------------------------------------------------------
// Transform: make an image
// ---------------------------------------------------------------------------

export function TransformTool({
  figure,
  names,
  imageNo,
  onAddImage,
}: {
  /** "ABC", or null when the vertices have no names. */
  figure: string | null
  /** The vertex names (A, B, C … or A′, B′ …) the image will be primed from. */
  names: string[]
  /** Which image of this figure the next one is (2: A′₂B′₂C′₂). */
  imageNo?: number
  onAddImage(op: XformOp): string | null
}) {
  const [draft, setDraft, pick] = useOpDraft(defaultOp('rotate'))
  const [err, setErr] = useState<string | null>(null)
  const imageName = names.map((n) => siblingName(primeName(n), imageNo ?? 1)).join('')
  const typed = figure ?? 'ABC'
  const submit = (): void => setErr(onAddImage(draft))
  return (
    <CardSection
      kind="shape-transform"
      title="Transform"
      titleHint="Translate, reflect, rotate or dilate this figure; the image follows it"
      summary="translate · reflect · rotate · dilate"
      defaultOpen={false}
      testId="shape-transform"
    >
      <KindChips t={draft.t} onPick={(t) => { setErr(null); pick(t) }} />
      <OpEditor op={draft} onChange={(op) => { setErr(null); setDraft(op) }} onSubmit={submit} />
      <div className="calc-controls xform-row">
        <button type="button" className="calc-chip calc-chip-on xform-create" data-testid="xform-create" onClick={(e) => { e.stopPropagation(); submit() }}>
          Create {imageName || 'image'}
        </button>
      </div>
      {err && <div className="calc-why">{err}</div>}
      <div className="field-hint">
        The image is linked: drag a vertex here and it follows. Or type it in the + box —{' '}
        {draft.t === 'translate'
          ? `translate ${typed} by <3, -2>`
          : draft.t === 'reflect'
            ? `reflect ${typed} across y = x`
            : draft.t === 'rotate'
              ? `rotate ${typed} 90° about (0, 0)`
              : `dilate ${typed} by 1/2 about (1, 1)`}
        .
      </div>
    </CardSection>
  )
}

// ---------------------------------------------------------------------------
// Transformation: what an image is
// ---------------------------------------------------------------------------

function seqTex(list: readonly Motion[]): string {
  return sequenceName(list).tex
}

export function ImageSection({
  shapeId,
  report,
  xform,
  onSetOp,
  onSetAids,
}: {
  shapeId: string
  report: XformReport
  xform: ShapeXform
  onSetOp(op: XformOp): string | null
  onSetAids(aids: XformAid[]): void
}) {
  const k = shapeKey(shapeId, 'image')
  const [draft, setDraft, pick] = useOpDraft(xform.op)
  const [err, setErr] = useState<string | null>(null)
  const opKey = JSON.stringify(xform.op)
  useEffect(() => {
    setDraft(xform.op)
    setErr(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opKey])
  const dirty = JSON.stringify(draft) !== opKey
  const on = aidsOf(xform)
  const name = motionName(report.motion)
  const rule = motionRule(report.motion)
  return (
    <CardSection
      kind="shape-image"
      title="Transformation"
      titleHint="The image: its mapping rule, whether the motion is rigid, and what it preserves"
      summary={`${name.text}: ${rule.text}`}
      answerKey={k}
      testId="shape-image"
    >
      <div className="calc-fact calc-fact-lead">
        {report.imageName} is the image of {report.preName} under {report.words}.
      </div>
      <Answer k={k} block what="the mapping rule">
        <div className="calc-fact xform-rule">
          <Latex tex={`${name.tex}:\\ ${rule.tex}`} />
        </div>
        {!rule.exact && <div className="field-hint">Decimals: this angle has no exact cosine.</div>}
        <div className="calc-fact">{report.rigidText}</div>
        <div className="secant-block">
          <div className="secant-block-title">Image vertices</div>
          <div className="calc-fact calc-fact-lead xform-verts">
            {report.vertexTexts.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        </div>
        {report.chain && (
          <div className="secant-block">
            <div className="secant-block-title">From {report.chain.rootName}</div>
            <div className="calc-fact xform-rule">
              <Latex tex={`${report.chain.name.tex}:\\ ${report.chain.rule.tex}`} />
            </div>
            {report.chain.single && <div className="calc-fact">The whole sequence is {report.chain.single}.</div>}
          </div>
        )}
        <div className="secant-block">
          <div className="secant-block-title">Preserved?</div>
          <ul className="calc-facts xform-checks">
            {report.checks.map((c, i) => (
              <li key={i} className={`calc-fact xform-check${c.ok === false ? ' xform-check-bad' : ''}`}>
                <span className="xform-mark" aria-label={c.ok === null ? '' : c.ok ? 'holds' : 'fails'}>
                  {c.ok === null ? '•' : c.ok ? '✓' : '✗'}
                </span>{' '}
                {c.text}
              </li>
            ))}
          </ul>
        </div>
      </Answer>
      <div className="secant-block">
        <div className="secant-block-title">Edit the transformation</div>
        <KindChips t={draft.t} onPick={(t) => { setErr(null); pick(t) }} />
        <OpEditor op={draft} onChange={(op) => { setErr(null); setDraft(op) }} onSubmit={() => setErr(onSetOp(draft))} />
        {dirty && (
          <div className="calc-controls xform-row">
            <button type="button" className="calc-chip calc-chip-on" onClick={(e) => { e.stopPropagation(); setErr(onSetOp(draft)) }}>
              Update
            </button>
            <button type="button" className="calc-chip" onClick={(e) => { e.stopPropagation(); setDraft(xform.op); setErr(null) }}>
              Cancel
            </button>
          </div>
        )}
        {err && <div className="calc-why">{err}</div>}
      </div>
      <div className="measure-toggles" role="group" aria-label="Visual aids">
        <span className="measure-toggles-label">Show on board</span>
        {aidChoices(xform.op.t).map((a) => {
          const isOn = on.includes(a.aid)
          return (
            <button
              key={a.aid}
              type="button"
              className={`calc-chip${isOn ? ' calc-chip-on' : ''}`}
              aria-pressed={isOn}
              title={a.hint}
              data-testid={`xform-aid-${a.aid}`}
              onClick={(e) => {
                e.stopPropagation()
                onSetAids(isOn ? on.filter((x) => x !== a.aid) : [...on, a.aid])
              }}
            >
              {a.label}
            </button>
          )
        })}
      </div>
    </CardSection>
  )
}

// ---------------------------------------------------------------------------
// Symmetry
// ---------------------------------------------------------------------------

export function SymmetrySection({
  shapeId,
  report,
  on,
  onToggle,
}: {
  shapeId: string
  report: SymmetryReport
  on: boolean
  onToggle(): void
}) {
  const k = shapeKey(shapeId, 'symmetry')
  return (
    <CardSection
      kind="shape-symmetry"
      title="Symmetry"
      titleHint="The reflections and rotations that carry the figure onto itself"
      summary={report.summary}
      answerKey={k}
      defaultOpen={false}
      testId="shape-symmetry"
    >
      <div className="measure-toggles" role="group" aria-label="Symmetry overlay">
        <span className="measure-toggles-label">Show on board</span>
        <button
          type="button"
          className={`calc-chip${on ? ' calc-chip-on' : ''}`}
          aria-pressed={on}
          data-testid="shape-sym-toggle"
          title="Draw the lines of symmetry and state the rotation symmetry on the board"
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
        >
          Lines of symmetry
        </button>
      </div>
      <Answer k={k} block what="the symmetry">
        <div className="calc-fact measure-sentence">{report.sentence}</div>
        {report.lines.length > 0 && (
          <ul className="calc-facts">
            {report.lines.map((l, i) => (
              <li key={i} className="calc-fact">
                {l.equation}
                {l.via ? ` — ${l.via}` : ''}
              </li>
            ))}
          </ul>
        )}
      </Answer>
    </CardSection>
  )
}

// ---------------------------------------------------------------------------
// Compare two figures
// ---------------------------------------------------------------------------

export function CompareSection({
  shapeId,
  self,
  data,
  onCompare,
}: {
  shapeId: string
  /** "△ABC" */
  self: string
  data: CompareCardData
  onCompare(other: string | null): void
}) {
  const k = shapeKey(shapeId, 'compare')
  const r = data.result
  const verdict = r
    ? r.report.relation === 'congruent'
      ? `${self} ≅ ${data.withLabel}`
      : r.report.relation === 'similar'
        ? `${self} ~ ${data.withLabel}`
        : `not congruent or similar`
    : null
  return (
    <CardSection
      kind="shape-compare"
      title="Compare"
      titleHint="Congruent or similar? The rigid motion (or similarity) between two figures, and the criterion"
      summary={verdict}
      answerKey={k}
      defaultOpen={false}
      testId="shape-compare"
    >
      <div className="calc-controls">
        <label className="measure-toggles-label" htmlFor={`cmp-${shapeId}`}>
          Compare with
        </label>
        <select
          id={`cmp-${shapeId}`}
          className="calc-select"
          value={data.with ?? ''}
          onClick={stop}
          onChange={(e) => onCompare(e.target.value || null)}
        >
          <option value="">— choose a figure —</option>
          {data.choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      {data.empty && <div className="field-hint">{data.empty}</div>}
      {r && (
        <Answer k={k} block what="the comparison">
          <div className="calc-fact calc-fact-lead xform-verdict">
            {r.report.relation === 'congruent'
              ? `Congruent: ${verdict}`
              : r.report.relation === 'similar'
                ? `Similar: ${verdict} (scale factor ${r.report.scaleText})`
                : `Neither congruent nor similar`}
          </div>
          <div className="calc-fact">Correspondence: {r.correspondence}</div>
          <div className="calc-fact">{r.report.reason}</div>
          {r.report.relation !== 'neither' && (
            <div className="secant-block">
              <div className="secant-block-title">{r.report.relation === 'congruent' ? 'The rigid motion' : 'The similarity'}</div>
              <div className="calc-fact">
                {r.report.relation === 'congruent' && r.report.motions.length === 1 && r.report.motions[0].kind !== 'identity'
                  ? `One rigid motion maps ${self} onto ${data.withLabel}: ${motionWords(r.report.motions[0])}.`
                  : `${capital(r.report.words)}.`}
              </div>
              {r.report.rule && r.report.name && (
                <div className="calc-fact xform-rule">
                  <Latex tex={`${seqTex(r.report.motions)}:\\ ${r.report.rule.tex}`} />
                </div>
              )}
              {r.report.alternative && (
                <div className="calc-fact">
                  Or, as a sequence: {sequenceWords(r.report.alternative)}{' '}
                  <span className="xform-alt">
                    <Latex tex={seqTex(r.report.alternative)} />
                  </span>
                </div>
              )}
            </div>
          )}
          {r.triangle && (
            <div className="secant-block">
              <div className="secant-block-title">Triangle criteria</div>
              <div className="calc-fact measure-sentence">{r.triangle.sentence}</div>
              {(r.triangle.congruent ? r.triangle.criteria : r.triangle.simCriteria).map((c) => (
                <div key={c.name} className="calc-fact">
                  <strong>{c.name}</strong>: {c.parts.join('; ')}
                </div>
              ))}
              {r.triangle.ssa && <div className="calc-fact xform-check-bad">{r.triangle.ssa}</div>}
            </div>
          )}
          {!r.triangle && r.report.parts.length > 0 && (
            <div className="secant-block">
              <div className="secant-block-title">Corresponding parts</div>
              <ul className="calc-facts">
                {r.report.parts.map((p, i) => (
                  <li key={i} className="calc-fact">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Answer>
      )}
    </CardSection>
  )
}

const capital = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)
