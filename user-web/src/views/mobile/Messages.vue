<!-- 忆梦云团队开发 - 手机端消息列表 -->
<script setup>
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../../api'
import { getTenantSocket } from '../../socket'
import { acquireObjectUrl, avatarCacheKey, cacheChannels, cacheConversations, getCachedChannels, getCachedConversations, initializeChatCache, isPrivateAvatarUrl, loadCachedAvatar, releaseObjectUrl, tenantCacheScope, tenantIdentityScope } from '../../chatCache'
import { reportDebugEvent } from '../../attachmentActions'

const route = useRoute()
const router = useRouter()
const conversations = ref([])
const channels = ref([])
const loading = ref(true)
const identityScope = tenantIdentityScope()
const listStateKey = `yimeng_message_list:${identityScope}:mobile`
let savedListState = {}
try { savedListState = JSON.parse(localStorage.getItem(listStateKey) || '{}') || {} } catch {}
const validFilters = new Set(['all', 'waiting', 'active', 'closed'])
const routeFilter = typeof route.query.status === 'string' ? route.query.status : savedListState.filter
const filter = ref(validFilters.has(String(routeFilter)) ? String(routeFilter) : 'all')
const selectedChannelId = ref(typeof route.query.channelId === 'string' ? route.query.channelId : String(savedListState.channelId || ''))
const search = ref(typeof route.query.keyword === 'string' ? route.query.keyword : String(savedListState.search || ''))
const pageElement = ref(null)
const scrollElement = () => pageElement.value?.closest('.message-list-page') || pageElement.value
const searching = ref(false)
const searchDialog = ref(null)
const searchResults = ref([])
const searchResultsLoading = ref(false)
let searchTimer = null
let socketRefreshTimer = null
let requestSequence = 0
let activeRequestKey = ''
let activeRequest = null
let socket = null
const avatarUrls = ref({})
const failedAvatarUrls = ref({})
const avatarRequests = new Map()
const avatarScopes = new Map()

function avatarSrc(url) {
  return avatarUrls.value[url] || url
}

function avatarVisible(url) { return Boolean(url && !failedAvatarUrls.value[url]) }
function handleAvatarError(url) {
  if (!url) return
  failedAvatarUrls.value = { ...failedAvatarUrls.value, [url]: true }
}

function loadAvatar(el, url) {
  if (!url || avatarUrls.value[url] || !isPrivateAvatarUrl(url)) return
  if (!avatarRequests.has(url)) {
    const scope = tenantCacheScope(selectedChannelId.value)
    const request = loadCachedAvatar(
      scope,
      url,
      () => api.get(url, { baseURL: '', responseType: 'blob' }),
    ).then(blob => {
      if (!blob || scope !== tenantCacheScope(selectedChannelId.value) || !el.isConnected) return
      avatarUrls.value[url] = acquireObjectUrl(avatarCacheKey(scope, url), blob)
      avatarScopes.set(url, scope)
      el.src = avatarUrls.value[url]
    }).catch(() => {}).finally(() => {
      if (avatarRequests.get(url) === request) avatarRequests.delete(url)
    })
    avatarRequests.set(url, request)
  }
}

const vCachedAvatar = {
  mounted(el, binding) { loadAvatar(el, binding.value) },
  updated(el, binding) {
    if (binding.value !== binding.oldValue) loadAvatar(el, binding.value)
  },
}

const filteredConversations = computed(() => {
  let list = conversations.value
  if (filter.value !== 'all') list = list.filter((conversation) => conversation.status === filter.value)
  return list
})
const selectedChannel = computed(() => channels.value.find(channel => String(channel._id) === selectedChannelId.value) || null)
const channelSearch = ref('')
const filteredChannels = computed(() => {
  const keyword = channelSearch.value.trim().toLowerCase()
  if (!keyword) return channels.value
  return channels.value.filter(channel => [channel.name, channel.brandName]
    .some(value => String(value || '').toLowerCase().includes(keyword)))
})
const groupedConversations = computed(() => {
  const groups = new Map()
  const channelNames = new Map(channels.value.map(channel => [String(channel._id), channel.name]))
  filteredConversations.value.forEach((conversation) => {
    const key = String(conversation.channelId || conversation.channel?._id || conversation.channel?.id || 'unknown')
    if (!groups.has(key)) groups.set(key, { key, name: conversation.channel?.name || channelNames.get(key) || '未知渠道', items: [], unread: 0 })
    const group = groups.get(key)
    group.items.push(conversation)
    group.unread += conversation.agentUnreadCount || 0
  })
  return [...groups.values()]
})

