<!-- 忆梦云团队开发 - 移动端操作日志 -->
<script setup>
import { onMounted, ref } from 'vue'
import api from '../../api'

const tabs = [
  { key: 'login', label: '登录日志' },
  { key: 'operation', label: '操作日志' },
]

const actionLabels = {
  login: '登录',
  update_profile: '修改个人资料',
  update_email: '修改邮箱',
  update_password: '修改密码',
  employee_create: '新增员工',
  employee_update: '修改员工',
  employee_delete: '删除员工',
  employee_reset_password: '重置员工密码',
  channel_create: '新增渠道',
  channel_update: '修改渠道',
  channel_delete: '删除渠道',
  channel_rotate_token: '更换渠道链接',
  channel_set_agents: '调整渠道坐席',
}

const roleLabels = { owner: '所有者', admin: '管理员', agent: '客服' }

const activeTab = ref('login')
const loading = ref(true)
const loadingMore = ref(false)
const errorMsg = ref('')
const items = ref([])
const total = ref(0)
const page = ref(1)
const limit = 20

async function load(reset = false) {
  if (reset) { page.value = 1; items.value = []; total.value = 0 }
  if (reset) loading.value = true; else loadingMore.value = true
  errorMsg.value = ''
  try {
    const res = await api.get(`/tenant/logs/${activeTab.value}`, { params: { page: page.value, limit } })
    if (res.code !== 0) throw new Error(res.message || '日志加载失败')
    const list = res.data?.items || []
    items.value = reset ? list : [...items.value, ...list]
    total.value = res.data?.total || 0
    page.value = res.data?.page || page.value
  } catch (error) {
    errorMsg.value = error?.message || '日志加载失败'
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function switchTab(key) {
  if (activeTab.value === key) return
  activeTab.value = key
  load(true)
}

function hasMore() {
  return items.value.length < total.value
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false })
}

function actionLabel(action) {
  return actionLabels[action] || action || '-'
}

function roleLabel(role) {
  return roleLabels[role] || role || '-'
}

onMounted(() => load(true))
</script>

<template>
  <section class="logs-page">
    <div class="logs-tabs" role="tablist" aria-label="日志分类">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="logs-tab"
        :class="{ active: activeTab === tab.key }"
        @click="switchTab(tab.key)"
      >{{ tab.label }}</button>
    </div>

    <div v-if="loading" class="logs-state">正在加载日志...</div>
    <div v-else-if="errorMsg" class="logs-state logs-error">{{ errorMsg }}</div>
    <template v-else>
      <div v-if="items.length" class="logs-list">
        <div v-for="item in items" :key="item._id" class="logs-item">
          <div class="logs-item-head">
            <span class="logs-action">{{ actionLabel(item.action) }}</span>
            <span class="logs-result" :class="item.result === 'success' ? 'success' : 'failure'">{{ item.result === 'success' ? '成功' : '失败' }}</span>
          </div>
          <div class="logs-item-title">{{ item.detail || actionLabel(item.action) }}</div>
          <div class="logs-item-meta">
            <span>{{ item.displayName || item.username || '-' }}</span>
            <span v-if="item.username">@{{ item.username }}</span>
            <span>{{ roleLabel(item.role) }}</span>
          </div>
          <div class="logs-item-foot">
            <span>{{ formatDateTime(item.createdAt) }}</span>
            <span class="logs-ip">{{ item.ip || '-' }}</span>
          </div>
        </div>
        <button v-if="hasMore()" class="logs-more" type="button" :disabled="loadingMore" @click="load(false)">{{ loadingMore ? '加载中...' : '加载更多' }}</button>
        <p v-else class="logs-end">共 {{ total }} 条记录</p>
      </div>
      <div v-else class="logs-state">暂无日志记录</div>
    </template>
  </section>
</template>

<style scoped>
.logs-page { min-height: 100%; padding: 14px 14px 28px; background: #f5f6f8; }
.logs-tabs { display: flex; gap: 8px; margin-bottom: 12px; }
.logs-tab { flex: 1; padding: 9px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; color: #475569; font-size: 14px; font-weight: 600; }
.logs-tab.active { border-color: #2563eb; background: #2563eb; color: #fff; }
.logs-list { display: flex; flex-direction: column; gap: 10px; }
.logs-item { padding: 14px; border-radius: 14px; background: #fff; box-shadow: 0 2px 8px rgba(15,23,42,.04); }
.logs-item-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.logs-action { font-size: 14px; font-weight: 600; color: #0f172a; }
.logs-result { padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.logs-result.success { background: #dcfce7; color: #166534; }
.logs-result.failure { background: #fee2e2; color: #991b1b; }
.logs-item-title { margin-bottom: 8px; color: #475569; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.logs-item-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; color: #0f172a; font-size: 13px; }
.logs-item-foot { display: flex; justify-content: space-between; gap: 10px; color: #94a3b8; font-size: 12px; }
.logs-ip { overflow-wrap: anywhere; text-align: right; }
.logs-more { width: 100%; margin-top: 4px; padding: 11px; border: 1px solid #bfdbfe; border-radius: 10px; background: #eff6ff; color: #2563eb; font-size: 13px; font-weight: 600; }
.logs-more:disabled { opacity: .55; }
.logs-end { margin: 8px 0 0; color: #94a3b8; font-size: 12px; text-align: center; }
.logs-state { padding: 60px 20px; text-align: center; color: #64748b; }
.logs-error { color: #b91c1c; }
</style>
