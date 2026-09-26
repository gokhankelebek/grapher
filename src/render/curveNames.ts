// ============================================================================
// src/render/curveNames.ts — what each curve on the board is CALLED.
//
// A board with one curve can say "Graph of f" and mean it. A board with three
// cannot: the caption names a function nothing on the figure points at, and a
// student reading the printed sheet has no way to tell which stroke is f. So
// the board needs names — the same names in the caption, on the figure, and in
// the sentence a card writes about a tangent.
//
// The rule, in one breath:
//
//   * a curve the teacher TYPED as `f(x) = …` / `g(t) = …` keeps that letter —
//     it is what they called it, and nothing here may rename it;
//   * every other visible explicit / polar / parametric curve takes the next
//     free letter from f, g, h, k, p, q, r, s, in sidebar order, skipping the
//     letters the typed names already own;
//   * a DERIVED curve keeps its relation to its parent rather than taking a
//     letter of its own: the derivative of f is f′, and the derivative of that
//     is f″. That is the whole reason the names exist — "Graphs of f and f′"
//     is a sentence about one function, and "Graphs of f and g" is not;
//   * a TANGENT line is not named. It is a measurement OF a curve, it already
//     says what it is by touching one, and a letter on it would claim it was
//     another function of the lesson.
//
// Slope fields, shapes and number-line items never reach this file: they are
// not curves, and a lattice of directions is not a graph of anything.
//
// Pure: no React, no DOM, no canvas.
//
// STORED NAMES. Since functions can use other functions (g(x) = 2f(x − 1) + 3),
// a curve's letter is part of the document: g's line says "f", so f must stay
// f when a curve above it is deleted. The board keeps one letter per curve
// (src/ui/nameLinks.ts hands them out and never reshuffles them) and passes
// that map here as `stored`; the rules above then apply only to what a stored
// letter cannot say — f′ for a derivative, f⁻¹ for an inverse, nothing for a
// tangent. Without `stored` the letters are derived exactly as they always
// were, which is how a document written before names were stored gets its
// letters the first time it is opened.
// ============================================================================

import type { FittedCurve } from '../core/types'
import type { CalcLink } from '../core/persist'

/**
 * The letters a board hands out, in order.
 *
 * f, g, h are the ones a calculus class already reads as "some function";
 * k, p, q, s, u, v, w continue without touching the letters that mean
 * something else on a graph (x, y, t are variables, r is the polar radius, e
 * is a constant, n and i are counters) — a name is something a typed line can
 * CALL as f(x), and the parser reads r(…) as the radius, never as a call.
 */
export const NAME_POOL: readonly string[] = ['f', 'g', 'h', 'k', 'p', 'q', 's', 'u', 'v', 'w']

/** The inverse of a function named f: f⁻¹. */
export function inverted(base: string): string {
  return `${base}⁻¹`
}

/** Prime marks, by order of the derivative. Beyond four, f⁽⁵⁾. */
const PRIMES: readonly string[] = ['′', '″', '‴', '⁗']

/** Superscript digits, for the f⁽ⁿ⁾ an eighth derivative would need. */
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'

/** `f` + n primes: f′, f″, f‴, f⁗, then f⁽⁵⁾. */
export function primed(base: string, order: number): string {
  if (order <= 0) return base
  if (order <= PRIMES.length) return base + PRIMES[order - 1]
  const digits = String(order)
    .split('')
    .map((d) => SUP[Number(d)])
    .join('')
  return `${base}⁽${digits}⁾`
}

/**
 * Letters that cannot be a function's name, because they already mean
 * something on a graph. The parser draws the same line (it refuses to read
 * `x(t) =` as a definition); this repeats it rather than importing it, because
 * the head being read here is a string the teacher typed, not an AST.
 */
const RESERVED: ReadonlySet<string> = new Set(['x', 'y', 't', 'e'])

/** `f(x) = …`, `g(t)= …`, `h(θ) = …` — the letter, or null. */
const TYPED_HEAD = /^\s*([A-Za-z])\s*\(\s*(?:x|t|theta|θ)\s*\)\s*=/

/** The function letter a source line names itself with, if it names one. */
export function typedName(src: string | undefined): string | null {
  if (typeof src !== 'string') return null
  const m = TYPED_HEAD.exec(src)
  if (!m) return null
  const letter = m[1]
  return RESERVED.has(letter.toLowerCase()) ? null : letter
}

/** A curve that can carry a name at all: visible, and a graph of something. */
function nameable(c: FittedCurve): boolean {
  return c.visible && (c.kind === 'explicit' || c.kind === 'polar' || c.kind === 'parametric')
}

