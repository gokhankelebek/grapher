// ============================================================================
// src/ui/nameLinks.ts — curve NAMES, and the typed lines that call them.
//
//     f(x) = x^2        g(x) = 2f(x − 1) + 3        h(x) = f(g(x))
//     k(x) = f'(x)      y = 2f(x)                   f⁻¹ (Show inverse)
//
// Once a line can say "f", the letter f is part of the document. So:
//
//   NAMES are stored, one per curve, and never shift. A typed head
//   `g(x) = …` sets (and keeps) g; every other explicit, polar or parametric
//   curve takes the next free letter of NAME_POOL when it arrives — skipping
//   letters that some line already CALLS (a line waiting for its f must not be
//   handed an unrelated sketch) and letters that are sliders on the board.
//   Derivatives (f′), tangents and inverses (f⁻¹) are named after their
//   parent and hold no letter of their own. Implicit curves (circles) hold no
//   letter either — they are not graphs of a function, and a caption never
//   named them.
//
//   CALLS are stored, per typed line: the letters its `f(…)`, `f'(…)` are
//   calls of. They are decided ONCE, when the line is typed (or retyped):
//   a letter followed by "(" is a call when a curve of that name exists or is
//   awaited, when it carries a prime, or when it is f, g or h — otherwise it
//   stays the slider-times-bracket it always was (`a(x + 1)`). Fixing them at
//   typing time is what lets a line whose f was deleted say "f is not
//   defined" rather than silently turn f into a slider, and come back when f
//   does.
//
//   THE ENV a line is parsed against says `has` for exactly its calls (and its
//   own head, so `f(x) = f(x − 1)` is the parser's self-reference error). Its
//   `eval` goes through ONE resolver that looks the name up on the live board
//   at every evaluation: a line's model never has to be rebuilt when f moves,
//   appears or disappears — f's slider moves g on the next frame, a missing f
//   is NaN (nothing drawn), a cycle is NaN at the re-entry (never a stack
//   overflow). What a card SAYS about all that is lineErrors().
//
// Pure: no React, no DOM, no canvas. The App owns the state; this owns the
// meaning of it.
// ============================================================================

import type { FittedCurve, ModelSpec, Vec2 } from '../core/types'
import type { FunctionEnv } from '../core/functionEnv'
import { dependencyOrder, inverseRelation } from '../core/functionEnv'
import { namedCallSites } from '../core/parse'
import { findHoles, findPoles } from '../core/holes'
import type { CalcLink, InverseLink } from '../core/persist'
import { NAME_POOL, typedName } from '../render/curveNames'

export type { InverseLink }

/** Letters the parser reads as variables or constants: never a callable name. */
export const BUILTIN_LETTERS: ReadonlySet<string> = new Set(['x', 'y', 'r', 't', 'e'])

/**
 * Letters that read as a function whenever "(" follows them, even before a
 * curve of that name exists — `h(x) = f(g(x))` typed first waits for f and g.
 * Every other letter needs a curve of that name (or a prime) to be a call, so
 * the vertex form `a(x − h)^2 + k` keeps its sliders.
 */
export const CALL_LETTERS: ReadonlySet<string> = new Set(['f', 'g', 'h'])

export type Names = Readonly<Record<string, string>>
export type Calls = Readonly<Record<string, readonly string[]>>

/** Any single ASCII letter (what a document may store). */
export function isLetter(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z]$/.test(v)
}

/**
 * Why `letter` cannot be a curve's name, or null when it can: one letter, and
 * not one the parser already reads as something (x, y, r, t, e).
 */
export function nameProblem(letter: string): string | null {
  if (!isLetter(letter)) return 'A name is one letter, like f, g or h.'
  if (BUILTIN_LETTERS.has(letter)) {
    return `${letter} already means something in an equation — pick another letter.`
  }
  return null
}

/** Record equality by value (own string values). */
function sameRecord(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) {
    const va = a[k]
    const vb = b[k]
    if (Array.isArray(va) && Array.isArray(vb)) {
      if (va.length !== vb.length || va.some((v, i) => v !== vb[i])) return false
    } else if (va !== vb) return false
  }
  return true
}

/** "f", "f and g", "f, g and h". */
export function joinNames(ns: readonly string[]): string {
  if (ns.length <= 1) return ns[0] ?? ''
  return `${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`
}

// ----------------------------------------------------------------------------
// who holds a letter
// ----------------------------------------------------------------------------

/**
 * The curves that are a measurement of another and hold no letter of their
 * own: tangent lines, derivative curves (f′), inverse relations (f⁻¹).
 */
