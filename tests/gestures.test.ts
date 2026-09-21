import { describe, expect, it } from 'vitest'
import {
  NEIGHBOURHOOD_PX,
  PEN_GUARD_MS,
  TOUCH_INK_HOLD_MS,
  TOUCH_PAN_SLOP,
  classifyPointerDown,
  classifyWheel,
  looksLikeMouseWheel,
  wheelZoomFactor,
  hitRadii,
  penGuardActive,
  pointerKind,
  strokeLeftBand,
  tipPlacement,
  wheelPanDelta,
} from '../src/ui/gestures'
import type { PointerKind, PointerVerdict } from '../src/ui/gestures'

// ---------------------------------------------------------------------------
// The gesture policy of the sketch board, tested where it actually lives: as
// pure decisions, one per contact, made before any state is touched.
//
// Two of these used to be destructive. A palm landing mid-stroke was promoted
// to a pinch, which cancelled the stroke — no curve, no toast, nothing to
// undo. And a plain Mac two-finger scroll rescaled the whole board.
// ---------------------------------------------------------------------------

const down = (o: Partial<Parameters<typeof classifyPointerDown>[0]>): PointerVerdict =>
  classifyPointerDown({
    kind: 'mouse',
    button: 0,
    spaceHeld: false,
    activeKind: null,
    contacts: 0,
    penRecent: false,
    ...o,
  })

describe('pointerKind', () => {
  it('keeps pen and touch, and calls everything else a mouse', () => {
    expect(pointerKind('pen')).toBe('pen')
    expect(pointerKind('touch')).toBe('touch')
    expect(pointerKind('mouse')).toBe('mouse')
    expect(pointerKind(undefined)).toBe('mouse')
    expect(pointerKind('')).toBe('mouse')
  })
})

describe('palm rejection', () => {
  it('ignores a touch that arrives while a pen gesture is running', () => {
    // The stroke-destroying case: pen drawing, palm lands mid-stroke.
    expect(down({ kind: 'touch', activeKind: 'pen', contacts: 1 })).toBe('ignore')
    expect(down({ kind: 'touch', activeKind: 'pen', contacts: 2 })).toBe('ignore')
    // And still ignored whether or not the guard window is open.
    expect(down({ kind: 'touch', activeKind: 'pen', contacts: 1, penRecent: true })).toBe(
      'ignore',
    )
  })

  it('never turns a palm into a pinch, whatever button it claims', () => {
    expect(down({ kind: 'touch', activeKind: 'pen', contacts: 1, button: 2 })).toBe('ignore')
  })

  it('lets the pen preempt a palm that got there first', () => {
    // The viewport-stealing case: palm rests, then the pen lands.
    expect(down({ kind: 'pen', activeKind: 'touch', contacts: 1 })).toBe('preempt')
    expect(down({ kind: 'mouse', activeKind: 'touch', contacts: 1 })).toBe('preempt')
  })

  it('does not preempt for a second finger', () => {
    expect(down({ kind: 'touch', activeKind: 'touch', contacts: 1 })).toBe('pinch')
  })

  it('preempt is a two-step answer: clear the palm, then ask again', () => {
    // 'preempt' says what to do with the OLD contact, never what this one is.
    // Reading it as the final verdict was a bug: the pen fell through to the
    // pan branch and the palm still cost the teacher their stroke.
    const first = down({ kind: 'pen', activeKind: 'touch', contacts: 1 })
    expect(first).toBe('preempt')
    const second = down({ kind: 'pen', activeKind: null, contacts: 0 })
    expect(second).toBe('ink')
  })

  it('re-asking still honours space and the middle button', () => {
    expect(down({ kind: 'mouse', activeKind: null, contacts: 0, spaceHeld: true })).toBe('pan')
    expect(down({ kind: 'mouse', activeKind: null, contacts: 0, button: 1 })).toBe('pan')
  })

  it('space and the buttons outrank the finger-draws rule', () => {
    expect(down({ kind: 'touch', spaceHeld: true, penRecent: false })).toBe('pan')
    expect(down({ kind: 'touch', button: 2, penRecent: false })).toBe('pan')
  })
})

