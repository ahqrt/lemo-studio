/**
 * Film projects: the folder the studio creates and the agent works in.
 *
 * A studio film is a Lemo-Opuscar project: `index.html` exposes
 * `window.DUR / window.render(t) / window.READY`, and imports `/core/lib.js`
 * from the library. The studio writes a renderable skeleton first; the agent
 * replaces the drawing code with the style's real grammar.
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, readdir, stat, copyFile } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import path from 'node:path'
import { paletteOf } from './library.js'

const STAGE_ORDER = ['brief', 'treatment', 'look', 'storyboard', 'sound', 'film']
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp'])

export function filmDir(root, id) {
  if (!/^[0-9]{8}-[0-9]{6}-[a-f0-9]{4}$/.test(String(id || ''))) return null
  return path.join(root, 'films', id)
}

function newId() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return `${stamp}-${randomBytes(2).toString('hex')}`
}

export function slugOf(title) {
  const raw = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return raw.slice(0, 40) || 'film'
}

function sha(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function round(n, d = 2) {
  return Number(Number(n).toFixed(d))
}

function lookTimes(duration) {
  const dur = Math.max(4, Number(duration) || 45)
  return [round(dur * 0.16), round(dur * 0.46), round(dur * 0.78)]
}

function scaffoldHtml(title) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  html,body{margin:0;background:#000;overflow:hidden}
  canvas{position:absolute;left:0;top:0;width:100vw;height:100vh;display:block}
</style>
</head>
<body>
<canvas id="canvas" width="1920" height="1080"></canvas>
<script type="module" src="main.js"></script>
</body>
</html>
`
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

function scaffoldJs() {
  return `// Studio skeleton — a real, renderable timeline, but NOT the style yet.
// The director replaces this file's drawing code with the style's real grammar.
import { clamp, ss, eio } from '/core/lib.js';

const cv = document.getElementById('canvas');
const g = cv.getContext('2d');
const W = 1920, H = 1080;
let FILM = null;

function wrap(text, max, font) {
  g.font = font;
  const lines = [];
  let line = '';
  for (const ch of String(text || '')) {
    if (line && g.measureText(line + ch).width > max) { lines.push(line); line = ''; }
    line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

function draw(t) {
  const pal = (FILM && FILM.palette) || { bg: '#101110', ink: '#e9e4d8', accent: '#e4572e' };
  g.fillStyle = pal.bg;
  g.fillRect(0, 0, W, H);

  const beats = (FILM && FILM.beats) || [];
  let beat = beats[0] || { t: 0, kicker: 'SKELETON', title: '等待输入', sub: '' };
  for (const b of beats) if (t >= b.t) beat = b;
  const p = ss(clamp((t - beat.t) / 0.85));

  g.globalAlpha = p;
  g.fillStyle = pal.ink;
  g.font = '400 26px "SF Mono", Menlo, monospace';
  g.fillText(beat.kicker, 132, 278);

  const titleFont = '400 104px "Songti SC", "STSong", serif';
  const lines = wrap(beat.title, 1280, titleFont);
  g.font = titleFont;
  lines.forEach((line, i) => g.fillText(line, 132, 402 + i * 116));

  const subY = 402 + lines.length * 116 + 34;
  g.fillStyle = pal.ink;
  g.globalAlpha = p * 0.62;
  g.font = '400 30px "PingFang SC", "Hiragino Sans GB", sans-serif';
  wrap(beat.sub, 1180, '400 30px "PingFang SC", sans-serif').forEach((line, i) => g.fillText(line, 132, subY + i * 46));

  g.globalAlpha = p * 0.9;
  g.fillStyle = pal.accent;
  g.fillRect(132, subY + 66, 6 + 480 * eio(clamp((t - beat.t) / 1.1)), 3);

  g.globalAlpha = 0.42;
  g.fillStyle = pal.ink;
  g.font = '400 22px "SF Mono", Menlo, monospace';
  g.fillText(t.toFixed(2) + 's', 132, H - 110);
  g.textAlign = 'right';
  g.fillText('SCAFFOLD · NOT THE STYLE YET', W - 132, H - 110);
  g.textAlign = 'left';

  g.globalAlpha = 0.16;
  g.fillStyle = pal.ink;
  g.fillRect(132, H - 154, W - 264, 1);
  g.globalAlpha = 0.55;
  g.fillStyle = pal.accent;
  g.fillRect(132, H - 155, (W - 264) * (t / Math.max(1, window.DUR)), 1);
  g.globalAlpha = 1;
}

async function boot() {
  try {
    FILM = await (await fetch('./film.json')).json();
  } catch (error) {
    FILM = null;
  }
  try {
    await document.fonts.load('400 104px "Songti SC"');
    await document.fonts.load('400 30px "PingFang SC"');
  } catch (error) {
    /* system fonts are optional */
  }
  window.DUR = (FILM && FILM.dur) || 10;
  window.EV = [];
  window.SUBS = [];
  window.render = draw;
  window.render(0);
  window.READY = true;
}

