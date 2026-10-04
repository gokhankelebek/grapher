import { Fragment, memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type {
  Asymptote,
  EndCap,
  FitResult,
  FittedCurve,
  ModelSpec,
  ParamMeta,
  SpecialPoint,
  SpecialPointKind,
  Vec2,
} from '../core/types'
import type { CurveStyle } from '../core/persist'
import { useStableHandlers } from './stableProps'
import { cardModelsKey } from './valueKeys'
import { RootsSection } from './FactorEditor'
import { safeReadFactored } from './factorLinks'
import { ExpSection } from './ExpEditor'
import { fittedExp, safeReadExponential } from './expLinks'
import { LogSection } from './LogEditor'
import { fittedLog, safeReadLogarithmic } from './logLinks'
import { SinSection } from './SinEditor'
import { fittedSine, safeReadSinusoid } from './sinLinks'
import { LogisticSection } from './LogisticEditor'
import { fittedLogistic, safeReadLogistic } from './logisticLinks'
import { TransformSection } from './TransformEditor'
import { safeReadTransform, transformOpenByDefault, transformOwnsHandles } from './transformLinks'
import { PiecewiseSection } from './PiecewiseEditor'
import { ConicSection } from './ConicEditor'
import { MotionSection } from './MotionEditor'
import { motionKindOf } from './motionLinks'
import type { MotionPlayState, MotionScales } from './motionLinks'
import { conicSectionInfo, fittedCircle, fittedEllipse } from './conicLinks'
import { piecewiseOpenByDefault, piecewiseSectionSpec } from './piecewiseLinks'
import type { FunctionEnv } from '../core/functionEnv'
import { fitQuality } from '../core/fit/recognize'
import { findAsymptotes } from '../core/holes'
import { zeroIntervals } from '../core/analyze'
import { complexZerosOf } from './complexLinks'
import { ComplexZerosSection } from './ComplexZerosSection'
import type { ZeroInterval } from '../core/analyze'
import { exactForm } from '../core/exact'
import { Latex } from './Latex'
import { APPROX, exactDetail, formatCoord, parseNumeric, pointParts } from './numeric'
import { alignedValues, curveScale, curveXScale, derivesFromInk } from './curveState'
import { axisKeys, featureAxes } from './featureEdit'
import { curveEquationText, displayEquationLatex } from './equationText'
import { N_MAX, N_MIN, RIEMANN_METHODS } from './calcLinks'
import type { CalcChange, CalcKind, CardCalc } from './calcLinks'
import { CALC_GROUPS, calcMenuOffers } from './calcMenu'
import { TaylorSection } from './TaylorSection'
import { SecantSection } from './SecantSection'
import { ParamCalcSection, PolarBetweenSection } from './ParamCalcSection'
import { LimitSection } from './LimitSection'
import { SignChartSection } from './SignChartSection'
import { VolumeSection } from './VolumeSection'
import type { CurveIntersections } from './intersections'
import { DomainSection } from './DomainSection'
import { ImplicitSection } from './ImplicitSection'
import { CardSection } from './CardSection'
import { InequalitySection } from './InequalitySection'
import { TableSection } from './TableSection'
import { CircleSection } from './CircleSection'
import type { CircleActions } from './CircleSection'
import type { CirclePanel } from './circleLinks'
import type { TableActions } from './TableSection'
import type { TablePanel } from './valueTableLinks'
import { setRowText } from './domainLinks'
import { Answer, AnswerTex, AnswerText, RevealPill, useReveal } from './RevealAnswer'
import { asymKey, calcKey, coincideKey, domainKey, rangeKey } from './reveal'
import type { DomainActions, DomainPanel, SetNotation } from './domainLinks'
import { useInk } from './inkContext'
import { equationLabel, speakLatex } from '../core/mathSpeech'

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
  /**
   * Rewrite this TYPED curve's line in place — same id, colour and links —
   * from its Roots section. Absent = no Roots section (tests, number lines).
   */
  onFactorRestate?(src: string, label: string): string | null
  /** The point this curve was built through, whose `a` is re-solved on edit. */
  factorThrough?: Vec2 | null
  /** Stop keeping that point. */
  onFactorThroughDrop?(): void
  /**
   * Rewrite this TYPED curve's line in place from its Exponential section —
   * the same restate path as the Roots section. Absent = no section.
   */
  onExpRestate?(src: string, label: string): string | null
  /**
   * Replace this SKETCHED curve with a typed line, in place ("Convert to
   * typed exponential"). Absent = no menu item.
   */
  onConvertTyped?(src: string, label: string): string | null
  /**
   * Rewrite this TYPED curve's line in place from its Logarithmic section —
   * the same restate path again. Absent = no section.
   */
  onLogRestate?(src: string, label: string): string | null
  /**
   * "Show inverse" on the Exponential or Logarithmic section: add the exact
   * inverse as a new typed curve (and y = x once). Absent = no button.
   */
  onShowInverse?(): void
  /**
   * Rewrite this TYPED curve's line in place from its Sinusoidal section —
   * the same restate path again. Absent = no section.
   */
  onSinRestate?(src: string, label: string): string | null
  /**
   * Rewrite this TYPED curve's line in place from its Logistic section — the
   * same restate path again. Absent = no section on a typed logistic. (A
   * SKETCHED logistic's section edits through onConvertTyped.)
   */
  onLogisticRestate?(src: string, label: string): string | null
  /**
   * "Show slope field" on the Logistic section: add dy/dx = k·y·(1 − y/L)
   * with this curve's y(0) as a solution. Absent = no button.
   */
  onShowLogisticField?(): void
  /**
   * Rewrite this TYPED curve's line in place from its Transformation section
   * — the same restate path again. Absent = no section.
   */
  onTransformRestate?(src: string, label: string): string | null
  /**
   * Rewrite this TYPED curve's piecewise line in place from its Piecewise
   * section (a table of pieces) — the same restate path. Absent = no section.
   */
  onPiecewiseRestate?(src: string, label: string): string | null
  /** The env a rewritten piecewise line is parsed against (its calls of named curves). */
  piecewiseEnvFor?(src: string): FunctionEnv | undefined
  /**
   * Rewrite this TYPED curve's line in place from its Conic section (an
   * implicit line read as a circle, ellipse, hyperbola or parabola) — the
   * same restate path. Absent = the section is read-only.
   */
  onConicRestate?(src: string, label: string): string | null
  /** Whether this conic's construction (foci, directrix, asymptotes, box) is figure content. */
  conicConstruction?: boolean
  /** The "show construction" switch. Absent = no switch. */
  onConicConstruction?(on: boolean): void
  /**
   * A parametric or polar curve's player (the Motion section): t, play /
   * pause, speed, the vectors, the shaded polar area. Absent = the section
   * reads at the interval's start and is read-only.
   */
  motion?: MotionPlayState
  /** The vectors' drawn scales on this board. */
  motionScales?: MotionScales
  onMotionPlay?(patch: Partial<MotionPlayState>): void
  /** Commit a new parameter interval (a typed line is restated). Error, or null. */
  onMotionInterval?(lo: string, hi: string): string | null
  /**
   * Whether the board shows the parent's ghost and the key-point arrows for
   * this curve. Absent = the section's own default (open ⇒ shown).
   */
  transformShowParent?: boolean
  /** The "show parent" switch. Absent = no switch. */
  onTransformShowParent?(on: boolean): void
  /**
   * What this curve is CALLED — its stored letter (f), or what it is named
   * after its parent (f′, f⁻¹). Shown as a chip in the header. Absent: no
   * chip (a tangent line, an implicit curve).
   */
  name?: string
  /** The chip can be renamed (the curve holds a letter of its own). */
  nameEditable?: boolean
  /**
   * Rename: every line that calls the old letter is rewritten. Returns the
   * refusal to show ("g is already the name of another curve"), or null.
   */
  onRename?(letter: string): string | null
  /**
   * Why this typed line can't be drawn right now — "f is not defined", "f and
   * g use each other". Absent when it can.
   */
  linkError?: string
  /** A read-only line under the equation: an inverse's horizontal line test. */
  note?: string
  /** "Show inverse" on the ⋯ menu (any explicit curve). Absent = no item. */
  onShowInverseOf?(): void
  /**
   * The state of the curves this line calls. Part of every memo key here, so
   * g's asymptotes follow f's slider although g's own params never move.
   */
  depKey?: string
  /**
   * Domain, range, one-to-one and the inverse — the rows at the top of the
   * Analysis table (src/ui/DomainSection.tsx). Only the selected card is
   * handed one; absent = no rows.
   */
  domainPanel?: DomainPanel
  domainActions?: DomainActions
  /** Interval notation or set-builder (a global preference). */
  setNotation?: SetNotation
  /**
   * The Table section (src/ui/TableSection.tsx): a table of values, Evaluate,
   * compare, divide by (x − a). Only the selected explicit card is handed
   * one; absent = no section.
   */
  tablePanel?: TablePanel
  tableActions?: TableActions
  /**
   * The Circle theorems section (src/ui/CircleSection.tsx): points on the
   * circle, inscribed / central angles, the tangent, arc and sector. Only the
   * selected circle's card is handed one; absent = no section.
   */
  circlePanel?: CirclePanel
  circleActions?: CircleActions
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

/** The ⋯ menu's calculus groups and the rule for which it offers live in calcMenu.ts (shared with the command palette). */
export { CALC_GROUPS }

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

/** One end of a zero interval: its closed form (0, 1/3, √2) when it has one, else four digits. */
function zeroEndText(v: number): string {
  if (Math.abs(v) < 1e-12) return '0'
  const e = exactForm(v)
  if (e) return e.text
  const r = Number(v.toPrecision(4))
  const t = String(r)
  return t.startsWith('-') ? '−' + t.slice(1) : t
}

/**
 * A stretch where f is identically zero, as a class writes it: "0 ≤ x < 1",
 * "−1 < x ≤ 0". An end that is only where the analysis stopped looking (the
 * edge of `span`) is not a bound of the zero set, so it is written "…".
 */
export function zeroIntervalText(z: ZeroInterval, span: readonly [number, number]): string {
  const w = Math.max(1, Math.abs(span[1] - span[0]))
  const atEdge = (v: number, edge: number) => Math.abs(v - edge) <= 1e-9 * w
  const lo = atEdge(z.lo, span[0]) ? '… <' : `${zeroEndText(z.lo)} ${z.loClosed ? '≤' : '<'}`
  const hi = atEdge(z.hi, span[1]) ? '< …' : `${z.hiClosed ? '≤' : '<'} ${zeroEndText(z.hi)}`
  return `${lo} x ${hi}`
}

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
        aria-label={`Parameter ${speakLatex(name)}`}
        aria-valuetext={`${speakLatex(name)} = ${text}`}
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
          aria-label={`${speakLatex(name)} exact value`}
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
          aria-label={`${speakLatex(name)} = ${text}. Type an exact value`}
          onClick={() => setEditing({ text: String(value), bad: false })}
        >
          {text}
        </button>
      )}
    </div>
  )
}

