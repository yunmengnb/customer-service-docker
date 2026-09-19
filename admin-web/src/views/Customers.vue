<!-- 忆梦云团队开发 - 全局客户管理 -->
<script setup>
import { computed, onMounted, ref } from 'vue'
import api from '../api'

const list = ref([])
const total = ref(0)
const page = ref(1)
const limit = 20
const keyword = ref('')
const statusFilter = ref('')
const loading = ref(false)
const errorMessage = ref('')
const notice = ref(null)
const showEditModal = ref(false)
const editingCustomer = ref(null)
const saving = ref(false)
const editForm = ref({ phone: '', nickname: '', qq: '', email: '', password: '' })

const isSuper = computed(() => {
  try { return JSON.parse(localStorage.getItem('admin_info') || '{}').role === 'super' } catch { return false }
})

const totalPages = computed(() => Math.max(Math.ceil(total.value / limit), 1))
const rangeStart = computed(() => total.value ? (page.value - 1) * limit + 1 : 0)
const rangeEnd = computed(() => Math.min(page.value * limit, total.value))

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const params = new URLSearchParams({ page: String(page.value), limit: String(limit) })
    const trimmedKeyword = keyword.value.trim()
    if (trimmedKeyword) params.set('keyword', trimmedKeyword)
    if (statusFilter.value) params.set('status', statusFilter.value)
    const res = await api.get(`/admin/customers?${params.toString()}`)
    if (res.code === 0) {
      list.value = res.data.items || []
      total.value = res.data.total || 0
    } else {
      errorMessage.value = res.message || '客户数据加载失败'
    }
  } catch (error) {
    errorMessage.value = error?.message || '客户数据加载失败'
  } finally {
    loading.value = false
  }
}

function search() {
  page.value = 1
  load()
}

function changePage(nextPage) {
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value) return
  page.value = nextPage
  load()
}

function formatDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function showNotice(type, message) {
  notice.value = { type, message }
  window.setTimeout(() => {
    if (notice.value?.message === message) notice.value = null
  }, 3000)
}

function openEditModal(customer) {
  editingCustomer.value = customer
  editForm.value = {
    phone: customer.phone || '',
    nickname: customer.nickname || '',
    qq: customer.qq || '',
    email: customer.email || '',
    password: '',
  }
  showEditModal.value = true
}

