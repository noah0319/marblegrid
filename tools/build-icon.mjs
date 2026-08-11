// One-shot (re-runnable) icon build: takes the master source image at
// build/icon.png and produces build/icon.ico — a proper multi-resolution
// Windows icon (png-to-ico auto-generates the standard size set from one
// high-res source). Not part of the shipped app; run this by hand whenever
// build/icon.png changes, then re-run `npm run build` / relaunch.
//
// Usage: node tools/build-icon.mjs
import pngToIco from 'png-to-ico'
import { writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(APP_DIR, 'build', 'icon.png')
const OUT = path.join(APP_DIR, 'build', 'icon.ico')

if (!existsSync(SRC)) {
  console.error(`FAILED: no source image at ${SRC}`)
  process.exit(1)
}

const buf = await pngToIco(SRC)
writeFileSync(OUT, buf)
console.log(`wrote ${OUT} (${buf.length} bytes)`)
