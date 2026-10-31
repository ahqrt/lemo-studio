/**
 * dsh-lemo-studio — host half.
 *
 * The video workshop, rebuilt around Lemo-Opuscar only: 66 library styles, a
 * film folder the agent works in, deterministic stills/sheets/renders, and one
 * director session per film. No HyperFrames, no novel pipeline, no templates.
 */
import { createReadStream } from 'node:fs'
import { existsSync } from 'node:fs'
import { stat, readFile, writeFile, mkdir, unlink, readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  LEMO_HOME,
  libraryInfo,
  libraryStatus,
  listStyles,
  posterPath,
  styleDoc,
} from './lib/library.js'
import {
  createFilm,
  filmDir,
  filmView,
  listFilms,
  readFilm,
  saveFilm,
} from './lib/project.js'
import {
  cancelJob,
  jobView,
  jobs,
  readcheck,
  renderStills,
  renderVideo,
  reveal,
  startSheet,
} from './lib/render.js'
import { actionLabel, buildPrompt } from './lib/agent.js'

export const inject = ['webServer', 'sessionController', 'sessions']

const PREFIX = '/lemo-studio'
const PLUGIN_ROOT = path.dirname(fileURLToPath(import.meta.url))
const MAX_BODY = 2 * 1024 * 1024

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.srt': 'text/plain; charset=utf-8',
}

