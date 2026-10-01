// ============================================================================
// Offline install — the pure half: base paths, the precache list, and the
// build step that writes both into the hand-written service worker.
//
// Used from two places:
//   vite.config.ts   normalizeBase (the `base` option) and injectServiceWorker
//                    (rewrites dist/sw.js after the bundle is written)
//   src/pwa/register.ts  swRegistration (where to register, and with what scope)
//
// BASE PATHS. Dev always serves at '/'. A production build reads GRAPHER_BASE
// (default '/'), so the GitHub Pages workflow can build for '/grapher/'. The
// service worker and the manifest never spell the base out: every URL they
// hold is RELATIVE ('./', 'assets/…', 'icons/…'), resolved against the file
// that holds it, so one build works wherever it is served from as long as
// index.html, sw.js and manifest.webmanifest sit side by side.
// ============================================================================

/** '/', '/grapher/', 'https://cdn.example/app/' — always ending in '/'. */
export function normalizeBase(raw: string | undefined | null): string {
  const s = (raw ?? '').trim()
  if (s === '' || s === '/' || s === '.' || s === './') return '/'
  if (/^https?:\/\//i.test(s)) return s.endsWith('/') ? s : s + '/'
  if (s.split('/').includes('..')) throw new Error(`GRAPHER_BASE must not climb out of the site: "${s}"`)
  const parts = s.split('/').filter((p) => p !== '' && p !== '.')
  return parts.length === 0 ? '/' : `/${parts.join('/')}/`
}

/** Where the service worker is registered from, and what it controls. */
export function swRegistration(base: string): { url: string; scope: string } {
  const b = base.endsWith('/') ? base : base + '/'
  return { url: `${b}sw.js`, scope: b }
}

/**
 * The files the worker downloads at install, so the app opens offline after
 * the very first visit. URLs are relative to sw.js. index.html is listed as
 * './' because that is the URL a navigation actually asks for.
 *
 * Left out: the worker itself, source maps, and KaTeX's .woff/.ttf fallbacks —
 * every browser that can run a service worker reads the .woff2, and the old
 * formats would triple the download. (If one is ever asked for, the fetch
 * handler still caches it on the way through.)
 */
export function precacheEntries(files: readonly string[]): string[] {
  const out = new Set<string>()
  for (const raw of files) {
    const f = raw.replace(/\\/g, '/').replace(/^\.?\//, '')
    if (!f || f === 'sw.js' || f.endsWith('.map') || f.endsWith('.DS_Store')) continue
    if (/\.(woff|ttf)$/i.test(f)) continue
    if (f === 'index.html') {
      out.add('./')
      continue
    }
    out.add(f)
  }
  return [...out].sort((a, b) => (a === './' ? -1 : b === './' ? 1 : a < b ? -1 : a > b ? 1 : 0))
}

/** FNV-1a over every precached file's name and bytes: the cache version. */
export function cacheVersion(files: readonly { path: string; bytes: Uint8Array }[]): string {
  let h = 0x811c9dc5
  const mix = (b: number): void => {
    h ^= b
    h = Math.imul(h, 0x01000193) >>> 0
  }
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    for (let i = 0; i < f.path.length; i++) mix(f.path.charCodeAt(i) & 0xff)
    mix(0)
    for (const b of f.bytes) mix(b)
    mix(0)
  }
  return h.toString(36)
}

/** The placeholders in public/sw.js that the build fills in. */
export const SW_VERSION_MARK = "/*@version*/'dev'"
export const SW_PRECACHE_MARK = '/*@precache*/[]'

/** Write the version and precache list into the worker's source. */
export function injectServiceWorker(source: string, version: string, precache: readonly string[]): string {
  if (!source.includes(SW_VERSION_MARK) || !source.includes(SW_PRECACHE_MARK)) {
    throw new Error('sw.js is missing its build placeholders')
  }
  return source
    .replace(SW_VERSION_MARK, `/*@version*/${JSON.stringify(version)}`)
    .replace(SW_PRECACHE_MARK, `/*@precache*/${JSON.stringify(precache)}`)
}
