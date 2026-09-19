<!-- 忆梦云团队开发 - 手机端聊天展示组件独立实现 -->
<script setup>
import { useChatPosition } from '../../useChatPosition'
import { readTenantCache } from '../../api'
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import api from '../../api'
import ConfirmDialog from '../../components/ConfirmDialog.vue'
import { getTenantSocket } from '../../socket'
import { acquireObjectUrl, avatarCacheKey, cacheMessages, cleanupChatCache, clearCachedConversation, getCachedMessages, invalidateAttachment, isPrivateAvatarUrl, loadCachedAvatar, loadCachedMedia, mediaCacheKey, releaseObjectUrl, subscribePrivateMedia, tenantCacheScope } from '../../chatCache'
import {
  canShareBlob,
  clearAttachmentDownloaded,
  createClientMessageId,
  deleteNativeAttachment,
  downloadProgressState,
  formatBytes,
  getNativeAttachmentBridge,
  getNativeAttachmentState,
  markAttachmentDownloaded,
  openNativeAttachment,
  reportDebugEvent,
  saveBlob,
  saveNativeAttachment,
  wasAttachmentDownloaded,
} from '../../attachmentActions'

const props = defineProps({
  conversationId: { type: String, default: null },
  targetMessageId: { type: String, default: null },
})
const emit = defineEmits(['back', 'message-located'])

const conversation = ref(null)
const assignedAgentName = ref('')
const assignedAgentUsername = ref('')
const messages = ref([])
const quickReplies = ref([])
const input = ref('')
const sending = ref(false)
const accepted = ref(false)
const loading = ref(false)
const customerOnline = ref(false)
const msgContainer = ref(null)
const position = useChatPosition(msgContainer, messages)
const { following, mode: positionMode, pending: pendingMessages } = position
let activeTarget = null
let incomingDuringLoad = null
let requestAbort = null
let conversationEpoch = 0
async function returnToLatest() {
  activeTarget = null
  position.reset(false)
  await loadMessages(true)
}
const loadingHistory = ref(false)
const hasMoreMessages = ref(true)
let socket = null
let socketConnectedOnce = false
let messageSyncTimer = null
let messageSyncInFlight = false
let historyCursor = null
let messageGeneration = 0
let initialBottomSession = null

const uploading = ref(false)
const showInfo = ref(false)
const showMore = ref(false)
const showQuickReplies = ref(false)
const sendingQuickReplyId = ref(null)
const viewportHeight = ref('100dvh')
const viewportTop = ref('0px')
const showCloseConfirm = ref(false)
const closing = ref(false)
const confirmAction = ref(null)
const actionSubmitting = ref(false)
const preview = ref(null)
const previewVideo = ref(null)
const mediaUrls = ref({})
const mediaRequests = new Map()
const mediaSubscriptions = new Map()
const avatarUrls = ref({})
const failedAvatarUrls = ref({})
const avatarRequests = new Map()
const contextMenu = ref(null)
const downloadProgress = ref(null)
const downloadedVersion = ref(0)
const toast = ref('')
let toastTimer = null
let longPressTimer = null
let longPressStart = null
let suppressBubbleClickUntil = 0
let activeUploadId = null

const currentUserId = readTenantCache('tenant_user')?._id
const cacheScope = tenantCacheScope()
const persistMessages = () => cacheMessages(
  cacheScope,
  props.conversationId,
  messages.value.filter(message => !message.uploadPhase && !message.localObjectUrl),
)
const canDeleteMessage = (msg) => msg.senderType !== 'system' && msg._id
const canRecallMessage = (msg) => (
  msg.senderType === 'agent' &&
  String(msg.senderId?._id || msg.senderId) === String(currentUserId) &&
  !msg.recalledAt &&
  Date.now() - new Date(msg.createdAt).getTime() <= 2 * 60 * 1000
)

async function loadConversation() {
  const epoch = conversationEpoch
  if (!props.conversationId) { conversation.value = null; return }
  try {
    const res = await api.get(`/tenant/conversations/${props.conversationId}`)
    if (epoch !== conversationEpoch) return
    if (res.code === 0) {
      conversation.value = res.data
      accepted.value = res.data.status !== 'waiting'
      assignedAgentName.value = ''
      const channelId = res.data.channelId || res.data.channel?.id || res.data.channel?._id
      if (channelId) {
        const channelRes = await api.get(`/tenant/channels/${channelId}`).catch(() => null)
        if (epoch !== conversationEpoch) return
        const assignedId = String(res.data.assignedAgentId || '')
        assignedAgentName.value = channelRes?.data?.employees?.find(employee => String(employee.id || employee._id) === assignedId)?.displayName || ''
      }
    } else { conversation.value = null }
  } catch { if (epoch === conversationEpoch) conversation.value = null }
}

async function loadMessages(forceLatest = false) {
  if (!props.conversationId) return
  const generation = ++messageGeneration
  requestAbort?.abort()
  requestAbort = new AbortController()
  const signal = requestAbort.signal
  const conversationId = props.conversationId
  activeTarget = forceLatest ? null : props.targetMessageId
  position.reset(Boolean(activeTarget))
  incomingDuringLoad = []
  loadingHistory.value = false
  historyCursor = null
  const cached = await getCachedMessages(cacheScope, props.conversationId)
  if (generation !== messageGeneration) return
  if (cached.length && !activeTarget) messages.value = cached
  try {
    const params = activeTarget
      ? { limit: 100, around: activeTarget }
      : { limit: 50 }
    const res = await api.get(`/tenant/conversations/${conversationId}/messages`, { params, signal })
    if (generation !== messageGeneration) return
    if (res.code === 0) {
      messages.value = res.data || []
      const incoming = incomingDuringLoad || []
      incomingDuringLoad = null
      // Cursor belongs to the server snapshot, never to a realtime tail.
      historyCursor = activeTarget ? null : messages.value.at(-1)?._id || null
      if (activeTarget) {
        if (incoming.length) pendingMessages.value += incoming.length
      } else incoming.forEach(mergeMessage)
      persistMessages()
      hasMoreMessages.value = activeTarget ? true : messages.value.length === 50
      if (!loading.value) {
        if (activeTarget) await locateMessage(activeTarget)
        else await scrollToLatest()
      }
      return generation === messageGeneration
    }
  } catch { if (generation === messageGeneration) showToast('消息加载失败，请重试回到最新') }
  finally { if (generation === messageGeneration) incomingDuringLoad = null }
}

async function locateMessage(messageId) {
  const generation = messageGeneration
  await nextTick()
  if (generation !== messageGeneration) return
  const element = msgContainer.value?.querySelector(`[data-message-id="${messageId}"]`)
  if (!element) return
  element.scrollIntoView({ block: 'center' })
  position.capture()
  element.classList.add('cp-message-highlight')
  setTimeout(() => element.classList.remove('cp-message-highlight'), 2200)
  // Target mode persists until an explicit ordinary entry or return-to-latest action.
  emit('message-located', messageId)
}

async function loadPreviousMessages() {
  if (loadingHistory.value || !hasMoreMessages.value || !messages.value.length) return
  const firstMessage = messages.value.find(message => message._id)
  if (!firstMessage) return
  loadingHistory.value = true
  const generation = messageGeneration
  const container = msgContainer.value
  position.following.value = false
  position.capture()
  try {
    const res = await api.get(`/tenant/conversations/${props.conversationId}/messages`, {
      params: { limit: 50, before: firstMessage._id },
    })
    if (generation !== messageGeneration) return
    if (res.code === 0) {
      const olderMessages = res.data || []
      const existingIds = new Set(messages.value.map(message => String(message._id)))
      messages.value = [...olderMessages.filter(message => !existingIds.has(String(message._id))), ...messages.value]
      persistMessages()
      hasMoreMessages.value = olderMessages.length === 50
      await nextTick()
      if (container) {
        position.restore()
      }
    }
  } finally {
    if (generation === messageGeneration) loadingHistory.value = false
  }
}

function handleMessageScroll(event) {
  cancelLongPress()
  const container = event?.currentTarget || msgContainer.value
  const userScroll = position.scroll()
  if (userScroll && (container?.scrollTop || 0) <= 24) loadPreviousMessages()
}

async function loadQuickReplies() {
  if (!conversation.value) return
  try {
    const epoch = conversationEpoch
    const res = await api.get(`/tenant/channels/${conversation.value.channelId}/quick-replies`)
    if (epoch !== conversationEpoch) return
    if (res.code === 0) quickReplies.value = res.data.filter(q => q.status === 'active')
  } catch {}
}

async function accept() {
  try {
    const res = await api.post(`/tenant/conversations/${props.conversationId}/accept`)
    if (res.code === 0) {
      accepted.value = true
      conversation.value.status = 'active'
      conversation.value.assignedAgentId = res.data.assignedAgentId || currentUserId
      const currentUser = readTenantCache('tenant_user')
      assignedAgentName.value = currentUser?.displayName || ''
      assignedAgentUsername.value = currentUser?.username || ''
    } else alert(res.message)
  } catch (e) { alert(e?.message || '接入失败') }
}

function mergeMessage(message) {
  if (!message || String(message.conversationId) !== String(props.conversationId)) return
  const index = messages.value.findIndex(item =>
    String(item._id) === String(message._id) ||
    (item.clientMessageId && item.clientMessageId === message.clientMessageId)
  )
  if (index >= 0) {
    const current = messages.value[index]
    if (!current.recalledAt) {
      if (current.localObjectUrl && current.localObjectUrl !== message.localObjectUrl) URL.revokeObjectURL(current.localObjectUrl)
      messages.value[index] = message
    }
  } else messages.value.push(message)
  messages.value.sort((a, b) => (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) || String(a._id).localeCompare(String(b._id)))
  persistMessages()
}

function updatePendingMessage(clientMessageId, patch) {
  const message = messages.value.find(item => item.clientMessageId === clientMessageId)
  if (!message) return null
  Object.assign(message, patch)
  return message
}

async function syncLatestMessages() {
  const conversationId = props.conversationId
  if (!conversationId || messageSyncInFlight || incomingDuringLoad || positionMode.value === 'search') return
  messageSyncInFlight = true
  try {
    let cursor = historyCursor
    const generation = messageGeneration
    if (!cursor) return await loadMessages()
    while (String(conversationId) === String(props.conversationId)) {
      const res = await api.get(`/tenant/conversations/${conversationId}/messages`, { params: { limit: 50, after: cursor } })
      if (res.code !== 0 || generation !== messageGeneration || String(conversationId) !== String(props.conversationId)) break
      const page = res.data || []
      page.forEach(mergeMessage)
      if (page.length) position.receive()
      if (page.length) historyCursor = cursor = page[page.length - 1]._id
      if (page.length < 50) break
    }
  } catch {}
  finally { messageSyncInFlight = false }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') syncLatestMessages()
}

async function prepareSendWindow() {
  const epoch = conversationEpoch
  // Sending is an explicit latest-window action, including historical reading.
  const ready = await loadMessages(true)
  if (!ready || epoch !== conversationEpoch || positionMode.value !== 'latest') return null
  return { epoch, generation: messageGeneration, conversationId: props.conversationId }
}
function isCurrentSend(session) {
  return session && session.epoch === conversationEpoch && session.generation === messageGeneration
}

