import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from './api'
import ChatDock from './chat'
import ImageViewer from './viewer'
import Markdown from './markdown'

const STAGES = [
  { id: 'brief', n: '01', label: '简报', hint: '建组时写进 BRIEF.md 的就是这些' },
  { id: 'treatment', n: '02', label: 'Treatment', hint: '三个结构、镜头表、声音设计' },
  { id: 'look', n: '03', label: '风格帧', hint: '用真实绘制代码抽三张，先看再改' },
  { id: 'storyboard', n: '04', label: '分镜', hint: '6–9 张关键帧，点头才继续' },
  { id: 'sound', n: '05', label: '声音', hint: '配音 → 回读 → 配乐 → 混音' },
  { id: 'film', n: '06', label: '成片', hint: 'render → mux → 质检' },
]

const ALL = '全部'

const ago = (iso) => {
  const time = Date.parse(iso || '')
  if (!Number.isFinite(time)) return ''
  const diff = Math.max(0, Date.now() - time)
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`
  return `${Math.round(diff / 86_400_000)} 天前`
}
const fmtDur = (seconds) => {
  const total = Math.max(0, Number(seconds) || 0)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(Math.floor(total % 60)).padStart(2, '0')}`
}
const fmtBytes = (bytes) => {
  const n = Number(bytes) || 0
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}
const fmtTC = (seconds) => {
  const total = Math.max(0, Number(seconds) || 0)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
}
const stageIndex = (id) => Math.max(0, STAGES.findIndex((s) => s.id === id))
const groupCats = (styles) => {
  const cats = []
  for (const style of styles) {
    let row = cats.find((item) => item.name === style.categoryCn)
    if (!row) {
      row = { name: style.categoryCn, items: [] }
      cats.push(row)
    }
    row.items.push(style)
  }
  return cats
}
const jobProgress = (job) => {
  if (!job?.lines?.length) return job?.status === 'done' ? 1 : 0
  const rows = job.lines.filter((line) => /^w\d+\s+\d+\/\d+/.test(line)).slice(-6)
  if (!rows.length) return job.status === 'done' ? 1 : 0
  const byWorker = new Map()
  for (const line of rows) {
    const hit = /^w(\d+)\s+(\d+)\/(\d+)/.exec(line)
    if (hit) byWorker.set(hit[1], [Number(hit[2]), Number(hit[3])])
  }
  let done = 0
  let total = 0
  for (const [a, b] of byWorker.values()) {
    done += a
    total += b
  }
  return total ? Math.min(0.99, done / total) : 0
}

