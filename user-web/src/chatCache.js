// 忆梦云团队开发 - 浏览器聊天消息与媒体缓存
import { readTenantCache } from './api'
import { reportDebugEvent } from './attachmentActions'
import {
  cleanupPrivateMediaCache,
  clearPrivateMediaScope,
  invalidatePrivateMedia,
  loadPrivateMedia,
  privateMediaKey,
} from './services/privateMediaCache'
export {
  acquireObjectUrl,
  privateMediaKey,
  releaseObjectUrl,
  subscribePrivateMedia,
} from './services/privateMediaCache'
const DB_NAME = 'yimeng-chat-cache-v1'
const DB_VERSION = 2
const MEDIA_CACHE = 'yimeng-chat-media-v1'
export const CHANNEL_CACHE_FRESHNESS = 30 * 1000
const DAY = 24 * 60 * 60 * 1000
const MESSAGE_TTL = 30 * DAY
const ATTACHMENT_TTL = 2 * DAY
const IMAGE_LIMIT = 20 * 1024 * 1024
const AVATAR_LIMIT = 2 * 1024 * 1024
const MEDIA_LIMIT = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 768px)').matches ? 150 * 1024 * 1024 : 500 * 1024 * 1024
const INVALID_STATUSES = new Set(['expired', 'recalled', 'deleted'])
const cleanupTimers = new Map()
let dbPromise