async function sendMsg() {
  if (!input.value.trim() || sending.value) return
  if (!accepted.value) { alert('请先接入会话'); return }
  sending.value = true
  const text = input.value.trim(); input.value = ''
  const epoch = conversationEpoch
  try {
    const session = await prepareSendWindow()
    if (!session) { if (epoch === conversationEpoch) input.value = text; return }
    const res = await api.post(`/tenant/conversations/${session.conversationId}/messages`, {
      content: text, clientMessageId: 'a_' + Date.now(),
    })
    if (!isCurrentSend(session)) return
    if (res.code !== 0) throw new Error(res.message || '发送失败')
    mergeMessage(res.data); await scrollToLatest()
  } catch (e) {
    if (epoch === conversationEpoch) { input.value = text; alert(e?.message || '发送失败') }
  }
  finally { if (epoch === conversationEpoch) sending.value = false }
}

async function runCustomerAction() {
  if (!confirmAction.value || actionSubmitting.value) return
  actionSubmitting.value = true
  try {
    const type = confirmAction.value
    if (type === 'clear') {
      const res = await api.delete(`/tenant/conversations/${props.conversationId}/messages`)
      if (res.code === 0) applyDelete({ conversationId: props.conversationId, clearAll: true, side: 'agent' })
    } else {
      const field = type === 'block' ? 'blocked' : 'messageReceivingDisabled'
      const current = Boolean(conversation.value.customer?.[field])
      const res = await api.patch(`/tenant/conversations/${props.conversationId}/customer-settings`, { [field]: !current })
      if (res.code === 0) Object.assign(conversation.value.customer, res.data)
    }
    showToast('操作成功')
    confirmAction.value = null
  } catch (e) { showToast(e?.message || '操作失败') }
  finally { actionSubmitting.value = false }
}

async function close() {
  if (closing.value) return
  closing.value = true
  try {
    const res = await api.post(`/tenant/conversations/${props.conversationId}/close`)
    if (res.code === 0) {
      conversation.value.status = 'closed'
      showCloseConfirm.value = false
    }
  } catch {}
  finally { closing.value = false }
}

async function handleUpload(ev) {
  const file = ev.target.files?.[0]
  ev.target.value = ''
  if (!file) return
  if (!accepted.value) { alert('请先接入会话'); return }

  const session = await prepareSendWindow()
  if (!session) return
  const { conversationId, generation } = session
  const clientMessageId = createClientMessageId('agent_attachment')
  const selectedType = file.type.startsWith('image/')
    ? 'image'
    : file.type.startsWith('video/') ? 'video' : 'file'
  const localMsg = {
    _id: `temp_${clientMessageId}`,
    clientMessageId,
    conversationId,
    senderType: 'agent',
    createdAt: new Date().toISOString(),
    attachmentName: file.name,
    messageType: selectedType,
    localObjectUrl: selectedType === 'image' ? URL.createObjectURL(file) : '',
    uploadPhase: 'uploading',
    uploadProgress: 0,
  }
  activeUploadId = clientMessageId
  uploading.value = true
  mergeMessage(localMsg)
  showMore.value = false
  await scrollToLatest()

  const isCurrentUpload = () => generation === messageGeneration && String(conversationId) === String(props.conversationId)
  const fd = new FormData()
  fd.append('file', file)
  try {
    // #region debug-point A-D:agent-upload-start
    fetch(`/api/__debug_agent_upload_zero/start?surface=mobile&size=${encodeURIComponent(file.size)}&type=${encodeURIComponent(selectedType)}`, { credentials: 'same-origin' }).catch(() => {})
    // #endregion
    const res = await api.post(`/tenant/conversations/${conversationId}/attachments`, fd, {
      timeout: 120000,
      onUploadProgress: event => {
        if (!isCurrentUpload()) return
        // #region debug-point A-D:agent-upload-progress
        const pendingExists = Boolean(messages.value.find(item => item.clientMessageId === clientMessageId))
        fetch(`/api/__debug_agent_upload_zero/progress?surface=mobile&loaded=${encodeURIComponent(event.loaded ?? '')}&total=${encodeURIComponent(event.total ?? '')}&computable=${encodeURIComponent(event.lengthComputable ?? '')}&progress=${encodeURIComponent(event.progress ?? '')}&pending=${pendingExists ? 1 : 0}`, { credentials: 'same-origin' }).catch(() => {})
        // #endregion
        updatePendingMessage(clientMessageId, {
          uploadProgress: event.total ? Math.min(100, Math.round(event.loaded * 100 / event.total)) : 0,
        })
      },
    })
    if (res.code !== 0) throw new Error(res.message || '上传失败')
    if (!isCurrentUpload()) return

    const fi = res.data
    const mediaType = ['image', 'video'].includes(fi.category) ? fi.category : 'file'
    const pendingMessage = updatePendingMessage(clientMessageId, {
      attachmentId: fi.attachmentId,
      attachmentName: fi.name || file.name,
      attachmentStatus: fi.status,
      messageType: mediaType,
      uploadPhase: 'sending',
      uploadProgress: 100,
    })
    if (!pendingMessage) return

    const sr = await api.post(`/tenant/conversations/${conversationId}/messages`, {
      attachmentId: fi.attachmentId,
      messageType: mediaType,
      clientMessageId,
    })
    if (sr.code !== 0) throw new Error(sr.message || '发送失败')
    if (!isCurrentUpload()) return
    mergeMessage(sr.data)
    await scrollToLatest()
  } catch (e) {
    if (!isCurrentUpload()) return
    updatePendingMessage(clientMessageId, { uploadPhase: 'failed', sendFailed: true })
    showToast(e?.message || '附件发送失败')
  } finally {
    if (activeUploadId === clientMessageId) {
      activeUploadId = null
      uploading.value = false
    }
  }
}

function queryCustomerPresence() {
  const customerId = conversation.value?.customer?._id
  if (customerId) socket?.emit('presence:query', { type: 'customer', userId: customerId }, ({ online } = {}) => { customerOnline.value = Boolean(online) })
}
function handleSocketConnect() {
  if (socketConnectedOnce) syncLatestMessages()
  else socketConnectedOnce = true
  queryCustomerPresence()
}
function handlePresenceChanged(data) {
  if (data.type === 'customer' && String(data.userId) === String(conversation.value?.customer?._id)) customerOnline.value = Boolean(data.online)
}
function handleSocketMessage(msg) {
  if (String(msg.conversationId) !== String(props.conversationId)) return
  if (incomingDuringLoad) incomingDuringLoad.push(msg)
  if (positionMode.value === 'search') { pendingMessages.value += 1; return }
  mergeMessage(msg)
  position.receive()
}
function handleConversationUpdated(data) {
  if (String(data.conversationId) !== String(props.conversationId) || !conversation.value) return
  if (data.assignedAgentId) conversation.value.assignedAgentId = data.assignedAgentId
  if (data.status) {
    conversation.value.status = data.status
    accepted.value = data.status !== 'waiting'
  }
}
function removeSocketListeners() {
  socket?.off('connect', handleSocketConnect)
  socket?.off('presence:changed', handlePresenceChanged)
  socket?.off('message.new', handleSocketMessage)
  socket?.off('message.recalled', applyRecall)
  socket?.off('message.deleted', applyDelete)
  socket?.off('attachment.updated', applyAttachmentUpdate)
  socket?.off('conversation.updated', handleConversationUpdated)
}
function setupSocket() {
  removeSocketListeners()
  socket = getTenantSocket()
  if (!socket) return
  socketConnectedOnce = socket.connected
  socket.on('connect', handleSocketConnect)
  socket.on('presence:changed', handlePresenceChanged)
  socket.on('message.new', handleSocketMessage)
  socket.on('message.recalled', applyRecall)
  socket.on('message.deleted', applyDelete)
  socket.on('attachment.updated', applyAttachmentUpdate)
  socket.on('conversation.updated', handleConversationUpdated)
  queryCustomerPresence()
}

async function init() {
  const epoch = conversationEpoch
  if (!props.conversationId) { conversation.value = null; messages.value = []; return }
  // #region debug-point C:mobile-chat-init
  reportDebugEvent('C', 'mobile/ChatPanel.vue:init', 'chat init', { phase: 'init', conversationId: String(props.conversationId || '').slice(-6), generation: messageGeneration, targetPresent: Boolean(props.targetMessageId), targetId: String(props.targetMessageId || '').slice(-6), routeMessageFlag: new URLSearchParams(location.search).has('message'), routeAroundFlag: new URLSearchParams(location.search).has('around') })
  // #endregion
  loading.value = true
  try {
    cleanupChatCache(cacheScope)
    await Promise.all([loadConversation(), loadMessages()])
    if (epoch !== conversationEpoch) return
    if (conversation.value) {
      await loadQuickReplies()
      if (epoch !== conversationEpoch) return
      setupSocket()
      clearInterval(messageSyncTimer)
      messageSyncTimer = setInterval(syncLatestMessages, 30000)
    }
  } catch {} finally {
    if (epoch !== conversationEpoch) return
    loading.value = false
    if (conversation.value) {
      if (activeTarget) await locateMessage(activeTarget)
      else await scrollToLatest(true)
    }
  }
}

watch(
  () => [props.conversationId, props.targetMessageId],
  ([id, targetId], [previousId, previousTargetId] = []) => {
    if (id === previousId) {
      if (targetId !== previousTargetId) loadMessages(!targetId)
      return
    }
    messageGeneration++
    conversationEpoch++
    sending.value = false
    sendingQuickReplyId.value = null
    requestAbort?.abort()
    incomingDuringLoad = null
    messageSyncInFlight = false
    loadingHistory.value = false
    position.reset(Boolean(targetId))
    cancelInitialBottomCorrection()
    messages.value = []
    historyCursor = null
    releaseMediaUrls()
    removeSocketListeners(); socket = null
    customerOnline.value = false
    clearInterval(messageSyncTimer); messageSyncTimer = null
    showMore.value = false
    showQuickReplies.value = false
    quickReplies.value = []
    if (id) init()
    else { conversation.value = null; messages.value = [] }
  },
  { immediate: true },
)

function updateViewport(event) {
  const shouldScroll = isNearBottom()
  const viewport = window.visualViewport
  // #region debug-point A-B:mobile-viewport
  reportDebugEvent('A-B', 'mobile/ChatPanel.vue:updateViewport', 'viewport changed', { phase: 'viewport-resize', conversationId: String(props.conversationId || '').slice(-6), generation: messageGeneration, eventType: event?.type || 'mount', inputTrusted: Boolean(event?.isTrusted), visualHeight: Math.round(viewport?.height || 0), visualOffsetTop: Math.round(viewport?.offsetTop || 0), isNearBottom: shouldScroll, correctionActive: Boolean(initialBottomSession) })
  // #endregion
  viewportHeight.value = `${Math.round(viewport?.height || window.innerHeight)}px`
  viewportTop.value = `${Math.round(viewport?.offsetTop || 0)}px`
  position.schedule()
}

onMounted(() => {
  updateViewport()
  window.visualViewport?.addEventListener('resize', updateViewport)
  window.visualViewport?.addEventListener('scroll', updateViewport)
  window.addEventListener('resize', updateViewport)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('yimeng-native-attachment', handleNativeAttachment)
})

onUnmounted(() => {
  messageGeneration++
  conversationEpoch++
  requestAbort?.abort()
  cancelInitialBottomCorrection()
  removeSocketListeners()
  clearInterval(messageSyncTimer)
  clearTimeout(toastTimer)
  clearTimeout(longPressTimer)
  window.visualViewport?.removeEventListener('resize', updateViewport)
  window.visualViewport?.removeEventListener('scroll', updateViewport)
  window.removeEventListener('resize', updateViewport)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('yimeng-native-attachment', handleNativeAttachment)
  releaseMediaUrls()
})

