import React from 'react'
import App from './app'
import styles from './styles.css'

const PANEL_ID = 'lemo-studio'

function mainSessionId(ctx) {
  try {
    const snapshot = ctx.sessions?.list?.getSnapshot?.()
    const rows = snapshot?.byId ?? {}
    for (const [id, row] of Object.entries(rows)) {
      if ((row?.retainedBy?.mainView ?? 0) > 0) return id
    }
  } catch {
    /* session service is optional */
  }
  return undefined
}

function createBridge(ctx) {
  return {
    sessionId() {
      return mainSessionId(ctx)
    },
    open() {
      ctx.layout?.selectPanel?.(PANEL_ID)
    },
  }
}

export function StudioIcon({ size = 18 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" style={{ color: 'currentColor' }}>
      <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.2 8.2h17.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7 4.6v3.6M12 4.6v3.6M17 4.6v3.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 12.4h6.2M7 16h4.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="17.2" cy="14.8" r="1.7" fill="currentColor" />
    </svg>
  )
}

function LaunchButton() {
  return (
    <button
      type="button"
      className="ls-launch"
      data-ls-launch
      onClick={() => document.dispatchEvent(new CustomEvent('ls:open'))}
      title="打开视频工坊 · Lemo 影棚"
    >
      <StudioIcon size={16} />
      <span>视频</span>
    </button>
  )
}

export const inject = ['slots', 'sessions', 'conversation', 'layout']

export function apply(ctx) {
  const bridge = createBridge(ctx)

  ctx.effect(
    () => {
      const style = document.createElement('style')
      style.dataset.lemoStudio = ''
      style.textContent = styles
      document.head.append(style)
      return () => style.remove()
    },
    'lemo-studio: styles',
  )

  ctx.effect(
    () => {
      const open = () => bridge.open()
      document.addEventListener('ls:open', open)
      return () => document.removeEventListener('ls:open', open)
    },
    'lemo-studio: open event',
  )

  ctx.slots.inject('main', function* () {
    yield ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
        inject: () => ({ host: bridge }),
      },
      App,
    )
  })

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 5,
        label: () => '视频工坊',
      },
      StudioIcon,
    ),
  )

  ctx.slots.inject('conversation.input.right', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.right',
        id: 'lemo-studio-launch',
        order: 41,
      },
      LaunchButton,
    ),
  )
}
