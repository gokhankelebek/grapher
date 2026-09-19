import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Latex } from './Latex'
import { ParamRow } from './CurveCard'
import { parseNumeric } from './numeric'
import { coord } from './fieldLinks'
import type { BoardShape, ShapeCardData } from './shapeLinks'

// ============================================================================
// src/ui/ShapeCard.tsx — a point, segment, vector or polygon in the sidebar.
//
// In the SAME list as the curves and the slope fields, with the same colour
// dot, the same ⋯ menu and the same click-to-edit line, because on the board
// it is the same kind of thing: an object a teacher typed, can restyle, can
// hide and can throw away.
//
// The one thing a shape has that nothing else on this board has is a list of
// COORDINATES that are also the object itself. A curve's params are
// coefficients; a triangle's vertices ARE the triangle, they are what a class
// reads off the board, and they are the thing a finger moves. So they get
// their own compact line each, typeable, and the card is honest about the
// consequence: typing a number into a coordinate written `a` replaces that
// coordinate's text with the number, which is exactly what dragging the vertex
// does. One rule, said once, in the tooltip on the value.
//
// Nothing here computes anything. The LaTeX, the slider rows and the vertex
// coordinates all arrive already worked out (src/ui/shapeLinks.ts), so the
// card and the picture cannot disagree about where a corner is.
// ============================================================================

interface Props {
  shape: BoardShape
  /** Everything this card prints, already computed. */
  data: ShapeCardData
  selected: boolean
  onSelect(): void
  onDelete(): void
  onToggleVisible(): void
  onCycleColor(): void
  onToggleFill(): void
  onParamChange(index: number, value: number): void
  onParamEditStart(): void
  onParamEditEnd(): void
  onParamSetExact(index: number, value: number): void
  /**
   * Retype the whole shape. Returns the parser's own message to show, or null
   * when it was accepted and the editor should close.
   */
  onEquationCommit(src: string): string | null
  /** Type one exact coordinate; it replaces that coordinate's source text. */
  onCoordSet(pair: number, axis: 'x' | 'y', value: number): void
}