export function derivedIds(
  calc: readonly CalcLink[] = [],
  inverses: readonly InverseLink[] = [],
): Set<string> {
  const out = new Set<string>()
  for (const l of calc) {
    if (l.kind === 'tangent' || l.kind === 'derivative') out.add(l.curveId)
  }
  for (const l of inverses) out.add(l.curveId)
  return out
}

/** Can this curve hold a letter? Explicit, polar or parametric, not derived. Hidden ones too. */
export function holdsName(c: FittedCurve, derived: ReadonlySet<string>): boolean {
  return (
    (c.kind === 'explicit' || c.kind === 'polar' || c.kind === 'parametric') && !derived.has(c.id)
  )
}

/** letter -> curve id, for the curves that hold one. */
export function nameOwners(names: Names): Map<string, string> {
  const out = new Map<string, string>()
  for (const [id, letter] of Object.entries(names)) if (!out.has(letter)) out.set(letter, id)
  return out
}

/** Every letter some line calls — present or awaited. */
export function awaitedLetters(calls: Calls): Set<string> {
  const out = new Set<string>()
  for (const list of Object.values(calls)) for (const l of list) out.add(l)
  return out
}

export interface NameBoard {
  curves: readonly FittedCurve[]
  /** The typed text per curve: exprSources merged over displaySources. */
  sources: Readonly<Record<string, string>>
  calc?: readonly CalcLink[]
  inverses?: readonly InverseLink[]
  calls?: Calls
}

/** The next letter of the pool nobody holds and nobody reserves. */
export function nextFreeLetter(taken: ReadonlySet<string>, reserved: ReadonlySet<string> = new Set()): string | null {
  for (const l of NAME_POOL) if (!taken.has(l) && !reserved.has(l)) return l
  return null
}

/**
 * The names this board should have, given the ones it had.
 *
 * Every letter already held stays where it is (that is the whole point); a
 * name whose curve left, or became a tangent/derivative/inverse, is dropped;
 * a typed head `g(x) = …` claims g when nobody else holds it; and every curve
 * still without a letter takes the next free one, in sidebar order, skipping
 * the letters lines are waiting for and whatever `reserved()` returns (the
 * board's slider letters — asked only when a letter is actually handed out).
 *
 * Returns `prev` itself when nothing changed, so a slider drag that calls
 * this on every frame re-renders nothing.
 */
export function ensureNames(
  prev: Names,
  board: NameBoard,
  reserved?: () => Iterable<string>,
): Record<string, string> {
  const derived = derivedIds(board.calc, board.inverses)
  const eligible = board.curves.filter((c) => holdsName(c, derived))
  const out: Record<string, string> = {}
  const taken = new Set<string>()
  for (const c of eligible) {
    const n = prev[c.id]
    if (isLetter(n) && !taken.has(n)) {
      out[c.id] = n
      taken.add(n)
    }
  }
  for (const c of eligible) {
    const h = typedName(board.sources[c.id])
    if (!h || out[c.id] === h || taken.has(h)) continue
    if (out[c.id] !== undefined) taken.delete(out[c.id])
    out[c.id] = h
    taken.add(h)
  }
  let res: Set<string> | null = null
  for (const c of eligible) {
    if (out[c.id] !== undefined) continue
    if (!res) res = new Set([...awaitedLetters(board.calls ?? {}), ...(reserved ? reserved() : [])])
    const letter = nextFreeLetter(taken, res)
    if (letter === null) continue
    out[c.id] = letter
    taken.add(letter)
  }
  return sameRecord(prev, out) ? (prev as Record<string, string>) : out
}

/** The calls map with entries only for typed lines still on the board. `prev` when unchanged. */
export function ensureCalls(
  prev: Calls,
  curves: readonly FittedCurve[],
  exprSources: Readonly<Record<string, string>>,
): Record<string, string[]> {
  const ids = new Set(curves.map((c) => c.id))
  const out: Record<string, string[]> = {}
  for (const [id, list] of Object.entries(prev)) {
    if (ids.has(id) && exprSources[id] !== undefined && list.length > 0) out[id] = list.slice()
  }
  return sameRecord(prev, out) ? (prev as Record<string, string[]>) : out
}

/**
 * Seed names for a document that stored none: the letters the board used to
 * derive for it (so the caption it printed yesterday still names the same
 * curves), for the curves that can hold one.
 */
