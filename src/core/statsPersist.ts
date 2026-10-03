// ============================================================================
// src/core/statsPersist.ts — what a document stores for its statistics objects.
//
// Build ▾ → Normal distribution and Build ▾ → Simulation (NC Math 3 / AP
// Precalculus statistics). Same rule as every other board object: what is
// stored is what the teacher SET — μ, σ, the shading mode and its bounds, a
// simulation's population, n, the number of samples, the treatment groups and
// its SEED — and never a result. Every probability, z-score, simulated
// statistic, margin of error and p-value is recomputed from those, and a seeded
// simulation recomputes to the same numbers every time it is opened.
//
// Stored as `board.stats` (a list), written only when the board has one, so a
// document without statistics serialises byte-for-byte as it always did.
// ============================================================================

import type { NormalMode, Tail } from './stats'
import { NORMAL_MODES, cleanSeed } from './stats'

export const STAT_COLOR_DEFAULT = '#c678dd'
export const SIM_COLOR_DEFAULT = '#2dd4bf'
export const DATA_PLOT_COLOR_DEFAULT = '#4f9cf9'

/** Data sets one data plot compares (parallel box plots). */
export const MAX_SETS = 6
/** A data set's name, at most. */
export const MAX_SET_NAME = 40

/** How many statistics objects a board keeps. */
export const MAX_STATS = 8
/** Values in one pasted list (population or treatment group). */
export const MAX_LIST = 2000
export const MIN_REPS = 100
export const MAX_REPS = 10000
export const MAX_N = 1000
const LIMIT = 1e9

export interface BoardNormal {
  id: string
  type: 'normal'
  mu: number
  sigma: number
  mode: NormalMode
  /** The bound for below / above, the lower bound for between / outside. */
  a: number
  /** The upper bound for between / outside. */
  b: number
  /** Percentile mode: the percent below (0 < pct < 100). */
  pct: number
  /** The empirical-rule overlay (μ ± σ, 2σ, 3σ). Written only when on. */
  rule?: true
  /** The z-axis row under the raw values. On unless this says false. */
  zRow?: false
  color: string
  hidden?: true
}

export type SimMode = 'sample' | 'compare'
export type SimPopulation = 'normal' | 'proportion' | 'list'
export type SimStatistic = 'mean' | 'proportion'
export type SimPlot = 'dots' | 'hist'

export interface BoardSim {
  id: string
  type: 'sim'
  mode: SimMode
  pop: SimPopulation
  mu: number
  sigma: number
  p: number
  /** A pasted population (sampled with replacement). */
  list: number[]
  stat: SimStatistic
  n: number
  reps: number
  seed: number
  plot: SimPlot
  /** The theoretical sampling distribution's curve. On unless this says false. */
  theory?: false
  /** The sample statistic an interval is centred on. Absent: sample 1's. */
  observed?: number
  /** Compare treatments: the two groups' measurements. */
  groupA: number[]
  groupB: number[]
  tail: Tail
  color: string
  hidden?: true
}

/**
 * Build ▾ → One-variable data (NC Math 1 S-ID.1–3): one or more pasted lists
 * on a shared number line — a dot plot or a histogram, and/or a (modified) box
 * plot. What is stored is the lists as pasted, the values the teacher clicked
 * out (`off`, indices into `values`), the display and the bin width when one
 * was typed. Every summary, quartile, fence and sentence is recomputed.
 */
export interface DataPlotSet {
  name: string
  values: number[]
  /** Indices into `values` the teacher left out (clicked). Ascending, unique. */
  off?: number[]
}

export type DataDist = 'dots' | 'hist' | 'none'

export interface BoardDataPlot {
  id: string
  type: 'data'
  sets: DataPlotSet[]
  /** The distribution's picture: a dot plot, a histogram, or neither. */
  dist: DataDist
  /** The box plot (modified: outliers as separate points). */
  box: boolean
  /** The histogram's bin width; absent = the default for the data. */
  binWidth?: number
  /** Leave every 1.5·IQR outlier out (the outlier explorer). */
  dropOutliers?: true
  color: string
  hidden?: true
}

export type BoardStat = BoardNormal | BoardSim | BoardDataPlot

export interface StoredNormal {
  id: string
  type: 'normal'
  mu: number
  sigma: number
  mode: NormalMode
  a: number
  b: number
  pct: number
  rule?: true
  zRow?: false
  color?: string
  hidden?: true
}

export interface StoredSim {
  id: string
  type: 'sim'
  mode: SimMode
  pop: SimPopulation
  mu: number
  sigma: number
  p: number
  list?: number[]
  stat: SimStatistic
  n: number
  reps: number
  seed: number
  plot: SimPlot
  theory?: false
  observed?: number
  groupA?: number[]
  groupB?: number[]
  tail?: Tail
  color?: string
  hidden?: true
}

export interface StoredDataPlot {
  id: string
  type: 'data'
  sets: { name: string; values: number[]; off?: number[] }[]
  dist: DataDist
  box: boolean
  binWidth?: number
  dropOutliers?: true
  color?: string
  hidden?: true
}