boot();
`
}

function buildSh(lib) {
  return `#!/bin/sh
# One-command build. The director may replace the commands, but keep this file.
set -e
LIB="${lib}"
cd "$(dirname "$0")"
mkdir -p stills out
node "$LIB/core/render/still.mjs" . --range 1:10:4 --out stills
node "$LIB/core/render/video.mjs" . --fps 24 --workers 3 --out out/film.mp4
`
}

function briefMd(film, styleDoc) {
  const f = film
  const voiceLine = f.brief.voice ? '要配音（中文，克制；先用 edge-tts，离线才用 Kokoro）' : '不做配音'
  const boardLine = f.brief.storyboard ? '用户要先看分镜，停在分镜帧等确认' : '用户不要求先看分镜，不用停'
  const style = styleDoc?.doc ? '库里的 STYLE.md 是唯一风格规范，先完整读它。' : '先读风格库里的 STYLE.md。'
  return `# 《${f.title}》· 制作简报

- 风格：${f.style.cn} ${f.style.en}（\`styles/${f.style.slug}\`）
- 语言：${f.brief.language}
- 时长：${f.brief.duration} 秒（硬约束，不要超）
- 画幅：1920×1080 · 24 fps
- 声音：${voiceLine}
- 分镜：${boardLine}
- 项目目录：\`${f.dir}\`
- Lemo 库：\`${f.lib}\`

## 用户的想法

${f.brief.idea}

## 交接

这个文件夹已经能渲染：\`index.html\` + \`main.js\` 是一个可渲染的**骨架**（标题卡时间轴），不是风格画面。
骨架故意不装成片；它的作用是让抽帧、时间轴、渲染管线先跑通。

${style}
不要照搬 \`styles/${f.style.slug}/DEMO.md\` 或 demo 的故事、镜头、道具和结尾；
在写完 \`TREATMENT.md\` 之前不要打开 demo 源码。

## 导演的顺序

1. 读 \`$LIB/AGENTS.md\`、\`$LIB/DIRECTOR.md\`、\`$LIB/dsh/DEEPSEEK.md\`，再完整读 \`styles/${f.style.slug}/STYLE.md\`。
2. 写 \`TREATMENT.md\`：三个结构方案 + 选择、logline、镜头表、节拍、cue map、声音设计。
3. 用真实绘制代码替换 \`main.js\` / \`index.html\` 里的骨架；先出一张 t≈1.5s 的风格帧，逐条对 STYLE.md，再出 3 张。
4. 用户点头后再接时间轴、做声音、渲染。
5. 不要执行整片渲染，除非用户明确要求；抽帧和 10–15 秒草稿可以。

## 交付（最终）

\`<name>.mp4\`、\`poster.jpg\`、\`<name>.srt\`（有旁白时）、\`TREATMENT.md\`、\`CREDITS\`、\`build.sh\`。
`
}

function filmJson(film, palette) {
  const dur = Number(film.brief.duration) || 45
  const beats = [
    {
      t: 0,
      kicker: '01 / BRIEF',
      title: film.title,
      sub: `${film.style.cn} · ${dur} 秒 · ${film.brief.language}`,
    },
    {
      t: round(dur * 0.34),
      kicker: '02 / SKELETON',
      title: '这是骨架，不是风格',
      sub: '导演会按 STYLE.md 重写绘制代码',
    },
    {
      t: round(dur * 0.68),
      kicker: '03 / HANDOFF',
      title: '读 STYLE.md，先出风格帧',
      sub: 'TREATMENT.md → 3 张风格帧 → 你点头',
    },
  ]
  return {
    title: film.title,
    style: film.style,
    lang: film.brief.language,
    dur,
    palette,
    beats,
  }
}

