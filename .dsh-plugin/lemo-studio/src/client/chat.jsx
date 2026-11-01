import React, { useEffect, useMemo, useRef, useState } from 'react'

const STAGE_SUGGESTIONS = {
  brief: ['先写 TREATMENT.md，给我三个结构', '这个想法最怕拍成什么？先说清楚'],
  treatment: ['把镜头表压到 6 镜以内', '结尾再狠一点，不要解释'],
  look: ['第 2 帧太灰了，改绘制代码', '先别动时间轴，只修这一帧'],
  storyboard: ['把这 6 帧拼成 contact sheet', '第 4 镜的比例不连戏，改'],
  sound: ['先把 4 条旁白写短', '第 22 秒要真正的静音'],
  film: ['渲染 10–15 秒草稿看节奏', '跑一遍 readcheck，列出超时的字幕'],
}

const QUICK = {
  brief: [
    ['写 Treatment', 'treatment', '按 BRIEF.md 写 TREATMENT.md：三个结构，选一个，附镜头表和 cue map。'],
    ['先说风险', 'chat', '这个想法最容易拍成什么样子？先说清楚，再动手。'],
  ],
  look: [
    ['改这一帧', 'look', '只改第 2 帧的绘制代码，别动时间轴；改完重抽同一组时间点。'],
    ['重抽 3 张', 'look', '用当前绘制代码重抽 3 张风格帧，并排给我看。'],
  ],
  treatment: [
    ['重写 Treatment', 'treatment', '重写 TREATMENT.md，结构再收紧一点。'],
    ['压到 6 镜', 'treatment', '把镜头表压到 6 镜以内，删掉不推动故事的那一镜。'],
  ],
  storyboard: [
    ['做 6 格分镜', 'storyboard', '做 6–9 张关键帧，拼一张 CONTACT.jpg，标镜号、景别、时长；拼完停下等我确认。'],
    ['先不拼', 'chat', '先告诉我这 6 格会怎么分，再决定要不要拼。'],
  ],
  sound: [
    ['先做配音', 'sound', '先把旁白配音做出来，逐条回读，过了再谈配乐。'],
    ['做混音', 'sound', '按 cue map 做混音，至少两段真正的静音，输出 out/mix.wav。'],
  ],
  film: [
    ['渲染草稿', 'film', '先渲染一版 10–15 秒草稿，看节奏，不要整片。'],
    ['整片交付', 'film', '按交付清单做整片：mux、readcheck、响度、黑帧检查。'],
  ],
}

function splitPrompt(text) {
  const marker = '【用户】\n'
  const at = text.indexOf(marker)
  if (at < 0) return { context: '', user: text }
  const tail = text.slice(at + marker.length)
  let end = tail.indexOf('\n\n【约定】')
  if (end < 0) end = tail.indexOf('\n用中文回报')
  if (end < 0) end = tail.indexOf('\n用English')
  const user = (end >= 0 ? tail.slice(0, end) : tail).trim()
  return { context: text.slice(0, at).trim(), user }
}