export function legacyNames(
  derivedNames: Names,
  board: NameBoard,
): Record<string, string> {
  const derived = derivedIds(board.calc, board.inverses)
  const out: Record<string, string> = {}
  const taken = new Set<string>()
  for (const c of board.curves) {
    if (!holdsName(c, derived)) continue
    const n = derivedNames[c.id]
    if (isLetter(n) && !taken.has(n)) {
      out[c.id] = n
      taken.add(n)
    }
  }
  return out
}

// ----------------------------------------------------------------------------
// which letters a line calls
// ----------------------------------------------------------------------------

export interface BindContext {
  /** Letters that name something on the board or are awaited, minus the line's own. */
  letters: ReadonlySet<string>
  /** What the line called before this edit: those stay calls. */
  prevCalls?: readonly string[]
  /** What the line's model had as sliders before this edit: those stay sliders. */
  prevSliders?: ReadonlySet<string>
}

/**
 * The letters `src` calls, decided at typing time (see the header): in order
 * of first appearance, never the line's own head.
 */
export function boundCalls(src: string, ctx: BindContext): string[] {
  const { head, sites } = namedCallSites(src)
  const primed = new Set(sites.filter((s) => s.order > 0).map((s) => s.name))
  const prev = new Set(ctx.prevCalls ?? [])
  const out: string[] = []
  for (const s of sites) {
    const L = s.name
    if (L === head || out.includes(L)) continue
    const bind =
      prev.has(L) ||
      primed.has(L) ||
      (!(ctx.prevSliders?.has(L) ?? false) && (ctx.letters.has(L) || CALL_LETTERS.has(L)))
    if (bind) out.push(L)
  }
  return out
}

/** Every letter on the board a new line may call: held names plus awaited ones. */
export function boardLetters(names: Names, calls: Calls, except?: string): Set<string> {
  const out = new Set<string>([...Object.values(names), ...awaitedLetters(calls)])
  if (except) out.delete(except)
  return out
}

/** The single-letter sliders of every typed line (reserved from auto names and renames). */
export function sliderLetters(
  curves: readonly FittedCurve[],
  exprSources: Readonly<Record<string, string>>,
  models: Readonly<Record<string, ModelSpec>>,
): Set<string> {
  const out = new Set<string>()
  for (const c of curves) {
    if (exprSources[c.id] === undefined) continue
    const spec = models[c.modelId]
    if (!spec) continue
    try {
      for (const m of spec.paramMeta(c.params)) if (isLetter(m.name)) out.add(m.name)
    } catch {
      /* a model that cannot describe its sliders reserves nothing */
    }
  }
  return out
}

// ----------------------------------------------------------------------------
// renaming — one letter becomes another everywhere it is used
// ----------------------------------------------------------------------------

/**
 * `src` with the letter `from` replaced by `to` at its call sites (`calls`)
 * and/or as the head of a definition (`head`). Positions come from the
 * parser's own tokenizer, so `sin(x)` and a slider `a(x + 1)` are never
 * touched by accident — only letters in call position, which the caller has
 * already established ARE calls of `from`.
 */
export function rewriteName(
  src: string,
  from: string,
  to: string,
  which: { head?: boolean; calls?: boolean },
): string {
  const { head, sites } = namedCallSites(src)
  const at: number[] = []
  if (which.calls) for (const s of sites) if (s.name === from) at.push(s.pos)
  if (which.head && head === from) {
    const lead = /^\s*/.exec(src)
    at.push(lead ? lead[0].length : 0)
  }
  if (at.length === 0) return src
  const chars = src.split('')
  for (const p of at) if (chars[p] === from) chars[p] = to
  return chars.join('')
}

export interface NameState {
  names: Record<string, string>
  exprSources: Record<string, string>
  displaySources: Record<string, string>
  calls: Record<string, string[]>
}

export interface NameMove {
  state: NameState
  /** Typed lines whose TEXT changed (they need a fresh model). */
  rewritten: string[]
}

/**
 * Give curve `id` the letter `to`, rewriting every line that calls its old
 * letter (and its own `f(x) = …` head) to match. No checks: see planRename
 * and planClaim.
 */
