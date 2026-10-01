// ============================================================================
// src/ui/CommandPalette.tsx — ⌘K: find any tool by name and run it.
//
// Keyboard first: type to filter, ↑/↓ to move, Enter to run, Esc to close.
// A combobox (the field) that owns a listbox (the rows); the active row is the
// field's aria-activedescendant, so focus never leaves the field and a screen
// reader hears each row as it is reached.
//
// Everything it lists and does comes from the registry (src/ui/commands.ts).
// A command that acts on a curve runs on the selected curve; with none
// selected the palette asks "which curve?" and lists the curves that take it,
// by name and equation.
// ============================================================================

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Latex } from './Latex'
import {
  COMMAND_BY_ID,
  availability,
  commandLabel,
  filterTargets,
  formatShortcut,
  matchesKey,
  paletteRows,
  targetNoun,
} from './commands'
import type { Command, CommandContext, PaletteRow, TargetFacts } from './commands'

interface Props {
  ctx: CommandContext
  /** Recently run command ids, most recent first. */
  recent: readonly string[]
  /** Open straight into "which curve?" for this command (the help sheet's "Do it"). */
  pickFor?: string
  mac: boolean
  onRun(cmd: Command, targetId?: string): void
  onClose(): void
}

function findTarget(ctx: CommandContext, id: string): TargetFacts | undefined {
  return (
    ctx.curves.find((c) => c.id === id) ??
    ctx.fields.find((c) => c.id === id) ??
    ctx.sequences.find((c) => c.id === id) ??
    ctx.solves.find((c) => c.id === id)
  )
}

type Mode = { kind: 'commands' } | { kind: 'pick'; cmd: Command; candidates: TargetFacts[] }

function initialMode(ctx: CommandContext, pickFor: string | undefined): Mode {
  const cmd = pickFor ? COMMAND_BY_ID.get(pickFor) : undefined
  if (!cmd) return { kind: 'commands' }
  const av = availability(cmd, ctx)
  return av.state === 'pick' ? { kind: 'pick', cmd, candidates: av.candidates } : { kind: 'commands' }
}

/** The first row that can run, or 0. */
function firstLive(rows: readonly { avail?: PaletteRow['avail'] }[]): number {
  const i = rows.findIndex((r) => !r.avail || r.avail.state !== 'disabled')
  return i < 0 ? 0 : i
}

