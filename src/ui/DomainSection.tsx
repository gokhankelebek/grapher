// ============================================================================
// src/ui/DomainSection.tsx — the Domain, Range and One-to-one rows at the top
// of a card's Analysis table, and the tools that hang off them:
//
//   Domain       [0, ∞)                           ✎ restrict   x≥ / [ )
//                 (editor: [ lo , hi ) · Apply · Clear)
//   Range        [0, ∞)
//   One-to-one   No — fails at y = 1 (x = −1, 1)
//                 Make it one-to-one: (x ≥ 0) (x ≤ 0)
//   Board        [Show cut-off part] [Horizontal line test · 2 points …]
//   Inverse      f⁻¹(x) = √x
//                 [Show inverse] [Add f⁻¹(x) as a curve] [Reflect a point]
//
// Everything it prints arrives computed (App → domainLinks.DomainPanel); every
// change leaves through DomainActions. The only state kept here is the
// restriction being typed.
// ============================================================================

import { Answer } from './RevealAnswer'
import { domainKey, inverseKey, oneToOneKey, rangeKey } from './reveal'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Latex } from './Latex'
import type { BoundDraft, DomainActions, DomainPanel, RestrictDraft, SetNotation } from './domainLinks'
import {
  WHY_NO_DOMAIN,
  WHY_NO_ONE_TO_ONE,
  WHY_NO_RANGE,
  WHY_SKETCH_OPEN,
  draftOf,
  oneToOneText,
  partRestriction,
  readRestriction,
  setRowText,
} from './domainLinks'

interface Props {
  panel: DomainPanel
  actions: DomainActions
  notation: SetNotation
}

const DASH = '—'

/** One stated row: label, value (or "—" with the reason on hover). */
function Row({
  label,
  value,
  why,
  children,
  testId,
  answerKey,
}: {
  label: string
  value: string | null
  why: string
  children?: ReactNode
  testId: string
  /** Reveal mode: this row's value is an answer (src/ui/reveal.ts). */
  answerKey?: string
}) {
  const valueNode = (
    <span
      className={`an-value an-value-static dr-value${value === null ? ' dr-unknown' : ''}`}
      title={value === null ? why : undefined}
    >
      {value ?? DASH}
    </span>
  )
  return (
    <div className="an-row dr-row" data-testid={testId}>
      <span className="an-label">{label}</span>
      <span className="an-values dr-values">
        {answerKey && value !== null ? (
          <Answer k={answerKey} what={label.toLowerCase()}>
            {valueNode}
          </Answer>
        ) : (
          valueNode
        )}
        {children}
      </span>
    </div>
  )
}