async function loadConversations() {
  const scope = tenantCacheScope(selectedChannelId.value)
  if (!selectedChannelId.value) {
    conversations.value = []
    loading.value = false
    return
  }
  const keyword = search.value.trim()
  if (!keyword) {
    const cached = await getCachedConversations(scope)
    if (cached.length) {
      conversations.value = cached
      loading.value = false
      restoreScroll()
    }
  }
  const params = {
    limit: 100,
    status: filter.value === 'all' ? undefined : filter.value,
    channelId: selectedChannelId.value || undefined,
    keyword: keyword || undefined,
  }
  const requestKey = JSON.stringify(params)
  if (activeRequest && activeRequestKey === requestKey) return activeRequest
  const sequence = ++requestSequence
  if (keyword) searching.value = true
  activeRequestKey = requestKey
  activeRequest = api.get('/tenant/conversations', { params })
  try {
    const res = await activeRequest
    if (sequence === requestSequence && res.code === 0) {
      conversations.value = res.data.items
      if (!keyword && filter.value === 'all') cacheConversations(scope, conversations.value)
    }
  } catch (error) {
    console.error(error)
  } finally {
    if (sequence === requestSequence) {
      loading.value = false
      searching.value = false
    }
    if (activeRequestKey === requestKey) {
      activeRequestKey = ''
      activeRequest = null
    }
  }
}

function saveListState() {
  if (!identityScope) return
  try { localStorage.setItem(listStateKey, JSON.stringify({ channelId: selectedChannelId.value, filter: filter.value, search: search.value, scrollTop: scrollElement()?.scrollTop || 0 })) } catch {}
}

function restoreScroll() {
  nextTick(() => {
    const element = scrollElement()
    if (element) element.scrollTop = Number(savedListState.scrollTop || 0)
  })
}

function syncQuery() {
  saveListState()
  const query = { ...route.query }
  if (filter.value === 'all') delete query.status
  else query.status = filter.value
  if (selectedChannelId.value) {
    query.channelId = selectedChannelId.value
    query.channelName = selectedChannel.value?.name || undefined
  } else {
    delete query.channelId
    delete query.channelName
  }
  if (search.value.trim()) query.keyword = search.value.trim()
  else delete query.keyword
  router.replace({ path: route.path, query })
}

watch(search, () => {
  syncQuery()
  clearTimeout(searchTimer)
  searchTimer = setTimeout(loadConversations, 300)
})
watch(filter, () => {
  syncQuery()
  loadConversations()
})
watch(selectedChannelId, () => {
  syncQuery()
  loadConversations()
})
watch(() => route.query.channelId, (channelId) => {
  const nextId = typeof channelId === 'string' ? channelId : ''
  if (nextId !== selectedChannelId.value) selectedChannelId.value = nextId
})

function scheduleConversationRefresh() {
  clearTimeout(socketRefreshTimer)
  socketRefreshTimer = setTimeout(loadConversations, 250)
}

function setupSocket() {
  socket = getTenantSocket()
  if (!socket) return
  socket.on('conversation.created', scheduleConversationRefresh)
  socket.on('conversation.accepted', handleConversationUpdated)
  socket.on('conversation.updated', handleConversationUpdated)
  socket.on('message.new', handleNewMessage)
}

function handleConversationUpdated(update) {
  const conversationId = String(update.conversationId?._id || update.conversationId || '')
  const index = conversations.value.findIndex((conversation) => String(conversation._id) === conversationId)
  if (index === -1) {
    scheduleConversationRefresh()
    return
  }

  const conversation = conversations.value[index]
  Object.assign(conversation, {
    ...(update.status ? { status: update.status } : {}),
    ...(update.assignedAgentId !== undefined ? { assignedAgentId: update.assignedAgentId } : {}),
    ...(update.lastMessage !== undefined ? { lastMessage: update.lastMessage } : {}),
    ...(update.lastMessageAt ? { lastMessageAt: update.lastMessageAt } : {}),
    ...(Number.isFinite(update.agentUnreadCount) ? { agentUnreadCount: update.agentUnreadCount } : {}),
  })
  if (update.lastMessageAt) {
    conversations.value.splice(index, 1)
    conversations.value.unshift(conversation)
  }
  cacheCurrentConversations()
}