export function moveName(st: NameState, id: string, to: string): NameMove {
  const from = st.names[id]
  const names = { ...st.names, [id]: to }
  if (!from || from === to) return { state: { ...st, names }, rewritten: [] }
  const exprSources = { ...st.exprSources }
  const displaySources = { ...st.displaySources }
  const calls = { ...st.calls }
  const rewritten: string[] = []
  for (const [lineId, list] of Object.entries(st.calls)) {
    if (lineId === id || !list.includes(from)) continue
    const src = exprSources[lineId]
    if (src === undefined) continue
    exprSources[lineId] = rewriteName(src, from, to, { calls: true })
    calls[lineId] = [...new Set(list.map((l) => (l === from ? to : l)))]
    if (exprSources[lineId] !== src) rewritten.push(lineId)
  }
  const own = exprSources[id]
  if (own !== undefined && typedName(own) === from) {
    exprSources[id] = rewriteName(own, from, to, { head: true })
    if (exprSources[id] !== own) rewritten.push(id)
  }
  const shown = displaySources[id]
  if (shown !== undefined && typedName(shown) === from) {
    displaySources[id] = rewriteName(shown, from, to, { head: true })
  }
  return { state: { names, exprSources, displaySources, calls }, rewritten }
}

/**
 * The teacher renames a curve from its card. Refused (in words) for a letter
 * that is not a name, that another curve holds, or that is a slider on this
 * board — a slider `a` and a curve `a` would make `a(x + 1)` mean two things.
 */
export function planRename(
  st: NameState,
  id: string,
  to: string,
  sliders: ReadonlySet<string> = new Set(),
): NameMove | { error: string } {
  const letter = to.trim()
  const bad = nameProblem(letter)
  if (bad) return { error: bad }
  if (st.names[id] === letter) return { state: st, rewritten: [] }
  const holder = nameOwners(st.names).get(letter)
  if (holder !== undefined && holder !== id) {
    return { error: `${letter} is already the name of another curve.` }
  }
  if (sliders.has(letter)) {
    return { error: `${letter} is a slider on this board — pick another letter.` }
  }
  return moveName(st, id, letter)
}

export interface NameClaim extends NameMove {
  /** The curve that had to give the letter up, and what it is called now. */
  displaced?: { id: string; from: string; to: string }
}

/**
 * A typed head `f(x) = …` claims f for curve `id` (a new line, or a line
 * whose head was retyped). When a curve that got f AUTOMATICALLY holds it,
 * that curve moves to the next free letter — and every line calling it
 * follows it there, so they keep meaning the same curve. When f is another
 * line's own typed head, the claim is refused: two definitions of f is a
 * question only the teacher can answer.
 */
export function planClaim(
  st: NameState,
  id: string,
  head: string,
  reserved: ReadonlySet<string> = new Set(),
): NameClaim | { error: string } {
  if (st.names[id] === head) return { state: st, rewritten: [] }
  let state = st
  const rewritten: string[] = []
  let displaced: NameClaim['displaced']
  const holder = nameOwners(st.names).get(head)
  if (holder !== undefined && holder !== id) {
    const holderHead = typedName(st.exprSources[holder] ?? st.displaySources[holder])
    if (holderHead === head) {
      return {
        error: `${head} is already defined on this board — use another letter, or rename that curve first.`,
      }
    }
    const taken = new Set(Object.values(st.names))
    const free = nextFreeLetter(taken, new Set([...reserved, head, ...awaitedLetters(st.calls)]))
    if (free === null) return { error: `${head} is taken, and there is no free letter to move that curve to.` }
    const moved = moveName(state, holder, free)
    state = moved.state
    rewritten.push(...moved.rewritten)
    displaced = { id: holder, from: head, to: free }
  }
  const mine = moveName(state, id, head)
  for (const r of mine.rewritten) if (!rewritten.includes(r)) rewritten.push(r)
  return { state: mine.state, rewritten, ...(displaced ? { displaced } : {}) }
}

// ----------------------------------------------------------------------------
// what each line's card says
// ----------------------------------------------------------------------------

/** "a circle", "a polar curve" — what a non-function IS, in a sentence. */
function kindPhrase(c: FittedCurve, spec: ModelSpec | undefined): string {
  let noun: string
  if (c.kind === 'polar') noun = 'polar curve'
  else if (c.kind === 'parametric') noun = 'parametric curve'
  else {
    const n = (spec?.name ?? '').toLowerCase()
    noun = /^(circle|ellipse|hyperbola|parabola|line)$/.test(n) ? n : 'relation'
  }
  return `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`
}

/** "f is a circle — only functions of x can be used as f(…)". */
export function notCallable(letter: string, c: FittedCurve, spec: ModelSpec | undefined): string {
  return `${letter} is ${kindPhrase(c, spec)} — only functions of x can be used as ${letter}(…)`
}

export interface LineBoard {
  curves: readonly FittedCurve[]
  names: Names
  calls: Calls
  models: Readonly<Record<string, ModelSpec>>
}

