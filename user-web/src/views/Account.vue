<!-- 忆梦云团队开发 - 企业套餐与用量 -->
<script setup>
import { computed, onMounted, ref } from 'vue'
import api from '../api'

const loading = ref(true)
const errorMessage = ref('')
const overview = ref(null)
const transactions = ref([])

const membershipLabels = {
  active: '正常',
  expired: '已到期',
  suspended: '已暂停',
}
const tenantStatusLabels = {
  active: '正常',
  trial: '试用',
  disabled: '已禁用',
}
const transactionTypeLabels = {
  grant: '发放',
  consume: '消耗',
  refund: '退还',
  adjust: '调整',
  expire: '过期',
}

const quotaItems = computed(() => {
  const usage = overview.value?.usage
  if (!usage) return []
  return [
    { key: 'employees', label: '员工席位', detail: `${formatNumber(usage.employees?.used)} / ${formatNumber(usage.employees?.limit)}`, percent: usage.employees?.percent || 0 },
    { key: 'channels', label: '授权渠道', detail: `${formatNumber(usage.channels?.used)} / ${formatNumber(usage.channels?.limit)}`, percent: usage.channels?.percent || 0 },
    { key: 'attachments', label: '附件空间', detail: `${formatStorage(usage.attachments?.usedBytes)} / ${formatStorage(usage.attachments?.limitBytes)}`, percent: usage.attachments?.percent || 0 },
  ]
})

const countItems = computed(() => {
  const usage = overview.value?.usage
  if (!usage) return []
  return [
    { key: 'customers', label: '客户绑定', value: usage.customers?.count },
    { key: 'conversations', label: '会话', value: usage.conversations?.count },
    { key: 'messages', label: '消息', value: usage.messages?.count },
    { key: 'keywords', label: '关键词回复', value: usage.keywords?.count },
    { key: 'quickReplies', label: '快捷回复', value: usage.quickReplies?.count },
  ]
})

async function loadAccount() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [overviewRes, transactionsRes] = await Promise.all([
      api.get('/tenant/account/overview'),
      api.get('/tenant/account/points/transactions', { params: { limit: 10, page: 1 } }),
    ])
    if (overviewRes.code !== 0) throw new Error(overviewRes.message || '账户信息加载失败')
    if (transactionsRes.code !== 0) throw new Error(transactionsRes.message || '积分流水加载失败')
    overview.value = overviewRes.data
    transactions.value = transactionsRes.data?.items || []
  } catch (error) {
    errorMessage.value = error?.message || '账户信息加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function formatNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '0'
}

function formatStorage(bytes) {
  const value = Number(bytes) || 0
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
  return `${(value / 1024 / 1024).toFixed(value ? 2 : 0)} MB`
}

