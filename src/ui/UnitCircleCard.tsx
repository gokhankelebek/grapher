import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Answer, AnswerText, RevealPill, useReveal } from './RevealAnswer'
import { ucKey } from './reveal'
import { CardSection } from './CardSection'
import type { BoardUnitCircle, UnitCircleCardData, UnitCircleShow, PlaySpeed } from './unitCircleLinks'
import { PLAY_SPEEDS, invValueText } from './unitCircleLinks'
import type { InvFn, UnwrapFn } from '../core/trig'
import { parseAngle, parseTrigValue, specialIndex, specialRows } from '../core/trig'

// ============================================================================
// src/ui/UnitCircleCard.tsx — the unit circle in the sidebar list.
//
// In the same list as the curves, the fields and the sequences, with the same
// colour dot and ⋯ menu, because on the board it is the same kind of object:
// something the teacher put there, can recolour, hide and throw away.
//
//   ANGLE     θ typed exactly (5pi/6, -pi/4, 150°), radians / degrees, Play
//             with its speed, the reference angle, the quadrant, coterminals
//   VALUES    sin(5π/6) = 1/2 … exact on the π/12 lattice; csc, sec, cot too
//   SHOW      reference triangle, reference angle, ASTC, tan θ, and which
//             graph unwraps to the right (none / sin / cos / tan)
//   INVERSE   sin⁻¹, cos⁻¹, tan⁻¹ of a value: the principal answer, the range
//             statement, and the other solution (greyed on the board)
//   SPECIAL ANGLES   the 16-angle chart; a row click puts θ there
//
// Nothing here computes anything: every string arrives from
// src/ui/unitCircleLinks.ts, the same strings the board draws.
// ============================================================================

interface Props {
  uc: BoardUnitCircle
  card: UnitCircleCardData
  selected: boolean
  playing: boolean
  speed: PlaySpeed
  onSelect(): void
  onDelete(): void
  onToggleVisible(): void
  onCycleColor(): void
  onZoom(): void
  onTheta(theta: number): void
  onDeg(deg: boolean): void
  onShow(patch: Partial<UnitCircleShow>): void
  onUnwrap(fn: UnwrapFn | null): void
  /** Ask an inverse question (θ moves to its principal answer), or clear it. */
  onInverse(inv: { fn: InvFn; v: number } | null): void
  onPlay(playing: boolean): void
  onSpeed(speed: PlaySpeed): void
}

const SUP = '⁻¹'
const ROWS = specialRows()