function isNearBottom() {
  const container = msgContainer.value
  return Boolean(container && container.scrollHeight - container.scrollTop - container.clientHeight <= 120)
}
function scrollToBottom(container = msgContainer.value) {
  if (!container || !following.value || positionMode.value !== 'latest') return
  container.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
}
function cancelInitialBottomCorrection(reason = 'unspecified', event = null) {
  if (!initialBottomSession) return
  // #region debug-point D:mobile-correction-cancel
  reportDebugEvent('D', 'mobile/ChatPanel.vue:cancelInitialBottomCorrection', 'initial correction cancelled', { phase: 'cancel', reason, inputTrusted: Boolean(event?.isTrusted), conversationId: String(props.conversationId || '').slice(-6), generation: messageGeneration, corrections: initialBottomSession.corrections, scrollElementIdentity: initialBottomSession.container === msgContainer.value ? 'msgContainer' : 'other', scrollTop: Math.round(initialBottomSession.container?.scrollTop || 0), clientHeight: Math.round(initialBottomSession.container?.clientHeight || 0), scrollHeight: Math.round(initialBottomSession.container?.scrollHeight || 0), isNearBottom: isNearBottom() })
  // #endregion
  initialBottomSession.observer?.disconnect()
  initialBottomSession = null
}
function correctInitialBottom(session) {
  if (initialBottomSession !== session || session.generation !== messageGeneration || String(session.conversationId) !== String(props.conversationId)) return
  // #region debug-point A-B:mobile-resize-correction
  reportDebugEvent('A-B', 'mobile/ChatPanel.vue:correctInitialBottom', 'resize correction', { phase: 'resize-correction', conversationId: String(session.conversationId || '').slice(-6), generation: session.generation, targetPresent: Boolean(props.targetMessageId), correction: session.corrections + 1, scrollElementIdentity: session.container === msgContainer.value ? 'msgContainer' : 'other', scrollTop: Math.round(session.container?.scrollTop || 0), clientHeight: Math.round(session.container?.clientHeight || 0), scrollHeight: Math.round(session.container?.scrollHeight || 0), isNearBottom: isNearBottom() })
  // #endregion
  position.restore()
  session.corrections++
  position.schedule()
}
async function scrollToLatest(correctLayout = false) {
  const generation = messageGeneration
  const conversationId = props.conversationId
  // #region debug-point A-C:mobile-scroll-start
  reportDebugEvent('A-C', 'mobile/ChatPanel.vue:scrollToLatest', 'latest scroll requested', { phase: 'start', conversationId: String(conversationId || '').slice(-6), generation, targetPresent: Boolean(props.targetMessageId), correctLayout, scrollElementIdentity: msgContainer.value ? 'msgContainer' : 'missing' })
  // #endregion
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  if (generation !== messageGeneration || String(conversationId) !== String(props.conversationId) || positionMode.value === 'search' || !following.value) {
    // #region debug-point C:mobile-scroll-skipped
    reportDebugEvent('C', 'mobile/ChatPanel.vue:scrollToLatest', 'latest scroll skipped', { phase: 'cancel', reason: generation !== messageGeneration ? 'generation-changed' : String(conversationId) !== String(props.conversationId) ? 'conversation-changed' : 'target-present', conversationId: String(conversationId || '').slice(-6), generation, currentGeneration: messageGeneration, targetPresent: Boolean(props.targetMessageId) })
    // #endregion
    return
  }
  const container = msgContainer.value
  if (!container) return
  scrollToBottom(container)
  // #region debug-point A-B:mobile-scroll-applied
  reportDebugEvent('A-B', 'mobile/ChatPanel.vue:scrollToLatest', 'latest scroll applied', { phase: 'double-raf', conversationId: String(conversationId || '').slice(-6), generation, targetPresent: false, scrollElementIdentity: 'msgContainer', scrollTop: Math.round(container.scrollTop), clientHeight: Math.round(container.clientHeight), scrollHeight: Math.round(container.scrollHeight), isNearBottom: isNearBottom() })
  // #endregion
  position.schedule()
  if (!correctLayout) return
  cancelInitialBottomCorrection('restart')
  const session = { generation, conversationId, container, corrections: 1, observer: null }
  initialBottomSession = session
  if (typeof ResizeObserver === 'function') {
    session.observer = new ResizeObserver(() => position.schedule())
    session.observer.observe(container)
    for (const child of container.children) session.observer.observe(child)
  }
}
function showToast(message) {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 2200)
}
function attachmentUrl(msg) { return msg.attachmentId ? `/api/files/${msg.attachmentId}` : msg.attachmentUrl }
function thumbnailUrl(msg) { return msg.attachmentId ? `/api/files/${msg.attachmentId}/thumbnail` : msg.thumbnailUrl }
function privateMediaScope() { return tenantCacheScope(conversation.value?.channel?._id || conversation.value?.channel?.id || conversation.value?.channelId || 'unknown-channel') }
function attachmentExpired(msg) { return Boolean(msg?.recalledAt || ['expired', 'recalled', 'deleted'].includes(msg?.attachmentStatus) || (msg?.attachmentExpiredAt && new Date(msg.attachmentExpiredAt).getTime() <= Date.now())) }
function markAttachmentExpired(msg) {
  if (!msg) return
  msg.attachmentStatus = 'expired'
  const scope = privateMediaScope()
  releaseAttachmentUrls(msg, scope)
  invalidateAttachment(scope, msg.attachmentId)
  if (scope !== cacheScope) invalidateAttachment(cacheScope, msg.attachmentId)
  persistMessages()
}
function mediaKey(msg, thumbnail = false) { return `${msg._id || msg.clientMessageId}:${thumbnail ? 'thumbnail' : 'original'}` }
function releaseAttachmentUrls(msg, scope = privateMediaScope()) {
  if (!msg) return
  for (const thumbnail of [false, true]) {
    const key = mediaKey(msg, thumbnail)
    const cacheKey = mediaCacheKey(scope, msg, thumbnail)
    mediaSubscriptions.get(key)?.()
    mediaSubscriptions.delete(key)
    if (mediaUrls.value[key]) releaseObjectUrl(cacheKey)
    delete mediaUrls.value[key]
    mediaRequests.delete(key)
  }
  if (preview.value?.msg === msg) closePreview()
}
function avatarSrc(url) { return avatarUrls.value[url] || url }
function customerAvatarVisible() { return Boolean(conversation.value?.customer?.avatarUrl && !failedAvatarUrls.value[conversation.value.customer.avatarUrl]) }
function handleAvatarError(url) {
  if (!url) return
  failedAvatarUrls.value = { ...failedAvatarUrls.value, [url]: true }
}
function loadAvatar(el, url) {
  const epoch = conversationEpoch
  if (!url || avatarUrls.value[url] || !isPrivateAvatarUrl(url)) return
  if (!avatarRequests.has(url)) {
    const scope = privateMediaScope()
    avatarRequests.set(url, loadCachedAvatar(scope, url, () => api.get(url, { baseURL: '', responseType: 'blob' }))
      .then(blob => {
        if (!blob || epoch !== conversationEpoch || !el.isConnected) return
        avatarUrls.value[url] = acquireObjectUrl(avatarCacheKey(scope, url), blob)
        el.src = avatarUrls.value[url]
      })
      .catch(() => {})
      .finally(() => avatarRequests.delete(url)))
  }
}
const vCachedAvatar = { mounted(el, binding) { loadAvatar(el, binding.value) }, updated(el, binding) { if (binding.value !== binding.oldValue) loadAvatar(el, binding.value) } }
function releaseMediaUrls() {
  closePreview()
  messages.value.forEach(msg => { if (msg.localObjectUrl) URL.revokeObjectURL(msg.localObjectUrl) })
  messages.value.forEach(msg => {
    for (const thumbnail of [false, true]) if (mediaUrls.value[mediaKey(msg, thumbnail)]) releaseObjectUrl(mediaCacheKey(privateMediaScope(), msg, thumbnail))
  })
  Object.keys(avatarUrls.value).forEach(url => releaseObjectUrl(avatarCacheKey(privateMediaScope(), url)))
  mediaUrls.value = {}
  avatarUrls.value = {}
  mediaRequests.clear()
  avatarRequests.clear()
  preview.value = null
}
function loadMedia(msg, thumbnail = false, onDownloadProgress) {
  if (msg.localObjectUrl && !thumbnail) return Promise.resolve(msg.localObjectUrl)
  if (!msg.attachmentId) return Promise.resolve(thumbnail ? thumbnailUrl(msg) : attachmentUrl(msg))
  if (attachmentExpired(msg) || ['pending', 'deleting', 'failed'].includes(msg.attachmentStatus)) return Promise.resolve('')
  // 每次视频预览独占 URL，避免旧预览释放新预览复用的 URL。
  const key = msg.messageType === 'video' && !thumbnail ? Symbol(mediaKey(msg, thumbnail)) : mediaKey(msg, thumbnail)
  if (mediaUrls.value[key]) return Promise.resolve(mediaUrls.value[key])
  if (!mediaRequests.has(key)) {
    const requestScope = privateMediaScope()
    const request = loadCachedMedia(
      requestScope,
      msg,
      thumbnail,
      () => api.get(thumbnail ? thumbnailUrl(msg) : attachmentUrl(msg), { baseURL: '', responseType: 'blob', timeout: 120000, onDownloadProgress }),
      () => api.get(`/files/${msg.attachmentId}/status`),
    ).then(blob => {
        if (!blob || mediaRequests.get(key) !== request || attachmentExpired(msg)) return ''
        if ((thumbnail || msg.messageType === 'image') && !blob.type.startsWith('image/')) return ''
        const cacheKey = mediaCacheKey(requestScope, msg, thumbnail)
        const url = acquireObjectUrl(cacheKey, blob)
        if (msg.messageType !== 'video' || thumbnail) {
          mediaUrls.value[key] = url
          mediaSubscriptions.get(key)?.()
          mediaSubscriptions.set(key, subscribePrivateMedia(cacheKey, () => {
            if (mediaUrls.value[key] !== url) return
            delete mediaUrls.value[key]
            mediaRequests.delete(key)
            msg.attachmentStatus = 'expired'
            if (preview.value?.msg === msg) closePreview()
            persistMessages()
          }))
        }
        return url
      })
      .catch(error => {
        if (mediaRequests.get(key) === request && [403, 404, 410].includes(error?.httpStatus)) markAttachmentExpired(msg)
        return ''
      })
      .finally(() => { if (mediaRequests.get(key) === request) mediaRequests.delete(key) })
    mediaRequests.set(key, request)
  }
  return mediaRequests.get(key)
}
function mediaSrc(msg, thumbnail = false) {
  if (msg.localObjectUrl && !thumbnail) return msg.localObjectUrl
  if (!msg.attachmentId) return thumbnail ? thumbnailUrl(msg) : attachmentUrl(msg)
  return mediaUrls.value[mediaKey(msg, thumbnail)] || undefined
}
// 忆梦云团队开发：使用专用容器定位，不依赖直接父节点层级。
function handleChatMediaLoad(event) {
  const el = event.currentTarget
  if (!el.naturalWidth) return
  el.hidden = false
  const wrap = el.closest('.chat-media')
  const ratio = el.naturalWidth / el.naturalHeight
  if (wrap && Number.isFinite(ratio) && ratio > 0) {
    const isVideo = wrap.classList.contains('message-video-wrap')
    wrap.style.setProperty('--media-width', (isVideo ? 240 : Math.min(el.naturalWidth, 280, 220 * ratio)) + 'px')
    wrap.style.setProperty('--media-mobile-width', (isVideo ? 210 : Math.min(el.naturalWidth, 220, 180 * ratio)) + 'px')
    wrap.style.setProperty('--media-ratio', isVideo ? '16 / 10' : String(ratio))
    wrap.classList.add('has-media')
    wrap.classList.remove('media-error')
  }
}
function handleChatMediaError(event) {
  const el = event.currentTarget
  el.hidden = true
  const wrap = el.closest('.chat-media')
  wrap?.classList.remove('has-media')
  wrap?.classList.add('media-error')
  const label = wrap?.querySelector('.chat-media-placeholder')
  if (label) label.textContent = wrap.classList.contains('message-video-wrap') ? '封面不可用，点击重试' : '图片加载失败，点击重试'
}
function bindMedia(el, binding) {
  const { msg, thumbnail = false } = binding.value
  const signature = [mediaKey(msg, thumbnail), msg.attachmentId, msg.attachmentUrl, msg.thumbnailUrl, msg.localObjectUrl, msg.attachmentStatus, msg.recalledAt].join(':')
  if (el._mediaSignature === signature) return
  el._attachmentObserver?.disconnect()
  el._mediaSignature = signature
  const load = () => (msg.localObjectUrl && !thumbnail ? Promise.resolve(msg.localObjectUrl) : loadMedia(msg, thumbnail)).then(url => {
    if (!url && el.isConnected && el._mediaSignature === signature) handleChatMediaError({ currentTarget: el })
    if (url && el.isConnected && el._mediaSignature === signature && !attachmentExpired(msg)) { el.hidden = false; el.src = url }
  })
  if (!('IntersectionObserver' in window)) { load(); return }
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load() }
  }, { rootMargin: '160px' })
  el._attachmentObserver = observer
  observer.observe(el.closest('.chat-media') || el)
}
const vLazyMedia = {
  mounted: bindMedia, updated: bindMedia,
  unmounted(el) { el._mediaSignature = ''; el._attachmentObserver?.disconnect() },
}
async function openPreview(msg) {
  if (attachmentExpired(msg)) return
  closePreview()
  preview.value = { url: '', type: msg.messageType, name: msg.attachmentName, msg, loading: true, error: false }
  const current = preview.value
  try {
    let url
    if (msg.messageType === 'video') {
      if (!msg.attachmentId) throw new Error('旧视频缺少受保护附件标识，请下载或重新上传')
      current.abort = new AbortController()
      const result = await api.post('/files/' + encodeURIComponent(msg.attachmentId) + '/playback', {}, { signal: current.abort.signal })
      if (preview.value !== current || attachmentExpired(msg)) return
      const data = result?.data
      if (!data || !new RegExp('^/api/files/' + msg.attachmentId + '/playback/[a-f0-9]{32}$').test(data.url)
        || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now()) throw new Error('播放授权无效，请重试')
      url = data.url
      current.expiresAt = data.expiresAt
      current.timer = setTimeout(() => {
        if (preview.value !== current) return
        stopPreviewVideo()
        current.url = ''
        current.loading = false
        current.error = true
        current.errorMessage = '播放授权已到期，点击重新授权播放'
      }, data.expiresAt - Date.now())
      current.buffering = true
    } else {
      url = await loadMedia(msg, false, event => {
        if (preview.value === current) current.progress = downloadProgressState(event)
      })
    }
    if (preview.value !== current || attachmentExpired(msg)) return
    current.url = url
    current.error = !url
  } catch (error) {
    if (preview.value === current) {
      if (error?.httpStatus === 410) { markAttachmentExpired(msg); return }
      current.error = true
      current.errorMessage = error?.message || '加载失败，点击重试'
    }
  } finally {
    if (preview.value === current) {
      current.loading = false
      if (!current.url) current.error = true
    }
  }
}
function stopPreviewVideo() {
  const video = previewVideo.value
  if (video) { video.pause(); video.removeAttribute('src'); video.load() }
}
function previewMediaEvent(event) {
  const current = preview.value
  if (!current || event.target !== previewVideo.value || !current.url || current.error) return
  if (Date.now() >= current.expiresAt) {
    stopPreviewVideo()
    current.url = ''
    current.error = true
    current.errorMessage = '播放授权已到期，点击重新授权播放'
    return
  }
  current.buffering = event.type === 'waiting' || event.type === 'loadedmetadata'
  if (event.type === 'error') {
    current.error = true
    current.errorMessage = '视频无法播放：格式/编码不支持、授权失效或网络异常，点击重试'
    clearTimeout(current.timer)
    stopPreviewVideo()
    current.url = ''
  }
}
function closePreview() {
  preview.value?.abort?.abort()
  clearTimeout(preview.value?.timer)
  stopPreviewVideo()
  preview.value = null
}
function isDownloaded(msg) {
  downloadedVersion.value
  if (!msg?.attachmentId) return false
  const bridge = getNativeAttachmentBridge()
  if (bridge) {
    try { return getNativeAttachmentState(bridge, cacheScope, msg.attachmentId).status === 'saved' } catch { return false }
  }
  return wasAttachmentDownloaded(localStorage, cacheScope, msg.attachmentId)
}