function openChannel(channel) {
  selectedChannelId.value = String(channel._id)
}

function cacheCurrentConversations() {
  if (selectedChannelId.value && !search.value.trim() && filter.value === 'all') cacheConversations(tenantCacheScope(selectedChannelId.value), conversations.value)
}

function handleNewMessage(message) {
  const conversationId = String(message.conversationId?._id || message.conversationId || '')
  const index = conversations.value.findIndex((conversation) => String(conversation._id) === conversationId)
  if (index !== -1) {
    const [conversation] = conversations.value.splice(index, 1)
    conversations.value.unshift({
      ...conversation,
      lastMessage: message,
      lastMessageAt: message.createdAt || new Date().toISOString(),
    })
    cacheCurrentConversations()
  }
  if (index === -1) scheduleConversationRefresh()
}

function openConversation(conversation) {
  saveListState()
  // #region debug-point C:mobile-list-entry
  reportDebugEvent('C', 'mobile/Messages.vue:openConversation', 'conversation selected', { phase: 'list-entry', conversationId: String(conversation?._id || '').slice(-6), searchActive: Boolean(search.value.trim()), searchMatch: Boolean(conversation?.searchMatch), routeMessageFlag: route.query.message !== undefined, routeAroundFlag: route.query.around !== undefined, keepAliveCandidate: true })
  // #endregion
  if (search.value.trim() && conversation.searchMatch) {
    openSearchMatches(conversation)
    return
  }
  const query = { ...route.query }
  delete query.message
  delete query.around
  router.push({ path: `/m/messages/${conversation._id}`, query })
}

async function openSearchMatches(conversation) {
  searchDialog.value = conversation
  searchResults.value = []
  searchResultsLoading.value = true
  try {
    const res = await api.get(`/tenant/conversations/${conversation._id}/messages/search`, {
      params: { keyword: search.value.trim() },
    })
    if (res.code === 0 && searchDialog.value?._id === conversation._id) {
      searchResults.value = res.data.items || []
    }
  } catch (error) {
    console.error(error)
  } finally {
    searchResultsLoading.value = false
  }
}

function locateSearchMessage(message) {
  router.push({
    path: `/m/messages/${searchDialog.value._id}`,
    query: { ...route.query, message: message._id },
  })
}

function senderName(message) {
  if (message.senderType === 'customer') return '客户'
  if (message.senderType === 'bot') return '机器人'
  if (message.senderType === 'system') return '系统'
  return '客服'
}

function formatTime(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  const now = new Date()
  return date.toDateString() === now.toDateString()
    ? date.toTimeString().slice(0, 5)
    : `${date.getMonth() + 1}/${date.getDate()}`
}

function statusTag(status) {
  if (status === 'active') return { text: '处理中', cls: 'active' }
  if (status === 'waiting') return { text: '待接入', cls: 'waiting' }
  return { text: '已结束', cls: 'closed' }
}

function latestMessageText(message) {
  if (!message) return '暂无消息'
  if (message.messageType === 'image') return '[图片]'
  if (message.messageType === 'file') return `[文件]${message.attachmentName ? ` ${message.attachmentName}` : ''}`
  if (message.messageType === 'system' || message.senderType === 'system') return message.content || '系统消息'
  return message.content || '暂无消息'
}

function avatarColor(id) {
  const first = id?.charCodeAt(0) || 0
  const second = id?.charCodeAt(1) || 0
  const hue = (first * 7 + second * 11) % 360
  return `linear-gradient(135deg, hsl(${hue},65%,58%), hsl(${(hue + 30) % 360},60%,42%))`
}

