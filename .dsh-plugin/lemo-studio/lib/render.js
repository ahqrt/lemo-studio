/**
 * Deterministic jobs: stills, contact sheet, video, mux, readcheck.
 *
 * All of them run the library's own tools from `$LIB`, with the film folder as
 * an absolute path (the library mounts folders outside its root at /@film/).
 * The studio never re-implements rendering.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const NODE = process.env.LEMO_NODE || 'node'
const PYTHON = 'python'
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const MAX_LINES = 600

/** @type {Map<string, any>} */
export const jobs = new Map()

function trimOldJobs() {
  const now = Date.now()
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && now - (job.endedAt || now) > 30 * 60_000) jobs.delete(id)
  }
  if (jobs.size > 40) {
    const done = [...jobs.values()].filter((j) => j.status !== 'running').sort((a, b) => a.startedAt - b.startedAt)
    for (const job of done.slice(0, jobs.size - 40)) jobs.delete(job.id)
  }
}

export function jobView(job) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    lines: job.lines.slice(-120),
    startedAt: job.startedAt,
    endedAt: job.endedAt || 0,
    result: job.result || null,
    error: job.error || '',
    meta: job.meta || {},
  }
}

function pushLine(job, line) {
  const text = String(line).replace(/\r/g, '')
  job.lines.push(text)
  if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES)
  job.lastLine = text
}

/**
 * Run one command as a studio job. The caller polls `jobView` for logs.
 * `onDone` receives (job, code); throwing there marks the job failed.
 */
