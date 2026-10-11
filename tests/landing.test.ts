// The landing page at "/": one brand constant, a small module graph that never
// reaches the app, read-only returning-visitor detection, and the URL routing
// (?app=1, share links, ?gallery=1 and its NC door, &course=nc), the audience
// it names and the "Also for NC Math" strip's images and claims.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { BRAND, TAGLINE } from '../src/brand'
import { DOC_INDEX_KEY, savedDocCount } from '../src/platform/returning'
import { appHref, opensApp } from '../src/platform/route'
import { galleryDoor, wantsGallery, withoutGalleryParam } from '../src/app/useGalleryLink'
import { EXAMPLE_DEFS } from '../src/examples/catalog'
import { HELP_SECTIONS } from '../src/ui/commands'

const root = path.resolve(__dirname, '..')
const src = (p: string): string => fs.readFileSync(path.join(root, p), 'utf8')

/** Code with comments removed, so a comment mentioning a name does not count. */
const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/**
 * Every local file reachable from `entry` through STATIC imports (dynamic
 * import() is a separate chunk and is not followed), plus bare packages.
 */
function staticGraph(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>()
  const packages = new Set<string>()
  const visit = (rel: string): void => {
    if (files.has(rel)) return
    files.add(rel)
    if (!/\.(ts|tsx)$/.test(rel)) return
    const text = code(src(rel))
    const specs = [
      ...text.matchAll(/^\s*import\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm),
      ...text.matchAll(/^\s*export\s+(?:type\s+)?[^'"]*?\s+from\s+['"]([^'"]+)['"]/gm),
    ]
    for (const m of specs) {
      if (/^\s*import\s+type\s/.test(m[0]) || /^\s*export\s+type\s/.test(m[0])) continue // erased
      const spec = m[1]
      if (!spec.startsWith('.')) {
        packages.add(spec)
        continue
      }
      const base = path.posix.join(path.posix.dirname(rel), spec)
      const hit = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(
        (c) => fs.existsSync(path.join(root, c)) && fs.statSync(path.join(root, c)).isFile(),
      )
      if (!hit) throw new Error(`${rel}: cannot resolve ${spec}`)
      visit(hit)
    }
  }
  visit(entry)
  return { files, packages }
}

describe('the brand', () => {
  it('lives in one constant', () => {
    expect(BRAND).toBeTruthy()
    expect(TAGLINE).toBe('Sketch it. Get the math.')
  })

  it('is read from src/brand.ts by every landing file, never typed out', () => {
    const files = ['src/main.tsx', ...fs.readdirSync(path.join(root, 'src/platform')).map((f) => `src/platform/${f}`)]
      .filter((f) => /\.(ts|tsx)$/.test(f))
    for (const f of files) expect(code(src(f)), f).not.toMatch(new RegExp(`\\b${BRAND}\\b`))
    expect(src('src/platform/Landing.tsx')).toMatch(/import \{[^}]*\bBRAND\b[^}]*\} from '\.\.\/brand'/)
    expect(code(src('src/platform/Landing.tsx'))).toMatch(/\{BRAND\}/)
    expect(code(src('src/main.tsx'))).toMatch(/\{BRAND\}/)
  })
})

describe('the landing module graph', () => {
  it('reaches no app code from main.tsx except through import()', () => {
    const { files, packages } = staticGraph('src/main.tsx')
    const local = [...files].filter((f) => /\.(ts|tsx)$/.test(f)).sort()
    expect(local).toEqual(
      [
        'src/brand.ts',
        'src/core/share.ts',
        'src/main.tsx',
        'src/platform/Demo.tsx',
        'src/platform/Landing.tsx',
        'src/platform/returning.ts',
        'src/platform/route.ts',
        'src/pwa/build.ts',
        'src/pwa/register.ts',
      ].sort(),
    )
    for (const f of files) {
      expect(f, f).not.toMatch(/^src\/(App\.tsx|ui\/|app\/|render\/|examples\/)/)
    }
    expect([...packages].sort()).toEqual(['react', 'react-dom/client'])
    // The app is a dynamic import, so it is its own chunk.
    expect(code(src('src/main.tsx'))).toMatch(/lazy\(\(\) => import\('\.\/platform\/Workspace'\)\)/)
  })

  it('keeps the one core module it uses dependency-free', () => {
    expect(code(src('src/core/share.ts'))).not.toMatch(/^\s*import\s/m)
  })

  it('the landing page itself imports only React, the brand and its own folder', () => {
    const { files, packages } = staticGraph('src/platform/Landing.tsx')
    for (const f of files) expect(f, f).toMatch(/^src\/(brand\.ts|platform\/|core\/share\.ts$)/)
    expect([...packages]).toEqual(['react'])
  })

  it('does not restyle the workspace: the app loads with its own dark styles only', () => {
    const ws = code(src('src/platform/Workspace.tsx'))
    expect(ws).toMatch(/import '\.\.\/ui\/styles\.css'/)
    expect(ws).not.toMatch(/lightWorkspace/)
    expect(fs.existsSync(path.join(root, 'src/platform/lightWorkspace.css'))).toBe(false)
  })
})