/**
 * curveId -> why this typed line cannot be drawn right now, for every line
 * that calls something and cannot: "f is not defined" (until f appears),
 * "f is a circle — …", "f and g use each other" (every line on the cycle),
 * "Uses g, which can't be drawn" (downstream of any of those). Lines that
 * are fine are absent.
 *
 * Nothing here stops a curve being DRAWN — its model already evaluates to
 * NaN through the resolver in each of these cases. This is what the card
 * says about it.
 */
export function lineErrors(board: LineBoard): Record<string, string> {
  const byId = new Map(board.curves.map((c) => [c.id, c]))
  const owner = new Map<string, FittedCurve>()
  for (const c of board.curves) {
    const n = board.names[c.id]
    if (n && !owner.has(n)) owner.set(n, c)
  }
  const out: Record<string, string> = {}
  const lines = Object.entries(board.calls).filter(([id, l]) => byId.has(id) && l.length > 0)

  for (const [id, list] of lines) {
    const own = board.names[id]
    const self = list.find((L) => L === own)
    if (self) {
      out[id] = `${self} cannot use itself`
      continue
    }
    const missing = list.find((L) => !owner.has(L))
    if (missing) {
      out[id] = `${missing} is not defined`
      continue
    }
    const odd = list.find((L) => owner.get(L)!.kind !== 'explicit')
    if (odd) {
      const c = owner.get(odd)!
      out[id] = notCallable(odd, c, board.models[c.modelId])
    }
  }

  // Cycles, over every named curve (a sketch uses nothing, so it is never on one).
  const defs = [...owner.entries()].map(([name, c]) => ({
    name,
    uses: (board.calls[c.id] ?? []).filter((L) => owner.has(L)),
  }))
  const { order, cycles } = dependencyOrder(defs)
  for (const cyc of cycles) {
    const members = [...new Set(cyc)]
    const msg = `${joinNames(members)} use each other`
    for (const m of members) {
      const c = owner.get(m)
      if (c && out[c.id] === undefined && board.calls[c.id]) out[c.id] = msg
    }
  }

  // Downstream: a line that calls a curve that cannot be drawn cannot either.
  // `order` puts every name after the names it uses, so one pass would do;
  // the loop is a guard for the names left over on cycles.
  for (let guard = 0; guard <= lines.length; guard++) {
    let grew = false
    for (const name of order) {
      const c = owner.get(name)
      if (!c || out[c.id] !== undefined) continue
      const list = board.calls[c.id] ?? []
      const bad = list.find((L) => {
        const u = owner.get(L)
        return u !== undefined && out[u.id] !== undefined
      })
      if (bad) {
        out[c.id] = `Uses ${bad}, which can't be drawn`
        grew = true
      }
    }
    // Lines without a name of their own (an implicit typed line) are not in
    // `order`; they are downstream only.
    for (const [id, list] of lines) {
      if (out[id] !== undefined || board.names[id] !== undefined) continue
      const bad = list.find((L) => {
        const u = owner.get(L)
        return u !== undefined && out[u.id] !== undefined
      })
      if (bad) {
        out[id] = `Uses ${bad}, which can't be drawn`
        grew = true
      }
    }
    if (!grew) break
  }
  return out
}

/**
 * The toast line for deleting curves some line still calls: "g uses f — it
 * will reappear if f comes back". Null when nothing on the board calls them.
 */
export function orphanNotice(
  deadIds: Iterable<string>,
  names: Names,
  calls: Calls,
): string | null {
  const dead = new Set(deadIds)
  const letters = new Set<string>()
  for (const id of dead) if (names[id]) letters.add(names[id])
  if (letters.size === 0) return null
  const users: string[] = []
  const used: string[] = []
  for (const [id, list] of Object.entries(calls)) {
    if (dead.has(id)) continue
    const hit = list.filter((L) => letters.has(L))
    if (hit.length === 0) continue
    users.push(names[id] ?? 'a line')
    for (const L of hit) if (!used.includes(L)) used.push(L)
  }
  if (users.length === 0) return null
  const one = users.length === 1
  const oneUsed = used.length === 1
  return `${joinNames(users)} ${one ? 'uses' : 'use'} ${joinNames(used)} — ${one ? 'it' : 'they'} will reappear if ${oneUsed ? used[0] : 'they'} ${oneUsed ? 'comes' : 'come'} back`
}

/**
 * curveId -> the state of everything that line reaches through its calls:
 * each called curve's family, params and domain, transitively. Appended to
 * every memo key that caches a curve by its own params (analysis, holes,
 * intersections, a tangent's sync), because g's own params do not move when
 * f's slider does — and g does. Absent for curves that call nothing.
 */