/**
 * The card as the sidebar renders it: memoised, with every handler made
 * stable (src/ui/stableProps.ts), so a slider drag on one curve re-renders
 * that curve's card — not all of them, every frame.
 */
const CurveCardMemo = memo(CurveCard)
export function StableCurveCard(props: Props) {
  const stable = useStableHandlers(props)
  // `models` is a new map whenever ANY model is registered — a Taylor
  // polynomial's on every frame its parent's slider moves — which re-rendered
  // every card on the board each frame. A card only ever reads its own
  // curve's model and its candidates' (cardModelsKey), so it keeps the map it
  // last rendered with until one of THOSE changes.
  const key = cardModelsKey(props.curve, props.models, props.candidates)
  const held = useRef<{ key: string; models: Props['models'] } | null>(null)
  if (!held.current || held.current.key !== key) held.current = { key, models: props.models }
  return <CurveCardMemo {...stable} models={held.current.models} />
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
  onFactorRestate,
  factorThrough,
  onFactorThroughDrop,
  onExpRestate,
  onConvertTyped,
  onLogRestate,
  onShowInverse,
  onSinRestate,
  onLogisticRestate,
  onShowLogisticField,
  onTransformRestate,
  onPiecewiseRestate,
  piecewiseEnvFor,
  onConicRestate,
  conicConstruction,
  onConicConstruction,
  motion,
  motionScales,
  onMotionPlay,
  onMotionInterval,
  transformShowParent,
  onTransformShowParent,
  name,
  nameEditable = false,
  onRename,
  linkError,
  note,
  onShowInverseOf,
  domainPanel,
  domainActions,
  setNotation,
  depKey,
  tablePanel,
  tableActions,
  circlePanel,
  circleActions,
}: Props) {
  const ink = useInk()
  const spec: ModelSpec | undefined = models[curve.modelId]
  const isExpression = curve.modelId.startsWith('expr_')
  /** Reveal mode: which computed answers on this card stand as pills (src/ui/reveal.ts). */
  const revealApi = useReveal()
  /** A derived curve (tangent, f′, Pₙ, accumulation): its equation is computed — an answer. */
  const derivedKey = calc?.origin ? calcKey(calc.origin.linkId) : null
  const derivedHidden = derivedKey !== null && revealApi.hidden(derivedKey)
  /**
   * A typed curve whose model couldn't be rebuilt: shown, but inert. A line
   * that CALLS another curve (it has a depKey) is treated the same way by the
   * section readers below: they read the text without the names it calls,
   * and `2f(x − 1) + 3` read that way is a product of sliders, not a
   * transformation of anything this card could edit.
   */
  const broken = Boolean(brokenReason)
  /**
   * A typed two-variable inequality (y < x² − 4): its card says which side is
   * shaded and tests a point; no family section reads its line, because the
   * line is a region, not the function its boundary happens to be.
   */
  const inequality = useMemo(() => {
    if (!spec || typeof spec.inequality !== 'function') return null
    try {
      return spec.inequality(curve.params)
    } catch {
      return null
    }
  }, [spec, curve.params])
  const readable = !broken && depKey === undefined && typeof spec?.inequality !== 'function'

  /**
   * The curve's line read back as factors — "y = (x + 1)^2(x - 3)" is a
   * leading coefficient and two roots — or null for anything else (an
   * unfactored x^2 - 1, a sketch, a sum of products). Only a typed curve:
   * a sketched cubic already has its own zero handles.
   */
  const factored = useMemo(
    () => (isExpression && readable && curve.kind === 'explicit' ? safeReadFactored(exprSource) : null),
    [isExpression, readable, curve.kind, exprSource],
  )

  /**
   * The line read back as an exponential — "y = 200(1/2)^(x/5.7) + 10" is a
   * starting value, a half-life and an asymptote — or null. Only a typed
   * curve, and never one the Roots section already speaks for.
   */
  const exponential = useMemo(
    () =>
      isExpression && readable && curve.kind === 'explicit' && !factored
        ? safeReadExponential(exprSource)
        : null,
    [isExpression, readable, curve.kind, exprSource, factored],
  )

  /**
   * The line read back as a logarithm — "y = ln(x - 1) + 2", "y = log_2(x)",
   * "y = 3log(2x)", however it was typed — or null. Only a typed curve that
   * neither section above already speaks for.
   */
  const logarithmic = useMemo(
    () =>
      isExpression && readable && curve.kind === 'explicit' && !factored && !exponential
        ? safeReadLogarithmic(exprSource)
        : null,
    [isExpression, readable, curve.kind, exprSource, factored, exponential],
  )

  /**
   * The line read back as a sinusoid — "y = 3sin(2(x - pi/4)) + 1", a
   * hand-typed 3sin(2x - pi/2) + 1 or 4 - 2cos(x), and sin(x) + cos(x) folded
   * into one — or null. Only a typed curve none of the sections above
   * already speaks for (the shapes cannot overlap; the order is kept anyway).
   */
  const sinusoidal = useMemo(
    () =>
      isExpression &&
      readable &&
      curve.kind === 'explicit' &&
      !factored &&
      !exponential &&
      !logarithmic
        ? safeReadSinusoid(exprSource)
        : null,
    [isExpression, readable, curve.kind, exprSource, factored, exponential, logarithmic],
  )

  /**
   * The line read back as a LOGISTIC — "y = 1000/(1 + 49e^(-0.3x))",
   * "P(t) = 10/(1 + e^(-2(t - 3))) + 1", e^x/(1 + e^x) — or null. Only a typed
   * curve none of the sections above speaks for (none of their shapes is a
   * quotient over 1 + an exponential; the order is kept anyway).
   */
  const logistic = useMemo(
    () =>
      isExpression &&
      readable &&
      curve.kind === 'explicit' &&
      !factored &&
      !exponential &&
      !logarithmic &&
      !sinusoidal
        ? safeReadLogistic(exprSource)
        : null,
    [isExpression, readable, curve.kind, exprSource, factored, exponential, logarithmic, sinusoidal],
  )

  /**
   * The line read as a TRANSFORMED PARENT, y = a·f(b(x − h)) + k — a
   * hand-typed -2(x-3)^2+1, |2x-6|+1, sqrt(4-x), x^2 - 6x + 8 (vertex form),
   * 1/(x+2) - 3 — or null. Unlike the four sections above it does not step
   * aside: when one of them already speaks for the line the Transformation
   * section is there too, collapsed (a teacher may want both readings of
   * 2^(x−1)+3); otherwise it opens by itself.
   */
  const transform = useMemo(
    () => (isExpression && readable && curve.kind === 'explicit' ? safeReadTransform(exprSource) : null),
    [isExpression, readable, curve.kind, exprSource],
  )

  /**
   * The line read back as a TABLE of pieces (src/core/piecewise.ts) — any
   * typed `{… if …, … if …}` line, or one restricted formula (collapsed:
   * a teacher may want to add a piece to it) — or null.
   */
  const piecewise = useMemo(
    () => (isExpression && readable && curve.kind === 'explicit' ? piecewiseSectionSpec(exprSource) : null),
    [isExpression, readable, curve.kind, exprSource],
  )
  /**
   * The line read as a CONIC — standard form, or general form the way a
   * class types it (x^2 + y^2 - 4x + 6y - 3 = 0) — or, for a rotated or
   * degenerate quadratic, the discriminant sentence. Implicit lines only:
   * every section above is for a function, so nothing overlaps.
   */
  const conic = useMemo(
    () => (isExpression && readable ? conicSectionInfo(exprSource, curve.kind) : null),
    [isExpression, readable, exprSource, curve.kind],
  )
  /**
   * A particle's path: any parametric or polar curve — typed, built, or a
   * sketched polar family — gets the Motion section. Never a broken line.
   */
  const motionKind = useMemo(
    () => (broken ? null : motionKindOf(curve, models)),
    [broken, curve, models],
  )
  const transformOthers = {
    factored,
    exponential: exponential !== null,
    logarithmic: logarithmic !== null,
    sinusoidal: sinusoidal !== null,
  }
  const transformOpen = transform ? transformOpenByDefault(transform, transformOthers) : false
  /**
   * Another family section is on this card too (Roots, Exponential …): the
   * Transformation reading is then the SECOND one, and starts collapsed. The
   * board's ghost and key-point marks still follow transformOpenByDefault.
   */
  const transformSecondary =
    factored !== null || exponential !== null || logarithmic !== null || sinusoidal !== null || logistic !== null
  /** The card's Analysis states domain and range as rows of their own. */
  const domainRows = Boolean(domainPanel && domainActions)

  /**
   * A SKETCH that fitted the library's a·e^{bx} + c, stated the precalculus
   * way: one read-only line, and a menu item that makes it a typed curve.
   */
  const fitted = useMemo(
    () => (!isExpression && !broken && curve.modelId === 'exp' ? fittedExp(curve.params) : null),
    [isExpression, broken, curve.modelId, curve.params],
  )

  /**
   * A sketch that fitted the library's logistic a/(1 + e^(−b(x − c))) + d,
   * stated the AP way. It gets the whole Logistic section: its first edit
   * makes it the typed line.
   */
  const fittedLg = useMemo(
    () => (!isExpression && !broken && curve.modelId === 'logistic' ? fittedLogistic(curve.params) : null),
    [isExpression, broken, curve.modelId, curve.params],
  )

  /** The same for a sketch that fitted a·sin(bx + c) + d. */
  const fittedSin = useMemo(
    () => (!isExpression && !broken && curve.modelId === 'sine' ? fittedSine(curve.params) : null),
    [isExpression, broken, curve.modelId, curve.params],
  )

  /** The same for a sketched circle [a, b, r] or ellipse [A … F]. */
  const fittedCon = useMemo(
    () =>
      isExpression || broken
        ? null
        : curve.modelId === 'circle'
          ? fittedCircle(curve.params)
          : curve.modelId === 'ellipse'
            ? fittedEllipse(curve.params)
            : null,
    [isExpression, broken, curve.modelId, curve.params],
  )

  /** The same for a sketch that fitted a·ln(x − b) + c. */
  const fittedLn = useMemo(
    () => (!isExpression && !broken && curve.modelId === 'log' ? fittedLog(curve.params) : null),
    [isExpression, broken, curve.modelId, curve.params],
  )

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
  // Renaming from the chip: one letter, Enter commits, Esc leaves it.
  const [nameEdit, setNameEdit] = useState<{ text: string; error: string | null } | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (nameEdit) {
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameEdit !== null])
  const commitName = (): void => {
    if (!nameEdit || !onRename) return
    const letter = nameEdit.text.trim()
    if (letter === '' || letter === name) {
      setNameEdit(null)
      return
    }
    const err = onRename(letter)
    if (err) setNameEdit({ text: nameEdit.text, error: err })
    else setNameEdit(null)
  }
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
  const xScale = useMemo(
    () => (selected ? curveXScale(curve, spec) : undefined),
    [selected, curve, spec],
  )

  /**
   * Where an explicit f is zero on a whole INTERVAL (floor(x) on [0, 1)): the
   * analyzer folds the zeros inside one into it, so the Zeros row lists the
   * interval, sorted with the point zeros by x. Read over the analyzer's own
   * span, so an end at its edge is written "…" rather than as a bound.
   */
  const zeroSpans = useMemo(() => {
    if (!selected || curve.kind !== 'explicit') return []
    const span: [number, number] = curve.domain
      ? [Math.min(curve.domain[0], curve.domain[1]), Math.max(curve.domain[0], curve.domain[1])]
      : [-10, 10]
    try {
      return zeroIntervals(curve, models).map((z) => ({ lo: z.lo, text: zeroIntervalText(z, span) }))
    } catch {
      return []
    }
    // depKey: a line that calls f moves with f while `curve` stands still.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, curve, models, depKey])

  /**
   * Every zero over ℂ, when the formula is a polynomial of degree 2–8 drawn
   * over all of ℝ (src/ui/complexLinks.ts): the count the Fundamental Theorem
   * of Algebra promises, the non-real ones as a ± bi, the discriminant.
   */
  const complexZeros = useMemo(() => {
    if (!selected) return null
    return complexZerosOf(curve, models)
    // depKey: a line that calls f moves with f while `curve` stands still.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, curve, models, depKey])

  // Group the special points by kind, keeping each point's original index so
  // hovering a value can address the right marker on canvas. The Zeros row
  // also carries the zero INTERVALS, merged with the point zeros by x.
  const analysisGroups = useMemo(() => {
    if (analysis.length === 0 && zeroSpans.length === 0) return []
    return ANALYSIS_ROWS.map((row) => {
      const items = analysis
        .map((point, index) => ({ point, index }))
        .filter(({ point }) => point.kind === row.kind)
      const spans = row.kind === 'zero' ? zeroSpans : []
      type Entry =
        | { point: SpecialPoint; index: number; span?: undefined }
        | { span: { lo: number; text: string }; point?: undefined; index?: undefined }
      const seq: Entry[] = [...items, ...spans.map((span) => ({ span }))]
      if (spans.length > 0) {
        seq.sort((a, b) => (a.span ? a.span.lo : a.point.pos.x) - (b.span ? b.span.lo : b.point.pos.x))
      }
      return { ...row, items, seq }
    }).filter((g) => g.seq.length > 0)
  }, [analysis, zeroSpans])

  /**
   * What a folded Analysis still says: the domain and the range when the
   * rows above know them, then how many of each feature there are —
   * "domain (−∞, ∞) · range [0, ∞) · zero · minimum".
   */
  const analysisSummary = useMemo(() => {
    const parts: string[] = []
    if (domainPanel && domainActions) {
      const d = setRowText(domainPanel.domain, setNotation ?? 'interval')
      const r = setRowText(domainPanel.range, setNotation ?? 'interval')
      const id = domainPanel.ownerId
      if (d) parts.push(`domain ${revealApi.hidden(domainKey(id)) ? '?' : d}`)
      if (r) parts.push(`range ${revealApi.hidden(rangeKey(id)) ? '?' : r}`)
    }
    for (const g of analysisGroups.slice(0, 3)) {
      const n = g.seq.length
      const name = (n > 1 ? (g.plural ?? g.label) : g.label).toLowerCase()
      parts.push(n > 1 ? `${n} ${name}` : name)
    }
    return parts.join(' · ')
  }, [domainPanel, domainActions, setNotation, analysisGroups, revealApi])

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
    // depKey: a line that calls f moves with f while `curve` stands still.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, curve, models, scale, depKey],
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
    // a pair that coincides is listed even with no crossing points: "the same function"
    () => (intersections ?? []).filter((g) => g.points.length > 0 || !!g.coincide),
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

  // Keyboard: the open menu takes focus on its first item; a closed menu gives
  // it back to ⋯ when the item that had it went away with the menu (a calculus
  // item opens a section; focus must not fall to the page).
  const menuWasOpenRef = useRef(false)
  useEffect(() => {
    if (menuOpen) {
      menuWasOpenRef.current = true
      const first = menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')
      if (first && !menuRef.current?.querySelector('[role="menu"]')?.contains(document.activeElement)) {
        first.focus({ preventScroll: true })
      }
      return
    }
    if (!menuWasOpenRef.current) return
    menuWasOpenRef.current = false
    window.setTimeout(() => {
      if ((document.activeElement === document.body || !document.activeElement) && menuBtnRef.current?.isConnected) {
        menuBtnRef.current.focus({ preventScroll: true })
      }
    }, 0)
  }, [menuOpen])

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

  /** A menu entry that is a switch: ✓ when on, announced as checked. */
  const menuCheck = (label: string, on: boolean, run: () => void): JSX.Element => (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={on}
      className={`card-menu-item card-menu-check${on ? ' card-menu-check-on' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        setMenuOpen(false)
        run()
      }}
    >
      {label}
      <span className="card-menu-tick" aria-hidden="true">
        {on ? '\u2713' : ''}
      </span>
    </button>
  )

  /**
   * Everything the arrow keys walk, in reading order: the menu's items, then
   * the line-style and end-cap buttons (the sliders keep their own arrows and
   * stay on Tab). One of them is in the Tab order at a time — a roving
   * tabindex — so Tab leaves the menu instead of stepping through 25 items.
   */
  const menuNavItems = (): HTMLElement[] =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(
        '.card-menu [role^="menuitem"]:not([aria-disabled="true"]), .card-menu .dash-btn, .card-menu .ends-btn',
      ) ?? [],
    )
  const rove = (items: readonly HTMLElement[], at: number): void => {
    items.forEach((el, i) => {
      el.tabIndex = i === at ? 0 : -1
    })
  }
  // Every render of an open menu: the item holding focus (else the first)
  // is the one Tab stop — new items arrive with the default tabindex 0.
  useLayoutEffect(() => {
    if (!menuOpen) return
    const items = menuNavItems()
    const at = Math.max(0, items.indexOf(document.activeElement as HTMLElement))
    rove(items, at)
  })

  /**
   * Up / Down / Home / End walk the menu (items, line styles, end caps); Left
   * / Right step along a row of style or end buttons. Tab still leaves it and
   * Escape still closes it.
   */
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!menuOpen) return
    const inRow =
      document.activeElement instanceof HTMLElement &&
      (document.activeElement.classList.contains('dash-btn') || document.activeElement.classList.contains('ends-btn'))
    const horizontal = inRow && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
    if (!horizontal && e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    const items = menuNavItems()
    if (items.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    const at = items.indexOf(document.activeElement as HTMLElement)
    const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight'
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? items.length - 1
          : forward
            ? (at + 1) % items.length
            : at <= 0
              ? items.length - 1
              : at - 1
    rove(items, next)
    items[next]?.focus()
  }

  /** A sketch that fitted a family the app can also TYPE: one item makes it the typed line. */
  const convert: { label: string; run: () => void } | null = !onConvertTyped
    ? null
    : fitted
      ? { label: 'Convert to typed exponential', run: () => void onConvertTyped(fitted.src, 'convert to typed exponential') }
      : fittedLn
        ? { label: 'Convert to typed logarithm', run: () => void onConvertTyped(fittedLn.src, 'convert to typed logarithm') }
        : fittedSin
          ? { label: 'Convert to typed sinusoid', run: () => void onConvertTyped(fittedSin.src, 'convert to typed sinusoid') }
          : fittedLg
            ? { label: 'Convert to typed logistic', run: () => void onConvertTyped(fittedLg.src, 'convert to typed logistic') }
            : fittedCon
              ? { label: 'Convert to typed conic', run: () => void onConvertTyped(fittedCon.src, 'convert to typed conic') }
              : null
  const showInverseItem = Boolean(onShowInverseOf && curve.kind === 'explicit' && !broken)
  /** The Inverse & domain switches, on a function whose Analysis carries the rows. */
  const domainFn = Boolean(domainPanel && domainActions && domainPanel.role === 'function' && !broken)
  const menuUid = useId()

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

  // ------------------------------------------------------ attached tools
  //
  // Every object attached to this curve gets a section of its own, in the
  // order it was added (calc.order), so a lesson that went limit → secant →
  // Taylor reads top to bottom the way it was taught. Links without an order
  // (an old CardCalc) fall back to one kind after another.
  const calcTools: { id: string; node: JSX.Element }[] = []
  if (calc) {
    for (const a of calc.areas) {
      const other = a.otherLabel ?? null
      const samples =
        a.samples !== null ? (
          <span
            className="calc-note"
            title="This integral has no closed form, so it was measured — at this many evaluations of the function."
          >
            {`${a.samples} samples`}
          </span>
        ) : null
      calcTools.push({
        id: a.linkId,
        node: (
          <CardSection
            kind="area"
            title={other ? 'Between' : 'Area'}
            summary={a.text}
            actions={dropBtn(a.linkId, 'shaded area')}
            className="calc-row"
            data={{ link: a.linkId }}
            answerKey={calcKey(a.linkId)}
          >
            {/* Between curves the first line says WHICH two, so the number
                gets a line of its own rather than being squeezed in beside a
                pair of equations. */}
            {other && (
              <div className="calc-line">
                <span className="calc-read calc-between" title="The region between these two curves">
                  {`${selfLabel} and ${other}`}
                </span>
              </div>
            )}
            <div className={other ? 'calc-line calc-line-read' : 'calc-line'}>
              <span className="calc-read">
                <AnswerText k={calcKey(a.linkId)} text={a.text} what="the integral" />
              </span>
              {revealApi.hidden(calcKey(a.linkId)) ? null : samples}
            </div>
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
            {a.problem && (
              <Answer k={calcKey(a.linkId)} block>
                <div className="calc-why">{a.problem}</div>
              </Answer>
            )}
          </CardSection>
        ),
      })
    }
    for (const g of calc.accums) {
      calcTools.push({
        id: g.linkId,
        node: (
          <CardSection
            kind="accumulation"
            title="Accumulation"
            summary={g.text ? `${g.head} · ${g.text}` : g.head}
            actions={dropBtn(g.linkId, 'accumulation function')}
            className="calc-row"
            data={{ link: g.linkId }}
            answerKey={g.text ? calcKey(g.linkId) : undefined}
          >
            <div className="calc-line">
              <span className="calc-read">{g.head}</span>
            </div>
                    <div className="calc-controls">
                      {calcNumber(`${g.linkId}:a`, 'a', g.a, (v) =>
                        onCalcChange({ kind: 'accumA', linkId: g.linkId, a: v }),
                      )}
                      {calcNumber(`${g.linkId}:C`, `${g.gName}(a)`, g.C, (v) =>
                        onCalcChange({ kind: 'accumC', linkId: g.linkId, C: v }),
                      )}
                      {g.x !== null ? (
                        calcNumber(`${g.linkId}:x`, 'x', g.x, (v) =>
                          onCalcChange({ kind: 'accumX', linkId: g.linkId, x: v }),
                        )
                      ) : (
                        <button
                          type="button"
                          className="calc-chip"
                          title={`Read ${g.gName}(x) at a point, and shade from a to it`}
                          onClick={() =>
                            onCalcChange({
                              kind: 'accumX',
                              linkId: g.linkId,
                              x: g.a + 1,
                            })
                          }
                        >
                          {`${g.gName}(x) at…`}
                        </button>
                      )}
                    </div>
                    {g.text && (
                      <div className="calc-line calc-line-read">
                        <span className="calc-read calc-accum-read">
                          <AnswerText k={calcKey(g.linkId)} text={g.text} what="the value" />
                        </span>
                      </div>
                    )}
            {g.problem && <div className="calc-why">{g.problem}</div>}
          </CardSection>
        ),
      })
    }
    for (const lm of calc.limits) {
      calcTools.push({
        id: lm.linkId,
        node: (
          <LimitSection
            row={lm}
            onCalcChange={onCalcChange}
            onRemove={() => onCalcRemove(lm.linkId)}
            onEditStart={onParamEditStart}
            onEditEnd={onParamEditEnd}
          />
        ),
      })
    }
    for (const im of calc.implicits ?? []) {
      calcTools.push({
        id: im.linkId,
        node: <ImplicitSection row={im} onCalcChange={onCalcChange} onRemove={() => onCalcRemove(im.linkId)} />,
      })
    }
    for (const sc of calc.secants) {
      calcTools.push({
        id: sc.linkId,
        node: <SecantSection row={sc} onCalcChange={onCalcChange} onRemove={() => onCalcRemove(sc.linkId)} />,
      })
    }
    for (const pc of calc.pcalcs ?? []) {
      calcTools.push({
        id: pc.linkId,
        node: <ParamCalcSection row={pc} onCalcChange={onCalcChange} onRemove={() => onCalcRemove(pc.linkId)} />,
      })
    }
    for (const pb of calc.pbetweens ?? []) {
      calcTools.push({
        id: pb.linkId,
        node: <PolarBetweenSection row={pb} onCalcChange={onCalcChange} onRemove={() => onCalcRemove(pb.linkId)} />,
      })
    }
    for (const sg of calc.signs ?? []) {
      calcTools.push({
        id: sg.linkId,
        node: <SignChartSection row={sg} onCalcChange={onCalcChange} onRemove={() => onCalcRemove(sg.linkId)} />,
      })
    }
    for (const v of calc.volumes) {
      calcTools.push({
        id: v.linkId,
        node: (
          <VolumeSection
            row={v}
            onCalcChange={onCalcChange}
            onRemove={() => onCalcRemove(v.linkId)}
            onEditStart={onParamEditStart}
            onEditEnd={onParamEditEnd}
          />
        ),
      })
    }
    for (const t of calc.taylors) {
      calcTools.push({
        id: t.linkId,
        node: (
          <TaylorSection
            // Undo/redo remount the demo (a new epoch), which clears its timer.
            key={`${t.linkId}:${calc.epoch ?? 0}`}
            row={t}
            onCalcChange={onCalcChange}
            onRemove={() => onCalcRemove(t.linkId)}
            onEditStart={onParamEditStart}
            onEditEnd={onParamEditEnd}
          />
        ),
      })
    }
    for (const r of calc.riemanns) {
      calcTools.push({
        id: r.linkId,
        node: (
          <CardSection
            kind="riemann"
            title="Riemann sum"
            summary={r.text}
            actions={dropBtn(r.linkId, 'Riemann sum')}
            className="calc-row"
            data={{ link: r.linkId }}
            answerKey={calcKey(r.linkId)}
          >
            <div className="calc-line">
              <span className="calc-read">
                <AnswerText k={calcKey(r.linkId)} text={r.text} what="the sum" />
              </span>
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
          </CardSection>
        ),
      })
    }
    const order = calc.order
    if (order && order.length > 0) {
      const at = new Map(order.map((id, i) => [id, i]))
      const fallback = calcTools.map((t) => t.id)
      calcTools.sort(
        (p, q) =>
          (at.get(p.id) ?? order.length + fallback.indexOf(p.id)) -
          (at.get(q.id) ?? order.length + fallback.indexOf(q.id)),
      )
    }
  }

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
      }${broken || linkError ? ' card-broken-state' : ''}`}
      style={{ '--curve': ink(curve.color) } as CSSProperties}
      role="group"
      aria-roledescription="card"
      tabIndex={0}
      aria-current={selected ? 'true' : undefined}
      aria-label={`${name ? `${name}: ` : ''}${broken ? 'Equation' : modelName} curve${curve.visible ? '' : ', hidden'}${selected ? ', selected' : ''}`}
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
          style={{ background: ink(curve.color) }}
          title="Change colour"
          aria-label="Change curve colour"
          onClick={(e) => {
            e.stopPropagation()
            onCycleColor()
          }}
        />
        {name !== undefined &&
          (nameEdit ? (
            <input
              ref={nameInputRef}
              className={`name-chip-input${nameEdit.error ? ' param-edit-bad' : ''}`}
              type="text"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              maxLength={2}
              aria-label="Curve name"
              value={nameEdit.text}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setNameEdit({ text: e.target.value, error: null })}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitName()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setNameEdit(null)
                }
              }}
              onBlur={() => setNameEdit(null)}
            />
          ) : nameEditable && onRename ? (
            <button
              type="button"
              className="name-chip name-chip-btn"
              title={`This curve is ${name} — click to rename it (every line that uses ${name} follows)`}
              aria-label={`Curve name ${name}, click to rename`}
              onClick={(e) => {
                e.stopPropagation()
                onSelect()
                setNameEdit({ text: name, error: null })
              }}
            >
              {name}
            </button>
          ) : (
            <span className="name-chip" title={`This curve is ${name}`}>
              {name}
            </span>
          ))}
        <span className="model-name" role="heading" aria-level={3}>
          {broken ? 'Equation' : modelName}
        </span>
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

        <div className="card-menu-wrap" ref={menuRef} onKeyDown={onMenuKey}>
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
              onFocus={(e) => {
                // A click or Tab that lands on an item makes IT the roving stop.
                const items = menuNavItems()
                const at = items.indexOf(e.target as HTMLElement)
                if (at >= 0) rove(items, at)
              }}
            >
              {menuItem('Duplicate', onDuplicate)}
              {menuItem(curve.visible ? 'Hide' : 'Show', onToggleVisible)}
              {menuItem(copied ? 'Copied' : 'Copy LaTeX', copyLatex)}
              {convert && menuItem(convert.label, convert.run)}
              {menuItem('Delete', onDelete, 'card-menu-danger')}
              {calc?.canAdd && (
                <>
                  <div className="card-menu-sep" role="separator" />
                  <div role="group" aria-labelledby={`${menuUid}-calc`}>
                    <div className="card-menu-title" id={`${menuUid}-calc`}>
                      Calculus
                    </div>
                    {CALC_GROUPS.map((group) => {
                      // An implicit curve (x² + y² = 25) offers the tangent line only.
                      const items = group.items.filter((item) => calcMenuOffers(item.kind, calc, between?.canAdd))
                      if (items.length === 0) return null
                      return (
                        <div key={group.title} role="group" aria-label={group.title}>
                          <div className="card-menu-sub" aria-hidden="true">
                            {group.title}
                          </div>
                          {items.map((item) =>
                            item.kind === 'between' ? (
                              <Fragment key={item.kind}>{menuItem(item.label, onAddAreaBetween)}</Fragment>
                            ) : item.kind === 'taylor' && calc.taylorBlocked ? (
                              // Offered, and greyed out with the reason: a teacher who
                              // typed f(x − 1) is owed WHY, not a menu that forgot.
                              <button
                                key={item.kind}
                                type="button"
                                role="menuitem"
                                className="card-menu-item card-menu-item-off"
                                aria-disabled="true"
                                tabIndex={-1}
                                title={`${calc.taylorBlocked}.`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {item.label}
                                <span className="card-menu-why">{calc.taylorBlocked}</span>
                              </button>
                            ) : (
                              <Fragment key={item.kind}>
                                {menuItem(
                                  item.kind === 'pcalc' && calc.motion === 'polar'
                                    ? 'Calculus at \u03b8 (dy/dx, dr/d\u03b8, arc length)'
                                    : item.label,
                                  () => onAddCalc(item.kind as CalcKind),
                                )}
                              </Fragment>
                            ),
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
              {(showInverseItem || domainFn) && (
                <>
                  <div className="card-menu-sep" role="separator" />
                  <div role="group" aria-labelledby={`${menuUid}-inv`}>
                    <div className="card-menu-title" id={`${menuUid}-inv`}>
                      Inverse &amp; domain
                    </div>
                    {showInverseItem && onShowInverseOf && menuItem('Show inverse', onShowInverseOf)}
                    {domainFn &&
                      domainPanel &&
                      domainActions &&
                      menuCheck('Horizontal line test', domainPanel.hlt !== null, () =>
                        domainActions.onHlt(domainPanel.ownerId, domainPanel.hlt === null),
                      )}
                    {domainFn &&
                      domainPanel &&
                      domainActions &&
                      domainPanel.inverse &&
                      menuCheck('Reflect a point across y = x', domainPanel.reflect, () =>
                        domainActions.onReflect(domainPanel.ownerId, !domainPanel.reflect),
                      )}
                  </div>
                </>
              )}
              <div className="card-menu-sep" role="separator" />
              <div role="group" aria-labelledby={`${menuUid}-line`}>
              <div className="card-menu-title" id={`${menuUid}-line`}>
                Line
              </div>
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
                      type="button"
                      className={`dash-btn${activeDashKey === d.key ? ' dash-on' : ''}`}
                      title={d.title}
                      aria-label={d.key}
                      aria-pressed={activeDashKey === d.key}
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
              </div>
              {showsEnds && (
                <div role="group" aria-labelledby={`${menuUid}-ends`}>
                  <div className="card-menu-title" id={`${menuUid}-ends`}>
                    Ends
                  </div>
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
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Reveal mode: a derived curve's equation (a tangent line, f′, Pₙ,
          an accumulation function) IS the answer, so it stands as a pill. */}
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
        ) : equationSeed === null || derivedHidden ? (
          <div
            className="card-formula card-eq"
            title={
              derivedHidden
                ? 'Reveal mode: this equation is an answer'
                : `${/^[aeiou]/i.test(modelName) ? 'An' : 'A'} ${modelName.toLowerCase()} has no equation form to type — drag its handles or pick another reading`
            }
          >
            {derivedKey ? (
              <AnswerTex k={derivedKey} tex={latexStr} className="card-latex" what="this equation" />
            ) : (
              <Latex tex={latexStr} className="card-latex" />
            )}
          </div>
        ) : (
          <button
            type="button"
            className="card-formula card-formula-btn card-eq"
            title="Click to edit this equation"
            aria-label={equationLabel(latexStr)}
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
              <span
                className={`calc-origin-text${
                  calc.origin.kind === 'accumulation' ? ' calc-origin-of' : ''
                }`}
              >
                <Answer k={calcKey(calc.origin.linkId)}>{calc.origin.tail}</Answer>
              </span>
            )}
          </div>
          {calc.origin.problem && (
            <div className="calc-why">
              {`No ${calc.origin.kind === 'tangent' ? 'line' : 'curve'} is drawn: ${calc.origin.problem}.`}
            </div>
          )}
          {/* The AP connections — g′ = f, and everything that follows from it
              about g, read off f's own analysis. Only on the open card: six
              sentences under every accumulation curve would bury the list. */}
          {selected && calc.origin.facts && calc.origin.facts.length > 0 && (
            <Answer k={calcKey(calc.origin.linkId)} block what="what follows">
            <ul className="calc-facts">
              {calc.origin.facts.map((fact, i) => (
                <li key={i} className={i === 0 ? 'calc-fact calc-fact-lead' : 'calc-fact'}>
                  {fact}
                </li>
              ))}
            </ul>
            </Answer>
          )}
        </div>
      )}

      {eqEdit && (
        <div className="card-eq-foot" onClick={(e) => e.stopPropagation()}>
          {eqEdit.error && <div className="expr-error">{eqEdit.error}</div>}
          <div className="expr-hint">Enter saves · Esc cancels</div>
        </div>
      )}

      {nameEdit?.error && <div className="expr-error name-error">{nameEdit.error}</div>}

      {linkError && !broken && (
        <div className="card-link-error" role="status">
          {linkError}
        </div>
      )}

      {note && (
        <div className="card-note" onClick={(e) => e.stopPropagation()}>
          {note}
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
        <div className="card-body card-body-sections" onClick={(e) => e.stopPropagation()}>
          {inequality && <InequalitySection info={inequality} />}
          {/* A function built piece by piece is edited BY its pieces. */}
          {piecewise && onPiecewiseRestate && exprSource && (
            <PiecewiseSection
              src={exprSource}
              params={curve.params}
              defaultOpen={piecewiseOpenByDefault(exprSource)}
              envFor={piecewiseEnvFor}
              onRestate={onPiecewiseRestate}
            />
          )}
          {/* A function built from its roots is edited BY its roots: they
              are the numbers a teacher set, so they come first. */}
          {factored && onFactorRestate && (
            <RootsSection
              spec={factored}
              through={factorThrough ?? null}
              onRestate={onFactorRestate}
              onDropThrough={factorThrough ? onFactorThroughDrop : undefined}
            />
          )}
          {exponential && onExpRestate && (
            <ExpSection
              spec={exponential}
              onRestate={onExpRestate}
              onShowInverse={onShowInverse}
              hideDomainRange={domainRows}
            />
          )}
          {logarithmic && onLogRestate && (
            <LogSection
              spec={logarithmic}
              onRestate={onLogRestate}
              onShowInverse={onShowInverse}
              hideDomainRange={domainRows}
            />
          )}
          {sinusoidal && onSinRestate && (
            <SinSection spec={sinusoidal} onRestate={onSinRestate} hideDomainRange={domainRows} />
          )}
          {logistic && onLogisticRestate && (
            <LogisticSection
              spec={logistic}
              onRestate={onLogisticRestate}
              onShowField={onShowLogisticField}
              hideDomainRange={domainRows}
            />
          )}
          {fittedLg && onConvertTyped && (
            <LogisticSection
              spec={fittedLg.spec}
              onRestate={onConvertTyped}
              onShowField={onShowLogisticField}
              sketched
              hideDomainRange={domainRows}
            />
          )}
          {/* The second reading of a line another family already speaks for
              (Roots of x², Exponential of 2^(x − 1) + 3) starts folded, and
              its open/closed choice is remembered apart from the first. */}
          {transform && onTransformRestate && (
            <TransformSection
              spec={transform}
              defaultOpen={transformOpen && !transformSecondary}
              secondary={transformSecondary}
              showParent={transformShowParent ?? transformOpen}
              onShowParent={onTransformShowParent}
              handles={transformOwnsHandles(transformOthers)}
              onRestate={onTransformRestate}
              hideDomainRange={domainRows}
            />
          )}
          {conic && (
            <ConicSection
              info={conic}
              src={exprSource}
              curveId={curve.id}
              onRestate={onConicRestate}
              construction={conicConstruction ?? false}
              onConstruction={onConicConstruction}
            />
          )}
          {motionKind && (
            <MotionSection
              curve={curve}
              models={models}
              kind={motionKind}
              src={isExpression ? exprSource : undefined}
              depKey={depKey}
              play={motion}
              scales={motionScales}
              onPlay={onMotionPlay}
              onInterval={onMotionInterval}
            />
          )}
          {fittedCon && (
            <div className="xe-fitted-note" data-testid="fitted-conic-note">
              {fittedCon.note}
              {onConvertTyped && (
                <button
                  type="button"
                  className="calc-chip co-convert"
                  data-testid="conic-convert"
                  onClick={(e) => {
                    e.stopPropagation()
                    onConvertTyped(fittedCon.src, 'convert to typed conic')
                  }}
                >
                  Convert to typed conic
                </button>
              )}
            </div>
          )}
          {fitted && (
            <div className="xe-fitted-note" data-testid="fitted-exp-note">
              {fitted.note}
            </div>
          )}
          {fittedLn && (
            <div className="xe-fitted-note" data-testid="fitted-log-note">
              {fittedLn.note}
            </div>
          )}
          {fittedSin && (
            <div className="xe-fitted-note" data-testid="fitted-sin-note">
              {fittedSin.note}
            </div>
          )}
          {/* Teaching order: the numbers you move, then what they do to the
              curve, and only then which curve this is being read as. */}
          {meta.length > 0 && (
            <CardSection
              kind="coefficients"
              title={isExpression ? 'Sliders' : 'Coefficients'}
              summary={meta
                .slice(0, 4)
                .map((m, row) => `${m.name} = ${formatCoord(curve.params[paramIndex[row] ?? row] ?? 0, { scale })}`)
                .join(', ')}
              className="param-section"
            >
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
            </CardSection>
          )}

          {(domainRows || analysisGroups.length > 0 || asymptotes.length > 0) && (
            <CardSection
              kind="analysis"
              title="Analysis"
              summary={analysisSummary}
              className="an-section"
              testId="analysis-section"
            >
              <div className="an-table">
                {domainPanel && domainActions && (
                  <DomainSection
                    key={domainPanel.ownerId}
                    panel={domainPanel}
                    actions={domainActions}
                    notation={setNotation ?? 'interval'}
                  />
                )}
                {analysisGroups.map((g) => (
                  <div className="an-row" key={g.kind}>
                    <span className="an-label">
                      {g.seq.length > 1 ? (g.plural ?? g.label) : g.label}
                    </span>
                    <span className="an-values">
                      {g.seq.map((entry, n) => {
                        // A zero INTERVAL: stated, like a hole — there is no
                        // one value an editor could move.
                        if (entry.span) {
                          return (
                            <Answer k={`curve:${curve.id}:zero:span${n}`} key={`span:${entry.span.lo}`} what="this zero">
                              <span className="an-value an-value-static" data-testid="zero-interval">
                                {n === g.seq.length - 1 ? entry.span.text : `${entry.span.text},`}
                              </span>
                            </Answer>
                          )
                        }
                        const { point, index } = entry
                        // Reveal mode: a hidden value is a pill, and nothing to edit.
                        const answerKey = revealApi.pointKey(curve.id, point)
                        if (revealApi.hidden(answerKey)) {
                          return <RevealPill key={index} k={answerKey} what={`this ${point.label}`} />
                        }
                        const keys = axisKeys(featureAxes(point.kind))
                        const pair = keys.length > 1
                        const last = n === g.seq.length - 1
                        // The separator is part of the value's own text: a
                        // comma that can wrap on its own ends a line with a
                        // dangling punctuation mark.
                        const parts = pointParts(point, { scale, xScale })
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
                              {/* the same number, written the other standard way: log₂(7/3) = ln(7/3)/ln 2 */}
                              {point.exactAlt && point.kind === 'zero' && (
                                <span className="an-exact an-alt" data-testid="exact-alt">{` = ${point.exactAlt}`}</span>
                              )}
                              <span className="an-approx">{` ${APPROX} ${parts.decimal}${comma}`}</span>
                            </>
                          )
                        // A hole is stated, never offered: it is the one place
                        // the formula has no value, so there is nothing for an
                        // editor to move. No button, no hover, no hint.
                        if (g.readOnly) {
                          return (
                            <Answer k={answerKey} key={index}>
                              <span
                                className="an-value an-value-static"
                                data-value={parts.exact === null ? undefined : text}
                              >
                                {valueNode}
                              </span>
                            </Answer>
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
                          <Answer k={answerKey} key={index}>
                          <button
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
                          </Answer>
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
                        <Answer k={asymKey(curve.id, n)} key={`${text}-${n}`} what="this asymptote">
                          <span className="an-value an-value-static">
                            {n === asymptotes.length - 1 ? text : `${text},`}
                          </span>
                        </Answer>
                      ))}
                    </span>
                  </div>
                )}
              </div>
            </CardSection>
          )}

          {/* Every zero, real or not: the Fundamental Theorem of Algebra. */}
          {complexZeros && <ComplexZerosSection curveId={curve.id} zeros={complexZeros} />}

          {/* Circle theorems: points on the circle and what they make. */}
          {circlePanel && circleActions && <CircleSection panel={circlePanel} actions={circleActions} />}

          {/* The table of values: what f does at the x's a class picks. */}
          {tablePanel && tableActions && <TableSection panel={tablePanel} actions={tableActions} />}

          {(calcTools.length > 0 || betweenNotes.length > 0) && (
            <div className="calc-section">
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
                {/* Everything attached to this curve, in the order it was
                    added: the lesson's order, not the menu's. */}
                {calcTools.map((t) => (
                  <Fragment key={t.id}>{t.node}</Fragment>
                ))}
              </div>
            </div>
          )}

          {/* And last, the one section that is not about this curve alone:
              where it MEETS the others. Stated, never offered — a crossing is
              a consequence of two functions, and there is no single value an
              editor could move to put it somewhere else. Each other curve gets
              its own line, named the way the figure's caption names it. */}
          {crossings.length > 0 && (
            <CardSection
              kind="intersections"
              title={crossings.length > 1 || crossings[0].points.length > 1 ? 'Intersections' : crossings[0].coincide && crossings[0].points.length === 0 ? 'Intersections' : 'Intersection'}
              summary={crossings.map((g) => (g.coincide?.everywhere ? `with ${g.name} (same function)` : `with ${g.name} (${g.points.length}${g.coincide ? ' + overlap' : ''})`)).join(' · ')}
              // "(same function)" and "+ overlap" are the coincidence answer:
              // the folded summary is masked with it while it is hidden
              answerKey={(() => {
                const keys = crossings.filter((g) => !!g.coincide).map((g) => coincideKey(curve.id, g.id))
                return keys.find((k) => revealApi.hidden(k)) ?? keys[0]
              })()}
              className="an-section an-crossings"
              testId="intersections-section"
            >
              <div className="an-with-list">
                {crossings.map((g) => (
                  <span className="an-with" key={g.id}>
                    <span className="an-with-name">{`with ${g.name}:`}</span>{' '}
                    {g.coincide && (
                      <Answer k={coincideKey(curve.id, g.id)} what="where they coincide">
                        <span className="an-value an-value-static an-coincide" data-testid="coincide">
                          {g.coincide.text}
                          {g.points.length > 0 ? ';' : ''}
                        </span>
                      </Answer>
                    )}
                    {g.points.map((point, n) => {
                      const parts = pointParts(point, { scale, xScale })
                      const comma = n === g.points.length - 1 ? '' : ','
                      return (
                        <Answer k={revealApi.crossKey(curve.id, g.id, point)} key={`${g.id}-${n}`} what="this intersection">
                        <span
                          className="an-value an-value-static"
                          data-value={parts.exact === null ? undefined : parts.text}
                        >
                          {parts.exact === null ? (
                            parts.decimal + comma
                          ) : (
                            <>
                              <span className="an-exact" title={exactTitle(point, parts.exact)}>
                                {parts.exact}
                              </span>
                              <span className="an-approx">{` ${APPROX} ${parts.decimal}${comma}`}</span>
                            </>
                          )}
                          {point.exactAlt && (
                            <span className="an-note an-alt" data-testid="exact-alt">{` x = ${point.exactAlt}`}</span>
                          )}
                        </span>
                        </Answer>
                      )
                    })}
                  </span>
                ))}
              </div>
            </CardSection>
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
