// ============================================================================
// src/ui/ExampleGallery.tsx — Document menu → Examples…: ready-to-teach boards.
//
// A full-window sheet over the board, grouped by course and unit (the help
// sheet's units). Each card is a thumbnail of the example's figure — drawn by
// docScene, the worksheet's own pure path from a stored document to a figure
// — its title, its unit tag and its teacher note. Clicking a card opens the
// example as a NEW document copy (src/app/useExamples.ts); the teacher's own
// documents are never touched.
//
// Thumbnails are drawn one at a time off a queue, a frame apart, so opening
// the gallery never stalls on thirty figures; each is drawn once per session.
// ============================================================================

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { COURSE_NAMES, EXAMPLE_SCREEN, buildExample, galleryGroups } from '../examples'
import type { ExampleDef } from '../examples'
import type { DisplayList } from '../render/vectorCtx'
import { replayList } from '../render/vectorPage'
import { docFigure, docModelFromJSON, recordFigure } from './docScene'
import { PX_PER_CM } from './vectorExport'

interface Props {
  /** Scroll to (and highlight) the examples of this help-sheet unit. */
  focusSection?: string | null
  onOpen(id: string): void
  onClose(): void
}

/** CSS width a thumbnail is drawn at; the figure's text is set for this size. */
const THUMB_W = 280
/** A card's width and the gap between cards (styles.css .exg-grid). */
const CARD_W = 262
const CARD_GAP = 12

// ---- the thumbnail queue: one figure per frame, each recorded once.
const LISTS = new Map<string, DisplayList | null>()
const waiting: { id: string; done: (l: DisplayList | null) => void }[] = []
let pumping = false

function record(def: ExampleDef): DisplayList | null {
  try {
    const built = buildExample(def)
    const model = docModelFromJSON(built.json, { screen: EXAMPLE_SCREEN })
    if (!model) return null
    return recordFigure(
      docFigure(model, { style: 'screen', answers: false, widthCm: (THUMB_W * 1.7) / PX_PER_CM, caption: '' }),
    )
  } catch {
    return null
  }
}

function pump(defs: Map<string, ExampleDef>): void {
  if (pumping) return
  pumping = true
  const step = (): void => {
    const job = waiting.shift()
    if (!job) {
      pumping = false
      return
    }
    let list = LISTS.get(job.id)
    if (list === undefined) {
      const def = defs.get(job.id)
      list = def ? record(def) : null
      LISTS.set(job.id, list)
    }
    job.done(list)
    window.setTimeout(step, 0)
  }
  window.setTimeout(step, 0)
}

function Thumb({ def, defs }: { def: ExampleDef; defs: Map<string, ExampleDef> }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [list, setList] = useState<DisplayList | null | undefined>(() => LISTS.get(def.id))
  useEffect(() => {
    if (list !== undefined) return
    let live = true
    waiting.push({ id: def.id, done: (l) => live && setList(l) })
    pump(defs)
    return () => {
      live = false
    }
  }, [def.id, defs, list])
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !list) return
    const dpr = window.devicePixelRatio || 1
    const h = Math.round((THUMB_W * list.height) / list.width)
    canvas.width = Math.round(THUMB_W * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    replayList(ctx, list, (THUMB_W * dpr) / list.width)
  }, [list])
  if (list === null) return <div className="exg-thumb exg-thumb-missing">No preview</div>
  return <canvas ref={ref} className={`exg-thumb${list === undefined ? ' exg-thumb-wait' : ''}`} aria-hidden="true" />
}

