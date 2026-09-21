import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type {
  Asymptote,
  EndCap,
  FitResult,
  FittedCurve,
  ModelSpec,
  ParamMeta,
  SpecialPoint,
  SpecialPointKind,
} from '../core/types'
import type { CurveStyle } from '../App'
import { fitQuality } from '../core/fit/recognize'
import { findAsymptotes } from '../core/holes'
import { Latex } from './Latex'
import { APPROX, exactDetail, formatCoord, parseNumeric, pointParts } from './numeric'
import { alignedValues, curveScale, derivesFromInk } from './curveState'
import { axisKeys, featureAxes } from './featureEdit'
import { curveEquationText, displayEquationLatex } from './equationText'
import { N_MAX, N_MIN, RIEMANN_METHODS } from './calcLinks'
import type { CalcChange, CalcKind, CardCalc } from './calcLinks'
import type { CurveIntersections } from './intersections'

interface Props {
  curve: FittedCurve
  style: CurveStyle | undefined
  models: Record<string, ModelSpec>
  selected: boolean
  candidates: FitResult[]
  /** Which params just snapped (accent pulse), or null. */
  snapMask: boolean[] | null
  snapKey: number
  /** Brief shake after a failed oversketch. */
  shaking: boolean
  /** The equation the user typed, when this curve came from one. */
  exprSource?: string
  /**
   * The user's own typed form of a curve that is still a FAMILY — typed as
   * "y = 0.25(x+2)(x-1)(x-3)", recognised as a cubic. The card keeps showing
   * what was typed while the params still say the same thing.
   */
  displaySource?: string
  /** Set when that equation could not be rebuilt after a reload. */
  brokenReason?: string
  /**
   * True once this curve stopped being a reading of its own ink (a typed
   * equation, a stated feature, a dragged handle). σ is hidden then: it is the
   * fit to a sketch the curve no longer matches.
   */
  edited: boolean
  /** Special points for this curve (only the selected card receives them). */
  analysis: SpecialPoint[]
  /**
   * Where this curve meets the OTHER curves on the board, one entry per other
   * curve, already named.
   *
   * Not part of `analysis` because an intersection is not a feature of one
   * curve: the same point is listed on both cards, from one computation, so
   * the two can never disagree about where f and g cross. Absent on a board
   * where nothing crosses, which is most of them.
   */
  intersections?: readonly CurveIntersections[]
  /** Hovering a value emphasises the matching marker on canvas. */
  onAnalysisHover(index: number | null): void
  /**
   * State an exact position for one special point. Returns true when the curve
   * actually changed; false leaves the editor open (the solver refused, and its
   * reason is being shown elsewhere) so the teacher can try another value.
   */
  onFeatureEdit(index: number, to: { x?: number; y?: number }): boolean
  onSelect(): void
  onDelete(): void
  onDuplicate(): void
  onToggleVisible(): void
  onCycleColor(): void
  onParamChange(index: number, value: number): void
  onParamEditStart(): void
  onParamEditEnd(): void
  /** Param-slider commit (snap-aware, replaces plain onParamEditEnd for params). */
  onParamCommit(): void
  /** Exact typed value (inline edit), undoable. */
  onParamSetExact(index: number, value: number): void
  onApplyCandidate(candidate: FitResult): void
  /**
   * Retype the equation itself. Returns an error message to show (the parser's
   * own words), or null when it was accepted and the editor should close.
   */
  onEquationCommit(src: string): string | null
  onStrokeWidth(width: number): void
  onDash(dash: number[] | undefined): void
  /** Cap one end of this curve. 'auto' hands the end back to the figure style. */
  onEnds(which: 'start' | 'end', cap: EndCap): void
  onOpacity(opacity: number): void
  /**
   * The calculus objects this curve is part of, already computed: what it IS
   * (a tangent, an f′) and what is attached TO it (a shaded integral, a
   * Riemann sum). Absent on a curve with none, which is most of them — the
   * card gains nothing at all until a teacher asks for something.
   */
  calc?: CardCalc
  /**
   * Areas between THIS curve and another: whether one can be offered at all,
   * and the shadings some other card owns that happen to run to this curve.
   * Not part of CardCalc because it is a fact about the BOARD (is there a
   * second curve to point at?) rather than about this curve's own links.
   */
  between?: BetweenInfo
  onAddCalc(kind: CalcKind): void
  /** Start "Area between curves…": shade immediately, or arm the next tap. */
  onAddAreaBetween(): void
  /** State one change to one object. `live` = a drag or slider in flight. */
  onCalcChange(change: CalcChange, live?: boolean): void
  onCalcRemove(linkId: string): void
}

/**
 * What a card knows about areas between curves.
 *
 * `canAdd` is the menu item's whole condition: there has to BE another curve
 * that is a function of x and on screen, or "Area between curves…" is an
 * offer with no possible answer. `notes` is the read-only line a curve wears
 * when it is the OTHER half of somebody else's region — a teacher looking at
 * g and wondering why it is shaded gets told, and gets told whose card to
 * open, rather than being handed a second set of controls for one object.
 */
export interface BetweenInfo {
  canAdd: boolean
  notes: string[]
}

/** One array, so a card with nothing to say re-renders no more than before. */
const EMPTY_NOTES: string[] = []

/** The order the ⋯ menu offers them: the order an AP class meets them. */
const CALC_ITEMS: { kind: CalcKind; label: string }[] = [
  { kind: 'tangent', label: 'Tangent line' },
  { kind: 'derivative', label: 'Derivative f\u2032' },
  { kind: 'area', label: 'Area under curve' },
  { kind: 'riemann', label: 'Riemann sum' },
]

const METHOD_LABELS: Record<string, string> = {
  left: 'left',
  right: 'right',
  midpoint: 'midpoint',
  trapezoid: 'trapezoid',
}

const DASH_STYLES: { key: string; label: string; title: string; dash: number[] | undefined }[] = [
  { key: 'solid', label: '━', title: 'Solid line', dash: undefined },
  { key: 'dashed', label: '╍ ╍', title: 'Dashed line', dash: [8, 6] },
  { key: 'dotted', label: '· · ·', title: 'Dotted line', dash: [2, 5] },
]

/**
 * The end caps, in the order a figure offers them: no opinion, nothing, the
 * graph keeps going, the endpoint is excluded, the endpoint is included.
 * The arrow is the one glyph that has to be mirrored — it points OUT of the
 * curve, so the left end wears ← and the right end →.
 */
const END_CAPS: { cap: EndCap; glyph: string; leftGlyph?: string; title: string }[] = [
  { cap: 'auto', glyph: 'A', title: 'Let the figure style decide' },
  { cap: 'none', glyph: '–', title: 'Nothing' },
  { cap: 'arrow', glyph: '→', leftGlyph: '←', title: 'Arrow' },
  { cap: 'open', glyph: '○', title: 'Open dot' },
  { cap: 'closed', glyph: '●', title: 'Closed dot' },
]

const END_SIDES = ['start', 'end'] as const

/**
 * What each end is CALLED. On y = f(x) the ends are left and right, which is
 * how a teacher points at them; on a parametric or polar curve there is no
 * left, only the start and the finish of the trace.
 */
function endSideName(kind: FittedCurve['kind'], which: 'start' | 'end'): string {
  if (kind === 'explicit') return which === 'start' ? 'Left end' : 'Right end'
  return which === 'start' ? 'Start of curve' : 'End of curve'
}

