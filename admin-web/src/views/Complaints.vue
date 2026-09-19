<!-- 忆梦云团队开发 - 投诉管理 -->
<script setup>
import { computed, onMounted, ref } from 'vue'
import api from '../api'

const items = ref([])
const total = ref(0)
const page = ref(1)
const limit = 10
const keyword = ref('')
const status = ref('')
const category = ref('')
const loading = ref(false)
const detailLoading = ref(false)
const detail = ref(null)
const notice = ref(null)
const operating = ref(false)
const isSuper = computed(() => {
  try { return JSON.parse(localStorage.getItem('admin_info') || '{}').role === 'super' } catch { return false }
})

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit)))
const statusNames = { pending: '待处理', processing: '处理中', resolved: '已解决' }
const categoryNames = { platform: '平台问题反馈', agent: '投诉客服' }

function showNotice(type, message) {
  notice.value = { type, message }
  window.setTimeout(() => { if (notice.value?.message === message) notice.value = null }, 3000)
}

async function load(reset = false) {
  if (reset) page.value = 1
  loading.value = true
  try {
    const params = new URLSearchParams({ page: String(page.value), limit: String(limit) })
    if (keyword.value.trim()) params.set('keyword', keyword.value.trim())
    if (status.value) params.set('status', status.value)
    if (category.value) params.set('category', category.value)
    const res = await api.get(`/admin/complaints?${params}`)
    if (res.code !== 0) throw new Error(res.message)
    items.value = res.data.items || []
    total.value = res.data.total || 0
    if (!items.value.length && page.value > 1) { page.value -= 1; await load() }
  } catch (error) {
    showNotice('error', error?.message || '投诉列表加载失败')
  } finally {
    loading.value = false
  }
}

async function openDetail(item) {
  detailLoading.value = true
  detail.value = item
  try {
    const res = await api.get(`/admin/complaints/${item._id}`)
    if (res.code !== 0) throw new Error(res.message)
    detail.value = res.data
  } catch (error) {
    detail.value = null
    showNotice('error', error?.message || '投诉详情加载失败')
  } finally {
    detailLoading.value = false
  }
}

async function updateStatus(nextStatus) {
  if (!detail.value || operating.value || detail.value.status === nextStatus) return
  operating.value = true
  try {
    const res = await api.patch(`/admin/complaints/${detail.value._id}/status`, { status: nextStatus })
    if (res.code !== 0) throw new Error(res.message)
    detail.value = res.data
    const row = items.value.find(item => item._id === res.data._id)
    if (row) Object.assign(row, res.data)
    showNotice('success', '投诉状态已更新')
  } catch (error) {
    showNotice('error', error?.message || '状态更新失败')
  } finally {
    operating.value = false
  }
}

function changePage(next) {
  if (next < 1 || next > totalPages.value || next === page.value) return
  page.value = next
  load()
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'
}

function statusClass(value) {
  return { pending: 'tag-yellow', processing: 'tag-blue', resolved: 'tag-green' }[value] || 'tag-gray'
}

onMounted(() => load())
</script>

