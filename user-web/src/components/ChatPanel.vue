<!-- 忆梦云团队开发 - 聊天面板（独立组件，可嵌入 Messages 三栏布局或 ChatRoom 独立页） -->
<script setup>
import { ref, watch, onUnmounted, nextTick, computed } from 'vue'
import { io } from 'socket.io-client'
import api from '../api'
import ConfirmDialog from './ConfirmDialog.vue'

const props = defineProps({ conversationId: { type: String, default: null } })
const emit = defineEmits(['back'])

const conversation = ref(null)
const messages = ref([])
const quickReplies = ref([])
const input = ref('')
const sending = ref(false)
const accepted = ref(false)
const loading = ref(false)
const msgContainer = ref(null)
let socket = null

const showTransfer = ref(false)
const transferTargetId = ref('')
const transferReason = ref('')
const agents = ref([])
const uploading = ref(false)
const preview = ref(null)
const mediaUrls = ref({})
const mediaRequests = new Map()
const showInfo = ref(false)
const showMore = ref(false)
const showCloseConfirm = ref(false)
const closing = ref(false)

const currentAgentId = computed(() => conversation.value?.assignedAgentId?._id || conversation.value?.assignedAgentId)

async function loadConversation() {
  if (!props.conversationId) { conversation.value = null; return }
  try {
    const res = await api.get(`/tenant/conversations/${props.conversationId}`)
    if (res.code === 0) {
      conversation.value = res.data
      accepted.value = res.data.status !== 'waiting'
    } else { conversation.value = null }
  } catch { conversation.value = null }
}

async function loadMessages() {
  if (!props.conversationId) return
  try {
    const res = await api.get(`/tenant/conversations/${props.conversationId}/messages`)
    if (res.code === 0) {
      messages.value = res.data
      await nextTick(); scrollToBottom()
    }
  } catch {}
}

async function loadQuickReplies() {
  if (!conversation.value) return
  try {
    const res = await api.get(`/tenant/channels/${conversation.value.channelId}/quick-replies`)
    if (res.code === 0) quickReplies.value = res.data.filter(q => q.status === 'active')
  } catch {}
}

async function loadAgents() {
  try {
    const res = await api.get('/tenant/employees')
    if (res.code === 0) {
      const data = Array.isArray(res.data) ? res.data : (res.data.items || res.data.list || [])
      agents.value = data.filter(a => a.status === 'active')
    }
  } catch {}
}

async function accept() {
  try {
    const res = await api.post(`/tenant/conversations/${props.conversationId}/accept`)
    if (res.code === 0) {
      accepted.value = true
      conversation.value.status = 'active'
    } else alert(res.message)
  } catch (e) { alert(e?.message || '接入失败') }
}

async function sendMsg() {
  if (!input.value.trim() || sending.value) return
  if (!accepted.value) { alert('请先接入会话'); return }
  sending.value = true
  const text = input.value.trim(); input.value = ''
  try {
    const res = await api.post(`/tenant/conversations/${props.conversationId}/messages`, {
      content: text, clientMessageId: 'a_' + Date.now(),
    })
    if (res.code === 0) { messages.value.push(res.data); await nextTick(); scrollToBottom() }
  } catch (e) { input.value = text; alert(e?.message || '发送失败') }
  finally { sending.value = false }
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
  if (!file) return
  if (!accepted.value) { alert('请先接入会话'); return }
  uploading.value = true
  const fd = new FormData(); fd.append('file', file)
  try {
    const res = await api.upload(`/upload/tenant/conversation/${props.conversationId}`, fd)
    if (res.code === 0) {
      const fi = res.data
      const body = {
        attachmentId: fi.attachmentId,
        messageType: ['image', 'video'].includes(fi.category) ? fi.category : 'file',
        clientMessageId: 'up_' + Date.now(),
      }
      const sr = await api.post(`/tenant/conversations/${props.conversationId}/messages`, body)
      if (sr.code === 0) { messages.value.push(sr.data); await nextTick(); scrollToBottom() }
    } else alert(res.message || '上传失败')
  } catch (e) { alert(e?.message || '上传失败') }
  finally { uploading.value = false; ev.target.value = '' }
}