onMounted(async () => {
  scrollElement()?.addEventListener('scroll', saveListState, { passive: true })
  initializeChatCache(tenantCacheScope())
  const cachedChannels = await getCachedChannels(identityScope)
  if (cachedChannels.data.length) channels.value = cachedChannels.data
  const conversationLoad = loadConversations()
  const channelRequest = api.get('/tenant/channels').catch(() => null)
  if (!cachedChannels.fresh || !cachedChannels.data.length) {
    const channelRes = await channelRequest
    if (channelRes?.code === 0) {
      channels.value = channelRes.data || []
      cacheChannels(identityScope, channels.value)
    }
  } else {
    channelRequest.then(channelRes => {
      if (channelRes?.code === 0) {
        channels.value = channelRes.data || []
        cacheChannels(identityScope, channels.value)
      }
    })
  }
  if (selectedChannelId.value) syncQuery()
  await conversationLoad
  restoreScroll()
  setupSocket()
})
onUnmounted(() => {
  saveListState()
  scrollElement()?.removeEventListener('scroll', saveListState)
  clearTimeout(searchTimer)
  clearTimeout(socketRefreshTimer)
  socket?.off('conversation.created', scheduleConversationRefresh)
  socket?.off('conversation.accepted', handleConversationUpdated)
  socket?.off('conversation.updated', handleConversationUpdated)
  socket?.off('message.new', handleNewMessage)
  Object.keys(avatarUrls.value).forEach(url => {
    const scope = avatarScopes.get(url)
    if (scope) releaseObjectUrl(avatarCacheKey(scope, url))
  })
  avatarScopes.clear()
})
</script>

<template>
  <section ref="pageElement" class="mobile-messages">
    <div v-if="!selectedChannelId" class="mobile-channel-home">
      <p>选择已授权渠道查看会话</p>
      <div v-if="channels.length" class="mobile-channel-search">
        <input v-model="channelSearch" type="search" placeholder="搜索渠道名称或品牌" aria-label="搜索渠道" />
      </div>
      <div v-if="filteredChannels.length" class="mobile-channel-list">
        <button v-for="channel in filteredChannels" :key="channel._id" @click="openChannel(channel)">
          <img v-if="channel.avatarUrl" v-cached-avatar="channel.avatarUrl" :src="avatarSrc(channel.avatarUrl)" loading="lazy" decoding="async" alt="" />
          <span v-else class="mobile-channel-avatar">{{ channel.name?.slice(0, 1) || '渠' }}</span>
          <span><strong>{{ channel.name }}</strong><small>{{ channel.brandName || '客服渠道' }}</small></span>
          <i>›</i>
        </button>
      </div>
      <div v-else class="mobile-state">暂无授权渠道</div>
    </div>

    <template v-else>
    <div class="mobile-tools">
      <input v-model="search" type="search" placeholder="搜索当前渠道的客户或聊天内容" aria-label="搜索会话和聊天内容" />
      <div class="mobile-filters" aria-label="会话筛选">
        <button
          v-for="item in [{ key: 'all', label: '全部' }, { key: 'waiting', label: '待接入' }, { key: 'active', label: '处理中' }, { key: 'closed', label: '已结束' }]"
          :key="item.key"
          :class="{ active: filter === item.key }"
          @click="filter = item.key"
        >{{ item.label }}</button>
      </div>
    </div>

    <div v-if="loading" class="mobile-state">加载中...</div>
    <div v-else-if="filteredConversations.length" class="mobile-list">
      <section v-for="group in groupedConversations" :key="group.key" class="mobile-channel-group">
        <header class="mobile-channel-head">
          <strong>{{ group.name }}</strong>
          <span>{{ group.items.length }} 个会话<i v-if="group.unread">{{ group.unread }} 条未读</i></span>
        </header>
        <button
          v-for="conversation in group.items"
          :key="conversation._id"
          class="mobile-item"
          @click="openConversation(conversation)"
        >
          <img v-if="avatarVisible(conversation.customer?.avatarUrl)" v-cached-avatar="conversation.customer.avatarUrl" class="mobile-avatar" :src="avatarSrc(conversation.customer.avatarUrl)" loading="lazy" decoding="async" alt="客户头像" @error="handleAvatarError(conversation.customer.avatarUrl)" />
          <span v-else class="mobile-avatar" :style="{ background: avatarColor(conversation._id) }">
            {{ conversation.customer?.phone?.slice(-1) || '客' }}
          </span>
          <span class="mobile-body">
            <span class="mobile-row">
              <span class="mobile-name">
                {{ conversation.customer?.qq ? `QQ ${conversation.customer.qq}` : (conversation.customer?.phone ? `*${conversation.customer.phone.slice(-4)}` : '访客') }}
                <span class="mobile-status" :class="statusTag(conversation.status).cls">{{ statusTag(conversation.status).text }}</span>
              </span>
              <span class="mobile-time">{{ formatTime(conversation.lastMessageAt) }}</span>
            </span>
            <span class="mobile-row mobile-summary">
              <span class="mobile-last">{{ conversation.searchMatch ? latestMessageText(conversation.searchMatch.message) : latestMessageText(conversation.lastMessage) }}</span>
              <span v-if="conversation.searchMatch" class="mobile-match-count">{{ conversation.searchMatch.count }}条相关</span>
              <span v-else-if="conversation.agentUnreadCount > 0" class="mobile-unread">{{ conversation.agentUnreadCount }}</span>
            </span>
          </span>
        </button>
      </section>
    </div>
    <div v-else class="mobile-state">{{ searching ? '正在搜索...' : (search.trim() ? '没有找到相关聊天记录' : '暂无会话') }}</div>

    <div v-if="searchDialog" class="mobile-search-mask">
      <section class="mobile-search-dialog" role="dialog" aria-modal="true" aria-label="相关聊天内容">
        <header>
          <button type="button" aria-label="返回" @click="searchDialog = null">‹</button>
          <div><strong>相关聊天内容</strong><span>{{ searchDialog.searchMatch?.count || 0 }} 条结果</span></div>
          <i></i>
        </header>
        <div class="mobile-search-keyword">搜索“{{ search }}”</div>
        <div v-if="searchResultsLoading" class="mobile-state">正在加载...</div>
        <div v-else-if="searchResults.length" class="mobile-search-results">
          <button v-for="message in searchResults" :key="message._id" @click="locateSearchMessage(message)">
            <span class="mobile-search-meta"><b>{{ senderName(message) }}</b><time>{{ formatTime(message.createdAt) }}</time></span>
            <span class="mobile-search-content">{{ latestMessageText(message) }}</span>
            <span class="mobile-search-locate">定位到聊天位置 →</span>
          </button>
        </div>
        <div v-else class="mobile-state">没有找到相关内容</div>
      </section>
    </div>
    </template>
  </section>