export function CommandPalette({ ctx, recent, pickFor, mac, onRun, onClose }: Props) {
  const [mode, setMode] = useState<Mode>(() => initialMode(ctx, pickFor))
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const uid = useId()
  const listId = `${uid}-list`
  const optId = (i: number): string => `${uid}-opt-${i}`

  // ---- focus: into the field now; back where it was on a plain close
  const restoreRef = useRef<Element | null>(null)
  const restoreOnClose = useRef(true)
  useLayoutEffect(() => {
    restoreRef.current = document.activeElement
    inputRef.current?.focus()
    return () => {
      const prev = restoreRef.current
      if (restoreOnClose.current && prev instanceof HTMLElement && prev.isConnected) prev.focus()
    }
  }, [])

  // ---- keys outside the dialog (focus escaped to the body) must not reach
  // the board's single-key shortcuts behind it.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const trap = (e: KeyboardEvent): void => {
      if (rootRef.current?.contains(e.target as Node)) return
      e.stopPropagation()
      if (e.key === 'Escape') closeRef.current()
      else inputRef.current?.focus()
    }
    window.addEventListener('keydown', trap, true)
    return () => window.removeEventListener('keydown', trap, true)
  }, [])

  const rows = useMemo(
    () => (mode.kind === 'commands' ? paletteRows(ctx, query, recent) : []),
    [mode, ctx, query, recent],
  )
  const picks = useMemo(() => (mode.kind === 'pick' ? filterTargets(mode.candidates, query) : []), [mode, query])
  const count = mode.kind === 'commands' ? rows.length : picks.length

  // a new list starts on its first row that can run
  useEffect(() => {
    setActive(mode.kind === 'commands' ? firstLive(rows) : 0)
  }, [rows, picks, mode.kind])

  // keep the active row in view
  useEffect(() => {
    const el = document.getElementById(optId(active))
    el?.scrollIntoView?.({ block: 'nearest' })
    // optId is derived from uid, which is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, mode.kind])

  const selectedCurve = ctx.selectedId ? ctx.curves.find((c) => c.id === ctx.selectedId) : undefined

  const run = (i: number): void => {
    if (mode.kind === 'pick') {
      const t = picks[i]
      if (!t) return
      restoreOnClose.current = false
      onRun(mode.cmd, t.id)
      return
    }
    const row = rows[i]
    if (!row || row.avail.state === 'disabled') return
    if (row.avail.state === 'pick') {
      setMode({ kind: 'pick', cmd: row.cmd, candidates: row.avail.candidates })
      setQuery('')
      return
    }
    restoreOnClose.current = false
    onRun(row.cmd, row.avail.targetId)
  }

  const back = (): void => {
    setMode({ kind: 'commands' })
    setQuery('')
    inputRef.current?.focus()
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    // Nothing typed in here reaches the board's shortcuts.
    e.stopPropagation()
    if (matchesKey(e, 'Mod+K')) {
      e.preventDefault()
      onClose()
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (count > 0) setActive((a) => (a + 1) % count)
        return
      case 'ArrowUp':
        e.preventDefault()
        if (count > 0) setActive((a) => (a - 1 + count) % count)
        return
      case 'Home':
        if (e.target === inputRef.current && query) return
        e.preventDefault()
        setActive(0)
        return
      case 'End':
        if (e.target === inputRef.current && query) return
        e.preventDefault()
        setActive(Math.max(0, count - 1))
        return
      case 'Enter':
        if (e.target instanceof HTMLButtonElement) return
        e.preventDefault()
        run(active)
        return
      case 'Escape':
        e.preventDefault()
        if (mode.kind === 'pick' && !pickFor) back()
        else onClose()
        return
      case 'Backspace':
        if (mode.kind === 'pick' && query === '' && !pickFor) {
          e.preventDefault()
          back()
        }
        return
      case 'Tab': {
        // the focus trap: the field and the Back button are all there is
        const focusables = Array.from(
          rootRef.current?.querySelectorAll<HTMLElement>('input, button:not([disabled])') ?? [],
        )
        if (focusables.length === 0) return
        e.preventDefault()
        const at = focusables.indexOf(document.activeElement as HTMLElement)
        const next = (at + (e.shiftKey ? -1 : 1) + focusables.length) % focusables.length
        focusables[next].focus()
        return
      }
      default:
    }
  }

  // ---- the rows
  let lastHeading: string | null = null
  const commandList: JSX.Element[] = []
  let group: JSX.Element[] = []
  let groupHead: string | null = null
  const flush = (): void => {
    if (groupHead === null) return
    const hid = `${uid}-h-${commandList.length}`
    // the curve's name keeps its case (f, not F) under the upper-case heading
    const title =
      groupHead === 'Calculus' && selectedCurve ? (
        <>
          Calculus · for <span className="cmdk-heading-name">{selectedCurve.name}</span>
        </>
      ) : (
        groupHead
      )
    commandList.push(
      <div key={hid} role="group" aria-labelledby={hid} className="cmdk-group">
        <div id={hid} className="cmdk-heading" role="presentation">
          {title}
        </div>
        {group}
      </div>,
    )
    group = []
  }
  if (mode.kind === 'commands') {
    rows.forEach((row, i) => {
      if (row.heading !== lastHeading) {
        flush()
        groupHead = row.heading
        lastHeading = row.heading
      }
      const disabled = row.avail.state === 'disabled'
      const tid = row.avail.state === 'ready' ? row.avail.targetId : undefined
      const target = tid ? findTarget(ctx, tid) : undefined
      const sub =
        row.avail.state === 'disabled'
          ? row.avail.reason
          : row.avail.state === 'pick'
            ? `${row.cmd.description} — choose a ${targetNoun(row.cmd.target ?? 'curve')}`
            : row.cmd.description
      group.push(
        <div
          key={row.cmd.id}
          id={optId(i)}
          role="option"
          aria-selected={i === active}
          aria-disabled={disabled || undefined}
          data-command={row.cmd.id}
          className={`cmdk-row${i === active ? ' cmdk-row-active' : ''}${disabled ? ' cmdk-row-off' : ''}`}
          onPointerMove={() => i !== active && setActive(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run(i)}
        >
          <span className="cmdk-main">
            <span className="cmdk-title">
              {row.label}
              {target && <span className="cmdk-on">on {target.name}</span>}
              {row.avail.state === 'pick' && (
                <span className="cmdk-on cmdk-ask" aria-hidden="true">
                  which {targetNoun(row.cmd.target ?? 'curve')}? →
                </span>
              )}
            </span>
            <span className="cmdk-desc">{sub}</span>
          </span>
          {row.cmd.shortcuts && row.cmd.shortcuts.length > 0 && (
            <kbd className="cmdk-kbd" aria-label={`Shortcut ${formatShortcut(row.cmd.shortcuts[0], mac)}`}>
              {formatShortcut(row.cmd.shortcuts[0], mac)}
            </kbd>
          )}
        </div>,
      )
    })
    flush()
  }

  const pickTitle = mode.kind === 'pick' ? commandLabel(mode.cmd, ctx) : ''
  const noun = mode.kind === 'pick' ? targetNoun(mode.cmd.target ?? 'curve') : ''
  const status =
    mode.kind === 'pick'
      ? `Which ${noun}? ${picks.length} ${picks.length === 1 ? noun : `${noun}s`}`
      : `${rows.length} ${rows.length === 1 ? 'command' : 'commands'}`

  return (
    <div
      className="cmdk-scrim"
      data-testid="command-palette"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={rootRef}
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label={mode.kind === 'pick' ? `${pickTitle}: which ${noun}?` : 'Command palette'}
        onKeyDown={onKeyDown}
      >
        <div className="cmdk-head">
          {mode.kind === 'pick' && !pickFor && (
            <button type="button" className="cmdk-back" onClick={back} aria-label="Back to all commands" title="Back (Esc)">
              ‹
            </button>
          )}
          {mode.kind === 'pick' && (
            <span className="cmdk-crumb" data-testid="cmdk-crumb">
              {pickTitle}
            </span>
          )}
          <input
            ref={inputRef}
            className="cmdk-input"
            data-testid="cmdk-input"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={count > 0 ? optId(active) : undefined}
            aria-label={mode.kind === 'pick' ? `Which ${noun}? Type its name or equation` : 'Search commands'}
            placeholder={
              mode.kind === 'pick'
                ? `Which ${noun}? Type its name or equation`
                : 'Type a command: derivative, area, Taylor, share, SAT…'
            }
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="cmdk-kbd cmdk-esc" aria-hidden="true">
            esc
          </kbd>
        </div>

        <div
          ref={listRef}
          className="cmdk-list"
          id={listId}
          role="listbox"
          aria-label={mode.kind === 'pick' ? `${noun}s` : 'Commands'}
        >
          {mode.kind === 'commands' ? (
            rows.length === 0 ? (
              <div className="cmdk-empty" role="presentation">
                Nothing matches “{query}”. Try a word from the lesson: tangent, area, inverse, share…
              </div>
            ) : (
              commandList
            )
          ) : picks.length === 0 ? (
            <div className="cmdk-empty" role="presentation">
              No {noun} matches “{query}”.
            </div>
          ) : (
            <div role="group" aria-label={`Which ${noun}?`} className="cmdk-group">
              <div className="cmdk-heading" role="presentation">
                Which {noun}?
              </div>
              {picks.map((t, i) => {
                return (
                  <div
                    key={t.id}
                    id={optId(i)}
                    role="option"
                    aria-selected={i === active}
                    aria-label={`${t.name}: ${t.text}`}
                    data-target={t.id}
                    className={`cmdk-row cmdk-pick${i === active ? ' cmdk-row-active' : ''}`}
                    onPointerMove={() => i !== active && setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => run(i)}
                  >
                    <span className="cmdk-name" style={t.color ? ({ '--chip': t.color } as CSSProperties) : undefined}>
                      {t.name}
                    </span>
                    <span className="cmdk-eq">{t.tex ? <Latex tex={t.tex} /> : t.text}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="cmdk-foot" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>Enter</kbd> {mode.kind === 'pick' ? 'choose' : 'run'}
          </span>
          <span>
            <kbd>Esc</kbd> {mode.kind === 'pick' && !pickFor ? 'back' : 'close'}
          </span>
          <span className="cmdk-foot-help">type “help” for everything Grapher can do</span>
        </div>
        <div className="sr-only" role="status" aria-live="polite">
          {status}
        </div>
      </div>
    </div>
  )
}
