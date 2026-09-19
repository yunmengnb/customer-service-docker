// 忆梦云团队开发 - 私有媒体 IndexedDB 与对象 URL 共享缓存
const DB_NAME = 'yimeng-private-media-v2'
const DB_VERSION = 1
const STORE = 'media'
const DEFAULT_LIMIT = 100 * 1024 * 1024
const MIN_LIMIT = 16 * 1024 * 1024
const MAX_ITEM = { original: 20 * 1024 * 1024, thumbnail: 8 * 1024 * 1024, avatar: 2 * 1024 * 1024 }
const INVALID_HTTP = new Set([403, 404, 410])
const memory = new Map()
const inflight = new Map()
const revalidating = new Map()
const listeners = new Map()
let dbPromise

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (!dbPromise) dbPromise = new Promise(resolve => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' })
        store.createIndex('scope', 'scope')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return dbPromise
}
function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function withStore(mode, run) {
  try {
    const db = await openDb()
    if (!db) return null
    const tx = db.transaction(STORE, mode)
    const result = await run(tx.objectStore(STORE))
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    return result
  } catch { return null }
}
function clean(value) { return encodeURIComponent(String(value || 'unknown')) }
export function privateMediaKey({ scope, resourceId, kind, version }) {
  if (!scope || !resourceId || !['original', 'thumbnail', 'avatar'].includes(kind)) return ''
  return [scope, clean(resourceId), kind, clean(version || 'unversioned')].join(':')
}
function statusOf(error) { return Number(error?.httpStatus || error?.response?.status || 0) }
function notify(key, reason) { for (const fn of listeners.get(key) || []) fn(reason) }
export function subscribePrivateMedia(key, fn) {
  if (!key || typeof fn !== 'function') return () => {}
  if (!listeners.has(key)) listeners.set(key, new Set())
  listeners.get(key).add(fn)
  return () => {
    listeners.get(key)?.delete(fn)
    if (!listeners.get(key)?.size) listeners.delete(key)
  }
}
async function capacity() {
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (!estimate?.quota) return DEFAULT_LIMIT
    return Math.max(MIN_LIMIT, Math.min(DEFAULT_LIMIT, Math.floor(estimate.quota * 0.1)))
  } catch { return DEFAULT_LIMIT }
}
async function removeRows(rows) {
  if (!rows.length) return
  await withStore('readwrite', store => { rows.forEach(row => store.delete(row.key)) })
}
async function makeSpace(incoming = 0) {
  const rows = await withStore('readonly', store => requestResult(store.getAll())) || []
  const oldest = rows.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)
  let usage = oldest.reduce((sum, row) => sum + Number(row.size || 0), 0)
  const limit = await capacity()
  const targets = []
  while (oldest.length && usage + incoming > limit) {
    const row = oldest.shift(); targets.push(row); usage -= Number(row.size || 0)
  }
  await removeRows(targets)
}
async function persist(row) {
  if (!row.blob || row.blob.size > (MAX_ITEM[row.kind] || 0)) return
  try {
    await makeSpace(row.blob.size)
    await withStore('readwrite', store => requestResult(store.put(row)))
  } catch { /* quota/IndexedDB failures must not affect network display */ }
}
async function revalidate(descriptor, key, verify) {
  if (!verify || revalidating.has(key)) return
  const task = Promise.resolve().then(() => verify(descriptor)).then(result => {
    if (result === false || (result?.version && String(result.version) !== String(descriptor.version || 'unversioned'))) return invalidatePrivateMedia(descriptor, 'changed')
  }).catch(error => {
    if (INVALID_HTTP.has(statusOf(error))) return invalidatePrivateMedia(descriptor, 'forbidden')
  }).finally(() => revalidating.delete(key))
  revalidating.set(key, task)
}
export async function loadPrivateMedia(descriptor, loader, verify) {
  const key = privateMediaKey(descriptor)
  if (typeof loader !== 'function') return { blob: null, key, cached: false }
  if (!key) return { blob: await loader(), key, cached: false }
  if (inflight.has(key)) return inflight.get(key)
  const task = (async () => {
    const cached = await withStore('readonly', store => requestResult(store.get(key)))
    if (cached?.blob) {
      void withStore('readwrite', store => requestResult(store.put({ ...cached, lastAccessedAt: Date.now() })))
      setTimeout(() => {
        void revalidate(descriptor, key, verify)
      }, 0)
      return { blob: cached.blob, key, cached: true }
    }
    const blob = await loader()
    if (!blob) return { blob: null, key, cached: false }
    const now = Date.now()
    await persist({ key, scope: descriptor.scope, resourceId: String(descriptor.resourceId), kind: descriptor.kind, version: String(descriptor.version || 'unversioned'), blob, size: blob.size, mimeType: String(blob.type || ''), cachedAt: now, lastAccessedAt: now })
    return { blob, key, cached: false }
  })().finally(() => inflight.delete(key))
  inflight.set(key, task)
  return task
}
export function acquireObjectUrl(key, blob) {
  if (!key || !blob || typeof URL?.createObjectURL !== 'function') return null
  let entry = memory.get(key)
  if (!entry) {
    entry = { url: URL.createObjectURL(blob), refs: 0 }
    memory.set(key, entry)
  }
  entry.refs++
  return entry.url
}
export function releaseObjectUrl(key) {
  const entry = memory.get(key)
  if (!entry) return
  entry.refs = Math.max(0, entry.refs - 1)
  if (!entry.refs) { URL.revokeObjectURL(entry.url); memory.delete(key) }
}
export async function invalidatePrivateMedia(descriptor, reason = 'invalid') {
  const prefix = descriptor.kind ? privateMediaKey(descriptor) : `${descriptor.scope}:${clean(descriptor.resourceId)}:`
  const keys = new Set([...memory.keys(), ...listeners.keys()].filter(key => descriptor.kind ? key === prefix : key.startsWith(prefix)))
  keys.forEach(key => {
    const entry = memory.get(key)
    if (entry) URL.revokeObjectURL(entry.url)
    memory.delete(key)
    notify(key, reason)
  })
  const rows = await withStore('readonly', store => requestResult(store.getAll())) || []
  await removeRows(rows.filter(row => row.scope === descriptor.scope && String(row.resourceId) === String(descriptor.resourceId) && (!descriptor.kind || row.kind === descriptor.kind)))
}
export async function clearPrivateMediaScope(scope, persistent = false) {
  if (!scope) return
  for (const [key, entry] of memory) if (key === scope || key.startsWith(`${scope}:`)) { URL.revokeObjectURL(entry.url); memory.delete(key); notify(key, 'scope-cleared') }
  if (persistent) {
    const rows = await withStore('readonly', store => requestResult(store.getAll())) || []
    await removeRows(rows.filter(row => row.scope === scope || row.scope.startsWith(`${scope}:`)))
  }
}
export async function cleanupPrivateMediaCache(scope = '') {
  const rows = await withStore('readonly', store => requestResult(store.getAll())) || []
  if (!scope) return removeRows(rows)
  await removeRows(rows.filter(row => row.scope === scope || row.scope.startsWith(`${scope}:`)))
}
