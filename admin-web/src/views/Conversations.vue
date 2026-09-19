<!-- 忆梦云团队开发 - 系统会话只读记录 -->
<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import api from '../api'

const list = ref([])
const total = ref(0)
const page = ref(1)
const limit = 20
const keyword = ref('')
const statusFilter = ref('')
const tenantFilter = ref('')
const channelFilter = ref('')
const startDate = ref('')
const endDate = ref('')
const tenants = ref([])
const channels = ref([])
const loading = ref(false)
const errorMessage = ref('')

const selectedConversation = ref(null)
const messages = ref([])
const messageLoading = ref(false)
const historyLoading = ref(false)
const hasMoreHistory = ref(true)
const messageError = ref('')
const messageKeyword = ref('')
const searchResults = ref([])
const searchTotal = ref(0)
const searchLoading = ref(false)
const searchError = ref('')
const locatedMessageId = ref('')
const messageContainer = ref(null)
const mediaPreview = ref(null)
const messageLimit = 50

const totalPages = computed(() => Math.max(Math.ceil(total.value / limit), 1))
const rangeStart = computed(() => total.value ? (page.value - 1) * limit + 1 : 0)
const rangeEnd = computed(() => Math.min(page.value * limit, total.value))
const statusMap = {
  waiting: { text: '待接入', className: 'tag-yellow' },
  active: { text: '处理中', className: 'tag-green' },
  closed: { text: '已结束', className: 'tag-gray' },
}
const senderMap = { customer: '客户', agent: '坐席', bot: '机器人', system: '系统' }

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const params = new URLSearchParams({ page: String(page.value), limit: String(limit) })
    const values = {
      keyword: keyword.value.trim(), status: statusFilter.value, tenantId: tenantFilter.value,
      channelId: channelFilter.value, startDate: startDate.value, endDate: endDate.value,
    }
    Object.entries(values).forEach(([key, value]) => value && params.set(key, value))
    const res = await api.get(`/admin/conversations?${params.toString()}`)
    if (res.code !== 0) throw new Error(res.message || '会话数据加载失败')
    list.value = res.data.items || []
    total.value = res.data.total || 0
    tenants.value = res.data.filters?.tenants || tenants.value
    channels.value = res.data.filters?.channels || channels.value
    if (page.value > totalPages.value) {
      page.value = totalPages.value
      await load()
    }
  } catch (error) {
    list.value = []
    total.value = 0
    errorMessage.value = error?.message || '会话数据加载失败'
  } finally {
    loading.value = false
  }
}