function supported() { return typeof indexedDB !== 'undefined' }
function openDb() {
  if (!supported()) return Promise.resolve(null)
  if (!dbPromise) dbPromise = new Promise(resolve => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('conversations')) db.createObjectStore('conversations', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('messages')) {
        const store = db.createObjectStore('messages', { keyPath: 'key' })
        store.createIndex('scopeConversation', ['scope', 'conversationId'])
      }
      if (!db.objectStoreNames.contains('attachments')) db.createObjectStore('attachments', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('syncState')) db.createObjectStore('syncState', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('channels')) db.createObjectStore('channels', { keyPath: 'key' })
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
async function withStore(names, mode, run) {
  try {
    const db = await openDb()
    if (!db) return null
    const transaction = db.transaction(names, mode)
    const result = await run(transaction)
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    return result
  } catch { return null }
}
function valueId(value) { return String(value?._id || value?.id || '') }
function messageCursor(message) { return message?.sequence ?? valueId(message) }
function mediaRequest(cacheKey) { return new Request(`${location.origin}/__yimeng_chat_cache__/${encodeURIComponent(cacheKey)}`) }
function attachmentExpiry(message, now) {
  return message.attachmentExpiredAt || message.expiresAt || new Date(new Date(message.createdAt || now).getTime() + ATTACHMENT_TTL).toISOString()
}

export function tenantIdentityScope() {
  try {
    const user = readTenantCache('tenant_user')
    const tenant = readTenantCache('tenant_info')
    if (!user?._id || !(tenant?._id || user?.tenantId)) return ''
    return ['staff', user.role || 'agent', tenant?._id || user.tenantId, user._id].map(String).join(':')
  } catch { return '' }
}
export function tenantCacheScope(channelId = '') {
  const identityScope = tenantIdentityScope()
  return identityScope ? `${identityScope}:${channelId || 'all'}` : ''
}
function attachmentVersion(message, kind) {
  return message?.attachmentVersion || message?.attachmentUpdatedAt || message?.updatedAt || message?.attachmentHash || `${message?.attachmentId || 'unknown'}:${kind}:v1`
}
export function mediaCacheKey(scope, message, thumbnail = false) {
  const kind = thumbnail ? 'thumbnail' : 'original'
  return privateMediaKey({ scope, resourceId: message?.attachmentId, kind, version: attachmentVersion(message, kind) })
}
export function avatarCacheKey(scope, url, resource = {}) {
  return privateMediaKey({ scope, resourceId: String(resource.id || url), kind: 'avatar', version: resource.version || url })
}

export async function cacheConversations(scope, conversations) {
  if (!scope || !Array.isArray(conversations)) return
  const now = Date.now()
  await withStore(['conversations'], 'readwrite', async tx => {
    const store = tx.objectStore('conversations')
    for (const row of await requestResult(store.getAll())) if (row.scope === scope) store.delete(row.key)
    for (const data of conversations) {
      const id = valueId(data)
      if (id) store.put({ key: `${scope}:${id}`, scope, conversationId: id, lastMessageAt: data.lastMessageAt || '', updatedAt: now, data })
    }
  })
}
export async function getCachedConversations(scope) {
  if (!scope) return []
  const rows = await withStore(['conversations'], 'readonly', tx => requestResult(tx.objectStore('conversations').getAll()))
  return (rows || []).filter(row => row.scope === scope).sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt))).map(row => row.data)
}
export async function cacheChannels(identityScope, channels) {
  if (!identityScope || !Array.isArray(channels)) return
  await withStore(['channels'], 'readwrite', tx => requestResult(tx.objectStore('channels').put({ key: identityScope, updatedAt: Date.now(), data: channels })))
}
export async function getCachedChannels(identityScope) {
  if (!identityScope) return { data: [], updatedAt: 0, fresh: false }
  const row = await withStore(['channels'], 'readonly', tx => requestResult(tx.objectStore('channels').get(identityScope)))
  return { data: Array.isArray(row?.data) ? row.data : [], updatedAt: row?.updatedAt || 0, fresh: Date.now() - (row?.updatedAt || 0) < CHANNEL_CACHE_FRESHNESS }
}
export async function cacheMessages(scope, conversationId, messages) {
  if (!scope || !conversationId || !Array.isArray(messages)) return
  const now = Date.now()
  await withStore(['messages', 'syncState'], 'readwrite', async tx => {
    const store = tx.objectStore('messages')
    for (const data of messages.slice(-500)) {
      const id = valueId(data) || data.clientMessageId
      if (id && !String(id).startsWith('temp_')) store.put({ key: `${scope}:${id}`, scope, conversationId: String(conversationId), sequence: data.sequence, createdAt: data.createdAt || new Date(now).toISOString(), updatedAt: now, data })
    }
    const latest = messages[messages.length - 1]
    if (latest) tx.objectStore('syncState').put({ key: `${scope}:${conversationId}`, scope, conversationId: String(conversationId), lastSequence: messageCursor(latest), syncedAt: now })
  })
  trimConversation(scope, conversationId)
}
export async function getCachedMessages(scope, conversationId) {
  if (!scope || !conversationId) return []
  const rows = await withStore(['messages'], 'readonly', tx => requestResult(tx.objectStore('messages').index('scopeConversation').getAll([scope, String(conversationId)])))
  return (rows || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(-500).map(row => row.data)
}
async function trimConversation(scope, conversationId) {
  await withStore(['messages'], 'readwrite', async tx => {
    const store = tx.objectStore('messages')
    const rows = await requestResult(store.index('scopeConversation').getAll([scope, String(conversationId)]))
    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(500).forEach(row => store.delete(row.key))
  })
}
export async function removeCachedMessage(scope, messageId) {
  if (!scope || !messageId) return
  await withStore(['messages'], 'readwrite', tx => requestResult(tx.objectStore('messages').delete(`${scope}:${messageId}`)))
}
export async function clearCachedConversation(scope, conversationId) {
  if (!scope || !conversationId) return
  await withStore(['messages', 'syncState'], 'readwrite', async tx => {
    const store = tx.objectStore('messages')
    const rows = await requestResult(store.index('scopeConversation').getAll([scope, String(conversationId)]))
    rows.forEach(row => store.delete(row.key))
    tx.objectStore('syncState').delete(`${scope}:${conversationId}`)
  })
}

export async function loadCachedMedia(scope, message, thumbnail, loader, verify) {
  const attachmentId = String(message?.attachmentId || '')
  if (!scope || !attachmentId) return loader()
  if (INVALID_STATUSES.has(message.attachmentStatus)) {
    await invalidateAttachment(scope, attachmentId)
    return null
  }
  const kind = thumbnail ? 'thumbnail' : 'original'
  if (!thumbnail && message.messageType !== 'image') return loader()
  const descriptor = { scope, resourceId: attachmentId, kind, version: attachmentVersion(message, kind) }
  const result = await loadPrivateMedia(descriptor, loader, verify)
  reportDebugEvent('E', 'chatCache.js:loadCachedMedia', result?.cached ? 'media cache hit' : 'media cache miss', { phase: 'cache-lookup', resourceKind: kind, stableId: attachmentId.slice(-6), cachePath: result?.cached ? 'indexeddb' : 'network', variant: kind })
  return result?.blob || null
}
export function isPrivateAvatarUrl(url) {
  try {
    const parsed = new URL(url, window.location.origin)
    return parsed.origin === window.location.origin && /^\/api\/files\//.test(parsed.pathname)
  } catch {
    return false
  }
}

export async function loadCachedAvatar(scope, url, loader, verify, resource = {}) {
  if (!scope || !url || (!resource.private && !isPrivateAvatarUrl(url))) return loader()
  const resourceId = String(resource.id || url)
  const descriptor = { scope, resourceId, kind: 'avatar', version: resource.version || url }
  const result = await loadPrivateMedia(descriptor, loader, verify)
  reportDebugEvent('E', 'chatCache.js:loadCachedAvatar', result?.cached ? 'avatar cache hit' : 'avatar cache miss', { phase: 'cache-lookup', resourceKind: 'avatar', stableId: resourceId.slice(-6), cachePath: result?.cached ? 'indexeddb' : 'network' })
  return result?.blob || null
}

async function touchAttachment(scope, attachmentId, cacheKey) {
  await withStore(['attachments'], 'readwrite', async tx => {
    const store = tx.objectStore('attachments')
    for (const row of await requestResult(store.getAll())) if (row.scope === scope && row.attachmentId === attachmentId && row.cacheKey === cacheKey) store.put({ ...row, lastAccessedAt: Date.now() })
  })
}
export async function invalidateAttachment(scope, attachmentId, status = 'expired') {
  if (!scope || !attachmentId) return
  await invalidatePrivateMedia({ scope, resourceId: String(attachmentId) }, status)
  const rows = await withStore(['attachments'], 'readonly', tx => requestResult(tx.objectStore('attachments').getAll())) || []
  const targets = rows.filter(row => row.scope === scope && String(row.attachmentId) === String(attachmentId))
  if ('caches' in window) {
    const cache = await caches.open(MEDIA_CACHE).catch(() => null)
    await Promise.all(targets.map(row => cache?.delete(mediaRequest(row.cacheKey))))
  }
  await withStore(['attachments'], 'readwrite', tx => {
    targets.forEach(row => tx.objectStore('attachments').delete(row.key))
  })
  await withStore(['messages'], 'readwrite', async tx => {
    const store = tx.objectStore('messages')
    for (const row of await requestResult(store.getAll())) {
      if (row.scope === scope && String(row.data?.attachmentId) === String(attachmentId)) store.put({ ...row, data: { ...row.data, attachmentStatus: status } })
    }
  })
}
async function ensureMediaSpace(scope, incomingSize = 0) {
  const rows = await withStore(['attachments'], 'readonly', tx => requestResult(tx.objectStore('attachments').getAll())) || []
  let usage = rows.filter(row => row.scope === scope).reduce((sum, row) => sum + (row.size || 0), 0)
  if (usage + incomingSize <= MEDIA_LIMIT) return
  await cleanupChatCache(scope, true, usage + incomingSize - MEDIA_LIMIT)
}
export async function cleanupChatCache(scope, forceLru = false, bytesToFree = 0) {
  if (!scope) return
  if (forceLru) await cleanupPrivateMediaCache(scope)
  const now = Date.now()
  const rows = await withStore(['attachments'], 'readonly', tx => requestResult(tx.objectStore('attachments').getAll())) || []
  const scoped = rows.filter(row => row.scope === scope)
  const isExpired = row => row.status === 'expired' || (row.expiresAt && new Date(row.expiresAt).getTime() <= now) || now - row.cachedAt > ATTACHMENT_TTL
  const expired = scoped.filter(isExpired)
  const recalled = scoped.filter(row => !isExpired(row) && row.status === 'recalled')
  const deleted = scoped.filter(row => !isExpired(row) && row.status === 'deleted')
  const invalid = [...expired, ...recalled, ...deleted]
  let freed = invalid.reduce((sum, row) => sum + (row.size || 0), 0)
  const targets = [...invalid]
  if (forceLru) {
    for (const row of scoped.filter(item => !invalid.includes(item)).sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)) {
      if (freed >= bytesToFree && bytesToFree > 0) break
      targets.push(row); freed += row.size || 0
    }
  }
  if ('caches' in window) {
    const cache = await caches.open(MEDIA_CACHE).catch(() => null)
    await Promise.all(targets.map(row => cache?.delete(mediaRequest(row.cacheKey))))
  }
  await withStore(['attachments', 'messages'], 'readwrite', async tx => {
    targets.forEach(row => tx.objectStore('attachments').delete(row.key))
    const messages = await requestResult(tx.objectStore('messages').getAll())
    messages.filter(row => row.scope === scope && now - new Date(row.createdAt).getTime() > MESSAGE_TTL).forEach(row => tx.objectStore('messages').delete(row.key))
  })
  try { localStorage.setItem(`yimeng_chat_cleanup:${scope}`, String(now)) } catch {}
}
export async function initializeChatCache(scope) {
  if (!scope) return
  navigator.storage?.persist?.().catch(() => false)
  let last = 0
  try { last = Number(localStorage.getItem(`yimeng_chat_cleanup:${scope}`) || 0) } catch {}
  if (Date.now() - last >= DAY) await cleanupChatCache(scope)
  if (!cleanupTimers.has(scope)) cleanupTimers.set(scope, setInterval(() => cleanupChatCache(scope), DAY))
}
export async function clearIdentityCache(scope) {
  if (!scope) return
  await clearPrivateMediaScope(scope, true)
  for (const [timerScope, timer] of cleanupTimers) {
    if (timerScope === scope || timerScope.startsWith(`${scope}:`)) {
      clearInterval(timer)
      cleanupTimers.delete(timerScope)
    }
  }
  const attachmentRows = await withStore(['attachments'], 'readonly', tx => requestResult(tx.objectStore('attachments').getAll())) || []
  if ('caches' in window) {
    const cache = await caches.open(MEDIA_CACHE).catch(() => null)
    await Promise.all(attachmentRows.filter(row => row.scope === scope || row.scope.startsWith(`${scope}:`)).map(row => cache?.delete(mediaRequest(row.cacheKey))))
  }
  for (const storeName of ['conversations', 'messages', 'attachments', 'syncState', 'channels']) {
    await withStore([storeName], 'readwrite', async tx => {
      const store = tx.objectStore(storeName)
      for (const row of await requestResult(store.getAll())) if (row.key === scope || row.scope === scope || row.scope?.startsWith(`${scope}:`)) store.delete(row.key)
    })
  }
  try {
    Object.keys(localStorage).filter(key => key.startsWith(`yimeng_chat_cleanup:${scope}`) || key.startsWith(`yimeng_message_list:${scope}:`)).forEach(key => localStorage.removeItem(key))
  } catch {}
}
