// ============================================================================
// src/examples/sampleWorksheet.ts — "Start from an example worksheet".
//
// A teacher who chose "Make a worksheet" on the first run met an empty
// builder: a blank page and one untitled graph to add. This is the other way
// in: three figures from the examples gallery for the teacher's courses, on
// a letter page with a title and captions — a worksheet they own, to print,
// change or delete.
//
// A worksheet only points at documents, so each figure is a NEW document:
// the gallery's recipe (builder.ts, the same one "Open an example" uses),
// named as an opened example is ("Example: U6 — Riemann sums…", numbered when
// taken) and framed for the screen it will be drawn on. Nothing the teacher
// already has is read or changed. Pure: the editor writes what this returns.
// ============================================================================

import { docFromBoard, newId, newWorksheet } from '../core/persist'
import type { StoredDoc, Worksheet } from '../core/persist'
import { ExampleBoard } from './builder'
import { COURSE_NAMES, COURSE_ORDER, EXAMPLE_DEFS } from './catalog'
import type { ExampleCourse, ExampleDef } from './catalog'
import { exampleCopyName } from './index'

/**
 * Per course, the examples that make good printed figures, best first: one
 * picture each, nothing that needs the live board (sliders, animation) to
 * make sense. The tests draw every one and check nothing is left off.
 */
export const SAMPLE_SHEET_PICKS: Record<ExampleCourse, readonly string[]> = {
  calc: ['calc-u6-riemann', 'calc-u8-area-between', 'calc-u10-taylor-sin'],
  precalc: ['pc-u1-rational', 'pc-u2-exp-log', 'pc-u3-sinusoid'],
  math1: ['m1-quadratic-features', 'm1-system-of-lines', 'm1-linear-vs-exponential'],
  math2: ['m2-quadratic-forms', 'm2-line-parabola', 'm2-function-transformations'],
  math3: ['m3-circle', 'm3-piecewise-step', 'm3-transformations'],
}

/** How many figures the sample sheet holds. */
export const SAMPLE_SHEET_SIZE = 3

/**
 * The examples for these courses, taken in turn from each (one course: its
 * three; two: two and one; more: the first of each), in course order. No
 * course chosen: AP Calculus, the gallery's first.
 */
export function sampleSheetDefs(courses: readonly ExampleCourse[] | null | undefined): ExampleDef[] {
  const list = COURSE_ORDER.filter((c) => courses?.includes(c))
  const order = list.length > 0 ? list : (['calc'] as const)
  const queues = order.map((c) => SAMPLE_SHEET_PICKS[c].slice())
  const out: ExampleDef[] = []
  while (out.length < SAMPLE_SHEET_SIZE && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const id = q.shift()
      const def = id ? EXAMPLE_DEFS.find((d) => d.id === id) : undefined
      if (def && out.length < SAMPLE_SHEET_SIZE) out.push(def)
    }
  }
  return out
}

export interface SampleSheet {
  /** New documents, one per figure — write these first. */
  docs: StoredDoc[]
  /** The worksheet, its items pointing at `docs` in order. */
  sheet: Worksheet
}

/**
 * Build the sample worksheet. `existingNames` are the teacher's document
 * names (a figure's name is numbered when an example of that name is already
 * there); `screen` is the board's size, the screen the worksheet frames every
 * document on.
 */
export function buildSampleSheet(opts: {
  courses: readonly ExampleCourse[] | null | undefined
  existingNames: readonly string[]
  screen: { widthPx: number; heightPx: number }
  now?: number
}): SampleSheet {
  const now = opts.now ?? Date.now()
  const defs = sampleSheetDefs(opts.courses)
  const names = opts.existingNames.slice()
  const docs: StoredDoc[] = []
  for (const def of defs) {
    const b = new ExampleBoard(def.kind ?? 'cartesian')
    def.build(b)
    const name = exampleCopyName(def, names)
    names.push(name)
    docs.push(docFromBoard({ id: newId(), name, createdAt: now, modifiedAt: now }, b.toInput(def.note, opts.screen), now))
  }
  const courses = [...new Set(defs.map((d) => d.course))]
  const sheet: Worksheet = {
    ...newWorksheet('Example worksheet', now),
    title: `Example worksheet — ${courses.map((c) => COURSE_NAMES[c]).join(' · ')}`,
    items: defs.map((def, i) => ({ docId: docs[i].id, caption: def.title })),
  }
  return { docs, sheet }
}