export function ShapeCard({
  shape,
  data,
  selected,
  onSelect,
  onDelete,
  onToggleVisible,
  onCycleColor,
  onToggleFill,
  onParamChange,
  onParamEditStart,
  onParamEditEnd,
  onParamSetExact,
  onEquationCommit,
  onCoordSet,
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

  // ---- the line itself, click to retype
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

  // ---- one coordinate, click to type exactly
  //
  // Keyed "<pair>:x" / ":y" so exactly one field is open however many vertices
  // the shape has.
  const [cEdit, setCEdit] = useState<{ key: string; text: string; bad: boolean } | null>(null)
  const cInputRef = useRef<HTMLInputElement>(null)
  const cKey = cEdit?.key ?? null
  useEffect(() => {
    if (cKey) cInputRef.current?.select()
  }, [cKey])
  useEffect(() => {
    if (!selected && cEdit) setCEdit(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const coordField = (
    pair: number,
    axis: 'x' | 'y',
    label: string,
    value: number,
    src: string,
    isExpr: boolean,
  ): JSX.Element => {
    const key = `${pair}:${axis}`
    if (cEdit?.key === key) {
      return (
        <span className="calc-field">
          <input
            ref={cInputRef}
            className={`calc-input field-sol-input${cEdit.bad ? ' param-edit-bad' : ''}`}
            type="text"
            inputMode="decimal"
            spellCheck={false}
            aria-label={`${label} ${axis}`}
            value={cEdit.text}
            onChange={(e) => setCEdit({ key, text: e.target.value, bad: false })}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                const v = parseNumeric(cEdit.text)
                if (v === null) {
                  setCEdit({ ...cEdit, bad: true })
                  return
                }
                onCoordSet(pair, axis, v)
                setCEdit(null)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setCEdit(null)
              }
            }}
            onBlur={() => setCEdit(null)}
          />
        </span>
      )
    }
    return (
      <button
        type="button"
        className={`calc-field calc-field-btn field-sol-num${isExpr ? ' shape-coord-expr' : ''}`}
        title={
          isExpr
            ? `This coordinate is written “${src}”. Typing a number here — or dragging the vertex — replaces that text with the number.`
            : 'Click to type an exact value. Dragging the vertex writes it here too.'
        }
        onClick={(e) => {
          e.stopPropagation()
          onSelect()
          setCEdit({ key, text: String(value), bad: false })
        }}
      >
        <span className="calc-field-value">{coord(value)}</span>
      </button>
    )
  }

  return (
    <div
      className={`card field-card shape-card${selected ? ' card-selected' : ''}${
        shape.visible ? '' : ' card-hidden'
      }${data.error ? ' card-broken-state' : ''}`}
      style={{ '--curve': shape.color } as CSSProperties}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${data.noun}${shape.visible ? '' : ', hidden'}`}
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
          style={{ background: shape.color }}
          title="Change colour"
          aria-label="Change shape colour"
          onClick={(e) => {
            e.stopPropagation()
            onCycleColor()
          }}
        />
        <span className="model-name">{data.noun}</span>
        {data.error && (
          <span className="err-badge err-badge-bad" title={data.error}>
            can’t draw
          </span>
        )}
        {!shape.visible && <span className="card-flag">hidden</span>}

        <div className="card-menu-wrap" ref={menuRef}>
          <button
            ref={menuBtnRef}
            type="button"
            className={`card-menu-btn${menuOpen ? ' card-menu-btn-open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Shape menu"
            title="More — hide, copy LaTeX, delete"
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
              {menuItem(shape.visible ? 'Hide' : 'Show', onToggleVisible)}
              {menuItem(copied ? 'Copied' : 'Copy LaTeX', copyLatex)}
              {data.fillable &&
                menuItem(data.fill ? 'Unfill' : 'Fill', onToggleFill)}
              {menuItem('Delete', onDelete, 'card-menu-danger')}
            </div>
          )}
        </div>
      </div>

      {/* The shape as it was typed, on its own line, click to retype —
          exactly as a curve's equation is. */}
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
            aria-label="Shape"
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
            title="Click to retype this shape"
            onClick={(e) => {
              e.stopPropagation()
              onSelect()
              setEqEdit({ text: shape.src, error: null })
            }}
          >
            {data.error ? (
              <code className="card-broken-src">{shape.src}</code>
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
            This shape can’t be read ({data.error}). Nothing is drawn for it — retype it to bring
            it back.
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

          {data.vertices.length > 0 && (
            <div className="field-section">
              <div className="an-title">
                {data.kind === 'point' ? 'Coordinates' : 'Vertices'}
              </div>
              <div className="calc-list">
                {data.vertices.map((v) => (
                  <div className="calc-line field-sol-row shape-vertex-row" key={v.key}>
                    {v.label && <span className="calc-tag shape-vertex-name">{v.label}</span>}
                    <span className="field-sol-pt">
                      (
                      {coordField(v.pair, 'x', v.label || 'vertex', v.x, v.xSrc, v.xExpr)}
                      <span className="calc-tag">,</span>
                      {coordField(v.pair, 'y', v.label || 'vertex', v.y, v.ySrc, v.yExpr)}
                      )
                    </span>
                  </div>
                ))}
              </div>
              <div className="field-hint">
                Drag a vertex on the board, or type here. Either way a coordinate written as a
                constant becomes the number.
              </div>
            </div>
          )}

          {data.fillable && (
            <div className="field-section">
              <div className="an-title">Interior</div>
              <div className="field-spacing" role="group" aria-label="Polygon fill">
                <button
                  type="button"
                  className={`calc-chip${data.fill ? ' calc-chip-on' : ''}`}
                  aria-pressed={data.fill}
                  data-testid="shape-fill"
                  title="Paint the inside of the polygon"
                  onClick={onToggleFill}
                >
                  {data.fill ? 'Filled' : 'Unfilled'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