function search() { page.value = 1; load() }
function resetFilters() {
  keyword.value = ''; statusFilter.value = ''; tenantFilter.value = ''; channelFilter.value = ''
  startDate.value = ''; endDate.value = ''; search()
}
function changePage(nextPage) {
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value) return
  page.value = nextPage; load()
}
function formatDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}
function shortId(value) { return value ? String(value).slice(-8) : '-' }
function statusInfo(status) { return statusMap[status] || { text: status || '未知', className: 'tag-gray' } }
function senderName(message) {
  return message.senderId?.displayName || message.senderId?.nickname || message.senderId?.username || senderMap[message.senderType] || '未知'
}
function messageSummary(message) {
  if (!message) return ''
  if (message.recalledAt) return '消息已撤回'
  return message.content || message.attachmentName || ({ image: '[图片]', video: '[视频]', file: '[文件]' }[message.messageType]) || '[空消息]'
}
function mediaUrl(value) {
  if (!value) return ''
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:')) return value
  return value.startsWith('/') ? value : `/${value}`
}
function attachmentUrl(message, thumbnail = false) {
  if (message?.attachmentId) return `/api/files/${message.attachmentId}${thumbnail ? '/thumbnail' : ''}`
  return thumbnail ? (message?.thumbnailUrl || message?.attachmentUrl) : message?.attachmentUrl
}
function attachmentUnavailable(message) {
  return Boolean(message?.recalledAt
    || ['expired', 'recalled', 'deleted'].includes(message?.attachmentStatus)
    || (message?.attachmentExpiredAt && new Date(message.attachmentExpiredAt).getTime() <= Date.now()))
}
const mediaObjectUrls = new Set()
function createMediaObjectUrl(blob) {
  const url = URL.createObjectURL(blob)
  mediaObjectUrls.add(url)
  return url
}
function releaseMediaObjectUrls() {
  mediaObjectUrls.forEach(url => URL.revokeObjectURL(url))
  mediaObjectUrls.clear()
}
async function loadProtectedMedia(message, thumbnail = false) {
  if (!message?.attachmentId) return mediaUrl(attachmentUrl(message, thumbnail))
  if (attachmentUnavailable(message)) return ''
  const blob = await api.get(attachmentUrl(message, thumbnail), { baseURL: '', responseType: 'blob', timeout: 120000 })
  if ((thumbnail || message.messageType === 'image') && !blob.type.startsWith('image/')) throw new Error('媒体格式无效')
  return createMediaObjectUrl(blob)
}
async function bindMediaElement(el, binding) {
  const { message, thumbnail = false } = binding.value
  const signature = [message?._id, message?.attachmentId, message?.attachmentStatus, thumbnail].join(':')
  if (el._mediaSignature === signature) return
  el._mediaSignature = signature
  el.removeAttribute('src')
  try {
    const url = await loadProtectedMedia(message, thumbnail)
    if (el.isConnected && el._mediaSignature === signature && url) el.src = url
  } catch (_) {
    if (el.isConnected && el._mediaSignature === signature) el.classList.add('media-load-error')
  }
}
const vProtectedMedia = {
  mounted: bindMediaElement,
  updated: bindMediaElement,
  unmounted(el) { el._mediaSignature = '' },
}
async function openMedia(message) {
  if (!message || attachmentUnavailable(message) || !['image', 'video'].includes(message.messageType)) return
  closeMedia()
  const preview = {
    type: message.messageType,
    url: '',
    name: message.attachmentName || (message.messageType === 'image' ? '聊天图片' : '聊天视频'),
    loading: true,
    error: '',
  }
  mediaPreview.value = preview
  try {
    if (message.messageType === 'video' && message.attachmentId) {
      const result = await api.post(`/files/${encodeURIComponent(message.attachmentId)}/playback`, {})
      preview.url = result?.data?.url || ''
    } else {
      preview.url = await loadProtectedMedia(message)
    }
    if (!preview.url) throw new Error('媒体加载失败')
  } catch (error) {
    preview.error = error?.message || '媒体加载失败'
  } finally {
    preview.loading = false
  }
}
function closeMedia() { mediaPreview.value = null }
async function downloadFile(message) {
  if (!message || attachmentUnavailable(message)) return
  try {
    const blob = await api.get(attachmentUrl(message), { baseURL: '', responseType: 'blob', timeout: 120000 })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = message.attachmentName || '聊天附件'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  } catch (error) {
    messageError.value = error?.message || '文件下载失败'
  }
}