export function startJob({ kind, film, command, args, cwd, env, meta = {}, onDone }) {
  trimOldJobs()
  const id = randomUUID()
  const job = {
    id,
    kind,
    filmId: film?.id || '',
    status: 'running',
    lines: [],
    startedAt: Date.now(),
    command: [command, ...args].join(' '),
    meta,
  }
  jobs.set(id, job)

  const child = spawn(command, args, {
    cwd: cwd || process.cwd(),
    env: { ...process.env, ...(env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  job.pid = child.pid

  const feed = (chunk) => {
    const text = String(chunk)
    for (const line of text.split('\n')) if (line.trim()) pushLine(job, line.trimEnd())
  }
  child.stdout.on('data', feed)
  child.stderr.on('data', feed)
  child.on('error', (error) => {
    pushLine(job, `[无法启动] ${error.message}`)
    job.status = 'error'
    job.error = error.message
    job.endedAt = Date.now()
  })
  child.on('close', async (code) => {
    if (job.status === 'error') return
    job.exitCode = code
    if (code !== 0) {
      job.status = 'error'
      job.error = (job.lastLine || `退出码 ${code}`).slice(0, 400)
      job.endedAt = Date.now()
      return
    }
    try {
      const result = onDone ? await onDone(job) : null
      job.result = result ?? null
      job.status = 'done'
    } catch (error) {
      job.status = 'error'
      job.error = String(error?.message || error).slice(0, 400)
    }
    job.endedAt = Date.now()
  })
  return job
}

export function cancelJob(id) {
  const job = jobs.get(id)
  if (!job || job.status !== 'running' || !job.pid) return false
  try {
    process.kill(job.pid, 'SIGTERM')
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */

async function listImages(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const rows = []
  for (const entry of entries) {
    if (!entry.isFile() || !IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) continue
    const info = await stat(path.join(dir, entry.name)).catch(() => null)
    rows.push({ name: entry.name, size: info?.size || 0, at: info?.mtimeMs || 0 })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
}

export function stillTime(name) {
  const hit = /([0-9]+(?:\.[0-9]+)?)\.jpe?g$/i.exec(name)
  return hit ? Number(hit[1]) : 0
}

/** Three look frames at the project's review times, into <film>/stills. */
export function renderStills(film, { times, prefix = 'look_' } = {}) {
  const list = Array.isArray(times) && times.length ? times.slice(0, 8) : film.lookTimes || [1.5]
  const args = ['core/render/still.mjs', film.dir, ...list.map(String), '--out', path.join(film.dir, 'stills'), '--prefix', prefix]
  return startJob({
    kind: 'stills',
    film,
    command: NODE,
    args,
    cwd: film.lib,
    meta: { times: list, prefix },
    onDone: async () => {
      const files = (await listImages(path.join(film.dir, 'stills'))).filter((row) => row.name.startsWith(prefix))
      return {
        files: files.map((row) => ({ name: row.name, t: stillTime(row.name), size: row.size })),
      }
    },
  })
}

/** Real contact-sheet job (needs the image list first). */
export async function startSheet(film, { cols = 3, width = 640 } = {}) {
  const images = await listImages(path.join(film.dir, 'stills'))
  const board = images.filter((row) => /^(sb|board|story)[_-]/i.test(row.name))
  const look = images.filter((row) => /^look[_-]/i.test(row.name))
  const picked = board.length ? board : look.length ? look : images
  if (!picked.length) throw new Error('还没有抽帧，先抽 3 张风格帧')
  const out = path.join(film.dir, 'CONTACT.jpg')
  const ordered = picked.slice(0, 9).map((row) => path.join(film.dir, 'stills', row.name))
  return startJob({
    kind: 'sheet',
    film,
    command: path.join(film.lib, '.venv', 'bin', 'python'),
    args: [path.join(film.lib, 'core', 'render', 'sheet.py'), out, ...ordered, '--cols', String(cols), '--w', String(width)],
    cwd: film.lib,
    onDone: async () => {
      const info = await stat(out).catch(() => null)
      return info ? { file: out, size: info.size } : null
    },
  })
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

async function probe(file) {
  return new Promise((resolve) => {
    const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let out = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.on('close', () => resolve(Number(String(out).trim()) || 0))
    child.on('error', () => resolve(0))
  })
}

/**
 * Render the film: 720p draft or 1080p final. If `out/mix.wav` exists the tool
 * muxes and measures loudness; otherwise the picture is kept as-is and the UI
 * says there is no audio.
 */
export function renderVideo(film, { quality = 'draft' } = {}) {
  const draft = quality !== 'final'
  const size = draft ? '1280x720' : '1920x1080'
  const workers = process.env.LEMO_RENDER_WORKERS || (draft ? '3' : '3')
  const fps = String(film.fps || 24)
  const name = `${draft ? 'draft' : 'final'}-${stamp()}.mp4`
  const picture = path.join(film.dir, 'out', name)
  return startJob({
    kind: 'video',
    film,
    command: NODE,
    args: ['core/render/video.mjs', film.dir, '--fps', fps, '--workers', workers, '--size', size, '--out', picture],
    cwd: film.lib,
    meta: { quality, size, name },
    onDone: async (job) => {
      const info = await stat(picture).catch(() => null)
      if (!info) throw new Error('渲染结束但没有找到视频文件')
      const duration = await probe(picture)
      const mix = path.join(film.dir, 'out', 'mix.wav')
      const base = { file: name, size: info.size, duration: duration || film.brief.duration, at: new Date().toISOString(), quality }
      job.meta.progress = 1
      if (!existsSync(mix)) {
        job.meta.muxed = false
        await writeFile(path.join(film.dir, 'out', `${name}.json`), JSON.stringify({ ...base, quality, loudness: '' })).catch(() => {})
        return base
      }
      // mux with the library's mastering script: −14 LUFS, true peak −1.2 dB
      const finalName = `${draft ? 'draft' : 'final'}-${stamp()}-master.mp4`
      const finalPath = path.join(film.dir, 'out', finalName)
      const muxed = await new Promise((resolve, reject) => {
        const child = spawn('sh', [path.join(film.lib, 'core', 'render', 'mux.sh'), picture, mix, finalPath, fps, '2'], {
          cwd: film.lib,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let log = ''
        child.stdout.on('data', (chunk) => {
          log += chunk
          pushLine(job, String(chunk).trim())
        })
        child.stderr.on('data', (chunk) => {
          log += chunk
          pushLine(job, String(chunk).trim())
        })
        child.on('error', reject)
        child.on('close', (code) => (code === 0 ? resolve(log) : reject(new Error(log.split('\n').filter(Boolean).pop() || 'mux 失败'))))
      })
      const loud = /I:\s*(-?[0-9.]+)\s*LUFS/i.exec(muxed) || /(-[0-9.]+)\s*LUFS/.exec(muxed)
      const finalInfo = await stat(finalPath).catch(() => null)
      await unlink(picture).catch(() => {})
      job.meta.muxed = true
      const result = {
        ...base,
        file: finalName,
        size: finalInfo?.size || info.size,
        loudness: loud ? `${loud[1]} LUFS` : '',
        mastered: true,
      }
      await writeFile(path.join(film.dir, 'out', `${finalName}.json`), JSON.stringify(result)).catch(() => {})
      return result
    },
  })
}

/** Reading-time check of the film's on-screen text (the page must expose TEXTS). */
export function readcheck(film) {
  return startJob({
    kind: 'readcheck',
    film,
    command: NODE,
    args: ['core/render/readcheck.mjs', film.dir],
    cwd: film.lib,
    onDone: async (job) => {
      const rows = job.lines.filter((line) => /^(OK|BAD)\s/.test(line))
      return { checked: rows.length, bad: rows.filter((line) => line.startsWith('BAD')).length, rows: rows.slice(-40) }
    },
  })
}

/** Open the film folder in Finder. */
export function reveal(film) {
  return new Promise((resolve) => {
    const child = spawn('open', [film.dir], { stdio: 'ignore', detached: true })
    child.on('error', () => resolve(false))
    child.on('spawn', () => resolve(true))
  })
}