const chatCache = new Map()

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readBody(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function within(root, target) {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function cleanRel(value) {
  const raw = String(value || '').trim()
  if (!raw || raw.includes('\0') || path.isAbsolute(raw)) return null
  const normalized = path.normalize(raw).replace(/^([./\\])+/, '')
  if (!normalized || normalized.startsWith('..')) return null
  return normalized
}

async function serveFile(res, abs, { cache = 'no-cache' } = {}) {
  const info = await stat(abs).catch(() => null)
  if (!info?.isFile()) return sendJson(res, 404, { ok: false, error: '文件不存在' })
  const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, {
    'content-type': type,
    'content-length': info.size,
    'accept-ranges': 'bytes',
    'cache-control': cache,
  })
  createReadStream(abs).pipe(res)
}

async function serveRange(req, res, abs) {
  const info = await stat(abs).catch(() => null)
  if (!info?.isFile()) return sendJson(res, 404, { ok: false, error: '文件不存在' })
  const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream'
  const range = req.headers.range
  if (range && /^bytes=/.test(range)) {
    const [startText, endText] = range.replace(/^bytes=/, '').split('-')
    let start = Number(startText) || 0
    let end = endText ? Number(endText) : info.size - 1
    if (start >= info.size) {
      res.writeHead(416, { 'content-range': `bytes */${info.size}` })
      return res.end()
    }
    end = Math.min(end, info.size - 1)
    res.writeHead(206, {
      'content-type': type,
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${info.size}`,
      'accept-ranges': 'bytes',
      'cache-control': 'no-cache',
    })
    return createReadStream(abs, { start, end }).pipe(res)
  }
  res.writeHead(200, { 'content-type': type, 'content-length': info.size, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' })
  createReadStream(abs).pipe(res)
}

function textOfContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim()
}

function extractChat(events) {
  const messages = []
  let running = false
  for (const event of events) {
    if (!event || typeof event.type !== 'string') continue
    if (event.type === 'turn/start') running = true
    else if (event.type === 'turn/end') {
      running = false
      const reason = event.data?.reason
      if (reason?.kind === 'error') {
        messages.push({ role: 'error', text: String(reason.error?.message ?? reason.message ?? 'Agent 调用失败').slice(0, 900), seq: event.seq ?? 0 })
      }
    } else if (event.type === 'user/message') {
      const kind = event.data?.source?.kind
      if (kind !== undefined && kind !== 'user') continue
      const text = textOfContent(event.data?.content)
      if (text) messages.push({ role: 'user', text: text.slice(0, 8000), seq: event.seq ?? 0 })
    } else if (event.type === 'assistant/message') {
      const message = event.data?.message
      const text = textOfContent(message?.content)
      const tools = Array.isArray(message?.content)
        ? message.content.filter((part) => part?.type === 'tool-call' && part.name).map((part) => part.name)
        : []
      if (text || tools.length) messages.push({ role: 'assistant', text: text.slice(0, 16000), tools, seq: event.seq ?? 0 })
    }
  }
  return { messages: messages.slice(-100), running }
}


const SESSION_ROOT = path.join(os.homedir(), '.dsh', 'sessions')
const transcriptCache = new Map()
const sessionFileCache = new Map()

async function findSessionFile(sessionId) {
  if (!/^session-[A-Za-z0-9-]+$/.test(String(sessionId || ''))) return null
  const cached = sessionFileCache.get(sessionId)
  if (cached) {
    const info = await stat(cached).catch(() => null)
    if (info?.isFile()) return cached
    sessionFileCache.delete(sessionId)
  }
  const dirs = await readdir(SESSION_ROOT, { withFileTypes: true }).catch(() => [])
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    const folder = path.join(SESSION_ROOT, dir.name, sessionId)
    const files = await readdir(folder, { withFileTypes: true }).catch(() => null)
    if (!files) continue
    const hit = files
      .filter((file) => file.isFile() && /^session(\.v\d+)?\.jsonl(\.zst(d)?)?$/.test(file.name))
      .sort((a, b) => (a.name.endsWith('.jsonl') ? 1 : 0) - (b.name.endsWith('.jsonl') ? 1 : 0))[0]
    if (hit) {
      const file = path.join(folder, hit.name)
      sessionFileCache.set(sessionId, file)
      return file
    }
  }
  return null
}

function zstdToText(file) {
  return new Promise((resolve, reject) => {
    const candidates = [process.env.ZSTD_BIN, 'zstd', '/Applications/ServBay/bin/zstd'].filter(Boolean)
    let index = 0
    const next = () => {
      if (index >= candidates.length) return reject(new Error('zstd 不可用，无法读取历史会话'))
      const bin = candidates[index++]
      const child = spawn(bin, ['-dc', file], { stdio: ['ignore', 'pipe', 'pipe'] })
      const chunks = []
      let err = ''
      child.stdout.on('data', (chunk) => chunks.push(chunk))
      child.stderr.on('data', (chunk) => (err += chunk))
      child.on('error', next)
      child.on('close', (code) => {
        if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'))
        else next()
      })
    }
    next()
  })
}

async function readColdChat(sessionId) {
  const file = await findSessionFile(sessionId)
  if (!file) return { messages: [], running: false, cold: true, lastSeq: 0 }
  const info = await stat(file).catch(() => null)
  if (!info) return { messages: [], running: false, cold: true, lastSeq: 0 }
  const cache = transcriptCache.get(sessionId)
  if (cache && cache.mtime === info.mtimeMs && cache.size === info.size) return cache.value
  let raw = ''
  if (/\.zst(d)?$/i.test(file)) raw = await zstdToText(file).catch(() => '')
  else raw = await readFile(file, 'utf8').catch(() => '')
  const events = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      /* a torn last line is not a message */
    }
  }
  const parsed = extractChat(events)
  const value = { messages: parsed.messages, running: false, cold: true, lastSeq: events.reduce((max, event) => Math.max(max, Number(event.seq) || 0), 0) }
  transcriptCache.set(sessionId, { mtime: info.mtimeMs, size: info.size, value })
  if (transcriptCache.size > 8) transcriptCache.delete(transcriptCache.keys().next().value)
  return value
}

async function readChat(ctx, sessionId) {
  const session = ctx.sessions.get(sessionId)
  if (session === undefined) return readColdChat(sessionId)
  const seq = typeof session.seq === 'number' ? session.seq : 0
  let hit = chatCache.get(sessionId)
  if (hit === undefined || hit.seq !== seq) {
    const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : (session.events ?? [])
    hit = { seq, ...extractChat(events) }
    chatCache.set(sessionId, hit)
    if (chatCache.size > 12) chatCache.delete(chatCache.keys().next().value)
  }
  return { messages: hit.messages, running: hit.running, cold: false }
}

async function loadFilmOr404(root, id) {
  const film = await readFilm(root, id)
  if (!film) return null
  if (!existsSync(path.join(film.dir, 'index.html'))) {
    // a half-created folder is not a film
    return null
  }
  return film
}

async function summaryOf(root, film) {
  const view = await filmView(root, film)
  return {
    id: view.id,
    title: view.title,
    style: view.style,
    stage: view.stage,
    stageFlags: view.stageFlags,
    brief: view.brief,
    updatedAt: view.updatedAt,
    stills: view.stills.length,
    board: (view.boardStills || []).length,
    renders: view.renders.length,
    delivered: view.delivered,
    agentPainted: view.agentPainted,
    cover: view.stills[view.stills.length - 1]?.url || `/lemo-studio/api/poster/${view.style.slug}`,
    folder: view.folder,
  }
}

async function ensureSession(ctx, film) {
  const existing = String(film.sessionId || '').trim()
  if (existing) return existing
  const created = await ctx.sessionController.create({ cwd: film.dir })
  try {
    await ctx.sessionController.rename({ sessionId: created.sessionId, title: `视频工坊 · ${film.title}` })
  } catch {
    /* renaming is optional */
  }
  await saveFilm(film, { sessionId: created.sessionId })
  film.sessionId = created.sessionId
  return created.sessionId
}

async function api(ctx, root, req, res) {
  const url = new URL(req.url ?? '/', 'http://studio.invalid')
  const route = url.pathname.slice(PREFIX.length) || '/'
  const parts = route.split('/').filter(Boolean)
  const method = req.method || 'GET'

  try {
    if (method === 'GET' && (route === '/api/state' || route === '/api')) {
      const lib = libraryStatus()
      const [info, styles, films] = await Promise.all([
        libraryInfo(),
        lib.ready ? listStyles() : [],
        listFilms(root),
      ])
      const summaries = []
      for (const film of films.slice(0, 30)) {
        try {
          summaries.push(await summaryOf(root, film))
        } catch {
          /* skip a broken folder */
        }
      }
      return sendJson(res, 200, {
        ok: true,
        root,
        lib: { ...lib, info },
        styles,
        films: summaries,
        engine: { name: 'Lemo-Opuscar', commit: info.commit, root: lib.lib },
      })
    }

    if (method === 'GET' && route === '/api/styles') {
      return sendJson(res, 200, { ok: true, styles: await listStyles() })
    }

    if (method === 'GET' && parts[0] === 'api' && parts[1] === 'style' && parts[2]) {
      const spec = await styleDoc(parts[2])
      if (!spec) return sendJson(res, 404, { ok: false, error: '风格库里没有这个 slug' })
      return sendJson(res, 200, { ok: true, slug: spec.slug, meta: spec.meta, doc: spec.doc })
    }

    if (method === 'GET' && parts[0] === 'api' && parts[1] === 'poster' && parts[2]) {
      const file = posterPath(parts[2])
      if (!file) return sendJson(res, 404, { ok: false, error: '没有海报' })
      return serveFile(res, file, { cache: 'public, max-age=86400' })
    }

    if (method === 'POST' && route === '/api/films') {
      const body = await readBody(req)
      const lib = libraryStatus()
      if (!lib.ready) return sendJson(res, 503, { ok: false, error: lib.why })
      const slug = String(body.style || '').trim()
      const styles = await listStyles()
      const style = styles.find((row) => row.slug === slug)
      if (!style) return sendJson(res, 400, { ok: false, error: '先选一种风格' })
      const doc = await styleDoc(slug)
      if (!doc) return sendJson(res, 400, { ok: false, error: '风格文档读不到' })
      const idea = String(body.idea || '').trim()
      if (!idea) return sendJson(res, 400, { ok: false, error: '写一句想法再建组' })
      const film = await createFilm(
        root,
        {
          title: body.title,
          style,
          styleMeta: style,
          doc: doc.doc,
          idea,
          language: body.language,
          duration: body.duration,
          voice: body.voice,
          storyboard: body.storyboard,
        },
        lib.lib,
      )
      const sessionId = await ensureSession(ctx, film)
      film.sessionId = sessionId
      const view = await filmView(root, film)
      return sendJson(res, 200, { ok: true, film: view, summary: await summaryOf(root, film), sessionId })
    }

    if (method === 'GET' && route === '/api/films') {
      const films = await listFilms(root)
      const summaries = []
      for (const film of films) summaries.push(await summaryOf(root, film))
      return sendJson(res, 200, { ok: true, films: summaries })
    }

    if (parts[0] === 'api' && parts[1] === 'films' && parts[2]) {
      const id = parts[2]
      const film = await loadFilmOr404(root, id)
      if (!film) return sendJson(res, 404, { ok: false, error: '影片不存在' })
      const rest = parts.slice(3)

      if (method === 'GET' && rest.length === 0) {
        return sendJson(res, 200, { ok: true, film: await filmView(root, film) })
      }

      if (method === 'PATCH' && rest.length === 0) {
        const body = await readBody(req)
        const patch = {}
        if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 60)
        if (body.brief && typeof body.brief === 'object') {
          const brief = { ...film.brief }
          if (typeof body.brief.idea === 'string') brief.idea = body.brief.idea.slice(0, 6000)
          if (typeof body.brief.language === 'string') brief.language = body.brief.language === 'English' ? 'English' : '中文'
          if (Number.isFinite(Number(body.brief.duration))) brief.duration = Math.min(180, Math.max(10, Number(body.brief.duration)))
          if (typeof body.brief.voice === 'boolean') brief.voice = body.brief.voice
          if (typeof body.brief.storyboard === 'boolean') brief.storyboard = body.brief.storyboard
          patch.brief = brief
        }
        const next = await saveFilm(film, patch)
        return sendJson(res, 200, { ok: true, film: await filmView(root, next) })
      }

      if (method === 'GET' && rest[0] === 'file') {
        const rel = cleanRel(url.searchParams.get('p'))
        if (!rel) return sendJson(res, 400, { ok: false, error: '缺少 p' })
        const abs = path.join(film.dir, rel)
        if (!within(film.dir, abs)) return sendJson(res, 403, { ok: false, error: '路径越界' })
        return serveRange(req, res, abs)
      }

      if (method === 'POST' && rest[0] === 'stills') {
        const body = await readBody(req)
        const times = Array.isArray(body.times)
          ? body.times.map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 180).slice(0, 8)
          : undefined
        const job = renderStills(film, { times })
        return sendJson(res, 200, { ok: true, job: jobView(job) })
      }

      if (method === 'POST' && rest[0] === 'sheet') {
        const body = await readBody(req)
        const job = await startSheet(film, {
          cols: Number(body.cols) || 3,
          width: Number(body.width) || 640,
        })
        return sendJson(res, 200, { ok: true, job: jobView(job) })
      }

      if (method === 'POST' && rest[0] === 'video') {
        const body = await readBody(req)
        const quality = body.quality === 'final' ? 'final' : 'draft'
        const job = renderVideo(film, { quality })
        return sendJson(res, 200, { ok: true, job: jobView(job) })
      }

      if (method === 'POST' && rest[0] === 'readcheck') {
        const job = readcheck(film)
        return sendJson(res, 200, { ok: true, job: jobView(job) })
      }

      if (method === 'POST' && rest[0] === 'reveal') {
        const ok = await reveal(film)
        return sendJson(res, 200, { ok, folder: film.dir })
      }

      if (method === 'POST' && rest[0] === 'annotate') {
        const body = await readBody(req)
        const rel = cleanRel(body.p)
        if (!rel) return sendJson(res, 400, { ok: false, error: '缺少图片路径' })
        const src = path.join(film.dir, rel)
        if (!within(film.dir, src)) return sendJson(res, 403, { ok: false, error: '路径越界' })
        const info = await stat(src).catch(() => null)
        if (!info?.isFile()) return sendJson(res, 404, { ok: false, error: '图片不存在' })
        if (!/\.(jpe?g|png|webp)$/i.test(src)) return sendJson(res, 400, { ok: false, error: '只支持图片' })
        const box = body.box || {}
        const x = Math.max(0, Math.round(Number(box.x) || 0))
        const y = Math.max(0, Math.round(Number(box.y) || 0))
        const w = Math.max(2, Math.round(Number(box.w) || 0))
        const h = Math.max(2, Math.round(Number(box.h) || 0))
        const note = String(body.note || '').trim().slice(0, 2000)
        const dirOut = path.join(film.dir, 'annotations')
        await mkdir(dirOut, { recursive: true })
        const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17)
        const cropName = `annot-${stamp}-crop.png`
        const markedName = `annot-${stamp}-marked.png`
        const cropAbs = path.join(dirOut, cropName)
        const markedAbs = path.join(dirOut, markedName)
        const run = (args) =>
          new Promise((resolve, reject) => {
            const child = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
            let err = ''
            child.stderr.on('data', (chunk) => (err += chunk))
            child.on('error', reject)
            child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.split('\n').filter(Boolean).pop() || 'ffmpeg 失败'))))
          })
        try {
          await run(['-i', src, '-vf', `crop=${w}:${h}:${x}:${y}`, '-frames:v', '1', cropAbs])
          await run(['-i', src, '-vf', `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=red@0.85:t=5`, '-frames:v', '1', markedAbs])
        } catch (error) {
          return sendJson(res, 400, { ok: false, error: `裁图失败：${String(error.message || error)}` })
        }
        await writeFile(
          path.join(dirOut, `annot-${stamp}.json`),
          JSON.stringify({ source: rel, box: { x, y, w, h }, note, crop: cropName, marked: markedName, at: new Date().toISOString() }, null, 2),
        ).catch(() => {})
        const url = `/lemo-studio/api/films/${film.id}/file?p=annotations/${encodeURIComponent(cropName)}`
        const markedUrl = `/lemo-studio/api/films/${film.id}/file?p=annotations/${encodeURIComponent(markedName)}`
        return sendJson(res, 200, {
          ok: true,
          crop: { file: `annotations/${cropName}`, absolute: cropAbs, url },
          marked: { file: `annotations/${markedName}`, absolute: markedAbs, url: markedUrl },
          box: { x, y, w, h },
          note,
          source: rel,
        })
      }

      if (method === 'POST' && rest[0] === 'chat' && rest[1] === 'session') {
        const sessionId = await ensureSession(ctx, film)
        return sendJson(res, 200, { ok: true, sessionId })
      }

      if (method === 'POST' && rest[0] === 'chat' && rest[1] === 'send') {
        const body = await readBody(req)
        const sessionId = await ensureSession(ctx, film)
        const view = await filmView(root, film)
        const text = buildPrompt(film, view, body)
        const requestId = typeof body.requestId === 'string' ? body.requestId.slice(0, 120) : randomUUID()
        await ctx.sessionController.prompt({ sessionId, requestId, content: [{ type: 'text', text }] }, new AbortController().signal)
        return sendJson(res, 200, { ok: true, sessionId, requestId, action: actionLabel(body.action) })
      }

      if (method === 'POST' && rest[0] === 'chat' && rest[1] === 'stop') {
        const body = await readBody(req)
        const sessionId = String(body.sessionId || film.sessionId || '')
        if (sessionId) await ctx.sessionController.cancel({ sessionId })
        return sendJson(res, 200, { ok: true })
      }

      return sendJson(res, 404, { ok: false, error: '未知接口' })
    }

    if (method === 'GET' && parts[0] === 'api' && parts[1] === 'chat' && parts[2] === 'history') {
      const sessionId = String(url.searchParams.get('sessionId') || '').trim()
      if (!sessionId) return sendJson(res, 400, { ok: false, error: '缺少 sessionId' })
      return sendJson(res, 200, { ok: true, ...(await readChat(ctx, sessionId)) })
    }

    if (method === 'GET' && parts[0] === 'api' && parts[1] === 'jobs' && parts[2]) {
      const job = jobs.get(parts[2])
      if (!job) return sendJson(res, 404, { ok: false, error: '任务不存在' })
      return sendJson(res, 200, { ok: true, job: jobView(job) })
    }

    if (method === 'POST' && parts[0] === 'api' && parts[1] === 'jobs' && parts[2] && parts[3] === 'cancel') {
      const ok = cancelJob(parts[2])
      return sendJson(res, 200, { ok })
    }

    return sendJson(res, 404, { ok: false, error: '未知接口' })
  } catch (error) {
    console.error('[lemo-studio]', error)
    if (!res.writableEnded) sendJson(res, 500, { ok: false, error: String(error?.message || error).slice(0, 500) })
  }
}

export function apply(ctx, config = {}) {
  const root = path.resolve(config.workspaceRoot || process.cwd())
  const filmsRoot = path.join(root, 'films')
  mkdir(filmsRoot, { recursive: true }).catch(() => {})

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: PREFIX,
        handler: (req, res) => {
          const url = new URL(req.url ?? '/', 'http://studio.invalid')
          if (url.pathname === `${PREFIX}/api/state` && req.method === 'GET') {
            // fast path is not needed: keep one handler so every route shares guards
          }
          return api(ctx, root, req, res)
        },
      }),
    'lemo-studio: api',
  )

  if (config.debug) {
    ctx.effect(() => {
      const file = '/tmp/dsh-lemo-studio-loaded.json'
      writeFile(
        file,
        JSON.stringify({ at: new Date().toISOString(), root, filmsRoot, lib: LEMO_HOME, plugin: PLUGIN_ROOT, pid: process.pid }, null, 2),
      ).catch(() => {})
      return () => {
        unlink(file).catch(() => {})
      }
    }, 'lemo-studio: debug marker')
  }

  console.log(`[lemo-studio] mounted ${PREFIX} → ${filmsRoot}`)
}

export const __test = { cleanRel, within, extractChat, actionLabel }