async function openRecords(conversation) {
  selectedConversation.value = conversation
  messages.value = []
  messageKeyword.value = ''
  searchResults.value = []
  searchTotal.value = 0
  locatedMessageId.value = ''
  messageError.value = ''
  hasMoreHistory.value = true
  document.body.style.overflow = 'hidden'
  await loadMessages()
}
function closeRecords() {
  closeMedia()
  releaseMediaObjectUrls()
  selectedConversation.value = null
  messages.value = []
  searchResults.value = []
  locatedMessageId.value = ''
  document.body.style.overflow = ''
}
async function loadMessages({ before = '', around = '' } = {}) {
  if (!selectedConversation.value || messageLoading.value || historyLoading.value) return
  const isHistory = Boolean(before)
  if (isHistory) historyLoading.value = true
  else messageLoading.value = true
  messageError.value = ''
  try {
    const params = new URLSearchParams({ limit: String(messageLimit) })
    if (before) params.set('before', before)
    if (around) params.set('around', around)
    const res = await api.get(`/admin/conversations/${selectedConversation.value._id}/messages?${params}`)
    if (res.code !== 0) throw new Error(res.message || '聊天记录加载失败')
    const items = Array.isArray(res.data) ? res.data : (res.data?.items || [])
    if (isHistory) {
      const container = messageContainer.value
      const oldHeight = container?.scrollHeight || 0
      messages.value = [...items, ...messages.value.filter(item => !items.some(next => next._id === item._id))]
      hasMoreHistory.value = items.length >= messageLimit
      await nextTick()
      if (container) container.scrollTop += container.scrollHeight - oldHeight
    } else {
      messages.value = items
      hasMoreHistory.value = around ? true : items.length >= messageLimit
      await nextTick()
      if (around) await scrollToMessage(around)
      else if (messageContainer.value) messageContainer.value.scrollTop = messageContainer.value.scrollHeight
    }
  } catch (error) {
    messageError.value = error?.message || '聊天记录加载失败'
  } finally {
    messageLoading.value = false
    historyLoading.value = false
  }
}
function loadHistory() {
  if (!messages.value.length || !hasMoreHistory.value) return
  loadMessages({ before: messages.value[0]._id })
}
async function searchMessages() {
  const value = messageKeyword.value.trim()
  searchResults.value = []
  searchTotal.value = 0
  searchError.value = ''
  if (!value || !selectedConversation.value) return
  searchLoading.value = true
  try {
    const params = new URLSearchParams({ keyword: value })
    const res = await api.get(`/admin/conversations/${selectedConversation.value._id}/messages/search?${params}`)
    if (res.code !== 0) throw new Error(res.message || '消息搜索失败')
    searchResults.value = res.data.items || []
    searchTotal.value = res.data.total || 0
  } catch (error) {
    searchError.value = error?.message || '消息搜索失败'
  } finally {
    searchLoading.value = false
  }
}
async function locateMessage(messageId) {
  locatedMessageId.value = String(messageId)
  await loadMessages({ around: messageId })
}
async function scrollToMessage(messageId) {
  await nextTick()
  const element = messageContainer.value?.querySelector(`[data-message-id="${messageId}"]`)
  element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  window.setTimeout(() => { if (locatedMessageId.value === String(messageId)) locatedMessageId.value = '' }, 2200)
}
function handleKeydown(event) {
  if (event.key !== 'Escape') return
  if (mediaPreview.value) closeMedia()
  else if (selectedConversation.value) closeRecords()
}

watch(tenantFilter, () => { channelFilter.value = ''; page.value = 1; load() })
onMounted(() => { load(); window.addEventListener('keydown', handleKeydown) })
onUnmounted(() => { window.removeEventListener('keydown', handleKeydown); releaseMediaObjectUrls(); document.body.style.overflow = '' })
</script>

