// ============================================================================
// tests/keyboardA11y.test.ts — keyboard-only use: the board's own keys
// (src/ui/boardKeys.ts), menus (src/ui/useMenuKeys.ts), dialogs
// (src/ui/useDialogFocus.ts), sliders (src/ui/sliderKeys.ts), the zoom keys,
// reduced motion (src/ui/motionPref.ts) — and how they are wired.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  HANDLE_BIG_STEP,
  HANDLE_STEP,
  PAN_BIG_STEP_PX,
  PAN_STEP_PX,
  boardKeyAction,
  handleWords,
} from '../src/ui/boardKeys'
import type { BoardKeyState } from '../src/ui/boardKeys'
import { menuStep } from '../src/ui/useMenuKeys'
import { trapTarget } from '../src/ui/useDialogFocus'
import { BIG_STEPS, bigStep } from '../src/ui/sliderKeys'
import { REDUCED_STEP_S, playClock } from '../src/ui/motionPref'
import { COMMAND_BY_ID, HELP_SECTIONS, RESERVED_KEYS, canonicalKey, formatShortcut, keyParts, matchesKey } from '../src/ui/commands'

const src = (rel: string): string => readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8')

const NONE: BoardKeyState = { hasSelection: false, handleCount: 0, handleIndex: null }
const SEL: BoardKeyState = { hasSelection: true, handleCount: 3, handleIndex: null }
const on = (i: number): BoardKeyState => ({ ...SEL, handleIndex: i })

describe('the board’s own keys (boardKeyAction)', () => {
  it('nothing selected: arrows pan, Shift pans further, Tab leaves the board', () => {
    expect(boardKeyAction({ key: 'ArrowRight' }, NONE)).toEqual({ type: 'pan', dx: PAN_STEP_PX, dy: 0 })
    expect(boardKeyAction({ key: 'ArrowUp', shiftKey: true }, NONE)).toEqual({ type: 'pan', dx: 0, dy: PAN_BIG_STEP_PX })
    expect(boardKeyAction({ key: 'ArrowLeft' }, NONE)).toEqual({ type: 'pan', dx: -PAN_STEP_PX, dy: 0 })
    expect(boardKeyAction({ key: 'Tab' }, NONE)).toBeNull()
  })

  it('a curve selected: arrows are the App’s nudge (not taken), Tab steps onto the first handle', () => {
    expect(boardKeyAction({ key: 'ArrowRight' }, SEL)).toBeNull()
    expect(boardKeyAction({ key: 'Tab' }, SEL)).toEqual({ type: 'focus-handle', index: 0 })
    expect(boardKeyAction({ key: 'Tab', shiftKey: true }, SEL)).toBeNull()
  })

  it('Tab cycles the handles and then leaves; Shift+Tab walks back to the curve', () => {
    expect(boardKeyAction({ key: 'Tab' }, on(0))).toEqual({ type: 'focus-handle', index: 1 })
    expect(boardKeyAction({ key: 'Tab' }, on(1))).toEqual({ type: 'focus-handle', index: 2 })
    expect(boardKeyAction({ key: 'Tab' }, on(2))).toEqual({ type: 'clear-handle', leave: true })
    expect(boardKeyAction({ key: 'Tab', shiftKey: true }, on(2))).toEqual({ type: 'focus-handle', index: 1 })
    expect(boardKeyAction({ key: 'Tab', shiftKey: true }, on(0))).toEqual({ type: 'clear-handle', leave: false })
  })

  it('a handle focused: arrows move it 0.1 (Shift: 1) in math units, up is +y', () => {
    expect(boardKeyAction({ key: 'ArrowRight' }, on(1))).toEqual({ type: 'move-handle', dx: HANDLE_STEP, dy: 0 })
    expect(boardKeyAction({ key: 'ArrowDown' }, on(1))).toEqual({ type: 'move-handle', dx: 0, dy: -HANDLE_STEP })
    expect(boardKeyAction({ key: 'ArrowUp', shiftKey: true }, on(1))).toEqual({ type: 'move-handle', dx: 0, dy: HANDLE_BIG_STEP })
    // Alt is the drag's "skip snapping" — it still moves; the snap is decided on release
    expect(boardKeyAction({ key: 'ArrowLeft', altKey: true }, on(1))).toEqual({ type: 'move-handle', dx: -HANDLE_STEP, dy: 0 })
  })

  it('Enter / Space type an exact value; Escape goes back to the curve, then lets go of it', () => {
    expect(boardKeyAction({ key: 'Enter' }, on(0))).toEqual({ type: 'edit-handle' })
    expect(boardKeyAction({ key: ' ' }, on(0))).toEqual({ type: 'edit-handle' })
    expect(boardKeyAction({ key: 'Escape' }, on(0))).toEqual({ type: 'clear-handle', leave: false })
    expect(boardKeyAction({ key: 'Escape' }, SEL)).toEqual({ type: 'deselect' })
    expect(boardKeyAction({ key: 'Escape' }, NONE)).toBeNull()
    expect(boardKeyAction({ key: 'Enter' }, SEL)).toBeNull()
  })

  it('never takes a ⌘ / Ctrl chord, or a letter (those are the App’s shortcuts)', () => {
    for (const k of ['ArrowLeft', 'Tab', 'Enter', 'z', 'k']) {
      expect(boardKeyAction({ key: k, metaKey: true }, on(0))).toBeNull()
      expect(boardKeyAction({ key: k, ctrlKey: true }, NONE)).toBeNull()
    }
    for (const k of ['a', 'r', 'f', '+', '-', '?', '/']) expect(boardKeyAction({ key: k }, on(0))).toBeNull()
  })

  it('a handle index past the end counts as none (the curve changed under it)', () => {
    expect(boardKeyAction({ key: 'ArrowRight' }, { hasSelection: true, handleCount: 1, handleIndex: 4 })).toBeNull()
  })

  it('handles are named in words', () => {
    expect(handleWords('vertex', 'vertex')).toBe('vertex handle')
    expect(handleWords(undefined, 'domain-start')).toBe('domain start handle')
    expect(handleWords('Radius handle', 'r')).toBe('radius handle')
  })
})