export type StoredStat = StoredNormal | StoredSim | StoredDataPlot

/** Off indices that point into `values`: ascending, unique, in range. */
export function cleanOff(off: readonly unknown[] | undefined, length: number): number[] {
  if (!off) return []
  const set = new Set<number>()
  for (const v of off) if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < length) set.add(v)
  return [...set].sort((a, b) => a - b)
}

export function statToStored(s: BoardStat): StoredStat {
  if (s.type === 'data') {
    const out: StoredDataPlot = {
      id: s.id,
      type: 'data',
      sets: s.sets.slice(0, MAX_SETS).map((set) => {
        const values = set.values.slice(0, MAX_LIST)
        const o: StoredDataPlot['sets'][number] = { name: set.name, values }
        const off = cleanOff(set.off, values.length)
        if (off.length > 0) o.off = off
        return o
      }),
      dist: s.dist,
      box: s.box,
    }
    if (s.binWidth !== undefined && s.binWidth > 0 && Number.isFinite(s.binWidth)) out.binWidth = s.binWidth
    if (s.dropOutliers) out.dropOutliers = true
    if (s.color !== DATA_PLOT_COLOR_DEFAULT) out.color = s.color
    if (s.hidden) out.hidden = true
    return out
  }
  if (s.type === 'normal') {
    const out: StoredNormal = { id: s.id, type: 'normal', mu: s.mu, sigma: s.sigma, mode: s.mode, a: s.a, b: s.b, pct: s.pct }
    if (s.rule) out.rule = true
    if (s.zRow === false) out.zRow = false
    if (s.color !== STAT_COLOR_DEFAULT) out.color = s.color
    if (s.hidden) out.hidden = true
    return out
  }
  const out: StoredSim = {
    id: s.id,
    type: 'sim',
    mode: s.mode,
    pop: s.pop,
    mu: s.mu,
    sigma: s.sigma,
    p: s.p,
    stat: s.stat,
    n: s.n,
    reps: s.reps,
    seed: s.seed,
    plot: s.plot,
  }
  if (s.list.length > 0) out.list = s.list.slice(0, MAX_LIST)
  if (s.theory === false) out.theory = false
  if (s.observed !== undefined && Number.isFinite(s.observed)) out.observed = s.observed
  if (s.groupA.length > 0) out.groupA = s.groupA.slice(0, MAX_LIST)
  if (s.groupB.length > 0) out.groupB = s.groupB.slice(0, MAX_LIST)
  if (s.tail !== 'two') out.tail = s.tail
  if (s.color !== SIM_COLOR_DEFAULT) out.color = s.color
  if (s.hidden) out.hidden = true
  return out
}

// ---------------------------------------------------------------------------
// Reading an untrusted blob
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'

function isColor(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const t = v.trim()
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)) return true
  return /^(?:rgba?|hsla?)\(\s*[-+0-9.%\s,/deg]+\)$/i.test(t)
}

function numList(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null
  const out: number[] = []
  for (const x of v.slice(0, MAX_LIST)) if (isNum(x) && Math.abs(x) <= LIMIT) out.push(x)
  return out
}

/**
 * One statistics object out of an untrusted blob. A value that is present but
 * damaged falls back to its default and, when `problems` is given, is reported
 * there; a record with no id or an unknown type is an error.
 */
