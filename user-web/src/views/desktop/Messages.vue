<!-- 忆梦云团队开发 - 桌面端消息中心独立视图 -->
<script setup>
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChatPanel from './ChatPanel.vue'
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
const listStateKey = `yimeng_message_list:${identityScope}:desktop`
let savedListState = {}
try { savedListState = JSON.parse(localStorage.getItem(listStateKey) || '{}') || {} } catch {}
const validFilters = new Set(['all', 'waiting', 'active', 'closed'])
const routeFilter = typeof route.query.status === 'string' ? route.query.status : savedListState.filter
const filter = ref(validFilters.has(String(routeFilter)) ? String(routeFilter) : 'all')
const selectedChannelId = ref(typeof route.query.channelId === 'string' ? route.query.channelId : String(savedListState.channelId || ''))
const search = ref(typeof route.query.keyword === 'string' ? route.query.keyword : String(savedListState.search || ''))
const listElement = ref(null)
const searching = ref(false)
const searchDialog = ref(null)
const searchResults = ref([])
const searchResultsLoading = ref(false)
const targetMessageId = ref(null)
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

// 选中会话：优先从路由取（桌面端直接打开聊天链接），否则停留在会话列表
const selectedId = ref(route.params.id || null)

const filteredConversations = computed(() => {
  let list = conversations.value
  if (filter.value !== 'all') list = list.filter(c => c.status === filter.value)
  return list
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

const unreadCount = computed(() => conversations.value.reduce((a, c) => a + (c.agentUnreadCount || 0), 0))
const selectedChannel = computed(() => channels.value.find(channel => String(channel._id) === selectedChannelId.value) || null)
const channelSearch = ref('')
const filteredChannels = computed(() => {
  const keyword = channelSearch.value.trim().toLowerCase()
  if (!keyword) return channels.value
  return channels.value.filter(channel => [channel.name, channel.brandName]
    .some(value => String(value || '').toLowerCase().includes(keyword)))
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
  } catch (e) {
    console.error(e)
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
  try { localStorage.setItem(listStateKey, JSON.stringify({ channelId: selectedChannelId.value, filter: filter.value, search: search.value, scrollTop: listElement.value?.scrollTop || 0 })) } catch {}
}

function restoreScroll() {
  nextTick(() => {
    if (listElement.value) listElement.value.scrollTop = Number(savedListState.scrollTop || 0)
  })
}

function syncQuery() {
  saveListState()
  const query = { ...route.query }
  if (filter.value === 'all') delete query.status
  else query.status = filter.value
  if (selectedChannelId.value) query.channelId = selectedChannelId.value
  else delete query.channelId
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

function clearConversationUnread(id) {
  const conversation = conversations.value.find(item => String(item._id) === String(id))
  if (conversation) conversation.agentUnreadCount = 0
}

function openChannel(channel) {
  selectedChannelId.value = String(channel._id)
}

function returnToChannels() {
  selectedId.value = null
  selectedChannelId.value = ''
}

function selectConv(id) {
  // #region debug-point C:desktop-list-entry
  reportDebugEvent('C', 'desktop/Messages.vue:selectConv', 'conversation selected', { phase: 'list-entry', conversationId: String(id || '').slice(-6), targetPresentBefore: Boolean(targetMessageId.value), routeMessageFlag: route.query.message !== undefined, routeAroundFlag: route.query.around !== undefined, keepAliveCandidate: true })
  // #endregion
  selectedId.value = id
  targetMessageId.value = null
  clearConversationUnread(id)
}

async function openSearchMatches(conversation) {
  if (!search.value.trim() || !conversation.searchMatch) return selectConv(conversation._id)
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
  selectedId.value = searchDialog.value._id
  targetMessageId.value = message._id
  clearConversationUnread(selectedId.value)
  searchDialog.value = null
}

function senderName(message) {
  if (message.senderType === 'customer') return '客户'
  if (message.senderType === 'bot') return '机器人'
  if (message.senderType === 'system') return '系统'
  return '客服'
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso); const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toTimeString().slice(0, 5)
  return `${d.getMonth()+1}/${d.getDate()}`
}
function formatDateTime(iso) {
  return iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : ''
}
function convStatusTag(s) {
  if (s === 'active') return { text: '处理中', cls: 'active' }
  if (s === 'waiting') return { text: '待接入', cls: 'waiting' }
  return { text: '已结束', cls: 'closed' }
}
function latestMessageText(message) {
  if (!message) return '暂无消息'
  if (message.messageType === 'image') return '[图片]'
  if (message.messageType === 'file') return `[文件]${message.attachmentName ? ` ${message.attachmentName}` : ''}`
  if (message.messageType === 'system' || message.senderType === 'system') return message.content || '系统消息'
  return message.content || '暂无消息'
}
function getAvatarColor(id) {
  const h = (id.charCodeAt(0) * 7 + id.charCodeAt(1) * 11) % 360
  return `linear-gradient(135deg, hsl(${h},65%,58%), hsl(${(h+30)%360},60%,42%))`
}

onMounted(async () => {
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
  await conversationLoad
  restoreScroll()
  setupSocket()
})
onUnmounted(() => {
  saveListState()
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
  <div class="msg-page">
    <!-- ============ 桌面端三栏布局（>= 769px） ============ -->
    <template v-if="!loading">
      <div v-if="!selectedChannelId" class="msg-desktop channel-select-view">
        <aside class="msg-sider">
          <div class="msg-sider-head">
            <div class="msg-sider-title">授权渠道</div>
            <div class="msg-sider-search">
              <input v-model="channelSearch" type="search" placeholder="搜索渠道名称或品牌名..." />
            </div>
          </div>
          <div v-if="filteredChannels.length" class="msg-sider-list channel-list">
            <button v-for="channel in filteredChannels" :key="channel._id" class="channel-item" @click="openChannel(channel)">
              <img v-if="channel.avatarUrl" v-cached-avatar="channel.avatarUrl" class="mi-avatar channel-avatar-image" :src="avatarSrc(channel.avatarUrl)" loading="lazy" decoding="async" alt="" />
              <span v-else class="mi-avatar channel-avatar">{{ channel.name?.slice(0, 1) || '渠' }}</span>
              <span class="mi-body">
                <span class="mi-row"><strong class="mi-name">{{ channel.name }}</strong><i>›</i></span>
                <span class="mi-last">{{ channel.brandName || '客服渠道' }}</span>
              </span>
            </button>
          </div>
          <div v-else class="msg-sider-empty">
            <div class="mse-title">{{ channelSearch.trim() ? '没有找到匹配渠道' : '暂无授权渠道' }}</div>
          </div>
        </aside>
        <main class="msg-main">
          <div class="msg-welcome">
            <div class="mw-title">选择授权渠道</div>
            <div class="mw-desc">从左侧选择渠道查看对应会话</div>
          </div>
        </main>
      </div>

      <div v-else class="msg-desktop">
        <!-- 左栏：会话列表 -->
        <aside class="msg-sider">
          <div class="msg-sider-head">
            <div class="channel-context-head">
              <button class="channel-back" type="button" @click="returnToChannels">‹ 返回渠道</button>
              <span v-if="unreadCount > 0" class="msg-sider-badge">{{ unreadCount }}</span>
            </div>
            <div class="msg-sider-title channel-current-title">{{ selectedChannel?.name || '渠道会话' }}</div>
            <div class="msg-sider-search">
              <input v-model="search" type="search" :placeholder="selectedChannelId ? '搜索当前渠道的客户或聊天内容...' : '搜索全部渠道的客户或聊天内容...'" />
            </div>
            <div class="msg-sider-tabs">
              <button
                v-for="t in [{k:'all',label:'全部'},{k:'waiting',label:'待接入'},{k:'active',label:'处理中'},{k:'closed',label:'已结束'}]"
                :key="t.k"
                :class="{ active: filter === t.k }"
                @click="filter = t.k"
              >{{ t.label }}</button>
            </div>
          </div>

          <div ref="listElement" class="msg-sider-list" v-if="filteredConversations.length > 0" @scroll.passive="saveListState">
            <section v-for="group in groupedConversations" :key="group.key" class="msg-channel-group">
              <header class="msg-channel-head">
                <strong>{{ group.name }}</strong>
                <span>{{ group.items.length }}<i v-if="group.unread">{{ group.unread }} 未读</i></span>
              </header>
              <div
                v-for="conv in group.items"
                :key="conv._id"
                class="msg-item"
                :class="{ active: selectedId === conv._id }"
                @click="openSearchMatches(conv)"
              >
                <img v-if="avatarVisible(conv.customer?.avatarUrl)" v-cached-avatar="conv.customer.avatarUrl" class="mi-avatar" :src="avatarSrc(conv.customer.avatarUrl)" loading="lazy" decoding="async" alt="客户头像" @error="handleAvatarError(conv.customer.avatarUrl)" />
                <div v-else class="mi-avatar" :style="{ background: getAvatarColor(conv._id) }">
                  {{ conv.customer?.phone?.slice(-1) || '客' }}
                </div>
                <div class="mi-body">
                  <div class="mi-row">
                    <span class="mi-name">
                      {{ conv.customer?.qq ? `QQ ${conv.customer.qq}` : (conv.customer?.phone ? '*' + conv.customer.phone.slice(-4) : '访客') }}
                      <span class="mi-status" :class="convStatusTag(conv.status).cls">{{ convStatusTag(conv.status).text }}</span>
                    </span>
                    <span class="mi-time">{{ formatTime(conv.lastMessageAt) }}</span>
                  </div>
                  <div class="mi-row mi-row-2">
                    <span class="mi-last">{{ conv.searchMatch ? latestMessageText(conv.searchMatch.message) : latestMessageText(conv.lastMessage) }}</span>
                    <span v-if="conv.searchMatch" class="mi-match-count">{{ conv.searchMatch.count }}条相关</span>
                    <span v-else-if="conv.agentUnreadCount > 0" class="mi-unread">{{ conv.agentUnreadCount }}</span>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div v-else class="msg-sider-empty">
            <div class="mse-emoji">💬</div>
            <div class="mse-title">{{ searching ? '正在搜索...' : (search.trim() ? '没有找到相关聊天记录' : '暂无会话') }}</div>
            <div class="mse-desc" v-if="filter !== 'all' && !search.trim()">切换到「全部」查看</div>
          </div>
        </aside>

        <!-- 右栏：聊天面板 -->
        <main class="msg-main">
          <ChatPanel v-if="selectedId" :conversationId="selectedId" :target-message-id="targetMessageId" @conversation-read="clearConversationUnread" />
          <div v-else class="msg-welcome">
            <div class="mw-emoji">👋</div>
            <div class="mw-title">欢迎来到消息中心</div>
            <div class="mw-desc">从左侧选择一个会话开始接待客户</div>
          </div>
        </main>
      </div>

      <!-- ============ 移动端单列列表（< 769px） ============ -->
      <div class="msg-mobile" v-if="filteredConversations.length > 0">
        <div
          v-for="conv in filteredConversations"
          :key="conv._id"
          class="mm-item"
          @click="selectConv(conv._id)"
        >
          <div class="mm-avatar" :style="{ background: getAvatarColor(conv._id) }">
            {{ conv.customer?.phone?.slice(-1) || '客' }}
          </div>
          <div class="mm-body">
            <div class="mm-row">
              <span class="mm-name">
                {{ conv.customer?.qq ? `QQ ${conv.customer.qq}` : (conv.customer?.phone ? '*' + conv.customer.phone.slice(-4) : '访客') }}
                <span class="mi-status" :class="convStatusTag(conv.status).cls">{{ convStatusTag(conv.status).text }}</span>
              </span>
              <span class="mm-time">{{ formatTime(conv.lastMessageAt) }}</span>
            </div>
            <div class="mm-row mm-row-2">
              <span class="mm-last">{{ latestMessageText(conv.lastMessage) }}</span>
              <span v-if="conv.agentUnreadCount > 0" class="mm-unread">{{ conv.agentUnreadCount }}</span>
            </div>
            <div v-if="conv.channel?.name" class="mm-channel">📡 {{ conv.channel.name }}</div>
          </div>
        </div>
      </div>
      <div v-else-if="filteredConversations.length === 0" class="msg-mobile-empty">
        <div class="mse-emoji">💬</div>
        <div class="mse-title">暂无会话</div>
      </div>
    </template>

    <!-- 加载中 -->
    <div v-else class="msg-loading">加载中...</div>

    <div v-if="searchDialog" class="search-dialog-mask" @click.self="searchDialog = null">
      <section class="search-dialog" role="dialog" aria-modal="true" aria-label="相关聊天内容">
        <header class="search-dialog-head">
          <div>
            <strong>相关聊天内容</strong>
            <span>{{ searchDialog.searchMatch?.count || 0 }} 条结果</span>
          </div>
          <button type="button" aria-label="关闭" @click="searchDialog = null">×</button>
        </header>
        <div class="search-dialog-keyword">搜索“{{ search }}”</div>
        <div v-if="searchResultsLoading" class="search-dialog-state">正在加载...</div>
        <div v-else-if="searchResults.length" class="search-result-list">
          <button v-for="message in searchResults" :key="message._id" class="search-result-item" @click="locateSearchMessage(message)">
            <span class="search-result-meta"><b>{{ senderName(message) }}</b><time>{{ formatDateTime(message.createdAt) }}</time></span>
            <span class="search-result-content">{{ latestMessageText(message) }}</span>
            <span class="search-result-locate">定位到聊天位置 →</span>
          </button>
        </div>
        <div v-else class="search-dialog-state">没有找到相关内容</div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.msg-page { width: 100%; height: 100%; min-height: 0; overflow: hidden; background: #f1f5f9; }
.channel-select-view .msg-sider-head { padding-bottom: 14px; }
.channel-list { padding: 4px; }
.channel-item { display: flex; width: 100%; align-items: center; gap: 10px; margin-bottom: 2px; padding: 10px; border: 0; border-radius: 10px; background: #fff; color: inherit; text-align: left; cursor: pointer; transition: background .12s; }
.channel-item:hover { background: #f8fafc; }
.channel-item .mi-row { margin-bottom: 4px; }
.channel-item .mi-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.channel-item .mi-row i { color: #94a3b8; font-size: 20px; font-style: normal; }
.channel-avatar { display: grid; place-items: center; border-radius: 12px; background: #dbeafe; color: #2563eb; }
.channel-avatar-image { border-radius: 12px; }
.channel-context-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; }
.channel-back { padding: 0; border: 0; background: transparent; color: #2563eb; font-size: 12px; cursor: pointer; }
.channel-current-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ===== 桌面三栏 ===== */
.msg-desktop {
  display: flex; width: 100%; height: 100%; min-height: 0; overflow: hidden;
  border-left: 1px solid #e2e8f0;
}

/* 左栏 */
.msg-sider {
  width: 320px; min-height: 0; flex-shrink: 0; background: #fff;
  display: flex; flex-direction: column; overflow: hidden;
  border-right: 1px solid #e2e8f0;
}
.msg-sider-head { padding: 14px 14px 10px; border-bottom: 1px solid #f1f5f9; flex-shrink: 0; }
.msg-sider-title {
  font-size: 16px; font-weight: 700; color: #0f172a;
  display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
}
.msg-sider-badge {
  background: #ef4444; color: #fff; font-size: 11px; font-weight: 600;
  padding: 1px 7px; border-radius: 10px;
}
.msg-sider-scope { margin-bottom: 8px; }
.msg-sider-scope select, .msg-sider-search input {
  width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;
  font-size: 13px; outline: none; box-sizing: border-box; background: #f8fafc;
}
.msg-sider-scope select:focus, .msg-sider-search input:focus { border-color: #2563eb; background: #fff; }
.msg-sider-tabs { display: flex; gap: 4px; margin-top: 10px; }
.msg-sider-tabs button {
  flex: 1; padding: 5px 0; border: none; background: #f1f5f9; color: #64748b;
  font-size: 12px; border-radius: 6px; cursor: pointer; transition: all .15s;
}
.msg-sider-tabs button.active { background: #eff6ff; color: #2563eb; font-weight: 600; }

.msg-sider-list { flex: 1; overflow-y: auto; padding: 4px; }
.msg-channel-group + .msg-channel-group { margin-top: 6px; padding-top: 4px; border-top: 1px solid #e2e8f0; }
.msg-channel-head { position: sticky; top: -4px; z-index: 2; display: flex; align-items: center; justify-content: space-between; padding: 7px 8px; background: rgba(248,250,252,.96); color: #334155; }
.msg-channel-head strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.msg-channel-head span { display: flex; align-items: center; gap: 6px; color: #94a3b8; font-size: 10px; }
.msg-channel-head i { padding: 1px 5px; border-radius: 999px; background: #fee2e2; color: #dc2626; font-style: normal; }
.msg-item {
  display: flex; gap: 10px; padding: 10px; border-radius: 10px;
  cursor: pointer; transition: background .12s; margin-bottom: 2px;
}
.msg-item:hover { background: #f8fafc; }
.msg-item.active { background: #eff6ff; }
.mi-avatar {
  width: 42px; height: 42px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 16px; object-fit: cover;
}
.mi-body { flex: 1; min-width: 0; }
.mi-row { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.mi-row-2 { margin-top: 3px; }
.mi-name { font-weight: 600; font-size: 13px; color: #0f172a; display: flex; align-items: center; gap: 6px; }
.mi-time { font-size: 11px; color: #94a3b8; flex-shrink: 0; }
.mi-last { font-size: 12px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
.mi-unread {
  background: #ef4444; color: #fff; font-size: 10px; font-weight: 600;
  padding: 1px 6px; border-radius: 9px; flex-shrink: 0; min-width: 16px; text-align: center;
}
.mi-match-count { flex-shrink: 0; color: #2563eb; font-size: 10px; font-weight: 600; }
.mi-channel { margin-top: 3px; font-size: 10px; color: #94a3b8; }

.mi-status { font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 600; }
.mi-status.waiting { background: #dbeafe; color: #2563eb; }
.mi-status.active { background: #dcfce7; color: #16a34a; }
.mi-status.closed { background: #f1f5f9; color: #94a3b8; }

.msg-sider-empty { padding: 40px 20px; text-align: center; color: #94a3b8; }
.mse-emoji { font-size: 42px; margin-bottom: 8px; }
.mse-title { font-size: 14px; font-weight: 600; color: #475569; }
.mse-desc { font-size: 12px; margin-top: 4px; }

/* 右栏 */
.msg-main { flex: 1 1 auto; display: flex; min-width: 0; min-height: 0; overflow: hidden; }
.msg-welcome {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  color: #94a3b8; background: #f8fafc;
}
.mw-emoji { font-size: 64px; margin-bottom: 12px; opacity: .6; }
.mw-title { font-size: 16px; font-weight: 600; color: #475569; }
.mw-desc { font-size: 13px; margin-top: 6px; }

/* 搜索结果弹窗 */
.search-dialog-mask { position: fixed; inset: 0; z-index: 1200; display: grid; place-items: center; padding: 24px; background: rgba(15,23,42,.42); }
.search-dialog { width: min(560px, 92vw); max-height: min(680px, 82vh); display: flex; flex-direction: column; overflow: hidden; border-radius: 16px; background: #fff; box-shadow: 0 24px 70px rgba(15,23,42,.22); }
.search-dialog-head { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px 12px; border-bottom: 1px solid #f1f5f9; }
.search-dialog-head div { display: flex; align-items: baseline; gap: 10px; }
.search-dialog-head strong { color: #0f172a; font-size: 17px; }
.search-dialog-head span, .search-dialog-keyword { color: #64748b; font-size: 12px; }
.search-dialog-head button { width: 34px; height: 34px; border: 0; border-radius: 9px; background: #f1f5f9; color: #475569; font-size: 22px; cursor: pointer; }
.search-dialog-keyword { padding: 10px 20px; background: #f8fafc; }
.search-result-list { overflow-y: auto; padding: 6px 0; }
.search-result-item { display: flex; width: 100%; flex-direction: column; gap: 7px; padding: 14px 20px; border: 0; border-bottom: 1px solid #f1f5f9; background: #fff; text-align: left; cursor: pointer; }
.search-result-item:hover { background: #f8fafc; }
.search-result-meta { display: flex; justify-content: space-between; color: #94a3b8; font-size: 11px; }
.search-result-meta b { color: #475569; font-size: 12px; }
.search-result-content { color: #0f172a; font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
.search-result-locate { align-self: flex-end; color: #2563eb; font-size: 11px; }
.search-dialog-state { padding: 56px 20px; color: #94a3b8; text-align: center; }

/* 加载中 */
.msg-loading { padding: 60px; text-align: center; color: #94a3b8; }

/* ===== 移动端单列 ===== */
@media (max-width: 768px) {
  .msg-desktop { display: none; }
  .msg-page { height: 100%; min-height: 0; overflow-y: auto; background: #fff; }
  .msg-mobile { padding-bottom: 60px; }
  .mm-item {
    display: flex; gap: 12px; padding: 14px 16px;
    border-bottom: 1px solid #f1f5f9;
  }
  .mm-item:active { background: #f8fafc; }
  .mm-avatar {
    width: 48px; height: 48px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-weight: 700; font-size: 18px;
  }
  .mm-body { flex: 1; min-width: 0; }
  .mm-row { display: flex; justify-content: space-between; gap: 6px; }
  .mm-row-2 { margin-top: 3px; }
  .mm-name { font-weight: 600; font-size: 14px; color: #0f172a; display: flex; align-items: center; gap: 6px; }
  .mm-time { font-size: 11px; color: #94a3b8; }
  .mm-last { font-size: 13px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
  .mm-unread {
    background: #ef4444; color: #fff; font-size: 11px; font-weight: 600;
    padding: 1px 7px; border-radius: 10px;
  }
  .mm-channel { margin-top: 3px; font-size: 11px; color: #94a3b8; }
  .msg-mobile-empty { padding: 60px 20px; text-align: center; color: #94a3b8; padding-bottom: 100px; }
}
@media (min-width: 769px) {
  .msg-mobile { display: none; }
}
</style>