function openTransfer() {
  transferTargetId.value = ''; transferReason.value = ''
  loadAgents(); showTransfer.value = true
}

async function submitTransfer() {
  if (!transferTargetId.value) { alert('请选择目标员工'); return }
  try {
    const res = await api.post(`/tenant/conversations/${props.conversationId}/transfer`, {
      targetAgentId: transferTargetId.value, reason: transferReason.value,
    })
    if (res.code === 0) { conversation.value = res.data; await loadMessages(); showTransfer.value = false }
    else alert(res.message || '转接失败')
  } catch (e) { alert(e?.message || '转接失败') }
}

function applyRecall(data) {
  const messageId = data.messageId || data._id
  const msg = messages.value.find(item => String(item._id) === String(messageId))
  if (msg) Object.assign(msg, data, { recalledAt: data.recalledAt || new Date().toISOString() })
}

function setupSocket() {
  socket?.disconnect()
  const token = localStorage.getItem('tenant_token')
  if (!token) return
  socket = io({ auth: { token, type: 'tenant_user' }, transports: ['polling', 'websocket'] })
  socket.on('message.new', (msg) => {
    if (msg.conversationId === props.conversationId) { messages.value.push(msg); nextTick(scrollToBottom) }
  })
  socket.on('message.recalled', applyRecall)
  socket.on('conversation.updated', (data) => {
    if (data.conversationId === props.conversationId) {
      if (data.assignedAgentId) conversation.value.assignedAgentId = data.assignedAgentId
      if (data.status) conversation.value.status = data.status
      accepted.value = data.status !== 'waiting'
    }
  })
  socket.on('conversation.transferred', () => { loadConversation(); loadMessages() })
  socket.on('conversation.accepted', () => { loadConversation(); loadMessages() })
}

async function init() {
  if (!props.conversationId) { conversation.value = null; messages.value = []; return }
  loading.value = true
  try {
    await Promise.all([loadConversation(), loadMessages()])
    if (conversation.value) { await loadQuickReplies(); setupSocket() }
  } catch {} finally { loading.value = false }
}

watch(() => props.conversationId, (id) => {
  socket?.disconnect(); socket = null
  if (id) init()
  else { conversation.value = null; messages.value = [] }
}, { immediate: true })

onUnmounted(() => {
  socket?.disconnect()
  Object.values(mediaUrls.value).forEach(url => URL.revokeObjectURL(url))
})