export function UnitCircleCard({
  uc,
  card,
  selected,
  playing,
  speed,
  onSelect,
  onDelete,
  onToggleVisible,
  onCycleColor,
  onZoom,
  onTheta,
  onDeg,
  onShow,
  onUnwrap,
  onInverse,
  onPlay,
  onSpeed,
}: Props) {
  /** Reveal mode: this circle's exact values are one answer (src/ui/reveal.ts). */
  const revealApi = useReveal()
  const ak = ucKey(uc.id)
  const deg = uc.deg === true
  const visible = uc.hidden !== true

  // ---- the ⋯ menu (identical behaviour to a curve's, deliberately)
  const [menuOpen, setMenuOpen] = useState(false)
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

  // ---- θ, typed exactly
  const [thetaEdit, setThetaEdit] = useState<{ text: string; error: string | null } | null>(null)
  const commitTheta = (): void => {
    if (!thetaEdit) return
    const v = parseAngle(thetaEdit.text, deg)
    if (v === null) {
      setThetaEdit({
        ...thetaEdit,
        error: deg ? 'Type an angle like 150°, -45 or 5pi/6.' : 'Type an angle like 5pi/6, -pi/4 or 150°.',
      })
      return
    }
    setThetaEdit(null)
    onTheta(v)
  }

  // ---- the inverse question
  const [invFn, setInvFn] = useState<InvFn>(uc.inv?.fn ?? 'sin')
  const [invText, setInvText] = useState<string>(uc.inv ? invValueText(uc.inv.v) : '1/2')
  const [invError, setInvError] = useState<string | null>(null)
  useEffect(() => {
    if (uc.inv) {
      setInvFn(uc.inv.fn)
      setInvText(invValueText(uc.inv.v))
    }
  }, [uc.inv])
  const askInverse = (fn: InvFn = invFn, text: string = invText): void => {
    const v = parseTrigValue(text)
    if (v === null) {
      setInvError('Type a value like 1/2, -√3/2, sqrt(2)/2 or -1.')
      return
    }
    if ((fn === 'sin' || fn === 'cos') && Math.abs(v) > 1 + 1e-12) {
      setInvError(`${fn}${SUP} only takes values from −1 to 1.`)
      return
    }
    setInvError(null)
    onInverse({ fn, v })
  }

  const stop = (e: { stopPropagation(): void }): void => e.stopPropagation()
  const k = specialIndex(uc.theta)
  const currentK = k === null ? null : ((k % 24) + 24) % 24

  const check = (key: keyof UnitCircleShow, label: string, title: string): JSX.Element => (
    <label className="te-check" title={title} onClick={stop}>
      <input
        type="checkbox"
        checked={uc.show[key]}
        data-testid={`uc-show-${key}`}
        onChange={() => onShow({ [key]: !uc.show[key] } as Partial<UnitCircleShow>)}
      />
      <span>{label}</span>
    </label>
  )

  return (
    <div
      className={`card field-card uc-card${selected ? ' card-selected' : ''}${visible ? '' : ' card-hidden'}`}
      style={{ '--curve': uc.color } as CSSProperties}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Unit circle${visible ? '' : ', hidden'}`}
      data-testid="uc-card"
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
          style={{ background: uc.color }}
          title="Change colour"
          aria-label="Change unit circle colour"
          onClick={(e) => {
            e.stopPropagation()
            onCycleColor()
          }}
        />
        <span className="model-name">Unit circle</span>
        {!visible && <span className="card-flag">hidden</span>}
        <div className="card-menu-wrap" ref={menuRef}>
          <button
            ref={menuBtnRef}
            type="button"
            className={`card-menu-btn${menuOpen ? ' card-menu-btn-open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Unit circle menu"
            title="More — hide, zoom to the circle, delete"
            onClick={(e) => {
              e.stopPropagation()
              onSelect()
              setMenuOpen((o) => !o)
            }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="card-menu" role="menu" onClick={stop}>
              {menuItem(visible ? 'Hide' : 'Show', onToggleVisible)}
              {menuItem('Zoom to circle', onZoom)}
              {menuItem('Delete', onDelete, 'card-menu-danger')}
            </div>
          )}
        </div>
      </div>

      <div className="uc-summary" data-testid="uc-summary">
        {revealApi.hidden(ak) && card.summary.includes(' · ') ? (
          <>
            {`${card.summary.split(' · ')[0]} · `}
            <RevealPill k={ak} what="the exact values" />
          </>
        ) : (
          <Answer k={ak}>{card.summary}</Answer>
        )}
      </div>

      {selected && (
        <div className="card-body card-body-sections" onClick={stop}>
          <CardSection kind="uc-angle" title="Angle" summary={`θ = ${card.thetaText}`}>
            <div className="fe-a-row uc-theta-row">
              <span className="calc-tag">θ =</span>
              <input
                className={`calc-input uc-theta-input${thetaEdit?.error ? ' fe-input-bad' : ''}`}
                type="text"
                spellCheck={false}
                autoComplete="off"
                aria-label="θ"
                data-testid="uc-theta"
                value={thetaEdit ? thetaEdit.text : card.thetaText}
                onFocus={(e) => {
                  setThetaEdit({ text: card.thetaText, error: null })
                  e.currentTarget.select()
                }}
                onClick={stop}
                onChange={(e) => setThetaEdit({ text: e.target.value, error: null })}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitTheta()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setThetaEdit(null)
                    e.currentTarget.blur()
                  }
                }}
                onBlur={() => {
                  if (thetaEdit && !thetaEdit.error && thetaEdit.text.trim() !== card.thetaText) commitTheta()
                  else setThetaEdit(null)
                }}
              />
              <div className="seg uc-unit" role="group" aria-label="Angle unit">
                {([false, true] as const).map((d) => (
                  <button
                    key={String(d)}
                    type="button"
                    className={`seg-btn${deg === d ? ' seg-on' : ''}`}
                    aria-pressed={deg === d}
                    data-testid={d ? 'uc-deg' : 'uc-rad'}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (deg !== d) onDeg(d)
                    }}
                  >
                    {d ? 'deg' : 'rad'}
                  </button>
                ))}
              </div>
            </div>
            {thetaEdit?.error && <div className="expr-error">{thetaEdit.error}</div>}
            <div className="mo-player uc-player">
              <button
                type="button"
                className="calc-chip mo-play"
                data-testid="uc-play"
                aria-label={playing ? 'Pause' : 'Play'}
                title={playing ? 'Pause' : 'Play: sweep θ from 0 to 2π, unwrapping the graph as it goes'}
                onClick={(e) => {
                  e.stopPropagation()
                  onPlay(!playing)
                }}
              >
                {playing ? '⏸' : '▶'}
              </button>
              <span className="field-hint uc-play-note">0 → {deg ? '360°' : '2π'}</span>
              <div className="seg mo-speed" role="group" aria-label="Speed">
                {PLAY_SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`seg-btn${speed === s ? ' seg-on' : ''}`}
                    aria-pressed={speed === s}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSpeed(s)
                    }}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>
            <Answer k={ak} block quiet>
            <div className="uc-facts" data-testid="uc-facts">
              <div>
                <span className="uc-k">{card.thetaText}</span> = {card.thetaAlt}
              </div>
              <div>
                Reference angle <span className="uc-k">{card.refText}</span> · {card.quadrant}
              </div>
              <div className="uc-dim">{card.signs}</div>
              <div>
                Coterminal: <span className="uc-k">{card.coterminal}</span>
                {card.principal && (
                  <>
                    {' '}
                    · in one turn <span className="uc-k">{card.principal}</span>
                  </>
                )}
              </div>
            </div>
            </Answer>
          </CardSection>

          <CardSection
            kind="uc-values"
            title="Values"
            summary={card.lines.map((l) => l.text).join(' · ')}
            answerKey={ak}
          >
            <div className="uc-values" data-testid="uc-values">
              {card.lines.map((l) => (
                <div key={l.fn} className={`uc-value uc-v-${l.fn}`}>
                  <AnswerText k={ak} text={l.text} what={l.fn} />
                </div>
              ))}
              {uc.show.recip &&
                card.recip.map((l) => (
                  <div key={l.fn} className="uc-value uc-v-recip">
                    <AnswerText k={ak} text={l.text} what={l.fn} />
                  </div>
                ))}
            </div>
            <div className="uc-toggles">{check('recip', 'csc, sec, cot', 'The reciprocal functions too')}</div>
          </CardSection>

          <CardSection kind="uc-show" title="Show" summary={uc.unwrap ? `unwrap ${uc.unwrap}` : null}>
            <div className="uc-toggles">
              {check('triangle', 'reference triangle', 'The legs cos θ and sin θ, labelled')}
              {check('ref', 'reference angle θ′', 'The acute angle to the x-axis')}
              {check('astc', 'ASTC signs', 'All Students Take Calculus: which functions are positive in each quadrant')}
              {check('tan', 'tan θ on x = 1', 'The tangent segment from (1, 0) to (1, tan θ)')}
            </div>
            <div className="fe-a-row uc-unwrap-row">
              <span className="calc-tag">Unwrap</span>
              <div className="seg" role="group" aria-label="Unwrap a graph">
                {([null, 'sin', 'cos', 'tan'] as const).map((fn) => (
                  <button
                    key={fn ?? 'none'}
                    type="button"
                    className={`seg-btn${(uc.unwrap ?? null) === fn ? ' seg-on' : ''}`}
                    aria-pressed={(uc.unwrap ?? null) === fn}
                    data-testid={`uc-unwrap-${fn ?? 'none'}`}
                    title={fn ? `Unwrap the circle into y = ${fn} x to its right` : 'No graph'}
                    onClick={(e) => {
                      e.stopPropagation()
                      onUnwrap(fn)
                    }}
                  >
                    {fn ?? 'none'}
                  </button>
                ))}
              </div>
            </div>
          </CardSection>

          <CardSection
            kind="uc-inverse"
            title="Inverse"
            defaultOpen={false}
            summary={card.inv && card.inv.ok ? `${card.inv.question} = ${card.inv.answer}` : null}
            answerKey={ak}
            actions={
              uc.inv ? (
                <button
                  type="button"
                  className="calc-drop"
                  title="Clear the inverse question"
                  aria-label="Clear the inverse question"
                  onClick={(e) => {
                    e.stopPropagation()
                    onInverse(null)
                  }}
                >
                  ×
                </button>
              ) : null
            }
          >
            <div className="fe-a-row uc-inv-row">
              <div className="seg" role="group" aria-label="Inverse function">
                {(['sin', 'cos', 'tan'] as const).map((fn) => (
                  <button
                    key={fn}
                    type="button"
                    className={`seg-btn${invFn === fn ? ' seg-on' : ''}`}
                    aria-pressed={invFn === fn}
                    data-testid={`uc-inv-${fn}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setInvFn(fn)
                      if (uc.inv) askInverse(fn)
                    }}
                  >
                    {fn}
                    {SUP}
                  </button>
                ))}
              </div>
              <span className="calc-tag">(</span>
              <input
                className={`calc-input uc-inv-input${invError ? ' fe-input-bad' : ''}`}
                type="text"
                spellCheck={false}
                autoComplete="off"
                aria-label="Value"
                data-testid="uc-inv-value"
                value={invText}
                onClick={stop}
                onChange={(e) => {
                  setInvText(e.target.value)
                  setInvError(null)
                }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    askInverse()
                  }
                }}
              />
              <span className="calc-tag">)</span>
              <button
                type="button"
                className="calc-chip"
                data-testid="uc-inv-go"
                onClick={(e) => {
                  e.stopPropagation()
                  askInverse()
                }}
              >
                Find θ
              </button>
            </div>
            {invError && <div className="expr-error">{invError}</div>}
            {card.inv && !card.inv.ok && <div className="expr-error">{card.inv.error}</div>}
            {card.inv && card.inv.ok && (
              <div className="uc-facts" data-testid="uc-inv-answer">
                <div className="uc-answer">
                  {card.inv.question} ={' '}
                  <Answer k={ak} what="the inverse">
                    <span className="uc-k">{card.inv.answer}</span>
                  </Answer>
                </div>
                <div className="uc-dim">{card.inv.range}</div>
                {card.inv.other && (
                  <Answer k={ak} quiet>
                    <div className="uc-dim">{card.inv.other}</div>
                  </Answer>
                )}
                <div className="uc-toggles">
                  {check('other', 'show the other solution (greyed)', 'The other angle in one turn with the same value')}
                </div>
              </div>
            )}
          </CardSection>

          <CardSection kind="uc-table" title="Special angles" defaultOpen={false} summary="16 angles">
            <div className="seq-table-wrap">
              <table className="seq-table uc-table" data-testid="uc-table">
                <thead>
                  <tr>
                    <th>θ</th>
                    <th>deg</th>
                    <th>cos θ</th>
                    <th>sin θ</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((r) => (
                    <tr
                      key={r.k}
                      className={`uc-row${currentK === r.k ? ' uc-row-on' : ''}`}
                      title={`Put θ at ${deg ? r.deg : r.rad}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onTheta(r.theta)
                      }}
                    >
                      <td>{r.rad}</td>
                      <td>{r.deg}</td>
                      <td>{r.cos}</td>
                      <td>{r.sin}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="field-hint">Click a row to move θ there. tan θ = sin θ / cos θ.</div>
          </CardSection>
        </div>
      )}
    </div>
  )
}