export function dependencyKeys(
  curves: readonly FittedCurve[],
  names: Names,
  calls: Calls,
): Record<string, string> {
  const owner = new Map<string, FittedCurve>()
  for (const c of curves) {
    const n = names[c.id]
    if (n && !owner.has(n)) owner.set(n, c)
  }
  const out: Record<string, string> = {}
  for (const [id, list] of Object.entries(calls)) {
    if (list.length === 0) continue
    const parts: string[] = []
    const seen = new Set<string>([id])
    const stack = [...list]
    while (stack.length > 0) {
      const L = stack.shift()!
      const c = owner.get(L)
      if (!c) {
        parts.push(`${L}=∅`)
        continue
      }
      if (seen.has(c.id)) continue
      seen.add(c.id)
      parts.push(`${L}=${c.modelId}:${c.params.join(',')}:${c.domain ? c.domain.join(',') : ''}`)
      for (const u of calls[c.id] ?? []) stack.push(u)
    }
    out[id] = parts.join('|')
  }
  return out
}

// ----------------------------------------------------------------------------
// evaluation: one resolver for the board, one env per line
// ----------------------------------------------------------------------------

export type Resolver = (name: string, x: number) => number

export interface BoardView {
  curves: readonly FittedCurve[]
  names: Names
  models: Readonly<Record<string, ModelSpec>>
}

/**
 * f(x) for the curve NAMED f, read off the board at the moment of the call —
 * its current model, params and domain (NaN outside the domain: a sketch is
 * the stretch that was drawn). NaN for a name nobody holds, for a curve that
 * is not a function of x, and for a name re-entered while it is being
 * evaluated (f and g calling each other), so a cycle is a blank curve rather
 * than a frozen tab. The owner table is rebuilt only when the curve array or
 * the names change identity, so a sample costs two map lookups.
 */
export function createResolver(read: () => BoardView): Resolver {
  let curvesKey: readonly FittedCurve[] | null = null
  let namesKey: Names | null = null
  let owner = new Map<string, FittedCurve>()
  const active = new Set<string>()
  return (name, x) => {
    const view = read()
    if (view.curves !== curvesKey || view.names !== namesKey) {
      curvesKey = view.curves
      namesKey = view.names
      owner = new Map()
      for (const c of view.curves) {
        const n = view.names[c.id]
        if (n && !owner.has(n)) owner.set(n, c)
      }
    }
    const c = owner.get(name)
    if (!c || c.kind !== 'explicit' || active.has(c.id)) return Number.NaN
    if (c.domain) {
      const lo = Math.min(c.domain[0], c.domain[1])
      const hi = Math.max(c.domain[0], c.domain[1])
      if (x < lo || x > hi) return Number.NaN
    }
    const spec = view.models[c.modelId]
    const ev = spec?.evalExplicit
    if (!ev) return Number.NaN
    active.add(c.id)
    try {
      const v = ev.call(spec, c.params, x)
      return typeof v === 'number' ? v : Number.NaN
    } catch {
      return Number.NaN
    } finally {
      active.delete(c.id)
    }
  }
}

/**
 * The env one line is parsed against: `has` for exactly the letters it calls
 * — whether or not a curve of that name exists right now, so the line's
 * shape never depends on the order things were typed in — plus its own head,
 * which is what turns `f(x) = f(x − 1)` into the parser's self-reference
 * error. `eval` is the board's resolver.
 */
export function lineEnv(
  resolve: Resolver,
  calls: readonly string[],
  head: string | null,
  singular?: SingularityResolver,
): FunctionEnv {
  const has = new Set(calls)
  if (head) has.add(head)
  const env: FunctionEnv = { has: (n) => has.has(n), eval: (n, x) => resolve(n, x) }
  if (singular) env.singularities = (n, range) => singular(n, range)
  return env
}

// ----------------------------------------------------------------------------
// singularities: where a NAMED curve is undefined
// ----------------------------------------------------------------------------

/** FunctionEnv.singularities for the board: the named curve's, in [lo, hi]. */
export type SingularityResolver = (name: string, range: [number, number]) => number[]

/** A board view that also knows which names each typed line calls. */
export interface SingularView extends BoardView {
  /** curveId -> the names it calls: what keeps a cached answer honest. */
  calls?: Calls
}

/** Entries kept before the cache starts over: a board has a handful of names. */
const SING_CACHE_MAX = 256