/** Create the project folder and its renderable skeleton. */
export async function createFilm(root, { title, style, styleMeta, doc, idea, language, duration, voice, storyboard }, lib) {
  const cleanTitle = String(title || '').trim().slice(0, 60) || '未命名影片'
  const dur = Math.min(180, Math.max(10, Number(duration) || 45))
  const id = newId()
  const dir = path.join(root, 'films', id)
  await mkdir(path.join(dir, 'stills'), { recursive: true })
  await mkdir(path.join(dir, 'out'), { recursive: true })
  await mkdir(path.join(dir, 'assets'), { recursive: true })

  const film = {
    version: 2,
    id,
    title: cleanTitle,
    dir,
    lib,
    style: {
      slug: style.slug,
      cn: styleMeta?.cn || style.cn || style.slug,
      en: styleMeta?.en || style.en || style.slug,
      category: styleMeta?.category_cn || styleMeta?.category_en || '',
      num: styleMeta?.num || '',
    },
    brief: {
      idea: String(idea || '').trim().slice(0, 6000),
      language: language === 'English' ? 'English' : '中文',
      duration: dur,
      voice: voice !== false,
      storyboard: Boolean(storyboard),
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lookTimes: lookTimes(dur),
    stills: [],
    renders: [],
    sessionId: '',
    scaffoldHash: '',
  }

  const palette = paletteOf(doc || '')
  const main = scaffoldJs()
  const index = scaffoldHtml(cleanTitle)
  film.scaffoldHash = sha(index)
  film.scaffoldMainHash = sha(main)

  await writeFile(path.join(dir, 'project.json'), JSON.stringify(film, null, 2))
  await writeFile(path.join(dir, 'BRIEF.md'), briefMd({ ...film, dir, lib }, { doc }))
  await writeFile(path.join(dir, 'film.json'), JSON.stringify(filmJson({ ...film, dir, lib }, palette), null, 2))
  await writeFile(path.join(dir, 'index.html'), index)
  await writeFile(path.join(dir, 'main.js'), main)
  await writeFile(path.join(dir, 'build.sh'), buildSh(lib), { mode: 0o755 })
  await writeFile(
    path.join(dir, 'assets', '.keep'),
    '素材放这里：用户给的图、logo、扫描件、自己的声音。\n',
  )
  return film
}

export async function readFilm(root, id) {
  const dir = filmDir(root, id)
  if (!dir) return null
  const raw = await readFile(path.join(dir, 'project.json'), 'utf8').catch(() => null)
  if (!raw) return null
  try {
    const film = JSON.parse(raw)
    return { ...film, dir, id }
  } catch {
    return null
  }
}

export async function listFilms(root) {
  const base = path.join(root, 'films')
  const entries = await readdir(base, { withFileTypes: true }).catch(() => [])
  const rows = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const film = await readFilm(root, entry.name)
    if (!film) continue
    const info = await stat(path.join(base, entry.name, 'project.json')).catch(() => null)
    rows.push({ film, mtime: info?.mtimeMs || 0 })
  }
  rows.sort((a, b) => b.mtime - a.mtime)
  return rows.map((row) => row.film)
}

export async function saveFilm(film, patch = {}) {
  const next = {
    ...film,
    ...patch,
    style: { ...film.style, ...(patch.style || {}) },
    brief: { ...film.brief, ...(patch.brief || {}) },
    updatedAt: new Date().toISOString(),
  }
  delete next.dir
  delete next.stage
  delete next.artifacts
  await writeFile(path.join(film.dir, 'project.json'), JSON.stringify(next, null, 2))
  return { ...next, dir: film.dir }
}

async function listImages(dir) {
  const rows = []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) continue
    const info = await stat(path.join(dir, entry.name)).catch(() => null)
    if (!info) continue
    rows.push({ name: entry.name, at: info.mtimeMs, size: info.size })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
}

function stillView(id, row) {
  const hit = /([0-9]+(?:\.[0-9]+)?)\.jpe?g$/i.exec(row.name)
  return {
    name: row.name,
    t: hit ? Number(hit[1]) : 0,
    at: row.at,
    size: row.size,
    url: `/lemo-studio/api/films/${id}/file?p=stills/${encodeURIComponent(row.name)}`,
  }
}

