// ============================================================================
// tests/pwa.test.ts — offline install: base paths, the manifest, and the
// service worker itself (public/sw.js, run here in a fake worker scope).
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SW_PRECACHE_MARK,
  SW_VERSION_MARK,
  cacheVersion,
  injectServiceWorker,
  normalizeBase,
  precacheEntries,
  swRegistration,
} from '../src/pwa/build'

const ROOT = path.resolve(__dirname, '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

describe('base paths', () => {
  it('normalises GRAPHER_BASE to a path that starts and ends with /', () => {
    expect(normalizeBase(undefined)).toBe('/')
    expect(normalizeBase('')).toBe('/')
    expect(normalizeBase('/')).toBe('/')
    expect(normalizeBase('./')).toBe('/')
    expect(normalizeBase('grapher')).toBe('/grapher/')
    expect(normalizeBase('/grapher')).toBe('/grapher/')
    expect(normalizeBase('/grapher/')).toBe('/grapher/')
    expect(normalizeBase(' //a//b/ ')).toBe('/a/b/')
    expect(normalizeBase('https://cdn.example/app')).toBe('https://cdn.example/app/')
    expect(() => normalizeBase('/a/../b')).toThrow()
  })

  it('the worker is registered at the base, with the base as its scope', () => {
    expect(swRegistration('/')).toEqual({ url: '/sw.js', scope: '/' })
    expect(swRegistration('/grapher/')).toEqual({ url: '/grapher/sw.js', scope: '/grapher/' })
    expect(swRegistration('/grapher')).toEqual({ url: '/grapher/sw.js', scope: '/grapher/' })
  })

  it('vite.config builds at GRAPHER_BASE and serves dev at /', () => {
    const cfg = read('vite.config.ts')
    expect(cfg).toMatch(/normalizeBase\(process\.env\.GRAPHER_BASE\)/)
    expect(cfg).toMatch(/command === 'build' \|\| isPreview \? .* : '\/'/)
  })

  it('index.html points at the manifest and icons by root paths Vite re-bases', () => {
    const html = read('index.html')
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
    expect(html).toContain('href="/icons/icon.svg"')
    expect(html).toContain('<meta name="theme-color" content="#0f1117" />')
  })
})

describe('the Pages workflow', () => {
  const wf = read('.github/workflows/deploy-pages.yml')
  const on = wf.slice(wf.indexOf('\non:'), wf.indexOf('\npermissions:'))

  it('runs only when started by hand', () => {
    expect(on).toMatch(/workflow_dispatch:/)
    for (const t of ['push', 'pull_request', 'schedule', 'release', 'workflow_run']) {
      expect(on, t).not.toMatch(new RegExp(`\\b${t}\\b`))
    }
  })

  it('builds for /grapher/ and tests first', () => {
    expect(wf).toMatch(/GRAPHER_BASE: \/grapher\//)
    expect(wf.indexOf('npm run test:run')).toBeLessThan(wf.indexOf('npm run build'))
  })
})

describe('the manifest', () => {
  const m = JSON.parse(read('public/manifest.webmanifest'))

  it('is an installable standalone app in the dark UI colours', () => {
    expect(m.name).toMatch(/Grapher/)
    expect(m.short_name).toBe('Grapher')
    expect(m.display).toBe('standalone')
    const bg = /--bg:\s*(#[0-9a-f]{6})/i.exec(read('src/ui/styles.css'))![1]
    expect(m.background_color.toLowerCase()).toBe(bg.toLowerCase())
    expect(m.theme_color.toLowerCase()).toBe(bg.toLowerCase())
  })

  it('every URL in it is relative, so it works under any base path', () => {
    for (const u of [m.start_url, m.scope, m.id, ...m.icons.map((i: { src: string }) => i.src)]) {
      expect(u.startsWith('/'), u).toBe(false)
      expect(/^[a-z]+:/i.test(u), u).toBe(false)
    }
    expect(m.start_url).toBe('./')
    expect(m.scope).toBe('./')
  })

  it('every icon exists, and each PNG is the size it claims', () => {
    for (const icon of m.icons as { src: string; sizes: string; type: string }[]) {
      const file = path.join(ROOT, 'public', icon.src)
      expect(fs.existsSync(file), icon.src).toBe(true)
      if (icon.type === 'image/png') {
        const buf = fs.readFileSync(file)
        const [w, h] = icon.sizes.split('x').map(Number)
        expect(buf.readUInt32BE(16)).toBe(w)
        expect(buf.readUInt32BE(20)).toBe(h)
      }
    }
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true)
    expect(m.icons.some((i: { sizes: string }) => i.sizes === '192x192')).toBe(true)
    expect(m.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true)
  })
})

describe('the build step', () => {
  it('precaches the page as ./ and every built file, minus the worker, maps and old font formats', () => {
    const files = [
      'index.html',
      'sw.js',
      'manifest.webmanifest',
      'assets/index-abc.js',
      'assets/index-abc.js.map',
      'assets/index-def.css',
      'assets/KaTeX_Main-Regular-x.woff2',
      'assets/KaTeX_Main-Regular-x.woff',
      'assets/KaTeX_Main-Regular-x.ttf',
      'icons/icon-192.png',
      '.DS_Store',
    ]
    expect(precacheEntries(files)).toEqual([
      './',
      'assets/KaTeX_Main-Regular-x.woff2',
      'assets/index-abc.js',
      'assets/index-def.css',
      'icons/icon-192.png',
      'manifest.webmanifest',
    ])
  })

  it('the cache version follows the bytes', () => {
    const a = [{ path: 'a.js', bytes: new Uint8Array([1, 2, 3]) }]
    const b = [{ path: 'a.js', bytes: new Uint8Array([1, 2, 4]) }]
    expect(cacheVersion(a)).toBe(cacheVersion([...a]))
    expect(cacheVersion(a)).not.toBe(cacheVersion(b))
    expect(cacheVersion(a)).toMatch(/^[0-9a-z]+$/)
  })

  it('fills the placeholders in the real sw.js', () => {
    const src = read('public/sw.js')
    expect(src).toContain(SW_VERSION_MARK)
    expect(src).toContain(SW_PRECACHE_MARK)
    const out = injectServiceWorker(src, 'v42', ['./', 'assets/a.js'])
    expect(out).toContain(`const VERSION = /*@version*/"v42"`)
    expect(out).toContain(`const PRECACHE = /*@precache*/["./","assets/a.js"]`)
    expect(() => injectServiceWorker('nothing here', 'v', [])).toThrow()
  })
})

// ---------------------------------------------------------------------------
// The worker, run in a fake ServiceWorkerGlobalScope
// ---------------------------------------------------------------------------

interface FakeResponse {
  ok: boolean
  type: string
  body: string
  /** The server answered with a Vary header (vite preview: `Vary: Origin`). */
  vary?: boolean
  clone(): FakeResponse
}
const resp = (body: string, ok = true, type = 'basic', vary = false): FakeResponse => ({
  ok,
  type,
  body,
  vary,
  clone() {
    return this
  },
})

class FakeRequest {
  url: string
  method: string
  mode: string
  constructor(input: string | FakeRequest, init: { method?: string; mode?: string } = {}) {
    this.url = typeof input === 'string' ? input : input.url
    this.method = init.method ?? 'GET'
    this.mode = init.mode ?? 'cors'
  }
}

function makeWorker(opts: { origin: string; base: string; precache: string[]; version?: string }) {
  const src = injectServiceWorker(read('public/sw.js'), opts.version ?? 'v1', opts.precache)
  const handlers: Record<string, (e: unknown) => void> = {}
  const stores = new Map<string, Map<string, FakeResponse>>()
  const keyOf = (r: string | FakeRequest): string => (typeof r === 'string' ? r : r.url)
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map())
      const s = stores.get(name)!
      return {
        async addAll(reqs: FakeRequest[]) {
          for (const r of reqs) {
            const res = await net(r)
            if (!res.ok) throw new Error('addAll failed')
            s.set(r.url, res)
          }
        },
        async put(r: string | FakeRequest, res: FakeResponse) {
          s.set(keyOf(r), res)
        },
        async match(r: string | FakeRequest, opts?: { ignoreVary?: boolean }) {
          const hit = s.get(keyOf(r))
          // Like a real cache: a response stored with `Vary: Origin` does not
          // match a request that differs in Origin unless ignoreVary is set.
          if (hit && hit.vary && !opts?.ignoreVary && typeof r !== 'string') return undefined
          return hit
        },
      }
    },
    async keys() {
      return [...stores.keys()]
    },
    async delete(name: string) {
      return stores.delete(name)
    },
  }
  let online = true
  let hang = false
  const served: string[] = []
  const net = async (r: string | FakeRequest): Promise<FakeResponse> => {
    const url = keyOf(r)
    if (!online) throw new TypeError('Failed to fetch')
    if (hang) return new Promise(() => {})
    served.push(url)
    return resp(`net:${url}`, true, 'basic', url.includes('/assets/'))
  }
  const swUrl = `${opts.origin}${opts.base}sw.js`
  const self = {
    location: { href: swUrl },
    registration: { scope: `${opts.origin}${opts.base}` },
    addEventListener(type: string, fn: (e: unknown) => void) {
      handlers[type] = fn
    },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('self', 'caches', 'fetch', 'Request', src)(self, caches, net, FakeRequest)

  const lifecycle = async (type: 'install' | 'activate'): Promise<void> => {
    let p: Promise<unknown> = Promise.resolve()
    handlers[type]({ waitUntil: (x: Promise<unknown>) => (p = x) })
    await p
  }
  const fetchEvent = async (url: string, init: { method?: string; mode?: string } = {}) => {
    let res: Promise<FakeResponse> | null = null
    handlers.fetch({ request: new FakeRequest(url, init), respondWith: (x: Promise<FakeResponse>) => (res = x) })
    return res === null ? 'bypass' : await res
  }
  return {
    stores,
    served,
    lifecycle,
    fetchEvent,
    setOnline: (v: boolean) => (online = v),
    setHang: (v: boolean) => (hang = v),
  }
}