async function saveCustomer() {
  saving.value = true
  try {
    const payload = {
      phone: editForm.value.phone.trim(),
      nickname: editForm.value.nickname.trim(),
      qq: editForm.value.qq.trim(),
      email: editForm.value.email.trim(),
    }
    if (editForm.value.password) payload.password = editForm.value.password
    const res = await api.patch(`/admin/customers/${editingCustomer.value._id}`, payload)
    if (res.code !== 0) throw new Error(res.message || '保存失败')
    Object.assign(editingCustomer.value, res.data)
    showEditModal.value = false
    editingCustomer.value = null
    showNotice('success', '客户资料已更新')
  } catch (error) {
    showNotice('error', error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleStatus(customer) {
  const status = customer.status === 'active' ? 'disabled' : 'active'
  const label = status === 'active' ? '启用' : '禁用'
  if (!window.confirm(`确认${label}客户「${customer.nickname || customer.phone}」？`)) return
  try {
    const res = await api.patch(`/admin/customers/${customer._id}/status`, { status })
    if (res.code !== 0) throw new Error(res.message || `${label}失败`)
    Object.assign(customer, res.data)
    showNotice('success', `客户已${label}`)
  } catch (error) {
    showNotice('error', error?.message || `${label}失败`)
  }
}

onMounted(load)
</script>

<template>
  <div class="page-header">
    <h1>客户管理</h1>
    <p class="desc">管理平台注册客户账号，支持资料编辑与启停控制</p>
  </div>

  <div v-if="notice" class="customer-notice" :class="notice.type" role="status">{{ notice.message }}</div>

  <div class="toolbar">
    <div class="search">
      <span class="icon">🔍</span>
      <input
        v-model="keyword"
        class="input"
        placeholder="搜索手机号 / 昵称 / QQ / 邮箱"
        @keydown.enter="search"
      />
    </div>
    <select v-model="statusFilter" class="select status-select" @change="search">
      <option value="">全部状态</option>
      <option value="active">正常</option>
      <option value="disabled">已禁用</option>
    </select>
    <button class="btn btn-primary btn-sm" :disabled="loading" @click="search">查询</button>
  </div>

  <div class="table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th>客户</th>
          <th>手机号</th>
          <th>QQ</th>
          <th>邮箱</th>
          <th>状态</th>
          <th>最近登录</th>
          <th>注册时间</th>
          <th v-if="isSuper" style="text-align:right;">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="customer in list" :key="customer._id">
          <td data-label="客户">
            <div class="customer-cell">
              <img v-if="customer.avatarUrl" :src="customer.avatarUrl" alt="" class="customer-avatar" />
              <div v-else class="customer-avatar fallback">{{ (customer.nickname || '?').slice(0, 1) }}</div>
              <div>
                <div class="customer-name">{{ customer.nickname || '访客' }}</div>
                <div class="customer-id">ID: {{ customer._id.slice(-8) }}</div>
              </div>
            </div>
          </td>
          <td data-label="手机号">{{ customer.phone || '-' }}</td>
          <td data-label="QQ">{{ customer.qq || '-' }}</td>
          <td data-label="邮箱">{{ customer.email || '-' }}</td>
          <td data-label="状态">
            <span class="tag" :class="customer.status === 'active' ? 'tag-green' : 'tag-red'">
              <span class="dot" :class="customer.status === 'active' ? 'green' : 'red'"></span>
              {{ customer.status === 'active' ? '正常' : '已禁用' }}
            </span>
          </td>
          <td data-label="最近登录" class="date-cell">{{ formatDate(customer.lastLoginAt) }}</td>
          <td data-label="注册时间" class="date-cell">{{ formatDate(customer.createdAt) }}</td>
          <td data-label="操作" v-if="isSuper" style="text-align:right;">
            <div class="customer-actions">
              <button class="btn-link" @click="openEditModal(customer)">编辑</button>
              <button class="btn-link" :class="{ danger: customer.status === 'active' }" @click="toggleStatus(customer)">{{ customer.status === 'active' ? '禁用' : '启用' }}</button>
            </div>
          </td>
        </tr>
        <tr v-if="loading">
          <td :colspan="isSuper ? 8 : 7" class="empty-cell">正在加载...</td>
        </tr>
        <tr v-else-if="errorMessage">
          <td :colspan="isSuper ? 8 : 7" class="empty-cell error-text">{{ errorMessage }}</td>
        </tr>
        <tr v-else-if="!list.length">
          <td :colspan="isSuper ? 8 : 7" class="empty-cell">暂无客户数据</td>
        </tr>
      </tbody>
    </table>

    <div v-if="total > 0" class="pagination">
      <div class="pagination-info">共 {{ total }} 条，当前显示 {{ rangeStart }}-{{ rangeEnd }} 条</div>
      <div class="pagination-actions">
        <button class="btn btn-ghost btn-sm" :disabled="page === 1 || loading" @click="changePage(page - 1)">上一页</button>
        <span>第 {{ page }} / {{ totalPages }} 页</span>
        <button class="btn btn-ghost btn-sm" :disabled="page === totalPages || loading" @click="changePage(page + 1)">下一页</button>
      </div>
    </div>
  </div>

  <div v-if="showEditModal && editingCustomer" class="modal-overlay" @click.self="showEditModal = false">
    <form class="modal" @submit.prevent="saveCustomer">
      <div class="modal-header">
        <h3>编辑客户</h3>
        <button class="btn-link" type="button" style="padding:4px 8px;" @click="showEditModal = false">✕</button>
      </div>
      <div class="modal-body">
        <div class="input-group"><label>手机号</label><input v-model="editForm.phone" class="input" type="tel" required /></div>
        <div class="input-group"><label>昵称</label><input v-model="editForm.nickname" class="input" maxlength="50" required /></div>
        <div class="input-group"><label>QQ</label><input v-model="editForm.qq" class="input" inputmode="numeric" /></div>
        <div class="input-group"><label>邮箱</label><input v-model="editForm.email" class="input" type="email" /></div>
        <div class="input-group"><label>重置密码</label><input v-model="editForm.password" class="input" type="password" minlength="6" maxlength="72" autocomplete="new-password" placeholder="留空则不修改" /></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" type="button" @click="showEditModal = false">取消</button>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? '保存中...' : '保存修改' }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.status-select { max-width: 140px; }
.customer-cell { display: flex; align-items: center; gap: 10px; }
.customer-avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.customer-avatar.fallback { display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #6366f1, #2563eb); color: #fff; font-weight: 700; }
.customer-name { font-weight: 600; }
.customer-id { margin-top: 2px; color: var(--text-muted); font-size: 11px; }
.date-cell { color: var(--text-sec); font-size: 12px; white-space: nowrap; }
.customer-actions { display: flex; justify-content: flex-end; gap: 4px; }
.customer-notice { margin-bottom: 16px; padding: 11px 14px; border: 1px solid; border-radius: var(--radius-md); font-size: 13px; }
.customer-notice.success { border-color: rgba(16, 185, 129, .3); background: var(--success-soft); color: #047857; }
.customer-notice.error { border-color: rgba(239, 68, 68, .3); background: var(--danger-soft); color: #b91c1c; }
.empty-cell { padding: 48px !important; text-align: center; color: var(--text-muted) !important; }
.error-text { color: var(--danger) !important; }
.pagination { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 18px; border-top: 1px solid var(--border); color: var(--text-sec); font-size: 13px; }
.pagination-actions { display: flex; align-items: center; gap: 12px; }
@media (max-width: 768px) {
  .pagination { align-items: stretch; flex-direction: column; }
  .pagination-actions { justify-content: space-between; }
  .empty-cell { display: block !important; }
  .empty-cell::before { display: none; }
}
</style>
