const BASE = '/lemo-studio/api'

async function readJson(response) {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(text.slice(0, 300) || `HTTP ${response.status}`)
  }
}

export async function getJson(route, params) {
  const url = new URL(BASE + route, window.location.origin)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }
  const response = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    headers: { accept: 'application/json' },
  })
  const value = await readJson(response)
  if (!response.ok || value?.ok === false) throw new Error(value?.error || `HTTP ${response.status}`)
  return value
}

export async function postJson(route, body) {
  const response = await fetch(BASE + route, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const value = await readJson(response)
  if (!response.ok || value?.ok === false) {
    const error = new Error(value?.error || `HTTP ${response.status}`)
    error.payload = value
    throw error
  }
  return value
}

export async function patchJson(route, body) {
  const response = await fetch(BASE + route, {
    method: 'PATCH',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const value = await readJson(response)
  if (!response.ok || value?.ok === false) throw new Error(value?.error || `HTTP ${response.status}`)
  return value
}

export const getState = () => getJson('/state')
export const getStyles = () => getJson('/styles')
export const getStyle = (slug) => getJson(`/style/${slug}`)
export const getFilm = (id) => getJson(`/films/${id}`)
export const createFilm = (body) => postJson('/films', body)
export const updateFilm = (id, body) => patchJson(`/films/${id}`, body)
export const renderStills = (id, times) => postJson(`/films/${id}/stills`, { times })
export const renderSheet = (id, body) => postJson(`/films/${id}/sheet`, body)
export const renderVideo = (id, quality) => postJson(`/films/${id}/video`, { quality })
export const runReadcheck = (id) => postJson(`/films/${id}/readcheck`)
export const annotate = (id, body) => postJson(`/films/${id}/annotate`, body)
export const revealFilm = (id) => postJson(`/films/${id}/reveal`)
export const openChatSession = (id) => postJson(`/films/${id}/chat/session`)
export const sendChat = (id, body) => postJson(`/films/${id}/chat/send`, body)
export const stopChat = (id, sessionId) => postJson(`/films/${id}/chat/stop`, { sessionId })
export const getChat = (sessionId) => getJson('/chat/history', { sessionId })
export const getJob = (jobId) => getJson(`/jobs/${jobId}`)
export const cancelJob = (jobId) => postJson(`/jobs/${jobId}/cancel`)

export function fileUrl(id, p) {
  return `/lemo-studio/api/films/${id}/file?p=${encodeURIComponent(p)}`
}

export const posterUrl = (slug) => `/lemo-studio/api/poster/${slug}`

/** Poll a job until it settles; onTick gets the latest job view. */
export async function waitJob(jobId, onTick, { interval = 700, signal } = {}) {
  for (;;) {
    if (signal?.aborted) throw new Error('已取消')
    const { job } = await getJob(jobId)
    onTick?.(job)
    if (job.status !== 'running') return job
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
}
