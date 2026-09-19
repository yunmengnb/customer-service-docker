<!-- 忆梦云团队开发 - 桌面端操作日志 -->
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
    <header class="logs-heading">
      <div><span>账号安全</span><h1>操作日志</h1><p>记录登录与敏感操作的执行时间、账号和来源设备。</p></div>
    </header>

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
      <div v-if="items.length" class="logs-card">
        <table class="logs-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>账号</th>
              <th>类型</th>
              <th>详情</th>
              <th>结果</th>
              <th>IP / 设备</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item._id">
              <td class="logs-time">{{ formatDateTime(item.createdAt) }}</td>
              <td>
                <strong>{{ item.displayName || item.username || '-' }}</strong>
                <span class="logs-sub">{{ item.username ? `@${item.username}` : '' }} {{ roleLabel(item.role) }}</span>
              </td>
              <td>{{ actionLabel(item.action) }}</td>
              <td class="logs-detail">{{ item.detail || '-' }}</td>
              <td>
                <span class="logs-result" :class="item.result === 'success' ? 'success' : 'failure'">{{ item.result === 'success' ? '成功' : '失败' }}</span>
              </td>
              <td class="logs-ip">{{ item.ip || '-' }}<span class="logs-sub">{{ item.userAgent || '-' }}</span></td>
            </tr>
          </tbody>
        </table>
        <div class="logs-footer">
          <button v-if="hasMore()" class="logs-more" type="button" :disabled="loadingMore" @click="load(false)">{{ loadingMore ? '加载中...' : '加载更多' }}</button>
          <span class="logs-total">共 {{ total }} 条记录</span>
        </div>
      </div>
      <div v-else class="logs-state">暂无日志记录</div>
    </template>
  </section>
</template>

<style scoped>
.logs-page { width: min(1080px, 100%); margin: 0 auto; padding-bottom: 24px; }
.logs-heading { margin-bottom: 18px; padding: 28px 30px; border-radius: 20px; background: linear-gradient(135deg, #172554, #2563eb); color: #fff; box-shadow: 0 16px 40px rgba(37,99,235,.2); }
.logs-heading span { font-size: 12px; font-weight: 700; opacity: .75; }
.logs-heading h1 { margin: 5px 0; font-size: 27px; }
.logs-heading p { margin: 0; opacity: .82; }
.logs-tabs { display: flex; gap: 6px; margin-bottom: 14px; }
.logs-tab { padding: 9px 18px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; color: #475569; font-size: 14px; font-weight: 600; cursor: pointer; }
.logs-tab.active { border-color: #2563eb; background: #2563eb; color: #fff; }
.logs-card { overflow: hidden; border: 1px solid #e2e8f0; border-radius: 16px; background: #fff; box-shadow: 0 4px 16px rgba(15,23,42,.05); }
.logs-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.logs-table th { padding: 12px 14px; background: #f8fafc; color: #64748b; font-weight: 600; text-align: left; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
.logs-table td { padding: 12px 14px; border-bottom: 1px solid #f1f5f9; color: #0f172a; vertical-align: top; }
.logs-table tbody tr:last-child td { border-bottom: none; }
.logs-time { white-space: nowrap; color: #475569; }
.logs-sub { display: block; margin-top: 2px; color: #94a3b8; font-size: 11px; }
.logs-detail { max-width: 260px; overflow-wrap: anywhere; }
.logs-ip { max-width: 240px; overflow-wrap: anywhere; color: #475569; }
.logs-result { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.logs-result.success { background: #dcfce7; color: #166534; }
.logs-result.failure { background: #fee2e2; color: #991b1b; }
.logs-footer { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-top: 1px solid #f1f5f9; }
.logs-more { padding: 8px 18px; border: 1px solid #bfdbfe; border-radius: 9px; background: #eff6ff; color: #2563eb; font-size: 13px; font-weight: 600; cursor: pointer; }
.logs-more:disabled { opacity: .55; }
.logs-total { color: #64748b; font-size: 12px; }
.logs-state { padding: 60px 20px; text-align: center; color: #64748b; }
.logs-error { color: #b91c1c; }

@media (max-width: 768px) {
  .logs-heading { padding: 20px; }
  .logs-heading h1 { font-size: 22px; }
  .logs-card { overflow-x: auto; }
  .logs-table { min-width: 720px; }
}
</style>