describe('returning visitors', () => {
  const index = (docs: unknown): string => JSON.stringify({ currentId: null, docs })

  it('counts the saved documents in the app’s index', () => {
    const read = (k: string): string | null => (k === DOC_INDEX_KEY ? index([{ id: 'a', name: 'A' }, { id: 'b' }]) : null)
    expect(savedDocCount(read)).toBe(2)
  })

  it('reads as none for a missing, empty, damaged or refused index', () => {
    expect(savedDocCount(() => null)).toBe(0)
    expect(savedDocCount(() => index([]))).toBe(0)
    expect(savedDocCount(() => '{not json')).toBe(0)
    expect(savedDocCount(() => '"a string"')).toBe(0)
    expect(savedDocCount(() => index('nope'))).toBe(0)
    expect(savedDocCount(() => index([null, 3, { name: 'no id' }]))).toBe(0)
    expect(
      savedDocCount(() => {
        throw new Error('SecurityError')
      }),
    ).toBe(0)
  })

  it('is pure: reads only the index key, and the module never writes storage', () => {
    const keys: string[] = []
    savedDocCount((k) => {
      keys.push(k)
      return index([{ id: 'a' }])
    })
    expect(keys).toEqual(['grapher.v1.index'])
    for (const f of ['src/platform/returning.ts', 'src/platform/Landing.tsx', 'src/platform/Demo.tsx']) {
      expect(code(src(f)), f).not.toMatch(/setItem|removeItem|\.clear\(|sessionStorage|indexedDB/)
    }
  })

  it('uses the same key as the app’s storage module', () => {
    expect(src('src/ui/storage.ts')).toMatch(/const PREFIX = 'grapher\.v1'/)
    expect(src('src/ui/storage.ts')).toMatch(/const INDEX_KEY = `\$\{PREFIX\}\.index`/)
  })
})

describe('routing "/"', () => {
  it('opens the app for ?app=1 and for share links, the landing page otherwise', () => {
    expect(opensApp('', '')).toBe(false)
    expect(opensApp('?utm_source=x', '#what')).toBe(false)
    expect(opensApp('?app=1', '')).toBe(true)
    expect(opensApp('?app=1&gallery=1', '')).toBe(true)
    expect(opensApp('', '#doc=zabc')).toBe(true)
    expect(opensApp('', '#view=1&reveal=1&doc=zabc')).toBe(true)
  })

  it('builds app links under the base path', () => {
    expect(appHref('/grapher/')).toBe('/grapher/?app=1')
    expect(appHref('/', { gallery: '1' })).toBe('/?app=1&gallery=1')
  })

  it('?gallery=1 asks for the gallery, unless a share link is being opened', () => {
    expect(wantsGallery('?app=1&gallery=1', '')).toBe(true)
    expect(wantsGallery('?app=1', '')).toBe(false)
    expect(wantsGallery('?app=1&gallery=1', '#view=1&doc=zabc')).toBe(false)
    expect(withoutGalleryParam('https://x.test/grapher/?app=1&gallery=1#a')).toBe('https://x.test/grapher/?app=1#a')
  })

  it('&course=nc is the NC Math door; no course (or any other) is the AP door', () => {
    expect(appHref('/', { gallery: '1', course: 'nc' })).toBe('/?app=1&gallery=1&course=nc')
    expect(opensApp('?app=1&gallery=1&course=nc', '')).toBe(true)
    expect(wantsGallery('?app=1&gallery=1&course=nc', '')).toBe(true)
    // course alone does not open the gallery, and a share link still wins
    expect(wantsGallery('?app=1&course=nc', '')).toBe(false)
    expect(wantsGallery('?app=1&gallery=1&course=nc', '#doc=zabc')).toBe(false)
    expect(galleryDoor('?app=1&gallery=1&course=nc')).toBe('nc')
    expect(galleryDoor('?app=1&gallery=1')).toBe('ap')
    expect(galleryDoor('?app=1&gallery=1&course=calc')).toBe('ap')
    // both parameters leave the address bar, so a reload does not reopen the gallery
    expect(withoutGalleryParam('https://x.test/grapher/?app=1&gallery=1&course=nc#a')).toBe('https://x.test/grapher/?app=1#a')
  })
})

// ---------------------------------------------------------------------------

/** A WebP's pixel size from its header (VP8, VP8L or VP8X). */
function webpSize(buf: Buffer): { w: number; h: number } {
  expect(buf.toString('ascii', 0, 4)).toBe('RIFF')
  expect(buf.toString('ascii', 8, 12)).toBe('WEBP')
  const kind = buf.toString('ascii', 12, 16)
  if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) }
  if (kind === 'VP8L') {
    const b = buf.readUInt32LE(21)
    return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }
  }
  expect(kind).toBe('VP8 ')
  return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
}