export function ExampleGallery({ focusSection = null, onOpen, onClose }: Props) {
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const uid = useId()
  const groups = useMemo(() => galleryGroups(query), [query])
  const defs = useMemo(() => {
    const m = new Map<string, ExampleDef>()
    for (const g of galleryGroups()) for (const u of g.units) for (const d of u.examples) m.set(d.id, d)
    return m
  }, [])
  const count = groups.reduce((n, g) => n + g.units.reduce((k, u) => k + u.examples.length, 0), 0)

  // focus in; back where it was on close
  useLayoutEffect(() => {
    const prev = document.activeElement
    if (focusSection) {
      const el = rootRef.current?.querySelector<HTMLElement>(`[data-section="${focusSection}"]`)
      el?.scrollIntoView({ block: 'start' })
      el?.querySelector<HTMLElement>('.exg-card')?.focus()
    } else searchRef.current?.focus()
    return () => {
      if (prev instanceof HTMLElement && prev.isConnected) prev.focus()
    }
  }, [focusSection])

  // keys that land outside the gallery never reach the board behind it
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const trap = (e: KeyboardEvent): void => {
      if (rootRef.current?.contains(e.target as Node)) return
      e.stopPropagation()
      if (e.key === 'Escape') closeRef.current()
      else searchRef.current?.focus()
    }
    window.addEventListener('keydown', trap, true)
    return () => window.removeEventListener('keydown', trap, true)
  }, [])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      if (query && e.target === searchRef.current) setQuery('')
      else onClose()
      return
    }
    if (e.key === 'Enter' && e.target === searchRef.current && count > 0) {
      // Enter in the search box opens the first match.
      e.preventDefault()
      const first = groups[0]?.units[0]?.examples[0]
      if (first) onOpen(first.id)
      return
    }
    if (e.key === 'Tab') {
      const f = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('input, button:not([disabled])') ?? [])
      if (f.length === 0) return
      const at = f.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey && at <= 0) {
        e.preventDefault()
        f[f.length - 1].focus()
      } else if (!e.shiftKey && at === f.length - 1) {
        e.preventDefault()
        f[0].focus()
      }
    }
  }

  const jump = (course: string): void => {
    rootRef.current?.querySelector<HTMLElement>(`[data-course="${course}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  const titleId = `${uid}-title`
  return (
    <div
      className="exg-scrim"
      data-testid="example-gallery"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={rootRef} className="exg" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <header className="exg-head">
          <h2 id={titleId} className="exg-title">
            Examples
          </h2>
          <input
            ref={searchRef}
            className="exg-search"
            type="search"
            data-testid="example-search"
            placeholder="Search: MVT, polar area, logistic, U8…"
            aria-label="Search the examples"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className="exg-x" onClick={onClose} aria-label="Close examples" title="Close (Esc)">
            ×
          </button>
        </header>
        <p className="exg-lede">
          Ready-to-teach boards, one or two per unit. Opening one makes a <strong>copy</strong> in your documents — change
          it freely; the example stays as it is. Each opens with a teacher note at the top of the sidebar.
        </p>
        {groups.length > 1 && (
          <nav className="exg-nav" aria-label="Jump to a course">
            {groups.map((g) => (
              <button key={g.course} type="button" className="hs-chip" onClick={() => jump(g.course)}>
                {COURSE_NAMES[g.course]}
              </button>
            ))}
          </nav>
        )}
        <div className="exg-body">
          {count === 0 && <p className="exg-empty">No example matches “{query}”.</p>}
          {groups.map((g) => (
            <section key={g.course} className="exg-course" data-course={g.course} aria-label={COURSE_NAMES[g.course]}>
              <h3 className="exg-course-title">{COURSE_NAMES[g.course]}</h3>
              {g.units.map((u) => (
                <div
                  key={u.id}
                  className={`exg-unit${u.id === focusSection ? ' exg-unit-focus' : ''}`}
                  data-section={u.id}
                  style={{ width: `min(100%, ${u.examples.length * CARD_W + (u.examples.length - 1) * CARD_GAP}px)` }}
                >
                  <h4 className="exg-unit-title">{u.title}</h4>
                  <ul className="exg-grid">
                    {u.examples.map((d) => (
                      <li key={d.id}>
                        <button
                          type="button"
                          className="exg-card"
                          data-example={d.id}
                          title={`Open a copy of “${d.title}”`}
                          onClick={() => onOpen(d.id)}
                        >
                          <Thumb def={d} defs={defs} />
                          <span className="exg-card-top">
                            <span className="exg-tag">{d.unit}</span>
                            <span className="exg-card-title">{d.title}</span>
                          </span>
                          <span className="exg-note">{d.note}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