export function storedToStat(raw: unknown, problems?: string[]): { stat: BoardStat } | { error: string } {
  if (!isObj(raw)) return { error: 'it was not readable' }
  const { id, type } = raw
  if (!isStr(id) || !id) return { error: 'it had no id' }
  if (type !== 'normal' && type !== 'sim' && type !== 'data') return { error: 'its kind was unknown' }
  const what = type === 'normal' ? 'normal distribution' : type === 'sim' ? 'simulation' : 'data plot'
  const say = (s: string): void => {
    problems?.push(`The ${what}’s ${s}.`)
  }
  const num = (key: string, def: number, ok: (v: number) => boolean): number => {
    const v = raw[key]
    if (v === undefined) return def
    if (!isNum(v) || Math.abs(v) > LIMIT || !ok(v)) {
      say(`${key} was unreadable; the default was used`)
      return def
    }
    return v
  }
  const colorDefault = type === 'normal' ? STAT_COLOR_DEFAULT : type === 'sim' ? SIM_COLOR_DEFAULT : DATA_PLOT_COLOR_DEFAULT
  let color = colorDefault
  if (raw.color !== undefined) {
    if (isColor(raw.color)) color = raw.color.trim()
    else say('colour was not a colour; the default was used')
  }
  const hidden = raw.hidden === true
  if (raw.hidden !== undefined && raw.hidden !== true) say('hidden switch was unreadable; it is shown')

  if (type === 'data') {
    const sets: DataPlotSet[] = []
    if (!Array.isArray(raw.sets)) {
      if (raw.sets !== undefined) say('data sets were unreadable; it is empty')
    } else {
      if (raw.sets.length > MAX_SETS) say(`data sets beyond the first ${MAX_SETS} were dropped`)
      raw.sets.slice(0, MAX_SETS).forEach((rs, i) => {
        if (!isObj(rs)) {
          say(`data set ${i + 1} was unreadable; it was dropped`)
          return
        }
        const values = numList(rs.values)
        if (values === null) say(`data set ${i + 1}’s values were unreadable; it is empty`)
        const vs = values ?? []
        const name = isStr(rs.name) ? rs.name.slice(0, MAX_SET_NAME) : `Set ${String.fromCharCode(65 + i)}`
        if (rs.name !== undefined && !isStr(rs.name)) say(`data set ${i + 1}’s name was unreadable`)
        const set: DataPlotSet = { name, values: vs }
        if (rs.off !== undefined) {
          if (!Array.isArray(rs.off)) say(`data set ${i + 1}’s left-out values were unreadable; none are left out`)
          else {
            const off = cleanOff(rs.off, vs.length)
            if (off.length !== rs.off.length) say(`some of data set ${i + 1}’s left-out values were unreadable`)
            if (off.length > 0) set.off = off
          }
        }
        sets.push(set)
      })
    }
    const distRaw = raw.dist
    const dist: DataDist = distRaw === 'dots' || distRaw === 'hist' || distRaw === 'none' ? distRaw : 'dots'
    if (distRaw !== undefined && dist !== distRaw) say('plot was unreadable; a dot plot was used')
    let box = true
    if (raw.box !== undefined) {
      if (typeof raw.box === 'boolean') box = raw.box
      else say('box-plot switch was unreadable; it is on')
    }
    const out: BoardDataPlot = { id, type: 'data', sets, dist, box, color }
    if (raw.binWidth !== undefined) {
      if (isNum(raw.binWidth) && raw.binWidth > 0 && raw.binWidth <= LIMIT) out.binWidth = raw.binWidth
      else say('bin width was unreadable; the default was used')
    }
    if (raw.dropOutliers === true) out.dropOutliers = true
    else if (raw.dropOutliers !== undefined) say('outlier switch was unreadable; outliers are kept')
    if (hidden) out.hidden = true
    return { stat: out }
  }

  if (type === 'normal') {
    const mode = (NORMAL_MODES as readonly string[]).includes(raw.mode as string) ? (raw.mode as NormalMode) : null
    if (!mode) say('shading mode was unreadable; “between” was used')
    const out: BoardNormal = {
      id,
      type: 'normal',
      mu: num('mu', 0, () => true),
      sigma: num('sigma', 1, (v) => v > 0),
      mode: mode ?? 'between',
      a: num('a', -1, () => true),
      b: num('b', 1, () => true),
      pct: num('pct', 90, (v) => v > 0 && v < 100),
      color,
    }
    if (raw.rule === true) out.rule = true
    else if (raw.rule !== undefined) say('empirical-rule switch was unreadable; it is off')
    if (raw.zRow === false) out.zRow = false
    else if (raw.zRow !== undefined) say('z-row switch was unreadable; it is on')
    if (hidden) out.hidden = true
    return { stat: out }
  }

  const pick = <T extends string>(key: string, opts: readonly T[], def: T): T => {
    const v = raw[key]
    if (v === undefined) return def
    if ((opts as readonly unknown[]).includes(v)) return v as T
    say(`${key} was unreadable; “${def}” was used`)
    return def
  }
  const list = (key: string): number[] => {
    if (raw[key] === undefined) return []
    const v = numList(raw[key])
    if (v === null) {
      say(`${key} was unreadable; it is empty`)
      return []
    }
    return v
  }
  const seedRaw = raw.seed
  const seed = isNum(seedRaw) && seedRaw >= 0 ? cleanSeed(seedRaw) : 1
  if (!isNum(seedRaw) || seedRaw < 0) say('seed was unreadable; seed 1 was used')
  const out: BoardSim = {
    id,
    type: 'sim',
    mode: pick('mode', ['sample', 'compare'] as const, 'sample'),
    pop: pick('pop', ['normal', 'proportion', 'list'] as const, 'normal'),
    mu: num('mu', 100, () => true),
    sigma: num('sigma', 15, (v) => v > 0),
    p: num('p', 0.5, (v) => v >= 0 && v <= 1),
    list: list('list'),
    stat: pick('stat', ['mean', 'proportion'] as const, 'mean'),
    n: Math.round(num('n', 30, (v) => v >= 1 && v <= MAX_N)),
    reps: Math.round(num('reps', 1000, (v) => v >= MIN_REPS && v <= MAX_REPS)),
    seed,
    plot: pick('plot', ['dots', 'hist'] as const, 'dots'),
    groupA: list('groupA'),
    groupB: list('groupB'),
    tail: pick('tail', ['two', 'upper', 'lower'] as const, 'two'),
    color,
  }
  if (raw.theory === false) out.theory = false
  else if (raw.theory !== undefined) say('theory switch was unreadable; it is on')
  if (raw.observed !== undefined) {
    if (isNum(raw.observed) && Math.abs(raw.observed) <= LIMIT) out.observed = raw.observed
    else say('observed statistic was unreadable; sample 1’s is used')
  }
  if (hidden) out.hidden = true
  return { stat: out }
}