/**
 * What every curve on this board is called, keyed by curve id.
 *
 * `sources` is the text the teacher typed, keyed by curve id — the App's
 * exprSources merged over displaySources, which is the same map the legend and
 * the axis-unit guess take. `links` is the calculus wiring: it is the only
 * thing that knows a curve is the DERIVATIVE of another rather than a curve
 * that happens to look like one.
 *
 * A curve with no name is simply absent from the result.
 */
export function curveNames(
  curves: readonly FittedCurve[],
  sources: Readonly<Record<string, string>> = {},
  links: readonly CalcLink[] = [],
  stored?: Readonly<Record<string, string>>,
  inverses: readonly { parentId: string; curveId: string }[] = [],
): Record<string, string> {
  const tangents = new Set<string>()
  const derivedFrom = new Map<string, string>()
  for (const l of links) {
    if (l.kind === 'tangent') tangents.add(l.curveId)
    else if (l.kind === 'derivative') derivedFrom.set(l.curveId, l.parentId)
  }
  const inverseOf = new Map<string, string>()
  for (const l of inverses) inverseOf.set(l.curveId, l.parentId)

  const open = curves.filter(
    (c) => nameable(c) && !tangents.has(c.id) && !inverseOf.has(c.id),
  )
  const names: Record<string, string> = {}
  const taken = new Set<string>()

  // 0. The letters the document stores. They are claims too — and the only
  //    ones, for every curve that has one: a stored name never moves.
  if (stored) {
    for (const letter of Object.values(stored)) taken.add(letter)
    for (const c of open) {
      const s = stored[c.id]
      if (typeof s === 'string' && s !== '' && !derivedFrom.has(c.id)) names[c.id] = s
    }
  }

  // 1. The names the teacher wrote. They are claims on a letter, so they are
  //    all read before anything is handed out.
  for (const c of open) {
    if (names[c.id] !== undefined) continue
    const typed = typedName(sources[c.id])
    if (typed && !taken.has(typed)) {
      names[c.id] = typed
      taken.add(typed)
    }
  }

  const free = (): string | null => {
    for (const letter of NAME_POOL) if (!taken.has(letter)) return letter
    return null
  }

  // 2. Every curve that is nobody's derivative, in sidebar order.
  const byId = new Map(open.map((c) => [c.id, c]))
  for (const c of open) {
    if (names[c.id] !== undefined) continue
    if (derivedFrom.has(c.id)) continue
    const letter = free()
    if (letter === null) continue
    names[c.id] = letter
    taken.add(letter)
  }

  // 3. The derived curves, named after the function they came from. Walked up
  //    the chain rather than one step, so f″ is f″ and not (f′)′, with a guard
  //    because a corrupt document could in principle carry a cycle.
  const stranded: FittedCurve[] = []
  for (const c of open) {
    if (names[c.id] !== undefined || !derivedFrom.has(c.id)) continue
    let at = c.id
    let order = 0
    let root: string | null = null
    for (let guard = 0; guard <= open.length; guard++) {
      const parent = derivedFrom.get(at)
      if (parent === undefined) {
        root = at
        break
      }
      order++
      at = parent
    }
    const base = root !== null && byId.has(root) ? names[root] : undefined
    if (base === undefined) stranded.push(c)
    else names[c.id] = primed(base, order)
  }

  // A derivative whose parent is hidden or gone is still a graph on the board,
  // so it gets a letter of its own rather than nothing at all.
  for (const c of stranded) {
    const letter = free()
    if (letter === null) continue
    names[c.id] = letter
    taken.add(letter)
  }

  // 4. An inverse is f⁻¹ — of its parent's letter, stored or derived, whether
  //    or not the parent itself is on show.
  for (const c of curves) {
    const parent = inverseOf.get(c.id)
    if (parent === undefined || !c.visible) continue
    const base = names[parent] ?? stored?.[parent]
    if (typeof base === 'string' && base !== '') names[c.id] = inverted(base)
  }

  return names
}

/**
 * The names on this board, in the order the sidebar lists them.
 *
 * The caption is a sentence — "Graphs of f, g, and f′" — and a sentence needs
 * an order. The Record cannot carry one (a curve id that looks like an integer
 * would reorder the keys), so the curve list is asked instead.
 */
export function namesInOrder(
  curves: readonly FittedCurve[],
  names: Readonly<Record<string, string>>,
): string[] {
  const out: string[] = []
  for (const c of curves) {
    const n = names[c.id]
    if (typeof n === 'string' && n !== '') out.push(n)
  }
  return out
}