/**
 * The range a question is answered over: [lo, hi] rounded OUTWARD to the
 * power-of-ten step of its own width, so panning a little asks the same
 * question (and hits the cache) until an edge crosses a step. The answer is
 * then clipped back to the range that was asked.
 */
export function roundedRange(lo: number, hi: number): [number, number] {
  const w = hi - lo
  const step = 10 ** Math.floor(Math.log10(w))
  const a = Math.floor(lo / step) * step
  const b = Math.ceil(hi / step) * step
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? [a, b] : [lo, hi]
}

/** Sorted, with values within 1e-9 (relative) of each other counted once. */
function sortedUnique(xs: readonly number[]): number[] {
  const s = xs.filter(Number.isFinite).sort((p, q) => p - q)
  const out: number[] = []
  for (const x of s) {
    const last = out[out.length - 1]
    if (last !== undefined && Math.abs(x - last) <= 1e-9 * Math.max(1, Math.abs(x))) continue
    out.push(x)
  }
  return out
}

/**
 * Where the curve NAMED `name` is undefined as written, in [lo, hi] of x:
 * its model's own `singularities` (a typed line's poles, holes and `{x ≠ c}`
 * exclusions), plus the x of every vertical asymptote findPoles finds and
 * every hole findHoles finds — which is what answers for a SKETCHED family
 * (a recip's pole at x = b) that carries no `singularities` of its own.
 * Deduped and sorted. Nothing for a name nobody holds, a curve that is not a
 * function of x, or a name re-entered while it is being answered (f and g
 * calling each other).
 *
 * Memoised per (curve, model, params, domain, rounded range) plus the state
 * of every curve it reaches through its calls — so a line that calls f is
 * asked again when f's slider moves, and not on every frame otherwise. The
 * cache starts over whenever the model table changes identity (a retyped line
 * registers a new closure).
 */
export function createSingularityResolver(read: () => SingularView): SingularityResolver {
  let curvesKey: readonly FittedCurve[] | null = null
  let namesKey: Names | null = null
  let modelsKey: Readonly<Record<string, ModelSpec>> | null = null
  let owner = new Map<string, FittedCurve>()
  const cache = new Map<string, number[]>()
  const active = new Set<string>()

  const stateOf = (c: FittedCurve): string =>
    `${c.modelId}:${c.params.join(',')}:${c.domain ? c.domain.join(',') : ''}`

  /** The state of everything `id` reaches through its calls, as dependencyKeys does. */
  const depOf = (id: string, calls: Calls | undefined): string => {
    const list = calls?.[id]
    if (!calls || !list || list.length === 0) return ''
    const parts: string[] = []
    const seen = new Set<string>([id])
    const stack = [...list]
    while (stack.length > 0) {
      const L = stack.shift()!
      const c = owner.get(L)
      if (!c) {
        parts.push(`${L}=∅`)
        continue
      }
      if (seen.has(c.id)) continue
      seen.add(c.id)
      parts.push(`${L}=${stateOf(c)}`)
      for (const u of calls[c.id] ?? []) stack.push(u)
    }
    return parts.join('|')
  }

  return (name, range) => {
    const view = read()
    if (view.models !== modelsKey) {
      modelsKey = view.models
      cache.clear()
    }
    if (view.curves !== curvesKey || view.names !== namesKey) {
      curvesKey = view.curves
      namesKey = view.names
      owner = new Map()
      for (const c of view.curves) {
        const n = view.names[c.id]
        if (n && !owner.has(n)) owner.set(n, c)
      }
    }
    const c = owner.get(name)
    if (!c || c.kind !== 'explicit' || active.has(c.id)) return []
    const spec = view.models[c.modelId]
    if (!spec?.evalExplicit) return []
    const lo = Math.min(range[0], range[1])
    const hi = Math.max(range[0], range[1])
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return []
    const r = roundedRange(lo, hi)
    const key = `${c.id}|${stateOf(c)}|${r[0]}|${r[1]}|${depOf(c.id, view.calls)}`
    let xs = cache.get(key)
    if (!xs) {
      active.add(c.id)
      try {
        const models = view.models as Record<string, ModelSpec>
        const found: number[] = []
        try {
          found.push(...(spec.singularities?.(c.params, r) ?? []))
        } catch {
          /* a model that cannot say contributes nothing */
        }
        found.push(...findPoles(c, models, r))
        for (const h of findHoles(c, models, r)) found.push(h.x)
        // A sketch is the stretch that was drawn: only what lies strictly
        // inside it is a singularity of the curve (an end is an end).
        let dLo = -Infinity
        let dHi = Infinity
        if (c.domain) {
          dLo = Math.min(c.domain[0], c.domain[1])
          dHi = Math.max(c.domain[0], c.domain[1])
        }
        xs = sortedUnique(found.filter((x) => x > dLo && x < dHi))
      } finally {
        active.delete(c.id)
      }
      if (cache.size >= SING_CACHE_MAX) cache.clear()
      cache.set(key, xs)
    }
    return xs.filter((x) => x >= lo && x <= hi)
  }
}

