// ============================================================================
// src/ui/TaylorSection.tsx — one Taylor polynomial, as its PARENT's card shows
// it: Pₙ itself, the degree (a stepper, a slider and the ▶ "step through the
// degrees" demo), the centre a (typed exactly: pi/6, -1, 1/2), the probe x
// with every error reading an AP question asks for, the two board switches,
// and the interval of convergence.
//
// Everything it prints arrives computed (src/ui/taylorLinks.ts → TaylorRow);
// every edit leaves as one CalcChange. The only state kept here is the field
// being typed into and the demo's timer.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Latex } from './Latex'
import { CardSection, SectionDrop } from './CardSection'
import { parseNumeric } from './numeric'
import type { CalcChange, TaylorRow } from './calcLinks'
import { TAYLOR_N_MAX, TAYLOR_N_MIN, TAYLOR_PLAY_TO, TAYLOR_STEP_MS } from './taylorLinks'

interface Props {
  row: TaylorRow
  onCalcChange(change: CalcChange, live?: boolean): void
  onRemove(): void
  /** Open / close one undo bracket around a slider drag or the ▶ demo. */
  onEditStart(): void
  onEditEnd(): void
}

function fillStyle(value: number, min: number, max: number): CSSProperties {
  const span = max - min || 1
  const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100))
  return { '--fill': `${pct}%` } as CSSProperties
}

/** What a typed field is prefilled with: the exact text, in the parser's spelling. */
function editable(text: string): string {
  return text.replace(/−/g, '-').replace(/π/g, 'pi').replace(/√(\d+)/g, 'sqrt($1)')
}