/** Readout order: what a student is asked to find, in the order they find it. */
/**
 * The analysis table, in reading order.
 *
 * `readOnly` marks a row whose values are STATED rather than offered: a hole
 * is where the formula has no value, so there is nothing to put anywhere else
 * — "put this hole at x = 3" is not a sentence about a function, it is a
 * different function. Every other row is click-to-edit, because every other
 * feature is a consequence of the parameters and the solver can move it.
 */
const ANALYSIS_ROWS: {
  kind: SpecialPointKind
  label: string
  plural?: string
  readOnly?: boolean
}[] = [
  { kind: 'zero', label: 'Zero', plural: 'Zeros' },
  { kind: 'maximum', label: 'Maximum', plural: 'Maxima' },
  { kind: 'minimum', label: 'Minimum', plural: 'Minima' },
  { kind: 'inflection', label: 'Inflection', plural: 'Inflections' },
  { kind: 'y-intercept', label: 'y-intercept' },
  { kind: 'hole', label: 'Hole', plural: 'Holes', readOnly: true },
  { kind: 'extreme', label: 'Extreme', plural: 'Extremes' },
  { kind: 'petal-tip', label: 'Petal tip', plural: 'Petal tips' },
]

/**
 * The x-range the card reads asymptotes over when the curve declares no domain
 * of its own — the analyzer's own default, so the vertical asymptotes listed
 * here are the ones the rest of the table is talking about.
 */
const CARD_RANGE: [number, number] = [-10, 10]

/** A direction this close to vertical has no slope to print. */
const VERTICAL_DIR = 1e-12

/**
 * One coefficient of a printed line: the analysis table's own rounding, minus
 * the padding.
 *
 * formatCoord keeps trailing zeros so that a COLUMN of coordinates lines up on
 * the decimal point. An equation is not a column — it is read left to right,
 * and "y = 2.000x + 2.000" is not how anybody writes a line. So the value is
 * put through formatCoord first (which is what decides, at this curve's scale,
 * whether it is zero at all) and then re-rendered at up to four significant
 * digits with the trailing zeros dropped and the true minus kept.
 */
function coefText(v: number, scale?: number): string {
  const snapped = formatCoord(v, { scale })
  if (snapped === '0' || snapped === '—') return snapped
  const r = Number(v.toPrecision(4))
  if (!Number.isFinite(r)) return '—'
  const abs = Math.abs(r)
  const s = abs >= 1e5 || abs < 1e-3 ? r.toExponential(2) : String(r)
  return s.startsWith('-') ? '−' + s.slice(1) : s
}

/**
 * The tooltip on a closed form: what it actually equals, to six places.
 *
 * The row prints four significant digits because it is a COLUMN and a column
 * has to line up. A teacher who stops on "\u221a3" is usually checking it against
 * whatever is on the calculator in front of them, and the hover is the one
 * place in this card where extra digits cost nobody anything.
 */
function exactTitle(p: SpecialPoint, exact: string): string {
  const rhs =
    p.kind === 'zero'
      ? exactDetail(p.pos.x)
      : `(${exactDetail(p.pos.x)}, ${exactDetail(p.pos.y)})`
  return `${exact} = ${rhs}`
}

/**
 * One asymptote, as a teacher writes it: `x = 1`, `y = 2`, `y = 2x + 2`,
 * `y = −0.5x − 1`.
 *
 * Every kind of `Asymptote` has to come out in the same language, because the
 * card lists them together: a vertical one names its x, a horizontal one its
 * y, and a slant one — whether it came from the end behaviour of y = f(x) or
 * from a polar curve leaning on a line — is written as the line it is. A
 * polar line that happens to be vertical is written `x = c` for the same
 * reason: "y = 4.5e15·x" is not a sentence about a graph.
 */
export function asymptoteText(a: Asymptote, scale?: number): string {
  if (!a) return ''
  if (a.kind === 'vertical') {
    return Number.isFinite(a.x) ? `x = ${coefText(a.x, scale)}` : ''
  }
  if (a.kind !== 'line') return ''
  const { a: p, dir } = a
  if (!p || !dir) return ''
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return ''
  if (!Number.isFinite(dir.x) || !Number.isFinite(dir.y)) return ''
  const len = Math.hypot(dir.x, dir.y)
  if (!(len > 0)) return ''
  if (Math.abs(dir.x / len) <= VERTICAL_DIR) {
    // Straight up: the line is x = (wherever it crosses), and its own point
    // already names that x.
    return `x = ${coefText(p.x, scale)}`
  }
  const m = dir.y / dir.x
  const b = p.y - m * p.x
  if (!Number.isFinite(m) || !Number.isFinite(b)) return ''
  const mText = coefText(m)
  if (mText === '0') return `y = ${coefText(b, scale)}`
  const slope = mText === '1' ? 'x' : mText === '−1' ? '−x' : `${mText}x`
  const bText = coefText(b, scale)
  if (bText === '0') return `y = ${slope}`
  const negative = bText.startsWith('−')
  return `y = ${slope} ${negative ? '−' : '+'} ${negative ? bText.slice(1) : bText}`
}

/**
 * Every asymptote of a curve, in the words the card prints — vertical ones
 * first, then whatever its two ends lean on, which is the order they are
 * named in and the order src/core/holes.ts returns them.
 *
 * Exported for the same reason `cardCalc` is: the row is one string per
 * asymptote, and a string is testable without a browser.
 */
export function asymptoteTexts(
  curve: FittedCurve,
  models: Record<string, ModelSpec>,
  scale?: number,
): string[] {
  const dom = curve.domain
  const range: [number, number] =
    dom && Number.isFinite(dom[0]) && Number.isFinite(dom[1])
      ? [Math.min(dom[0], dom[1]), Math.max(dom[0], dom[1])]
      : CARD_RANGE
  try {
    return findAsymptotes(curve, models, range)
      .map((a) => asymptoteText(a, scale))
      .filter((t) => t !== '')
  } catch {
    return []
  }
}

/** How many next-best readings sit beside the select as one-click chips. */
const ALSO_FITS = 2

export function formatError(err: number): string {
  if (!Number.isFinite(err)) return '—'
  if (err !== 0 && Math.abs(err) < 0.001) return err.toExponential(1)
  return err.toFixed(3)
}

/** Filled-track stop for a range input (consumed by the --fill token in CSS). */
function fillStyle(value: number, min: number, max: number): CSSProperties {
  const span = max - min || 1
  const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100))
  return { '--fill': `${pct}%` } as CSSProperties
}

/**
 * A fit quality as a percentage.
 *
 * This is what the Interpretations list shows INSTEAD of σ. The list is sorted
 * by model-selection score, and σ is not monotone in that order — a σ column
 * that rose and fell down a ranked list read as a broken table. fitQuality is
 * monotone by construction, and "fits 62% as tightly as the best reading" is a
 * sentence a teacher can act on.
 */
export function qualityText(q: number): string {
  if (!Number.isFinite(q) || q <= 0) return '—'
  const pct = Math.round(q * 100)
  return `${Math.max(1, Math.min(100, pct))}%`
}

const sameMeta = (a: ParamMeta, b: ParamMeta): boolean =>
  a.name === b.name && a.min === b.min && a.max === b.max && a.step === b.step

