import { useEffect, useMemo, useRef, useState } from 'react'
import type { Vec2 } from '../core/types'
import type { Factor, FactoredSpec } from '../core/factored'
import { endBehaviour } from '../core/factored'
import { Latex } from './Latex'
import {
  MULT_MAX,
  MULT_MIN,
  applyFactorOp,
  blankSpec,
  commitFactorOp,
  evalText,
  factorPreview,
  rowBehaviour,
  safeRootsOf,
  specProblems,
  throughA,
} from './factorLinks'
import type { FactorOp, FactorSide, FieldProblem } from './factorLinks'
import { coord } from './fieldLinks'

// ============================================================================
// src/ui/FactorEditor.tsx — a function set by its ROOTS.
//
// Two places, one set of rows:
//
//   * FactorEditor, the "Build from roots" card at the top of the list (next
//     to the "+" equation box). A DRAFT: every keystroke is the spec, the
//     preview follows it, and nothing reaches the board until "Add to graph".
//   * RootsSection, on the card of any typed curve whose line reads back as
//     factors. COMMITTED: a field is an edit when it is entered (Enter or
//     leaving the field), a stepper click is an edit on its own — each one
//     undo entry, each one restating the curve in place.
//
// Both only ever produce an ordinary typed equation (src/core/factored.ts
// writes it), so everything downstream treats the result like anything else a
// teacher typed. The edits themselves are pure (src/ui/factorLinks.ts).
// ============================================================================

type Mode = 'draft' | 'commit'

function isBad(problems: readonly FieldProblem[], side: FactorSide | 'a', index: number, field: FieldProblem['field']): boolean {
  return problems.some((p) => p.side === side && p.index === index && p.field === field)
}

/**
 * One typed value. In a draft it IS the spec (controlled, every keystroke);
 * on a card it is a local draft that commits on Enter or blur, and refuses —
 * red, still open — a value that is not a number.
 */
function FactorField({
  value,
  mode,
  label,
  bad,
  className,
  inputRef,
  disabled,
  placeholder,
  onCommit,
}: {
  value: string
  mode: Mode
  label: string
  bad?: boolean
  className?: string
  inputRef?: (el: HTMLInputElement | null) => void
  disabled?: boolean
  placeholder?: string
  /** Returns a refusal to show (the field stays red), or null. */
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
    if (evalText(t) === null) {
      setRefused(true)
      return
    }
    const r = onCommit(t)
    setRefused(typeof r === 'string')
  }

  const draft = mode === 'draft'
  return (
    <input
      ref={inputRef}
      className={`calc-input fe-input${className ? ` ${className}` : ''}${
        bad || refused ? ' fe-input-bad' : ''
      }`}
      type="text"
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      aria-label={label}
      title={label}
      aria-invalid={bad || refused ? true : undefined}
      disabled={disabled}
      placeholder={placeholder}
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
        // A draft lets Enter and Esc reach the editor (add / close); a card's
        // field keeps its keys to itself.
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

/** − n + for one multiplicity. A click is one edit; typing commits like a field. */
function MultStepper({
  mult,
  mode,
  onOp,
}: {
  mult: number
  mode: Mode
  onOp(op: { kind: 'setMult'; mult: number } | { kind: 'stepMult'; delta: number }): void
}) {
  const [text, setText] = useState(String(mult))
  useEffect(() => setText(String(mult)), [mult])
  const commit = (t: string): void => {
    const n = Number(t)
    if (/^\d+$/.test(t.trim()) && n >= MULT_MIN && n <= MULT_MAX) {
      if (n !== mult) onOp({ kind: 'setMult', mult: n })
    } else setText(String(mult))
  }
  return (
    <span className="fe-mult" role="group" aria-label="Multiplicity" title="Multiplicity (1–9)">
      <button
        type="button"
        className="fe-step"
        aria-label="Lower multiplicity"
        disabled={mult <= MULT_MIN}
        onClick={(e) => {
          e.stopPropagation()
          onOp({ kind: 'stepMult', delta: -1 })
        }}
      >
        −
      </button>
      <input
        className="calc-input fe-mult-input"
        type="text"
        inputMode="numeric"
        aria-label="Multiplicity"
        value={text}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          setText(e.target.value)
          if (mode === 'draft' && /^[1-9]$/.test(e.target.value.trim())) {
            commit(e.target.value)
          }
        }}
        onKeyDown={(e) => {
          if (mode === 'commit') e.stopPropagation()
          if (e.key === 'Enter') {
            if (mode === 'commit') e.preventDefault()
            commit(text)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            onOp({ kind: 'stepMult', delta: 1 })
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            onOp({ kind: 'stepMult', delta: -1 })
          }
        }}
        onBlur={() => commit(text)}
      />
      <button
        type="button"
        className="fe-step"
        aria-label="Raise multiplicity"
        disabled={mult >= MULT_MAX}
        onClick={(e) => {
          e.stopPropagation()
          onOp({ kind: 'stepMult', delta: 1 })
        }}
      >
        +
      </button>
    </span>
  )
}