function handleNativeAttachment(event) {
  const detail = event?.detail || {}
  if (!detail.attachmentId) return
  if (detail.status === 'progress') downloadProgress.value = downloadProgressState(detail)
  if (detail.status === 'saved') {
    markAttachmentDownloaded(localStorage, cacheScope, detail.attachmentId)
    downloadedVersion.value += 1
    downloadProgress.value = { status: 'success', loaded: detail.loaded, total: detail.total, percent: 100 }
    showToast('文件已保存')
    setTimeout(() => { downloadProgress.value = null }, 1800)
  }
  if (detail.status === 'failed') {
    clearAttachmentDownloaded(localStorage, cacheScope, detail.attachmentId)
    downloadedVersion.value += 1
    if (Number(detail.httpStatus) === 410) {
      const msg = messages.value.find(item => String(item.attachmentId) === String(detail.attachmentId))
      markAttachmentExpired(msg)
    }
    downloadProgress.value = { ...downloadProgress.value, status: 'failed' }
    showToast(detail.message || '下载失败')
    setTimeout(() => { downloadProgress.value = null }, 1800)
  }
}

async function downloadFile(msgOrUrl, name = '下载文件') {
  contextMenu.value = null
  const msg = typeof msgOrUrl === 'object' ? msgOrUrl : null
  if (attachmentExpired(msg)) return
  const url = msg ? attachmentUrl(msg) : msgOrUrl
  const fileName = msg?.attachmentName || name
  const shouldShare = isDownloaded(msg)
  const bridge = msg?.attachmentId ? getNativeAttachmentBridge() : null
  downloadProgress.value = { status: 'downloading', loaded: 0, total: 0, percent: 0 }
  if (bridge) {
    try {
      if (shouldShare) {
        const opened = openNativeAttachment(bridge, cacheScope, msg.attachmentId)
        if (opened.status !== 'missing') {
          if (opened.status === 'no_handler' || opened.status === 'error') showToast(opened.message || '无法打开文件')
          downloadProgress.value = null
          return
        }
        clearAttachmentDownloaded(localStorage, cacheScope, msg.attachmentId)
        downloadedVersion.value += 1
      }
      const started = saveNativeAttachment(
        bridge,
        cacheScope,
        msg.attachmentId,
        fileName,
        msg.attachmentMimeType || 'application/octet-stream',
      )
      if (started.status === 'busy') showToast(started.message || '文件正在保存')
      else if (started.status !== 'started') throw new Error(started.message || '无法开始保存文件')
    } catch (error) {
      downloadProgress.value = { ...downloadProgress.value, status: 'failed' }
      showToast(error?.message || '下载失败')
      setTimeout(() => { downloadProgress.value = null }, 1800)
    }
    return
  }
  try {
    const blob = await api.get(url, {
      baseURL: '', responseType: 'blob', timeout: 120000,
      onDownloadProgress: event => { downloadProgress.value = downloadProgressState(event) },
    })
    downloadProgress.value = { status: 'success', loaded: blob.size, total: blob.size, percent: 100 }
    const sharedFile = shouldShare ? canShareBlob(navigator, blob, fileName) : null
    if (sharedFile) {
      try {
        await navigator.share({ files: [sharedFile], title: sharedFile.name })
        showToast('已打开分享/应用选择')
      } catch (error) {
        if (error?.name === 'AbortError') return
        saveBlob(blob, fileName)
        showToast('分享不可用，已下载')
      }
    } else {
      saveBlob(blob, fileName)
      showToast(shouldShare ? '当前环境不支持文件分享，已下载' : '文件已保存')
    }
    if (msg?.attachmentId) {
      markAttachmentDownloaded(localStorage, cacheScope, msg.attachmentId)
      downloadedVersion.value += 1
    }
  } catch (error) {
    if (error?.httpStatus === 410) markAttachmentExpired(msg)
    downloadProgress.value = { ...downloadProgress.value, status: 'failed' }
    showToast(error?.httpStatus === 410 ? '该文件已过期并自动清理' : '下载失败')
  } finally {
    setTimeout(() => { downloadProgress.value = null }, 1800)
  }
}
function showContextMenu(event, msg) {
  event.preventDefault()
  const x = Math.max(8, Math.min(event.clientX || innerWidth / 2, innerWidth - 150))
  const y = Math.max(8, Math.min(event.clientY || innerHeight / 2, innerHeight - 160))
  contextMenu.value = { msg, x, y }
}
function closeContextMenu() {
  contextMenu.value = null
}
function startLongPress(event, msg) {
  clearTimeout(longPressTimer)
  const point = event.touches?.[0]
  if (!point) return
  longPressStart = { x: point.clientX, y: point.clientY }
  const position = { preventDefault() {}, clientX: point.clientX, clientY: point.clientY }
  longPressTimer = setTimeout(() => {
    suppressBubbleClickUntil = Date.now() + 700
    showContextMenu(position, msg)
  }, 550)
}
function moveLongPress(event) {
  const point = event.touches?.[0]
  if (!point || !longPressStart) return
  if (Math.hypot(point.clientX - longPressStart.x, point.clientY - longPressStart.y) > 10) cancelLongPress()
}
function finishLongPress() {
  cancelLongPress()
}
function cancelLongPress() {
  clearTimeout(longPressTimer)
  longPressStart = null
}

