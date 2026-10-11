// ============================================================================
// src/ui/courses.ts — "What do you teach?": the courses a teacher chose, and
// everything that is tailored by them. Pure, so the tests can pin it down.
//
// The choice is a PREFERENCE (Prefs.courses in src/ui/storage.ts), never part
// of a document. It reorders and tucks away — it never removes: every tool is
// still in Build ▾ (under "More…"), every example is one chip away in the
// gallery, and ⌘K always searches everything.
//
// Absent (never asked: every teacher who used Grapher before this existed)
// and empty (skipped) both mean "no focus": everything shown, as before, only
// grouped.
// ============================================================================

import { parseShareHash } from '../core/share'

export type CourseId = 'calc' | 'precalc' | 'math1' | 'math2' | 'math3' | 'other'

/** A course that has its own examples and help sheet (every one but "Other"). */
export type TaughtCourse = Exclude<CourseId, 'other'>

export interface CourseInfo {
  id: CourseId
  /** As the chooser's chip says it. */
  name: string
  /** As a compact list says it ("AP Calc · AP Precalc"). */
  short: string
}

/** The chooser's chips, in the order they are offered (and stored). */
export const COURSES: readonly CourseInfo[] = [
  { id: 'calc', name: 'AP Calculus AB/BC', short: 'AP Calculus' },
  { id: 'precalc', name: 'AP Precalculus', short: 'AP Precalculus' },
  { id: 'math1', name: 'NC Math 1', short: 'NC Math 1' },
  { id: 'math2', name: 'NC Math 2', short: 'NC Math 2' },
  { id: 'math3', name: 'NC Math 3', short: 'NC Math 3' },
  { id: 'other', name: 'Other / just exploring', short: 'Exploring' },
]

const ORDER: readonly CourseId[] = COURSES.map((c) => c.id)

export const isCourseId = (v: unknown): v is CourseId => typeof v === 'string' && (ORDER as readonly string[]).includes(v)

/**
 * A stored choice, cleaned: known ids only, no repeats, in the chooser's
 * order. Anything that is not a list reads as "never asked" (undefined).
 */
export function cleanCourses(v: unknown): CourseId[] | undefined {
  if (!Array.isArray(v)) return undefined
  const seen = new Set<CourseId>()
  for (const x of v) if (isCourseId(x)) seen.add(x)
  return ORDER.filter((id) => seen.has(id))
}

/** The courses that focus anything: the chosen ones minus "Other", in the chooser's order. */
export function taughtCourses(courses: readonly CourseId[] | undefined): TaughtCourse[] {
  return ORDER.filter((c): c is TaughtCourse => c !== 'other' && (courses ?? []).includes(c))
}

/** "AP Calculus · AP Precalculus", or '' for none. */
export function coursesLabel(courses: readonly CourseId[] | undefined): string {
  return COURSES.filter((c) => courses?.includes(c.id)).map((c) => c.short).join(' · ')
}

// ---------------------------------------------------------------- Build ▾

export type BuildSectionId = 'functions' | 'calculus' | 'geometry' | 'stats' | 'numberline'

export const BUILD_SECTIONS: readonly { id: BuildSectionId; title: string }[] = [
  { id: 'functions', title: 'Functions' },
  { id: 'calculus', title: 'Calculus' },
  { id: 'geometry', title: 'Geometry' },
  { id: 'stats', title: 'Statistics & probability' },
  { id: 'numberline', title: 'Number line' },
]

/** Which Build ▾ sections a course uses, most used first. */
export const COURSE_SECTIONS: Record<TaughtCourse, readonly BuildSectionId[]> = {
  calc: ['calculus', 'functions'],
  precalc: ['functions', 'numberline'],
  math1: ['functions', 'stats', 'geometry', 'numberline'],
  math2: ['functions', 'geometry', 'stats'],
  math3: ['functions', 'geometry', 'numberline', 'stats'],
}

/**
 * The Build ▾ menu's sections for these courses: `shown` in the menu, `more`
 * behind "More…". The chosen courses' sections come first (course by course,
 * in the chooser's order); the rest are tucked away — unless nothing focuses
 * the menu (never asked, skipped, or "Other / just exploring" chosen), when
 * every section is shown.
 */
export function buildSectionOrder(courses: readonly CourseId[] | undefined): {
  shown: BuildSectionId[]
  more: BuildSectionId[]
} {
  const all = BUILD_SECTIONS.map((s) => s.id)
  const taught = taughtCourses(courses)
  if (taught.length === 0) return { shown: all, more: [] }
  const first: BuildSectionId[] = []
  for (const c of taught) for (const s of COURSE_SECTIONS[c]) if (!first.includes(s)) first.push(s)
  const rest = all.filter((s) => !first.includes(s))
  // An explorer wants everything in view, their own courses first.
  if (courses?.includes('other')) return { shown: [...first, ...rest], more: [] }
  return { shown: first, more: rest }
}

// --------------------------------------------------------------- help sheet

