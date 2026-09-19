<!-- 忆梦云团队开发 - 桌面端渠道列表独立视图 -->
<script setup>
import { readTenantCache } from '../../api'
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import api from '../../api'
import { buildCustomerServiceUrl, copyText } from '../../clipboard'
import ConfirmDialog from '../../components/ConfirmDialog.vue'
import ChannelDetail from './ChannelDetail.vue'
const user = readTenantCache('tenant_user')
const isAdmin = computed(() => ['owner', 'admin'].includes(user?.role))
const channels = ref([])
const showCreate = ref(false)
const createForm = ref({ name: '', brandName: '', welcomeMessage: '' })
const confirmAction = ref(null)
const configuringId = ref(null)

async function load() {
  const res = await api.get('/tenant/channels')
  if (res.code === 0) channels.value = res.data
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
    window.prompt('自动复制失败，请选择链接并手动复制', url)
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

let previousBodyOverflow = ''
watch(configuringId, (channelId, previousChannelId) => {
  if (channelId && !previousChannelId) {
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  } else if (!channelId && previousChannelId) {
    document.body.style.overflow = previousBodyOverflow
  }
})

function closeConfigOnEscape(event) {
  if (event.key === 'Escape' && configuringId.value) configuringId.value = null
}

onMounted(() => {
  load()
  window.addEventListener('keydown', closeConfigOnEscape)
})
onUnmounted(() => {
  window.removeEventListener('keydown', closeConfigOnEscape)
  document.body.style.overflow = previousBodyOverflow
})
</script>

<template>
  <div class="page-content">
    <div class="page-title">
      <span>授权渠道</span>
      <button v-if="isAdmin" @click="showCreate = true">+ 新建渠道</button>
    </div>
    
    <table class="data-table">
      <thead>
        <tr><th>名称</th><th>品牌</th><th>状态</th><th>客服链接</th><th>创建时间</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="ch in channels" :key="ch._id">
            <td>{{ ch.name }}</td>
            <td>{{ ch.brandName || '-' }}</td>
            <td>
              <span :class="['tag', ch.status === 'online' ? 'tag-green' : 'tag-gray']">
                {{ ch.status === 'online' ? '在线' : '离线' }}
              </span>
            </td>
            <td style="max-width:320px;">
              <code style="font-size:12px;background:#f3f4f6;padding:2px 6px;border-radius:4px;overflow-wrap:anywhere;">{{ ch.link }}</code>
            </td>
            <td>{{ new Date(ch.createdAt).toLocaleDateString() }}</td>
            <td>
              <button class="action-btn" @click="configuringId = ch._id">配置</button>
              <button class="action-btn" @click="copyLink(ch.link)">复制链接</button>
              <button v-if="isAdmin" class="action-btn" @click="toggleStatus(ch)">切{{ ch.status === 'online' ? '离线' : '在线' }}</button>
              <button v-if="isAdmin" class="action-btn danger" @click="confirmAction = { channel: ch }">删除</button>
            </td>
          </tr>
        <tr v-if="channels.length === 0"><td colspan="6" style="text-align:center;color:#9ca3af;padding:40px;">暂无渠道</td></tr>
      </tbody>
    </table>

    <Teleport to="body">
      <div
        v-if="configuringId"
        class="channel-config-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="授权渠道配置"
        @click.self="configuringId = null"
      >
        <div class="channel-config-dialog">
          <ChannelDetail embedded :channel-id="configuringId" @close="configuringId = null" @saved="load" />
        </div>
      </div>
    </Teleport>

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
/* 桌面端配置在独立遮罩中展示，内容区域保持可滚动。 */
.channel-config-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: rgba(15, 23, 42, .48);
  backdrop-filter: blur(6px);
}
.channel-config-dialog {
  width: min(1120px, calc(100vw - 64px));
  height: min(860px, calc(100dvh - 64px));
  max-height: calc(100dvh - 64px);
  overflow: hidden;
  overscroll-behavior: contain;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 24px 80px rgba(15, 23, 42, .24);
}
.channel-config-dialog :deep(.detail-page.embedded) {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  border: 0;
  border-radius: 0;
  background: #fff;
}
@media (max-width: 768px) {
  .channel-config-overlay { align-items: stretch; padding: 0; }
  .channel-config-dialog { width: 100%; height: 100dvh; max-height: none; border-radius: 0; }
  .page-content { padding: 12px; }
  .page-title { margin-bottom: 14px; font-size: 16px; }
  .page-title button { padding: 9px 16px; font-size: 13px; }

  .data-table { display: block; }
  .data-table thead { display: none; }
  .data-table tbody { display: flex; flex-direction: column; gap: 12px; }
  .data-table tbody tr {
    display: flex; flex-direction: column;
    background: #fff; border-radius: 14px; padding: 16px;
    border: 1px solid #e2e8f0;
  }
  .data-table tbody tr:hover td { background: transparent; }
  .data-table td {
    display: flex; justify-content: space-between; align-items: center;
    padding: 6px 0; border-bottom: 1px dashed #f1f5f9;
  }
  .data-table td:last-child { border-bottom: none; padding-top: 12px; gap: 8px; flex-wrap: wrap; }
  .data-table td::before {
    content: attr(data-label); font-size: 12px; color: #94a3b8; font-weight: 500;
    text-transform: uppercase; letter-spacing: .5px;
  }
  .data-table td:last-child::before { display: none; }
  .action-btn { font-size: 13px; padding: 4px 10px; }

  /* 空状态 */
  .data-table tbody tr td[colspan] {
    justify-content: center; padding: 40px 16px;
  }
  .data-table tbody tr td[colspan]::before { display: none; }
}
</style>