<template>
  <div class="page-header">
    <h1>投诉管理</h1>
    <p class="desc">查看和处理用户提交的投诉，共 {{ total }} 条</p>
  </div>

  <div v-if="notice" class="complaint-notice" :class="notice.type">{{ notice.message }}</div>

  <div class="toolbar">
    <div class="search"><span class="icon">⌕</span><input v-model="keyword" class="input" placeholder="搜索客户、企业、渠道、标题或内容" @keydown.enter="load(true)" /></div>
    <select v-model="category" class="select filter" @change="load(true)">
      <option value="">全部类型</option><option v-for="(label, value) in categoryNames" :key="value" :value="value">{{ label }}</option>
    </select>
    <select v-model="status" class="select filter" @change="load(true)">
      <option value="">全部状态</option><option v-for="(label, value) in statusNames" :key="value" :value="value">{{ label }}</option>
    </select>
    <button class="btn btn-primary btn-sm" :disabled="loading" @click="load(true)">查询</button>
  </div>

  <div class="table-wrap">
    <table class="table">
      <thead><tr><th>投诉标题</th><th>企业 / 渠道</th><th>类型</th><th>状态</th><th>图片</th><th>提交时间</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="item in items" :key="item._id">
          <td data-label="投诉标题"><strong>{{ item.subject }}</strong></td>
          <td data-label="企业 / 渠道">{{ item.tenantSnapshot?.name || '-' }} / {{ item.channelSnapshot?.name || '-' }}</td>
          <td data-label="类型">{{ categoryNames[item.category] || item.category }}</td>
          <td data-label="状态"><span class="tag" :class="statusClass(item.status)">{{ statusNames[item.status] || item.status }}</span></td>
          <td data-label="图片">{{ item.images?.length || 0 }} 张</td>
          <td data-label="提交时间">{{ formatDate(item.createdAt) }}</td>
          <td data-label="操作"><button class="btn-link" @click="openDetail(item)">查看详情</button></td>
        </tr>
        <tr v-if="loading"><td colspan="7" class="empty">正在加载...</td></tr>
        <tr v-else-if="!items.length"><td colspan="7" class="empty">暂无投诉数据</td></tr>
      </tbody>
    </table>
  </div>

  <div class="pagination">
    <span>第 {{ page }} / {{ totalPages }} 页</span>
    <button class="btn btn-ghost btn-sm" :disabled="loading || page <= 1" @click="changePage(page - 1)">上一页</button>
    <button class="btn btn-ghost btn-sm" :disabled="loading || page >= totalPages" @click="changePage(page + 1)">下一页</button>
  </div>

  <div v-if="detail" class="modal-overlay" @click.self="detail = null">
    <div class="modal detail-modal">
      <div class="modal-header"><h3>投诉详情</h3><button class="close" aria-label="关闭" @click="detail = null">×</button></div>
      <div class="modal-body">
        <div v-if="detailLoading" class="empty">正在加载...</div>
        <template v-else>
          <div class="detail-grid">
            <div><span>投诉类型</span><strong>{{ categoryNames[detail.category] }}</strong></div>
            <div><span>当前状态</span><strong><span class="tag" :class="statusClass(detail.status)">{{ statusNames[detail.status] }}</span></strong></div>
            <div><span>企业</span><strong>{{ detail.tenantSnapshot?.name || '-' }}</strong></div>
            <div><span>客服渠道</span><strong>{{ detail.channelSnapshot?.name || '-' }}（{{ detail.channelSnapshot?.brandName || '-' }}）</strong></div>
            <div><span>企业 ID</span><strong>{{ detail.tenantSnapshot?.id || '-' }}</strong></div>
            <div><span>渠道 ID</span><strong>{{ detail.channelSnapshot?.id || '-' }}</strong></div>
            <div><span>接待客服</span><strong>{{ detail.agentSnapshot?.displayName || '未接待' }}<template v-if="detail.agentSnapshot?.username"> / {{ detail.agentSnapshot.username }}</template></strong></div>
            <div><span>客服 ID</span><strong>{{ detail.agentSnapshot?.id || '-' }}</strong></div>
            <div><span>客户</span><strong>{{ detail.customerSnapshot?.nickname || '-' }} / {{ detail.customerSnapshot?.phone || '-' }}</strong></div>
            <div><span>客户邮箱</span><strong>{{ detail.customerSnapshot?.email || '-' }}</strong></div>
            <div><span>客户 QQ</span><strong>{{ detail.customerSnapshot?.qq || '-' }}</strong></div>
            <div><span>客户绑定 ID</span><strong>{{ detail.customerSnapshot?.id || '-' }}</strong></div>
            <div><span>客户账号 ID</span><strong>{{ detail.customerSnapshot?.accountId || '-' }}</strong></div>
            <div><span>会话 ID</span><strong>{{ detail.conversationId || '-' }}</strong></div>
            <div><span>提交 IP</span><strong>{{ detail.submittedIp || '-' }}</strong></div>
            <div><span>客户端信息</span><strong>{{ detail.userAgent || '-' }}</strong></div>
            <div><span>提交时间</span><strong>{{ formatDate(detail.createdAt) }}</strong></div>
            <div><span>更新时间</span><strong>{{ formatDate(detail.updatedAt) }}</strong></div>
          </div>
          <section><h4>{{ detail.subject }}</h4><p class="content">{{ detail.content }}</p></section>
          <section v-if="detail.images?.length"><h4>相关图片（{{ detail.images.length }}）</h4><div class="image-grid"><a v-for="url in detail.images" :key="url" :href="url" target="_blank" rel="noopener"><img :src="url" alt="投诉图片" /></a></div></section>
        </template>
      </div>
      <div class="modal-footer">
        <select v-if="isSuper" :value="detail.status" class="select status-select" :disabled="operating" @change="updateStatus($event.target.value)"><option v-for="(label, value) in statusNames" :key="value" :value="value">{{ label }}</option></select>
        <span v-else class="readonly-tip">运营管理员仅可查看</span>
        <button class="btn btn-ghost" @click="detail = null">关闭</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.complaint-notice { margin-bottom:16px; padding:12px 14px; border:1px solid #bbf7d0; border-radius:10px; color:#166534; background:#f0fdf4; }
.complaint-notice.error { border-color:#fecaca; color:#991b1b; background:#fef2f2; }
.filter { width:150px; }
.empty { padding:44px !important; text-align:center; color:#94a3b8 !important; }
.pagination { display:flex; align-items:center; justify-content:flex-end; gap:10px; margin-top:16px; color:#64748b; font-size:13px; }
.detail-modal { max-width:720px; }
.close { color:#64748b; font-size:24px; }
.detail-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:14px; margin-bottom:24px; }
.detail-grid div { display:flex; flex-direction:column; gap:4px; padding:12px; border-radius:10px; background:#f8fafc; overflow-wrap:anywhere; }
.detail-grid span { color:#64748b; font-size:12px; }
.detail-grid strong { font-size:14px; }
section + section { margin-top:22px; }
section h4 { margin-bottom:9px; }
.content { margin:0; color:#334155; white-space:pre-wrap; overflow-wrap:anywhere; }
.image-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; }
.image-grid a { aspect-ratio:1; overflow:hidden; border:1px solid #e2e8f0; border-radius:10px; }
.image-grid img { width:100%; height:100%; object-fit:cover; }
.status-select { width:130px; margin-right:auto; }
.readonly-tip { margin-right:auto; align-self:center; color:#94a3b8; font-size:13px; }
@media (max-width:768px) { .filter { flex:1; width:auto; } .detail-grid { grid-template-columns:1fr; } .image-grid { grid-template-columns:repeat(2, 1fr); } }
@media (max-width:480px) { .filter { flex-basis:100%; } .pagination { justify-content:center; } .modal-overlay { align-items:flex-end; padding:10px; } .detail-modal { max-height:calc(100dvh - 20px); } .modal-body { padding:18px; } }
</style>