describe('menus and dialogs', () => {
  it('menuStep: ↓ ↑ wrap, Home / End jump, other keys are not the menu’s', () => {
    expect(menuStep('ArrowDown', -1, 4)).toBe(0)
    expect(menuStep('ArrowDown', 3, 4)).toBe(0)
    expect(menuStep('ArrowUp', 0, 4)).toBe(3)
    expect(menuStep('ArrowUp', -1, 4)).toBe(3)
    expect(menuStep('Home', 2, 4)).toBe(0)
    expect(menuStep('End', 0, 4)).toBe(3)
    expect(menuStep('Enter', 0, 4)).toBeNull()
    expect(menuStep('ArrowDown', 0, 0)).toBeNull()
  })

  it('trapTarget: Tab wraps from the last to the first, Shift+Tab from the first to the last', () => {
    const a = { id: 'a' } as unknown as HTMLElement
    const b = { id: 'b' } as unknown as HTMLElement
    const c = { id: 'c' } as unknown as HTMLElement
    const list = [a, b, c]
    expect(trapTarget(list, c, false)).toBe(a)
    expect(trapTarget(list, a, true)).toBe(c)
    expect(trapTarget(list, b, false)).toBeNull() // the browser's own order
    expect(trapTarget(list, null, false)).toBe(a) // focus outside: back in
    expect(trapTarget([], a, false)).toBeNull()
  })

  it('every modal dialog traps focus and gives it back', () => {
    for (const f of ['ui/ShareDialog.tsx', 'ui/WorksheetEditor.tsx', 'ui/ItemBankDialogs.tsx', 'ui/DescribeDialog.tsx']) {
      expect(src(f), f).toContain('useDialogFocus(')
    }
  })

  it('the document menu, the settings panel and the toolbar’s ⋯ take the keyboard', () => {
    expect(src('ui/DocMenu.tsx')).toContain('useMenuKeys(open, menuRef, caretRef, closeMenu)')
    expect(src('ui/ExportMenu.tsx')).toContain("useMenuKeys(open, menuRef, caretRef, closeMenu, { arrows: false })")
    expect(src('ui/Toolbar.tsx')).toContain('useMenuKeys(open, menuRef, btnRef, close)')
  })
})

describe('sliders: Shift + arrow takes ten steps', () => {
  it('lands on the step grid, inside the range', () => {
    expect(bigStep(1, -10, 10, 0.1, 1)).toBe(2)
    expect(bigStep(1, -10, 10, 0.1, -1)).toBe(0)
    expect(bigStep(9.5, -10, 10, 0.1, 1)).toBe(10)
    expect(bigStep(-9.5, -10, 10, 0.1, -1)).toBe(-10)
    expect(bigStep(3, 0, 100, 1, 1)).toBe(3 + BIG_STEPS)
    expect(bigStep(0.03, 0, 1, 0.01, 1)).toBe(0.13)
  })
})

