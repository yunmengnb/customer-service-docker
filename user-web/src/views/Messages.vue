<!-- 忆梦云团队开发 - 消息中心：桌面三栏布局 / 移动单列列表 -->
<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { io } from 'socket.io-client'
import ChatPanel from '../components/ChatPanel.vue'
import api from '../api'

const route = useRoute()

const conversations = ref([])
const loading = ref(true)
const filter = ref('all') // all / waiting / active / closed
const search = ref('')
let socket = null

// 选中会话：优先从路由取（桌面端直接打开聊天链接），否则 null
const selectedId = ref(route.params.id || null)
// 加载完列表后自动选中第一个
watch([loading, conversations], () => {
  if (!loading.value && conversations.value.length && !selectedId.value) {
    selectedId.value = conversations.value[0]._id
  }
})

const filteredConversations = computed(() => {
  let list = conversations.value
  if (filter.value !== 'all') list = list.filter(c => c.status === filter.value)
  if (search.value.trim()) {
    const s = search.value.trim()
    list = list.filter(c =>
      (c.customer?.phone && c.customer.phone.includes(s)) ||
      (c.channel?.name && c.channel.name.includes(s))
    )
  }
  return list
})

const unreadCount = computed(() => conversations.value.reduce((a, c) => a + (c.agentUnreadCount || 0), 0))

async function loadConversations() {
  try {
    const res = await api.get('/tenant/conversations')
    if (res.code === 0) conversations.value = res.data.items
  } catch (e) { console.error(e) }
  loading.value = false
}

function setupSocket() {
  const token = localStorage.getItem('tenant_token')
  if (!token) return
  socket = io({ auth: { token, type: 'tenant_user' }, transports: ['polling', 'websocket'] })
  socket.on('conversation.created', loadConversations)
  socket.on('conversation.accepted', loadConversations)
  socket.on('conversation.updated', loadConversations)
  socket.on('conversation.transferred', loadConversations)
  socket.on('message.new', loadConversations)
}

function selectConv(id) { selectedId.value = id }

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso); const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toTimeString().slice(0, 5)
  return `${d.getMonth()+1}/${d.getDate()}`
}
function convStatusTag(s) {
  if (s === 'active') return { text: '处理中', cls: 'active' }
  if (s === 'waiting') return { text: '待接入', cls: 'waiting' }
  return { text: '已结束', cls: 'closed' }
}
function getAvatarColor(id) {
  const h = (id.charCodeAt(0) * 7 + id.charCodeAt(1) * 11) % 360
  return `linear-gradient(135deg, hsl(${h},65%,58%), hsl(${(h+30)%360},60%,42%))`
}

onMounted(() => { loadConversations(); setupSocket() })
onUnmounted(() => { socket?.disconnect() })
</script>

<template>
  <div class="msg-page">
    <!-- ============ 桌面端三栏布局（>= 769px） ============ -->
    <template v-if="!loading">
      <div class="msg-desktop">
        <!-- 左栏：会话列表 -->
        <aside class="msg-sider">
          <div class="msg-sider-head">
            <div class="msg-sider-title">
              消息中心
              <span v-if="unreadCount > 0" class="msg-sider-badge">{{ unreadCount }}</span>
            </div>
            <div class="msg-sider-search">
              <input v-model="search" type="text" placeholder="搜索手机号或渠道..." />
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

          <div class="msg-sider-list" v-if="filteredConversations.length > 0">
            <div
              v-for="conv in filteredConversations"
              :key="conv._id"
              class="msg-item"
              :class="{ active: selectedId === conv._id }"
              @click="selectConv(conv._id)"
            >
              <div class="mi-avatar" :style="{ background: getAvatarColor(conv._id) }">
                {{ conv.customer?.phone?.slice(-1) || '客' }}
              </div>
              <div class="mi-body">
                <div class="mi-row">
                  <span class="mi-name">
                    {{ conv.customer?.phone ? '*' + conv.customer.phone.slice(-4) : '访客' }}
                    <span class="mi-status" :class="convStatusTag(conv._id).cls" v-html="convStatusTag(conv.status).text"></span>
                  </span>
                  <span class="mi-time">{{ formatTime(conv.lastMessageAt) }}</span>
                </div>
                <div class="mi-row mi-row-2">
                  <span class="mi-last">{{ conv.lastMessage?.content || '—' }}</span>
                  <span v-if="conv.agentUnreadCount > 0" class="mi-unread">{{ conv.agentUnreadCount }}</span>
                </div>
                <div v-if="conv.channel?.name" class="mi-channel">📡 {{ conv.channel.name }}</div>
              </div>
            </div>
          </div>

          <div v-else class="msg-sider-empty">
            <div class="mse-emoji">💬</div>
            <div class="mse-title">暂无会话</div>
            <div class="mse-desc" v-if="filter !== 'all'">切换到「全部」查看</div>
          </div>
        </aside>

        <!-- 右栏：聊天面板 -->
        <main class="msg-main">
          <ChatPanel v-if="selectedId" :conversationId="selectedId" />
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
                {{ conv.customer?.phone ? '*' + conv.customer.phone.slice(-4) : '访客' }}
                <span class="mi-status" :class="convStatusTag(conv._id).cls">{{ convStatusTag(conv.status).text }}</span>
              </span>
              <span class="mm-time">{{ formatTime(conv.lastMessageAt) }}</span>
            </div>
            <div class="mm-row mm-row-2">
              <span class="mm-last">{{ conv.lastMessage?.content || '—' }}</span>
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
  </div>
</template>

<style scoped>
.msg-page { width: 100%; height: 100%; min-height: 0; overflow: hidden; background: #f1f5f9; }

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
.msg-sider-search input {
  width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;
  font-size: 13px; outline: none; box-sizing: border-box; background: #f8fafc;
}
.msg-sider-search input:focus { border-color: #2563eb; background: #fff; }
.msg-sider-tabs { display: flex; gap: 4px; margin-top: 10px; }
.msg-sider-tabs button {
  flex: 1; padding: 5px 0; border: none; background: #f1f5f9; color: #64748b;
  font-size: 12px; border-radius: 6px; cursor: pointer; transition: all .15s;
}
.msg-sider-tabs button.active { background: #eff6ff; color: #2563eb; font-weight: 600; }

.msg-sider-list { flex: 1; overflow-y: auto; padding: 4px; }
.msg-item {
  display: flex; gap: 10px; padding: 10px; border-radius: 10px;
  cursor: pointer; transition: background .12s; margin-bottom: 2px;
}
.msg-item:hover { background: #f8fafc; }
.msg-item.active { background: #eff6ff; }
.mi-avatar {
  width: 42px; height: 42px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 16px;
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