export default function App() {
  const [boot, setBoot] = useState(null)
  const [bootError, setBootError] = useState('')
  const [screen, setScreen] = useState('gallery')
  const [cat, setCat] = useState(ALL)
  const [q, setQ] = useState('')
  const [style, setStyle] = useState(null)
  const [film, setFilm] = useState(null)
  const [stage, setStage] = useState('look')
  const [job, setJob] = useState(null)
  const [toast, setToast] = useState('')
  const [dockOpen, setDockOpen] = useState(true)
  const [status, setStatus] = useState('')
  const [chat, setChat] = useState({ sessionId: '', messages: [], running: false, error: '' })
  const toastTimer = useRef(null)

  const flash = useCallback((text) => {
    setToast(text)
    setStatus(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2800)
  }, [])

  const loadState = useCallback(async () => {
    try {
      const value = await api.getState()
      setBoot(value)
      setBootError('')
      return value
    } catch (error) {
      setBootError(String(error.message || error))
      return null
    }
  }, [])

  useEffect(() => {
    loadState()
    return () => clearTimeout(toastTimer.current)
  }, [loadState])

  const refreshFilm = useCallback(async (id = film?.id) => {
    if (!id) return null
    try {
      const { film: next } = await api.getFilm(id)
      setFilm(next)
      return next
    } catch (error) {
      flash(String(error.message || error))
      return null
    }
  }, [film?.id, flash])

  const loadChat = useCallback(async (sessionId) => {
    if (!sessionId) return
    try {
      const history = await api.getChat(sessionId)
      setChat((prev) => ({ ...prev, sessionId, messages: history.messages || [], running: Boolean(history.running) }))
    } catch {
      /* keep the dock usable */
    }
  }, [])

  const openFilm = useCallback(async (id, nextStage) => {
    try {
      const { film: value } = await api.getFilm(id)
      let bound = value
      if (!value.sessionId) {
        try {
          const opened = await api.openChatSession(id)
          bound = { ...value, sessionId: opened.sessionId }
        } catch {
          /* keep the unbound state; no silent new session */
        }
      }
      setFilm(bound)
      setStage(nextStage || bound.stage || 'brief')
      setScreen('desk')
      setStatus('')
      if (bound.sessionId) {
        setChat((prev) => ({ ...prev, sessionId: bound.sessionId }))
        loadChat(bound.sessionId)
      } else {
        setChat({ sessionId: '', messages: [], running: false, error: '' })
      }
    } catch (error) {
      flash(String(error.message || error))
    }
  }, [flash, loadChat])

  const openNew = useCallback((nextStyle) => {
    setStyle(nextStyle)
    setScreen('new')
  }, [])

  const create = useCallback(async (payload) => {
    const { film: created } = await api.createFilm(payload)
    setFilm(created)
    setStage('brief')
    setScreen('desk')
    setChat({ sessionId: '', messages: [], running: false, error: '' })
    flash('组已建好 · 导演开始写 Treatment')
    loadState()
    try {
      const sessionId = created.sessionId || (await api.openChatSession(created.id)).sessionId
      setChat((prev) => ({ ...prev, sessionId, running: true }))
      await api.sendChat(created.id, { action: 'start', stage: 'brief' })
    } catch (error) {
      setChat((prev) => ({ ...prev, error: String(error.message || error) }))
    }
  }, [flash, loadState])

  useEffect(() => {
    if (!chat.sessionId) return undefined
    let alive = true
    const tick = async () => {
      try {
        const history = await api.getChat(chat.sessionId)
        if (!alive) return
        setChat((prev) => ({ ...prev, messages: history.messages || [], running: Boolean(history.running) }))
        if (!history.running) {
          refreshFilm()
          loadState()
        }
      } catch {
        /* one failed poll should not kill the dock */
      }
    }
    const timer = setInterval(tick, chat.running ? 1400 : 4000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [chat.sessionId, chat.running, refreshFilm, loadState])

  useEffect(() => {
    if (!film?.id || !chat.running) return undefined
    const timer = setInterval(() => refreshFilm(film.id), 4200)
    return () => clearInterval(timer)
  }, [film?.id, chat.running, refreshFilm])

  const runJob = useCallback(async (kind, starter, label) => {
    if (!film?.id) return
    try {
      const { job: started } = await starter()
      setJob({ ...started, kind })
      flash(`${label} · 已开始`)
      const final = await api.waitJob(started.id, (view) => setJob({ ...view, kind }))
      setJob({ ...final, kind })
      await refreshFilm(film.id)
      loadState()
      flash(final.status === 'done' ? `${label}完成` : `${label}失败 · ${final.error || ''}`)
    } catch (error) {
      flash(String(error.message || error))
    }
  }, [film?.id, flash, refreshFilm, loadState])

  const sendChat = useCallback(async ({ action = 'chat', message = '' }) => {
    if (!film?.id) return
    try {
      let sessionId = chat.sessionId
      if (!sessionId) sessionId = (await api.openChatSession(film.id)).sessionId
      setChat((prev) => ({ ...prev, sessionId, running: true, error: '' }))
      await api.sendChat(film.id, { action, message, stage })
    } catch (error) {
      setChat((prev) => ({ ...prev, running: false, error: String(error.message || error) }))
    }
  }, [film?.id, chat.sessionId, stage])

  const stopChat = useCallback(async () => {
    if (!film?.id) return
    await api.stopChat(film.id, chat.sessionId).catch(() => {})
    setChat((prev) => ({ ...prev, running: false }))
  }, [film?.id, chat.sessionId])

  const styles = boot?.styles || []
  const films = boot?.films || []
  const cats = useMemo(() => groupCats(styles), [styles])
  const counts = useMemo(() => {
    const map = new Map([[ALL, styles.length]])
    for (const c of cats) map.set(c.name, c.items.length)
    return map
  }, [styles, cats])
  const filteredCats = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return cats
      .filter((c) => (needle ? true : cat === ALL || c.name === cat))
      .map((c) => ({
        ...c,
        items: c.items.filter((s) => !needle || `${s.cn}${s.en}${s.slug}${s.categoryCn}${s.lineCn}${s.num}`.toLowerCase().includes(needle)),
      }))
      .filter((c) => c.items.length)
  }, [cats, cat, q])

  if (bootError) {
    return (
      <div className="ls-shell ls-centered">
        <div>
          <p className="ls-kicker">LEMO STUDIO</p>
          <h1 className="ls-title">片库没接上。</h1>
          <p className="ls-error">{bootError}</p>
          <button type="button" className="ls-btn" onClick={loadState}>重试</button>
        </div>
      </div>
    )
  }
  if (!boot) {
    return (
      <div className="ls-shell ls-centered">
        <div><p className="ls-kicker">LEMO STUDIO</p><h1 className="ls-title">正在打开片库…</h1></div>
      </div>
    )
  }
  if (!boot.lib.ready) {
    return (
      <div className="ls-shell ls-centered">
        <div>
          <p className="ls-kicker">LEMO-OPUSCAR</p>
          <h1 className="ls-title">还没找到风格库。</h1>
          <p className="ls-dek">{boot.lib.why}</p>
          <button type="button" className="ls-btn" onClick={loadState}>再查一次</button>
        </div>
      </div>
    )
  }

  return (
    <div className={`ls-shell ${screen === 'desk' ? 'desk-on' : ''}`}>
      {screen === 'gallery' ? (
        <Gallery
          styles={styles}
          films={films}
          cats={filteredCats}
          counts={counts}
          cat={cat}
          setCat={setCat}
          q={q}
          setQ={setQ}
          onOpenStyle={openNew}
          onOpenFilm={openFilm}
          onNew={() => openNew(styles[0])}
          lib={boot.lib}
        />
      ) : null}

      {screen === 'new' && style ? (
        <NewFilm style={style} onBack={() => setScreen('gallery')} onCreate={create} />
      ) : null}

      {screen === 'desk' && film ? (
        <Desk
          film={film}
          stage={stage}
          setStage={setStage}
          job={job}
          status={status}
          chat={chat}
          dockOpen={dockOpen}
          setDockOpen={setDockOpen}
          onSend={sendChat}
          onStop={stopChat}
          onJob={runJob}
          onRefresh={() => refreshFilm(film.id)}
          onGallery={() => { setScreen('gallery'); loadState() }}
          onFlash={flash}
        />
      ) : null}

      {toast ? <div className="ls-toast">{toast}</div> : null}
    </div>
  )
}

/* ── gallery ─────────────────────────────────────────────────────────────── */

