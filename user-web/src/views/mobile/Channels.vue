<!-- 忆梦云团队开发 - 手机端渠道列表独立视图 -->
<script setup>
import { readTenantCache } from '../../api'
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../../api'
import { buildCustomerServiceUrl, copyText } from '../../clipboard'
import ConfirmDialog from '../../components/ConfirmDialog.vue'

const router = useRouter()
const user = readTenantCache('tenant_user')
const isAdmin = computed(() => ['owner', 'admin'].includes(user?.role))
const channels = ref([])
const loading = ref(true)
const loadError = ref('')
const showCreate = ref(false)
const createForm = ref({ name: '', brandName: '', welcomeMessage: '' })
const confirmAction = ref(null)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await api.get('/tenant/channels')
    if (res.code !== 0) throw new Error(res.message || '渠道加载失败')
    channels.value = res.data || []
  } catch (error) {
    loadError.value = error?.message || '渠道加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

async function createChannel() {
  if (!createForm.value.name) return
  const res = await api.post('/tenant/channels', createForm.value)
  if (res.code === 0) {
    showCreate.value = false
    createForm.value = { name: '', brandName: '', welcomeMessage: '' }
    await load()
  } else {
    alert(res.message)
  }
}

async function copyLink(link) {
  const url = buildCustomerServiceUrl(link)
  try {
    await copyText(url)
    alert('客服链接已复制:\n' + url)
  } catch {
    window.prompt('自动复制失败，请长按链接并选择复制', url)
  }
}

async function toggleStatus(ch) {
  const newStatus = ch.status === 'online' ? 'offline' : 'online'
  await api.patch(`/tenant/channels/${ch._id}`, { status: newStatus })
  await load()
}

async function runConfirmedAction() {
  const action = confirmAction.value
  if (!action) return
  await api.delete(`/tenant/channels/${action.channel._id}`)
  await load()
  confirmAction.value = null
}

function openChannelConfig(channelId) {
  router.push(`/m/channels/${channelId}`)
}

onMounted(load)
</script>

<template>
  <div class="page-content">
    <div class="page-title">
      <span>授权渠道</span>
      <button v-if="isAdmin" @click="showCreate = true">+ 新建渠道</button>
    </div>
    
    <div v-if="loading" class="state-card">正在加载渠道...</div>
    <div v-else-if="loadError" class="state-card error-state">
      <strong>渠道加载失败</strong>
      <span>{{ loadError }}</span>
      <button class="action-btn" @click="load">重新加载</button>
    </div>
    <div v-else-if="channels.length" class="channel-list">
      <article v-for="ch in channels" :key="ch._id" class="channel-card">
        <div class="card-header">
          <div class="channel-avatar" :style="{ background: ch.brandColor || '#2563eb' }">
            <img v-if="ch.avatarUrl" :src="ch.avatarUrl" alt="" />
            <span v-else>{{ (ch.brandName || ch.name || '渠').slice(0, 1) }}</span>
          </div>
          <div class="channel-heading">
            <strong>{{ ch.name }}</strong>
            <span>{{ ch.brandName || '未设置品牌名' }}</span>
          </div>
          <span :class="['status-pill', ch.status === 'online' ? 'online' : 'offline']">
            {{ ch.status === 'online' ? '在线' : '离线' }}
          </span>
        </div>
        <div class="link-block">
          <span>客服链接</span>
          <code>{{ ch.link }}</code>
          <button class="copy-button" @click="copyLink(ch.link)">复制</button>
        </div>
        <div class="card-meta">创建于 {{ new Date(ch.createdAt).toLocaleDateString() }}</div>
        <div class="card-actions">
          <button class="primary-action" @click="openChannelConfig(ch._id)">进入配置</button>
          <button v-if="isAdmin" class="action-btn" @click="toggleStatus(ch)">{{ ch.status === 'online' ? '设为离线' : '设为在线' }}</button>
          <button v-if="isAdmin" class="action-btn danger" @click="confirmAction = { channel: ch }">删除</button>
        </div>
      </article>
    </div>
    <div v-else class="state-card">暂无渠道</div>

    <!-- 新建弹窗 -->
    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <div class="modal-box">
        <h3>新建渠道</h3>
        <div class="form-group">
          <label>渠道名称</label>
          <input v-model="createForm.name" placeholder="例如：官方客服" />
        </div>
        <div class="form-group">
          <label>品牌名（可选）</label>
          <input v-model="createForm.brandName" placeholder="客户端显示的名称" />
        </div>
        <div class="form-group">
          <label>欢迎词（可选）</label>
          <textarea v-model="createForm.welcomeMessage" placeholder="您好，欢迎咨询..."></textarea>
        </div>
        <div class="modal-footer">
          <button class="btn-ghost" @click="showCreate = false">取消</button>
          <button class="btn-primary" @click="createChannel">创建</button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :open="!!confirmAction"
      title="删除渠道"
      :message="`确认删除渠道「${confirmAction?.channel?.name || ''}」吗？关联关键词和快捷回复将一并删除。`"
      confirm-text="确认删除"
      danger
      @confirm="runConfirmedAction"
      @cancel="confirmAction = null"
    />
  </div>
</template>

<style scoped>
.page-content { padding: 16px; background: #f5f7fb; }
.page-title { margin-bottom: 16px; font-size: 19px; }
.page-title button { padding: 9px 14px; font-size: 13px; border-radius: 10px; }
.channel-list { display: grid; gap: 14px; }
.channel-card { padding: 16px; border: 1px solid #e6ebf2; border-radius: 16px; background: #fff; box-shadow: 0 8px 24px rgba(15, 23, 42, .05); }
.card-header { display: flex; align-items: center; gap: 12px; }
.channel-avatar { width: 44px; height: 44px; flex: 0 0 44px; display: grid; place-items: center; overflow: hidden; border-radius: 13px; color: #fff; font-weight: 700; }
.channel-avatar img { width: 100%; height: 100%; object-fit: cover; }
.channel-heading { min-width: 0; flex: 1; display: grid; gap: 4px; }
.channel-heading strong { overflow: hidden; color: #172033; font-size: 16px; text-overflow: ellipsis; white-space: nowrap; }
.channel-heading span, .card-meta { color: #8490a5; font-size: 12px; }
.status-pill { flex: 0 0 auto; padding: 5px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.status-pill.online { color: #15803d; background: #dcfce7; }
.status-pill.offline { color: #64748b; background: #eef2f6; }
.link-block { margin-top: 14px; display: grid; grid-template-columns: 1fr auto; gap: 7px 10px; padding: 11px 12px; border-radius: 12px; background: #f7f9fc; }
.link-block > span { grid-column: 1 / -1; color: #8490a5; font-size: 11px; }
.link-block code { min-width: 0; overflow: hidden; color: #334155; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.copy-button { padding: 0; border: 0; color: #2563eb; background: transparent; font-size: 13px; font-weight: 600; }
.card-meta { margin-top: 10px; }
.card-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 14px; }
.card-actions button { min-height: 38px; border-radius: 9px; }
.primary-action { border: 1px solid #2563eb; color: #fff; background: #2563eb; }
.action-btn { border: 1px solid #dbe3ee; color: #475569; background: #fff; }
.action-btn.danger { color: #dc2626; }
.state-card { display: grid; justify-items: center; gap: 8px; padding: 42px 20px; border: 1px solid #e6ebf2; border-radius: 16px; color: #8490a5; background: #fff; text-align: center; }
.error-state strong { color: #b91c1c; }
.error-state .action-btn { margin-top: 6px; padding: 8px 16px; }
.modal-box { width: calc(100vw - 32px); max-height: calc(100dvh - 32px); overflow-y: auto; }
</style>