function handleBubbleClick(event) {
  if (Date.now() >= suppressBubbleClickUntil) return
  event.preventDefault()
  event.stopPropagation()
}
function fallbackCopyText(text) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  try {
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    return document.execCommand('copy')
  } finally {
    textarea.remove()
  }
}
async function copyMessage(msg) {
  const text = String(msg.content || '')
  try {
    if (!text) throw new Error('没有可复制的内容')
    let copied = false
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        copied = true
      } catch {}
    }
    if (!copied) copied = fallbackCopyText(text)
    if (!copied) throw new Error('复制失败')
    showToast('已复制')
  } catch { showToast('复制失败') }
  contextMenu.value = null
}
async function recallMessage(msg) {
  try {
    await api.post(`/tenant/conversations/${props.conversationId}/messages/${msg._id}/recall`)
    releaseAttachmentUrls(msg)
    Object.assign(msg, { recalledAt: new Date().toISOString(), attachmentStatus: 'recalled', content: '', attachmentUrl: '', attachmentName: '', thumbnailUrl: '' })
    if (msg.attachmentId) invalidateAttachment(cacheScope, msg.attachmentId, 'recalled')
    persistMessages()
    showToast('消息已撤回')
  } catch (e) { showToast(e?.message || '撤回失败') }
  contextMenu.value = null
}
async function deleteMessage(msg) {
  try {
    await api.delete(`/tenant/conversations/${props.conversationId}/messages/${msg._id}`)
    releaseAttachmentUrls(msg)
    if (msg.attachmentId) invalidateAttachment(privateMediaScope(), msg.attachmentId, 'deleted')
    messages.value = messages.value.filter(item => String(item._id) !== String(msg._id))
    persistMessages()
    showToast('消息已删除')
  } catch (e) { showToast(e?.message || '删除失败') }
  contextMenu.value = null
}
function applyRecall(data) {
  if (String(data.conversationId) !== String(props.conversationId)) return
  const msg = messages.value.find(item => String(item._id) === String(data.messageId))
  if (msg) {
    releaseAttachmentUrls(msg)
    Object.assign(msg, { recalledAt: data.recalledAt, attachmentStatus: 'recalled', content: '', attachmentUrl: '', attachmentName: '', thumbnailUrl: '' })
    invalidateAttachment(privateMediaScope(), msg.attachmentId, 'recalled')
    persistMessages()
  }
}
function applyDelete(data) {
  if (String(data.conversationId) !== String(props.conversationId)) return
  if (data.clearAll && data.side === 'agent') {
    messageGeneration++
    historyCursor = null
    closePreview()
    releaseMediaUrls()
    messages.value = []
    hasMoreMessages.value = false
    contextMenu.value = null
    clearCachedConversation(cacheScope, props.conversationId)
    return
  }
  const msg = messages.value.find(item => String(item._id) === String(data.messageId))
  if (msg?.attachmentId) {
    releaseAttachmentUrls(msg)
    invalidateAttachment(privateMediaScope(), msg.attachmentId, 'deleted')
  }
  messages.value = messages.value.filter(item => String(item._id) !== String(data.messageId))
  persistMessages()
}
function applyAttachmentUpdate(data) {
  if (String(data.conversationId) !== String(props.conversationId)) return
  const msg = messages.value.find(item => String(item._id) === String(data.messageId))
  if (!msg || !['expired', 'recalled', 'deleted'].includes(data.status)) return
  msg.attachmentStatus = data.status
  releaseAttachmentUrls(msg)
  invalidateAttachment(privateMediaScope(), data.attachmentId || msg.attachmentId, data.status)
  persistMessages()
}
async function sendQuickReply(qr) {
  if (!accepted.value || conversation.value?.status !== 'active' || sendingQuickReplyId.value) return
  sendingQuickReplyId.value = qr._id
  const epoch = conversationEpoch
  try {
    const session = await prepareSendWindow()
    if (!session) return
    const payload = {
      content: String(qr.content || '').trim(),
      clientMessageId: 'qr_' + Date.now(),
    }
    if (qr.imageUrl) Object.assign(payload, { messageType: 'image', attachmentUrl: qr.imageUrl, attachmentName: qr.imageName || '' })
    const res = await api.post(`/tenant/conversations/${session.conversationId}/messages`, payload)
    if (!isCurrentSend(session)) return
    if (res.code !== 0) throw new Error(res.message || '发送失败')
    mergeMessage(res.data)
    showQuickReplies.value = false
    await scrollToLatest()
  } catch (e) { if (epoch === conversationEpoch) showToast(e?.message || '快捷回复发送失败') }
  finally { if (epoch === conversationEpoch) sendingQuickReplyId.value = null }
}
function imageCaption(msg) {
  const content = String(msg.content || '').trim()
  if (!content || ['[图片]', '[视频]'].includes(content) || content === String(msg.attachmentUrl || '').trim()) return ''
  return content
}
function parseMessageContent(content = '') {
  const urlPattern = /((?:https?:\/\/|www\.)[^\s<]+)/gi
  const parts = []
  let lastIndex = 0
  for (const match of String(content).matchAll(urlPattern)) {
    if (match.index > lastIndex) parts.push({ type: 'text', text: content.slice(lastIndex, match.index) })
    const trailing = match[0].match(/[，。！？；：、,.!?;:]+$/)?.[0] || ''
    const text = trailing ? match[0].slice(0, -trailing.length) : match[0]
    parts.push({ type: 'link', text, href: text.toLowerCase().startsWith('www.') ? `https://${text}` : text })
    if (trailing) parts.push({ type: 'text', text: trailing })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < content.length) parts.push({ type: 'text', text: content.slice(lastIndex) })
  return parts.length ? parts : [{ type: 'text', text: content }]
}
function formatTime(iso) { return iso ? new Date(iso).toTimeString().slice(0, 5) : '' }
function formatDateTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso); return d.toLocaleString('zh-CN', { hour12: false })
}
function avatarChar() {
  return conversation.value?.customer?.qq?.slice(-1) || conversation.value?.customer?.phone?.slice(-1) || '客'
}

defineExpose({ reload: init })
</script>