/** The help sheet's course heading for each course (HELP_COURSES in commands.ts). */
export const HELP_COURSE_OF: Record<TaughtCourse, string> = {
  calc: 'AP Calculus AB / BC',
  precalc: 'AP Precalculus',
  math1: 'NC Math 1',
  math2: 'NC Math 2',
  math3: 'NC Math 3',
}

/** Where the help sheet opens: the first chosen course's heading, or null (the top). */
export function helpOpensOn(courses: readonly CourseId[] | undefined): string | null {
  const first = taughtCourses(courses)[0]
  return first ? HELP_COURSE_OF[first] : null
}

// ----------------------------------------------------------------- gallery

/**
 * The gallery's course filter when it opens: the chosen courses — or null
 * (every course) when nothing focuses it. The ids are the catalog's own
 * (src/examples/catalog.ts ExampleCourse).
 */
export function galleryFilterFor(courses: readonly CourseId[] | undefined): TaughtCourse[] | null {
  const taught = taughtCourses(courses)
  return taught.length > 0 ? taught : null
}

/**
 * Which landing-page door opened the gallery: "Open an AP example"
 * (`?app=1&gallery=1`) or "Open an NC Math example" (`…&course=nc`).
 */
export type GalleryDoor = 'ap' | 'nc'

/** What the landing page's "Open an AP example" door shows a teacher who never chose. */
export const AP_GALLERY_COURSES: readonly TaughtCourse[] = ['calc', 'precalc']

/** What its "Open an NC Math example" door shows a teacher who never chose. */
export const NC_GALLERY_COURSES: readonly TaughtCourse[] = ['math1', 'math2', 'math3']

/**
 * The gallery's opening filter. A landing-page door (`door`) names its
 * courses on the button ("Open an AP example", "Open an NC Math example"),
 * so it wins for that opening: AP Calculus + AP Precalculus, or NC Math 1, 2
 * and 3. Opened any other way, the teacher's own courses when they chose
 * some, otherwise every course (null). Only the opening filter — nothing
 * here is stored. Pure.
 */
export function galleryDefaultCourses(
  courses: readonly CourseId[] | undefined,
  door: GalleryDoor | null,
): TaughtCourse[] | null {
  if (door) return [...(door === 'nc' ? NC_GALLERY_COURSES : AP_GALLERY_COURSES)]
  return galleryFilterFor(courses)
}

// ---------------------------------------------------------------- first run

export interface FirstRunFacts {
  /** Documents in this browser's index when the app opened. */
  savedDocs: number
  /** Prefs.courses as stored (undefined: never asked). */
  courses: readonly CourseId[] | undefined
  /** location.search and location.hash when the app opened. */
  search: string
  hash: string
}

/**
 * Does the app open on the course chooser? Only for a brand-new teacher: no
 * saved documents and never asked. Never for a share link (a student, a
 * view-only or reveal link, or a teacher opening a colleague's graph), and
 * never for `?gallery=1`, which opens the gallery instead.
 */
export function shouldShowFirstRun(f: FirstRunFacts): boolean {
  if (f.courses !== undefined) return false
  if (f.savedDocs > 0) return false
  if (parseShareHash(f.hash).kind === 'share') return false
  if (new URLSearchParams(f.search).get('gallery') === '1') return false
  return true
}

/**
 * The settings menu's one-time tip, "Tell Grapher what you teach": for a
 * teacher who was never asked (they had documents before this existed), until
 * they choose or dismiss it.
 */
export function coursesTipDue(courses: readonly CourseId[] | undefined, dismissed: boolean): boolean {
  return courses === undefined && !dismissed
}

// ----------------------------------------------------------- backup nudges

export const DAY_MS = 24 * 60 * 60 * 1000
/** How long between gentle backup reminders. */
export const BACKUP_REMIND_MS = 14 * DAY_MS
/** Reminders start once a teacher has more documents than this. */
export const BACKUP_REMIND_DOCS = 5

export interface BackupFacts {
  now: number
  /** How many documents are saved in this browser. */
  docs: number
  /** When the oldest of them was created (the start of "use"); 0 when unknown. */
  oldestCreatedAt: number
  /** Prefs.lastBackupAt: the last full backup saved. */
  lastBackupAt?: number
  /** Prefs.backupRemindAt: the last time the reminder was put aside. */
  backupRemindAt?: number
}

/**
 * Is a gentle backup reminder due (in the document menu)? Only with more than
 * five documents, and only two weeks after the latest of: the first document,
 * the last backup, the last "Not now". Nothing but those timestamps is kept.
 */
export function backupReminderDue(f: BackupFacts): boolean {
  if (f.docs <= BACKUP_REMIND_DOCS) return false
  const since = Math.max(f.oldestCreatedAt || 0, f.lastBackupAt ?? 0, f.backupRemindAt ?? 0)
  if (since <= 0) return false
  return f.now - since >= BACKUP_REMIND_MS
}