describe('the service worker', () => {
  const O = 'https://gokhankelebek.github.io'

  it('installs: precaches every entry, resolved against its own base', async () => {
    const w = makeWorker({ origin: O, base: '/grapher/', precache: ['./', 'assets/a.js', 'manifest.webmanifest'] })
    await w.lifecycle('install')
    expect([...w.stores.get('grapher-v1')!.keys()]).toEqual([
      `${O}/grapher/`,
      `${O}/grapher/assets/a.js`,
      `${O}/grapher/manifest.webmanifest`,
    ])
  })

  it('activates: deletes older Grapher caches and nobody else’s', async () => {
    const w = makeWorker({ origin: O, base: '/grapher/', precache: [], version: 'v2' })
    w.stores.set('grapher-v1', new Map())
    w.stores.set('someone-else', new Map())
    await w.lifecycle('install')
    await w.lifecycle('activate')
    expect([...w.stores.keys()].sort()).toEqual(['grapher-v2', 'someone-else'])
  })

  it('routes: the page network-first, assets cache-first, everything else untouched', async () => {
    const w = makeWorker({ origin: O, base: '/grapher/', precache: ['./', 'assets/a.js'] })
    await w.lifecycle('install')
    w.served.length = 0
    // asset: from the cache, no network
    expect(((await w.fetchEvent(`${O}/grapher/assets/a.js`)) as FakeResponse).body).toBe(`net:${O}/grapher/assets/a.js`)
    expect(w.served).toEqual([])
    // the page: network first
    await w.fetchEvent(`${O}/grapher/?x=1`, { mode: 'navigate' })
    expect(w.served).toEqual([`${O}/grapher/?x=1`])
    // not ours
    expect(await w.fetchEvent('https://cdn.jsdelivr.net/x.js')).toBe('bypass')
    expect(await w.fetchEvent(`${O}/other-repo/app.js`)).toBe('bypass')
    expect(await w.fetchEvent(`${O}/grapher/api`, { method: 'POST' })).toBe('bypass')
    expect(await w.fetchEvent(`${O}/grapher/sw.js`)).toBe('bypass')
  })

  it('works offline after the first load', async () => {
    const w = makeWorker({ origin: O, base: '/grapher/', precache: ['./', 'assets/a.js', 'assets/b.css'] })
    await w.lifecycle('install')
    await w.lifecycle('activate')
    w.setOnline(false)
    const page = (await w.fetchEvent(`${O}/grapher/`, { mode: 'navigate' })) as FakeResponse
    expect(page.body).toBe(`net:${O}/grapher/`)
    // a navigation with a query string still gets the cached page
    const page2 = (await w.fetchEvent(`${O}/grapher/index.html?utm=x`, { mode: 'navigate' })) as FakeResponse
    expect(page2.body).toBe(`net:${O}/grapher/`)
    const css = (await w.fetchEvent(`${O}/grapher/assets/b.css`)) as FakeResponse
    expect(css.body).toBe(`net:${O}/grapher/assets/b.css`)
  })

  it('a connection that hangs rather than fails still gets the cached page (after a few seconds)', async () => {
    const w = makeWorker({ origin: O, base: '/grapher/', precache: ['./'] })
    await w.lifecycle('install')
    w.setHang(true)
    const t0 = Date.now()
    const page = (await w.fetchEvent(`${O}/grapher/`, { mode: 'navigate' })) as FakeResponse
    expect(page.body).toBe(`net:${O}/grapher/`)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(3900)
  }, 10_000)

  it('a fresh page from the network replaces the cached one (a new deploy is picked up)', async () => {
    const w = makeWorker({ origin: O, base: '/', precache: ['./'] })
    await w.lifecycle('install')
    await w.fetchEvent(`${O}/?v=2`, { mode: 'navigate' })
    expect(w.stores.get('grapher-v1')!.get(`${O}/`)!.body).toBe(`net:${O}/?v=2`)
  })

  it('an asset fetched for the first time is cached on the way through', async () => {
    const w = makeWorker({ origin: O, base: '/', precache: [] })
    await w.lifecycle('install')
    await w.fetchEvent(`${O}/assets/KaTeX_Main-Regular.ttf`)
    w.setOnline(false)
    const again = (await w.fetchEvent(`${O}/assets/KaTeX_Main-Regular.ttf`)) as FakeResponse
    expect(again.body).toBe(`net:${O}/assets/KaTeX_Main-Regular.ttf`)
  })

  it('at the root base too', async () => {
    const w = makeWorker({ origin: 'http://localhost:4173', base: '/', precache: ['./', 'assets/a.js'] })
    await w.lifecycle('install')
    expect([...w.stores.get('grapher-v1')!.keys()]).toEqual(['http://localhost:4173/', 'http://localhost:4173/assets/a.js'])
  })
})
