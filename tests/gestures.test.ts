import { describe, expect, it } from 'vitest'
import {
  NEIGHBOURHOOD_PX,
  PEN_GUARD_MS,
  TOUCH_PAN_SLOP,
  classifyPointerDown,
  classifyWheel,
  hitRadii,
  penGuardActive,
  pointerKind,
  strokeLeftBand,
  tipPlacement,
  wheelPanDelta,
} from '../src/ui/CanvasStage'
import type { PointerKind, PointerVerdict } from '../src/ui/CanvasStage'

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
})

describe('what a contact means', () => {
  it('inks for a pen or mouse on an idle board', () => {
    expect(down({ kind: 'pen' })).toBe('ink')
    expect(down({ kind: 'mouse' })).toBe('ink')
  })

  it('never inks for a finger: one pans, two pinch', () => {
    expect(down({ kind: 'touch', contacts: 0 })).toBe('pan')
    expect(down({ kind: 'touch', contacts: 1 })).toBe('pinch')
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

  it('a two-finger pinch never starts ink with the first finger', () => {
    // The first finger pans (no ink to flash), the second turns it into zoom.
    const first = down({ kind: 'touch', contacts: 0 })
    const second = down({ kind: 'touch', contacts: 1, activeKind: 'touch' })
    expect([first, second]).toEqual(['pan', 'pinch'])
  })
})

describe('penGuardActive', () => {
  it('distrusts a bare touch for about two seconds after the pen', () => {
    expect(PEN_GUARD_MS).toBe(2000)
    expect(penGuardActive(1000, 1000)).toBe(true)
    expect(penGuardActive(1000, 1000 + PEN_GUARD_MS - 1)).toBe(true)
    expect(penGuardActive(1000, 1000 + PEN_GUARD_MS)).toBe(false)
    expect(penGuardActive(-Infinity, 5)).toBe(false)
  })
})

describe('wheel', () => {
  it('pans for a plain or two-axis wheel', () => {
    expect(classifyWheel({ ctrlKey: false, metaKey: false })).toBe('pan')
  })

  it('zooms only for a pinch (ctrlKey) or an explicit modifier', () => {
    expect(classifyWheel({ ctrlKey: true, metaKey: false })).toBe('zoom')
    expect(classifyWheel({ ctrlKey: false, metaKey: true })).toBe('zoom')
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