<template>
  <div
    class="cp-panel"
    :class="{ loading }"
    :style="{ top: viewportTop, height: viewportHeight }"
  >
    <div v-if="loading" class="cp-loading">加载中...</div>
    <div v-else-if="!conversation" class="cp-empty">
      <div class="cp-empty-emoji">💬</div>
      <div class="cp-empty-title">选择一个会话开始接待</div>
    </div>

    <template v-else>
      <!-- 顶部栏 -->
      <header class="cp-header">
        <button class="cp-back" type="button" aria-label="返回消息列表" @click="emit('back')">←</button>
        <button v-if="$slots.back" class="cp-back" @click="emit('back')">←</button>
        <div class="cp-title-wrap" @click="showInfo = !showInfo">
          <img v-if="customerAvatarVisible()" v-cached-avatar="conversation.customer.avatarUrl" class="cp-avatar cp-avatar-image" :src="avatarSrc(conversation.customer.avatarUrl)" loading="lazy" decoding="async" alt="客户头像" @error="handleAvatarError(conversation.customer.avatarUrl)" />
          <div v-else class="cp-avatar">{{ avatarChar() }}</div>
          <div>
            <div class="cp-title">
              {{ conversation.customer?.qq ? `QQ ${conversation.customer.qq}` : (conversation.customer?.phone ? '*' + conversation.customer.phone.slice(-4) : '访客') }}
              <span class="cp-status-tag" :class="conversation.status">
                {{ conversation.status === 'active' ? '处理中' : conversation.status === 'waiting' ? '待接入' : '已结束' }}
              </span>
            </div>
            <div class="cp-sub" :class="customerOnline ? 'is-online' : 'is-offline'">
              <span class="cp-presence-dot"></span>{{ customerOnline ? '客户在线' : '客户离线' }}
            </div>
          </div>
        </div>
        <div class="cp-header-actions">
          <button v-if="!accepted && conversation.status !== 'closed'" class="cp-btn cp-btn-primary" @click="accept">接入</button>
          <button v-if="conversation.status === 'active'" class="cp-btn cp-btn-danger" @click="showCloseConfirm = true">结束</button>
        </div>
      </header>

      <!-- 消息区 -->
      <button v-if="positionMode === 'search' || !following || pendingMessages" class="cp-latest-entry" type="button" @click="returnToLatest">{{ pendingMessages ? `${pendingMessages} 条新消息 · 回到最新` : '回到最新' }}</button>
      <div class="cp-body" ref="msgContainer" @scroll="handleMessageScroll" tabindex="0" @wheel.passive="position.input" @touchstart.passive="position.input" @touchmove.passive="position.input" @keydown="position.input" @pointerdown="position.input">
        <div v-if="loadingHistory" class="cp-history-status">正在加载历史消息...</div>
        <div v-else-if="!hasMoreMessages && messages.length" class="cp-history-status">没有更早的消息了</div>
        <div v-if="!accepted && conversation.status !== 'closed'" class="cp-notice">
          <div class="cp-notice-inner">
            <div class="cp-notice-title">新会话待接入</div>
            <div class="cp-notice-desc">点击顶部「接入」开始与客户沟通</div>
            <button class="cp-btn cp-btn-primary" @click="accept" style="margin-top:10px;">立即接入</button>
          </div>
        </div>

        <template v-for="(msg, idx) in messages" :key="msg._id">
          <div v-if="msg.recalledAt" class="cp-system-msg">
            <span>{{ msg.senderType === 'customer' ? '客户撤回一条消息' : '客服撤回一条消息' }}</span>
          </div>

          <div v-else-if="msg.senderType === 'system'" class="cp-system-msg" :data-message-id="msg._id">
            <span>{{ msg.content }}</span>
          </div>

          <div v-else class="cp-bubble-row" :data-message-id="msg._id" :class="msg.senderType === 'customer' ? 'is-left' : 'is-right'">
            <template v-if="msg.senderType === 'customer'">
              <img v-if="customerAvatarVisible()" v-cached-avatar="conversation.customer.avatarUrl" class="cp-bubble-avatar" :src="avatarSrc(conversation.customer.avatarUrl)" loading="lazy" decoding="async" alt="客户头像" @error="handleAvatarError(conversation.customer.avatarUrl)" />
              <div v-else class="cp-bubble-avatar" :style="{ background: `linear-gradient(135deg,#f59e0b,#d97706)` }">{{ avatarChar() }}</div>
              <div class="cp-bubble-wrap">
                <div class="cp-bubble cp-bubble-customer" :class="{ 'bare-media': ['image', 'video'].includes(msg.messageType), 'cp-media-message-bubble': ['image', 'video', 'file'].includes(msg.messageType) && (msg.attachmentId || msg.attachmentUrl || msg.localObjectUrl || msg.uploadPhase), 'cp-menu-active': contextMenu?.msg === msg }" @contextmenu="showContextMenu($event, msg)" @touchstart="startLongPress($event, msg)" @touchend="finishLongPress" @touchcancel="cancelLongPress" @touchmove="moveLongPress" @click.capture="handleBubbleClick">
                  <template v-if="msg.recalledAt"><span class="cp-recalled">消息已撤回</span></template>
                  <template v-else-if="attachmentExpired(msg)"><span class="chat-media-expired">该文件已过期并自动清理</span><div v-if="['image', 'video'].includes(msg.messageType) && imageCaption(msg)" class="cp-image-caption">{{ imageCaption(msg) }}</div></template>
                  <template v-else-if="msg.messageType === 'image'">
                    <button type="button" class="chat-media" :disabled="Boolean(msg.uploadPhase)" :aria-label="msg.uploadPhase ? '附件尚未发送' : '查看原图'" @click="openPreview(msg)">
                      <span class="chat-media-placeholder">图片加载中</span>
                      <img :src="mediaSrc(msg)" v-lazy-media="{ msg }" class="chat-media-image" alt="" loading="lazy" decoding="async" @load="handleChatMediaLoad" @error="handleChatMediaError" />

                      <span v-if="msg.uploadPhase === 'uploading'" class="chat-media-progress" aria-hidden="true"><i :style="{ width: msg.uploadProgress + '%' }"></i></span>
                    </button>
                    <div v-if="imageCaption(msg)" class="cp-image-caption">{{ imageCaption(msg) }}</div>
                  </template>
                  <template v-else-if="msg.messageType === 'video'">
                    <button type="button" class="chat-media message-video-wrap" :disabled="Boolean(msg.uploadPhase)" :aria-label="msg.uploadPhase ? '附件尚未发送' : '播放视频'" @click="openPreview(msg)">
                      <span class="chat-media-placeholder">暂无视频封面</span>
                      <img :src="mediaSrc(msg, true)" v-lazy-media="{ msg, thumbnail: true }" class="chat-media-image" alt="" loading="lazy" decoding="async" @load="handleChatMediaLoad" @error="handleChatMediaError" />
                      <span class="chat-media-play"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M9 5v14l11-7z" fill="currentColor" /></svg></span>
                      <span v-if="msg.uploadPhase === 'uploading'" class="chat-media-progress" aria-hidden="true"><i :style="{ width: msg.uploadProgress + '%' }"></i></span>
                    </button>
                    <div v-if="imageCaption(msg)" class="cp-image-caption">{{ imageCaption(msg) }}</div>
                  </template>
                  <button v-else-if="msg.messageType === 'file' && (msg.attachmentId || msg.attachmentUrl || msg.uploadPhase)" class="cp-bubble-file" :disabled="Boolean(msg.uploadPhase)" @click="downloadFile(msg)">
                    <span>▤</span><span>{{ msg.attachmentName || '文件' }}<small v-if="!msg.uploadPhase">{{ isDownloaded(msg) ? (getNativeAttachmentBridge() ? '已保存' : '分享/选择应用') : '下载' }}</small></span>
                  </button>
                  <template v-else>
                    <template v-for="(part, index) in parseMessageContent(msg.content)" :key="index">
                      <a v-if="part.type === 'link'" class="cp-message-link" :href="part.href" target="_blank" rel="noopener noreferrer" @click.stop>{{ part.text }}</a>
                      <span v-else>{{ part.text }}</span>
                    </template>
                  </template>
                </div>
                <div class="cp-bubble-time">{{ formatTime(msg.createdAt) }}</div>
              </div>
            </template>

            <template v-else>
              <div class="cp-bubble-wrap">
                <div class="cp-bubble" :class="{ 'bare-media': ['image', 'video'].includes(msg.messageType), 'cp-media-message-bubble': ['image', 'video', 'file'].includes(msg.messageType) && (msg.attachmentId || msg.attachmentUrl || msg.localObjectUrl || msg.uploadPhase), 'cp-menu-active': contextMenu?.msg === msg }" @contextmenu="showContextMenu($event, msg)" @touchstart="startLongPress($event, msg)" @touchend="finishLongPress" @touchcancel="cancelLongPress" @touchmove="moveLongPress" @click.capture="handleBubbleClick">
                  <template v-if="msg.recalledAt"><span class="cp-recalled">消息已撤回</span></template>
                  <template v-else-if="attachmentExpired(msg)"><span class="chat-media-expired">该文件已过期并自动清理</span><div v-if="['image', 'video'].includes(msg.messageType) && imageCaption(msg)" class="cp-image-caption">{{ imageCaption(msg) }}</div></template>
                  <template v-else-if="msg.messageType === 'image'">
                    <button type="button" class="chat-media" :disabled="Boolean(msg.uploadPhase)" :aria-label="msg.uploadPhase ? '附件尚未发送' : '查看原图'" @click="openPreview(msg)">
                      <span class="chat-media-placeholder">图片加载中</span>
                      <img :src="mediaSrc(msg)" v-lazy-media="{ msg }" class="chat-media-image" alt="" loading="lazy" decoding="async" @load="handleChatMediaLoad" @error="handleChatMediaError" />

                      <span v-if="msg.uploadPhase === 'uploading'" class="chat-media-progress" aria-hidden="true"><i :style="{ width: msg.uploadProgress + '%' }"></i></span>
                    </button>
                    <div v-if="imageCaption(msg)" class="cp-image-caption">{{ imageCaption(msg) }}</div>
                  </template>
                  <template v-else-if="msg.messageType === 'video'">
                    <button type="button" class="chat-media message-video-wrap" :disabled="Boolean(msg.uploadPhase)" :aria-label="msg.uploadPhase ? '附件尚未发送' : '播放视频'" @click="openPreview(msg)">
                      <span class="chat-media-placeholder">暂无视频封面</span>
                      <img :src="mediaSrc(msg, true)" v-lazy-media="{ msg, thumbnail: true }" class="chat-media-image" alt="" loading="lazy" decoding="async" @load="handleChatMediaLoad" @error="handleChatMediaError" />
                      <span class="chat-media-play"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M9 5v14l11-7z" fill="currentColor" /></svg></span>
                      <span v-if="msg.uploadPhase === 'uploading'" class="chat-media-progress" aria-hidden="true"><i :style="{ width: msg.uploadProgress + '%' }"></i></span>
                    </button>
                    <div v-if="imageCaption(msg)" class="cp-image-caption">{{ imageCaption(msg) }}</div>
                  </template>
                  <button v-else-if="msg.messageType === 'file' && (msg.attachmentId || msg.attachmentUrl || msg.uploadPhase)" class="cp-bubble-file" :disabled="Boolean(msg.uploadPhase)" @click="downloadFile(msg)">
                    <span>▤</span><span>{{ msg.attachmentName || '文件' }}<small v-if="!msg.uploadPhase">{{ isDownloaded(msg) ? '分享/选择应用' : '下载' }}</small></span>
                  </button>
                  <template v-else>
                    <template v-for="(part, index) in parseMessageContent(msg.content)" :key="index">
                      <a v-if="part.type === 'link'" class="cp-message-link" :href="part.href" target="_blank" rel="noopener noreferrer" @click.stop>{{ part.text }}</a>
                      <span v-else>{{ part.text }}</span>
                    </template>
                  </template>
                </div>
                <div v-if="msg.uploadPhase || msg.sendFailed" class="cp-transfer-status" :class="{ failed: msg.uploadPhase === 'failed' || msg.sendFailed }" :tabindex="msg.uploadPhase === 'failed' || msg.sendFailed ? 0 : undefined" role="status"><template v-if="msg.uploadPhase === 'uploading'">正在上传 {{ msg.uploadProgress }}%</template><template v-else-if="msg.uploadPhase === 'sending'">上传完成，正在发送消息</template><template v-else>上传或发送失败</template></div>
                <div v-if="msg.autoReplyType === 'keyword'" class="cp-keyword-reply-notice">关键词自动回复内容可作为参考</div>
                <div class="cp-bubble-time">{{ formatTime(msg.createdAt) }}</div>
              </div>
              <img v-if="msg.senderType === 'agent' && (msg.sender?.avatarUrl || conversation.channel?.avatarUrl)" v-cached-avatar="msg.sender?.avatarUrl || conversation.channel.avatarUrl" class="cp-bubble-avatar" :src="avatarSrc(msg.sender?.avatarUrl || conversation.channel.avatarUrl)" loading="lazy" decoding="async" alt="客服头像" />
              <div v-else class="cp-bubble-avatar" :style="{ background: `linear-gradient(135deg,#2563eb,#1d4ed8)` }">{{ msg.senderType === 'bot' ? 'AI' : (msg.sender?.displayName?.[0] || '我') }}</div>
            </template>
          </div>
        </template>
      </div>

      <!-- 输入区 -->
      <div class="cp-input-area">
        <div class="cp-input-row">
          <button class="cp-more-btn" @click="showMore = !showMore; showQuickReplies = false">+</button>
          <textarea
            v-model="input"
            class="cp-input"
            placeholder="输入消息"
            rows="2"
            @focus="showQuickReplies = false; showMore = false; scrollToLatest()"
            :disabled="!accepted || conversation.status === 'closed'"
          ></textarea>
          <button class="cp-send-btn" @click="sendMsg" :disabled="sending || !input.trim() || !accepted">发送</button>
        </div>

        <div v-if="showMore" class="cp-more-panel">
          <div class="cp-more-grid">
            <label class="cp-more-item" :class="{ disabled: !accepted || uploading }">
              <input type="file" accept="image/*" @change="handleUpload" style="display:none" />
              <span class="cp-more-icon">▧</span><span>发送图片</span>
            </label>
            <label class="cp-more-item" :class="{ disabled: !accepted || uploading }">
              <input type="file" accept="video/*" @change="handleUpload" style="display:none" />
              <span class="cp-more-icon">▷</span><span>发送视频</span>
            </label>
            <label class="cp-more-item" :class="{ disabled: !accepted || uploading }">
              <input type="file" accept=".pdf,.zip,.txt,.doc,.docx" @change="handleUpload" style="display:none" />
              <span class="cp-more-icon">▤</span><span>发送文件</span>
            </label>
            <button class="cp-more-item" :disabled="!accepted || conversation.status !== 'active'" @click="showMore = false; showQuickReplies = true">
              <span class="cp-more-icon">💬</span><span>快捷回复</span>
            </button>
            <button class="cp-more-item" @click="showMore = false; showInfo = true">
              <span class="cp-more-icon">👤</span><span>客户资料</span>
            </button>
          </div>
        </div>
      </div>

      <section v-if="showQuickReplies" class="cp-quick-screen" aria-label="快捷回复列表">
        <header class="cp-quick-screen-header">
          <button type="button" aria-label="返回聊天" @click="showQuickReplies = false">←</button>
          <div><strong>快捷回复</strong><small>点击条目直接发送</small></div>
        </header>
        <div class="cp-quick-screen-list">
          <div v-if="!quickReplies.length" class="cp-quick-empty">暂无快捷回复</div>
          <button v-for="qr in quickReplies" :key="qr._id" class="cp-quick-item" :disabled="Boolean(sendingQuickReplyId)" @click="sendQuickReply(qr)">
            <span><strong>{{ qr.title }}</strong><small>{{ qr.content || '图片回复' }}</small></span>
            <img v-if="qr.imageUrl" :src="qr.imageUrl" loading="lazy" decoding="async" alt="快捷回复图片" />
          </button>
        </div>
      </section>
    </template>

    <div v-if="preview" class="cp-preview" @click.self="closePreview">
      <div class="cp-preview-actions">
        <button type="button" @click="downloadFile(preview.msg || preview.url, preview.name)">下载</button>
        <button type="button" class="cp-preview-close" @click="closePreview">×</button>
      </div>
      <div v-if="preview.loading" role="status" style="color:white">正在安全加载…</div>
      <button v-else-if="preview.error" type="button" @click="openPreview(preview.msg)">{{ preview.errorMessage || '加载失败，点击重试' }}</button>
      <img v-else-if="preview.type === 'image'" :src="preview.url" :alt="preview.name || '图片预览'" />
      <video v-else-if="preview.url" ref="previewVideo" :key="preview.url" :src="preview.url" controls autoplay preload="metadata" playsinline @loadedmetadata="previewMediaEvent" @canplay="previewMediaEvent" @playing="previewMediaEvent" @waiting="previewMediaEvent" @error="previewMediaEvent"></video>
      <div v-if="preview.type === 'video' && preview.buffering && !preview.error && !preview.loading" role="status" style="position:absolute;bottom:80px;left:10%;right:10%;text-align:center;color:white;pointer-events:none">正在加载/缓冲视频…</div>
    </div>

    <div v-if="contextMenu" class="cp-menu-mask" @pointerdown="closeContextMenu">
      <div class="cp-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @pointerdown.stop>
        <button v-if="contextMenu.msg.messageType !== 'image' && String(contextMenu.msg.content || '')" type="button" @click="copyMessage(contextMenu.msg)">复制</button>
        <button v-if="canRecallMessage(contextMenu.msg)" type="button" @click="recallMessage(contextMenu.msg)">撤回</button>
        <button v-if="canDeleteMessage(contextMenu.msg)" type="button" class="danger" @click="deleteMessage(contextMenu.msg)">删除</button>
      </div>
    </div>

    <div v-if="downloadProgress" class="cp-download" :class="{ failed: downloadProgress.status === 'failed' }">
      <div v-if="downloadProgress.status === 'failed'">下载失败</div>
      <div v-else>正在下载 {{ downloadProgress.percent }}% · {{ formatBytes(downloadProgress.loaded) }}<template v-if="downloadProgress.total"> / {{ formatBytes(downloadProgress.total) }}</template></div>
      <span><i :style="{ width: downloadProgress.percent + '%' }"></i></span>
    </div>
    <div v-else-if="toast" class="cp-toast">{{ toast }}</div>

    <!-- 客户资料侧栏 -->
    <div v-if="showInfo && conversation" class="cp-info-drawer" @click.self="showInfo = false">
      <div class="cp-info-content">
        <div class="cp-info-title">会话资料<button class="cp-info-close" @click="showInfo = false">×</button></div>
        <div class="cp-info-body">
          <div class="cp-info-row"><span>所属渠道</span><span>{{ conversation.channel?.name || '-' }}</span></div>
          <div class="cp-info-row"><span>接待客服</span><span>{{ assignedAgentName || (conversation.status === 'waiting' ? '暂未接待' : '-') }}</span></div>
          <div class="cp-info-row"><span>客服账号</span><span>{{ assignedAgentUsername || (conversation.status === 'waiting' ? '暂未接待' : '-') }}</span></div>
          <div class="cp-info-row"><span>会话 ID</span><span class="cp-info-id">{{ conversation._id }}</span></div>
          <div class="cp-info-row"><span>接入时间</span><span>{{ formatDateTime(conversation.acceptedAt) }}</span></div>
          <div class="cp-info-row"><span>结束时间</span><span>{{ formatDateTime(conversation.closedAt) }}</span></div>
        </div>
        <div class="cp-info-actions">
          <button @click="confirmAction = 'receive'">{{ conversation.customer?.messageReceivingDisabled ? '恢复接收客户消息' : '不接收该客户信息' }}</button>
          <button class="danger" @click="confirmAction = 'block'">{{ conversation.customer?.blocked ? '解除拉黑客户' : '拉黑该客户' }}</button>
          <button class="danger" @click="confirmAction = 'clear'">清理对话内容</button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :open="Boolean(confirmAction)"
      :title="confirmAction === 'clear' ? '清理对话内容' : (confirmAction === 'block' ? (conversation?.customer?.blocked ? '解除拉黑客户' : '拉黑该客户') : (conversation?.customer?.messageReceivingDisabled ? '恢复接收客户消息' : '不接收该客户信息'))"
      :message="confirmAction === 'clear' ? '只会清理当前客服界面中的全部消息，客户界面的消息不会删除。' : (confirmAction === 'block' ? '拉黑后客服不会收到该客户消息，客户发送时会显示失败感叹号。' : '关闭接收后，该客户将无法向客服发送消息。')"
      confirm-text="确认"
      :danger="confirmAction === 'clear' || confirmAction === 'block'"
      :loading="actionSubmitting"
      @confirm="runCustomerAction"
      @cancel="confirmAction = null"
    />

    <ConfirmDialog
      :open="showCloseConfirm"
      title="结束会话"
      message="确认结束该会话吗？结束后将无法继续发送消息。"
      confirm-text="确认结束"
      danger
      :loading="closing"
      @confirm="close"
      @cancel="showCloseConfirm = false"
    />
  </div>
