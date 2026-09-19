import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The stylesheet, checked the way the design was argued: in numbers.
 *
 * These are not snapshot tests — they do not care what the palette is, only
 * that it keeps its promises. Change --panel-3 and the surface-step test will
 * tell you whether a card hover is still visible; brighten --muted and the
 * contrast floors move with it. What fails a test here is a regression a
 * reader would have felt.
 */

const CSS = readFileSync(
  fileURLToPath(new URL('../src/ui/styles.css', import.meta.url)),
  'utf8',
)

// ---------------------------------------------------------------- contrast

type RGB = [number, number, number]

function hex(value: string): RGB {
  const h = value.trim().replace('#', '')
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

function luminance([r, g, b]: RGB): number {
  const f = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** WCAG contrast ratio, 1:1 (identical) to 21:1 (black on white). */
function contrast(a: string, b: string): number {
  const la = luminance(hex(a))
  const lb = luminance(hex(b))
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// ------------------------------------------------------------- css reading

/** The value of a custom property declared on :root. */
function token(name: string): string {
  const root = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('\n}', CSS.indexOf(':root {')))
  const m = root.match(new RegExp(`${name}:\\s*([^;]+);`))
  if (!m) throw new Error(`no such token on :root: ${name}`)
  return m[1].trim()
}

/** The body of the first rule whose selector list matches exactly. */
function rule(selector: string): string {
  const at = CSS.indexOf(`\n${selector} {`)
  if (at < 0) throw new Error(`no such rule: ${selector}`)
  const open = CSS.indexOf('{', at)
  return CSS.slice(open + 1, CSS.indexOf('}', open))
}

function declaration(selector: string, property: string): string {
  const m = rule(selector).match(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`))
  if (!m) throw new Error(`${selector} does not set ${property}`)
  return m[1].trim()
}

const BG = token('--bg')
const PANEL = token('--panel')
const PANEL_2 = token('--panel-2')
const PANEL_3 = token('--panel-3')
const TEXT = token('--text')
const MUTED = token('--muted')
const FAINT = token('--faint')

/** Every surface a token can find itself sitting on. */
const SURFACES = { bg: BG, panel: PANEL, 'panel-2': PANEL_2, 'panel-3': PANEL_3 }

describe('colour: readable text clears WCAG AA', () => {
  it('--text is comfortable on every surface, including the lightest', () => {
    for (const [name, surface] of Object.entries(SURFACES)) {
      expect(contrast(TEXT, surface), `--text on --${name}`).toBeGreaterThanOrEqual(7)
    }
  })

  it('--muted, which carries labels and secondary copy, clears 4.5:1 everywhere', () => {
    for (const [name, surface] of Object.entries(SURFACES)) {
      expect(contrast(MUTED, surface), `--muted on --${name}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('--faint clears 4.5:1 on the dark surfaces and 3:1 (icons) on the lightest', () => {
    for (const name of ['bg', 'panel', 'panel-2'] as const) {
      expect(contrast(FAINT, SURFACES[name]), `--faint on --${name}`).toBeGreaterThanOrEqual(4.5)
    }
    // --panel-3 is the hover/selected surface; only icons rest on --faint there
    expect(contrast(FAINT, PANEL_3)).toBeGreaterThanOrEqual(3)
  })

  it('the hidden-curve badge is loud, not the dimmest pixel in the app', () => {
    const eyeOff = declaration('.eye-off', 'color')
    // it persists without hover, on a resting card and on a selected one
    expect(contrast(eyeOff, PANEL_2)).toBeGreaterThanOrEqual(7)
    expect(contrast(eyeOff, PANEL_3)).toBeGreaterThanOrEqual(7)
  })
})

describe('colour: the surface ladder has visible steps', () => {
  it('hovering a card changes something a person can see', () => {
    // .card rests on --panel-2 and hovers/selects to --panel-3
    expect(contrast(PANEL_2, PANEL_3)).toBeGreaterThanOrEqual(1.3)
  })

  it('a card is distinguishable from the sidebar it sits in', () => {
    expect(contrast(PANEL, PANEL_2)).toBeGreaterThanOrEqual(1.08)
  })
})

describe('type: one scale, nothing under 11px', () => {
  const SCALE = ['--fs-xs', '--fs-sm', '--fs-md', '--fs-lg', '--fs-xl']

  it('the scale is 11 / 12 / 13 / 15 / 17', () => {
    expect(SCALE.map(token)).toEqual(['11px', '12px', '13px', '15px', '17px'])
  })

  it('no rule sets a font-size below 11px', () => {
    const literals = [...CSS.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]))
    for (const size of literals) {
      expect(size, `literal font-size: ${size}px`).toBeGreaterThanOrEqual(11)
    }
  })

  it('every font-size is either a scale token or a deliberate exception', () => {
    const allowed = new Set([
      '34px', // .empty-glyph-error — a decorative glyph, not type
      '40px', // .empty-glyph
      'var(--fs-field-touch)', // 16px: below it, iOS Safari zooms on focus
      '1.05em', // katex optical match
      'inherit',
    ])
    const values = [...CSS.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim())
    for (const value of values) {
      const ok = SCALE.some((t) => value === `var(${t})`) || allowed.has(value)
      expect(ok, `unexpected font-size: ${value}`).toBe(true)
    }
  })

  it('touch fields stay at 16px, the point below which iOS Safari auto-zooms', () => {
    expect(token('--fs-field-touch')).toBe('16px')
  })

  it('the seven section eyebrows share one rule', () => {
    const eyebrows = [
      '.sidebar-title',
      '.an-title',
      '.cand-title',
      '.doc-menu-title',
      '.exp-title',
      '.handle-pop-title',
      '.doc-kind-title',
    ]
    const shared = CSS.indexOf(eyebrows.join(',\n') + ' {')
    expect(shared, 'the eyebrows are not declared as one selector list').toBeGreaterThan(0)
    const body = CSS.slice(shared, CSS.indexOf('}', shared))
    expect(body).toContain('font-size: var(--fs-xs)')
    expect(body).toContain('font-weight: 600')
    expect(body).toContain('color: var(--muted)')
  })
})

