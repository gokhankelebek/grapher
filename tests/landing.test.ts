// The landing page at "/": one brand constant, a small module graph that never
// reaches the app, read-only returning-visitor detection, and the URL routing
// (?app=1, share links, ?gallery=1).
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { BRAND, TAGLINE } from '../src/brand'
import { DOC_INDEX_KEY, savedDocCount } from '../src/platform/returning'
import { appHref, opensApp } from '../src/platform/route'
import { wantsGallery, withoutGalleryParam } from '../src/app/useGalleryLink'

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
})
