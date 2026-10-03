// ============================================================================
// src/core/probPersist.ts — what a document stores for a Probability object
// (Build ▾ → Probability; NC Math 2 S-CP.1, 3–8).
//
// One board object with three views — a two-way table, a Venn diagram, a tree
// diagram — stored as `board.stats` entries of type 'prob' beside the other
// statistics panels. What is stored is what the teacher SET: the table's
// labels and counts, which row is A and which column is B, the region values
// as typed ("12", "0.15", "3/20"), the event expression, the bag or the typed
// stages, and the leaves picked for the tree's event. Every total,
// probability, verdict and product is recomputed (src/core/probability.ts).
//
// Optional settings are written only when they differ from the default, so a
// round trip is byte-identical; a board without one never mentions it.
// ============================================================================

import type { BagColor, RelView } from './probability'

export type ProbView = 'table' | 'venn' | 'tree'

export const PROB_COLOR_DEFAULT = '#f59e0b'
export const MIN_DIM = 2
export const MAX_DIM = 4
export const MAX_LABEL = 30
export const MAX_COUNT = 1_000_000
export const MAX_TEXT = 24
export const MAX_EXPR = 80
export const MAX_COLORS = 4
export const MAX_BAG = 100
export const MAX_DRAWS = 3
export const MAX_TREE_STAGES = 3
export const MAX_TREE_OUTCOMES = 4

export interface ProbTable {
  rows: string[]
  cols: string[]
  /** counts[row][col]: whole numbers ≥ 0. */
  counts: number[][]
  /** Event A is row `a`; event B is column `b`. */
  a: number
  b: number
  /** The conditional the readouts lead with: P(A|B) (given B) or P(B|A). */
  given: 'B' | 'A'
  /** Counts, or joint / row / column percentages. */
  rel: RelView
}

export interface ProbVenn {
  sets: 2 | 3
  /** What A, B (and C) stand for ("Plays sport"); '' = just the letter. */
  names: string[]
  /** One value per region (atom numbering of src/core/probability.ts), as typed. */
  regions: string[]
  /** Two sets taken from the table: A = its row a, B = its column b. */
  fromTable: boolean
  /** The shaded event, as typed ("A ∩ Bᶜ"). */
  expr: string
}

export interface ProbStage {
  name: string
  outcomes: string[]
  /** probs[node][branch] as typed; one row when `same`. */
  probs: string[][]
  /** The same probabilities after every earlier outcome (independent stage). */
  same: boolean
}

export interface ProbTree {
  mode: 'bag' | 'manual'
  bag: BagColor[]
  draws: number
  replace: boolean
  stages: ProbStage[]
  /** The leaves (path keys "0.1") in the event. */
  pick: string[]
  /** The event's name when it came from a ready-made one ("both Red"). */
  event?: string
}

export interface BoardProb {
  id: string
  type: 'prob'
  view: ProbView
  table: ProbTable
  venn: ProbVenn
  tree: ProbTree
  color: string
  hidden?: true
}

export interface StoredProb {
  id: string
  type: 'prob'
  view: ProbView
  table: {
    rows: string[]
    cols: string[]
    counts: number[][]
    a?: number
    b?: number
    given?: 'A'
    rel?: Exclude<RelView, 'count'>
  }
  venn: { sets: 2 | 3; names?: string[]; regions: string[]; fromTable?: true; expr: string }
  tree: {
    mode: 'bag' | 'manual'
    bag: BagColor[]
    draws: number
    replace?: true
    stages?: ProbStage[]
    pick?: string[]
    event?: string
  }
  color?: string
  hidden?: true
}

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

/** Grade 9 / Grade 10 × plays a sport: NOT independent (P(sport | Grade 9) = 3/5 ≠ P(sport) = 9/20). */
export const EXAMPLE_TABLE: ProbTable = {
  rows: ['Grade 9', 'Grade 10'],
  cols: ['Plays sport', 'Doesn’t'],
  counts: [
    [30, 20],
    [15, 35],
  ],
  a: 0,
  b: 0,
  given: 'B',
  rel: 'count',
}