export function DomainSection({ panel, actions, notation }: Props) {
  const [draft, setDraft] = useState<(RestrictDraft & { error: string | null }) | null>(null)
  const id = panel.ownerId
  const isFn = panel.role === 'function'
  const restrict = panel.restrict
  const sketch = restrict.kind === 'sketch'

  const domainText = setRowText(panel.domain, notation)
  const rangeText = setRowText(panel.range, notation)
  const other: SetNotation = notation === 'interval' ? 'builder' : 'interval'

  const open = (): void => setDraft({ ...draftOf(panel.current), error: null })
  const apply = (): void => {
    if (!draft) return
    const read = readRestriction(sketch ? closedDraft(draft) : draft)
    if (!read.ok) {
      setDraft({ ...draft, error: read.error })
      return
    }
    const err = actions.onRestrict(id, read.r.lo || read.r.hi ? read.r : null)
    if (err) setDraft({ ...draft, error: err })
    else setDraft(null)
  }
  const clear = (): void => {
    const err = actions.onRestrict(id, null)
    if (err && draft) setDraft({ ...draft, error: err })
    else setDraft(null)
  }

  const bound = (which: 'lo' | 'hi') => {
    if (!draft) return null
    const b: BoundDraft = draft[which]
    const set = (patch: Partial<BoundDraft>): void =>
      setDraft({ ...draft, [which]: { ...b, ...patch }, error: null })
    const blank = b.text.trim() === ''
    const glyph = which === 'lo' ? (b.closed && !blank ? '[' : '(') : b.closed && !blank ? ']' : ')'
    const toggle = (
      <button
        type="button"
        className={`calc-chip dr-bracket${b.closed && !blank ? ' calc-chip-on' : ''}`}
        disabled={sketch || blank}
        title={
          sketch
            ? WHY_SKETCH_OPEN
            : blank
              ? 'No bound on this side: the domain runs on to infinity, which is never included'
              : b.closed
                ? 'Included — click to leave this end out'
                : 'Left out — click to include this end'
        }
        aria-label={`${which === 'lo' ? 'Left' : 'Right'} end ${b.closed ? 'included' : 'excluded'}`}
        onClick={() => set({ closed: !b.closed })}
      >
        {glyph}
      </button>
    )
    const input = (
      <input
        className="calc-input dr-input"
        type="text"
        spellCheck={false}
        autoComplete="off"
        placeholder={which === 'lo' ? '−∞' : '∞'}
        aria-label={which === 'lo' ? 'Domain from' : 'Domain to'}
        value={b.text}
        onChange={(e) => set({ text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            apply()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setDraft(null)
          }
        }}
      />
    )
    return which === 'lo' ? (
      <>
        {toggle}
        {input}
      </>
    ) : (
      <>
        {input}
        {toggle}
      </>
    )
  }

  const restrictButton =
    isFn && restrict.kind !== 'none' ? (
      <button
        type="button"
        className={`calc-chip dr-restrict${draft ? ' calc-chip-on' : ''}`}
        data-testid="restrict-domain"
        title="Restrict the domain"
        onClick={() => (draft ? setDraft(null) : open())}
      >
        Restrict
      </button>
    ) : isFn && restrict.kind === 'none' ? (
      <button type="button" className="calc-chip dr-restrict" disabled title={restrict.why}>
        Restrict
      </button>
    ) : null

  const hlt = panel.hlt
  const inv = panel.inverse

  return (
    <div className="dr-block" data-testid="domain-section">
      <Row
        label={isFn ? 'Domain' : `Domain of ${panel.name}`}
        value={domainText}
        why={WHY_NO_DOMAIN}
        testId="domain-row"
        answerKey={domainKey(id)}
      >
        {restrictButton}
        <button
          type="button"
          className="calc-chip dr-notation"
          data-testid="set-notation"
          title={other === 'builder' ? 'Write as set-builder (x ≥ 0)' : 'Write in interval notation ([0, ∞))'}
          onClick={() => actions.onNotation(other)}
        >
          {other === 'builder' ? 'x ≥' : '[ , )'}
        </button>
      </Row>
      {draft && (
        <div className="dr-indent">
          <div className="dr-editor" data-testid="restrict-editor">
            <div className="calc-controls dr-bounds">
              {bound('lo')}
              <span className="dr-comma">,</span>
              {bound('hi')}
              <button
                type="button"
                className="calc-chip calc-chip-on"
                data-testid="restrict-apply"
                onClick={apply}
              >
                Apply
              </button>
              <button type="button" className="calc-chip" data-testid="restrict-clear" onClick={clear}>
                Clear
              </button>
            </div>
            <div className="dr-hint">
              {sketch
                ? 'A sketch keeps both ends. Leave a side blank to keep where it stops now.'
                : 'Exact values work: -pi/2, sqrt(2), 1/3. Blank means no bound.'}
            </div>
            {draft.error && <div className="expr-error">{draft.error}</div>}
          </div>
        </div>
      )}
      <Row
        label={isFn ? 'Range' : `Range of ${panel.name}`}
        value={rangeText}
        why={WHY_NO_RANGE}
        testId="range-row"
        answerKey={rangeKey(id)}
      />
      {isFn && (
        <Row
          label="One-to-one"
          value={oneToOneText(panel.oneToOne)}
          why={WHY_NO_ONE_TO_ONE}
          testId="one-to-one-row"
          answerKey={oneToOneKey(id)}
        />
      )}
      {isFn && panel.chips.length > 0 && restrict.kind !== 'none' && (
        <div className="dr-indent">
          <div className="dr-line" data-testid="one-to-one-chips">
            <span className="dr-lead">Make it one-to-one:</span>
            {panel.chips.map((c) => (
              <button
                type="button"
                key={c.label}
                className="calc-chip dr-chip"
                title={`Restrict the domain to ${c.label}`}
                onClick={() => {
                  setDraft(null)
                  actions.onRestrict(id, partRestriction(c.part))
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {isFn && (
        <div className="dr-indent">
          <div className="dr-line">
            {panel.restricted && (
              <button
                type="button"
                className={`calc-chip${panel.ghost ? ' calc-chip-on' : ''}`}
                data-testid="ghost-toggle"
                title="Draw the whole graph, faint and dashed, behind the restricted part"
                aria-pressed={panel.ghost}
                onClick={() => actions.onGhost(id, !panel.ghost)}
              >
                Show the cut-off part
              </button>
            )}
            <button
              type="button"
              className={`calc-chip${hlt ? ' calc-chip-on' : ''}`}
              data-testid="hlt-toggle"
              title="A horizontal line you can drag: a function is one-to-one when no such line meets it twice"
              aria-pressed={hlt !== null}
              onClick={() => actions.onHlt(id, hlt === null)}
            >
              Horizontal line test
            </button>
            {hlt && (
              <span
                className={`dr-verdict ${hlt.verdict.fails ? 'dr-fails' : 'dr-passes'}`}
                data-testid="hlt-verdict"
              >
                {hlt.verdict.chip}
              </span>
            )}
          </div>
        </div>
      )}
      {inv && (
        <div className="dr-inverse" data-testid="inverse-block">
          <div className="an-row">
            <span className="an-label">Inverse</span>
            <span className="an-values dr-values">
              {inv.latex ? (
                <Answer k={inverseKey(id)} what="the inverse">
                  <span className="dr-formula" title={inv.text ?? undefined} data-testid="inverse-formula">
                    <Latex tex={inv.latex} />
                  </span>
                </Answer>
              ) : (
                <span className="dr-why" data-testid="inverse-why">
                  {inv.why}
                </span>
              )}
            </span>
          </div>
          <div className="dr-indent">
            {inv.branch && <div className="dr-hint">{`on ${inv.branch}`}</div>}
            <div className="dr-line">
              {isFn && !inv.shown && (
                <button
                  type="button"
                  className="calc-chip"
                  data-testid="inverse-show"
                  onClick={() => actions.onShowInverse(id)}
                >
                  Show inverse
                </button>
              )}
              {inv.addLine && (
                <button
                  type="button"
                  className="calc-chip"
                  data-testid="inverse-add"
                  title={`Types ${inv.addLine} as a curve of its own`}
                  onClick={() => actions.onAddInverse(id)}
                >
                  {`Add ${panel.role === 'inverse' ? panel.name : `${panel.name}⁻¹`}(x) as a curve`}
                </button>
              )}
              {isFn && (
                <button
                  type="button"
                  className={`calc-chip${panel.reflect ? ' calc-chip-on' : ''}`}
                  data-testid="reflect-toggle"
                  aria-pressed={panel.reflect}
                  title="A point (a, f(a)) and its mirror image (f(a), a) across y = x — drag it along the curve"
                  onClick={() => actions.onReflect(id, !panel.reflect)}
                >
                  Reflect a point
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** A sketch's ends are always included. */
function closedDraft(d: RestrictDraft): RestrictDraft {
  return { lo: { ...d.lo, closed: true }, hi: { ...d.hi, closed: true } }
}