/**
 * Map each slider ROW to the parameter index it actually edits.
 *
 * WHY THIS EXISTS: ModelSpec.paramMeta may present rows in any order it likes,
 * and the polynomial families deliberately do NOT use param order. `line`
 * stores params ascending — [b, m] for y = m·x + b — but lists the rows m, b so
 * they read like the printed equation; `poly2..poly4` list the highest-degree
 * coefficient first over ascending storage. Assuming "row i edits params[i]"
 * therefore labelled the slope "b" and the intercept "m", built every slider's
 * range around a different coefficient (pegging the thumb at an end), and wrote
 * typed exact values into the wrong coefficient. Nothing in the ParamMeta
 * contract records the link, so we recover it here instead of trusting order.
 *
 * HOW: probe. Each range is centred on the value of the parameter it belongs to,
 * so perturbing one parameter moves exactly that parameter's row. One extra
 * paramMeta call per parameter (n ≤ ~10, memoised with the rows themselves).
 * Rows that no parameter moves are ranges the model fixed on purpose (the rose's
 * integer k, the power family's exponent p); those — and any ambiguous row — get
 * the leftover indices in positional order, which is the identity mapping the
 * models that need it already assume.
 */
function deriveParamIndices(
  spec: ModelSpec,
  params: number[],
  rows: ParamMeta[],
): number[] {
  const movedBy: number[][] = rows.map(() => [])
  for (let j = 0; j < params.length; j++) {
    const probe = params.slice()
    // An offset no fitted coefficient is likely to already differ by, so a
    // coincidentally identical range is not a practical concern.
    probe[j] = (Number.isFinite(params[j]) ? params[j] : 0) + 7.3125
    let probed: ParamMeta[]
    try {
      probed = spec.paramMeta(probe)
    } catch {
      continue
    }
    if (!Array.isArray(probed) || probed.length !== rows.length) continue
    for (let i = 0; i < rows.length; i++) {
      if (!sameMeta(rows[i], probed[i])) movedBy[i].push(j)
    }
  }

  const out = rows.map(() => -1)
  const claimed = new Set<number>()
  for (let i = 0; i < rows.length; i++) {
    const only = movedBy[i].length === 1 ? movedBy[i][0] : -1
    if (only >= 0 && !claimed.has(only)) {
      out[i] = only
      claimed.add(only)
    }
  }
  let next = 0
  for (let i = 0; i < rows.length; i++) {
    if (out[i] !== -1) continue
    while (claimed.has(next)) next++
    out[i] = next
    claimed.add(next)
    next++
  }
  return out
}

/**
 * One coefficient: its name, a slider, and the exact value as a field.
 *
 * Lifted out of CurveCard so a slope field's free constants are the SAME
 * control rather than a second one that drifts from it. A field's `a` and a
 * sine's amplitude are the same kind of thing — a number the class moves and
 * watches — so they are moved the same way, magnetise the same way, and are
 * typed exactly the same way.
 *
 * The inline editor's state lives here, one per row: opening another row's
 * editor blurs this one, which closes it, so there is still exactly one open
 * at a time without the card having to keep score.
 */
export interface ParamRowProps {
  /** KaTeX for the name — "a", "\\omega", "k". */
  name: string
  value: number
  /** What the card prints, column-aligned across the whole list. */
  text: string
  min: number
  max: number
  step: number
  /** This value just magnetised: pulse it. */
  snapped?: boolean
  /** Bumped per snap, so the animation restarts when the class name repeats. */
  snapKey?: number
  onChange(value: number): void
  /** Pointer/key down on the slider: open the live-edit bracket. */
  onEditStart(): void
  /** Release: close the bracket, magnetising where that applies. */
  onCommit(): void
  /** Blur without a release. */
  onEditEnd(): void
  /** Enter on the typed field: one undoable, exact value. */
  onSetExact(value: number): void
}

export function ParamRow({
  name,
  value,
  text,
  min,
  max,
  step,
  snapped = false,
  snapKey = 0,
  onChange,
  onEditStart,
  onCommit,
  onEditEnd,
  onSetExact,
}: ParamRowProps) {
  const [editing, setEditing] = useState<{ text: string; bad: boolean } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const open = editing !== null
  useEffect(() => {
    if (open) inputRef.current?.select()
  }, [open])

  const commit = (): void => {
    if (!editing) return
    const v = Number(editing.text.trim())
    if (editing.text.trim() === '' || !Number.isFinite(v)) {
      setEditing({ ...editing, bad: true })
      return
    }
    onSetExact(v)
    setEditing(null)
  }

  return (
    <div className="param-row">
      <span className="param-name">
        <Latex tex={name} />
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={name}
        style={fillStyle(value, min, max)}
        onPointerDown={onEditStart}
        onPointerUp={onCommit}
        onKeyDown={onEditStart}
        onKeyUp={onCommit}
        onBlur={onEditEnd}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {editing ? (
        <input
          ref={inputRef}
          className={`param-edit${editing.bad ? ' param-edit-bad' : ''}`}
          type="text"
          inputMode="decimal"
          spellCheck={false}
          aria-label={`${name} exact value`}
          value={editing.text}
          onChange={(e) => setEditing({ text: e.target.value, bad: false })}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(null)
            }
          }}
          onBlur={() => setEditing(null)}
        />
      ) : (
        <button
          key={snapped ? snapKey : 0}
          className={`param-value${snapped ? ' param-snap' : ''}`}
          title="Click to type an exact value"
          onClick={() => setEditing({ text: String(value), bad: false })}
        >
          {text}
        </button>
      )}
    </div>
  )
}