/** The same question, independent: 18/40 = 27/60 = 9/20 play a sport in each grade. */
export const EXAMPLE_TABLE_INDEPENDENT: ProbTable = {
  rows: ['Grade 9', 'Grade 10'],
  cols: ['Plays sport', 'Doesn’t'],
  counts: [
    [18, 22],
    [27, 33],
  ],
  a: 0,
  b: 0,
  given: 'B',
  rel: 'count',
}

export const EXAMPLE_VENN: ProbVenn = {
  sets: 2,
  names: ['Plays sport', 'In a club', ''],
  regions: ['7', '8', '10', '5'],
  fromTable: false,
  expr: 'A ∩ Bᶜ',
}

/** 3 red and 2 blue, two draws without replacement; the event "both Red" (P = 3/10). */
export const EXAMPLE_TREE: ProbTree = {
  mode: 'bag',
  bag: [
    { name: 'Red', count: 3 },
    { name: 'Blue', count: 2 },
  ],
  draws: 2,
  replace: false,
  stages: [
    { name: 'Coin', outcomes: ['Heads', 'Tails'], probs: [['1/2', '1/2']], same: true },
    { name: 'Spinner', outcomes: ['Win', 'Lose'], probs: [['1/4', '3/4']], same: true },
  ],
  pick: ['0.0'],
  event: 'both Red',
}

/** A three-set example, by region in atom order (0 = in none … 7 = in all three): 30 in all. */
export const EXAMPLE_VENN3_REGIONS = ['4', '6', '5', '3', '7', '2', '1', '2']

export function newProb(id: string): BoardProb {
  return {
    id,
    type: 'prob',
    view: 'table',
    table: cloneTable(EXAMPLE_TABLE),
    venn: { ...EXAMPLE_VENN, names: EXAMPLE_VENN.names.slice(), regions: EXAMPLE_VENN.regions.slice() },
    tree: cloneTree(EXAMPLE_TREE),
    color: PROB_COLOR_DEFAULT,
  }
}

export function cloneTable(t: ProbTable): ProbTable {
  return { ...t, rows: t.rows.slice(), cols: t.cols.slice(), counts: t.counts.map((r) => r.slice()) }
}

export function cloneTree(t: ProbTree): ProbTree {
  return {
    ...t,
    bag: t.bag.map((c) => ({ ...c })),
    stages: t.stages.map((s) => ({ ...s, outcomes: s.outcomes.slice(), probs: s.probs.map((r) => r.slice()) })),
    pick: t.pick.slice(),
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export function probToStored(p: BoardProb): StoredProb {
  const t = p.table
  const table: StoredProb['table'] = { rows: t.rows.slice(), cols: t.cols.slice(), counts: t.counts.map((r) => r.slice()) }
  if (t.a !== 0) table.a = t.a
  if (t.b !== 0) table.b = t.b
  if (t.given === 'A') table.given = 'A'
  if (t.rel !== 'count') table.rel = t.rel
  const v = p.venn
  const venn: StoredProb['venn'] = { sets: v.sets, regions: v.regions.slice(), expr: v.expr }
  if (v.names.some((n) => n !== '')) venn.names = v.names.slice()
  if (v.fromTable) venn.fromTable = true
  const tr = p.tree
  const tree: StoredProb['tree'] = { mode: tr.mode, bag: tr.bag.map((c) => ({ name: c.name, count: c.count })), draws: tr.draws }
  if (tr.replace) tree.replace = true
  if (tr.stages.length > 0) tree.stages = tr.stages.map((s) => ({ name: s.name, outcomes: s.outcomes.slice(), probs: s.probs.map((r) => r.slice()), same: s.same }))
  if (tr.pick.length > 0) tree.pick = tr.pick.slice()
  if (tr.event) tree.event = tr.event
  const out: StoredProb = { id: p.id, type: 'prob', view: p.view, table, venn, tree }
  if (p.color !== PROB_COLOR_DEFAULT) out.color = p.color
  if (p.hidden) out.hidden = true
  return out
}

// ---------------------------------------------------------------------------
// Reading an untrusted blob
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_COUNT

function isColor(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const t = v.trim()
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)) return true
  return /^(?:rgba?|hsla?)\(\s*[-+0-9.%\s,/deg]+\)$/i.test(t)
}