</template>

<style scoped>
.mobile-messages { min-height: 100%; background: #fff; }
.mobile-channel-home > p { margin: 0; padding: 16px 16px 10px; color: #64748b; font-size: 13px; background: #f8fafc; }
.mobile-channel-search { padding: 0 16px 14px; background: #f8fafc; }
.mobile-channel-search input { width: 100%; min-height: 42px; padding: 0 14px; border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; color: #0f172a; font-size: 14px; outline: none; box-sizing: border-box; }
.mobile-channel-search input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.12); }
.mobile-channel-list > button { width: 100%; display: flex; align-items: center; gap: 12px; padding: 15px 16px; border: 0; border-bottom: 1px solid #f1f5f9; background: #fff; color: inherit; text-align: left; }
.mobile-channel-list img, .mobile-channel-avatar { width: 46px; height: 46px; flex: 0 0 auto; border-radius: 12px; object-fit: cover; }
.mobile-channel-avatar { display: grid; place-items: center; background: #dbeafe; color: #2563eb; font-size: 18px; font-weight: 700; }
.mobile-channel-list button > span:nth-child(2) { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
.mobile-channel-list strong, .mobile-channel-list small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mobile-channel-list strong { color: #0f172a; font-size: 15px; }
.mobile-channel-list small { color: #94a3b8; font-size: 12px; }
.mobile-channel-list i { color: #94a3b8; font-size: 24px; font-style: normal; }
.mobile-tools { padding: 12px 16px 10px; background: rgba(255,255,255,.96); border-bottom: 1px solid #f1f5f9; backdrop-filter: blur(12px); }
.mobile-channel-back { padding: 0; border: 0; background: transparent; color: #2563eb; font-size: 13px; }
.mobile-channel-title { display: block; margin: 5px 0 10px; overflow: hidden; color: #0f172a; font-size: 16px; text-overflow: ellipsis; white-space: nowrap; }
.mobile-tools input { width: 100%; min-height: 42px; padding: 0 14px; border: 1px solid #e2e8f0; border-radius: 12px; background: #f8fafc; color: #0f172a; font-size: 14px; outline: none; box-sizing: border-box; }
.mobile-tools input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.12); background: #fff; }
.mobile-filters { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 10px; }
.mobile-filters button { min-height: 34px; border: 0; border-radius: 9px; background: #f1f5f9; color: #64748b; font-size: 12px; }
.mobile-filters button.active { background: #dbeafe; color: #1d4ed8; font-weight: 700; }
.mobile-channel-group + .mobile-channel-group { border-top: 8px solid #f1f5f9; }
.mobile-channel-head { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; padding: 9px 16px; background: #f8fafc; color: #334155; }
.mobile-channel-head strong { font-size: 13px; }
.mobile-channel-head span { display: flex; align-items: center; gap: 8px; color: #94a3b8; font-size: 11px; }
.mobile-channel-head i { padding: 2px 6px; border-radius: 999px; background: #fee2e2; color: #dc2626; font-style: normal; }
.mobile-item { display: flex; width: 100%; gap: 12px; padding: 14px 16px; border: 0; border-bottom: 1px solid #f1f5f9; background: #fff; text-align: left; color: inherit; }
.mobile-item:active { background: #f8fafc; }
.mobile-avatar { width: 48px; height: 48px; border-radius: 50%; flex: 0 0 auto; display: grid; place-items: center; color: #fff; font-size: 18px; font-weight: 700; object-fit: cover; }
.mobile-body { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.mobile-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.mobile-name { min-width: 0; display: flex; align-items: center; gap: 6px; color: #0f172a; font-size: 14px; font-weight: 700; }
.mobile-status { padding: 2px 6px; border-radius: 999px; font-size: 10px; white-space: nowrap; }
.mobile-status.waiting { background: #dbeafe; color: #2563eb; }
.mobile-status.active { background: #dcfce7; color: #15803d; }
.mobile-status.closed { background: #f1f5f9; color: #64748b; }
.mobile-time, .mobile-channel { color: #94a3b8; font-size: 11px; }
.mobile-summary { margin-top: 5px; }
.mobile-last { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #64748b; font-size: 13px; }
.mobile-unread { min-width: 20px; padding: 2px 6px; border-radius: 999px; background: #ef4444; color: #fff; font-size: 10px; font-weight: 700; text-align: center; }
.mobile-match-count { flex: 0 0 auto; color: #2563eb; font-size: 11px; font-weight: 600; }
.mobile-channel { margin-top: 5px; }
.mobile-state { padding: 64px 20px; color: #94a3b8; text-align: center; }
.mobile-search-mask { position: fixed; inset: 0; z-index: 1200; background: #fff; }
.mobile-search-dialog { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.mobile-search-dialog header { min-height: 58px; display: grid; grid-template-columns: 42px 1fr 42px; align-items: center; padding: env(safe-area-inset-top) 10px 0; border-bottom: 1px solid #e2e8f0; }
.mobile-search-dialog header button { border: 0; background: transparent; color: #2563eb; font-size: 32px; }
.mobile-search-dialog header div { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.mobile-search-dialog header strong { color: #0f172a; font-size: 16px; }
.mobile-search-dialog header span, .mobile-search-keyword { color: #64748b; font-size: 11px; }
.mobile-search-keyword { padding: 10px 16px; background: #f8fafc; }
.mobile-search-results { flex: 1; overflow-y: auto; padding-bottom: env(safe-area-inset-bottom); }
.mobile-search-results > button { display: flex; width: 100%; flex-direction: column; gap: 8px; padding: 15px 16px; border: 0; border-bottom: 1px solid #f1f5f9; background: #fff; text-align: left; }
.mobile-search-results > button:active { background: #f8fafc; }
.mobile-search-meta { display: flex; justify-content: space-between; color: #94a3b8; font-size: 11px; }
.mobile-search-meta b { color: #475569; }
.mobile-search-content { color: #0f172a; font-size: 14px; line-height: 1.55; overflow-wrap: anywhere; }
.mobile-search-locate { align-self: flex-end; color: #2563eb; font-size: 11px; }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
</style>
