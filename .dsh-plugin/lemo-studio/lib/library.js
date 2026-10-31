/**
 * Lemo-Opuscar library access for the studio host.
 *
 * Everything here is read-only: the library (`~/lemo-opuscar`) is the source of
 * truth for styles, tools and the director method. The studio never edits it.
 */
import { existsSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const POSTER_DIR = path.join(PLUGIN_ROOT, 'assets', 'posters')

export const LEMO_HOME = path.resolve(process.env.LEMO_OPUSCAR_HOME || path.join(os.homedir(), 'lemo-opuscar'))

export function libraryStatus(lib = LEMO_HOME) {
  const checks = {
    agents: existsSync(path.join(lib, 'AGENTS.md')),
    director: existsSync(path.join(lib, 'DIRECTOR.md')),
    technique: existsSync(path.join(lib, 'TECHNIQUE.md')),
    still: existsSync(path.join(lib, 'core', 'render', 'still.mjs')),
    video: existsSync(path.join(lib, 'core', 'render', 'video.mjs')),
    mux: existsSync(path.join(lib, 'core', 'render', 'mux.sh')),
    python: existsSync(path.join(lib, '.venv', 'bin', 'python')),
    styles: existsSync(path.join(lib, 'styles')),
  }
  const ready = checks.agents && checks.still && checks.video && checks.styles
  return {
    ready,
    lib,
    checks,
    why: ready
      ? ''
      : `没找到 ${lib}/core/render 或 AGENTS.md —— 先跑一次 lemo-opuscar 技能，或 sh "${PLUGIN_ROOT}/../.." 里的 setup 脚本`,
  }
}

let styleCache = null
let styleCacheAt = 0

/** Every library style, ordered by gallery number, with the poster the studio ships. */
export async function listStyles(lib = LEMO_HOME, { fresh = false } = {}) {
  if (!fresh && styleCache && Date.now() - styleCacheAt < 30_000) return styleCache
  const root = path.join(lib, 'styles')
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const rows = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue
    const metaRaw = await readFile(path.join(root, entry.name, 'style.json'), 'utf8').catch(() => null)
    if (!metaRaw) continue
    let meta
    try {
      meta = JSON.parse(metaRaw)
    } catch {
      continue
    }
    const poster = existsSync(path.join(POSTER_DIR, `${entry.name}.jpg`))
      ? `${entry.name}.jpg`
      : existsSync(path.join(root, entry.name, 'poster.jpg'))
        ? `library:${entry.name}`
        : ''
    rows.push({
      slug: entry.name,
      num: String(meta.num || ''),
      en: meta.en || entry.name,
      cn: meta.cn || '',
      categoryEn: meta.category_en || '',
      categoryCn: meta.category_cn || meta.category_en || '其他',
      film: meta.film || '',
      line: meta.line || '',
      lineCn: meta.line_cn || '',
      uses: Array.isArray(meta.uses) ? meta.uses : [],
      dur: Number(meta.dur) || 0,
      poster,
      posterUrl: poster ? `/lemo-studio/api/poster/${entry.name}` : '',
    })
  }
  rows.sort((a, b) => String(a.num).localeCompare(String(b.num), 'en', { numeric: true }))
  styleCache = rows
  styleCacheAt = Date.now()
  return rows
}

export async function styleDoc(slug, lib = LEMO_HOME) {
  if (!/^[a-z0-9-]+$/.test(String(slug || ''))) return null
  const dir = path.join(lib, 'styles', slug)
  const doc = await readFile(path.join(dir, 'STYLE.md'), 'utf8').catch(() => null)
  if (!doc) return null
  const meta = await readFile(path.join(dir, 'style.json'), 'utf8').catch(() => null)
  let parsed = null
  try {
    parsed = meta ? JSON.parse(meta) : null
  } catch {
    parsed = null
  }
  return {
    slug,
    doc,
    meta: parsed,
    poster: existsSync(path.join(POSTER_DIR, `${slug}.jpg`)) ? path.join(POSTER_DIR, `${slug}.jpg`) : path.join(dir, 'poster.jpg'),
  }
}

/** A local poster path for a slug, or null. */
export function posterPath(slug, lib = LEMO_HOME) {
  if (!/^[a-z0-9-]+$/.test(String(slug || ''))) return null
  const shipped = path.join(POSTER_DIR, `${slug}.jpg`)
  if (existsSync(shipped)) return shipped
  const library = path.join(lib, 'styles', slug, 'poster.jpg')
  return existsSync(library) ? library : null
}

/* ------------------------------------------------------------------ */
/* palette: the scaffold only needs the style's own key colours        */
/* ------------------------------------------------------------------ */

const hexLum = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const hexSat = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h, s, l]
}

function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    const v = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
    return Math.round(v * 255)
  }
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')
}

/**
 * Lightest / darkest / most saturated of the hexes a STYLE.md mentions.
 * The skeleton only uses this to stay in the style's key; the real drawing
 * code is the agent's job.
 */
export function paletteOf(doc = '') {
  const hexes = [...new Set((String(doc).match(/#[0-9a-fA-F]{6}\b/g) || []).map((h) => h.toLowerCase()))]
  if (!hexes.length) return { bg: '#f1e9da', ink: '#22242e', accent: '#c8442a', paper: true }
  const byLum = [...hexes].sort((a, b) => hexLum(b) - hexLum(a))
  const light = byLum[0]
  const dark = byLum[byLum.length - 1]
  const paper = hexLum(light) > 0.62
  const bg = paper ? light : hexLum(dark) < 0.3 ? light : dark
  const [ih, is, il] = hexToHsl(dark)
  const ink = paper
    ? is > 0.42
      ? hslToHex(ih, Math.min(is, 0.28), Math.max(0.12, Math.min(il, 0.2)))
      : dark
    : is > 0.42
      ? hslToHex(ih, Math.min(is, 0.3), Math.max(0.82, il))
      : light
  const accentPool = hexes.filter((h) => h !== bg && h !== ink)
  const accent =
    [...accentPool].sort(
      (a, b) => hexSat(b) * (1 - Math.abs(hexLum(b) - 0.5)) - hexSat(a) * (1 - Math.abs(hexLum(a) - 0.5)),
    )[0] || '#c8442a'
  return { bg, ink, accent: hexSat(accent) > 0.15 ? accent : '#c8442a', paper }
}

export async function libraryInfo(lib = LEMO_HOME) {
  const styles = await listStyles(lib)
  let head = ''
  try {
    head = (await readFile(path.join(lib, '.git', 'HEAD'), 'utf8')).trim()
    if (head.startsWith('ref: ')) {
      head = (await readFile(path.join(lib, '.git', head.slice(5)), 'utf8')).trim().slice(0, 7)
    } else {
      head = head.slice(0, 7)
    }
  } catch {
    head = ''
  }
  return {
    lib,
    commit: head,
    styles: styles.length,
    categories: [...new Set(styles.map((s) => s.categoryCn))],
    node: process.version,
  }
}
