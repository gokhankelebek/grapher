// ============================================================================
// tests/lazyLoad.test.ts — the code split (src/ui/lazyLoad.tsx): lazy modules
// load once and can retry, a lazy component renders its fallback until its
// module is here and the component itself after, the main chunk keeps every
// render path, and the service worker caches the split chunks for offline.
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { lazyComponent, lazyModule } from '../src/ui/lazyLoad'
import { injectServiceWorker, precacheEntries } from '../src/pwa/build'

const ROOT = path.resolve(__dirname, '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

describe('lazyModule', () => {
  it('is null until loaded, imports once however many ask, then is synchronous', async () => {
    let calls = 0
    const m = lazyModule(async () => {
      calls++
      return { answer: 42 }
    })
    expect(m.get()).toBeNull()
    const [a, b] = await Promise.all([m.load(), m.load()])
    expect(calls).toBe(1)
    expect(a).toBe(b)
    expect(m.get()).toEqual({ answer: 42 })
    await m.load()
    expect(calls).toBe(1)
  })

  it('a failed load (offline, a stale deploy) can be tried again', async () => {
    let calls = 0
    const m = lazyModule(async () => {
      calls++
      if (calls === 1) throw new Error('Failed to fetch dynamically imported module')
      return 'ok'
    })
    await expect(m.load()).rejects.toThrow()
    expect(m.get()).toBeNull()
    await expect(m.load()).resolves.toBe('ok')
    expect(calls).toBe(2)
  })
})

describe('lazyComponent', () => {
  it('renders the fallback before its module is here, and the component after', async () => {
    const mod = lazyModule(async () => ({ Hello: ({ who }: { who: string }) => createElement('b', null, `hi ${who}`) }))
    const Hello = lazyComponent(mod, (m) => m.Hello, createElement('i', null, 'wait'))
    expect(renderToStaticMarkup(createElement(Hello, { who: 'x' }))).toBe('<i>wait</i>')
    await mod.load()
    // loaded: rendered in the same pass — no Suspense, no fallback frame
    expect(renderToStaticMarkup(createElement(Hello, { who: 'x' }))).toBe('<b>hi x</b>')
  })
})

describe('what stays in the main chunk', () => {
  const lazyTargets = (src: string): string[] => [...src.matchAll(/import\('([^']+)'\)/g)].map((m) => m[1])
  const files = [
    'src/App.tsx',
    'src/ui/Sidebar.tsx',
    'src/ui/Latex.tsx',
    'src/app/useStats.tsx',
    'src/app/useUnitCircle.tsx',
    'src/app/useRelatedRates.tsx',
    'src/app/useInequalitySystem.tsx',
    'src/app/useExport.ts',
    'src/app/useExamples.ts',
    'src/app/useItemBank.ts',
  ]

  it('nothing renderBoard draws with is loaded lazily', () => {
    for (const f of files) {
      for (const t of lazyTargets(read(f))) {
        expect(t, `${f} lazily imports ${t}`).not.toMatch(/render\/|renderBoard|Links'?$|CanvasStage|NumberLineStage|CurveCard/)
      }
    }
  })

  it('a split module is not also imported statically (which would pull it back into the main chunk)', () => {
    const all = files.flatMap((f) => lazyTargets(read(f)).map((t) => ({ f, t })))
    expect(all.length).toBeGreaterThanOrEqual(20)
    for (const { f, t } of all) {
      const base = t.replace(/^.*\//, '')
      for (const g of files) {
        const src = read(g)
        const statics = [...src.matchAll(/^import (?!type)[^\n]*from '([^']+)'/gm)].map((m) => m[1].replace(/^.*\//, ''))
        expect(statics, `${g} imports ${base} statically, but ${f} splits it`).not.toContain(base)
      }
    }
  })

  it('the board description does not pull the item bank in', () => {
    expect(read('src/ui/boardDescription.ts')).not.toMatch(/from '\.\/itemBank'/)
  })
})

describe('offline: the service worker caches the split chunks', () => {
  it('the build step precaches every file it emitted (it walks the whole output directory)', () => {
    const cfg = read('vite.config.ts')
    expect(cfg).toMatch(/walk\(outDir\)/)
    expect(cfg).toMatch(/precacheEntries\(files\)/)
  })

  it('after install, every lazy chunk opens with no network', async () => {
    const built = [
      'index.html',
      'sw.js',
      'assets/index-a.js',
      'assets/Workspace-b.js',
      'assets/Workspace-c.css',
      'assets/katex-d.js',
      'assets/exportBackends-e.js',
      'assets/HelpSheet-f.js',
      'assets/ProbCard-g.js',
      'assets/KaTeX_Main-Regular-h.woff2',
    ]
    const precache = precacheEntries(built)
    for (const f of built.filter((f) => f.endsWith('.js') && f !== 'sw.js')) expect(precache).toContain(f)

    const origin = 'https://example.github.io'
    const base = '/grapher/'
    const store = new Map<string, string>()
    let online = true
    const handlers: Record<string, (e: unknown) => void> = {}
    class Req {
      url: string
      method = 'GET'
      mode: string
      constructor(u: string | Req, init: { mode?: string } = {}) {
        this.url = typeof u === 'string' ? u : u.url
        this.mode = init.mode ?? 'cors'
      }
    }
    const res = (body: string) => ({ ok: true, type: 'basic', body, clone() { return this } })
    const net = async (r: string | Req) => {
      if (!online) throw new TypeError('Failed to fetch')
      return res(typeof r === 'string' ? r : r.url)
    }
    const cache = {
      async addAll(rs: Req[]) {
        for (const r of rs) store.set(r.url, (await net(r)).body)
      },
      async put(r: string | Req, v: { body: string }) {
        store.set(typeof r === 'string' ? r : r.url, v.body)
      },
      async match(r: string | Req) {
        const b = store.get(typeof r === 'string' ? r : r.url)
        return b === undefined ? undefined : res(b)
      },
    }
    const caches = { open: async () => cache, keys: async () => [], delete: async () => true }
    const self = {
      location: { href: `${origin}${base}sw.js` },
      registration: { scope: `${origin}${base}` },
      addEventListener: (t: string, fn: (e: unknown) => void) => (handlers[t] = fn),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    }
    const src = injectServiceWorker(read('public/sw.js'), 'v1', precache)
    new Function('self', 'caches', 'fetch', 'Request', src)(self, caches, net, Req)
    let done: Promise<unknown> = Promise.resolve()
    handlers.install({ waitUntil: (p: Promise<unknown>) => (done = p) })
    await done

    online = false
    for (const f of ['assets/katex-d.js', 'assets/exportBackends-e.js', 'assets/HelpSheet-f.js', 'assets/ProbCard-g.js']) {
      let out: Promise<{ body: string }> | null = null
      handlers.fetch({ request: new Req(`${origin}${base}${f}`), respondWith: (p: Promise<{ body: string }>) => (out = p) })
      expect(out, f).not.toBeNull()
      expect((await out!).body).toBe(`${origin}${base}${f}`)
    }
  })
})