describe('what a contact means', () => {
  it('inks for a pen or mouse on an idle board', () => {
    expect(down({ kind: 'pen' })).toBe('ink')
    expect(down({ kind: 'mouse' })).toBe('ink')
  })

  it('lets a lone finger DRAW on a board that has never seen a pen', () => {
    // A teacher on a phone, or an iPad with no Pencil, has only a finger.
    // Refusing it ink strands them with no way to sketch at all.
    expect(down({ kind: 'touch', contacts: 0, penRecent: false })).toBe('ink')
  })

  it('takes ink away from the finger once the pen has been used', () => {
    expect(down({ kind: 'touch', contacts: 0, penRecent: true })).toBe('pan')
  })

  it('pinches on the second finger either way', () => {
    expect(down({ kind: 'touch', contacts: 1, penRecent: false })).toBe('pinch')
    expect(down({ kind: 'touch', contacts: 1, penRecent: true })).toBe('pinch')
    expect(down({ kind: 'touch', contacts: 1, activeKind: 'touch' })).toBe('pinch')
  })

  it('pans for space and for the middle/right buttons, in any mode', () => {
    expect(down({ kind: 'pen', spaceHeld: true })).toBe('pan')
    expect(down({ kind: 'mouse', button: 1 })).toBe('pan')
    expect(down({ kind: 'mouse', button: 2 })).toBe('pan')
  })

  it('treats a second pen/mouse contact as a phantom, not a pinch', () => {
    expect(down({ kind: 'pen', contacts: 1, activeKind: 'pen' })).toBe('ignore')
  })

  it('a pinch after the pen never starts ink with the first finger', () => {
    const first = down({ kind: 'touch', contacts: 0, penRecent: true })
    const second = down({ kind: 'touch', contacts: 1, activeKind: 'touch', penRecent: true })
    expect([first, second]).toEqual(['pan', 'pinch'])
  })

  it('a pen-less pinch does start ink — which is why the ink is held back', () => {
    // On a device with no pen the first finger legitimately inks, and the
    // second cancels it a few tens of ms later. TOUCH_INK_HOLD_MS is what
    // keeps that cancelled stroke from ever being drawn.
    const first = down({ kind: 'touch', contacts: 0, penRecent: false })
    const second = down({ kind: 'touch', contacts: 1, activeKind: 'touch', penRecent: false })
    expect([first, second]).toEqual(['ink', 'pinch'])
    expect(TOUCH_INK_HOLD_MS).toBeGreaterThan(40)
    expect(TOUCH_INK_HOLD_MS).toBeLessThan(200)
  })
})

describe('penGuardActive', () => {
  it('keeps the pen in charge long enough to be set down between strokes', () => {
    // 2s handed ink back to a resting palm in the gap between two strokes.
    expect(PEN_GUARD_MS).toBeGreaterThanOrEqual(30_000)
    expect(penGuardActive(1000, 1000)).toBe(true)
    expect(penGuardActive(1000, 1000 + PEN_GUARD_MS - 1)).toBe(true)
    expect(penGuardActive(1000, 1000 + PEN_GUARD_MS)).toBe(false)
    expect(penGuardActive(-Infinity, 5)).toBe(false)
  })
})

