<!-- 忆梦云团队开发 - 仪表盘 -->
<script setup>
import { ref, onMounted, computed } from 'vue'
import api from '../api'

const loading = ref(true)
const stats = ref({ tenantCount: 0, activeTenants: 0, agentCount: 0, customerCount: 0 })
const recent = ref([])

async function load() {
  loading.value = true
  try {
    const [d, t] = await Promise.all([
      api.get('/admin/dashboard'),
      api.get('/admin/tenants?limit=5'),
    ])
    if (d.code === 0) stats.value = d.data
    if (t.code === 0) recent.value = t.data.items || []
  } catch {}
  loading.value = false
}

onMounted(load)

const statItems = computed(() => [
  { label: '租户总数', value: stats.value.tenantCount, icon: '🏢', cls: 'blue' },
  { label: '活跃租户', value: stats.value.activeTenants, icon: '✅', cls: 'green' },
  { label: '员工总数', value: stats.value.agentCount, icon: '👤', cls: 'yellow' },
  { label: '客户总数', value: stats.value.customerCount, icon: '💬', cls: 'red' },
])

function statusTag(s) {
  return s === 'active'
    ? '<span class="tag tag-green"><span class="dot green"></span>启用中</span>'
    : '<span class="tag tag-red"><span class="dot red"></span>已禁用</span>'
}

function formatDate(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  const now = new Date()
  const diff = (now - d) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前'
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前'
  return d.toLocaleDateString('zh-CN') + ' ' + d.toTimeString().slice(0, 5)
}
</script>

<template>
  <template v-if="loading">
    <div style="padding:40px;text-align:center;color:#94a3b8;">加载中...</div>
  </template>
  <template v-else>
    <!-- Hero -->
    <section class="hero">
      <h2>欢迎回来，管理员 👋</h2>
      <p class="desc">这里是忆梦云客服平台管理中心，您可以管理所有租户、配置套餐和查看运营数据。</p>
      <div class="hero-stats">
        <div class="hero-stat">
          <div class="v">{{ stats.tenantCount }}</div>
          <div class="l">租户总数</div>
        </div>
        <div class="hero-stat">
          <div class="v">{{ stats.activeTenants }}</div>
          <div class="l">活跃租户</div>
        </div>
        <div class="hero-stat">
          <div class="v">{{ stats.agentCount }}</div>
          <div class="l">员工</div>
        </div>
        <div class="hero-stat">
          <div class="v">{{ stats.customerCount }}</div>
          <div class="l">累计客户</div>
        </div>
      </div>
    </section>

    <!-- 统计卡 -->
    <section class="stat-grid">
      <div v-for="s in statItems" :key="s.label" class="stat-card card-interactive">
        <div class="stat-icon" :class="s.cls">{{ s.icon }}</div>
        <div class="stat-info">
          <div class="label">{{ s.label }}</div>
          <div class="value">{{ s.value }}</div>
        </div>
      </div>
    </section>

    <!-- 最近租户 -->
    <section>
      <div class="page-header">
        <h1>最近注册的租户</h1>
        <p class="desc">最近 5 个注册的租户账号</p>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>租户名称</th>
              <th>账号</th>
              <th>邮箱</th>
              <th>状态</th>
              <th>注册时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in recent" :key="t._id">
              <td data-label="租户名称" style="font-weight:600;">{{ t.name }}</td>
              <td data-label="账号">{{ t.username }}</td>
              <td data-label="邮箱">{{ t.email }}</td>
              <td data-label="状态" v-html="statusTag(t.status)"></td>
              <td data-label="注册时间">{{ formatDate(t.createdAt) }}</td>
            </tr>
            <tr v-if="!recent.length">
              <td colspan="5" style="text-align:center;padding:40px;color:#94a3b8;">暂无数据</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>
</template>
