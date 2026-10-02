// ============================================================================
// src/examples/index.ts — the examples gallery's data: build, search, name.
//
// EXAMPLE_DEFS (catalog.ts) are recipes; this module turns one into its
// stored document (builder.ts) on demand and caches the JSON, so opening the
// gallery costs nothing until a card is drawn. Everything here is pure.
// ============================================================================

import { serializeDoc } from '../core/persist'
import { HELP_SECTIONS, normalize } from '../ui/commands'
import { ExampleBoard } from './builder'
import type { ExampleWindow } from './builder'
import { COURSE_NAMES, COURSE_ORDER, EXAMPLE_DEFS } from './catalog'
import type { ExampleCourse, ExampleDef } from './catalog'

export { COURSE_NAMES, COURSE_ORDER, EXAMPLE_DEFS, ExampleBoard }
export type { ExampleCourse, ExampleDef, ExampleWindow }
export { EXAMPLE_SCREEN } from './builder'

/** One example, built: its stored JSON and the window it opens on. */
export interface BuiltExample {
  def: ExampleDef
  json: string
  window: ExampleWindow
}

const BUILT = new Map<string, BuiltExample>()

export function exampleById(id: string): ExampleDef | undefined {
  return EXAMPLE_DEFS.find((e) => e.id === id)
}

/** Build one example (cached). Throws when its recipe is broken — the tests see to it that none is. */
export function buildExample(def: ExampleDef): BuiltExample {
  const hit = BUILT.get(def.id)
  if (hit) return hit
  const b = new ExampleBoard(def.kind ?? 'cartesian')
  def.build(b)
  const doc = b.toDoc(`example_${def.id}`, exampleDocName(def), def.note)
  const built: BuiltExample = { def, json: serializeDoc(doc), window: b.window() }
  BUILT.set(def.id, built)
  return built
}

/** "Example: U5 — graph of f′". */
export function exampleDocName(def: ExampleDef): string {
  return `Example: ${def.unit} — ${def.short}`
}

/**
 * The name the opened copy takes: the example's own, or — when a document of
 * that name is already in the list (the same example opened twice) — the
 * next "(2)", "(3)".
 */
export function exampleCopyName(def: ExampleDef, existing: readonly string[]): string {
  const base = exampleDocName(def)
  const used = new Set(existing.map((n) => n.trim().toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  let n = 2
  while (used.has(`${base} (${n})`.toLowerCase())) n++
  return `${base} (${n})`
}

/** The examples a help-sheet unit section links to, in gallery order. */
export function examplesForSection(sectionId: string): ExampleDef[] {
  return EXAMPLE_DEFS.filter((e) => e.help.includes(sectionId))
}

/** Everything a search looks through, normalised once. */
function haystack(def: ExampleDef): string {
  return normalize(
    [
      def.title,
      def.short,
      def.unit,
      COURSE_NAMES[def.course],
      ...def.help.map((h) => HELP_SECTIONS.find((x) => x.id === h)?.title ?? ''),
      def.note,
      ...(def.keywords ?? []),
    ].join(' '),
  )
}

const HAY = new Map<string, string>()

/**
 * Does an example match the search? Every word must appear somewhere in it
 * (title, unit, course, note, keywords) — "u5 mvt", "polar area", "inverse".
 */
export function exampleMatches(def: ExampleDef, query: string): boolean {
  const q = normalize(query)
  if (q === '') return true
  let hay = HAY.get(def.id)
  if (hay === undefined) {
    hay = haystack(def)
    HAY.set(def.id, hay)
  }
  return q.split(/\s+/).every((w) => w === '' || hay!.includes(w))
}

/** One unit of the gallery: a help-sheet section and its examples. */
export interface GalleryUnit {
  /** The HELP_SECTIONS id (each example's first `help`). */
  id: string
  /** "Unit 5 · Analytical applications of differentiation". */
  title: string
  examples: ExampleDef[]
}

/**
 * The gallery's groups: course, then unit — each example under its HOME
 * section (its first `help`), units in the order the catalog first reaches
 * them — filtered by the search.
 */
export function galleryGroups(query = ''): { course: ExampleCourse; units: GalleryUnit[] }[] {
  const out: { course: ExampleCourse; units: GalleryUnit[] }[] = []
  for (const course of COURSE_ORDER) {
    const units: GalleryUnit[] = []
    for (const def of EXAMPLE_DEFS) {
      if (def.course !== course || !exampleMatches(def, query)) continue
      const home = def.help[0]
      let u = units.find((x) => x.id === home)
      if (!u) {
        u = { id: home, title: HELP_SECTIONS.find((h) => h.id === home)?.title ?? def.unit, examples: [] }
        units.push(u)
      }
      u.examples.push(def)
    }
    if (units.length > 0) out.push({ course, units })
  }
  return out
}