describe('wheel', () => {
  const mouse = { ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 100, deltaMode: 0 }
  const macMouse = { ctrlKey: false, metaKey: false, deltaX: 0, deltaY: -8, deltaMode: 0 }
  const lines = { ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 3, deltaMode: 1 }
  const trackpad = { ctrlKey: false, metaKey: false, deltaX: 0, deltaY: -2.3333, deltaMode: 0 }
  const twoAxis = { ctrlKey: false, metaKey: false, deltaX: 12, deltaY: 40, deltaMode: 0 }
  const slowPad = { ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 2, deltaMode: 0 }

  it('tells a mouse wheel (whole-number, one-axis notches) from a trackpad scroll', () => {
    expect(looksLikeMouseWheel(mouse)).toBe(true)
    expect(looksLikeMouseWheel(macMouse)).toBe(true)
    expect(looksLikeMouseWheel(lines)).toBe(true)
    expect(looksLikeMouseWheel(trackpad)).toBe(false)
    expect(looksLikeMouseWheel(twoAxis)).toBe(false)
    expect(looksLikeMouseWheel(slowPad)).toBe(false)
  })

  it('zooms for a mouse wheel and pans for a trackpad, by default', () => {
    expect(classifyWheel(mouse)).toBe('zoom')
    expect(classifyWheel(macMouse)).toBe('zoom')
    expect(classifyWheel(trackpad)).toBe('pan')
    expect(classifyWheel(twoAxis)).toBe('pan')
    // The old shape — no deltas at all — is a trackpad-style scroll.
    expect(classifyWheel({ ctrlKey: false, metaKey: false })).toBe('pan')
  })

  it('zooms for a pinch (ctrlKey) or ⌘, scrolls for shift, whatever the deltas', () => {
    expect(classifyWheel({ ...trackpad, ctrlKey: true })).toBe('zoom')
    expect(classifyWheel({ ...trackpad, metaKey: true })).toBe('zoom')
    expect(classifyWheel({ ...mouse, shiftKey: true })).toBe('pan')
  })

  it('lets the preference override the guess', () => {
    expect(classifyWheel(trackpad, 'zoom')).toBe('zoom')
    expect(classifyWheel(mouse, 'pan')).toBe('pan')
    expect(classifyWheel({ ...mouse, shiftKey: true }, 'zoom')).toBe('pan')
    expect(classifyWheel({ ...trackpad, ctrlKey: true }, 'pan')).toBe('zoom')
  })

  it('zoom factor: a notch is a quarter-step either way, a pinch is gentle, never NaN', () => {
    expect(wheelZoomFactor(mouse)).toBeCloseTo(Math.exp(-0.28), 6)
    expect(wheelZoomFactor({ ...mouse, deltaY: -100 })).toBeCloseTo(Math.exp(0.28), 6)
    expect(wheelZoomFactor({ ...mouse, deltaY: 1000 })).toBeCloseTo(Math.exp(-0.28), 6) // capped
    expect(wheelZoomFactor(lines)).toBeCloseTo(Math.exp(-0.99 * 0.28), 6)
    expect(wheelZoomFactor({ ...trackpad, ctrlKey: true })).toBeCloseTo(Math.exp(2.3333 * 0.012), 6)
    expect(wheelZoomFactor({ ...mouse, deltaY: NaN })).toBe(1)
  })

  it('reads deltas in whatever unit the event speaks', () => {
    expect(wheelPanDelta({ deltaX: 3, deltaY: -5, deltaMode: 0 }, 600)).toEqual({ dx: 3, dy: -5 })
    expect(wheelPanDelta({ deltaX: 1, deltaY: 2, deltaMode: 1 }, 600)).toEqual({ dx: 16, dy: 32 })
    expect(wheelPanDelta({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 600)).toEqual({ dx: 0, dy: 600 })
  })

  it('survives a NaN delta rather than sending the viewport to nowhere', () => {
    expect(wheelPanDelta({ deltaX: NaN, deltaY: Infinity }, 600)).toEqual({ dx: 0, dy: 0 })
  })
})

describe('oversketch intent', () => {
  it('blends when most of the stroke stayed on the curve', () => {
    expect(strokeLeftBand(40, 50)).toBe(false)
    expect(strokeLeftBand(26, 50)).toBe(false)
  })

  it('makes a new curve when the stroke mostly left the neighbourhood', () => {
    // A tangent, an asymptote, a translated copy: drawn NEXT TO the curve.
    expect(strokeLeftBand(4, 50)).toBe(true)
    expect(strokeLeftBand(24, 50)).toBe(true)
  })

  it('says nothing about a stroke it never measured', () => {
    expect(strokeLeftBand(0, 0)).toBe(false)
  })

  it('keeps the neighbourhood wide enough for a real reshape', () => {
    // A reshape moves the curve; 12px would call every honest reshape "new".
    expect(NEIGHBOURHOOD_PX).toBeGreaterThanOrEqual(40)
  })
})

describe('hit radii', () => {
  it('grows every target for a finger', () => {
    const fine = hitRadii(false)
    const coarse = hitRadii(true)
    expect(fine).toEqual({ handle: 10, marker: 9, body: 8 })
    expect(coarse).toEqual({ handle: 18, marker: 16, body: 14 })
    expect(coarse.handle).toBeGreaterThan(fine.handle)
    expect(coarse.marker).toBeGreaterThan(fine.marker)
    expect(coarse.body).toBeGreaterThan(fine.body)
  })

  it('keeps a handle ahead of a marker on both, so handles win the pointer', () => {
    expect(hitRadii(false).handle).toBeGreaterThan(hitRadii(false).marker)
    expect(hitRadii(true).handle).toBeGreaterThan(hitRadii(true).marker)
  })

  it('follows the board when it is scaled up for a projector', () => {
    // A handle drawn twice as big has to be grabbable twice as far out, or the
    // glyph and its target part company the moment the board is projected.
    const at1 = hitRadii(false)
    const at2 = hitRadii(false, { stroke: 2 })
    expect(at2.handle).toBeCloseTo(at1.handle * 2)
    expect(at2.marker).toBeCloseTo(at1.marker * 2)
    expect(at2.body).toBeCloseTo(at1.body * 2)
    const coarse2 = hitRadii(true, { stroke: 2 })
    expect(coarse2.body).toBeCloseTo(hitRadii(true).body * 2)
  })

  it('treats an absent or nonsense present as 1:1', () => {
    const base = hitRadii(false)
    expect(hitRadii(false, null)).toEqual(base)
    expect(hitRadii(false, {})).toEqual(base)
    expect(hitRadii(false, { stroke: NaN })).toEqual(base)
  })
})

describe('tooltip placement', () => {
  it('sits above-left of the pointer, clear of a right hand', () => {
    const p = tipPlacement(400, 300)
    expect(p.left).toBeLessThan(400)
    expect(p.top).toBeLessThan(300)
    expect(p.transform).toBe('translate(-100%, -100%)')
  })

  it('flips at the left and top edges instead of leaving the stage', () => {
    expect(tipPlacement(20, 300).transform).toBe('translate(0, -100%)')
    expect(tipPlacement(20, 300).left).toBeGreaterThan(20)
    expect(tipPlacement(400, 10).transform).toBe('translate(-100%, 0)')
    expect(tipPlacement(400, 10).top).toBeGreaterThan(10)
    expect(tipPlacement(20, 10).transform).toBe('translate(0, 0)')
  })
})

describe('touch pan slop', () => {
  it('is big enough that a resting palm does not move the board', () => {
    expect(TOUCH_PAN_SLOP).toBeGreaterThanOrEqual(4)
  })
})

// A compile-time check that the exported kinds are the ones the stage uses.
const kinds: PointerKind[] = ['pen', 'touch', 'mouse']
describe('exported vocabulary', () => {
  it('names exactly the three pointer kinds the board knows', () => {
    expect(kinds.map(pointerKind)).toEqual(kinds)
  })
})