<template>
  <div class="page-header">
    <h1>系统会话</h1>
    <p class="desc">跨租户查看系统会话与完整聊天记录，所有记录仅供查询</p>
  </div>

  <div class="conversation-filters" role="search" aria-label="会话筛选">
    <div class="search filter-search">
      <span class="icon" aria-hidden="true">⌕</span>
      <input v-model="keyword" class="input" placeholder="搜索会话 ID / 客户 / 租户 / 渠道 / 聊天内容" aria-label="搜索会话" @keydown.enter="search" />
    </div>
    <select v-model="statusFilter" class="select" aria-label="会话状态" @change="search">
      <option value="">全部状态</option><option value="waiting">待接入</option><option value="active">处理中</option><option value="closed">已结束</option>
    </select>
    <select v-model="tenantFilter" class="select" aria-label="租户">
      <option value="">全部租户</option><option v-for="tenant in tenants" :key="tenant._id" :value="tenant._id">{{ tenant.name || tenant.username }}</option>
    </select>
    <select v-model="channelFilter" class="select" aria-label="渠道" @change="search">
      <option value="">全部渠道</option><option v-for="channel in channels" :key="channel._id" :value="channel._id">{{ channel.name || channel.brandName }}</option>
    </select>
    <label class="date-filter"><span>开始日期</span><input v-model="startDate" class="input" type="date" :max="endDate || undefined" @change="search" /></label>
    <label class="date-filter"><span>结束日期</span><input v-model="endDate" class="input" type="date" :min="startDate || undefined" @change="search" /></label>
    <div class="filter-actions"><button class="btn btn-primary btn-sm" :disabled="loading" @click="search">查询</button><button class="btn btn-ghost btn-sm" :disabled="loading" @click="resetFilters">重置</button></div>
  </div>

  <div class="table-wrap">
    <table class="table conversation-table">
      <thead><tr><th>会话 / 客户</th><th>租户</th><th>渠道</th><th>状态</th><th>接待坐席</th><th>内容匹配</th><th>最近消息</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="conversation in list" :key="conversation._id">
          <td data-label="会话 / 客户"><div class="primary-cell"><strong>{{ conversation.customer?.nickname || '访客' }}</strong><span>{{ conversation.customer?.phone || conversation.customer?.email || '暂无联系方式' }}</span><span class="mono">ID: {{ shortId(conversation._id) }}</span></div></td>
          <td data-label="租户"><div class="primary-cell"><strong>{{ conversation.tenant?.name || '-' }}</strong><span>{{ conversation.tenant?.username || '-' }}</span></div></td>
          <td data-label="渠道">{{ conversation.channel?.name || conversation.channel?.brandName || '-' }}</td>
          <td data-label="状态"><span class="tag" :class="statusInfo(conversation.status).className">{{ statusInfo(conversation.status).text }}</span></td>
          <td data-label="接待坐席">{{ conversation.assignedAgent?.displayName || conversation.assignedAgent?.username || '未分配' }}</td>
          <td data-label="内容匹配"><button v-if="conversation.searchMatch" class="match-preview" type="button" @click="openRecords(conversation).then(() => { messageKeyword = keyword.trim(); searchMessages() })"><strong>{{ conversation.searchMatch.count }} 条</strong><span>{{ messageSummary(conversation.searchMatch.message) }}</span></button><span v-else class="muted">-</span></td>
          <td data-label="最近消息" class="date-cell">{{ formatDate(conversation.lastMessageAt) }}</td>
          <td data-label="操作"><button class="btn btn-ghost btn-sm" type="button" @click="openRecords(conversation)">查看记录</button></td>
        </tr>
        <tr v-if="loading"><td colspan="8" class="empty-cell">正在加载...</td></tr>
        <tr v-else-if="errorMessage"><td colspan="8" class="empty-cell error-text">{{ errorMessage }}</td></tr>
        <tr v-else-if="!list.length"><td colspan="8" class="empty-cell">暂无符合条件的会话</td></tr>
      </tbody>
    </table>
    <div v-if="total > 0" class="pagination"><div class="pagination-info">共 {{ total }} 条，当前显示 {{ rangeStart }}-{{ rangeEnd }} 条</div><div class="pagination-actions"><button class="btn btn-ghost btn-sm" :disabled="page === 1 || loading" @click="changePage(page - 1)">上一页</button><span>第 {{ page }} / {{ totalPages }} 页</span><button class="btn btn-ghost btn-sm" :disabled="page === totalPages || loading" @click="changePage(page + 1)">下一页</button></div></div>
  </div>

  <div v-if="selectedConversation" class="modal-overlay record-overlay" role="presentation" @click.self="closeRecords">
    <section class="record-modal" role="dialog" aria-modal="true" aria-labelledby="record-title">
      <header class="record-header">
        <div><div class="record-title-row"><h3 id="record-title">聊天记录</h3><span class="tag" :class="statusInfo(selectedConversation.status).className">{{ statusInfo(selectedConversation.status).text }}</span><span class="readonly-badge">只读</span></div><p>{{ selectedConversation.customer?.nickname || '访客' }} · {{ selectedConversation.tenant?.name || '-' }} · {{ selectedConversation.channel?.name || selectedConversation.channel?.brandName || '-' }}</p></div>
        <button class="record-close" type="button" aria-label="关闭聊天记录" @click="closeRecords">×</button>
      </header>
      <div class="record-toolbar" role="search">
        <div class="record-search"><input v-model="messageKeyword" class="input" type="search" maxlength="100" placeholder="搜索当前会话内容或附件名" @keydown.enter="searchMessages" /><button class="btn btn-primary btn-sm" :disabled="searchLoading" @click="searchMessages">{{ searchLoading ? '搜索中' : '搜索' }}</button></div>
        <span v-if="searchTotal" class="search-count">找到 {{ searchTotal }} 条{{ searchTotal > searchResults.length ? `，展示前 ${searchResults.length} 条` : '' }}</span>
      </div>
      <div class="record-content" :class="{ 'has-search': searchResults.length || searchLoading || searchError }">
        <aside v-if="searchResults.length || searchLoading || searchError" class="search-results" aria-label="消息搜索结果">
          <div v-if="searchLoading" class="panel-state">正在搜索...</div><div v-else-if="searchError" class="panel-state error-text">{{ searchError }}</div>
          <button v-for="result in searchResults" v-else :key="result._id" class="search-result" type="button" @click="locateMessage(result._id)"><span class="search-result-meta">{{ senderName(result) }} · {{ formatDate(result.createdAt) }}</span><strong>{{ messageSummary(result) }}</strong><span>定位此消息 →</span></button>
        </aside>
        <main ref="messageContainer" class="message-list" aria-live="polite">
          <div class="history-control"><button v-if="hasMoreHistory && messages.length" class="btn btn-ghost btn-sm" :disabled="historyLoading" @click="loadHistory">{{ historyLoading ? '正在加载...' : '加载更早记录' }}</button><span v-else-if="messages.length">已到达会话开始</span></div>
          <div v-if="messageLoading" class="panel-state">正在加载聊天记录...</div><div v-else-if="messageError" class="panel-state error-text">{{ messageError }}</div><div v-else-if="!messages.length" class="panel-state">暂无聊天记录</div>
          <template v-for="message in messages" :key="message._id">
            <div v-if="message.senderType === 'system' || message.recalledAt" class="system-message" :data-message-id="message._id" :class="{ located: locatedMessageId === String(message._id) }"><span>{{ message.recalledAt ? `${senderMap[message.senderType] || '用户'}撤回一条消息` : message.content }}</span><time>{{ formatDate(message.createdAt) }}</time></div>
            <div v-else class="message-row" :data-message-id="message._id" :class="[message.senderType === 'customer' ? 'from-customer' : 'from-service', { located: locatedMessageId === String(message._id) }]">
              <div class="message-avatar">{{ message.senderType === 'bot' ? 'AI' : senderName(message).slice(0, 1) }}</div>
              <div class="message-wrap"><div class="message-meta"><strong>{{ senderName(message) }}</strong><time>{{ formatDate(message.createdAt) }}</time></div><div class="message-bubble">
                <p v-if="attachmentUnavailable(message) && ['image', 'video', 'file'].includes(message.messageType)" class="attachment-unavailable">该文件已过期并自动清理</p>
                <button v-else-if="message.messageType === 'image' && attachmentUrl(message)" type="button" class="media-thumb" @click="openMedia(message)">
                  <img v-protected-media="{ message, thumbnail: true }" :alt="message.attachmentName || '聊天图片'" class="record-image" loading="lazy" />
                  <span class="media-action">查看原图</span>
                </button>
                <button v-else-if="message.messageType === 'video' && attachmentUrl(message)" type="button" class="media-thumb video-thumb" @click="openMedia(message)">
                  <img v-if="message.attachmentId || message.thumbnailUrl" v-protected-media="{ message, thumbnail: true }" :alt="message.attachmentName || '视频缩略图'" class="record-video-poster" loading="lazy" />
                  <span v-else class="video-placeholder">暂无视频封面</span>
                  <span class="video-play">播放</span>
                  <span class="media-action">播放视频</span>
                </button>
                <button v-else-if="message.messageType === 'file' && attachmentUrl(message)" type="button" class="record-file" @click="downloadFile(message)"><span class="file-icon" aria-hidden="true">FILE</span><span>{{ message.attachmentName || '下载附件' }}</span><strong>下载文件</strong></button>
                <p v-else>{{ message.content || '[空消息]' }}</p>
                <button v-if="attachmentUrl(message) && !['image', 'video', 'file'].includes(message.messageType)" type="button" class="attachment-link" @click="downloadFile(message)">下载附件</button>
              </div></div>
            </div>
          </template>
        </main>
      </div>
      <footer class="record-footer"><span>此窗口仅展示历史数据，不会改变会话状态或未读计数</span><button class="btn btn-ghost btn-sm" @click="closeRecords">关闭</button></footer>
    </section>
  </div>

  <div v-if="mediaPreview" class="media-preview-overlay" role="presentation" @click.self="closeMedia">
    <button type="button" class="media-preview-close" aria-label="关闭预览" @click="closeMedia">×</button>
    <div v-if="mediaPreview.loading" class="media-preview-state">正在加载...</div>
    <div v-else-if="mediaPreview.error" class="media-preview-state error-text">{{ mediaPreview.error }}</div>
    <img v-else-if="mediaPreview.type === 'image'" :src="mediaPreview.url" :alt="mediaPreview.name" class="media-preview-image" />
    <video v-else :src="mediaPreview.url" class="media-preview-video" controls autoplay playsinline></video>
  </div>
