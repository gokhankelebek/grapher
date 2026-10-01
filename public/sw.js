/* ============================================================================
 * Grapher — service worker (hand-written; the build only fills in two values).
 *
 * Goal: after the first visit, the app opens with no network at all — a
 * classroom Chromebook on bad Wi-Fi, an iPad on a bus.
 *
 *   install   download everything in PRECACHE into a cache named for this
 *             build (VERSION), then take over at once
 *   activate  delete every older Grapher cache
 *   fetch     the page itself (a navigation, './', 'index.html'):
 *               NETWORK-FIRST — a new deploy is picked up as soon as there is
 *               a connection; offline (or after NAV_TIMEOUT_MS of nothing) the
 *               cached copy is served
 *             everything else under this worker's scope:
 *               CACHE-FIRST — built assets have content hashes in their names,
 *               so a cached copy is never stale
 *             other origins, other paths, non-GET: not touched
 *
 * Every URL here is relative to this file (see src/pwa/build.ts), so the same
 * worker serves a build at '/' or at '/grapher/'.
 *
 * The share-link fragment (#doc=…) is never part of a request, so it never
 * passes through here.
 * ========================================================================== */

const VERSION = /*@version*/'dev'
const PRECACHE = /*@precache*/[]
const PREFIX = 'grapher-'
const CACHE = PREFIX + VERSION
const NAV_TIMEOUT_MS = 4000
/**
 * Built assets have content hashes in their names, so a cached copy is right
 * whatever the request's headers. Without this a server that answers
 * `Vary: Origin` (vite preview does) makes every font miss: the precache
 * stored them without an Origin header and a CSS font request sends one.
 */
const MATCH = { ignoreVary: true }

/** Absolute URL of the cached page: the scope root. */
function pageKey() {
  return new URL('./', self.location.href).href
}

function strategyFor(request) {
  if (request.method !== 'GET') return 'bypass'
  let url
  try {
    url = new URL(request.url)
  } catch (e) {
    return 'bypass'
  }
  const scope = new URL(self.registration ? self.registration.scope : './', self.location.href)
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return 'bypass'
  if (url.pathname === scope.pathname + 'sw.js') return 'bypass'
  if (
    request.mode === 'navigate' ||
    url.pathname === scope.pathname ||
    url.pathname === scope.pathname + 'index.html'
  ) {
    return 'network-first'
  }
  return 'cache-first'
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // 'reload' skips the HTTP cache, so the precache is this build's bytes.
      await cache.addAll(PRECACHE.map((u) => new Request(new URL(u, self.location.href).href, { cache: 'reload' })))
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

async function networkFirst(request) {
  const cache = await caches.open(CACHE)
  const fromNetwork = fetch(request).then(async (res) => {
    if (res && res.ok && res.type !== 'opaque') await cache.put(pageKey(), res.clone())
    return res
  })
  fromNetwork.catch(() => {}) // a lost race must not become an unhandled rejection
  const cached = await cache.match(pageKey(), MATCH)
  if (!cached) return fromNetwork
  // Race the network against a timer: on a connection that hangs rather than
  // fails, the cached page wins and the network copy still refreshes the cache.
  let timer
  const slow = new Promise((resolve) => {
    timer = setTimeout(() => resolve(cached), NAV_TIMEOUT_MS)
  })
  try {
    return await Promise.race([fromNetwork, slow])
  } catch (e) {
    return cached
  } finally {
    clearTimeout(timer)
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request, MATCH)
  if (hit) return hit
  const res = await fetch(request)
  if (res && res.ok && res.type === 'basic') await cache.put(request, res.clone())
  return res
}

self.addEventListener('fetch', (event) => {
  const strategy = strategyFor(event.request)
  if (strategy === 'bypass') return
  event.respondWith(strategy === 'network-first' ? networkFirst(event.request) : cacheFirst(event.request))
})