function formatDate(value, withTime = false) {
  if (!value) return '长期有效'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', withTime
    ? { hour12: false }
    : { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function membershipLabel(status) {
  return membershipLabels[status] || status || '-'
}

function tenantStatusLabel(status) {
  return tenantStatusLabels[status] || status || '-'
}

function transactionTypeLabel(type) {
  return transactionTypeLabels[type] || type || '-'
}

onMounted(loadAccount)
</script>

<template>
  <section class="account-page">
    <header class="account-heading">
      <div>
        <span>企业账户</span>
        <h1>企业套餐与用量</h1>
        <p>查看当前会员、套餐资源、业务规模与积分变动。</p>
      </div>
      <button v-if="!loading" class="refresh-button" type="button" @click="loadAccount">刷新数据</button>
    </header>

    <div v-if="loading" class="state-card" aria-live="polite">
      <div class="loading-ring"></div>
      <strong>正在加载企业账户</strong>
      <span>请稍候</span>
    </div>

    <div v-else-if="errorMessage" class="state-card error-state" role="alert">
      <strong>加载失败</strong>
      <span>{{ errorMessage }}</span>
      <button type="button" @click="loadAccount">重新加载</button>
    </div>

    <template v-else-if="overview">
      <div class="summary-grid">
        <article class="summary-card company-card">
          <span class="summary-label">企业</span>
          <strong>{{ overview.tenant?.name || '-' }}</strong>
          <p>{{ overview.tenant?.username || '-' }}</p>
          <span class="status-chip tenant-status">{{ tenantStatusLabel(overview.tenant?.status) }}</span>
        </article>
        <article class="summary-card">
          <span class="summary-label">会员状态</span>
          <strong>{{ membershipLabel(overview.membership?.status) }}</strong>
          <p>到期时间：{{ formatDate(overview.membership?.expiresAt) }}</p>
          <span class="status-chip" :class="`membership-${overview.membership?.status}`">{{ membershipLabel(overview.membership?.status) }}</span>
        </article>
        <article class="summary-card plan-card">
          <span class="summary-label">当前套餐</span>
          <strong>{{ overview.plan?.name || overview.plan?.code || '-' }}</strong>
          <p>消息保留 {{ formatNumber(overview.plan?.messageRetentionDays) }} 天</p>
          <span class="plan-code">{{ overview.plan?.code || '未设置' }}</span>
        </article>
        <article class="summary-card points-card">
          <span class="summary-label">可用积分</span>
          <strong>{{ formatNumber(overview.points?.balance) }}</strong>
          <p>最近积分变动见下方流水</p>
        </article>
      </div>

      <div class="content-grid">
        <article class="panel quota-panel">
          <div class="panel-heading"><div><h2>资源用量</h2><p>员工、渠道与附件空间使用情况</p></div></div>
          <div class="quota-list">
            <div v-for="item in quotaItems" :key="item.key" class="quota-item">
              <div class="quota-title"><span>{{ item.label }}</span><strong>{{ item.detail }}</strong></div>
              <div class="progress-track" role="progressbar" :aria-label="item.label" :aria-valuenow="item.percent" aria-valuemin="0" aria-valuemax="100">
                <span :class="{ warning: item.percent >= 80 }" :style="{ width: `${Math.min(100, Math.max(0, item.percent))}%` }"></span>
              </div>
              <div class="quota-percent">已使用 {{ item.percent }}%</div>
            </div>
          </div>
        </article>

        <article class="panel scale-panel">
          <div class="panel-heading"><div><h2>业务数据</h2><p>当前企业累计业务数量</p></div></div>
          <div class="count-grid">
            <div v-for="item in countItems" :key="item.key" class="count-item">
              <strong>{{ formatNumber(item.value) }}</strong>
              <span>{{ item.label }}</span>
            </div>
          </div>
        </article>
      </div>

      <article class="panel transactions-panel">
        <div class="panel-heading"><div><h2>最近积分流水</h2><p>最近 10 条积分变动记录</p></div></div>
        <div v-if="transactions.length" class="transaction-table-wrap">
          <table class="transaction-table">
            <thead><tr><th>类型</th><th>说明</th><th>积分变动</th><th>变动后余额</th><th>时间</th></tr></thead>
            <tbody>
              <tr v-for="item in transactions" :key="item._id">
                <td data-label="类型"><span class="transaction-type">{{ transactionTypeLabel(item.type) }}</span></td>
                <td data-label="说明" class="reason-cell">{{ item.reason || '-' }}</td>
                <td data-label="积分变动" :class="['delta-cell', Number(item.delta) >= 0 ? 'positive' : 'negative']">{{ Number(item.delta) >= 0 ? '+' : '' }}{{ formatNumber(item.delta) }}</td>
                <td data-label="变动后余额">{{ formatNumber(item.balanceAfter) }}</td>
                <td data-label="时间">{{ formatDate(item.createdAt, true) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="empty-state"><strong>暂无积分流水</strong><span>积分发生变动后，记录会显示在这里。</span></div>
      </article>
    </template>
  </section>
</template>

<style scoped>
.account-page { width: 100%; max-width: 1280px; margin: 0 auto; padding: 28px 30px 40px; box-sizing: border-box; }
.account-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
.account-heading span { color: #2563eb; font-size: 12px; font-weight: 700; letter-spacing: .12em; }
.account-heading h1 { margin: 6px 0 7px; color: #0f172a; font-size: 28px; line-height: 1.25; }
.account-heading p, .panel-heading p { margin: 0; color: #64748b; font-size: 14px; }
.refresh-button, .state-card button { border: 1px solid #cbd5e1; border-radius: 9px; background: #fff; color: #334155; padding: 9px 15px; font-weight: 600; cursor: pointer; }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.summary-card, .panel, .state-card { border: 1px solid #e2e8f0; border-radius: 16px; background: #fff; box-shadow: 0 8px 25px rgba(15, 23, 42, .05); }
.summary-card { position: relative; min-height: 145px; padding: 20px; box-sizing: border-box; overflow: hidden; }
.summary-label { color: #64748b; font-size: 13px; }
.summary-card > strong { display: block; margin-top: 12px; color: #0f172a; font-size: 25px; line-height: 1.25; overflow-wrap: anywhere; }
.summary-card p { margin: 8px 0 0; color: #64748b; font-size: 13px; }
.company-card { background: linear-gradient(140deg, #eff6ff, #fff 65%); }
.points-card { color: #fff; border: none; background: linear-gradient(135deg, #2563eb, #1e40af); }
.points-card .summary-label, .points-card p { color: #dbeafe; }
.points-card > strong { color: #fff; font-size: 32px; }
.status-chip, .plan-code { position: absolute; top: 18px; right: 18px; padding: 4px 9px; border-radius: 999px; background: #ecfdf5; color: #047857; font-size: 11px; font-weight: 700; }
.membership-expired, .membership-suspended { background: #fff1f2; color: #be123c; }
.tenant-status { background: #eff6ff; color: #1d4ed8; }
.plan-code { background: #f1f5f9; color: #475569; text-transform: uppercase; }
.content-grid { display: grid; grid-template-columns: 1.15fr .85fr; gap: 16px; margin-top: 16px; }
.panel { padding: 22px; }
.panel-heading { display: flex; justify-content: space-between; margin-bottom: 20px; }
.panel-heading h2 { margin: 0 0 5px; color: #0f172a; font-size: 18px; }
.quota-list { display: grid; gap: 20px; }
.quota-title { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 9px; color: #334155; font-size: 14px; }
.quota-title strong { color: #0f172a; }
.progress-track { height: 8px; overflow: hidden; border-radius: 999px; background: #e8eef7; }
.progress-track span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #3b82f6, #2563eb); transition: width .3s ease; }
.progress-track span.warning { background: linear-gradient(90deg, #f59e0b, #ea580c); }
.quota-percent { margin-top: 6px; text-align: right; color: #94a3b8; font-size: 11px; }
.count-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.count-item { padding: 16px; border-radius: 12px; background: #f8fafc; }
.count-item strong { display: block; color: #0f172a; font-size: 23px; }
.count-item span { display: block; margin-top: 4px; color: #64748b; font-size: 12px; }
.count-item:last-child { grid-column: 1 / -1; }
.transactions-panel { margin-top: 16px; }
.transaction-table-wrap { overflow-x: auto; }
.transaction-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.transaction-table th { padding: 11px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b; text-align: left; font-weight: 600; white-space: nowrap; }
.transaction-table td { padding: 14px 12px; border-bottom: 1px solid #f1f5f9; color: #334155; }
.transaction-table tbody tr:last-child td { border-bottom: 0; }
.transaction-type { display: inline-block; padding: 3px 8px; border-radius: 6px; background: #f1f5f9; color: #475569; font-weight: 600; }
.reason-cell { min-width: 180px; }
.delta-cell { font-weight: 700; white-space: nowrap; }
.delta-cell.positive { color: #059669; }
.delta-cell.negative { color: #dc2626; }
.state-card { min-height: 300px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: #64748b; }
.state-card strong, .empty-state strong { color: #0f172a; font-size: 16px; }
.loading-ring { width: 28px; height: 28px; margin-bottom: 6px; border: 3px solid #dbeafe; border-top-color: #2563eb; border-radius: 50%; animation: spin .8s linear infinite; }
.error-state span { max-width: 420px; text-align: center; }
.error-state button { margin-top: 8px; border-color: #2563eb; color: #2563eb; }
.empty-state { min-height: 130px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; color: #94a3b8; font-size: 13px; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 1050px) {
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 768px) {
  .account-page { padding: 14px 12px 28px; }
  .account-heading { align-items: flex-start; margin-bottom: 14px; }
  .account-heading > div > span, .account-heading h1 { display: none; }
  .account-heading p { font-size: 13px; line-height: 1.6; }
  .refresh-button { flex-shrink: 0; padding: 7px 11px; font-size: 12px; }
  .summary-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
  .summary-card { min-height: 130px; padding: 15px; border-radius: 13px; }
  .summary-card > strong { margin-top: 10px; font-size: 19px; }
  .points-card > strong { font-size: 26px; }
  .summary-card p { max-width: 90%; font-size: 11px; line-height: 1.5; }
  .status-chip, .plan-code { top: 12px; right: 12px; padding: 3px 7px; }
  .content-grid { grid-template-columns: 1fr; gap: 10px; margin-top: 10px; }
  .panel { padding: 16px; border-radius: 13px; }
  .panel-heading { margin-bottom: 16px; }
  .panel-heading h2 { font-size: 16px; }
  .panel-heading p { font-size: 12px; }
  .transactions-panel { margin-top: 10px; }
  .transaction-table, .transaction-table tbody, .transaction-table tr, .transaction-table td { display: block; }
  .transaction-table thead { display: none; }
  .transaction-table tr { padding: 13px 0; border-bottom: 1px solid #e2e8f0; }
  .transaction-table tr:last-child { border-bottom: 0; }
  .transaction-table td { display: flex; justify-content: space-between; gap: 16px; padding: 5px 0; border: 0; text-align: right; }
  .transaction-table td::before { content: attr(data-label); flex-shrink: 0; color: #94a3b8; font-weight: 400; }
  .reason-cell { min-width: 0; }
  .state-card { min-height: 240px; border-radius: 13px; }
}
@media (max-width: 390px) {
  .summary-grid { grid-template-columns: 1fr; }
  .summary-card { min-height: 118px; }
}
</style>
