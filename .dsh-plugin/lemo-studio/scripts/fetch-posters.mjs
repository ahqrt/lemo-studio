#!/usr/bin/env node
/**
 * Fetch the 66 style posters from the public Lemo-Opuscar gallery into
 * the plugin's assets (and the design drafts' assets).
 *
 * The posters are Lemo's own film stills, so they are not committed to this
 * repository. Run this once after cloning:
 *
 *   node scripts/fetch-posters.mjs [--force]
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const plugin = resolve(here, '..')
const workspace = resolve(plugin, '..', '..')
const design = join(workspace, 'design', 'assets', 'posters')
const out = join(plugin, 'assets', 'posters')
const force = process.argv.includes('--force')
const gallery = 'https://lemomo-ai.github.io/lemo-opuscar/img'

async function listSlugs() {
  const lib = process.env.LEMO_OPUSCAR_HOME || join(os.homedir(), 'lemo-opuscar')
  try {
    const dirs = await readdir(join(lib, 'styles'), { withFileTypes: true })
    const slugs = []
    for (const dir of dirs) {
      if (!dir.isDirectory() || dir.name.startsWith('_')) continue
      try {
        await readFile(join(lib, 'styles', dir.name, 'style.json'))
        slugs.push(dir.name)
      } catch {
        /* not a style */
      }
    }
    if (slugs.length) return slugs
  } catch {
    /* fall through to the committed metadata */
  }
  const meta = await readFile(join(workspace, 'design', 'assets', 'styles.json'), 'utf8')
  return JSON.parse(meta).map((row) => row.slug)
}

async function exists(file) {
  return stat(file).then((info) => info.isFile()).catch(() => false)
}

async function get(slug, dir) {
  const file = join(dir, `${slug}.jpg`)
  if (!force && (await exists(file))) return 'skip'
  const response = await fetch(`${gallery}/${slug}_0.jpg`)
  if (!response.ok || !response.body) throw new Error(`${slug}: HTTP ${response.status}`)
  await mkdir(dir, { recursive: true })
  await new Promise((resolve, reject) => {
    const stream = createWriteStream(file)
    response.body.pipeTo(new WritableStream({
      write(chunk) { stream.write(chunk) },
      close() { stream.end(resolve) },
      abort(error) { stream.destroy(error); reject(error) },
    })).catch(reject)
  })
  return 'ok'
}

const slugs = await listSlugs()
let ok = 0
let skipped = 0
let failed = 0
const queue = [...slugs]
async function worker() {
  while (queue.length) {
    const slug = queue.shift()
    try {
      for (const dir of [out, design]) {
        const result = await get(slug, dir)
        if (result === 'ok') ok++
        else skipped++
      }
    } catch (error) {
      failed++
      console.error(`  ✗ ${slug}: ${error.message}`)
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker))
console.log(`posters: ${ok} downloaded, ${skipped} already there, ${failed} failed · ${out}`)
if (failed) process.exitCode = 1