function scrollToBottom() {
  if (msgContainer.value) msgContainer.value.scrollTop = msgContainer.value.scrollHeight
}
function attachmentUrl(msg) { return msg.attachmentId ? `/api/files/${msg.attachmentId}` : msg.attachmentUrl }
function thumbnailUrl(msg) { return msg.attachmentId ? `/api/files/${msg.attachmentId}/thumbnail` : msg.thumbnailUrl }
function attachmentExpired(msg) { return ['expired', 'deleted'].includes(msg.attachmentStatus) }
function mediaKey(msg, thumbnail = false) { return `${msg._id || msg.clientMessageId}:${thumbnail ? 'thumbnail' : 'original'}` }
function loadMedia(msg, thumbnail = false) {
  if (!msg.attachmentId) return Promise.resolve(thumbnail ? thumbnailUrl(msg) : attachmentUrl(msg))
  if (attachmentExpired(msg)) return Promise.resolve('')
  const key = mediaKey(msg, thumbnail)
  if (mediaUrls.value[key]) return Promise.resolve(mediaUrls.value[key])
  if (!mediaRequests.has(key)) {
    const request = api.get(thumbnail ? thumbnailUrl(msg) : attachmentUrl(msg), { baseURL: '', responseType: 'blob' })
      .then(blob => {
        const url = URL.createObjectURL(blob)
        mediaUrls.value[key] = url
        return url
      })
      .catch(error => {
        if (error?.httpStatus === 410) msg.attachmentStatus = 'expired'
        return ''
      })
      .finally(() => mediaRequests.delete(key))
    mediaRequests.set(key, request)
  }
  return mediaRequests.get(key)
}
function mediaSrc(msg, thumbnail = false) {
  if (!msg.attachmentId) return thumbnail ? thumbnailUrl(msg) : attachmentUrl(msg)
  return mediaUrls.value[mediaKey(msg, thumbnail)] || ''
}
const vLazyMedia = {
  mounted(el, binding) {
    const { msg, thumbnail = false } = binding.value
    if (!msg.attachmentId) return
    const load = () => loadMedia(msg, thumbnail).then(url => { if (url) el.src = url })
    if (!('IntersectionObserver' in window)) { load(); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect()
        load()
      }
    }, { rootMargin: '160px' })
    el._attachmentObserver = observer
    observer.observe(el)
  },
  unmounted(el) { el._attachmentObserver?.disconnect() },
}
async function openPreview(msg) {
  if (attachmentExpired(msg)) return
  const url = await loadMedia(msg)
  if (url && !attachmentExpired(msg)) preview.value = { url, type: msg.messageType, name: msg.attachmentName, msg }
}
function closePreview() { preview.value = null }
async function downloadFile(msg) {
  if (attachmentExpired(msg)) return
  try {
    const blob = await api.get(attachmentUrl(msg), { baseURL: '', responseType: 'blob' })
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = msg.attachmentName || '下载文件'
    link.click()
    URL.revokeObjectURL(objectUrl)
  } catch (error) {
    if (error?.httpStatus === 410) msg.attachmentStatus = 'expired'
    else alert('下载失败')
  }
}
function useQuickReply(text) { input.value = text; showMore.value = false }
function formatTime(iso) { return iso ? new Date(iso).toTimeString().slice(0, 5) : '' }
function formatDateTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso); return d.toLocaleString('zh-CN', { hour12: false })
}
function avatarChar() {
  return conversation.value?.customer?.phone?.slice(-1) || '客'
}

defineExpose({ reload: init })
</script>

