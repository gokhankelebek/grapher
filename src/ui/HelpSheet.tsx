// ============================================================================
// src/ui/HelpSheet.tsx — "?": what Grapher can do, on one page.
//
// Organised the way a teacher plans: by course and unit (AP Calculus 1–10,
// AP Precalculus 1–3, NC Math 3 topics), then drawing & editing, exports &
// worksheets, and what to use in class. Each line says what a tool does and
// how to reach it — a menu path and a key — with "Do it", which runs the same
// command the palette runs.
//
// Built from the registry (src/ui/commands.ts): titles, descriptions, menu
// paths and keys are read from the commands, so the sheet cannot drift from
// the app. Only the drawing gestures are prose. Large type for the projector
// (A / A+), and a print stylesheet so it can be handed out.
// ============================================================================

import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  COMMAND_BY_ID,
  HELP_COURSES,
  HELP_SECTIONS,
  RESERVED_KEYS,
  availability,
  commandLabel,
  formatShortcut,
  matchesKey,
  normalize,
  scoreCommand,
  shortcutRows,
} from './commands'
import type { Command, CommandContext, HelpEntry } from './commands'
import { examplesForSection } from '../examples'
import { prefersReducedMotion } from './motionPref'

interface Props {
  ctx: CommandContext
  mac: boolean
  /** Run a registry command (closes the sheet first). */
  onDo(id: string): void
  /** ⌘K inside the sheet: over to the palette. */
  onPalette(): void
  /** "See an example" on a unit: open that example (as a copy). Absent = no links. */
  onExample?(id: string): void
  onClose(): void
}

/** One line, resolved: a command's or a static one's. */
interface Line {
  key: string
  title: string
  text: string
  how: string
  keys: string[]
  cmd?: Command
}

function resolve(entry: HelpEntry, ctx: CommandContext, i: number, mac: boolean): Line | null {
  if ('id' in entry) {
    const cmd = COMMAND_BY_ID.get(entry.id)
    if (!cmd) return null
    return {
      key: `${cmd.id}-${i}`,
      title: commandLabel(cmd, null),
      text: entry.note ?? cmd.description,
      how: cmd.path,
      keys: (cmd.shortcuts ?? []).map((k) => formatShortcut(k, mac)),
      cmd,
    }
  }
  return {
    key: `s-${entry.title}-${i}`,
    title: entry.title,
    text: entry.text,
    how: entry.how,
    keys: entry.keys ? [entry.keys] : [],
  }
}

function lineMatches(line: Line, q: string): boolean {
  if (!q) return true
  const hay = normalize(`${line.title} ${line.text} ${line.how}`)
  if (hay.includes(q)) return true
  // a phrase or keyword match, not the palette's loose letters-in-order fallback
  return line.cmd ? scoreCommand(line.cmd, line.title, q) >= 200 : false
}

const RESERVED_GLYPH: Record<string, string> = {
  Space: 'Space',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  Alt: 'Alt',
}

