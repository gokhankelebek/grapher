// ============================================================================
// src/ui/VolumeSection.tsx — one solid, as its PARENT's card shows it: which
// region (between f and g, or f and the x-axis) and how it is cut — disks /
// washers, shells, or known cross-sections — about which axis (x-axis, y-axis,
// y = k, x = k with k typed exactly), a and b (typed exactly), the written
// integral with R, r, h or s spelled out, V exactly when it is exact, the
// axis-through-the-region warning, what a dy pairing needs when it cannot be
// done (with the button that switches method), and the representative slice
// on a slider.
//
// Everything it prints arrives computed (src/ui/volumeLinks.ts → VolumeRow);
// every edit leaves as one CalcChange. The only state kept here is the field
// being typed into.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Latex } from './Latex'
import { Answer } from './RevealAnswer'
import { calcKey } from './reveal'
import { CardSection, SectionDrop } from './CardSection'
import { parseNumeric } from './numeric'
import type { CalcChange, VolumeRow } from './calcLinks'
import { SECTION_LABELS, editableNum } from './volumeLinks'
import { SECTION_SHAPES } from '../core/volume'
import type { SectionShape, VolumeAxis, VolumeMethod } from '../core/volume'
import { numText } from './secantLinks'

interface Props {
  row: VolumeRow
  onCalcChange(change: CalcChange, live?: boolean): void
  onRemove(): void
  /** Open / close one undo bracket around the slice slider's drag. */
  onEditStart(): void
  onEditEnd(): void
}

type FieldId = 'a' | 'b' | 'k' | 'ratio'

function fillStyle(value: number, min: number, max: number): CSSProperties {
  const span = max - min || 1
  const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100))
  return { '--fill': `${pct}%` } as CSSProperties
}

const METHODS: { method: VolumeMethod; label: string; title: string }[] = [
  { method: 'washer', label: 'Disk/Washer', title: 'Disks or washers: slices perpendicular to the axis of revolution' },
  { method: 'shell', label: 'Shell', title: 'Cylindrical shells: slices parallel to the axis of revolution' },
  { method: 'section', label: 'Cross-sections', title: 'Known cross-sections standing on the region, perpendicular to the x-axis or the y-axis' },
]

/** Which axis the cross-sections are perpendicular to. */
const PERPS: { perp: 'x' | 'y'; label: string; title: string }[] = [
  { perp: 'x', label: '⟂ x-axis', title: 'Sections perpendicular to the x-axis: vertical slices, base s(x), integrate in dx' },
  { perp: 'y', label: '⟂ y-axis', title: 'Sections perpendicular to the y-axis: horizontal slices, base s(y), integrate in dy' },
]

/** Which entry of the axis picker an axis is. */
function axisChoice(axis: VolumeAxis): 'x-axis' | 'y-axis' | 'y=k' | 'x=k' {
  if (axis.dir === 'h') return axis.at === 0 ? 'x-axis' : 'y=k'
  return axis.at === 0 ? 'y-axis' : 'x=k'
}