<template>
  <div class="cp-panel" :class="{ loading }">
    <div v-if="loading" class="cp-loading">加载中...</div>
    <div v-else-if="!conversation" class="cp-empty">
      <div class="cp-empty-emoji">💬</div>
      <div class="cp-empty-title">选择一个会话开始接待</div>
    </div>

    <template v-else>
      <!-- 顶部栏 -->
      <header class="cp-header">
        <button v-if="$slots.back" class="cp-back" @click="emit('back')">←</button>
        <div class="cp-title-wrap" @click="showInfo = !showInfo">
          <div class="cp-avatar">{{ avatarChar() }}</div>
          <div>
            <div class="cp-title">
              {{ conversation.customer?.phone ? '*' + conversation.customer.phone.slice(-4) : '访客' }}
              <span class="cp-status-tag" :class="conversation.status">
                {{ conversation.status === 'active' ? '处理中' : conversation.status === 'waiting' ? '待接入' : '已结束' }}
              </span>
            </div>
            <div class="cp-sub">
              {{ conversation.channel?.name || '—' }} · {{ conversation.customer?.email || '无邮箱' }}
            </div>
          </div>
        </div>
        <div class="cp-header-actions">
          <button v-if="!accepted && conversation.status !== 'closed'" class="cp-btn cp-btn-primary" @click="accept">接入</button>
          <button v-if="conversation.status === 'active'" class="cp-btn cp-btn-danger" @click="showCloseConfirm = true">结束</button>
        </div>
      </header>

      <!-- 消息区 -->
      <div class="cp-body" ref="msgContainer">
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
          <div v-else-if="msg.senderType === 'system'" class="cp-system-msg">
            <span>{{ msg.content }}</span>
          </div>

          <div v-else class="cp-bubble-row" :class="msg.senderType === 'customer' ? 'is-left' : 'is-right'">
            <template v-if="msg.senderType === 'customer'">
              <div class="cp-bubble-avatar" :style="{ background: `linear-gradient(135deg,#f59e0b,#d97706)` }">{{ avatarChar() }}</div>
              <div class="cp-bubble-wrap">
                <div class="cp-bubble cp-bubble-customer">
                  <span v-if="attachmentExpired(msg)">该文件已过期并自动清理</span>
                  <template v-else-if="msg.messageType === 'image' && (msg.attachmentId || msg.attachmentUrl)">
                    <img :src="mediaSrc(msg)" v-lazy-media="{ msg }" class="cp-bubble-img" loading="lazy" decoding="async" @click="openPreview(msg)" />
                  </template>
                  <template v-else-if="msg.messageType === 'video' && (msg.attachmentId || msg.attachmentUrl)">
                    <img v-if="msg.attachmentId || msg.thumbnailUrl" :src="mediaSrc(msg, true)" v-lazy-media="{ msg, thumbnail: true }" class="cp-bubble-img" loading="lazy" decoding="async" @click="openPreview(msg)" />
                    <button v-else type="button" class="cp-bubble-img" @click="openPreview(msg)">视频</button>
                  </template>
                  <button v-else-if="msg.messageType === 'file' && (msg.attachmentId || msg.attachmentUrl)" class="cp-bubble-file" @click="downloadFile(msg)">
                    📎 {{ msg.attachmentName || '文件' }}
                  </button>
                  <template v-else>{{ msg.content }}</template>
                </div>
                <div class="cp-bubble-time">{{ formatTime(msg.createdAt) }}</div>
              </div>
            </template>

            <template v-else>
              <div class="cp-bubble-wrap">
                <div class="cp-bubble">
                  <span v-if="attachmentExpired(msg)">该文件已过期并自动清理</span>
                  <template v-else-if="msg.messageType === 'image' && (msg.attachmentId || msg.attachmentUrl)">
                    <img :src="mediaSrc(msg)" v-lazy-media="{ msg }" class="cp-bubble-img" loading="lazy" decoding="async" @click="openPreview(msg)" />
                  </template>
                  <template v-else-if="msg.messageType === 'video' && (msg.attachmentId || msg.attachmentUrl)">
                    <img v-if="msg.attachmentId || msg.thumbnailUrl" :src="mediaSrc(msg, true)" v-lazy-media="{ msg, thumbnail: true }" class="cp-bubble-img" loading="lazy" decoding="async" @click="openPreview(msg)" />
                    <button v-else type="button" class="cp-bubble-img" @click="openPreview(msg)">视频</button>
                  </template>
                  <button v-else-if="msg.messageType === 'file' && (msg.attachmentId || msg.attachmentUrl)" class="cp-bubble-file" @click="downloadFile(msg)">
                    📎 {{ msg.attachmentName || '文件' }}
                  </button>
                  <template v-else>{{ msg.content }}</template>
                </div>
                <div class="cp-bubble-time">{{ formatTime(msg.createdAt) }}</div>
              </div>
              <div class="cp-bubble-avatar" :style="{ background: `linear-gradient(135deg,#2563eb,#1d4ed8)` }">{{ msg.senderType === 'bot' ? 'AI' : '我' }}</div>
            </template>
          </div>
        </template>
      </div>

      <!-- 快捷回复 -->
      <div v-if="quickReplies.length > 0 && accepted && conversation.status === 'active'" class="cp-quick">
        <button v-for="qr in quickReplies" :key="qr._id" class="cp-quick-btn" @click="useQuickReply(qr.content)">{{ qr.title }}</button>
      </div>

      <!-- 输入区 -->
      <div class="cp-input-area">
        <div class="cp-input-row">
          <button class="cp-more-btn" @click="showMore = !showMore">+</button>
          <textarea
            v-model="input"
            class="cp-input"
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            rows="2"
            @keydown.enter.exact.prevent="sendMsg"
            :disabled="!accepted || conversation.status === 'closed'"
          ></textarea>
          <button class="cp-send-btn" @click="sendMsg" :disabled="sending || !input.trim() || !accepted">发送</button>
        </div>

        <div v-if="showMore" class="cp-more-panel">
          <div class="cp-more-grid">
            <label class="cp-more-item" :class="{ disabled: !accepted || uploading }">
              <input type="file" accept="image/*,.pdf,.zip,.doc,.docx" @change="handleUpload" style="display:none" />
              <span class="cp-more-icon">📎</span><span>发送文件</span>
            </label>
            <button v-if="accepted && conversation.status === 'active'" class="cp-more-item" @click="openTransfer">
              <span class="cp-more-icon">🔀</span><span>转接会话</span>
            </button>
            <button class="cp-more-item" @click="showInfo = true">
              <span class="cp-more-icon">👤</span><span>客户资料</span>
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- 客户资料侧栏 -->
    <div v-if="showInfo && conversation" class="cp-info-drawer" @click.self="showInfo = false">
      <div class="cp-info-content">
        <div class="cp-info-title">客户资料<button class="cp-info-close" @click="showInfo = false">×</button></div>
        <div class="cp-info-body">
          <div class="cp-info-row"><span>手机号</span><span>{{ conversation.customer?.phone || '-' }}</span></div>
          <div class="cp-info-row"><span>邮箱</span><span>{{ conversation.customer?.email || '未填写' }}</span></div>
          <div class="cp-info-row"><span>昵称</span><span>{{ conversation.customer?.nickname || '访客' }}</span></div>
          <div class="cp-info-row"><span>所属渠道</span><span>{{ conversation.channel?.name || '-' }}</span></div>
          <div class="cp-info-row"><span>注册 IP</span><span>{{ conversation.customer?.registerIp || '-' }}</span></div>
          <div class="cp-info-row"><span>浏览器</span><span class="cp-info-ua">{{ conversation.customer?.registerUserAgent || '-' }}</span></div>
          <div class="cp-info-row"><span>注册时间</span><span>{{ formatDateTime(conversation.customer?.createdAt) }}</span></div>
          <div class="cp-info-row"><span>会话 ID</span><span class="cp-info-id">{{ conversation._id }}</span></div>
          <div class="cp-info-row"><span>接入时间</span><span>{{ formatDateTime(conversation.acceptedAt) }}</span></div>
          <div class="cp-info-row"><span>结束时间</span><span>{{ formatDateTime(conversation.closedAt) }}</span></div>
        </div>
      </div>
    </div>

    <div v-if="preview" class="cp-preview" @click.self="closePreview">
      <button type="button" class="cp-preview-close" @click="closePreview">×</button>
      <img v-if="preview.type === 'image'" :src="preview.url" :alt="preview.name || '图片预览'" />
      <video v-else :src="preview.url" controls autoplay preload="metadata" playsinline></video>
    </div>

    <!-- 转接弹窗 -->
    <div v-if="showTransfer" class="cp-modal-mask" @click.self="showTransfer = false">
      <div class="cp-modal">
        <div class="cp-modal-title">转接会话 <button class="cp-info-close" @click="showTransfer = false">×</button></div>
        <div class="cp-modal-body">
          <div class="cp-form-item">
            <label>目标员工</label>
            <select v-model="transferTargetId" class="cp-form-select">
              <option value="">请选择</option>
              <option v-for="a in agents" :key="a._id" :value="a._id">
                {{ a.username || a.name || a._id?.slice(0, 8) }}
                <span v-if="a._id === currentAgentId"> (当前)</span>
              </option>
            </select>
          </div>
          <div class="cp-form-item">
            <label>转接原因（可选）</label>
            <textarea v-model="transferReason" class="cp-form-textarea" rows="3" placeholder="填写转接原因..."></textarea>
          </div>
        </div>
        <div class="cp-modal-footer">
          <button class="cp-btn cp-btn-secondary" @click="showTransfer = false">取消</button>
          <button class="cp-btn cp-btn-primary" @click="submitTransfer">确认转接</button>
        </div>
      </div>
    </div>

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
.cp-preview {
  position: fixed; inset: 0; z-index: 1200; display: flex; align-items: center; justify-content: center;
  padding: 48px 20px 20px; background: rgba(15, 23, 42, .88);
}
.cp-preview img, .cp-preview video { max-width: 92vw; max-height: 86vh; object-fit: contain; }
.cp-preview-close {
  position: absolute; top: 16px; right: 20px; border: 0; background: transparent;
  color: #fff; font-size: 32px; cursor: pointer;
}
.cp-panel {
  display: flex; flex: 1 1 auto; flex-direction: column;
  width: 100%; height: 100%; min-width: 0; min-height: 0;
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
.cp-sub { font-size: 12px; color: #94a3b8; margin-top: 2px; }
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
}
.cp-bubble-wrap {
  display: flex; flex-direction: column; gap: 2px; max-width: 72%;
}
.cp-bubble-time { font-size: 11px; color: #94a3b8; line-height: 1; padding: 0 2px; }

/* 客户气泡：左 */
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
  background: #2563eb; color: #fff;
  border-radius: 16px 4px 16px 16px;
  box-shadow: 0 1px 2px rgba(37,99,235,.25);
}
.cp-bubble-row.is-right .cp-bubble::before {
  content: ''; position: absolute; right: -6px; top: 12px;
  width: 0; height: 0; border-top: 6px solid transparent;
  border-bottom: 6px solid transparent; border-left: 6px solid #2563eb;
}

.cp-bubble {
  position: relative; max-width: 100%; padding: 11px 15px;
  font-size: 15px; line-height: 1.55; word-break: break-word;
}
.cp-bubble-avatar {
  width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 13px;
}
.cp-bubble-img { max-width: 200px; border-radius: 8px; display: block; cursor: pointer; }
.cp-bubble-file {
  display: inline-flex; align-items: center; gap: 6px;
  background: #eff6ff; color: #2563eb; text-decoration: none;
  padding: 6px 12px; border-radius: 6px; font-size: 13px;
}
.cp-bubble-row.is-right .cp-bubble-file { background: rgba(255,255,255,.2); color: #fff; }

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

/* 输入区 */
.cp-input-area { padding: 10px 16px; background: #fff; border-top: 1px solid #e2e8f0; flex-shrink: 0; }
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

.cp-modal-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 100;
  display: flex; align-items: center; justify-content: center;
}
.cp-modal { background: #fff; border-radius: 12px; width: 420px; max-width: 92vw; overflow: hidden; }
.cp-modal-title {
  padding: 14px 16px; font-size: 15px; font-weight: 600;
  border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;
}
.cp-modal-body { padding: 16px; }
.cp-form-item { margin-bottom: 14px; }
.cp-form-item label { display: block; font-size: 12px; color: #64748b; margin-bottom: 5px; }
.cp-form-select, .cp-form-textarea {
  width: 100%; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 8px;
  font-size: 13px; font-family: inherit; outline: none; box-sizing: border-box;
}
.cp-form-select:focus, .cp-form-textarea:focus { border-color: #2563eb; }
.cp-modal-footer { padding: 12px 16px; display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid #e2e8f0; }

/* 移动端 */
@media (max-width: 768px) {
  .cp-header { padding: 10px 12px; }
  .cp-avatar { width: 36px; height: 36px; font-size: 14px; }
  .cp-body { padding: 12px; }
  .cp-bubble-wrap { max-width: 80%; }
  .cp-bubble { padding: 9px 12px; font-size: 14px; }
  .cp-info-content { width: 100%; max-width: 100%; }
}
</style>