/** The explicit curves' letters, in sidebar order — what the equation box offers. */
export function callableNames(curves: readonly FittedCurve[], names: Names): string[] {
  const out: string[] = []
  for (const c of curves) {
    const n = names[c.id]
    if (n && c.kind === 'explicit' && !out.includes(n)) out.push(n)
  }
  return out
}

// ----------------------------------------------------------------------------
// inverses
// ----------------------------------------------------------------------------

/**
 * The x-stretch an inverse reflects: the parent's own domain when it has one
 * (a sketch), otherwise the visible window widened to three times its width,
 * so the reflection runs well past the screen it was asked for on.
 */
export function inverseRange(parent: FittedCurve, window: [number, number]): [number, number] {
  if (parent.domain) {
    return [Math.min(parent.domain[0], parent.domain[1]), Math.max(parent.domain[0], parent.domain[1])]
  }
  const lo = Math.min(window[0], window[1])
  const hi = Math.max(window[0], window[1])
  const w = Math.max(hi - lo, 1e-6)
  const mid = (lo + hi) / 2
  return [mid - 1.5 * w, mid + 1.5 * w]
}

/**
 * The inverse curve's model: the parametric (f(t), t), reading the PARENT
 * live — its current model and params at every sample — so it follows a
 * slider drag with nothing rebuilt. Registered once per link under a stable
 * id. `latex` supplies the equation the card prints (see inverseInfo).
 */
export function inverseSpec(
  modelId: string,
  parentId: string,
  read: () => { curves: readonly FittedCurve[]; models: Readonly<Record<string, ModelSpec>> },
  latex: () => string,
): ModelSpec {
  let key: readonly FittedCurve[] | null = null
  let parent: FittedCurve | undefined
  const f = (t: number): number => {
    const view = read()
    if (view.curves !== key) {
      key = view.curves
      parent = view.curves.find((c) => c.id === parentId)
    }
    if (!parent || parent.kind !== 'explicit') return Number.NaN
    const spec = view.models[parent.modelId]
    const ev = spec?.evalExplicit
    if (!ev) return Number.NaN
    try {
      const v = ev.call(spec, parent.params, t)
      return typeof v === 'number' ? v : Number.NaN
    } catch {
      return Number.NaN
    }
  }
  return {
    id: modelId,
    kind: 'parametric',
    name: 'Inverse',
    evalParametric: (_p: number[], t: number): Vec2 => ({ x: f(t), y: t }),
    latex: () => latex(),
    paramMeta: () => [],
  }
}

export interface InverseInfo {
  /** "f is one-to-one, so its inverse is a function" / "… restrict its domain to x ≥ 0". */
  sentence: string
  oneToOne: boolean
  /** The t-range the relation is drawn over: the link's range, clipped to f's domain. */
  tRange: [number, number]
  /** "x = y^{2}" — the relation, for the card. */
  latex: string
}

/** The relation's facts, from src/core/functionEnv.ts's inverseRelation. */
export function inverseInfo(
  parent: FittedCurve,
  models: Readonly<Record<string, ModelSpec>>,
  link: Pick<InverseLink, 'from' | 'to'>,
  name: string,
): InverseInfo {
  const rel = inverseRelation(parent, models as Record<string, ModelSpec>, [link.from, link.to], name)
  let latex = 'x = f\\left(y\\right)'
  try {
    latex = rel.makeModel('__inverse_probe__').latex([])
  } catch {
    /* keep the generic form */
  }
  return { sentence: rel.sentence, oneToOne: rel.oneToOne, tRange: rel.tRange, latex }
}

/** The inverse links (and their curves) that go when `dead` curves go. */
export function inverseDependents(
  inverses: readonly InverseLink[],
  dead: ReadonlySet<string>,
): { linkIds: Set<string>; curveIds: Set<string> } {
  const linkIds = new Set<string>()
  const curveIds = new Set<string>()
  for (const l of inverses) {
    if (dead.has(l.parentId) || dead.has(l.curveId)) {
      linkIds.add(l.id)
      curveIds.add(l.curveId)
    }
  }
  return { linkIds, curveIds }
}
