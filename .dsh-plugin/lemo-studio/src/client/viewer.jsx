import React, { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Full-screen image viewer with zoom, pan and a rectangular annotation.
 * The rectangle is kept in source-image pixels, so it survives zooming.
 */
export default function ImageViewer({ src, title, subtitle, onSubmit, onClose }) {
  const stageRef = useRef(null)
  const imgRef = useRef(null)
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [mode, setMode] = useState('pan')
  const [box, setBox] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const drag = useRef(null)

  const fit = useCallback(() => {
    const stage = stageRef.current
    if (!stage || !natural.w || !natural.h) return
    const rect = stage.getBoundingClientRect()
    const s = Math.min(rect.width / natural.w, rect.height / natural.h) * 0.94
    setScale(s)
    setPos({ x: (rect.width - natural.w * s) / 2, y: (rect.height - natural.h * s) / 2 })
  }, [natural.w, natural.h])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const onWheel = (event) => {
      event.preventDefault()
      const rect = stage.getBoundingClientRect()
      zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, { x: event.clientX - rect.left, y: event.clientY - rect.top })
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  })

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
      if (event.key === '+' || event.key === '=') zoomAt(1.2)
      if (event.key === '-') zoomAt(1 / 1.2)
      if (event.key === '0') fit()
      if (event.key === '1') { setScale(1); centerAt(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (natural.w) fit()
  }, [natural.w, natural.h, fit])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const observer = new ResizeObserver(() => fit())
    observer.observe(stage)
    return () => observer.disconnect()
  }, [fit])

  const centerAt = (next) => {
    const stage = stageRef.current
    if (!stage || !natural.w) return
    const rect = stage.getBoundingClientRect()
    setPos({ x: (rect.width - natural.w * next) / 2, y: (rect.height - natural.h * next) / 2 })
  }

  const zoomAt = (factor, point) => {
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const p = point || { x: rect.width / 2, y: rect.height / 2 }
    const next = Math.min(8, Math.max(0.03, scale * factor))
    const imgX = (p.x - pos.x) / scale
    const imgY = (p.y - pos.y) / scale
    setScale(next)
    setPos({ x: p.x - imgX * next, y: p.y - imgY * next })
  }

  const toImage = (event) => {
    const stage = stageRef.current
    const rect = stage.getBoundingClientRect()
    return {
      x: Math.min(natural.w, Math.max(0, (event.clientX - rect.left - pos.x) / scale)),
      y: Math.min(natural.h, Math.max(0, (event.clientY - rect.top - pos.y) / scale)),
    }
  }

  const onPointerDown = (event) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    if (mode === 'select') {
      const p = toImage(event)
      drag.current = { kind: 'select', start: p }
      setBox({ x: p.x, y: p.y, w: 0, h: 0 })
    } else {
      drag.current = { kind: 'pan', startX: event.clientX, startY: event.clientY, ox: pos.x, oy: pos.y }
    }
  }

  const onPointerMove = (event) => {
    const current = drag.current
    if (!current) return
    if (current.kind === 'pan') {
      setPos({ x: current.ox + event.clientX - current.startX, y: current.oy + event.clientY - current.startY })
      return
    }
    const p = toImage(event)
    const x = Math.min(current.start.x, p.x)
    const y = Math.min(current.start.y, p.y)
    setBox({ x, y, w: Math.abs(p.x - current.start.x), h: Math.abs(p.y - current.start.y) })
  }

  const onPointerUp = (event) => {
    const current = drag.current
    drag.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* optional */ }
    if (current?.kind === 'select' && box && (box.w < 6 || box.h < 6)) setBox(null)
  }

  const submit = async () => {
    if (!box || busy) return
    setBusy(true)
    setError('')
    try {
      await onSubmit({ box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) }, note: note.trim() })
    } catch (reason) {
      setError(String(reason.message || reason))
      setBusy(false)
    }
  }

  const percent = Math.round(scale * 100)

  return (
    <div className="ls-viewer" role="dialog" aria-modal="true" aria-label={title || '查看图片'}>
      <header className="ls-viewer-head">
        <div className="ls-viewer-title">
          <b>{title || '查看'}</b>
          <span>{subtitle}</span>
          {natural.w ? <em>{natural.w} × {natural.h}</em> : null}
        </div>
        <div className="ls-viewer-tools">
          <button type="button" onClick={() => zoomAt(1 / 1.2)} aria-label="缩小">−</button>
          <span className="ls-viewer-zoom">{percent}%</span>
          <button type="button" onClick={() => zoomAt(1.2)} aria-label="放大">＋</button>
          <button type="button" onClick={fit}>适应</button>
          <button type="button" onClick={() => { setScale(1); centerAt(1) }}>1:1</button>
          <button type="button" className={mode === 'select' ? 'on' : ''} onClick={() => setMode(mode === 'select' ? 'pan' : 'select')}>
            {mode === 'select' ? '框选中' : '框选'}
          </button>
          <button type="button" onClick={onClose}>关闭</button>
        </div>
      </header>

      <div
        className={`ls-viewer-stage ${mode === 'select' ? 'select' : 'pan'}`}
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => zoomAt(2)}
      >
        <div className="ls-viewer-canvas" style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})` }}>
          <img
            ref={imgRef}
            src={src}
            alt={title || ''}
            draggable={false}
            onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
            style={{ width: natural.w || undefined, height: natural.h || undefined }}
          />
          {box && box.w > 0 && box.h > 0 ? (
            <span className="ls-viewer-sel" style={{ left: box.x, top: box.y, width: box.w, height: box.h, borderWidth: `${1 / scale}px` }} />
          ) : null}
        </div>
      </div>

      <footer className="ls-viewer-foot">
        {!box ? (
          <span className="ls-viewer-hint">滚轮缩放 · 拖动平移 · 点「框选」后在图上拖出要改的区域</span>
        ) : (
          <div className="ls-annot">
            <span className="ls-annot-box">{Math.round(box.w)} × {Math.round(box.h)} px</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="这块哪里不对？例如：手和袖子的接缝、裙摆被水切成直角…"
              onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
            />
            <button type="button" className="ls-btn sm" onClick={() => setBox(null)}>重框</button>
            <button type="button" className="ls-btn primary sm" onClick={submit} disabled={busy}>{busy ? '交命中' : '交给导演'}</button>
          </div>
        )}
        {error ? <span className="ls-viewer-error">{error}</span> : null}
      </footer>
    </div>
  )
}