describe('the audience: AP and NC Math 1–3 teachers', () => {
  const landing = src('src/platform/Landing.tsx')

  it('names NC Math wherever it names the audience', () => {
    expect(landing).toContain('<p className="lp-eyebrow">For AP Calculus, AP Precalculus and NC Math 1–3 teachers</p>')
    expect(landing).toMatch(/^\/\/ For AP Calculus, AP Precalculus and NC Math 1–3 teachers/m)
    expect(src('index.html')).toMatch(/<meta name="description" content="[^"]*AP Calculus, AP Precalculus and NC Math 1–3 teachers/)
    expect(code(landing)).not.toMatch(/Built by an AP Calculus teacher/)
    expect(code(landing)).toMatch(/Built by a North Carolina math teacher \(AP Calculus, AP Precalculus, NC Math 3\)/)
  })

  it('keeps the AP door and adds the NC door, in the hero and under the NC strip', () => {
    expect(landing).toMatch(/href=\{galleryUrl\}>\s*Open an AP example\s*</)
    expect(landing).toMatch(/const ncGalleryUrl = appHref\(base, \{ gallery: '1', course: 'nc' \}\)/)
    expect(landing.match(/href=\{ncGalleryUrl\}>\s*Open an NC Math example\s*</g)).toHaveLength(2)
  })

  it('the NC strip comes after Answers · Teach · Print and claims only what the gallery has', () => {
    const order = ['id="lp-what"', 'id="lp-nc"', 'id="lp-trust"'].map((m) => landing.indexOf(m))
    expect(order.every((i) => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // each panel's board is a real gallery example of that course, with that help-sheet section
    const boards: [string, string, string][] = [
      ['m1-parallelogram', 'math1', 'm1-coord'],
      ['m2-two-way-table', 'math2', 'm2-prob'],
      ['m2-triangle-centres', 'math3', 'm3-centres'],
    ]
    for (const [id, course, help] of boards) {
      const def = EXAMPLE_DEFS.find((d) => d.id === id)
      expect(def?.course, id).toBe(course)
      expect(def?.help, id).toContain(help)
      expect(HELP_SECTIONS.find((h) => h.id === help)?.course, help).toBe(`NC Math ${course.slice(-1)}`)
    }
    for (const tag of ['NC Math 1 · G-GPE.4', 'NC Math 2 · S-CP', 'NC Math 3 · G-CO.10']) expect(landing).toContain(`'${tag}'`)
    expect(HELP_SECTIONS.find((h) => h.id === 'm1-coord')?.title).toMatch(/G-GPE\.4/)
    expect(HELP_SECTIONS.find((h) => h.id === 'm2-prob')?.title).toMatch(/S-CP/)
    expect(HELP_SECTIONS.find((h) => h.id === 'm3-centres')?.title).toMatch(/G-CO\.10/)
  })

  it('every NC image is a 720 × 450 WebP under 40 KB with real alt text', () => {
    for (const n of [1, 2, 3]) {
      const f = `src/platform/img/nc-math${n}.webp`
      const buf = fs.readFileSync(path.join(root, f))
      expect(buf.length, f).toBeLessThan(40 * 1024)
      expect(webpSize(buf), f).toEqual({ w: 720, h: 450 })
      expect(landing).toContain(`import ncMath${n}Img from './img/nc-math${n}.webp'`)
    }
    const alts = [...landing.matchAll(/^\s*alt: '([^']+)'/gm)].map((m) => m[1])
    expect(alts).toHaveLength(6)
    for (const a of alts) expect(a.length).toBeGreaterThan(60)
  })

  it('keeps every landing image together under 300 KB', () => {
    const dir = path.join(root, 'src/platform/img')
    const total = fs.readdirSync(dir).reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0)
    expect(total).toBeLessThan(300 * 1024)
  })
})