</template>

<style scoped>
.cp-latest-entry { flex-shrink: 0; align-self: center; min-height: 36px; padding: 6px 16px; border: 1px solid #bfdbfe; border-radius: 18px; background: #eff6ff; color: #2563eb; cursor: pointer; }
.cp-latest-entry:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
.cp-preview{position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center}.cp-preview>img,.cp-preview>video{max-width:96vw;max-height:92vh;object-fit:contain}.cp-preview-actions{position:absolute;right:18px;top:18px;display:flex;gap:10px;z-index:1}.cp-preview-actions button{border:0;border-radius:8px;background:rgba(255,255,255,.18);color:#fff;padding:9px 14px;cursor:pointer}.cp-preview-actions .cp-preview-close{font-size:24px;line-height:20px}.cp-menu-mask{position:fixed;inset:0;z-index:250}.cp-menu{position:fixed;width:140px;padding:6px;background:#fff;border-radius:10px;box-shadow:0 8px 30px rgba(15,23,42,.25);display:flex;flex-direction:column}.cp-menu button{border:0;background:transparent;text-align:left;padding:10px 12px;border-radius:6px;cursor:pointer}.cp-menu button:hover{background:#f1f5f9}.cp-menu button.danger{color:#dc2626}.cp-download,.cp-toast{position:fixed;z-index:320;left:50%;bottom:24px;transform:translateX(-50%);background:#0f172a;color:#fff;border-radius:10px;padding:10px 16px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.2)}.cp-download span{display:block;width:180px;height:3px;background:#475569;margin-top:7px}.cp-download i{display:block;height:100%;background:#60a5fa}.cp-download.failed{background:#991b1b}.cp-download.failed i{background:#fca5a5}.cp-recalled{font-style:italic;opacity:.75}.cp-bubble-file{border:0;cursor:pointer;font-family:inherit}
.cp-avatar-image { object-fit: cover; }
.cp-panel {
  position: fixed; left: 0; right: 0;
  display: flex; flex: 1 1 auto; flex-direction: column;
  width: 100%; min-width: 0; min-height: 0;
  overflow: hidden; background: #f8fafc;
}
.cp-loading, .cp-empty { flex: 1; display: flex; align-items: center; justify-content: center; flex-direction: column; color: #94a3b8; }
.cp-empty-emoji { font-size: 56px; margin-bottom: 12px; }
.cp-empty-title { font-size: 14px; }

/* 顶部栏 */
.cp-header {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; background: #fff; border-bottom: 1px solid #e2e8f0;
  position: relative; z-index: 1; flex-shrink: 0;
}
.cp-back {
  width: 36px; height: 36px; border: none; background: transparent;
  border-radius: 8px; cursor: pointer; font-size: 18px; color: #475569;
}
.cp-back:hover { background: #f1f5f9; }
.cp-title-wrap { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; cursor: pointer; }
.cp-avatar {
  width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 16px;
}
.cp-title { font-weight: 600; font-size: 15px; color: #0f172a; display: flex; align-items: center; gap: 8px; }
.cp-status-tag { font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
.cp-status-tag.active { background: #dcfce7; color: #16a34a; }
.cp-status-tag.waiting { background: #dbeafe; color: #2563eb; }
.cp-status-tag.closed { background: #f1f5f9; color: #94a3b8; }
.cp-sub { display: flex; align-items: center; gap: 5px; font-size: 12px; margin-top: 2px; }
.cp-sub.is-online { color: #16a34a; }
.cp-sub.is-offline { color: #94a3b8; }
.cp-presence-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.cp-header-actions { display: flex; gap: 8px; flex-shrink: 0; }
.cp-btn { padding: 7px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; border: none; cursor: pointer; transition: all .15s; }
.cp-btn-primary { background: #2563eb; color: #fff; }
.cp-btn-primary:hover { background: #1d4ed8; }
.cp-btn-secondary { background: #f1f5f9; color: #475569; }
.cp-btn-danger { background: #ef4444; color: #fff; }
.cp-btn-danger:hover { background: #dc2626; }
.cp-btn:disabled { opacity: .5; cursor: not-allowed; }

/* 消息区 */
.cp-body { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 2px; min-height: 0; }
.cp-history-status { padding: 8px 0 12px; color: #94a3b8; font-size: 12px; text-align: center; }
.cp-notice { padding: 20px; text-align: center; }
.cp-notice-inner { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 12px; padding: 20px; max-width: 320px; margin: 0 auto; }
.cp-notice-title { font-weight: 600; color: #c2410c; margin-bottom: 4px; font-size: 14px; }
.cp-notice-desc { color: #9a3412; font-size: 12px; }

/* 系统消息 */
.cp-system-msg {
  text-align: center; margin: 12px 0;
}
.cp-system-msg span {
  background: rgba(0,0,0,.06); color: #64748b; font-size: 12px;
  padding: 4px 12px; border-radius: 12px;
}

/* 气泡行 */
.cp-bubble-row {
  display: flex; align-items: flex-start; gap: 8px;
  margin-bottom: 12px;
  /* 正常布局消息行，避免跳过布局与 flex 收缩共同改变滚动高度。 */
  content-visibility: visible;
}
.cp-bubble-wrap {
  display: flex; flex-direction: column; gap: 2px; max-width: 72%;
}
.cp-keyword-reply-notice { color: #94a3b8; font-size: 11px; line-height: 1.4; padding: 1px 2px 0; }
.cp-bubble-time { font-size: 11px; color: #94a3b8; line-height: 1; padding: 0 2px; -webkit-user-select: none; user-select: none; }

/* 客户气泡：左 */
.cp-message-highlight { animation: cp-message-highlight 2.2s ease; border-radius: 12px; }
@keyframes cp-message-highlight { 0%, 45% { background: rgba(250,204,21,.3); box-shadow: 0 0 0 6px rgba(250,204,21,.12); } 100% { background: transparent; box-shadow: none; } }
.cp-bubble-row.is-left { flex-direction: row; justify-content: flex-start; }
.cp-bubble-row.is-left .cp-bubble-wrap { align-items: flex-start; }
.cp-bubble-row.is-left .cp-bubble {
  background: #fff; color: #0f172a;
  border-radius: 4px 16px 16px 16px;
  box-shadow: 0 1px 2px rgba(15,23,42,.05);
}
.cp-bubble-row.is-left .cp-bubble::before {
  content: ''; position: absolute; left: -6px; top: 12px;
  width: 0; height: 0; border-top: 6px solid transparent;
  border-bottom: 6px solid transparent; border-right: 6px solid #fff;
}

/* 坐席气泡：右 */
.cp-bubble-row.is-right { flex-direction: row; justify-content: flex-end; }
.cp-bubble-row.is-right .cp-bubble-wrap { align-items: flex-end; }
.cp-bubble-row.is-right .cp-bubble {
  background: #cfe8ff; color: #1a1a1a;
  border-radius: 16px 4px 16px 16px;
  box-shadow: 0 1px 2px rgba(37,99,235,.14);
}
.cp-bubble-row.is-right .cp-bubble::before {
  content: ''; position: absolute; right: -6px; top: 12px;
  width: 0; height: 0; border-top: 6px solid transparent;
  border-bottom: 6px solid transparent; border-left: 6px solid #cfe8ff;
}

.cp-bubble {
  position: relative; max-width: 100%; padding: 11px 15px;
  font-size: 15px; line-height: 1.55; word-break: break-word; white-space: pre-wrap;
  -webkit-touch-callout: none; -webkit-user-select: none; user-select: none;
}
.cp-bubble.cp-menu-active { filter: brightness(.9); outline: 3px solid rgba(15,23,42,.18); box-shadow: inset 0 0 0 999px rgba(15,23,42,.08); }
.cp-bubble.cp-media-message-bubble { -webkit-user-select: none; user-select: none; }
.cp-message-link { color: #2563eb; text-decoration: none; overflow-wrap: anywhere; }
.cp-bubble-row.is-right .cp-message-link { color: #2563eb; }
.cp-message-link:hover { opacity: .82; }
.cp-bubble-avatar {
  width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 13px; object-fit: cover;
}
.cp-bubble.cp-media-message-bubble { padding: 0; background: transparent; border: 0; box-shadow: none; }
.cp-bubble.cp-media-message-bubble::before { display: none; }
.cp-bubble-img { max-width: min(150px, 42vw); max-height: 200px; border-radius: 8px; display: block; object-fit: contain; cursor: pointer; }
.cp-video-wrap { position: relative; display: inline-block; max-width: min(150px, 42vw); }
.cp-video-placeholder { width: min(150px, 42vw); height: 110px; border: 0; background: linear-gradient(135deg, #dbeafe, #bfdbfe); color: #1e40af; font: inherit; }
.cp-video-play-icon {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 44px; height: 44px;
  background: rgba(0,0,0,.55);
  border-radius: 50%;
  color: #fff; font-size: 18px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; pointer-events: auto;
}
.cp-image-caption { margin-top: 6px; padding: 8px 10px; border-radius: 8px; background: #fff; color: #0f172a; white-space: pre-wrap; }
.cp-bubble-row.is-right .cp-image-caption { background: #cfe8ff; color: #1a1a1a; }
.cp-bubble-file {
  display: inline-flex; align-items: center; gap: 6px;
  background: #eff6ff; color: #2563eb; text-decoration: none;
  padding: 6px 12px; border-radius: 6px; font-size: 13px;
}
.cp-bubble-row.is-right .cp-bubble-file { background: rgba(255,255,255,.72); color: #1d4ed8; }
.cp-bubble-file > span:last-child { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; }
.cp-bubble-file small { margin-top: 2px; color: #64748b; font-size: 11px; font-weight: 600; }
.cp-bubble-file:disabled { cursor: default; opacity: .75; }

/* 快捷回复 */
.cp-quick {
  display: flex; gap: 6px; padding: 8px 16px; background: #fff;
  border-top: 1px solid #f1f5f9; overflow-x: auto; flex-shrink: 0;
}
.cp-quick-btn {
  flex-shrink: 0; padding: 5px 12px; border-radius: 14px;
  border: 1px solid #dbeafe; background: #eff6ff; color: #2563eb;
  font-size: 12px; cursor: pointer; white-space: nowrap;
}
.cp-quick-btn:hover { background: #dbeafe; }
.cp-quick-screen { position: absolute; inset: 0; z-index: 80; display: flex; flex-direction: column; background: #f8fafc; }
.cp-quick-screen-header { min-height: 64px; padding: 10px 12px; display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,.95); border-bottom: 1px solid #e2e8f0; }
.cp-quick-screen-header button { width: 40px; height: 40px; flex: 0 0 40px; border: 0; border-radius: 10px; background: transparent; color: #475569; font-size: 20px; }
.cp-quick-screen-header div { display: flex; flex-direction: column; gap: 2px; }
.cp-quick-screen-header strong { color: #0f172a; font-size: 16px; }
.cp-quick-screen-header small { color: #94a3b8; font-size: 12px; }
.cp-quick-screen-list { flex: 1; min-height: 0; overflow-y: auto; padding: 10px; overscroll-behavior: contain; }
.cp-quick-empty { padding: 36px 12px; color: #94a3b8; font-size: 14px; text-align: center; }
.cp-quick-item { width: 100%; min-height: 64px; display: flex; align-items: center; gap: 12px; padding: 11px 12px; border: 0; border-bottom: 1px solid #e2e8f0; background: #fff; text-align: left; }.cp-quick-item:disabled { opacity: .6; }.cp-quick-item img { width: 48px; height: 48px; flex: 0 0 48px; object-fit: cover; border-radius: 9px; }.cp-quick-item span { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }.cp-quick-item strong { color: #0f172a; font-size: 14px; }.cp-quick-item small { color: #64748b; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.45; }

/* 输入区 */
.cp-input-area { position: relative; padding: 10px 10px; background: #fff; border-top: 1px solid #e2e8f0; flex-shrink: 0; }
.cp-input-row { display: flex; gap: 8px; align-items: flex-end; }
.cp-more-btn {
  width: 36px; height: 36px; border: 1px solid #e2e8f0; background: #fff;
  border-radius: 8px; cursor: pointer; font-size: 20px; color: #64748b;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.cp-more-btn:hover { background: #f1f5f9; }
.cp-input {
  flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 9px 12px;
  font-size: 14px; font-family: inherit; resize: none; line-height: 1.5;
  outline: none; transition: border-color .15s; min-height: 36px;
}
.cp-input:focus { border-color: #2563eb; }
.cp-input:disabled { background: #f8fafc; cursor: not-allowed; }
.cp-send-btn {
  padding: 0 18px; height: 36px; background: #2563eb; color: #fff;
  border: none; border-radius: 8px; font-size: 14px; font-weight: 600;
  cursor: pointer; flex-shrink: 0; transition: background .15s;
}
.cp-send-btn:hover:not(:disabled) { background: #1d4ed8; }
.cp-send-btn:disabled { opacity: .5; cursor: not-allowed; }

.cp-more-panel { padding-top: 8px; }
.cp-more-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.cp-more-item {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 6px; border: 1px solid #e2e8f0; border-radius: 10px;
  background: #f8fafc; cursor: pointer; font-size: 11px; color: #475569;
}
.cp-more-item:hover { background: #eff6ff; border-color: #2563eb; color: #2563eb; }
.cp-more-item.disabled { opacity: .4; pointer-events: none; }
.cp-more-icon { font-size: 20px; }

/* 侧栏/弹窗 */
.cp-info-drawer {
  position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 100;
  display: flex; justify-content: flex-end;
}
.cp-info-content {
  width: 360px; max-width: 90vw; background: #fff; height: 100%;
  box-shadow: -4px 0 20px rgba(0,0,0,.1); overflow-y: auto;
}
.cp-info-title {
  padding: 16px; font-size: 16px; font-weight: 600; border-bottom: 1px solid #e2e8f0;
  display: flex; justify-content: space-between; align-items: center;
}
.cp-info-close { border: none; background: transparent; font-size: 22px; cursor: pointer; color: #94a3b8; }
.cp-info-body { padding: 12px 16px; }
.cp-info-row {
  display: flex; justify-content: space-between; padding: 10px 0;
  border-bottom: 1px solid #f1f5f9; font-size: 13px;
}
.cp-info-row span:first-child { color: #64748b; }
.cp-info-row span:last-child { color: #0f172a; max-width: 55%; text-align: right; word-break: break-all; }
.cp-info-ua { font-size: 10px; color: #94a3b8 !important; max-width: 55%; }
.cp-info-id { font-family: monospace; font-size: 11px; }
.cp-info-actions { padding: 12px 16px calc(20px + env(safe-area-inset-bottom)); display: grid; gap: 10px; border-top: 1px solid #e2e8f0; }
.cp-info-actions button { width: 100%; padding: 12px; border: 1px solid #cbd5e1; border-radius: 9px; background: #fff; color: #334155; font-size: 14px; }
.cp-info-actions button.danger { color: #dc2626; border-color: #fecaca; background: #fff7f7; }

/* 移动端 */
@media (max-width: 768px) {
  .cp-header { padding: 10px 12px; }
  .cp-avatar { width: 36px; height: 36px; font-size: 14px; }
  .cp-body { padding: 12px; }
  .cp-bubble-wrap { max-width: 80%; }
  .cp-bubble { padding: 9px 12px; font-size: 14px; }
  .cp-info-content { width: 100%; max-width: 100%; }
}

/* 忆梦云团队开发：仅图片/视频使用裸媒体，文件和文字沿用原气泡。 */
.chat-media {
  --media-width: 220px; --media-mobile-width: 200px; --media-ratio: 4 / 3;
  position: relative; display: block; box-sizing: border-box;
  width: var(--media-width); max-width: 100%; min-width: 0; min-height: 0;
  aspect-ratio: var(--media-ratio); padding: 0; margin: 0; border: 1px solid #cbd5e1; border-radius: 10px;
  overflow: hidden; background: #f1f5f9; color: #475569; box-shadow: 0 4px 14px rgba(15,23,42,.12);
  font: inherit; line-height: 1.4; white-space: normal; cursor: pointer; appearance: none;
}
.chat-media:focus-visible { outline: 3px solid #2563eb; outline-offset: 3px; }
.chat-media:disabled { cursor: default; opacity: 1; }
.chat-media .chat-media-image { display: block; width: 100%; height: 100%; object-fit: contain; border-radius: 9px; }
.chat-media.message-video-wrap { background: #0f172a; color: #fff; }
.chat-media.message-video-wrap .chat-media-image { object-fit: cover; }
.chat-media .chat-media-image[hidden], .chat-media:not(.has-media) .chat-media-image { visibility: hidden; }
.chat-media-placeholder { position: absolute; inset: 0; display: grid; place-items: center; padding: 12px 8px 32px; color: #64748b; font-size: 12px; }
.message-video-wrap .chat-media-placeholder { color: #e2e8f0; }
.chat-media.has-media .chat-media-placeholder { display: none; }
.chat-media-progress { position: absolute; left: 8px; right: 8px; bottom: 7px; height: 3px; overflow: hidden; border-radius: 999px; background: rgba(255,255,255,.5); pointer-events: none; }
.chat-media-progress i { display: block; height: 100%; border-radius: inherit; background: #2563eb; }
.message-video-wrap .chat-media-progress { background: rgba(255,255,255,.28); }
.message-video-wrap .chat-media-progress i { background: #93c5fd; }
.chat-media-play { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: rgba(15,23,42,.55); color: white; pointer-events: none; }
.chat-media-play svg { margin-left: 2px; }
.chat-media:not(.has-media) .chat-media-play { top: 38%; }
.chat-media.message-video-wrap:not(.has-media) .chat-media-placeholder { place-items: end center; padding-bottom: 32px; }
.chat-media-status { position: absolute; inset: auto 0 0; padding: 18px 8px 6px; background: linear-gradient(transparent, rgba(0,0,0,.72)); font-size: 11px; line-height: 16px; text-align: left; color: #fff; pointer-events: none; overflow-wrap: anywhere; }
.bare-media .chat-media-expired { display: block; padding: 8px 0; color: #64748b; font-size: 13px; overflow-wrap: anywhere; }
@media (max-width: 768px) {
  .chat-media { width: var(--media-mobile-width); max-width: 100%; }
}

.cp-bubble-row .cp-bubble.bare-media { padding: 0; background: transparent; border: 0; border-radius: 0; box-shadow: none; white-space: normal; }
.cp-bubble-row .cp-bubble.bare-media::before, .cp-bubble-row .cp-bubble.bare-media::after { display: none; }
.cp-bubble-wrap, .cp-input { min-width: 0; }
.bare-media .cp-image-caption { max-width: 240px; box-sizing: border-box; overflow-wrap: anywhere; }
.cp-bubble-row.is-right .bare-media .chat-media { margin-left: auto; }
.cp-transfer-status { margin-top: 4px; font-size: 11px; color: #64748b; }
.cp-transfer-status.failed { color: #dc2626; }
.cp-transfer-status:focus-visible { outline: 2px solid #dc2626; outline-offset: 2px; border-radius: 3px; }
</style>