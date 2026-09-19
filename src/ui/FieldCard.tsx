import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Latex } from './Latex'
import { ParamRow } from './CurveCard'
import { parseNumeric } from './numeric'
import { SPACING_CHOICES, coord } from './fieldLinks'
import type { BoardField, FieldCardData } from './fieldLinks'

// ============================================================================
// src/ui/FieldCard.tsx — a slope field in the sidebar list.
//
// It is in the SAME list as the curves, with the same colour dot, the same ⋯
// menu and the same click-to-edit equation, because on the board it is the
// same kind of thing: an object a teacher typed, can restyle, can hide and can
// throw away. The two differences are the two things a field actually has that
// a curve does not — a lattice spacing, and the list of points its solution
// curves are drawn through.
//
// Nothing here computes anything. The parser's LaTeX, the slider rows and the
// "through (0, 2)" lines all arrive already worked out (src/ui/fieldLinks.ts),
// so the card and the picture cannot disagree about what the field says.
// ============================================================================

interface Props {
  field: BoardField
  /** Everything this card prints, already computed. */
  data: FieldCardData
  selected: boolean
  /**
   * True while a click on the board will drop a solution curve for THIS field
   * — either because the card is selected or because its menu armed one.
   */
  arming: boolean
  onSelect(): void
  onDelete(): void
  onToggleVisible(): void
  onCycleColor(): void
  /** Arm a one-shot board click for a new initial condition. */
  onArmSolution(): void
  onSpacing(px: number): void
  onParamChange(index: number, value: number): void
  onParamEditStart(): void
  onParamEditEnd(): void
  onParamSetExact(index: number, value: number): void
  /**
   * Retype the differential equation. Returns the parser's own message to
   * show, or null when it was accepted and the editor should close.
   */
  onEquationCommit(src: string): string | null
  /** Type an exact initial condition. */
  onSolutionSet(solutionId: string, to: { x?: number; y?: number }): void
  onSolutionRemove(solutionId: string): void
}

