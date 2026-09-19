// 忆梦云团队开发 - 聊天附件上传、下载、原生持久化与浏览器分享通用行为
const DOWNLOAD_PREFIX = 'ymkf:attachment-downloaded:v1'
const NATIVE_CHUNK_BYTES = 192 * 1024
const ATTACHMENT_ID_PATTERN = /^[a-f\d]{24}$/i

// #region debug-point DEBUG:network-reporter
export function reportDebugEvent(hypothesisId, location, msg, data = {}) {
  try {
    const endpoint = import.meta.env.VITE_DEBUG_SERVER_URL || 'http://192.168.1.146:7777/event'
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ sessionId: 'agent-latest-media-cache', runId: 'pre-fix', hypothesisId, location, msg: `[DEBUG] ${msg}`, data: { viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 }, route: window.location.pathname, queryFlags: [...new URLSearchParams(window.location.search).keys()].reduce((flags, key) => ({ ...flags, [key]: true }), {}), ...data }, ts: Date.now() }),
      keepalive: true, signal: controller.signal, credentials: 'omit',
    }).catch(() => {}).finally(() => clearTimeout(timer))
  } catch {}
}
// #endregion

export function createClientMessageId(prefix = 'attachment') {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`
  return `${prefix}_${random}`
}

export function safeFileName(name, fallback = '下载文件') {
  const cleaned = String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 180)
  return cleaned || fallback
}

export function downloadRecordKey(scope, attachmentId) {
  if (!scope || !attachmentId) return ''
  return `${DOWNLOAD_PREFIX}:${encodeURIComponent(String(scope))}:${encodeURIComponent(String(attachmentId))}`
}

export function wasAttachmentDownloaded(storage, scope, attachmentId) {
  const key = downloadRecordKey(scope, attachmentId)
  if (!key || !storage) return false
  try { return Boolean(storage.getItem(key)) } catch { return false }
}

export function markAttachmentDownloaded(storage, scope, attachmentId, now = Date.now()) {
  const key = downloadRecordKey(scope, attachmentId)
  if (!key || !storage) return false
  try { storage.setItem(key, JSON.stringify({ downloadedAt: now })); return true } catch { return false }
}

export function clearAttachmentDownloaded(storage, scope, attachmentId) {
  const key = downloadRecordKey(scope, attachmentId)
  if (!key || !storage) return false
  try { storage.removeItem(key); return true } catch { return false }
}

export function downloadProgressState(event, status = 'downloading') {
  const loaded = Math.max(0, Number(event?.loaded) || 0)
  const total = Math.max(0, Number(event?.total) || 0)
  return { status, loaded, total, percent: total ? Math.min(100, Math.round(loaded * 100 / total)) : 0 }
}

export function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}

export function canShareBlob(navigatorObject, blob, fileName) {
  if (!navigatorObject?.share || !navigatorObject?.canShare || typeof File === 'undefined') return null
  const file = new File([blob], safeFileName(fileName), { type: blob.type || 'application/octet-stream' })
  return navigatorObject.canShare({ files: [file] }) ? file : null
}

export function saveBlob(blob, fileName, documentObject = document, urlObject = URL) {
  const objectUrl = urlObject.createObjectURL(blob)
  const link = documentObject.createElement('a')
  link.href = objectUrl
  link.download = safeFileName(fileName)
  link.style.display = 'none'
  documentObject.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => urlObject.revokeObjectURL(objectUrl), 1000)
}

function parseNativeResult(value) {
  try { return typeof value === 'string' ? JSON.parse(value) : (value || {}) } catch { return { status: 'error', message: '原生返回格式无效' } }
}

export function getNativeAttachmentBridge(windowObject = globalThis.window) {
  const candidates = [windowObject?.YiMengAndroid, windowObject?.YiMengCustomerAndroid]
  return candidates.find(bridge => ['getSavedAttachmentState', 'saveAttachment', 'openSavedAttachment'].every(name => typeof bridge?.[name] === 'function')) || null
}

function requireNativeArgs(bridge, scope, attachmentId) {
  if (!bridge) throw new Error('原生附件桥不可用')
  if (!scope) throw new Error('附件身份范围无效')
  if (!ATTACHMENT_ID_PATTERN.test(String(attachmentId || ''))) throw new Error('附件标识无效')
}

export function getNativeAttachmentState(bridge, scope, attachmentId) {
  requireNativeArgs(bridge, scope, attachmentId)
  return parseNativeResult(bridge.getSavedAttachmentState(String(attachmentId)))
}

export function openNativeAttachment(bridge, scope, attachmentId) {
  requireNativeArgs(bridge, scope, attachmentId)
  return parseNativeResult(bridge.openSavedAttachment(String(attachmentId)))
}

export function saveNativeAttachment(bridge, scope, attachmentId, fileName, mimeType) {
  requireNativeArgs(bridge, scope, attachmentId)
  return parseNativeResult(bridge.saveAttachment(
    String(attachmentId),
    safeFileName(fileName),
    String(mimeType || 'application/octet-stream'),
  ))
}

export function deleteNativeAttachment(bridge, scope, attachmentId) {
  if (!bridge || !scope || !ATTACHMENT_ID_PATTERN.test(String(attachmentId || ''))) return { status: 'ignored' }
  return parseNativeResult(bridge.deleteAttachment(String(scope), String(attachmentId)))
}

function bytesToBase64(bytes) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

export async function saveBlobToNative(bridge, { scope, attachmentId, fileName, mimeType, blob, chunkBytes = NATIVE_CHUNK_BYTES }) {
  requireNativeArgs(bridge, scope, attachmentId)
  if (!(blob instanceof Blob)) throw new Error('附件数据无效')
  const begin = parseNativeResult(bridge.beginAttachment(String(scope), String(attachmentId), safeFileName(fileName), String(mimeType || blob.type || 'application/octet-stream'), blob.size))
  if (begin.status !== 'ready' || !begin.transferId) throw new Error(begin.message || '无法开始保存附件')
  try {
    for (let offset = 0; offset < blob.size; offset += chunkBytes) {
      const bytes = new Uint8Array(await blob.slice(offset, Math.min(blob.size, offset + chunkBytes)).arrayBuffer())
      const appended = parseNativeResult(bridge.appendAttachment(begin.transferId, bytesToBase64(bytes)))
      if (appended.status !== 'ok') throw new Error(appended.message || '附件分片写入失败')
    }
    const finished = parseNativeResult(bridge.finishAttachment(begin.transferId))
    if (finished.status !== 'saved') throw new Error(finished.message || '附件保存失败')
    return finished
  } catch (error) {
    try { bridge.cancelAttachment(begin.transferId) } catch {}
    throw error
  }
}

export async function performAttachmentAction({ bridge, scope, attachmentId, fileName, mimeType, fetchBlob, browserAction, onMissing }) {
  if (bridge && attachmentId) {
    const state = getNativeAttachmentState(bridge, scope, attachmentId)
    if (state.status === 'saved') {
      const opened = openNativeAttachment(bridge, scope, attachmentId)
      if (opened.status !== 'missing') return { mode: 'native-open', result: opened }
      onMissing?.()
    } else if (state.status === 'missing') {
      onMissing?.()
    } else {
      throw new Error(state.message || '无法确认附件保存状态')
    }

    const blob = await fetchBlob()
    return {
      mode: 'native-save',
      result: await saveBlobToNative(bridge, { scope, attachmentId, fileName, mimeType, blob }),
      blob,
    }
  }
  const blob = await fetchBlob()
  const result = await browserAction(blob)
  return { mode: 'browser', blob, result }
}
