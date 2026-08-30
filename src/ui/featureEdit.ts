// Shared vocabulary for editing an analysis feature ("put this zero at x = 2").
//
// Both entry points — the readout in the curve card and the marker on canvas —
// build their editor from these helpers, so a zero offers the same one field in
// both places and the two can never drift apart.
import type { SpecialPoint, SpecialPointKind } from '../core/types'
import { formatCoord } from './numeric'

/** Which coordinates of a feature the user may state. */
export interface FeatureAxes {
  x: boolean
  y: boolean
}

/**
 * Derived from the KIND of the point, never from the curve's family: a zero is
 * a zero whether it belongs to a line or a quartic.
 *
 *   zero         — y = 0 by definition, so only x is the user's to choose
 *   y-intercept  — x = 0 by definition, so only y is
 *   everything else (maximum, minimum, inflection, extreme, petal tip) is a
 *   free point in the plane and exposes both.
 */
export function featureAxes(kind: SpecialPointKind): FeatureAxes {
  switch (kind) {
    case 'zero':
      return { x: true, y: false }
    case 'y-intercept':
      return { x: false, y: true }
    default:
      return { x: true, y: true }
  }
}

/** The axis keys, in reading order — the order the input fields appear in. */
export function axisKeys(axes: FeatureAxes): ('x' | 'y')[] {
  const keys: ('x' | 'y')[] = []
  if (axes.x) keys.push('x')
  if (axes.y) keys.push('y')
  return keys
}

/** "x", "y", or "x and y" — for the hover hint on a marker. */
export function axesPhrase(axes: FeatureAxes): string {
  if (axes.x && axes.y) return 'x and y'
  return axes.x ? 'x' : 'y'
}

/** How a point reads in a sentence: a zero is a single number, others a pair. */
export function featureText(p: SpecialPoint): string {
  const axes = featureAxes(p.kind)
  if (axes.x && !axes.y) return formatCoord(p.pos.x)
  if (axes.y && !axes.x) return formatCoord(p.pos.y)
  return `(${formatCoord(p.pos.x)}, ${formatCoord(p.pos.y)})`
}

/** Beyond this the report stops being glanceable and becomes a paragraph. */
const MAX_LISTED = 3

/**
 * "minimum (2.1, −3.4), inflection (0.8, 1.2) and 2 more" — the side-effect
 * report. Moving one zero of a cubic moves everything else, so the honest list
 * can run to four or five entries; naming the first few and counting the rest
 * keeps it something the teacher reads rather than skips.
 */
export function describePoints(points: SpecialPoint[]): string {
  const usable = points.filter(
    (p) => p && p.pos && Number.isFinite(p.pos.x) && Number.isFinite(p.pos.y),
  )
  const listed = usable.slice(0, MAX_LISTED).map((p) => `${p.label} ${featureText(p)}`)
  const rest = usable.length - listed.length
  if (listed.length === 0) return ''
  return rest > 0 ? `${listed.join(', ')} and ${rest} more` : listed.join(', ')
}
