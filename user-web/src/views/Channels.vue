<!-- 忆梦云团队开发 - 渠道列表 -->
<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const route = useRoute()
const router = useRouter()
const routePrefix = route.path.startsWith('/m/') ? '/m' : '/desktop'
const channels = ref([])
const showCreate = ref(false)
const createForm = ref({ name: '', brandName: '', welcomeMessage: '' })
const confirmAction = ref(null)

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

function copyLink(link) {
  // 用当前 host，但把端口从 5175 换成 5176（client-web）
  const host = window.location.hostname
  const url = `${window.location.protocol}//${host}:5176${link}`

  const doCopy = (text) => {
    // Clipboard API（HTTPS / localhost）
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text)
    }
    // Fallback：隐藏 textarea + execCommand（HTTP / IP 访问也能用）
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      ta.style.pointerEvents = 'none'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        document.body.removeChild(ta)
        resolve()
      } catch (e) {
        document.body.removeChild(ta)
        reject(e)
      }
    })
  }

  doCopy(url).then(
    () => alert('客服链接已复制:\n' + url),
    (e) => alert('复制失败，请手动复制:\n' + url)
  )
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

onMounted(load)
</script>

<template>
  <div class="page-content">
    <div class="page-title">
      <span>客服渠道</span>
      <button @click="showCreate = true">+ 新建渠道</button>
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
            <code style="font-size:12px;background:#f3f4f6;padding:2px 6px;border-radius:4px;">/c/{{ ch.publicToken?.slice(0, 12) }}...</code>
          </td>
          <td>{{ new Date(ch.createdAt).toLocaleDateString() }}</td>
          <td>
            <button class="action-btn" @click="router.push(`${routePrefix}/channels/${ch._id}`)">配置</button>
            <button class="action-btn" @click="copyLink(ch.link)">复制链接</button>
            <button class="action-btn" @click="toggleStatus(ch)">切{{ ch.status === 'online' ? '离线' : '在线' }}</button>
            <button class="action-btn danger" @click="confirmAction = { type: 'remove', channel: ch }">删除</button>
          </td>
        </tr>
        <tr v-if="channels.length === 0"><td colspan="6" style="text-align:center;color:#9ca3af;padding:40px;">暂无渠道</td></tr>
      </tbody>
    </table>

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
/* 桌面端表格已在全局 style.css 里定义，这里只补手机端卡片化 */
@media (max-width: 768px) {
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