export function VolumeSection({ row, onCalcChange, onRemove, onEditStart, onEditEnd }: Props) {
  const [edit, setEdit] = useState<{ which: FieldId; text: string; bad: boolean } | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const linkId = row.linkId

  useEffect(() => {
    if (edit && inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [edit])

  const commit = (): void => {
    if (!edit) return
    const v = parseNumeric(edit.text)
    if (v === null || !Number.isFinite(v) || (edit.which === 'ratio' && !(v > 0))) {
      setEdit({ ...edit, bad: true })
      return
    }
    if (edit.which === 'a' || edit.which === 'b') {
      onCalcChange({ kind: 'volumeBound', linkId, which: edit.which, value: v })
    } else if (edit.which === 'k') {
      onCalcChange({ kind: 'volumeAxis', linkId, axis: { dir: row.axis.dir, at: v } })
    } else {
      onCalcChange({ kind: 'volumeRatio', linkId, ratio: v })
    }
    setEdit(null)
  }

  const field = (which: FieldId, label: string, value: number, title: string): JSX.Element => {
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
        onClick={() => setEdit({ which, text: editableNum(value), bad: false })}
      >
        <span className="calc-field-label">{label}</span>
        <span className="calc-field-value">{numText(value)}</span>
      </button>
    )
  }

  const choice = axisChoice(row.axis)
  const isSection = row.method === 'section'
  const step = (row.sliceHi - row.sliceLo) / 200 || 0.01

  return (
    <CardSection
      kind="volume"
      title="Volume"
      summary={row.value ? `${row.head} · ${row.value}` : row.head}
      actions={<SectionDrop what="solid" onRemove={onRemove} />}
      className="calc-row volume-row"
      data={{ link: linkId }}
      answerKey={calcKey(linkId)}
    >
      <div className="calc-line">
        <span className="calc-read volume-head">{row.head}</span>
      </div>

      <div className="calc-controls volume-region">
        <span className="volume-label">{`Region between ${row.fName} and`}</span>
        <select
          className="calc-select"
          aria-label="The region runs to"
          title="The region's other boundary: the x-axis, or another curve"
          value={row.otherId ?? ''}
          onChange={(e) => onCalcChange({ kind: 'volumeOther', linkId, otherId: e.target.value || null })}
        >
          <option value="">the x-axis</option>
          {row.others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="calc-controls volume-methods" role="group" aria-label="Method">
        {METHODS.map((m) => (
          <button
            key={m.method}
            type="button"
            className={`calc-chip${row.method === m.method ? ' calc-chip-on' : ''}`}
            aria-pressed={row.method === m.method}
            title={m.title}
            onClick={() => onCalcChange({ kind: 'volumeMethod', linkId, method: m.method })}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="calc-controls">
        {isSection ? (
          <>
            <select
              className="calc-select"
              aria-label="Cross-section shape"
              title={row.perp === 'y' ? 'The shape of each cross-section, standing on the base s(y) = right − left' : 'The shape of each cross-section, standing on the base s(x) = top − bottom'}
              value={row.section}
              onChange={(e) => onCalcChange({ kind: 'volumeSection', linkId, section: e.target.value as SectionShape })}
            >
              {SECTION_SHAPES.map((s) => (
                <option key={s} value={s}>
                  {SECTION_LABELS[s]}
                </option>
              ))}
            </select>
            {row.section === 'rectangle' &&
              field('ratio', 'k', row.ratio, 'The rectangle’s height as a multiple of its base — type 2, 1/2 …')}
            <span className="volume-perp" role="group" aria-label="Cross-sections perpendicular to">
              {PERPS.map((p) => (
                <button
                  key={p.perp}
                  type="button"
                  className={`calc-chip${row.perp === p.perp ? ' calc-chip-on' : ''}`}
                  aria-pressed={row.perp === p.perp}
                  title={p.title}
                  onClick={() => onCalcChange({ kind: 'volumeSectionAxis', linkId, perp: p.perp })}
                >
                  {p.label}
                </button>
              ))}
            </span>
          </>
        ) : (
          <>
            <span className="volume-label">about</span>
            <select
              className="calc-select"
              aria-label="Axis of revolution"
              title="The axis the region is revolved about"
              value={choice}
              onChange={(e) => {
                const v = e.target.value
                const axis: VolumeAxis =
                  v === 'x-axis'
                    ? { dir: 'h', at: 0 }
                    : v === 'y-axis'
                      ? { dir: 'v', at: 0 }
                      : v === 'y=k'
                        ? { dir: 'h', at: row.suggestK.h }
                        : { dir: 'v', at: row.suggestK.v }
                onCalcChange({ kind: 'volumeAxis', linkId, axis })
              }}
            >
              <option value="x-axis">the x-axis</option>
              <option value="y-axis">the y-axis</option>
              <option value="y=k">y = k</option>
              <option value="x=k">x = k</option>
            </select>
            {(choice === 'y=k' || choice === 'x=k') &&
              field('k', choice === 'y=k' ? 'y =' : 'x =', row.axis.at, 'Where the axis is — type 2, -1, 1/2, pi …')}
          </>
        )}
      </div>

      <div className="calc-controls">
        {field('a', 'a', row.a, 'a — type 0, -1, 1/2, pi/2 …')}
        {field('b', 'b', row.b, 'b — type 4, 2, sqrt(2) …')}
      </div>

      {row.problem && <div className="calc-why">{`Nothing is measured: ${row.problem}.`}</div>}

      {(row.integral || row.parts.length > 0 || row.valueTex) && (
      <Answer k={calcKey(linkId)} block what="the volume">
      {row.integral && (
        <div className="secant-tex volume-tex" title={row.integral.text} aria-label={row.integral.text}>
          <Latex tex={`V = ${row.integral.tex}`} />
        </div>
      )}
      {row.parts.length > 0 && (
        <ul className="calc-facts volume-parts">
          {row.parts.map((p, i) => (
            <li key={i} className="calc-fact">
              {p}
            </li>
          ))}
        </ul>
      )}
      {row.valueTex && (
        <div className="secant-tex volume-value" title={row.value ?? ''} aria-label={row.value ?? ''}>
          <Latex tex={row.valueTex} />
        </div>
      )}
      </Answer>
      )}

      {row.warning && <div className="calc-why volume-warning">{row.warning}</div>}

      {row.need && (
        <div className="calc-why volume-need">
          <span>{row.need.text}</span>{' '}
          <button
            type="button"
            className="calc-chip"
            onClick={() => onCalcChange(row.need!.change)}
          >
            {row.need.button}
          </button>
        </div>
      )}

      {row.slice !== null && !row.problem && !row.need && (
        <div className="limit-eps volume-slice">
          <span className="calc-n-label">{row.sliceVar}</span>
          <input
            type="range"
            min={row.sliceLo}
            max={row.sliceHi}
            step={step}
            value={row.slice}
            aria-label={`The representative slice's ${row.sliceVar}`}
            title="Drag the representative slice across the region"
            style={fillStyle(row.slice, row.sliceLo, row.sliceHi)}
            onPointerDown={onEditStart}
            onPointerUp={onEditEnd}
            onKeyDown={onEditStart}
            onKeyUp={onEditEnd}
            onBlur={onEditEnd}
            onChange={(e) => onCalcChange({ kind: 'volumeSlice', linkId, x: Number(e.target.value) }, true)}
          />
          <span className="calc-n-value limit-eps-value">{numText(Math.round(row.slice * 1000) / 1000)}</span>
        </div>
      )}
    </CardSection>
  )
}