describe('rhythm: spacing sits on a scale', () => {
  it('the scale is 4 / 8 / 12 / 16 / 24', () => {
    expect(['--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-6'].map(token)).toEqual([
      '4px',
      '8px',
      '12px',
      '16px',
      '24px',
    ])
  })

  it('no gap, margin or padding uses an off-scale length', () => {
    // 2px and 6px survive as control insets — a 4px step would change the
    // shape of a pill. Everything else is a token, 0, or a negative offset.
    const INSETS = new Set([0, 2, 6])
    const pattern =
      /\b(margin|padding|gap|row-gap|column-gap)(?:-(?:top|bottom|left|right))?:\s*([^;{}]+)/g
    const offenders: string[] = []
    for (const m of CSS.matchAll(pattern)) {
      const value = m[2]
      if (/var\(|calc\(|env\(|max\(|min\(/.test(value)) continue
      for (const part of value.trim().split(/\s+/)) {
        const px = part.match(/^(-?[\d.]+)px$/)
        if (!px) continue
        const n = Number(px[1])
        if (n < 0) continue // negative offsets pull things together on purpose
        if (!INSETS.has(n)) offenders.push(`${m[1]}: ${value.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the sidebar has one left edge, not two', () => {
    expect(declaration('.sidebar-head', 'padding')).toBe('var(--sp-3)')
    expect(declaration('.sidebar-list', 'padding')).toBe('var(--sp-3)')
  })

  it('the card has one left edge, and symmetric padding', () => {
    expect(declaration('.card', 'padding')).toBe('var(--sp-3)')
    expect(rule('.card-sub')).not.toContain('padding-left')
  })

  it('Interpretations is separated from Analysis the way Analysis is', () => {
    for (const section of ['.an-section', '.cand-section']) {
      expect(declaration(section, 'padding-top')).toBe('var(--sp-3)')
      expect(declaration(section, 'border-top')).toBe('1px solid var(--border-soft)')
    }
  })
})

describe('the banner keeps its centring', () => {
  it('uses its own keyframes, not the shared pop-in', () => {
    expect(declaration('.banner', 'animation')).toContain('banner-in')
    expect(declaration('.banner', 'transform')).toBe('translateX(-50%)')
  })

  it('banner-in ends on the transform the banner is positioned with', () => {
    const at = CSS.indexOf('@keyframes banner-in {')
    expect(at).toBeGreaterThan(0)
    const body = CSS.slice(at, CSS.indexOf('\n}', at))
    const to = body.slice(body.indexOf('to {'))
    // `transform: none` here would delete translateX(-50%) for good
    expect(to).toContain('translateX(-50%)')
    expect(to).not.toContain('transform: none')
  })

  it('hangs off the toolbar rather than a hard-coded 62px', () => {
    expect(declaration('.banner', 'inset-block-start')).toContain('var(--toolbar-h)')
  })

  it('gives the message the room, and lets the actions wrap', () => {
    expect(declaration('.banner-body', 'flex')).toMatch(/^1 1 /)
    expect(declaration('.banner', 'flex-wrap')).toBe('wrap')
  })
})

describe('stacking: menus win over banners', () => {
  it('the toolbar outranks the banner, so the menus it traps come with it', () => {
    const toolbar = Number(declaration('.toolbar', 'z-index'))
    const banner = Number(declaration('.banner', 'z-index'))
    expect(toolbar).toBeGreaterThan(banner)
  })

  it('the drop overlay still covers everything', () => {
    expect(Number(declaration('.drop-overlay', 'z-index'))).toBeGreaterThan(
      Number(declaration('.toolbar', 'z-index')),
    )
  })
})

describe('popovers cannot outgrow the window', () => {
  it('the export menu, document menu and handle popover are clamped', () => {
    const clamped = rule('.exp-menu,\n.doc-menu,\n.handle-pop')
    expect(clamped).toContain('max-width: calc(100vw')
    expect(clamped).toContain('max-height: calc(100vh')
  })
})

describe('the broken state is told apart by shape, not by hue', () => {
  it('curve #2 really is the danger colour, which is why hue cannot carry it', () => {
    // guard-rail: if this ever stops being true the shape treatment is still
    // correct, but the reason for it has changed
    expect(token('--danger').toLowerCase()).toBe('#f95f62')
  })

  it('a broken card is dashed, tinted, and carries a warning glyph', () => {
    const broken = rule(
      '.card-broken-state,\n.card-broken-state:hover,\n.card-broken-state.card-selected',
    )
    expect(broken).toContain('border-style: dashed')
    expect(broken).toMatch(/background:/)
    expect(rule('.card-broken::before')).toContain("content: '⚠'")
  })

  it('a solution set does not wear the error chip', () => {
    const ineq = rule('.nl-ineq')
    expect(ineq).toContain('border-radius: 999px')
    expect(ineq).toContain('font-family: var(--font)')
  })
})

describe('focus rings read on any colour', () => {
  it('the ring follows the shape it rings', () => {
    expect(declaration(':focus-visible', 'border-radius')).toBe('inherit')
  })

  it('anything carrying a curve colour gets a dark gap inside the accent', () => {
    const twoTone = CSS.indexOf('.color-dot:focus-visible,')
    expect(twoTone).toBeGreaterThan(0)
    const body = CSS.slice(twoTone, CSS.indexOf('}', twoTone))
    expect(body).toContain('box-shadow: 0 0 0 1px var(--bg)')
  })
})

describe('numbers are set in one family', () => {
  it('every numeric readout is mono', () => {
    for (const selector of [
      '.err-badge',
      '.cand-err',
      '.sidebar-count',
      '.exp-num',
      '.doc-open-date',
      '.param-value',
      '.an-value',
    ]) {
      expect(declaration(selector, 'font-family'), selector).toBe('var(--font-mono)')
    }
  })

  it('the separator hugs the value in front of it', () => {
    expect(declaration('.an-sep', 'margin-left')).toBe('calc(-1 * var(--sp-1))')
  })
})

describe('touch layer', () => {
  const layer = CSS.slice(
    CSS.indexOf('@media (pointer: coarse) {'),
    CSS.indexOf('@media (pointer: coarse) and (max-width: 1024px)'),
  )

  it('exists', () => {
    expect(layer.length).toBeGreaterThan(0)
  })

  it('every listed control reaches 44x44', () => {
    for (const selector of [
      '.icon-btn',
      '.add-btn',
      '.doc-caret',
      '.exp-caret',
      '.zoom-btn',
      '.tb-btn',
      '.seg-btn',
      '.dash-btn',
      '.board-kind-btn',
      '.doc-kind-btn',
    ]) {
      expect(layer, selector).toContain(selector)
    }
    expect(layer).toContain('width: 44px')
    expect(layer).toContain('min-height: 44px')
    expect(layer).toContain('min-width: 44px')
  })

  it('the colour dot keeps its size and grows only its target', () => {
    const after = layer.slice(layer.indexOf('.color-dot::after {'))
    expect(after).toContain('width: 44px')
    expect(after).toContain('height: 44px')
  })

  it('range thumbs are 28px inside 44px rows', () => {
    expect(layer).toContain('width: 28px')
    expect(layer).toContain('height: 44px')
  })

  it('every field is 16px, so iOS Safari does not zoom on focus', () => {
    expect(layer).toMatch(/input,\s*\n\s*textarea,\s*\n\s*select \{\s*\n\s*font-size: var\(--fs-field-touch\);/)
  })
})

describe('responsive layers', () => {
  it('the sidebar becomes a drawer well before phone widths', () => {
    // a portrait iPad should get a drawer, not a sidebar taking 42% of the board
    expect(CSS).toContain('@media (max-width: 900px) {')
    const drawer = CSS.slice(CSS.indexOf('@media (max-width: 900px) {'))
    expect(drawer.slice(0, 1200)).toContain('position: absolute')
  })

  it('the drawer and its scrim clear the toolbar they slide over', () => {
    const toolbarZ = Number(declaration('.toolbar', 'z-index'))
    // both live inside a `@media (max-width: 900px)` block — the drawer layer
    const zIn = (selector: string) => {
      let z = 0
      for (const m of CSS.matchAll(/@media \(max-width: 900px\) \{/g)) {
        const scope = CSS.slice(m.index!, CSS.indexOf('\n}\n', m.index!))
        const at = scope.indexOf(`${selector} {`)
        if (at < 0) continue
        const body = scope.slice(at, scope.indexOf('}', at))
        z = Math.max(z, Number(body.match(/z-index: (\d+)/)?.[1] ?? 0))
      }
      expect(z, `${selector} has no z-index in the drawer layer`).toBeGreaterThan(0)
      return z
    }
    const sidebarZ = zIn('.sidebar')
    const scrimZ = zIn('.scrim')
    expect(sidebarZ).toBeGreaterThan(toolbarZ)
    expect(scrimZ).toBeGreaterThan(toolbarZ)
    expect(sidebarZ).toBeGreaterThan(scrimZ)
  })

  it('on phones the drawer stops above the docked toolbar', () => {
    const phone = CSS.slice(CSS.indexOf('@media (max-width: 540px) {'))
    expect(phone.slice(0, 1600)).toContain('bottom: var(--toolbar-reserve)')
  })

  it('the horizontally scrolling toolbar says that it scrolls', () => {
    const phone = CSS.slice(CSS.indexOf('@media (max-width: 540px) {'))
    const block = phone.slice(0, 1600)
    expect(block).toContain('scrollbar-width: thin')
    expect(block).not.toContain('scrollbar-width: none')
    expect(block).toContain('inset -20px 0')
  })
})

describe('light canvas', () => {
  it('the chrome has a light equivalent keyed off one class', () => {
    const light = rule('.canvas-light .toolbar,\n.canvas-light .zoom-controls')
    // re-declaring the tokens carries every descendant, menus included
    for (const t of ['--text', '--muted', '--panel', '--border', '--accent']) {
      expect(light, t).toContain(`${t}:`)
    }
    expect(light).toContain('background: rgba(252, 253, 255')
  })

  it('its labels are readable on paper', () => {
    const TOOLBAR_ON_PAPER = '#fcfdff'
    expect(contrast(declaration('.canvas-light .tb-btn', 'color'), TOOLBAR_ON_PAPER)).toBeGreaterThanOrEqual(4.5)
    expect(
      contrast(declaration('.canvas-light .tb-primary', 'color'), declaration('.canvas-light .tb-primary', 'background')),
    ).toBeGreaterThanOrEqual(4.5)
  })
})