function RichText({ text }) {
  const blocks = String(text ?? '').split(/```/)
  return (
    <div className="ls-rich">
      {blocks.map((block, index) =>
        index % 2 === 1 ? (
          <pre key={index} className="ls-code">{block.replace(/^[a-z]*\n/i, '')}</pre>
        ) : (
          block
            .split(/\n{2,}/)
            .filter(Boolean)
            .map((para, k) => {
              const lines = para.split('\n')
              if (lines.every((line) => /^\s*[-*]\s+/.test(line) || !line.trim())) {
                return (
                  <ul key={`${index}-${k}`}>
                    {lines.filter((line) => line.trim()).map((line, j) => (
                      <li key={j}>{line.replace(/^\s*[-*]\s+/, '')}</li>
                    ))}
                  </ul>
                )
              }
              return (
                <p key={`${index}-${k}`}>
                  {lines.map((line, j) => (
                    <React.Fragment key={j}>
                      {line}
                      {j < lines.length - 1 ? <br /> : null}
                    </React.Fragment>
                  ))}
                </p>
              )
            })
        ),
      )}
    </div>
  )
}

function Message({ item }) {
  if (item.role === 'error') return <div className="ls-msg is-error"><div className="ls-bubble">{item.text}</div></div>
  if (item.role === 'user') {
    const { context, user } = splitPrompt(item.text)
    return (
      <div className="ls-msg is-user">
        <div className="ls-bubble">
          {context ? (
            <details className="ls-prompt-context">
              <summary>交给导演的上下文</summary>
              <pre>{context}</pre>
            </details>
          ) : null}
          <p>{user || '（空）'}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="ls-msg is-assistant">
      <div className="ls-bubble">
        {item.tools?.length ? (
          <div className="ls-tools">
            {item.tools.map((tool, index) => <span key={`${tool}-${index}`}>{tool}</span>)}
          </div>
        ) : null}
        {item.text ? <RichText text={item.text} /> : null}
      </div>
    </div>
  )
}

export default function ChatDock({
  film,
  stage,
  sessionId,
  messages,
  running,
  error,
  sending,
  collapsed,
  onToggle,
  onSend,
  onStop,
}) {
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const stickRef = useRef(true)
  const [value, setValue] = useState('')
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const suggestions = useMemo(() => STAGE_SUGGESTIONS[stage] || STAGE_SUGGESTIONS.look, [stage])
  const quick = QUICK[stage] || QUICK.brief

  useEffect(() => {
    const el = listRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [messages, running])

  useEffect(() => {
    if (running && !startedAt) setStartedAt(Date.now())
    if (!running) setStartedAt(0)
  }, [running, startedAt])

  useEffect(() => {
    if (!running) return undefined
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [running])

  const elapsed = (() => {
    if (!running || !startedAt) return ''
    const seconds = Math.max(0, Math.round((now - startedAt) / 1000))
    if (seconds < 60) return `${seconds}s`
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`
    return `${Math.round(seconds / 3600)}h`
  })()

  if (collapsed) {
    return (
      <aside className="ls-agent is-collapsed">
        <button type="button" className="ls-agent-open" onClick={onToggle} title="展开导演" aria-label="展开导演">
          <span>导演</span>
        </button>
      </aside>
    )
  }

  const send = (action = 'chat', text = value.trim()) => {
    if (!text && !action) return
    onSend({ action, message: text })
    setValue('')
  }

  return (
    <aside className="ls-agent" aria-label="导演">
      <header className="ls-agent-head">
        <div>
          <span className="ls-dot" data-running={running ? 'true' : 'false'} />
          <b>导演</b>
          <em>{running ? `正在处理 · ${elapsed || '…'}` : sessionId ? '项目会话 · 已绑定' : '项目会话 · 未绑定'}</em>
        </div>
        <div className="ls-agent-head-actions">
          {running ? <button type="button" className="ls-agent-stop" onClick={onStop}>停止</button> : null}
          <button type="button" onClick={onToggle} aria-label="收起导演">⟩</button>
        </div>
      </header>

      <div
        className="ls-agent-body"
        ref={listRef}
        onScroll={() => {
          const el = listRef.current
          if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
      >
        <div className="ls-agent-ctx">
          项目：{film?.title || '未命名'} · {film?.style?.cn || '—'}
          <br />
          阶段 {stage || 'brief'} · {film?.brief?.duration || 0} 秒 · {film?.brief?.language || '中文'}
          <br />
          项目会话 {sessionId ? `…${sessionId.slice(-8)}` : '未绑定'} · 工坊不提供新建对话
        </div>

        {!sessionId && !messages.length ? (
          <div className="ls-agent-intro">
            <p>这个项目还没有绑定导演会话。重新打开影片，工坊会为它绑定唯一一个会话；之后不再新建。</p>
          </div>
        ) : null}

        {messages
          .filter((item) => item.role !== 'assistant' || String(item.text || '').trim())
          .map((item, index) => <Message key={`${item.seq}-${index}`} item={item} />)}

        {running ? (
          <div className="ls-msg is-assistant">
            <div className="ls-bubble ls-typing"><span /><span /><span /><em>导演正在处理…</em></div>
          </div>
        ) : null}

        {!messages.length && sessionId ? (
          <div className="ls-suggestions">
            {suggestions.map((text) => (
              <button key={text} type="button" onClick={() => setValue(text)}>{text}</button>
            ))}
          </div>
        ) : null}
      </div>

      {error ? <div className="ls-agent-error">{error}</div> : null}

      <div className="ls-agent-quick">
        {quick.map(([label, action, message]) => (
          <button key={label} type="button" onClick={() => send(action, message)}>{label}</button>
        ))}
      </div>

      <footer className="ls-agent-input">
        <textarea
          ref={inputRef}
          value={value}
          rows={2}
          placeholder="跟导演说：改哪一帧、保什么、不要动什么…"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              if (value.trim()) send('chat')
            }
            if (event.key === 'Escape') event.currentTarget.blur()
          }}
        />
        <div className="ls-agent-foot">
          <span>Enter 发送 · Shift+Enter 换行</span>
          {running ? <button type="button" className="ls-link" onClick={onStop}>停止</button> : null}
          <button type="button" className="ls-send" onClick={() => send('chat')} disabled={!value.trim() || sending} aria-label="发送">↑</button>
        </div>
      </footer>
    </aside>
  )
}
