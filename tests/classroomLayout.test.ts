// ============================================================================
// tests/classroomLayout.test.ts — the classroom-device pass, in the stylesheet.
//
// Checked at 1024×768 (projector), 1366×768 (Chromebook), 768×1024 and
// 1024×768 (iPad, touch) and 375×812 (a student's phone, view-only link):
//
//   * on touch, the card's ⋯ menu (24px), its letter chip (22×20) and a row
//     of narrow chips (a "0", a ×, the Taylor ‹ › and centre) were under 44px;
//     so were "Make a copy" (28px) and a toast's action (20px);
//   * the sign chart's band along the bottom of the board sat UNDER the zoom
//     stack and the bottom notices — and on a phone under the docked toolbar;
//   * a toast centred with left: 50% shrank to half the board (six lines on a
//     phone);
//   * two quick taps on a control zoomed the page on iPad Safari.
//
// What the browser showed is the evidence; these pin the rules down so the
// next stylesheet edit cannot quietly undo them.
// ============================================================================

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CSS = readFileSync(fileURLToPath(new URL('../src/ui/styles.css', import.meta.url)), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

/** The bodies of every @media block whose condition matches `cond`, concatenated. */
function mediaBodies(cond: RegExp): string {
  const out: string[] = []
  const re = /@media\s*([^{]+)\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(CSS))) {
    if (!cond.test(m[1])) continue
    let depth = 1
    let i = re.lastIndex
    for (; i < CSS.length && depth > 0; i++) {
      if (CSS[i] === '{') depth++
      else if (CSS[i] === '}') depth--
    }
    out.push(CSS.slice(re.lastIndex, i - 1))
  }
  return out.join('\n')
}

/** The declarations of every rule in `src` whose selector list contains `sel`, joined. */
function ruleFor(src: string, sel: string): string {
  const re = /([^{}]+)\{([^{}]*)\}/g
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const sels = m[1].split(',').map((s) => s.trim())
    if (sels.includes(sel)) out.push(m[2])
  }
  return out.join('\n')
}

/** Top-level rules only (outside every @media). */
function topLevel(): string {
  let out = ''
  let depth = 0
  let inMedia = false
  for (let i = 0; i < CSS.length; i++) {
    if (!inMedia && CSS.startsWith('@media', i) && depth === 0) inMedia = true
    const ch = CSS[i]
    if (ch === '{') depth++
    if (!inMedia) out += ch
    if (ch === '}') {
      depth--
      if (depth === 0 && inMedia) inMedia = false
    }
  }
  return out
}

const COARSE = mediaBodies(/^\(pointer:\s*coarse\)\s*$/)
const PHONE = mediaBodies(/^\(max-width:\s*540px\)\s*$/)
const TOP = topLevel()

describe('touch (pointer: coarse): every control a fingertip uses answers to 44px', () => {
  it('the card ⋯ menu is a 44px square', () => {
    const r = ruleFor(COARSE, '.card-menu-btn')
    expect(r).toMatch(/width:\s*44px/)
    expect(r).toMatch(/height:\s*44px/)
  })

  it('the letter chip keeps its look and gains a 44px hit area', () => {
    expect(ruleFor(COARSE, '.name-chip-btn')).toMatch(/position:\s*relative/)
    const after = ruleFor(COARSE, '.name-chip-btn::after')
    expect(after).toMatch(/width:\s*44px/)
    expect(after).toMatch(/height:\s*44px/)
  })

  it('narrow chips are at least 44px wide', () => {
    for (const sel of ['.dr-notation', '.calc-drop', '.taylor-step', '.taylor-play', '.calc-field-btn', 'button.an-value']) {
      expect(ruleFor(COARSE, sel), sel).toMatch(/min-width:\s*44px/)
    }
  })

  it('"Make a copy" and a toast’s action are 44px tall', () => {
    for (const sel of ['.share-banner-btn', '.toast-action']) {
      expect(ruleFor(COARSE, sel), sel).toMatch(/min-height:\s*44px/)
    }
  })
})

describe('the sign chart band is never under the chrome', () => {
  it('the zoom stack, the toast and the feature note sit above --sign-band', () => {
    for (const sel of ['.zoom-controls', '.toast', '.feature-note']) {
      expect(ruleFor(TOP, sel), sel).toMatch(/bottom:\s*calc\([^;]*var\(--sign-band,\s*0px\)/)
    }
  })

  it('so do the presentation legend’s two bottom corners', () => {
    for (const sel of ['.present-legend-bottom-left', '.present-legend-bottom-right']) {
      expect(ruleFor(TOP, sel), sel).toMatch(/inset-block-end:\s*calc\([^;]*var\(--sign-band,\s*0px\)/)
    }
  })

  it('on a phone the board stops above the docked toolbar, and the notices follow it up', () => {
    expect(ruleFor(PHONE, '.stage')).toMatch(/bottom:\s*var\(--toolbar-reserve\)/)
    expect(ruleFor(PHONE, '.canvas-area .toast')).toMatch(/var\(--toolbar-reserve\)[^;]*var\(--sign-band/)
    expect(ruleFor(PHONE, '.has-sign-band .zoom-controls')).toMatch(/var\(--toolbar-reserve\)[^;]*var\(--sign-band/)
  })
})

describe('notices and taps', () => {
  it('a centred toast is as wide as its text, not half the board', () => {
    for (const sel of ['.toast', '.feature-note']) {
      const r = ruleFor(TOP, sel)
      expect(r, sel).toMatch(/width:\s*max-content/)
      expect(r, sel).toMatch(/max-width:\s*min\(560px,\s*calc\(100% - 32px\)\)/)
    }
  })

  it('controls opt out of double-tap-to-zoom; the board opts out of the long-press callout', () => {
    expect(ruleFor(TOP, 'button')).toMatch(/touch-action:\s*manipulation/)
    expect(ruleFor(TOP, 'input')).toMatch(/touch-action:\s*manipulation/)
    const stage = ruleFor(TOP, '.stage-canvas')
    expect(stage).toMatch(/touch-action:\s*none/)
    expect(stage).toMatch(/-webkit-touch-callout:\s*none/)
  })
})