/** One list of factors — the numerator's or the denominator's. */
function FactorList({
  spec,
  side,
  title,
  mode,
  problems,
  onOp,
  firstRef,
}: {
  spec: FactoredSpec
  side: FactorSide
  title: string
  mode: Mode
  problems: readonly FieldProblem[]
  onOp(op: FactorOp): void
  firstRef?: (el: HTMLInputElement | null) => void
}) {
  const factors: Factor[] = side === 'num' ? spec.num : spec.den
  const roots = useMemo(() => safeRootsOf(spec), [spec])
  const where = side === 'num' ? 'numerator' : 'denominator'
  return (
    <div className="fe-list" data-side={side}>
      {title && <div className="fe-list-title">{title}</div>}
      {factors.length === 0 && (
        <div className="field-hint">
          {side === 'num' ? 'No roots — the function is the constant a.' : 'No factors.'}
        </div>
      )}
      {factors.map((f, index) => {
        const hint = rowBehaviour(spec, side, index, roots)
        return (
          <div className="fe-row" key={index} data-testid={`fe-row-${side}-${index}`}>
            {f.complex ? (
              <span className="fe-root fe-complex">
                <FactorField
                  value={f.complex.re}
                  mode={mode}
                  label={`Real part of a ${where} complex pair`}
                  bad={isBad(problems, side, index, 're')}
                  className="fe-input-part"
                  onCommit={(text) => onOp({ kind: 'setComplex', side, index, part: 're', text })}
                />
                <span className="calc-tag">±</span>
                <FactorField
                  value={f.complex.im}
                  mode={mode}
                  label={`Imaginary part of a ${where} complex pair`}
                  bad={isBad(problems, side, index, 'im')}
                  className="fe-input-part"
                  onCommit={(text) => onOp({ kind: 'setComplex', side, index, part: 'im', text })}
                />
                <span className="calc-tag">i</span>
              </span>
            ) : (
              <span className="fe-root">
                <span className="calc-tag">x =</span>
                <FactorField
                  value={f.root ?? ''}
                  mode={mode}
                  label={`${side === 'num' ? 'Root' : 'Denominator root'} ${index + 1}`}
                  bad={isBad(problems, side, index, 'root')}
                  inputRef={index === 0 ? firstRef : undefined}
                  onCommit={(text) => onOp({ kind: 'setRoot', side, index, root: text })}
                />
              </span>
            )}
            <MultStepper
              mult={f.mult}
              mode={mode}
              onOp={(op) =>
                onOp(
                  op.kind === 'setMult'
                    ? { kind: 'setMult', side, index, mult: op.mult }
                    : { kind: 'stepMult', side, index, delta: op.delta },
                )
              }
            />
            <span className={`fe-behaviour${hint ? '' : ' fe-behaviour-none'}`}>{hint ?? ''}</span>
            <button
              type="button"
              className="calc-drop fe-drop"
              title={`Remove this ${side === 'num' ? 'root' : 'factor'}`}
              aria-label={`Remove this ${side === 'num' ? 'root' : 'factor'}`}
              onClick={(e) => {
                e.stopPropagation()
                onOp({ kind: 'remove', side, index })
              }}
            >
              ×
            </button>
          </div>
        )
      })}
      <div className="fe-adds">
        <button
          type="button"
          className="calc-chip fe-add"
          onClick={(e) => {
            e.stopPropagation()
            onOp({ kind: 'addRoot', side })
          }}
        >
          + root
        </button>
        <button
          type="button"
          className="calc-chip fe-add"
          title="An irreducible quadratic factor: no real root"
          onClick={(e) => {
            e.stopPropagation()
            onOp({ kind: 'addComplex', side })
          }}
        >
          + complex pair a ± bi
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// the "Build from roots" card
// ============================================================================

interface EditorProps {
  /**
   * Put it on the board. `through` is the point it was defined through, if
   * any, so the board can keep the promise when a root is later dragged.
   * Returns an error to show, or null (the editor then closes).
   */
  onBuild(spec: FactoredSpec, through: Vec2 | null): string | null
  onClose(): void
  /** Start from this spec instead of a = 1 and one root at 0 (tests). */
  initial?: FactoredSpec
  /** Start with the through-point fields filled (tests). */
  initialThrough?: { x: string; y: string }
}

export function FactorEditor({ onBuild, onClose, initial, initialThrough }: EditorProps) {
  const [spec, setSpec] = useState<FactoredSpec>(() => initial ?? blankSpec())
  const [through, setThrough] = useState<{ x: string; y: string }>(
    () => initialThrough ?? { x: '', y: '' },
  )
  const [buildError, setBuildError] = useState<string | null>(null)
  const firstRootRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    firstRootRef.current?.focus()
    firstRootRef.current?.select()
  }, [])

  // "or through point ( , )": both numbers typed = a is solved, not typed.
  const tx = through.x.trim() === '' ? null : evalText(through.x)
  const ty = through.y.trim() === '' ? null : evalText(through.y)
  const throughOn = through.x.trim() !== '' || through.y.trim() !== ''
  const point: Vec2 | null = tx !== null && ty !== null ? { x: tx, y: ty } : null
  const solvedA = point ? throughA(spec, point) : null
  const effective: FactoredSpec = solvedA !== null ? { ...spec, a: solvedA } : spec

  const problems = specProblems(effective)
  const preview = factorPreview(effective)
  let error = preview.error
  if (!error && throughOn) {
    if (!point) error = 'Type both coordinates of the point, or clear them to type a.'
    else if (solvedA === null)
      error = `No leading coefficient sends it through (${coord(point.x)}, ${coord(point.y)}) — that point is a root or a pole.`
  }
  const canBuild = !error && preview.src !== null

  const op = (o: FactorOp): void => {
    setBuildError(null)
    setSpec((s) => applyFactorOp(s, o))
  }

  const build = (): void => {
    if (!canBuild) return
    const err = onBuild(effective, point)
    if (err) setBuildError(err)
  }

  const rational = spec.den.length > 0

  return (
    <div
      className="expr-card fe-card"
      data-testid="factor-editor"
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
        <span className="fe-title">Build from roots</span>
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

      <div className="fe-a-row">
        <span className="calc-tag">a =</span>
        <FactorField
          value={throughOn && solvedA !== null ? solvedA : spec.a}
          mode="draft"
          label="Leading coefficient a"
          bad={!throughOn && isBad(problems, 'a', 0, 'a')}
          disabled={throughOn}
          onCommit={(a) => op({ kind: 'setA', a })}
        />
        <span className="fe-or">
          <span className="calc-tag">or through</span>
          <span className="field-sol-pt fe-through">
            (
            <FactorField
              value={through.x}
              mode="draft"
              label="Through point x"
              placeholder="x"
              className="fe-input-part"
              bad={through.x.trim() !== '' && tx === null}
              onCommit={(x) => setThrough((t) => ({ ...t, x }))}
            />
            <span className="calc-tag">,</span>
            <FactorField
              value={through.y}
              mode="draft"
              label="Through point y"
              placeholder="y"
              className="fe-input-part"
              bad={through.y.trim() !== '' && ty === null}
              onCommit={(y) => setThrough((t) => ({ ...t, y }))}
            />
            )
          </span>
        </span>
      </div>

      <FactorList
        spec={effective}
        side="num"
        title={rational ? 'Numerator roots' : 'Roots'}
        mode="draft"
        problems={problems}
        onOp={op}
        firstRef={(el) => {
          firstRootRef.current = el
        }}
      />

      {rational ? (
        <>
          <FactorList
            spec={effective}
            side="den"
            title="Denominator roots"
            mode="draft"
            problems={problems}
            onOp={op}
          />
          <button
            type="button"
            className="fe-link"
            onClick={() => op({ kind: 'toggleRational' })}
          >
            Make it a polynomial
          </button>
        </>
      ) : (
        <button
          type="button"
          className="calc-chip fe-add fe-rational"
          onClick={() => op({ kind: 'toggleRational' })}
        >
          + Make it rational
        </button>
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
      {preview.end && <div className="fe-end">{preview.end}</div>}
      {(error || buildError) && <div className="expr-error">{buildError ?? error}</div>}

      <div className="fe-actions">
        <span className="expr-hint">Enter adds · Esc closes</span>
        <button
          type="button"
          className="fe-build"
          disabled={!canBuild}
          onClick={build}
        >
          Add to graph
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// the Roots section on a typed curve's card
// ============================================================================

interface SectionProps {
  spec: FactoredSpec
  /** The point this curve was defined through, when it was. */
  through?: Vec2 | null
  /** Rewrite the curve's line in place. Error message, or null. */
  onRestate(src: string, label: string): string | null
  /** Forget the through-a-point promise (typing a by hand ends it). */
  onDropThrough?(): void
}

export function RootsSection({ spec, through, onRestate, onDropThrough }: SectionProps) {
  const [open, setOpen] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // A new spec is a new line: whatever was refused about the old one is moot.
  useEffect(() => setError(null), [spec])

  const op = (o: FactorOp): string | null => {
    const err = commitFactorOp(spec, o, {
      through,
      restate: onRestate,
      dropThrough: onDropThrough,
    })
    setError(err)
    return err
  }

  let end = ''
  try {
    end = endBehaviour(spec)
  } catch {
    end = ''
  }
  const rational = spec.den.length > 0

  return (
    <div className="field-section fe-section" data-testid="roots-section">
      <button
        type="button"
        className="an-title fe-toggle"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        Roots <span className="fe-caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          <div className="fe-a-row">
            <span className="calc-tag">a =</span>
            <FactorField
              value={spec.a}
              mode="commit"
              label="Leading coefficient a"
              onCommit={(a) => op({ kind: 'setA', a })}
            />
            {through && (
              <span
                className="calc-chip fe-through-chip"
                title="a is re-solved on every edit so the curve keeps passing through this point. Typing a ends it."
              >
                through ({coord(through.x)}, {coord(through.y)})
                {onDropThrough && (
                  <button
                    type="button"
                    className="fe-chip-x"
                    aria-label="Stop keeping the point"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDropThrough()
                    }}
                  >
                    ×
                  </button>
                )}
              </span>
            )}
          </div>
          <FactorList
            spec={spec}
            side="num"
            title={rational ? 'Numerator' : ''}
            mode="commit"
            problems={[]}
            onOp={op}
          />
          {rational ? (
            <>
              <FactorList
                spec={spec}
                side="den"
                title="Denominator"
                mode="commit"
                problems={[]}
                onOp={op}
              />
              <button
                type="button"
                className="fe-link"
                onClick={(e) => {
                  e.stopPropagation()
                  op({ kind: 'toggleRational' })
                }}
              >
                Make it a polynomial
              </button>
            </>
          ) : (
            <button
              type="button"
              className="calc-chip fe-add fe-rational"
              onClick={(e) => {
                e.stopPropagation()
                op({ kind: 'toggleRational' })
              }}
            >
              + Make it rational
            </button>
          )}
          {end && <div className="fe-end">{end}</div>}
          {error && <div className="expr-error">{error}</div>}
          <div className="field-hint">
            Drag a root along the x-axis on the board, or type it here.
          </div>
        </>
      )}
    </div>
  )
}