const PATH_KEY = /^\d(?:\.\d){0,2}$/

export function storedToProb(raw: Record<string, unknown>, id: string, problems?: string[]): { stat: BoardProb } | { error: string } {
  const say = (s: string): void => {
    problems?.push(`The probability object’s ${s}.`)
  }
  const base = newProb(id)
  let color = PROB_COLOR_DEFAULT
  if (raw.color !== undefined) {
    if (isColor(raw.color)) color = raw.color.trim()
    else say('colour was not a colour; the default was used')
  }
  const view: ProbView = raw.view === 'table' || raw.view === 'venn' || raw.view === 'tree' ? raw.view : 'table'
  if (raw.view !== undefined && view !== raw.view) say('view was unreadable; the table is shown')

  const labels = (v: unknown, fallback: readonly string[], what: string): string[] => {
    if (!Array.isArray(v) || v.length < MIN_DIM) {
      if (v !== undefined) say(`${what} were unreadable; the defaults were used`)
      return fallback.slice()
    }
    if (v.length > MAX_DIM) say(`${what} beyond the first ${MAX_DIM} were dropped`)
    return v.slice(0, MAX_DIM).map((x, i) => (isStr(x) ? x.slice(0, MAX_LABEL) : `${what === 'row labels' ? 'Row' : 'Column'} ${i + 1}`))
  }

  // ---- the table
  const rt = isObj(raw.table) ? raw.table : null
  if (raw.table !== undefined && !rt) say('table was unreadable; the example was used')
  const table: ProbTable = cloneTable(base.table)
  if (rt) {
    table.rows = labels(rt.rows, base.table.rows, 'row labels')
    table.cols = labels(rt.cols, base.table.cols, 'column labels')
    const rc = Array.isArray(rt.counts) ? rt.counts : null
    if (!rc) say('counts were unreadable; they are 0')
    let bad = false
    table.counts = table.rows.map((_, i) =>
      table.cols.map((_, j) => {
        const row = rc?.[i]
        const v = Array.isArray(row) ? row[j] : undefined
        if (isCount(v)) return v
        if (rc) bad = true
        return 0
      }),
    )
    if (bad) say('counts included something that was not a whole number; it is 0')
    const idx = (v: unknown, n: number, what: string): number => {
      if (v === undefined) return 0
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n) return v
      say(`${what} was unreadable; the first was used`)
      return 0
    }
    table.a = idx(rt.a, table.rows.length, 'event A row')
    table.b = idx(rt.b, table.cols.length, 'event B column')
    table.given = rt.given === 'A' ? 'A' : 'B'
    if (rt.given !== undefined && rt.given !== 'A' && rt.given !== 'B') say('conditional was unreadable; P(A|B) was used')
    const rel = rt.rel
    table.rel = rel === 'joint' || rel === 'row' || rel === 'col' ? rel : 'count'
    if (rel !== undefined && table.rel !== rel) say('relative-frequency view was unreadable; counts are shown')
  }

  // ---- the Venn diagram
  const rv = isObj(raw.venn) ? raw.venn : null
  if (raw.venn !== undefined && !rv) say('Venn diagram was unreadable; the example was used')
  const venn: ProbVenn = { ...base.venn, names: base.venn.names.slice(), regions: base.venn.regions.slice() }
  if (rv) {
    const sets = rv.sets === 3 ? 3 : 2
    if (rv.sets !== 2 && rv.sets !== 3) say('number of sets was unreadable; two were used')
    venn.sets = sets
    const n = sets === 2 ? 4 : 8
    const regs = Array.isArray(rv.regions) ? rv.regions : null
    if (!regs) say('regions were unreadable; they are 0')
    venn.regions = Array.from({ length: n }, (_, i) => {
      const v = regs?.[i]
      return isStr(v) ? v.slice(0, MAX_TEXT) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '0'
    })
    if (rv.names === undefined) venn.names = ['', '', '']
    else if (Array.isArray(rv.names)) venn.names = [0, 1, 2].map((i) => (isStr(rv.names && (rv.names as unknown[])[i]) ? ((rv.names as unknown[])[i] as string).slice(0, MAX_LABEL) : ''))
    else {
      say('set names were unreadable')
      venn.names = ['', '', '']
    }
    venn.fromTable = rv.fromTable === true
    venn.expr = isStr(rv.expr) ? rv.expr.slice(0, MAX_EXPR) : ''
    if (rv.expr !== undefined && !isStr(rv.expr)) say('event was unreadable')
  }

  // ---- the tree
  const rr = isObj(raw.tree) ? raw.tree : null
  if (raw.tree !== undefined && !rr) say('tree was unreadable; the example was used')
  const tree: ProbTree = cloneTree(base.tree)
  if (rr) {
    tree.mode = rr.mode === 'manual' ? 'manual' : 'bag'
    if (rr.mode !== undefined && rr.mode !== 'bag' && rr.mode !== 'manual') say('tree kind was unreadable; a bag was used')
    if (Array.isArray(rr.bag)) {
      const bag = rr.bag
        .slice(0, MAX_COLORS)
        .filter(isObj)
        .map((c, i) => ({ name: isStr(c.name) ? c.name.slice(0, MAX_LABEL) : `Colour ${i + 1}`, count: typeof c.count === 'number' && Number.isInteger(c.count) && c.count >= 0 && c.count <= MAX_BAG ? c.count : 0 }))
      if (bag.length > 0) tree.bag = bag
      else say('bag was unreadable; the example was used')
    } else if (rr.bag !== undefined) say('bag was unreadable; the example was used')
    tree.draws = typeof rr.draws === 'number' && Number.isInteger(rr.draws) && rr.draws >= 1 && rr.draws <= MAX_DRAWS ? rr.draws : 2
    if (rr.draws !== undefined && tree.draws !== rr.draws) say('number of draws was unreadable; 2 were used')
    tree.replace = rr.replace === true
    if (rr.stages === undefined) tree.stages = []
    else if (Array.isArray(rr.stages)) {
      tree.stages = rr.stages
        .slice(0, MAX_TREE_STAGES)
        .filter(isObj)
        .map((s, i) => {
          const outcomes = Array.isArray(s.outcomes) ? s.outcomes.slice(0, MAX_TREE_OUTCOMES).map((o, k) => (isStr(o) ? o.slice(0, MAX_LABEL) : `Outcome ${k + 1}`)) : ['Yes', 'No']
          const probs = Array.isArray(s.probs)
            ? s.probs.slice(0, 64).map((row) => (Array.isArray(row) ? outcomes.map((_, k) => (isStr(row[k]) ? (row[k] as string).slice(0, MAX_TEXT) : '')) : outcomes.map(() => '')))
            : [outcomes.map(() => '')]
          return { name: isStr(s.name) ? s.name.slice(0, MAX_LABEL) : `Stage ${i + 1}`, outcomes, probs: probs.length > 0 ? probs : [outcomes.map(() => '')], same: s.same !== false }
        })
    } else {
      say('typed stages were unreadable; they were dropped')
      tree.stages = []
    }
    if (rr.pick === undefined) tree.pick = []
    else if (Array.isArray(rr.pick)) {
      tree.pick = rr.pick.filter((k): k is string => isStr(k) && PATH_KEY.test(k))
      if (tree.pick.length !== rr.pick.length) say('picked outcomes included something unreadable')
    } else {
      say('picked outcomes were unreadable')
      tree.pick = []
    }
    if (isStr(rr.event)) tree.event = rr.event.slice(0, 60)
    else delete tree.event
  }

  const out: BoardProb = { id, type: 'prob', view, table, venn, tree, color }
  if (raw.hidden === true) out.hidden = true
  else if (raw.hidden !== undefined) say('hidden switch was unreadable; it is shown')
  return { stat: out }
}