describe('reduced motion', () => {
  it('Play glides frame by frame normally (each step capped at 0.1 s)', () => {
    const clock = playClock(0, false)
    expect(clock(16)).toBeCloseTo(0.016, 6)
    expect(clock(1016)).toBe(0.1)
  })

  it('…and moves in half-second steps under reduced motion', () => {
    const clock = playClock(0, true)
    let moved = 0
    let steps = 0
    for (let t = 16; t <= 2000; t += 16) {
      const dt = clock(t)
      if (dt !== null) {
        steps++
        moved += dt
      }
    }
    expect(steps).toBeGreaterThanOrEqual(3)
    expect(steps).toBeLessThanOrEqual(4)
    expect(moved).toBeGreaterThan(1.5)
    expect(REDUCED_STEP_S).toBe(0.5)
  })

  it('the stylesheet cuts CSS animation, and the Play loops and smooth scrolls ask', () => {
    expect(readFileSync(fileURLToPath(new URL('../src/ui/styles.css', import.meta.url)), 'utf8')).toContain('@media (prefers-reduced-motion: reduce)')
    for (const f of ['app/useUnitCircle.tsx', 'app/useSelectionMarks.ts', 'app/useRelatedRates.tsx']) expect(src(f), f).toContain('playClock(')
    for (const f of ['ui/HelpSheet.tsx', 'ui/ExampleGallery.tsx', 'app/useSidebarEditors.ts']) {
      expect(src(f), f).not.toMatch(/behavior: 'smooth'/)
    }
    expect(src('ui/CanvasStage.tsx')).toMatch(/reduced && scene\.revealPulses/)
  })
})

describe('the keys, as the registry states them', () => {
  it('+ and = zoom in, − zooms out, and the App handles exactly those', () => {
    expect(COMMAND_BY_ID.get('view-zoom-in')?.shortcuts).toEqual(['+', '='])
    expect(COMMAND_BY_ID.get('view-zoom-out')?.shortcuts).toEqual(['-'])
    const kb = src('app/useKeyboard.ts')
    expect(kb).toContain("e.key === '+'")
    expect(kb).toContain("e.key === '='")
    expect(kb).toContain("e.key === '-'")
  })

  it('a key spec can name the plus key', () => {
    expect(keyParts('+')).toEqual(['+'])
    expect(keyParts('Shift++')).toEqual(['Shift', '+'])
    expect(keyParts('Mod+K')).toEqual(['Mod', 'K'])
    expect(canonicalKey('+')).toBe('+')
    expect(formatShortcut('+', true)).toBe('+')
    expect(matchesKey({ key: '+', shiftKey: true }, '+')).toBe(true)
    expect(matchesKey({ key: '+', metaKey: true }, '+')).toBe(false)
  })

  it('Tab and Enter on the board are listed with the gesture keys', () => {
    const keys = RESERVED_KEYS.map((r) => r.keys)
    expect(keys).toContain('Tab')
    expect(keys).toContain('Enter')
  })

  it('the help sheet has an Accessibility section with both new commands', () => {
    const s = HELP_SECTIONS.find((h) => h.id === 'a11y')
    expect(s?.title).toBe('Accessibility')
    const ids = (s?.entries ?? []).flatMap((e) => ('id' in e ? [e.id] : []))
    expect(ids).toEqual(['view-describe', 'view-colour-safe'])
  })
})

describe('the board is reachable and named', () => {
  it('the canvas is focusable, an image with a name and a description', () => {
    const stage = src('ui/CanvasStage.tsx')
    expect(stage).toMatch(/id="board-canvas"[\s\S]{0,400}tabIndex=\{0\}[\s\S]{0,200}role="img"[\s\S]{0,200}aria-label=\{a11yLabel \?\? 'Graph'\}[\s\S]{0,80}aria-describedby=\{describedBy\}/)
    expect(stage).toContain('onKeyDown={onBoardKeyDown}')
    const nl = src('ui/NumberLineStage.tsx')
    expect(nl).toMatch(/id="board-canvas"[\s\S]{0,400}role="img"/)
  })

  it('“Skip to board” is the first thing in the app and goes to the canvas', () => {
    const app = src('App.tsx')
    const at = app.indexOf('className="skip-link"')
    expect(at).toBeGreaterThan(0)
    expect(at).toBeLessThan(app.indexOf('<Sidebar'))
    expect(app).toContain("document.getElementById('board-canvas')?.focus()")
  })

  it('a closed sidebar is inert, so Tab does not walk through what nobody can see', () => {
    expect(src('ui/Sidebar.tsx')).toContain('asideRef.current.inert = !open')
  })
})
