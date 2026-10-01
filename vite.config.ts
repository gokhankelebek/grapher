import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { cacheVersion, injectServiceWorker, normalizeBase, precacheEntries } from './src/pwa/build'

/**
 * After the bundle is written, fill dist/sw.js in with this build's file list
 * and a version derived from those files' bytes — so every deploy gets a fresh
 * cache and the previous one is deleted (see public/sw.js).
 */
function serviceWorkerPrecache(): Plugin {
  let outDir = 'dist'
  return {
    name: 'grapher-sw-precache',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const swPath = path.join(outDir, 'sw.js')
      if (!fs.existsSync(swPath)) return
      const files: string[] = []
      const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name)
          if (e.isDirectory()) walk(full)
          else files.push(path.relative(outDir, full).split(path.sep).join('/'))
        }
      }
      walk(outDir)
      const precache = precacheEntries(files)
      const version = cacheVersion(
        files
          .filter((f) => f !== 'sw.js')
          .map((f) => ({ path: f, bytes: new Uint8Array(fs.readFileSync(path.join(outDir, f))) })),
      )
      fs.writeFileSync(swPath, injectServiceWorker(fs.readFileSync(swPath, 'utf8'), version, precache))
    },
  }
}

// Dev always serves at '/'. A production build (and `vite preview` of one)
// reads GRAPHER_BASE, default '/'; the GitHub Pages workflow sets '/grapher/'.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? normalizeBase(process.env.GRAPHER_BASE) : '/',
  plugins: [react(), serviceWorkerPrecache()],
}))