/** Everything the UI needs about one film: stage, artifacts, honesty flags. */
export async function filmView(root, film) {
  const dir = film.dir
  const [indexRaw, mainRaw, treatmentRaw] = await Promise.all([
    readFile(path.join(dir, 'index.html'), 'utf8').catch(() => ''),
    readFile(path.join(dir, 'main.js'), 'utf8').catch(() => ''),
    readFile(path.join(dir, 'TREATMENT.md'), 'utf8').catch(() => ''),
  ])
  const [stillsRaw, outRaw, voiceRaw] = await Promise.all([
    listImages(path.join(dir, 'stills')),
    readdir(path.join(dir, 'out')).catch(() => []),
    listImages(path.join(dir, 'voices')),
  ])
  const lookStills = stillsRaw.filter((row) => /^look[_-]/i.test(row.name))
  const boardStills = stillsRaw.filter((row) => /^(sb|board|story)[_-]/i.test(row.name))
  const contactNames = ['storyboard.jpg', 'storyboard.png', 'CONTACT.jpg', 'CONTACT.png', 'contact.jpg', 'contact.png']
  let contactName = ''
  let contactAt = 0
  for (const name of contactNames) {
    const info = await stat(path.join(dir, name)).catch(() => null)
    if (info?.isFile() && info.mtimeMs >= contactAt) {
      contactName = name
      contactAt = info.mtimeMs
    }
  }
  const contact = Boolean(contactName)
  const mix = existsSync(path.join(dir, 'out', 'mix.wav'))
  const videoFiles = outRaw.filter((n) => /\.(mp4|mov|webm)$/i.test(n)).sort()
  const titleSlug = slugOf(film.title)
  const renders = []
  for (const name of videoFiles) {
    const known = (film.renders || []).find((r) => path.basename(r.file || '') === name)
    const info = await stat(path.join(dir, 'out', name)).catch(() => null)
    const metaRaw = await readFile(path.join(dir, 'out', `${name}.json`), 'utf8').catch(() => null)
    let meta = null
    try {
      meta = metaRaw ? JSON.parse(metaRaw) : null
    } catch {
      meta = null
    }
    renders.push({
      file: name,
      url: `/lemo-studio/api/films/${film.id}/file?p=out/${encodeURIComponent(name)}`,
      label: known?.label || meta?.label || (name.includes('draft') ? '草稿' : '成片'),
      at: known?.at || meta?.at || (info ? new Date(info.mtimeMs).toISOString() : ''),
      duration: known?.duration || meta?.duration || film.brief.duration,
      loudness: known?.loudness || meta?.loudness || '',
      size: known?.size || meta?.size || info?.size || 0,
      quality: meta?.quality || (name.includes('draft') ? 'draft' : 'final'),
    })
  }
  const delivered = renders.some((row) => row.quality === 'final' || Boolean(row.loudness))
  const stageFlags = {
    brief: true,
    treatment: Boolean(treatmentRaw),
    look: lookStills.length > 0 || stillsRaw.some((row) => !boardStills.includes(row)),
    storyboard: contact || boardStills.length > 0,
    sound: mix || voiceRaw.length > 0,
    film: renders.length > 0,
  }
  let stage = 'brief'
  for (const key of STAGE_ORDER) if (stageFlags[key]) stage = key

  return {
    id: film.id,
    title: film.title,
    style: film.style,
    brief: film.brief,
    createdAt: film.createdAt,
    updatedAt: film.updatedAt,
    stage,
    stageFlags,
    scaffoldHash: film.scaffoldHash,
    agentPainted:
      Boolean(indexRaw) &&
      (sha(indexRaw) !== (film.scaffoldHash || '') ||
        (Boolean(mainRaw) && Boolean(film.scaffoldMainHash) && sha(mainRaw) !== film.scaffoldMainHash)),
    indexBytes: indexRaw.length,
    treatment: treatmentRaw.slice(0, 80_000),
    lookTimes: film.lookTimes || lookTimes(film.brief.duration),
    stills: (lookStills.length ? lookStills : stillsRaw.filter((row) => !boardStills.includes(row))).map((row) => stillView(film.id, row)),
    lookStills: lookStills.map((row) => stillView(film.id, row)),
    boardStills: boardStills.map((row) => stillView(film.id, row)),
    contact: contact ? `/lemo-studio/api/films/${film.id}/file?p=${encodeURIComponent(contactName)}&v=${Math.round(contactAt)}` : '',
    contactName,
    mix: mix ? `/lemo-studio/api/films/${film.id}/file?p=out/mix.wav` : '',
    voices: voiceRaw.map((row) => row.name),
    renders,
    delivered,
    sessionId: film.sessionId || '',
    files: {
      brief: `/lemo-studio/api/films/${film.id}/file?p=BRIEF.md`,
      treatment: treatmentRaw ? `/lemo-studio/api/films/${film.id}/file?p=TREATMENT.md` : '',
      project: `/lemo-studio/api/films/${film.id}/file?p=project.json`,
      index: `/lemo-studio/api/films/${film.id}/file?p=index.html`,
      build: `/lemo-studio/api/films/${film.id}/file?p=build.sh`,
    },
    folder: dir,
    slug: titleSlug,
  }
}

export async function addRender(film, render) {
  const renders = [...(film.renders || []), render].slice(-20)
  return saveFilm(film, { renders })
}

export async function addStills(film, stills) {
  const merged = [...(film.stills || [])]
  for (const item of stills) {
    const index = merged.findIndex((row) => row.name === item.name)
    if (index >= 0) merged[index] = item
    else merged.push(item)
  }
  return saveFilm(film, { stills: merged.slice(-60) })
}

export { round, lookTimes, STAGE_ORDER }