export function FieldCard({
  field,
  data,
  selected,
  arming,
  onSelect,
  onDelete,
  onToggleVisible,
  onCycleColor,
  onArmSolution,
  onSpacing,
  onParamChange,
  onParamEditStart,
  onParamEditEnd,
  onParamSetExact,
  onEquationCommit,
  onSolutionSet,
  onSolutionRemove,
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
      void navigator.clipboard?.writeText(data.latex)
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

  // ---- the equation itself, click to edit
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

  // ---- one initial condition, click to type exactly
  //
  // Keyed "<solutionId>:x" / ":y" so exactly one field is open however many
  // solution curves the field carries.
  const [solEdit, setSolEdit] = useState<{ key: string; text: string; bad: boolean } | null>(null)
  const solInputRef = useRef<HTMLInputElement>(null)
  const solKey = solEdit?.key ?? null
  useEffect(() => {
    if (solKey) solInputRef.current?.select()
  }, [solKey])
  useEffect(() => {
    if (!selected && solEdit) setSolEdit(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const solNumber = (
    key: string,
    label: string,
    value: number,
    commit: (v: number) => void,
  ): JSX.Element => {
    if (solEdit?.key === key) {
      return (
        <span className="calc-field">
          <input
            ref={solInputRef}
            className={`calc-input field-sol-input${solEdit.bad ? ' param-edit-bad' : ''}`}
            type="text"
            inputMode="decimal"
            spellCheck={false}
            aria-label={label}
            value={solEdit.text}
            onChange={(e) => setSolEdit({ key, text: e.target.value, bad: false })}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                const v = parseNumeric(solEdit.text)
                if (v === null) {
                  setSolEdit({ ...solEdit, bad: true })
                  return
                }
                commit(v)
                setSolEdit(null)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setSolEdit(null)
              }
            }}
            onBlur={() => setSolEdit(null)}
          />
        </span>
      )
    }
    return (
      <button
        type="button"
        className="calc-field calc-field-btn field-sol-num"
        title={`Click to type an exact ${label}`}
        onClick={(e) => {
          e.stopPropagation()
          onSelect()
          setSolEdit({ key, text: String(value), bad: false })
        }}
      >
        <span className="calc-field-value">{coord(value)}</span>
      </button>
    )
  }

  return (
    <div
      className={`card field-card${selected ? ' card-selected' : ''}${
        field.visible ? '' : ' card-hidden'
      }${data.error ? ' card-broken-state' : ''}`}
      style={{ '--curve': field.color } as CSSProperties}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Slope field${field.visible ? '' : ', hidden'}`}
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
          style={{ background: field.color }}
          title="Change colour"
          aria-label="Change field colour"
          onClick={(e) => {
            e.stopPropagation()
            onCycleColor()
          }}
        />
        <span className="model-name">Slope field</span>
        {data.error && (
          <span className="err-badge err-badge-bad" title={data.error}>
            can’t draw
          </span>
        )}
        {!field.visible && <span className="card-flag">hidden</span>}

        <div className="card-menu-wrap" ref={menuRef}>
          <button
            ref={menuBtnRef}
            type="button"
            className={`card-menu-btn${menuOpen ? ' card-menu-btn-open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Field menu"
            title="More — add a solution curve, hide, delete, copy LaTeX, spacing"
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
              {menuItem('+ Solution through a point', onArmSolution)}
              {menuItem(field.visible ? 'Hide' : 'Show', onToggleVisible)}
              {menuItem(copied ? 'Copied' : 'Copy LaTeX', copyLatex)}
              {menuItem('Delete', onDelete, 'card-menu-danger')}
              <div className="card-menu-sep" />
              <div className="card-menu-title">Spacing</div>
              <div className="field-spacing card-menu-style" role="group" aria-label="Lattice spacing">
                {SPACING_CHOICES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`calc-chip${data.spacing === c.key ? ' calc-chip-on' : ''}`}
                    title={c.title}
                    aria-pressed={data.spacing === c.key}
                    onClick={() => onSpacing(c.px)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* The differential equation, on its own line, click to retype — exactly
          as a curve's equation is. */}
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
            aria-label="Differential equation"
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
            title="Click to edit this differential equation"
            onClick={(e) => {
              e.stopPropagation()
              onSelect()
              setEqEdit({ text: field.src, error: null })
            }}
          >
            {data.error ? (
              <code className="card-broken-src">{field.src}</code>
            ) : (
              <Latex tex={data.latex} className="card-latex" />
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

      {data.error && !eqEdit && (
        <div className="card-broken">
          <span className="card-broken-why">
            This differential equation can’t be read ({data.error}). Nothing is drawn for it —
            retype it to bring the field back.
          </span>
        </div>
      )}

      {selected && (
        <div className="card-body" onClick={(e) => e.stopPropagation()}>
          {data.params.length > 0 && (
            <div className="param-list">
              {data.params.map((p, i) => (
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

          <div className="field-section">
            <div className="an-title">Lattice</div>
            <div className="field-spacing" role="group" aria-label="Lattice spacing">
              {SPACING_CHOICES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={`calc-chip${data.spacing === c.key ? ' calc-chip-on' : ''}`}
                  title={c.title}
                  aria-pressed={data.spacing === c.key}
                  onClick={() => onSpacing(c.px)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* The solution curves. One compact line each: the point it goes
              through, both coordinates typeable, and the × that removes it. */}
          <div className="field-section">
            <div className="an-title">Solution curves</div>
            {data.solutions.length === 0 ? (
              <div className="field-hint">
                {arming
                  ? 'Click the board to draw the solution curve through that point.'
                  : 'Select this card and click the board to draw a solution curve.'}
              </div>
            ) : (
              <div className="calc-list">
                {data.solutions.map((s) => (
                  <div className="calc-line field-sol-row" key={s.id}>
                    <span className="calc-tag">through</span>
                    <span className="field-sol-pt">
                      (
                      {solNumber(`${s.id}:x`, 'x', s.x, (v) => onSolutionSet(s.id, { x: v }))}
                      <span className="calc-tag">,</span>
                      {solNumber(`${s.id}:y`, 'y', s.y, (v) => onSolutionSet(s.id, { y: v }))}
                      )
                    </span>
                    <button
                      type="button"
                      className="calc-drop"
                      title="Remove this solution curve"
                      aria-label={`Remove the solution curve ${s.text}`}
                      onClick={() => onSolutionRemove(s.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            {data.solutions.length > 0 && arming && (
              <div className="field-hint">Click the board for another one.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