export function TaylorSection({ row, onCalcChange, onRemove, onEditStart, onEditEnd }: Props) {
  const [edit, setEdit] = useState<{ which: 'a' | 'x'; text: string; bad: boolean } | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const timerRef = useRef<number | null>(null)
  const linkId = row.linkId

  useEffect(() => {
    if (edit && inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [edit])

  // ---- the ▶ demo: n = 0, 1, 2 … up to the degree it started from --------
  const endEdit = useRef(onEditEnd)
  endEdit.current = onEditEnd
  const stop = (): void => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    setPlaying(false)
    endEdit.current()
  }
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
        endEdit.current()
      }
    },
    [],
  )
  const play = (): void => {
    if (playing) {
      stop()
      return
    }
    const target = row.n > 0 ? row.n : TAYLOR_PLAY_TO
    let k = 0
    onEditStart()
    onCalcChange({ kind: 'taylorN', linkId, n: 0 }, true)
    setPlaying(true)
    timerRef.current = window.setInterval(() => {
      k += 1
      onCalcChange({ kind: 'taylorN', linkId, n: k }, true)
      if (k >= target) stop()
    }, TAYLOR_STEP_MS)
  }

  const setN = (n: number): void => {
    if (playing) stop()
    const k = Math.max(TAYLOR_N_MIN, Math.min(TAYLOR_N_MAX, Math.round(n)))
    if (k !== row.n) onCalcChange({ kind: 'taylorN', linkId, n: k })
  }

  const commit = (): void => {
    if (!edit) return
    const v = parseNumeric(edit.text)
    if (v === null) {
      setEdit({ ...edit, bad: true })
      return
    }
    if (edit.which === 'a') onCalcChange({ kind: 'taylorA', linkId, a: v })
    else onCalcChange({ kind: 'taylorX', linkId, x: v })
    setEdit(null)
  }

  const field = (which: 'a' | 'x', label: string, shown: string, title: string): JSX.Element => {
    if (edit?.which === which) {
      return (
        <span className="calc-field">
          <span className="calc-field-label">{label}</span>
          <input
            ref={inputRef}
            className={`calc-input${edit.bad ? ' param-edit-bad' : ''}`}
            type="text"
            spellCheck={false}
            aria-label={title}
            value={edit.text}
            onChange={(e) => setEdit({ which, text: e.target.value, bad: false })}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setEdit(null)
              }
            }}
            onBlur={() => setEdit(null)}
          />
        </span>
      )
    }
    return (
      <button
        type="button"
        className="calc-field calc-field-btn"
        title={title}
        onClick={() => setEdit({ which, text: editable(shown), bad: false })}
      >
        <span className="calc-field-label">{label}</span>
        <span className="calc-field-value">{shown}</span>
      </button>
    )
  }

  return (
    <CardSection
      kind="taylor"
      title="Taylor"
      summary={`${row.name} about ${row.aText}`}
      actions={<SectionDrop what="Taylor polynomial" onRemove={onRemove} />}
      className="calc-row taylor-row"
      data={{ link: linkId }}
    >
      <div className="calc-line">
        {/* What it is, in words; the polynomial itself is the KaTeX line below
            (or, when KaTeX has nothing to show, this line says it in text). */}
        <span className="calc-read taylor-name" title={row.text || undefined}>
          {row.tex ? `${row.name} about a = ${row.aText}` : row.text || `${row.name}(x) = —`}
        </span>
      </div>

      {row.tex && (
        <div className="taylor-tex" title={row.text}>
          <Latex tex={row.tex} />
        </div>
      )}

      {/* n: the number the class watches. A stepper for one degree at a time,
          a slider for a sweep, and ▶ for the demo every BC class sees. */}
      <div className="taylor-n">
        <span className="calc-n-label">n</span>
        <button
          type="button"
          className="calc-chip taylor-step"
          aria-label="One degree lower"
          title="One degree lower"
          disabled={row.n <= TAYLOR_N_MIN}
          onClick={() => setN(row.n - 1)}
        >
          −
        </button>
        <input
          type="range"
          min={TAYLOR_N_MIN}
          max={TAYLOR_N_MAX}
          step={1}
          value={row.n}
          aria-label="Degree n"
          style={fillStyle(row.n, TAYLOR_N_MIN, TAYLOR_N_MAX)}
          onPointerDown={() => {
            if (playing) stop()
            onEditStart()
          }}
          onPointerUp={onEditEnd}
          onKeyDown={onEditStart}
          onKeyUp={onEditEnd}
          onBlur={onEditEnd}
          onChange={(e) =>
            onCalcChange({ kind: 'taylorN', linkId, n: Number(e.target.value) }, true)
          }
        />
        <button
          type="button"
          className="calc-chip taylor-step"
          aria-label="One degree higher"
          title="One degree higher"
          disabled={row.n >= TAYLOR_N_MAX}
          onClick={() => setN(row.n + 1)}
        >
          +
        </button>
        <span className="calc-n-value">{row.n}</span>
        <button
          type="button"
          className={`calc-chip taylor-play${playing ? ' calc-chip-on' : ''}`}
          aria-pressed={playing}
          title={
            playing
              ? 'Stop'
              : `Step through the degrees: n = 0, 1, 2 … ${row.n > 0 ? row.n : TAYLOR_PLAY_TO}`
          }
          onClick={play}
        >
          {playing ? '■' : '▶'}
        </button>
      </div>

      <div className="calc-controls">
        {field('a', 'a', row.aText, 'The center a — type pi/6, -1, 1/2 …')}
        {row.x !== null ? (
          <>
            {field('x', 'x', row.xText ?? String(row.x), 'The probe x — where the error is measured')}
            <button
              type="button"
              className="calc-chip"
              title="Remove the probe"
              aria-label="Remove the probe"
              onClick={() => onCalcChange({ kind: 'taylorX', linkId, x: null })}
            >
              no probe
            </button>
          </>
        ) : (
          <button
            type="button"
            className="calc-chip"
            title="Measure the error at a point: Pₙ(x), f(x), the actual error and its bounds"
            onClick={() => onCalcChange({ kind: 'taylorX', linkId, x: row.a + 0.5 })}
          >
            Add a probe
          </button>
        )}
      </div>

      <div className="calc-controls">
        <button
          type="button"
          className={`calc-chip${row.band ? ' calc-chip-on' : ''}`}
          aria-pressed={row.band}
          title="Shade Pₙ(x) ± the Lagrange error bound across the board"
          onClick={() => onCalcChange({ kind: 'taylorBand', linkId, on: !row.band })}
        >
          error bound band
        </button>
        <button
          type="button"
          className={`calc-chip${row.ioc ? ' calc-chip-on' : ''}`}
          aria-pressed={row.ioc}
          title="Mark the interval of convergence of the Taylor series on the x-axis"
          onClick={() => onCalcChange({ kind: 'taylorIoc', linkId, on: !row.ioc })}
        >
          interval of convergence
        </button>
      </div>

      {row.problem && <div className="calc-why">{`Nothing is drawn: ${row.problem}.`}</div>}

      {row.probe && (
        <ul className="calc-facts taylor-probe">
          <li className="calc-fact calc-fact-lead">{row.probe.p}</li>
          <li className="calc-fact calc-fact-lead">{row.probe.f}</li>
          <li className="calc-fact calc-fact-lead">{`actual error ${row.probe.error}`}</li>
          {row.probe.lagrange && <li className="calc-fact">{row.probe.lagrange}</li>}
          {row.probe.alternating && <li className="calc-fact">{row.probe.alternating}</li>}
        </ul>
      )}

      <div className="taylor-ioc">
        <span className="calc-read calc-accum-read">{row.iocText}</span>
        {row.iocNote && <span className="calc-note taylor-ioc-note">{row.iocNote}</span>}
      </div>
    </CardSection>
  )
}