export function HelpSheet({ ctx, mac, onDo, onPalette, onExample, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [large, setLarge] = useState(ctx.presentMode)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const uid = useId()
  const q = normalize(query)

  // focus in; back where it was on close
  useLayoutEffect(() => {
    const prev = document.activeElement
    searchRef.current?.focus()
    return () => {
      if (prev instanceof HTMLElement && prev.isConnected) prev.focus()
    }
  }, [])

  // keys that land outside the sheet never reach the board behind it
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

  const sections = useMemo(
    () =>
      HELP_SECTIONS.map((s) => ({
        ...s,
        lines: s.entries
          .map((e, i) => resolve(e, ctx, i, mac))
          .filter((l): l is Line => l !== null && lineMatches(l, q)),
      })).filter((s) => s.lines.length > 0),
    [ctx, mac, q],
  )

  const keyRows = useMemo(() => {
    const rows = shortcutRows()
      .map((r) => ({ title: commandLabel(COMMAND_BY_ID.get(r.id) as Command, null), keys: r.keys.map((k) => formatShortcut(k, mac)), id: r.id }))
      .filter((r) => !q || normalize(`${r.title} ${r.keys.join(' ')}`).includes(q))
    const reserved = RESERVED_KEYS.filter((r) => !q || normalize(r.what).includes(q)).map((r) => ({
      title: r.what,
      keys: [RESERVED_GLYPH[r.keys] ?? r.keys],
      id: `k-${r.keys}`,
    }))
    return [...rows, ...reserved]
  }, [mac, q])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    e.stopPropagation()
    if (matchesKey(e, 'Mod+K')) {
      e.preventDefault()
      onPalette()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      if (query && e.target === searchRef.current) setQuery('')
      else onClose()
      return
    }
    if (e.key === 'Tab') {
      const f = Array.from(
        rootRef.current?.querySelectorAll<HTMLElement>('input, button:not([disabled])') ?? [],
      )
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
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-course="${course}"]`)
    el?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }

  const doButton = (line: Line): JSX.Element | null => {
    if (!line.cmd || line.cmd.hideInPalette) return null
    const av = availability(line.cmd, ctx)
    const why = av.state === 'hidden' ? 'Not on this board right now' : av.state === 'disabled' ? av.reason : null
    return (
      <button
        type="button"
        className="hs-do"
        disabled={why !== null}
        title={why ?? (av.state === 'pick' ? `${line.title} — you’ll pick which one` : line.title)}
        aria-label={`Do it: ${line.title}`}
        data-command={line.cmd.id}
        onClick={() => onDo(line.cmd!.id)}
      >
        Do it
      </button>
    )
  }

  const courses = HELP_COURSES.filter((c) => sections.some((s) => s.course === c))
  const titleId = `${uid}-title`

  return (
    <div
      className="hs-scrim"
      data-testid="help-sheet"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={rootRef}
        className={`hs${large ? ' hs-large' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <header className="hs-head">
          <h2 id={titleId} className="hs-title">
            What Grapher can do
          </h2>
          <input
            ref={searchRef}
            className="hs-search"
            type="search"
            data-testid="help-search"
            placeholder="Search: tangent, volume, share, SAT…"
            aria-label="Search the help sheet"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="hs-tools">
            <button
              type="button"
              className="hs-tool"
              aria-pressed={large}
              onClick={() => setLarge((v) => !v)}
              title={large ? 'Normal type' : 'Large type, for the projector'}
            >
              {large ? 'A−' : 'A+'}
            </button>
            <button type="button" className="hs-tool" onClick={() => window.print()} title="Print this sheet as a handout">
              Print
            </button>
            <button type="button" className="hs-tool hs-x" onClick={onClose} aria-label="Close help" title="Close (Esc)">
              ×
            </button>
          </div>
        </header>
        <p className="hs-lede">
          Press <kbd>{formatShortcut('Mod+K', mac)}</kbd> (or <kbd>/</kbd>) anywhere and type what you want: “derivative”,
          “area between”, “share”. Calculus tools act on the selected curve.
        </p>
        {courses.length > 1 && (
          <nav className="hs-nav" aria-label="Jump to a course">
            {courses.map((c) => (
              <button key={c} type="button" className="hs-chip" onClick={() => jump(c)}>
                {c}
              </button>
            ))}
            <button type="button" className="hs-chip" onClick={() => jump('Keyboard shortcuts')}>
              Keyboard shortcuts
            </button>
          </nav>
        )}

        <div className="hs-body">
          {sections.length === 0 && keyRows.length === 0 && (
            <p className="hs-empty">
              Nothing here matches “{query}”. The palette (<kbd>{formatShortcut('Mod+K', mac)}</kbd>) searches synonyms
              too.
            </p>
          )}
          {HELP_COURSES.map((course) => {
            const mine = sections.filter((s) => s.course === course)
            if (mine.length === 0) return null
            return (
              <section key={course} className="hs-course" data-course={course} aria-label={course}>
                <h3 className="hs-course-title">{course}</h3>
                {mine.map((s) => (
                  <div key={s.id} className="hs-unit">
                    <h4 className="hs-unit-title">{s.title}</h4>
                    {onExample && examplesForSection(s.id).length > 0 && (
                      <div className="hs-examples">
                        <span className="hs-examples-label">See an example:</span>
                        {examplesForSection(s.id).map((ex) => (
                          <button
                            key={ex.id}
                            type="button"
                            className="hs-example"
                            data-example={ex.id}
                            title={`Open a copy of “${ex.title}” — ${ex.note}`}
                            onClick={() => onExample(ex.id)}
                          >
                            {ex.title}
                          </button>
                        ))}
                      </div>
                    )}
                    <ul className="hs-lines">
                      {s.lines.map((line) => (
                        <li key={line.key} className="hs-line">
                          <div className="hs-what">
                            <strong className="hs-name">{line.title}</strong>
                            <span className="hs-text"> — {line.text}</span>
                          </div>
                          <div className="hs-how">
                            <span className="hs-path">{line.how}</span>
                            {line.keys.map((k, i) => (
                              <Fragment key={k}>
                                {i > 0 && <span className="hs-or"> or </span>}
                                <kbd className="hs-kbd">{k}</kbd>
                              </Fragment>
                            ))}
                            {doButton(line)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            )
          })}
          {keyRows.length > 0 && (
            <section className="hs-course hs-keys" data-course="Keyboard shortcuts" aria-label="Keyboard shortcuts">
              <h3 className="hs-course-title">Keyboard shortcuts</h3>
              <table className="hs-key-table">
                <tbody>
                  {keyRows.map((r) => (
                    <tr key={r.id}>
                      <td className="hs-key-cell">
                        {r.keys.map((k, i) => (
                          <Fragment key={k}>
                            {i > 0 && <span className="hs-or"> or </span>}
                            <kbd className="hs-kbd">{k}</kbd>
                          </Fragment>
                        ))}
                      </td>
                      <td>{r.title}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hs-note">Single-letter keys work when no text box has the cursor.</p>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