export function CurveCard({
  curve,
  style,
  models,
  selected,
  candidates,
  snapMask,
  snapKey,
  shaking,
  exprSource,
  displaySource,
  brokenReason,
  edited,
  analysis,
  intersections,
  onAnalysisHover,
  onFeatureEdit,
  onSelect,
  onDelete,
  onDuplicate,
  onToggleVisible,
  onCycleColor,
  onParamChange,
  onParamEditStart,
  onParamEditEnd,
  onParamCommit,
  onParamSetExact,
  onApplyCandidate,
  onEquationCommit,
  onStrokeWidth,
  onDash,
  onEnds,
  onOpacity,
  calc,
  between,
  onAddCalc,
  onAddAreaBetween,
  onCalcChange,
  onCalcRemove,
}: Props) {
  const spec: ModelSpec | undefined = models[curve.modelId]
  const isExpression = curve.modelId.startsWith('expr_')
  /** A typed curve whose model couldn't be rebuilt: shown, but inert. */
  const broken = Boolean(brokenReason)

  // Inline coefficient editing lives in ParamRow, one editor per row.

  // Inline editing of an analysis value ("put this zero at x = −2").
  //
  // `bad` is per-field so only the field that failed to parse turns red, and
  // `flash` is bumped on every rejected commit: the red-flash animation only
  // fires when the class name changes, so a second bad Enter has to land on a
  // different (identical) class or it would silently do nothing.
  const [featureEdit, setFeatureEdit] = useState<{
    index: number
    texts: string[]
    bad: boolean[]
    flash: number
  } | null>(null)
  const featureInputsRef = useRef<(HTMLInputElement | null)[]>([])
  useEffect(() => {
    if (!featureEdit) return
    const first = featureInputsRef.current[0]
    first?.focus()
    first?.select()
    // Only on open — re-running on every keystroke would fight the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureEdit?.index])
  useEffect(() => {
    if (!selected && featureEdit) {
      setFeatureEdit(null)
      onAnalysisHover(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  // Inline editing of a calculus number: the x a tangent touches, and the two
  // limits of an interval. Keyed by "<linkId>:<field>" so one editor is open
  // at a time no matter how many objects the curve carries.
  const [calcEdit, setCalcEdit] = useState<{ key: string; text: string; bad: boolean } | null>(
    null,
  )
  const calcInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (calcEdit) calcInputRef.current?.select()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcEdit?.key])
  useEffect(() => {
    if (!selected && calcEdit) setCalcEdit(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  // Inline editing of the equation ITSELF (click the formula).
  //
  // The seed is the line the user would TYPE, not the LaTeX above it: a typed
  // curve seeds with its own source, a fitted one with its params written out
  // (see equationText.ts). A family with no text form seeds with null, and its
  // formula stays print-only rather than offering an editor that could only
  // throw the curve away.
  const [eqEdit, setEqEdit] = useState<{ text: string; error: string | null } | null>(null)
  const eqInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (eqEdit) {
      eqInputRef.current?.focus()
      eqInputRef.current?.select()
    }
    // Only when it opens — re-running per keystroke would fight the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eqEdit !== null])

  const equationSeed = useMemo<string | null>(() => {
    if (isExpression || broken) return exprSource ?? null
    return displaySource ?? curveEquationText(curve, spec)
  }, [isExpression, broken, exprSource, displaySource, curve, spec])

  const openEqEdit = (): void => {
    if (equationSeed === null) return
    setEqEdit({ text: equationSeed, error: null })
  }

  /** Enter. The parser's refusal is shown verbatim and the text is kept. */
  const commitEqEdit = (): void => {
    if (!eqEdit) return
    const err = onEquationCommit(eqEdit.text)
    if (err) setEqEdit({ ...eqEdit, error: err })
    else setEqEdit(null)
  }

  /**
   * What the card PRINTS.
   *
   * A lesson whose subject is factored form must not have its equation expanded
   * on the spot, so a typed source that still says the same thing as the params
   * wins over the family's generated latex. The moment the params stop matching
   * it — a slider moved, a zero was stated — the source is no longer true and
   * the generated form takes over.
   */
  const latexStr = useMemo(() => {
    if (!isExpression && displaySource) {
      const own = displayEquationLatex(displaySource, curve, spec)
      if (own) return own
    }
    try {
      return spec ? spec.latex(curve.params) : curve.modelId
    } catch {
      return curve.modelId
    }
  }, [spec, curve, curve.params, curve.modelId, displaySource, isExpression])

  // Freeze slider ranges while this card is expanded so paramMeta (which
  // centers ranges on current values) doesn't re-center under a drag. Bumped
  // when a value lands outside its own frozen range (a typed exact value), so
  // the slider can still reach it instead of yanking it back to the old span.
  const [rangeEpoch, setRangeEpoch] = useState(0)

  const { rows: meta, index: paramIndex } = useMemo<{
    rows: ParamMeta[]
    index: number[]
  }>(() => {
    if (!selected || !spec) return { rows: [], index: [] }
    let rows: ParamMeta[]
    try {
      rows = spec.paramMeta(curve.params)
    } catch {
      return { rows: [], index: [] }
    }
    if (!Array.isArray(rows) || rows.length === 0) return { rows: [], index: [] }
    return { rows, index: deriveParamIndices(spec, curve.params, rows) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, spec, curve.id, curve.modelId, rangeEpoch])

  // Re-derive the frozen ranges once per value set when a coefficient has moved
  // outside its slider's span. Keyed on the values so a row whose range is fixed
  // on purpose (rose's k) can never loop.
  const rangeFixRef = useRef('')
  useEffect(() => {
    if (!selected || meta.length === 0) return
    const sig = `${curve.id}|${curve.params.join(',')}`
    if (rangeFixRef.current === sig) return
    const outside = meta.some((m, row) => {
      const v = curve.params[paramIndex[row] ?? row]
      return Number.isFinite(v) && (v < m.min || v > m.max)
    })
    if (!outside) return
    rangeFixRef.current = sig
    setRangeEpoch((e) => e + 1)
  }, [selected, meta, paramIndex, curve.id, curve.params])

  const modelName = (() => {
    try {
      return spec?.name ?? curve.modelId
    } catch {
      return curve.modelId
    }
  })()

  /**
   * What this curve is CALLED in a sentence — "Between y = x^2 and y = 2 - x^2".
   * Deliberately the same rule the App names curves by when it builds the
   * other half of that sentence, so the two halves can never disagree.
   */
  const selfLabel = useMemo(() => {
    if (spec && !curve.modelId.startsWith('expr_') && spec.name) return spec.name
    const typed = (exprSource ?? displaySource ?? '').trim()
    if (typed) return typed.length > 24 ? `${typed.slice(0, 23)}…` : typed
    return spec?.name ?? curve.modelId
  }, [spec, curve.modelId, exprSource, displaySource])

  const betweenNotes = between?.notes ?? EMPTY_NOTES

  /**
   * The size this curve's numbers live at. Passed to every readout, so a
   * midline of 0.0005 on a wave of height 6.5 prints as the 0 it is at this
   * table's resolution rather than as "5.09e-4".
   */
  const scale = useMemo(
    () => (selected ? curveScale(curve, spec) : undefined),
    [selected, curve, spec],
  )

  // Group the special points by kind, keeping each point's original index so
  // hovering a value can address the right marker on canvas.
  const analysisGroups = useMemo(() => {
    if (analysis.length === 0) return []
    return ANALYSIS_ROWS.map((row) => ({
      ...row,
      items: analysis
        .map((point, index) => ({ point, index }))
        .filter(({ point }) => point.kind === row.kind),
    })).filter((g) => g.items.length > 0)
  }, [analysis])

  /**
   * The asymptotes of this curve, already in words.
   *
   * These are NOT special points: an asymptote is a line the graph never
   * reaches, so it has no x and no y to put in the table's two columns and
   * nothing for an editor to move — the same reason the Hole row is read-only,
   * one step further. It is read over the analyzer's own range, so the
   * vertical ones listed here are the ones the features above were found
   * between.
   */
  const asymptotes = useMemo(
    () => (selected ? asymptoteTexts(curve, models, scale) : []),
    [selected, curve, models, scale],
  )

  /**
   * Where this curve meets the others, one line per other curve.
   *
   * These are NOT this curve's special points: an intersection belongs to a
   * PAIR, it is solved once for the board (src/ui/intersections.ts), and the
   * very same points are listed on the other curve's card with this curve's
   * name on them. That is the whole reason they arrive as a prop rather than
   * being computed here — two cards computing the same crossing separately is
   * two chances to print different answers to one question.
   */
  const crossings = useMemo(
    () => (intersections ?? []).filter((g) => g.points.length > 0),
    [intersections],
  )

  /**
   * Every EDITABLE value, in the order the table reads. Drives Enter-advances.
   *
   * A read-only row is skipped rather than landed on: Enter through the zeros
   * must not stop on a hole and open an editor that cannot commit.
   */
  const readingOrder = useMemo(
    () =>
      analysisGroups
        .filter((g) => !g.readOnly)
        .flatMap((g) => g.items.map(({ index }) => index)),
    [analysisGroups],
  )

  const activeDashKey =
    DASH_STYLES.find((d) => JSON.stringify(d.dash) === JSON.stringify(style?.dash))?.key ?? 'solid'

  /**
   * Only a curve with ends is asked about them: a circle or an ellipse closes
   * on itself, so there is nothing to cap and no question to answer.
   */
  const showsEnds = curve.kind !== 'implicit'

  /**
   * Where Enter should land next, remembered across the re-analysis a commit
   * causes. Indices are not stable across it — the points are rebuilt — so the
   * target is named the way a teacher would: "the second zero".
   */
  const advanceRef = useRef<{ kind: SpecialPointKind; ordinal: number } | null>(null)
  const [advanceTick, setAdvanceTick] = useState(0)

  const openFeatureEdit = (index: number): void => {
    const point = analysis[index]
    if (!point) return
    const keys = axisKeys(featureAxes(point.kind))
    // The button is replaced by inputs, so its own mouseleave can never fire.
    // Ownership of the marker emphasis passes to the editor: held while it is
    // open (the point being edited stays lit on canvas), released when it shuts.
    onAnalysisHover(index)
    setFeatureEdit({
      index,
      texts: keys.map((k) => formatCoord(point.pos[k], { scale, exact: point.exact })
        .replace(/−/g, '-')),
      bad: keys.map(() => false),
      flash: 0,
    })
  }

  const closeFeatureEdit = (): void => {
    setFeatureEdit(null)
    onAnalysisHover(null)
  }

  // The special points are recomputed whenever the curve's shape changes, so an
  // open editor would end up pointing at a different point than the one that was
  // clicked. Close it instead of letting it edit something else — UNLESS Enter
  // asked to move on, in which case the next value is opened by name.
  const analysisIdentityRef = useRef(analysis)
  useEffect(() => {
    const changed = analysisIdentityRef.current !== analysis
    analysisIdentityRef.current = analysis
    const next = advanceRef.current
    advanceRef.current = null
    if (next) {
      let seen = 0
      let found = -1
      for (let i = 0; i < analysis.length; i++) {
        if (analysis[i]?.kind !== next.kind) continue
        if (seen === next.ordinal) {
          found = i
          break
        }
        seen++
      }
      if (found >= 0) {
        openFeatureEdit(found)
        return
      }
      closeFeatureEdit()
      return
    }
    if (changed && featureEdit) {
      setFeatureEdit(null)
      onAnalysisHover(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, advanceTick])

  /**
   * Enter on an analysis value. A malformed field keeps the editor open and red;
   * a value the family cannot honour also keeps it open — the solver's own
   * reason is surfaced by the board, and the teacher is one keystroke from a
   * different answer.
   *
   * On success focus ADVANCES to the next editable value (zero → next zero)
   * rather than dropping to the body: "set three zeros to −2, 1, 3" is one
   * motion, and re-clicking between each one was measured as the worst friction
   * in the card.
   */
  const commitFeatureEdit = (): void => {
    const ed = featureEdit
    if (!ed) return
    const point = analysis[ed.index]
    if (!point) {
      closeFeatureEdit()
      return
    }
    const keys = axisKeys(featureAxes(point.kind))
    const parsed = ed.texts.map(parseNumeric)
    const nextBad = parsed.map((v) => v === null)
    if (nextBad.some(Boolean)) {
      setFeatureEdit({ ...ed, bad: nextBad, flash: ed.flash + 1 })
      const firstBad = nextBad.indexOf(true)
      featureInputsRef.current[firstBad]?.focus()
      featureInputsRef.current[firstBad]?.select()
      return
    }
    const to: { x?: number; y?: number } = {}
    keys.forEach((k, i) => {
      to[k] = parsed[i] as number
    })

    // Name the next value BEFORE the edit rebuilds the list.
    const at = readingOrder.indexOf(ed.index)
    const nextIndex = at >= 0 ? readingOrder[at + 1] : undefined
    const nextPoint = nextIndex === undefined ? null : analysis[nextIndex]
    const target =
      nextPoint === null || nextPoint === undefined
        ? null
        : {
            kind: nextPoint.kind,
            ordinal: analysis
              .slice(0, nextIndex)
              .filter((p) => p.kind === nextPoint.kind).length,
          }

    if (!onFeatureEdit(ed.index, to)) return
    advanceRef.current = target
    setAdvanceTick((t) => t + 1)
    if (!target) closeFeatureEdit()
  }

  // ---------------------------------------------------------------- the menu
  //
  // One control where three hover-only icons used to reserve 96px of the line
  // the equation needed. Everything that is not the equation lives behind it:
  // duplicate, hide, delete, copy the LaTeX, and the line's own style.
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
    const text = latexStr
    try {
      void navigator.clipboard?.writeText(text)
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

  const sliderEvents = {
    onPointerDown: onParamEditStart,
    onPointerUp: onParamEditEnd,
    onKeyDown: onParamEditStart,
    onKeyUp: onParamEditEnd,
    onBlur: onParamEditEnd,
  }


  // ----------------------------------------------------------- calculus bits
  //
  // Every number here is click-to-edit for the same reason the coefficients
  // and the analysis values are: "make the interval [0, 2]" is a sentence a
  // teacher says out loud, and hunting for it with a mouse is not.
  const calcNumber = (
    key: string,
    label: string,
    value: number,
    commit: (v: number) => void,
  ): JSX.Element => {
    if (calcEdit?.key === key) {
      return (
        <span className="calc-field">
          <span className="calc-field-label">{label}</span>
          <input
            ref={calcInputRef}
            className={`calc-input${calcEdit.bad ? ' param-edit-bad' : ''}`}
            type="text"
            inputMode="decimal"
            spellCheck={false}
            aria-label={label}
            value={calcEdit.text}
            onChange={(e) => setCalcEdit({ key, text: e.target.value, bad: false })}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                const v = parseNumeric(calcEdit.text)
                if (v === null) {
                  setCalcEdit({ ...calcEdit, bad: true })
                  return
                }
                commit(v)
                setCalcEdit(null)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setCalcEdit(null)
              }
            }}
            onBlur={() => setCalcEdit(null)}
          />
        </span>
      )
    }
    return (
      <button
        type="button"
        className="calc-field calc-field-btn"
        title={`Click to type an exact ${label}`}
        onClick={() =>
          setCalcEdit({ key, text: String(Number(value.toFixed(6))), bad: false })
        }
      >
        <span className="calc-field-label">{label}</span>
        <span className="calc-field-value">{formatCoord(value, { scale })}</span>
      </button>
    )
  }

  const boundFields = (
    linkId: string,
    from: number,
    to: number,
  ): JSX.Element => (
    <>
      {calcNumber(`${linkId}:from`, 'a', from, (v) =>
        onCalcChange({ kind: 'bound', linkId, which: 'from', value: v }),
      )}
      {calcNumber(`${linkId}:to`, 'b', to, (v) =>
        onCalcChange({ kind: 'bound', linkId, which: 'to', value: v }),
      )}
    </>
  )

  const dropBtn = (linkId: string, what: string): JSX.Element => (
    <button
      type="button"
      className="calc-drop"
      title={`Remove this ${what}`}
      aria-label={`Remove this ${what}`}
      onClick={() => onCalcRemove(linkId)}
    >
      ×
    </button>
  )

  // ------------------------------------------------------------- read as row
  const quality = useMemo(() => {
    try {
      return fitQuality(candidates)
    } catch {
      return candidates.map(() => 0)
    }
  }, [candidates])

  const activeCand = candidates.findIndex((c) => c.modelId === curve.modelId)
  const alsoFits = candidates
    .map((cand, i) => ({ cand, i }))
    .filter(({ i }) => i !== activeCand)
    .slice(0, ALSO_FITS)

  const showsSigma = derivesFromInk(curve, edited)

  return (
    <div
      className={`card${selected ? ' card-selected' : ''}${curve.visible ? '' : ' card-hidden'}${
        shaking ? ' card-shake' : ''
      }${broken ? ' card-broken-state' : ''}`}
      style={{ '--curve': curve.color } as CSSProperties}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${modelName} curve${curve.visible ? '' : ', hidden'}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      {/* Line 1: who this is. Colour, family, how well it fits, and the one
          menu that holds everything the equation's line used to give up room
          for. */}
      <div className="card-head">
        <button
          className="color-dot"
          style={{ background: curve.color }}
          title="Change colour"
          aria-label="Change curve colour"
          onClick={(e) => {
            e.stopPropagation()
            onCycleColor()
          }}
        />
        <span className="model-name">{broken ? 'Equation' : modelName}</span>
        {broken ? (
          <span className="err-badge err-badge-bad" title={brokenReason}>
            can’t restore
          </span>
        ) : showsSigma ? (
          <span
            className="err-badge"
            title="How far the fitted curve sits from the ink you drew (RMS, math units)"
          >
            fit σ {formatError(curve.error)}
          </span>
        ) : null}
        {!curve.visible && <span className="card-flag">hidden</span>}

        <div className="card-menu-wrap" ref={menuRef}>
          <button
            ref={menuBtnRef}
            type="button"
            className={`card-menu-btn${menuOpen ? ' card-menu-btn-open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Curve menu"
            title="More — duplicate, hide, delete, copy LaTeX, line style"
            onClick={(e) => {
              e.stopPropagation()
              onSelect()
              setMenuOpen((o) => !o)
            }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div
              className={`card-menu${showsEnds ? ' card-menu-ends' : ''}`}
              role="menu"
              onClick={(e) => e.stopPropagation()}
            >
              {menuItem('Duplicate', onDuplicate)}
              {menuItem(curve.visible ? 'Hide' : 'Show', onToggleVisible)}
              {menuItem(copied ? 'Copied' : 'Copy LaTeX', copyLatex)}
              {menuItem('Delete', onDelete, 'card-menu-danger')}
              {calc?.canAdd && (
                <>
                  <div className="card-menu-sep" />
                  <div className="card-menu-title">Calculus</div>
                  {CALC_ITEMS.map((item) =>
                    menuItem(item.label, () => onAddCalc(item.kind)),
                  )}
                  {between?.canAdd &&
                    menuItem('Area between curves…', onAddAreaBetween)}
                </>
              )}
              <div className="card-menu-sep" />
              <div className="card-menu-title">Line</div>
              <div className="style-row card-menu-style">
                <input
                  type="range"
                  className="style-slider style-slider-width"
                  title="Stroke width"
                  aria-label="Stroke width"
                  min={1}
                  max={6}
                  step={0.5}
                  value={curve.strokeWidth}
                  style={fillStyle(curve.strokeWidth, 1, 6)}
                  {...sliderEvents}
                  onChange={(e) => onStrokeWidth(Number(e.target.value))}
                />
                <div className="dash-seg" role="group" aria-label="Line style">
                  {DASH_STYLES.map((d) => (
                    <button
                      key={d.key}
                      className={`dash-btn${activeDashKey === d.key ? ' dash-on' : ''}`}
                      title={d.title}
                      onClick={() => onDash(d.dash)}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  className="style-slider style-slider-opacity"
                  title="Opacity"
                  aria-label="Opacity"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={style?.opacity ?? 1}
                  style={fillStyle(style?.opacity ?? 1, 0.1, 1)}
                  {...sliderEvents}
                  onChange={(e) => onOpacity(Number(e.target.value))}
                />
              </div>
              {/* What the two ends of the graph SAY. A circle or an ellipse
                  has no ends, so the row is not there to be answered. */}
              {showsEnds && (
                <>
                  <div className="card-menu-title">Ends</div>
                  <div className="style-row card-menu-style ends-row">
                    {END_SIDES.map((which) => {
                      const name = endSideName(curve.kind, which)
                      const chosen = style?.ends?.[which] ?? 'auto'
                      return (
                        <div key={which} className="ends-seg" role="group" aria-label={name}>
                          {END_CAPS.map((c) => (
                            <button
                              key={c.cap}
                              type="button"
                              className={`ends-btn${chosen === c.cap ? ' dash-on' : ''}`}
                              title={`${name}: ${c.title}`}
                              aria-label={`${name}: ${c.title}`}
                              aria-pressed={chosen === c.cap}
                              onClick={() => onEnds(which, c.cap)}
                            >
                              {which === 'start' && c.leftGlyph ? c.leftGlyph : c.glyph}
                            </button>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Line 2: the product's own output, on a line of its own, wrapping
          rather than clipping. It was a 149px box holding up to 302px of
          content behind a gradient mask. */}
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
            aria-label="Equation"
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
        ) : equationSeed === null ? (
          <div
            className="card-formula card-eq"
            title={`A ${modelName.toLowerCase()} has no equation form to type — drag its handles or pick another reading`}
          >
            <Latex tex={latexStr} className="card-latex" />
          </div>
        ) : (
          <button
            type="button"
            className="card-formula card-formula-btn card-eq"
            title="Click to edit this equation"
            onClick={(e) => {
              e.stopPropagation()
              onSelect()
              openEqEdit()
            }}
          >
            <Latex tex={latexStr} className="card-latex" />
          </button>
        )}
      </div>

      {/* What this curve IS, when it is not a sketch: the tangent's point and
          its slope, or f′ and whose. Always visible, never only when the card
          is open — a tangent that has just gone away (a corner, a pole) has to
          say so whether or not anybody expanded it. */}
      {calc?.origin && (
        <div
          className={`calc-origin${calc.origin.problem ? ' calc-origin-bad' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="calc-origin-line">
            <span className="calc-origin-text">{calc.origin.lead}</span>
            {calc.origin.x !== null &&
              calcNumber(`${calc.origin.linkId}:x`, 'x', calc.origin.x, (v) =>
                onCalcChange({ kind: 'tangentX', linkId: calc.origin!.linkId, x: v }),
              )}
            {calc.origin.tail && (
              <span className="calc-origin-text">{calc.origin.tail}</span>
            )}
          </div>
          {calc.origin.problem && (
            <div className="calc-why">
              {`No line is drawn: ${calc.origin.problem}.`}
            </div>
          )}
        </div>
      )}

      {eqEdit && (
        <div className="card-eq-foot" onClick={(e) => e.stopPropagation()}>
          {eqEdit.error && <div className="expr-error">{eqEdit.error}</div>}
          <div className="expr-hint">Enter saves · Esc cancels</div>
        </div>
      )}

      {broken && (
        <div className="card-broken">
          <code className="card-broken-src">{exprSource}</code>
          <span className="card-broken-why">
            This equation couldn’t be rebuilt when the document was opened ({brokenReason}). Its
            place is kept here so nothing is lost — retype it to restore the curve.
          </span>
        </div>
      )}

      {selected && (
        <div className="card-body" onClick={(e) => e.stopPropagation()}>
          {/* Teaching order: the numbers you move, then what they do to the
              curve, and only then which curve this is being read as. */}
          {meta.length > 0 && (
            <div className="param-list">
              {(() => {
                const values = meta.map((m, row) => curve.params[paramIndex[row] ?? row] ?? 0)
                const texts = alignedValues(values, scale)
                return meta.map((m, row) => {
                  // The parameter this row edits — NOT the row's own position.
                  const i = paramIndex[row] ?? row
                  return (
                    <ParamRow
                      key={`${curve.modelId}-${m.name}-${row}`}
                      name={m.name}
                      value={values[row]}
                      text={texts[row]}
                      min={m.min}
                      max={m.max}
                      step={m.step}
                      snapped={snapMask?.[i] === true}
                      snapKey={snapKey}
                      onChange={(v) => onParamChange(i, v)}
                      onEditStart={onParamEditStart}
                      onCommit={onParamCommit}
                      onEditEnd={onParamEditEnd}
                      onSetExact={(v) => onParamSetExact(i, v)}
                    />
                  )
                })
              })()}
            </div>
          )}

          {(analysisGroups.length > 0 ||
            asymptotes.length > 0 ||
            crossings.length > 0) && (
            <div className="an-section">
              <div className="an-title">Analysis</div>
              <div className="an-table">
                {analysisGroups.map((g) => (
                  <div className="an-row" key={g.kind}>
                    <span className="an-label">
                      {g.items.length > 1 ? (g.plural ?? g.label) : g.label}
                    </span>
                    <span className="an-values">
                      {g.items.map(({ point, index }, n) => {
                        const keys = axisKeys(featureAxes(point.kind))
                        const pair = keys.length > 1
                        const last = n === g.items.length - 1
                        // The separator is part of the value's own text: a
                        // comma that can wrap on its own ends a line with a
                        // dangling punctuation mark.
                        const parts = pointParts(point, { scale })
                        // Both readings in one attribute, for a copy or a test
                        // that wants the value as a value. Only emitted where
                        // there IS a closed form, so a row of plain decimals
                        // is the markup it has always been.
                        const text = parts.text
                        const comma = last ? '' : ','
                        // A point the analyzer knows in closed form says so
                        // FIRST and keeps the decimal beside it, quietly: the
                        // exact value is the answer the question was asking
                        // for, and the decimal is what you check it against.
                        // With no closed form this is the single text node the
                        // row has always been, character for character.
                        const valueNode =
                          parts.exact === null ? (
                            parts.decimal + comma
                          ) : (
                            <>
                              <span
                                className="an-exact"
                                title={exactTitle(point, parts.exact)}
                              >
                                {parts.exact}
                              </span>
                              <span className="an-approx">{` ${APPROX} ${parts.decimal}${comma}`}</span>
                            </>
                          )
                        // A hole is stated, never offered: it is the one place
                        // the formula has no value, so there is nothing for an
                        // editor to move. No button, no hover, no hint.
                        if (g.readOnly) {
                          return (
                            <span
                              className="an-value an-value-static"
                              key={index}
                              data-value={parts.exact === null ? undefined : text}
                            >
                              {valueNode}
                            </span>
                          )
                        }
                        if (featureEdit?.index === index) {
                          return (
                            <span
                              className="an-edit"
                              key={index}
                              onBlur={(e) => {
                                // Tabbing between x and y must not close it.
                                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                                  closeFeatureEdit()
                                }
                              }}
                            >
                              {pair && <span className="an-edit-punct">(</span>}
                              {keys.map((k, i) => (
                                <span className="an-edit-cell" key={k}>
                                  {i > 0 && <span className="an-edit-punct">,</span>}
                                  <input
                                    ref={(el) => {
                                      featureInputsRef.current[i] = el
                                    }}
                                    className={`an-edit-input${
                                      featureEdit.bad[i]
                                        ? featureEdit.flash % 2 === 0
                                          ? ' an-edit-bad-a'
                                          : ' an-edit-bad-b'
                                        : ''
                                    }`}
                                    type="text"
                                    inputMode="decimal"
                                    spellCheck={false}
                                    autoComplete="off"
                                    aria-label={`${point.label} ${k}`}
                                    aria-invalid={featureEdit.bad[i] || undefined}
                                    value={featureEdit.texts[i]}
                                    onChange={(e) => {
                                      const texts = featureEdit.texts.slice()
                                      texts[i] = e.target.value
                                      const bad = featureEdit.bad.slice()
                                      bad[i] = false
                                      setFeatureEdit({ ...featureEdit, texts, bad })
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault()
                                        commitFeatureEdit()
                                      } else if (e.key === 'Escape') {
                                        e.preventDefault()
                                        closeFeatureEdit()
                                      }
                                    }}
                                  />
                                </span>
                              ))}
                              {pair && <span className="an-edit-punct">)</span>}
                              {!last && <span className="an-sep">,</span>}
                            </span>
                          )
                        }
                        return (
                          <button
                            key={index}
                            className="an-value"
                            data-value={parts.exact === null ? undefined : text}
                            title={
                              pair
                                ? `Click to set this ${point.label} to exact coordinates`
                                : `Click to set this ${point.label} to an exact ${keys[0]}`
                            }
                            onMouseEnter={() => onAnalysisHover(index)}
                            onMouseLeave={() => onAnalysisHover(null)}
                            onFocus={() => onAnalysisHover(index)}
                            onBlur={() => onAnalysisHover(null)}
                            onClick={() => openFeatureEdit(index)}
                          >
                            {valueNode}
                            {point.tangent && <span className="an-note">touches</span>}
                          </button>
                        )
                      })}
                    </span>
                  </div>
                ))}
                {/* After the holes: what the graph never reaches. Stated, not
                    offered — moving an asymptote is not a sentence about this
                    function, it is a different function. */}
                {asymptotes.length > 0 && (
                  <div className="an-row" key="asymptote">
                    <span className="an-label">
                      {asymptotes.length > 1 ? 'Asymptotes' : 'Asymptote'}
                    </span>
                    <span className="an-values">
                      {asymptotes.map((text, n) => (
                        <span className="an-value an-value-static" key={`${text}-${n}`}>
                          {n === asymptotes.length - 1 ? text : `${text},`}
                        </span>
                      ))}
                    </span>
                  </div>
                )}
                {/* And last, the one row that is not about this curve
                    alone: where it MEETS the others. Stated, never offered —
                    a crossing is a consequence of two functions, and there is
                    no single value an editor could move to put it somewhere
                    else. Each other curve gets its own line, named the way the
                    figure's caption names it. */}
                {crossings.length > 0 && (
                  <div className="an-row" key="intersections">
                    <span className="an-label">
                      {crossings.length > 1 || crossings[0].points.length > 1
                        ? 'Intersections'
                        : 'Intersection'}
                    </span>
                    <span className="an-values">
                      {crossings.map((g) => (
                        <span className="an-with" key={g.id}>
                          <span className="an-with-name">{`with ${g.name}:`}</span>{' '}
                          {g.points.map((point, n) => {
                            const parts = pointParts(point, { scale })
                            const comma = n === g.points.length - 1 ? '' : ','
                            return (
                              <span
                                className="an-value an-value-static"
                                key={`${g.id}-${n}`}
                                data-value={parts.exact === null ? undefined : parts.text}
                              >
                                {parts.exact === null ? (
                                  parts.decimal + comma
                                ) : (
                                  <>
                                    <span
                                      className="an-exact"
                                      title={exactTitle(point, parts.exact)}
                                    >
                                      {parts.exact}
                                    </span>
                                    <span className="an-approx">{` ${APPROX} ${parts.decimal}${comma}`}</span>
                                  </>
                                )}
                              </span>
                            )
                          })}
                        </span>
                      ))}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {calc &&
            (calc.areas.length > 0 ||
              calc.riemanns.length > 0 ||
              betweenNotes.length > 0) && (
            <div className="calc-section">
              <div className="calc-title">Calculus</div>
              <div className="calc-list">
                {/* This curve is somebody else's other half. One line, no
                    controls: the region is ONE object, and two cards offering
                    to edit it would be two sets of a and b for one interval.
                    What this card owes the teacher is the reason the shading
                    is here and the name of the card that owns it. */}
                {betweenNotes.map((note, i) => (
                  <div className="calc-row calc-row-quiet" key={`between-note-${i}`}>
                    <div className="calc-line">
                      <span className="calc-tag">Between</span>
                      <span className="calc-read calc-read-quiet">{note}</span>
                    </div>
                  </div>
                ))}

                {calc.areas.map((a) => {
                  const other = a.otherLabel ?? null
                  return (
                  <div className="calc-row" key={a.linkId}>
                    <div className="calc-line">
                      <span className="calc-tag">{other ? 'Between' : 'Area'}</span>
                      {other ? (
                        <span className="calc-read calc-between" title="The region between these two curves">
                          {`${selfLabel} and ${other}`}
                        </span>
                      ) : (
                        <span className="calc-read">{a.text}</span>
                      )}
                      {!other && a.samples !== null && (
                        <span
                          className="calc-note"
                          title="This integral has no closed form, so it was measured — at this many evaluations of the function."
                        >
                          {`${a.samples} samples`}
                        </span>
                      )}
                      {dropBtn(a.linkId, 'shaded area')}
                    </div>
                    {/* Between curves the first line says WHICH two, so the
                        number gets a line of its own rather than being
                        squeezed in beside a pair of equations. */}
                    {other && (
                      <div className="calc-line calc-line-read">
                        <span className="calc-read">{a.text}</span>
                        {a.samples !== null && (
                          <span
                            className="calc-note"
                            title="This integral has no closed form, so it was measured — at this many evaluations of the function."
                          >
                            {`${a.samples} samples`}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="calc-controls">
                      {boundFields(a.linkId, a.from, a.to)}
                      <button
                        type="button"
                        className={`calc-chip${a.abs ? ' calc-chip-on' : ''}`}
                        aria-pressed={a.abs}
                        title={
                          other
                            ? a.abs
                              ? 'Showing the area between the curves, ∫|f − g| — top minus bottom wherever they cross. Click for the signed integral ∫(f − g).'
                              : 'Showing the signed integral ∫(f − g), which cancels where the curves swap over. Click for the area between them.'
                            : a.abs
                              ? 'Showing total area. Click for the signed integral (the AP convention).'
                              : 'Showing the signed integral (the AP convention). Click for total area.'
                        }
                        onClick={() =>
                          onCalcChange({ kind: 'abs', linkId: a.linkId, abs: !a.abs })
                        }
                      >
                        {other ? (a.abs ? '|f − g|' : 'signed') : '|area|'}
                      </button>
                    </div>
                    {a.problem && <div className="calc-why">{a.problem}</div>}
                  </div>
                  )
                })}

                {calc.riemanns.map((r) => (
                  <div className="calc-row" key={r.linkId}>
                    <div className="calc-line">
                      <span className="calc-tag">Riemann</span>
                      <span className="calc-read">{r.text}</span>
                      {dropBtn(r.linkId, 'Riemann sum')}
                    </div>
                    <div className="calc-controls">
                      {boundFields(r.linkId, r.from, r.to)}
                      <select
                        className="calc-select"
                        aria-label="Riemann method"
                        value={r.method}
                        onChange={(e) =>
                          onCalcChange({
                            kind: 'method',
                            linkId: r.linkId,
                            method: e.target.value as typeof r.method,
                          })
                        }
                      >
                        {RIEMANN_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {METHOD_LABELS[m] ?? m}
                          </option>
                        ))}
                      </select>
                    </div>
                    {/* n is a slider because the lesson is watching it move:
                        drag it to 200 and the sum walks onto the integral. */}
                    <div className="calc-n">
                      <span className="calc-n-label">n</span>
                      <input
                        type="range"
                        min={N_MIN}
                        max={N_MAX}
                        step={1}
                        value={r.n}
                        aria-label="Number of rectangles"
                        style={fillStyle(r.n, N_MIN, N_MAX)}
                        onPointerDown={onParamEditStart}
                        onPointerUp={onParamEditEnd}
                        onKeyDown={onParamEditStart}
                        onKeyUp={onParamEditEnd}
                        onBlur={onParamEditEnd}
                        onChange={(e) =>
                          onCalcChange(
                            { kind: 'n', linkId: r.linkId, n: Number(e.target.value) },
                            true,
                          )
                        }
                      />
                      <span className="calc-n-value">{r.n}</span>
                    </div>
                    {r.problem && <div className="calc-why">{r.problem}</div>}
                    {r.skipped > 0 && (
                      <div className="calc-why">
                        {`${r.skipped} rectangle${r.skipped === 1 ? '' : 's'} sit where the curve is undefined, and count for nothing.`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isExpression && candidates.length > 1 && (
            <div className="cand-section">
              <div className="readas-row">
                <span className="readas-label">Read as</span>
                <select
                  className="readas-select"
                  aria-label="Read this sketch as"
                  value={activeCand >= 0 ? String(activeCand) : ''}
                  onChange={(e) => {
                    const i = Number(e.target.value)
                    const cand = candidates[i]
                    if (cand) onApplyCandidate(cand)
                  }}
                >
                  {activeCand < 0 && <option value="">Edited</option>}
                  {candidates.map((cand, i) => (
                    <option key={`${cand.modelId}-${i}`} value={String(i)}>
                      {`${models[cand.modelId]?.name ?? cand.modelId} — fits ${qualityText(
                        quality[i] ?? 0,
                      )}`}
                    </option>
                  ))}
                </select>
                {alsoFits.length > 0 && (
                  <span className="readas-also">
                    <span className="readas-also-label">also fits:</span>
                    {alsoFits.map(({ cand, i }, k) => (
                      <span key={`${cand.modelId}-${i}`} className="readas-chip-wrap">
                        {k > 0 && <span className="readas-dot">·</span>}
                        <button
                          type="button"
                          className="readas-chip"
                          title={`Read this sketch as a ${(
                            models[cand.modelId]?.name ?? cand.modelId
                          ).toLowerCase()} — fits ${qualityText(quality[i] ?? 0)} as tightly as the best reading`}
                          onClick={() => onApplyCandidate(cand)}
                        >
                          {models[cand.modelId]?.name ?? cand.modelId}
                        </button>
                      </span>
                    ))}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