function Gallery({ styles, films, cats, counts, cat, setCat, q, setQ, onOpenStyle, onOpenFilm, onNew, lib }) {
  const live = films.filter((f) => !f.delivered)
  const delivered = films.filter((f) => f.delivered)
  return (
    <div className="ls-gallery">
      <header className="ls-mast">
        <div>
          <p className="ls-kicker"><b>视频工坊</b><span>LEMO · 暗房</span></p>
          <h1>画法</h1>
          <p className="ls-dek">选一种画法。海报在灯上，想法交给导演。</p>
        </div>
        <div className="ls-mast-side">
          <p className="ls-lib-title">放映单</p>
          <p className="ls-bench"><i />{styles.length} 种风格 · Lemo 库已连接</p>
          <button type="button" className="ls-new-link" onClick={onNew}>＋ 新建一部</button>
        </div>
      </header>

      <section className="ls-bench">
        <div className="ls-bench-head">
          <span>进行中</span>
          <b>{live.length} 部</b>
          <em>{live.length ? '在片场' : '空片场'}</em>
        </div>
        {live.length ? (
          <div className="ls-bench-row">
            {live.map((item) => {
              const index = stageIndex(item.stage)
              return (
                <button key={item.id} type="button" className="ls-bench-card" onClick={() => onOpenFilm(item.id)}>
                  <span className="ls-bench-cover">
                    <img src={item.cover} alt="" loading="lazy" />
                    <span className="ls-bench-stage">{String(index + 1).padStart(2, '0')} / 06 · {stageLabel(item.stage)}</span>
                    <span className="ls-bench-open">打开 →</span>
                  </span>
                  <span className="ls-bench-body">
                    <span className="ls-bench-title">《{item.title}》</span>
                    <span className="ls-bench-meta">{item.style.cn} · {fmtDur(item.brief.duration)} · {item.brief.language}</span>
                    <span className="ls-bench-bar"><i style={{ width: `${((index + 1) / 6) * 100}%` }} /></span>
                    <span className="ls-bench-foot">
                      <span>{item.stills ? `抽帧 ${item.stills}` : '等导演'}{item.board ? ` · 分镜 ${item.board}` : ''}{item.renders ? ` · 草稿 ${item.renders}` : ''}</span>
                      <span>{ago(item.updatedAt)}</span>
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <button type="button" className="ls-bench-empty" onClick={onNew}>
            <span>还没有在做的片。</span>
            <em>选一种画法，把你的想法交给导演。</em>
            <b>＋ 新建一部</b>
          </button>
        )}

        {delivered.length ? (
          <div className="ls-delivered">
            <span className="ls-delivered-label">已交付 {delivered.length}</span>
            <span className="ls-delivered-list">
              {delivered.map((item) => (
                <button key={item.id} type="button" onClick={() => onOpenFilm(item.id)}>
                  《{item.title}》<em>{item.style.cn} · {fmtDur(item.brief.duration)}</em>
                </button>
              ))}
            </span>
          </div>
        ) : null}
      </section>

      <div className="ls-catalog">
        <aside className="ls-index">
          <label className="ls-search">
            <span>检索</span>
            <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="中文 / 英文 / slug" spellCheck="false" />
          </label>
          <nav>
            <button type="button" className={cat === ALL ? 'ls-cat on' : 'ls-cat'} onClick={() => setCat(ALL)}>
              <span>全部</span><em>{styles.length}</em>
            </button>
            <div className="ls-index-rule" />
            {[...counts.entries()].filter(([name]) => name !== ALL).map(([name, count]) => (
              <button key={name} type="button" className={cat === name ? 'ls-cat on' : 'ls-cat'} onClick={() => setCat(name)}>
                <span>{name}</span><em>{String(count).padStart(2, '0')}</em>
              </button>
            ))}
          </nav>
        </aside>

        <div className="ls-catalog-main">
          <div className="ls-wall-head">
            <span><b>{styles.length}</b> 种</span>
            {q ? <button type="button" onClick={() => setQ('')}>清除</button> : <span>按目录序 · 11 类</span>}
          </div>
          <div className="ls-wall">
            {cats.map((section, catIndex) => (
              <React.Fragment key={section.name}>
                <div className="ls-sec-head">
                  <span className="ls-sec-ix">{String(catIndex + 1).padStart(2, '0')}</span>
                  <h2>{section.name}</h2>
                  <span className="ls-sec-ct">{section.items.length}</span>
                </div>
                {section.items.map((item, index) => (
                  <Plate key={item.slug} style={item} lead={index === 0} onClick={() => onOpenStyle(item)} />
                ))}
              </React.Fragment>
            ))}
            {!cats.length ? <p className="ls-empty">暗房里没有这一张。试试水彩、ink-wash，或 slug。</p> : null}
          </div>
        </div>
      </div>
      <footer className="ls-gallery-foot">
        <span>LEMO-OPUSCAR · {lib.info?.commit || 'local'} · {styles.length} 种风格</span>
        <span>海报是风格样片，不是这一支片的画面</span>
      </footer>
    </div>
  )
}

function Plate({ style, lead, onClick }) {
  return (
    <button type="button" className={`ls-plate ${lead ? 'lead' : ''}`} onClick={onClick}>
      <span className="ls-plate-frame">
        <img loading="lazy" src={style.posterUrl} alt={style.cn} />
        <span className="ls-vignette" />
        <span className="ls-float">＋</span>
        <span className="ls-plate-tag">{style.num}</span>
      </span>
      <span className="ls-plate-cap">
        <span className="ls-cap-num">{style.num}</span>
        <span className="ls-cap-cn">{style.cn}</span>
        <span className="ls-cap-en">{style.en}</span>
        <span className="ls-cap-dur">{fmtDur(style.dur)}</span>
        <span className="ls-cap-line">{style.lineCn || style.line}</span>
      </span>
    </button>
  )
}

function stageLabel(id) {
  return (STAGES.find((s) => s.id === id) || STAGES[0]).label
}

/* ── new film ────────────────────────────────────────────────────────────── */

function NewFilm({ style, onBack, onCreate }) {
  const [title, setTitle] = useState('')
  const [idea, setIdea] = useState('')
  const [language, setLanguage] = useState('中文')
  const [duration, setDuration] = useState(45)
  const [voice, setVoice] = useState(true)
  const [story, setStory] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ideaRef = useRef(null)

  useEffect(() => {
    ideaRef.current?.focus()
  }, [])

  const submit = async () => {
    if (!idea.trim() || busy) {
      setError('先写下一句要拍的。没有这句，导演开不了组。')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onCreate({
        style: style.slug,
        title: title.trim() || deriveTitle(idea, style),
        idea: idea.trim(),
        language,
        duration,
        voice,
        storyboard: story,
      })
    } catch (reason) {
      setError(String(reason.message || reason))
      setBusy(false)
    }
  }

  return (
    <div className="ls-new">
      <div className="ls-hero">
        <img src={style.posterUrl} alt={style.cn} />
        <button type="button" className="ls-hero-back" onClick={onBack}>放映单</button>
        <div className="ls-hero-copy">
          <div className="ls-hero-num">{style.num} · {style.categoryCn}</div>
          <h2>{style.cn}</h2>
          <p className="ls-hero-en">{style.en}</p>
          <p className="ls-hero-line">{style.lineCn || style.line}</p>
          <p className="ls-hero-meta">{style.categoryCn} · 参考 {fmtDur(style.dur)} · 样片 {style.film}</p>
        </div>
      </div>

      <div className="ls-form-col">
        <p className="ls-form-kicker">{style.num} · 新建</p>
        <label className="ls-field-lab" htmlFor="idea">想法</label>
        <textarea
          id="idea"
          ref={ideaRef}
          className={`ls-idea ${error ? 'bad' : ''}`}
          value={idea}
          onChange={(event) => { setIdea(event.target.value); setError('') }}
          spellCheck={false}
          placeholder="写一句要拍的。谁，在哪，发生什么。"
        />
        <p className={`ls-idea-err ${error ? 'on' : ''}`}>{error || '先写下一句要拍的。导演从这句话开始，不猜。'}</p>

        <label className="ls-field-lab" htmlFor="film-title">片名 <em>可留空，导演会起</em></label>
        <input id="film-title" className="ls-title-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="潮水退去之前" />

        <div className="ls-opt-row">
          <span className="ls-lab">语言</span>
          <Choices name="lang" value={language} options={[['中文', '中文'], ['English', 'English']]} onChange={setLanguage} />
        </div>
        <div className="ls-opt-row">
          <span className="ls-lab">时长</span>
          <Choices name="dur" value={duration} options={[[30, '30'], [45, '45'], [60, '60']]} onChange={(value) => setDuration(Number(value))} />
        </div>
        <div className="ls-opt-row">
          <span className="ls-lab">配音</span>
          <Choices name="voice" value={voice} options={[[true, '要'], [false, '不要']]} onChange={(value) => setVoice(value === true || value === 'true')} />
        </div>

        <button type="button" className="ls-adv" onClick={() => setAdvanced((value) => !value)}>
          {advanced ? '收起高级' : '高级 · 先看分镜'}
        </button>
        {advanced ? (
          <label className="ls-check">
            <input type="checkbox" checked={story} onChange={(event) => setStory(event.target.checked)} />
            <i />
            <span>先看 6–9 张分镜，再开工 <em>多一轮确认</em></span>
          </label>
        ) : null}

        <div className="ls-actions">
          <button type="button" className="ls-btn primary" onClick={submit} disabled={busy}>{busy ? '建组中…' : '建组，交给导演'}</button>
          <button type="button" className="ls-btn-text" onClick={onBack}>换一个风格</button>
        </div>
        <p className="ls-fineprint">建组会写下 <code>BRIEF.md</code> 和 <code>project.json</code>；导演先写 Treatment，不画画面。</p>
      </div>
    </div>
  )
}

function Choices({ name, value, options, onChange }) {
  return (
    <div className="ls-choices">
      {options.map(([option, label]) => (
        <button
          key={String(option)}
          type="button"
          className={String(value) === String(option) ? 'on' : ''}
          onClick={() => onChange(option)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function deriveTitle(idea, style) {
  const first = String(idea).split(/[，。！？；,.!?;]/)[0].trim()
  return (first || style.cn).slice(0, 14)
}

/* ── desk ────────────────────────────────────────────────────────────────── */

function Desk({ film, stage, setStage, job, status, chat, dockOpen, setDockOpen, onSend, onStop, onJob, onRefresh, onGallery, onFlash }) {
  const [selected, setSelected] = useState(0)
  const [menu, setMenu] = useState(false)
  const [playing, setPlaying] = useState(null)
  const [viewer, setViewer] = useState(null)
  const [titleDraft, setTitleDraft] = useState(film.title)
  const stills = film.stills || []
  const boardStills = film.boardStills || []
  const renders = film.renders || []
  const meta = STAGES.find((item) => item.id === stage) || STAGES[0]
  const activeStill = stills[selected] || null
  const dirty = !film.agentPainted && stills.length > 0
  const running = job?.status === 'running'

  useEffect(() => {
    if (selected > stills.length - 1) setSelected(Math.max(0, stills.length - 1))
  }, [stills.length, selected])

  useEffect(() => {
    setTitleDraft(film.title)
  }, [film.title])

  const commitTitle = async () => {
    const next = titleDraft.replace(/[《》]/g, '').trim()
    if (!next || next === film.title) {
      setTitleDraft(film.title)
      return
    }
    try {
      await api.updateFilm(film.id, { title: next })
      await onRefresh()
    } catch (error) {
      onFlash(String(error.message || error))
      setTitleDraft(film.title)
    }
  }

  const openViewer = (payload) => {
    setViewer(payload)
  }

  const submitAnnotation = async ({ box, note }) => {
    if (!viewer) return
    const result = await api.annotate(film.id, { p: viewer.sourcePath, box, note })
    const lines = [
      `我在 ${viewer.sourcePath} 上框了一块（x=${box.x}, y=${box.y}, ${box.w}×${box.h}px）。`,
      `裁图：${result.crop.absolute}`,
      `标注全图：${result.marked.absolute}`,
      `问题：${note || '这一块不对，按 STYLE.md 修。'}`,
      '只改这一处，别动其他镜头和时间轴。先 read_image 看裁图和标注全图，再改绘制代码。',
    ]
    await onSend({ action: 'chat', message: lines.join('\n') })
    setViewer(null)
    onFlash('已把框选和批注交给导演')
  }

  const qc = buildQC(film, stills, renders)
  const stageDone = (id) => {
    if (id === 'brief') return true
    if (id === 'treatment') return Boolean(film.treatment)
    if (id === 'look') return stills.length > 0
    if (id === 'storyboard') return Boolean(film.contact) || boardStills.length > 0
    if (id === 'sound') return Boolean(film.mix) || film.voices.length > 0
    if (id === 'film') return renders.length > 0
    return false
  }

  return (
    <div className="ls-desk">
      <header className="ls-top">
        <button type="button" className="ls-back" onClick={onGallery}>放映单</button>
        <div className="ls-titleline">
          <span className="ls-bq">《</span>
          <input
            value={titleDraft}
            aria-label="片名"
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') { setTitleDraft(film.title); event.currentTarget.blur() }
            }}
          />
          <span className="ls-bq">》</span>
        </div>
        <div className="ls-meta">{film.style.cn} · {fmtDur(film.brief.duration)} · {film.brief.language} · {stageLabel(stage)}</div>
        <div className="ls-statusline">{running ? jobLabel(job) : status}</div>
        <button type="button" className="ls-btn-ghost" onClick={() => api.revealFilm(film.id)}>在 Finder 中显示</button>
        {menu ? (
          <span className="ls-menu">
            <button type="button" onClick={() => { setMenu(false); onJob('video', () => api.renderVideo(film.id, 'draft'), '渲染草稿') }}>草稿 · 720p</button>
            <button type="button" onClick={() => { setMenu(false); onJob('video', () => api.renderVideo(film.id, 'final'), '渲染成片') }}>成片 · 1080p</button>
          </span>
        ) : null}
        <button type="button" className="ls-btn primary top" onClick={() => setMenu((value) => !value)} disabled={running}>新渲染</button>
        {running ? <div className="ls-rbar on"><i style={{ width: `${Math.max(3, jobProgress(job) * 100)}%` }} /></div> : null}
      </header>

      <div className={`ls-body ${dockOpen ? '' : 'shut'}`}>
        <aside className="ls-rail">
          <div className="ls-rail-stages">
            {STAGES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ls-stage-btn ${item.id === stage ? 'on' : ''} ${stageDone(item.id) ? 'done' : ''}`}
                onClick={() => setStage(item.id)}
              >
                <i className="ls-hole" />
                <span className="ls-stage-n">{item.n}</span>
                <span className="ls-stage-name">{item.label}</span>
              </button>
            ))}
          </div>
          <div className="ls-rail-foot">
            <span>阶段</span><strong>{String(stageIndex(stage) + 1).padStart(2, '0')} / 06</strong>
          </div>
          <div className="ls-rail-foot">
            <span>抽帧</span><strong>{stills.length}</strong>
          </div>
          <div className="ls-rail-foot">
            <span>版本</span><strong>{renders.length || '—'}</strong>
          </div>
        </aside>

        <main className="ls-stage">
          <div className="ls-stage-head">
            <div className="ls-stage-title">
              <span className="ls-stage-no">{meta.n}</span>
              <b>{meta.label}</b>
              <span className="ls-stage-flag">{stageFlag(film, stage, stills)}</span>
            </div>
            <span className="ls-spacer" />
            {stage === 'look' && stills.length ? (
              <>
                <button type="button" className="ls-btn-ghost" onClick={() => onJob('stills', () => api.renderStills(film.id), '抽帧')} disabled={running}>重抽帧</button>
                <button type="button" className="ls-btn-text" onClick={() => onSend({ action: 'look', message: '只改第 2 帧的绘制代码，不动时间轴；改完重抽同一组时间点。' })}>让导演改这一帧</button>
              </>
            ) : null}
            {stage === 'storyboard' && !film.contact ? (
              <button type="button" className="ls-btn-ghost" onClick={() => onJob('sheet', () => api.renderSheet(film.id), '拼分镜表')} disabled={running}>拼分镜表</button>
            ) : null}
            {stage === 'treatment' && !film.treatment ? (
              <button type="button" className="ls-btn-ghost" onClick={() => onSend({ action: 'treatment', message: '写 TREATMENT.md：三个结构，选一个，附镜头表和 cue map。' })}>让导演写</button>
            ) : null}
          </div>

          <div className="ls-stage-body">
            {stage === 'brief' ? <BriefPanel film={film} /> : null}
            {stage === 'treatment' ? (
              <TreatmentPanel film={film} onAsk={() => onSend({ action: 'treatment', message: '重写 TREATMENT.md，结构收紧一点。' })} />
            ) : null}
            {stage === 'look' ? (
              <LookPanel
                film={film}
                stills={stills}
                selected={selected}
                setSelected={setSelected}
                active={activeStill}
                dirty={dirty}
                onJob={onJob}
                onView={openViewer}
                onAsk={() => onSend({ action: 'look', message: '只改第 2 帧的绘制代码，别动时间轴；改完重抽同一组时间点。' })}
              />
            ) : null}
            {stage === 'storyboard' ? (
              <StoryboardPanel
                film={film}
                boardStills={boardStills}
                onJob={onJob}
                onView={openViewer}
                onAsk={() => onSend({ action: 'storyboard', message: '做 6–9 张关键帧，拼一张分镜表，标镜号、景别、时长，拼完停下等我确认。' })}
              />
            ) : null}
            {stage === 'sound' ? <SoundPanel film={film} onAsk={() => onSend({ action: 'sound', message: '先做配音，逐条回读；再做配乐与混音，输出 out/mix.wav。' })} /> : null}
            {stage === 'film' ? (
              <FilmPanel film={film} renders={renders} playing={playing} setPlaying={setPlaying} onJob={onJob} onAsk={() => onSend({ action: 'film', message: '先渲染 10–15 秒草稿看节奏，过了再整片；跑 readcheck 和响度检查。' })} />
            ) : null}
          </div>

          <div className="ls-qc">
            {qc.map((item) => (
              <span key={item.k}><b>{item.k}</b>{item.v}</span>
            ))}
          </div>
        </main>

        <ChatDock
          film={film}
          stage={stage}
          sessionId={chat.sessionId}
          messages={chat.messages}
          running={chat.running}
          error={chat.error}
          collapsed={!dockOpen}
          onToggle={() => setDockOpen((value) => !value)}
          onSend={onSend}
          onStop={onStop}
        />
      </div>

      {viewer ? (
        <ImageViewer
          src={viewer.src}
          title={viewer.title}
          subtitle={viewer.subtitle}
          onClose={() => setViewer(null)}
          onSubmit={submitAnnotation}
        />
      ) : null}
    </div>
  )
}

function jobLabel(job) {
  if (job.kind === 'video') return `video.mjs · ${Math.round(jobProgress(job) * 100)}%`
  if (job.kind === 'stills') return `still.mjs · ${Math.round(jobProgress(job) * 100)}%`
  if (job.kind === 'sheet') return 'sheet.py · 拼版中'
  if (job.kind === 'readcheck') return 'readcheck · 检查中'
  return '处理中'
}

function stageFlag(film, stage, stills) {
  if (stage === 'look') return stills.length ? (film.agentPainted ? '真实抽帧' : '骨架 · 不是风格画面') : '未抽帧'
  if (stage === 'film') return film.renders.length ? `${film.renders.length} 版` : '未渲染'
  if (stage === 'treatment') return film.treatment ? 'TREATMENT.md 已落盘' : '未写'
  if (stage === 'sound') return film.mix ? 'out/mix.wav' : '未开始'
  if (stage === 'storyboard') return film.contact ? (film.contactName || '分镜表') : (film.boardStills?.length ? `${film.boardStills.length} 格` : '可选')
  return 'BRIEF.md'
}

function buildQC(film, stills, renders) {
  const active = renders[0]
  return [
    { k: 'READCHECK', v: film.treatment ? '待成片' : '—' },
    { k: 'LOUDNESS', v: active?.loudness || (film.mix ? '待测' : '—') },
    { k: 'TIMEBASE', v: `${fmtDur(film.brief.duration)} / 24fps` },
    { k: 'RENDER', v: active ? fmtBytes(active.size) : '—' },
    { k: 'FRAME', v: stills.length ? `${stills.length} 张` : '—' },
    { k: '绘制', v: film.agentPainted ? '已替换' : '骨架' },
  ]
}

function BriefPanel({ film }) {
  return (
    <div className="ls-page-in">
      <h3>简报</h3>
      <p className="ls-dek">建组时写进 BRIEF.md 的就是这些。导演不再追问。</p>
      <table className="ls-kv">
        <tbody>
          <tr><th>想法</th><td>{film.brief.idea}</td></tr>
          <tr><th>语言</th><td>{film.brief.language}</td></tr>
          <tr><th>时长</th><td>{film.brief.duration} 秒</td></tr>
          <tr><th>配音</th><td>{film.brief.voice ? '要' : '不要'}</td></tr>
          <tr><th>分镜</th><td>{film.brief.storyboard ? '先看' : '先不看'}</td></tr>
          <tr><th>画法</th><td>{film.style.cn} · styles/{film.style.slug}</td></tr>
          <tr><th>项目</th><td className="ls-mono">films/{film.id}</td></tr>
        </tbody>
      </table>
    </div>
  )
}

function TreatmentPanel({ film, onAsk }) {
  if (!film.treatment) {
    return (
      <div className="ls-page-in">
        <h3>Treatment</h3>
        <p className="ls-dek">导演会先写三个结构方案、镜头表和声音设计，再动绘制代码。</p>
        <button type="button" className="ls-btn primary" onClick={onAsk}>让导演写 Treatment</button>
      </div>
    )
  }
  return (
    <div className="ls-page-in ls-treatment">
      <Markdown text={film.treatment} />
      <div className="ls-row-actions"><button type="button" className="ls-btn-text" onClick={onAsk}>让导演重写</button></div>
    </div>
  )
}

function LookPanel({ film, stills, selected, setSelected, active, dirty, onJob, onAsk, onView }) {
  if (!stills.length) {
    return (
      <div className="ls-page-in">
        <h3>风格帧</h3>
        <p className="ls-dek">{film.agentPainted ? '绘制代码已经换过，先抽三张看风格。' : '现在还是骨架。可以让导演出第一版风格帧，或先抽骨架帧看时间轴。'}</p>
        <div className="ls-row-actions">
          <button type="button" className="ls-btn primary" onClick={onAsk}>让导演做风格帧</button>
          <button type="button" className="ls-btn-ghost" onClick={() => onJob('stills', () => api.renderStills(film.id), '抽帧')}>抽骨架帧</button>
        </div>
      </div>
    )
  }
  return (
    <div className="ls-stage-in">
      <div className="ls-screen-col">
        <div className="ls-matte">
          <div className="ls-gate" onClick={() => onView({ src: active?.url, sourcePath: `stills/${active?.name}`, title: `帧 ${String(selected + 1).padStart(2, '0')}`, subtitle: `${Number(active?.t || 0).toFixed(2)}s · 滚轮缩放，框选交给导演` })} style={{ cursor: 'zoom-in' }}>
            <img src={active?.url} alt="" />
            <span className="ls-tc">{fmtTC(active?.t || 0)}</span>
            {!film.agentPainted ? <span className="ls-slate-flag">骨架</span> : null}
          </div>
        </div>
      </div>
      <div className="ls-lower">
        <div className="ls-strip-wrap">
          <div className="ls-perfs" />
          <div className="ls-strip">
            {stills.slice(0, 8).map((still, index) => (
              <button key={still.name} type="button" className={`ls-still ${index === selected ? 'on' : ''}`} onClick={() => setSelected(index)}>
                <img src={still.url} alt="" />
              </button>
            ))}
          </div>
          <div className="ls-perfs" />
        </div>
        <div className="ls-frame-note">
          <div className="ls-readout">
            <span>{fmtTC(active?.t || 0)}</span>
            <span>window.render({Number(active?.t || 0).toFixed(2)}) · 已返回</span>
            <span>{film.agentPainted ? '绘制代码已换' : '骨架'}</span>
          </div>
          <p className="ls-judgment">{film.agentPainted ? '这一帧来自真实绘制代码。对不对，要逐条对 STYLE.md。' : '这是可渲染的骨架，不是风格帧。让导演按 STYLE.md 写第一版画法。'}</p>
          <div className="ls-row-actions">
            <button type="button" className="ls-btn" onClick={() => onJob('stills', () => api.renderStills(film.id), '重抽帧')}>重抽帧</button>
            <button type="button" className="ls-btn-text" onClick={onAsk}>让导演改这一帧</button>
          </div>
        </div>
      </div>
      <div className="ls-checks">
        <Check label="render(t)" value="确定性通过" tone="ok" note="同一时间点同一帧" />
        <Check label="抽帧" value={`${stills.length} 张 · 1920×1080`} note="JPEG 92" />
        <Check label="绘制代码" value={film.agentPainted ? '已由导演替换' : '仍是骨架'} tone={film.agentPainted ? 'ok' : 'warn'} note={`index.html ${film.indexBytes} bytes`} />
        <Check label="风格对照" value={film.agentPainted ? '待你判断' : '未开始'} note="逐条对 STYLE.md" />
      </div>
    </div>
  )
}

function Check({ label, value, note, tone }) {
  return (
    <div className="ls-check-item">
      <span>{label}</span>
      <b className={tone || ''}>{value}</b>
      {note ? <em>{note}</em> : null}
    </div>
  )
}

function StoryboardPanel({ film, boardStills, onJob, onAsk, onView }) {
  const frames = boardStills || []
  return (
    <div className="ls-page-in ls-storyboard">
      <h3>分镜</h3>
      <p className="ls-dek">
        {film.brief.storyboard
          ? '点分镜表或右侧单帧，可以放大、框选、写批注；点头之后才继续。'
          : '导演已经把关键帧摆出来了。点任意一张，可以放大、框选、写批注。'}
      </p>

      <div className={`ls-board-layout ${film.contact && frames.length ? '' : 'single'}`}>
      {film.contact ? (
        <div className="ls-contact-wrap">
          <div className="ls-contact-head">
            <span className="ls-mono">{film.contactName || 'storyboard.jpg'} · {frames.length ? `${frames.length} 张抽帧` : '分镜表'}</span>
            <a className="ls-link" href={film.contact} target="_blank" rel="noreferrer">打开原图</a>
          </div>
          <button
            type="button"
            className="ls-contact"
            onClick={() => onView({ src: film.contact, sourcePath: film.contactName || 'storyboard.jpg', title: film.contactName || '分镜表', subtitle: `${frames.length} 张抽帧 · 滚轮缩放，框选交给导演` })}
          >
            <img src={film.contact} alt="分镜表" />
            <span className="ls-contact-hint">放大 / 框选</span>
          </button>
        </div>
      ) : null}

      {frames.length ? (
        <div className="ls-board">
          {frames.slice(0, 12).map((still, index) => (
            <button
              key={still.name}
              type="button"
              className="ls-board-cell"
              onClick={() => onView({ src: still.url, sourcePath: `stills/${still.name}`, title: `第 ${index + 1} 格`, subtitle: `${Number(still.t || 0).toFixed(2)}s · 滚轮缩放，框选交给导演` })}
            >
              <img src={still.url} alt={`第 ${index + 1} 格`} />
              <span className="ls-board-cap">
                <b>{String(index + 1).padStart(2, '0')}</b>
                <em>{Number((/([0-9]+(?:\.[0-9]+)?)/.exec(still.name) || [])[1] || 0).toFixed(1)}s</em>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      </div>

      {!film.contact && !frames.length ? (
        <p className="ls-empty-line">还没有分镜图。可以让导演补 6–9 张关键帧，或先用现有风格帧拼一张。</p>
      ) : null}

      <div className="ls-row-actions">
        <button type="button" className="ls-btn" onClick={() => onJob('sheet', () => api.renderSheet(film.id), '拼分镜表')}>
          {film.contact ? '重新拼版' : '用现有帧拼一张'}
        </button>
        <button type="button" className="ls-btn-text" onClick={onAsk}>让导演补/改关键帧</button>
      </div>
    </div>
  )
}

function SoundPanel({ film, onAsk }) {
  return (
    <div className="ls-page-in">
      <h3>声音</h3>
      <p className="ls-dek">人声、环境、配乐三层。音乐让人声，不反过来。至少两段真正的静音。</p>
      <table className="ls-kv">
        <tbody>
          <tr><th>配音</th><td>{film.voices.length ? `${film.voices.length} 条` : film.brief.voice ? '要 · 未录' : '不要'}</td></tr>
          <tr><th>配乐</th><td>{film.mix ? '已混' : '未混'}</td></tr>
          <tr><th>响度</th><td>{film.renders[0]?.loudness || '未测'}</td></tr>
          <tr><th>混音文件</th><td className="ls-mono">{film.mix ? 'out/mix.wav' : '—'}</td></tr>
        </tbody>
      </table>
      <div className="ls-row-actions"><button type="button" className="ls-btn primary" onClick={onAsk}>让导演做声音</button></div>
    </div>
  )
}

function FilmPanel({ film, renders, playing, setPlaying, onJob, onAsk }) {
  const active = renders.find((row) => row.file === playing) || renders[0]
  if (!renders.length) {
    return (
      <div className="ls-page-in">
        <h3>成片</h3>
        <p className="ls-dek">{film.mix ? '混音在。可以渲染草稿看节奏，过了再出 1080p。' : '还没有混音。先让导演做声音，或者先渲染一版无音频草稿看画面。'}</p>
        <div className="ls-row-actions">
          <button type="button" className="ls-btn primary" onClick={() => onJob('video', () => api.renderVideo(film.id, 'draft'), '渲染草稿')}>渲染草稿</button>
          <button type="button" className="ls-btn-ghost" onClick={() => onJob('video', () => api.renderVideo(film.id, 'final'), '渲染成片')}>渲染成片</button>
          <button type="button" className="ls-btn-text" onClick={onAsk}>让导演做声音</button>
        </div>
      </div>
    )
  }
  return (
    <div className="ls-stage-in">
      <div className="ls-screen-col">
        <div className="ls-player">
          <video key={active.file} controls src={active.url} poster={film.stills[0]?.url} />
        </div>
      </div>
      <table className="ls-vers">
        <thead><tr><th>版本</th><th>品质</th><th>时长</th><th>响度</th><th>时间</th></tr></thead>
        <tbody>
          {renders.map((row) => (
            <tr key={row.file} className={row.file === active.file ? 'on' : ''}>
              <td><button type="button" onClick={() => setPlaying(row.file)}><i className="ls-sq" />{row.label || '草稿'}</button></td>
              <td className="m">{row.quality === 'draft' ? '720p' : '1080p'}{row.loudness ? ' · 有音频' : ' · 无音频'}</td>
              <td className="m">{fmtDur(row.duration)}</td>
              <td className="m">{row.loudness || '未测'}</td>
              <td className="m">{row.at ? new Date(row.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ls-row-actions">
        <button type="button" className="ls-btn-ghost" onClick={() => onJob('readcheck', () => api.runReadcheck(film.id), '字幕检查')}>readcheck</button>
        <a className="ls-btn-text" href={active.url} target="_blank" rel="noreferrer">打开成片</a>
        <button type="button" className="ls-btn-text" onClick={() => onJob('video', () => api.renderVideo(film.id, 'final'), '渲染成片')}>再渲一版</button>
      </div>
    </div>
  )
}

function Timeline({ film, stills, selected, onSelect }) {
  if (!stills.length) return null
  return (
    <div className="ls-timeline">
      <div className="ls-tl-head">
        <b>{fmtTC(stills[selected]?.t || 0)}</b>
        <span>{film.title} · {film.brief.duration}s</span>
        <span className="ls-spacer" />
        <span>24 fps</span><span>1920×1080</span>
        <span>{stills.length} 帧</span>
      </div>
      <div className="ls-tl-body">
        <div className="ls-tl-track">
          {stills.slice(0, 12).map((still, index) => (
            <button key={still.name} type="button" className={index === selected ? 'on' : ''} onClick={() => onSelect(index)} title={`${still.t}s`}>
              <img src={still.url} alt="" />
            </button>
          ))}
        </div>
        <div className="ls-tl-playhead" style={{ left: `${Math.min(100, ((stills[selected]?.t || 0) / Math.max(1, film.brief.duration)) * 100)}%` }}>
          <span>{Number(stills[selected]?.t || 0).toFixed(2)}</span>
        </div>
      </div>
    </div>
  )
}