</template>

<style scoped>
.conversation-filters { display: grid; grid-template-columns: minmax(260px, 1.6fr) repeat(3, minmax(130px, .7fr)); gap: 12px; padding: 16px; margin-bottom: 16px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); }
.filter-search { position: relative; }.filter-search .icon { position: absolute; top: 50%; left: 13px; color: var(--text-muted); transform: translateY(-50%); }.filter-search .input { padding-left: 38px; }
.date-filter { display: flex; align-items: center; gap: 8px; color: var(--text-sec); font-size: 12px; white-space: nowrap; }.date-filter .input { min-width: 145px; }.filter-actions { display: flex; align-items: center; gap: 8px; }
.primary-cell { display: flex; flex-direction: column; min-width: 130px; }.primary-cell strong { font-size: 13px; }.primary-cell span { color: var(--text-sec); font-size: 12px; }.primary-cell .mono { color: var(--text-muted); font-family: 'DM Sans', monospace; font-size: 11px; }
.date-cell { color: var(--text-sec); font-size: 12px; white-space: nowrap; }.muted { color: var(--text-muted); }.empty-cell { padding: 48px !important; text-align: center; color: var(--text-muted) !important; }.error-text { color: var(--danger) !important; }
.match-preview { display: flex; flex-direction: column; max-width: 210px; padding: 5px 8px; border-radius: 8px; text-align: left; color: var(--text-sec); }.match-preview:hover, .match-preview:focus-visible { background: var(--primary-soft); outline: none; }.match-preview strong { color: var(--primary); font-size: 12px; }.match-preview span { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.pagination { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 18px; border-top: 1px solid var(--border); color: var(--text-sec); font-size: 13px; }.pagination-actions { display: flex; align-items: center; gap: 12px; }
.record-overlay { padding: 18px; }.record-modal { display: flex; flex-direction: column; width: min(1120px, 100%); height: min(820px, calc(100dvh - 36px)); overflow: hidden; border: 1px solid rgba(255,255,255,.7); border-radius: var(--radius-xl); background: #fff; box-shadow: var(--shadow-lg); animation: slideUp .22s ease; }
.record-header { display: flex; flex: 0 0 auto; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 18px 22px; border-bottom: 1px solid var(--border); }.record-title-row { display: flex; align-items: center; gap: 9px; }.record-title-row h3 { font-size: 18px; }.record-header p { margin-top: 5px; color: var(--text-sec); font-size: 12px; }.readonly-badge { padding: 2px 8px; border: 1px solid #bfdbfe; border-radius: 999px; background: #eff6ff; color: var(--primary); font-size: 11px; font-weight: 700; }.record-close { display: grid; width: 36px; height: 36px; border-radius: 9px; color: var(--text-sec); font-size: 27px; line-height: 1; place-items: center; }.record-close:hover, .record-close:focus-visible { background: #f1f5f9; color: var(--text-main); outline: none; }
.record-toolbar { display: flex; flex: 0 0 auto; align-items: center; gap: 14px; padding: 12px 22px; border-bottom: 1px solid var(--border); background: var(--bg-soft); }.record-search { display: flex; flex: 1; gap: 8px; max-width: 620px; }.search-count { color: var(--text-sec); font-size: 12px; }
.record-content { display: grid; flex: 1; min-height: 0; grid-template-columns: 1fr; }.record-content.has-search { grid-template-columns: minmax(230px, 300px) minmax(0, 1fr); }.search-results { overflow-y: auto; border-right: 1px solid var(--border); background: #fbfdff; }.search-result { display: flex; width: 100%; flex-direction: column; gap: 4px; padding: 13px 15px; border-bottom: 1px solid var(--border); text-align: left; }.search-result:hover, .search-result:focus-visible { background: var(--primary-soft); outline: none; }.search-result-meta, .search-result > span:last-child { color: var(--text-muted); font-size: 11px; }.search-result strong { overflow: hidden; color: var(--text-main); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }.search-result > span:last-child { color: var(--primary); }
.message-list { min-width: 0; overflow-y: auto; padding: 16px 22px 28px; background: linear-gradient(180deg, #f8fafc, #fff); scroll-behavior: smooth; }.history-control { min-height: 35px; text-align: center; color: var(--text-muted); font-size: 12px; }.panel-state { display: grid; min-height: 160px; color: var(--text-muted); place-items: center; }
.message-row { display: flex; align-items: flex-start; gap: 10px; margin: 13px 0; scroll-margin: 80px; }.message-row.from-service { flex-direction: row-reverse; }.message-avatar { display: grid; width: 34px; height: 34px; flex: 0 0 34px; border-radius: 50%; background: linear-gradient(135deg,#f59e0b,#d97706); color: #fff; font-size: 12px; font-weight: 700; place-items: center; }.from-service .message-avatar { background: linear-gradient(135deg,#3b82f6,#1d4ed8); }.message-wrap { max-width: min(72%, 620px); }.message-meta { display: flex; align-items: center; gap: 8px; margin: 0 4px 4px; color: var(--text-muted); font-size: 11px; }.from-service .message-meta { justify-content: flex-end; }.message-meta strong { color: var(--text-sec); font-size: 12px; }.message-bubble { overflow: hidden; padding: 10px 13px; border: 1px solid var(--border); border-radius: 4px 14px 14px; background: #fff; box-shadow: var(--shadow-sm); overflow-wrap: anywhere; }.from-service .message-bubble { border-color: #bfdbfe; border-radius: 14px 4px 14px 14px; background: #eff6ff; }.message-bubble p { margin: 0; white-space: pre-wrap; }.record-image, .record-video { width: auto; min-width: 120px; min-height: 90px; max-width: min(360px, 100%); max-height: 340px; border-radius: 8px; object-fit: contain; }.record-file { display: inline-flex; align-items: center; min-height: 38px; font-weight: 600; }.media-load-error { visibility: hidden; }.attachment-unavailable { color: var(--text-muted); font-size: 12px; }.attachment-link { color: var(--primary); font-weight: 600; }.file-icon { display: grid; width: 36px; height: 36px; border-radius: 7px; background: #dbeafe; color: var(--primary); font-size: 9px; font-weight: 800; place-items: center; }.system-message { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 14px auto; color: var(--text-muted); font-size: 11px; scroll-margin: 80px; }.system-message span { max-width: 70%; padding: 4px 10px; border-radius: 999px; background: #e2e8f0; text-align: center; }.located .message-bubble, .system-message.located span { animation: locatePulse 1.1s ease 2; box-shadow: 0 0 0 4px var(--primary-ring); }
.record-footer { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 22px; border-top: 1px solid var(--border); background: #fff; color: var(--text-muted); font-size: 12px; }
.media-thumb { position: relative; display: block; overflow: hidden; min-width: 160px; min-height: 110px; max-width: 100%; border-radius: 9px; background: #0f172a; color: #fff; text-align: left; }.media-thumb img, .media-thumb video { display: block; }.media-action { position: absolute; right: 7px; bottom: 7px; padding: 3px 7px; border-radius: 5px; background: rgba(15,23,42,.72); font-size: 11px; }.record-video-poster { width: auto; min-width: 160px; min-height: 110px; max-width: min(360px, 100%); max-height: 340px; object-fit: contain; }.video-placeholder { display: grid; width: 220px; height: 130px; color: #cbd5e1; font-size: 12px; place-items: center; }.video-play { position: absolute; top: 50%; left: 50%; display: grid; min-width: 48px; height: 48px; padding: 0 10px; border: 2px solid rgba(255,255,255,.9); border-radius: 999px; background: rgba(15,23,42,.65); font-size: 12px; transform: translate(-50%,-50%); place-items: center; }.record-file { gap: 8px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: rgba(255,255,255,.8); text-align: left; }.record-file span { overflow: hidden; max-width: 240px; text-overflow: ellipsis; white-space: nowrap; }.record-file strong { color: var(--primary); font-size: 12px; white-space: nowrap; }
.media-preview-overlay { position: fixed; z-index: 1000; inset: 0; display: grid; padding: 30px; background: rgba(2,6,23,.92); place-items: center; }.media-preview-close { position: fixed; z-index: 2; top: 18px; right: 22px; width: 42px; height: 42px; border-radius: 50%; background: rgba(255,255,255,.14); color: #fff; font-size: 30px; }.media-preview-state { padding: 16px 20px; border-radius: 10px; background: rgba(255,255,255,.1); color: #fff; }.media-preview-image, .media-preview-video { max-width: 94vw; max-height: 90vh; object-fit: contain; }.media-preview-video { width: min(1100px,94vw); }
@keyframes locatePulse { 50% { box-shadow: 0 0 0 6px rgba(37,99,235,.32); } }
@media (max-width: 1100px) { .conversation-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }.filter-search { grid-column: 1 / -1; } }
@media (max-width: 768px) {
  .conversation-filters { grid-template-columns: 1fr; padding: 14px; }.filter-search { grid-column: auto; }.date-filter { align-items: stretch; flex-direction: column; gap: 4px; }.date-filter .input { min-width: 0; }.filter-actions .btn { flex: 1; min-height: 40px; }.conversation-table td { align-items: flex-start; gap: 16px; text-align: right; }.primary-cell { align-items: flex-end; }.match-preview { align-items: flex-end; text-align: right; }.pagination { align-items: stretch; flex-direction: column; }.pagination-actions { justify-content: space-between; }.empty-cell { display: block !important; text-align: center !important; }.empty-cell::before { display: none; }
  .record-overlay { align-items: stretch; padding: 0; }.record-modal { width: 100%; height: 100dvh; max-height: none; border: 0; border-radius: 0; }.record-header { padding: 14px 16px; }.record-header p { max-width: calc(100vw - 80px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.record-toolbar { align-items: stretch; flex-direction: column; gap: 6px; padding: 10px 14px; }.record-search { max-width: none; }.record-content.has-search { grid-template-columns: 1fr; grid-template-rows: minmax(110px, 28vh) minmax(0, 1fr); }.search-results { border-right: 0; border-bottom: 1px solid var(--border); }.message-list { padding: 12px 12px 22px; }.message-wrap { max-width: calc(100% - 46px); }.message-avatar { width: 32px; height: 32px; flex-basis: 32px; }.record-footer { padding: 10px 14px; }.record-footer span { display: none; }.record-footer .btn { width: 100%; min-height: 38px; }
}
@media (prefers-reduced-motion: reduce) { .message-list { scroll-behavior: auto; } }
</style>
