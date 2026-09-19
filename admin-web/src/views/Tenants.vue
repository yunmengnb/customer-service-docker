<!-- 忆梦云团队开发 - 租户管理 -->
<script setup>
import { ref, onMounted, computed } from 'vue'
import api from '../api'

const list = ref([])
const total = ref(0)
const loading = ref(true)
const keyword = ref('')
const statusFilter = ref('')
const showPlanModal = ref(false)
const showEditModal = ref(false)
const editingTenant = ref(null)
const saving = ref(false)
const plan = ref({ agentLimit: 10, channelLimit: 5 })
const editForm = ref({ name: '', username: '', email: '', qq: '', password: '' })

const isSuper = computed(() => {
  try { return JSON.parse(localStorage.getItem('admin_info') || '{}').role === 'super' } catch { return false }
})

// 轻量 Toast 工具
const toast = (() => ({
  show(type, msg, title) {
    const el = document.createElement('div')
    el.className = `toast ${type === 'error' ? 'error' : type === 'info' ? 'info' : ''}`
    el.innerHTML = `<div class="toast-title">${title || (type === 'error' ? '错误' : '提示')}</div><div class="toast-msg">${msg}</div>`
    document.body.appendChild(el)
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 200) }, 2400)
  },
  success(m) { this.show('success', m, '成功') },
  error(m) { this.show('error', m) },
  info(m) { this.show('info', m) },
}))()

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (keyword.value) params.set('keyword', keyword.value)
    if (statusFilter.value) params.set('status', statusFilter.value)
    const res = await api.get('/admin/tenants?' + params.toString())
    if (res.code === 0) {
      list.value = res.data.items || []
      total.value = res.data.total || 0
    }
  } catch {}
  loading.value = false
}

async function toggleStatus(t) {
  const next = t.status === 'active' ? 'disabled' : 'active'
  const label = next === 'active' ? '启用' : '禁用'
  if (!confirm(`确认${label}租户「${t.name}」？`)) return
  try {
    const res = await api.patch(`/admin/tenants/${t._id}/status`, { status: next })
    if (res.code === 0) {
      t.status = next
      toast.success(`已${label}`)
    } else {
      toast.error(res.message || '操作失败')
    }
  } catch (e) { toast.error(e?.message || '网络错误') }
}

function openEditModal(t) {
  editingTenant.value = t
  editForm.value = {
    name: t.name || '',
    username: t.username || '',
    email: t.email || '',
    qq: t.qq || '',
    password: '',
  }
  showEditModal.value = true
}

async function saveTenant() {
  if (!editForm.value.name.trim() || !editForm.value.username.trim() || !editForm.value.email.trim()) {
    toast.error('请完整填写租户名称、账号和邮箱')
    return
  }
  saving.value = true
  try {
    const payload = {
      name: editForm.value.name.trim(),
      username: editForm.value.username.trim(),
      email: editForm.value.email.trim(),
      qq: editForm.value.qq.trim(),
    }
    if (editForm.value.password) payload.password = editForm.value.password
    const res = await api.patch(`/admin/tenants/${editingTenant.value._id}`, payload)
    if (res.code !== 0) throw new Error(res.message || '保存失败')
    Object.assign(editingTenant.value, res.data)
    showEditModal.value = false
    editingTenant.value = null
    toast.success('租户资料已更新')
  } catch (e) {
    toast.error(e?.message || '网络错误')
  } finally {
    saving.value = false
  }
}

function openPlanModal(t) {
  editingTenant.value = t
  plan.value = {
    agentLimit: t.plan?.agentLimit ?? 10,
    channelLimit: t.plan?.channelLimit ?? 5,
    messageRetentionDays: t.plan?.messageRetentionDays ?? 90,
    attachmentLimitMB: t.plan?.attachmentLimitMB ?? 1024,
  }
  showPlanModal.value = true
}

async function savePlan() {
  try {
    const res = await api.patch(`/admin/tenants/${editingTenant.value._id}/plan`, plan.value)
    if (res.code === 0) {
      editingTenant.value.plan = res.data.plan
      showPlanModal.value = false
      editingTenant.value = null
      toast.success('套餐已更新')
    } else {
      toast.error(res.message || '保存失败')
    }
  } catch (e) { toast.error(e?.message || '网络错误') }
}

function statusTag(s) {
  if (s === 'active') return '<span class="tag tag-green"><span class="dot green"></span>启用中</span>'
  return '<span class="tag tag-red"><span class="dot red"></span>已禁用</span>'
}

onMounted(load)
</script>

<template>
  <div class="page-header">
    <h1>租户管理</h1>
    <p class="desc">管理所有入驻租户，支持套餐配置与启停控制</p>
  </div>

  <!-- 工具栏 -->
  <div class="toolbar">
    <div class="search">
      <span class="icon">🔍</span>
      <input v-model="keyword" class="input" placeholder="搜索租户名称 / 账号 / 邮箱" @keydown.enter="load" />
    </div>
    <select v-model="statusFilter" class="select" style="max-width:140px;" @change="load">
      <option value="">全部状态</option>
      <option value="active">启用中</option>
      <option value="disabled">已禁用</option>
    </select>
    <button class="btn btn-primary btn-sm" @click="load">查询</button>
  </div>

  <!-- 表格 -->
  <div class="table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th>租户</th>
          <th>账号</th>
          <th>邮箱</th>
          <th>套餐</th>
          <th>状态</th>
          <th>注册时间</th>
          <th v-if="isSuper" style="text-align:right;">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in list" :key="t._id">
          <td data-label="租户" style="font-weight:600;">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:34px;height:34px;border-radius:8px;background:linear-gradient(135deg,#6366f1,#2563eb);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;">{{ (t.name || '?').slice(0, 1) }}</div>
              <div>
                {{ t.name }}
                <div style="font-size:12px;color:#94a3b8;margin-top:2px;">ID: {{ t._id.slice(-8) }}</div>
              </div>
            </div>
          </td>
          <td data-label="账号">{{ t.username }}</td>
          <td data-label="邮箱">{{ t.email }}</td>
          <td data-label="套餐">
            <div style="font-size:12px;">
              <div style="color:#475569;">员工 {{ t.plan?.agentLimit ?? '-' }} · 渠道 {{ t.plan?.channelLimit ?? '-' }}</div>
              <div style="color:#94a3b8;">消息保留 {{ t.plan?.messageRetentionDays ?? '-' }} 天</div>
            </div>
          </td>
          <td data-label="状态" v-html="statusTag(t.status)"></td>
          <td data-label="注册时间">
            <div style="font-size:12px;color:#475569;">{{ new Date(t.createdAt).toLocaleDateString('zh-CN') }}</div>
            <div style="font-size:11px;color:#94a3b8;">{{ new Date(t.createdAt).toTimeString().slice(0, 5) }}</div>
          </td>
          <td data-label="操作" v-if="isSuper" style="text-align:right;">
            <div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap;">
              <button class="btn-link" @click="openEditModal(t)">编辑</button>
              <button class="btn-link" @click="openPlanModal(t)">套餐</button>
              <button class="btn-link" :class="{ danger: t.status === 'active' }" @click="toggleStatus(t)">
                {{ t.status === 'active' ? '禁用' : '启用' }}
              </button>
            </div>
          </td>
        </tr>
        <tr v-if="!list.length && !loading">
          <td :colspan="isSuper ? 7 : 6" style="text-align:center;padding:48px;color:#94a3b8;">
            <div style="font-size:42px;margin-bottom:12px;">📭</div>
            暂无租户数据
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- 编辑弹窗 -->
  <div v-if="showEditModal && editingTenant" class="modal-overlay" @click.self="showEditModal = false">
    <form class="modal" @submit.prevent="saveTenant">
      <div class="modal-header">
        <h3>编辑租户</h3>
        <button class="btn-link" type="button" @click="showEditModal = false" style="padding:4px 8px;">✕</button>
      </div>
      <div class="modal-body">
        <div class="input-group"><label>租户名称</label><input v-model="editForm.name" class="input" maxlength="100" required /></div>
        <div class="input-group"><label>登录账号</label><input v-model="editForm.username" class="input" minlength="3" maxlength="50" required /></div>
        <div class="input-group"><label>邮箱</label><input v-model="editForm.email" class="input" type="email" required /></div>
        <div class="input-group"><label>QQ</label><input v-model="editForm.qq" class="input" inputmode="numeric" /></div>
        <div class="input-group"><label>重置密码</label><input v-model="editForm.password" class="input" type="password" minlength="6" maxlength="72" autocomplete="new-password" placeholder="留空则不修改" /></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" type="button" @click="showEditModal = false">取消</button>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? '保存中...' : '保存修改' }}</button>
      </div>
    </form>
  </div>

  <!-- 套餐弹窗 -->
  <div v-if="showPlanModal && editingTenant" class="modal-overlay" @click.self="showPlanModal = false">
    <div class="modal">
      <div class="modal-header">
        <h3>修改租户套餐</h3>
        <button class="btn-link" @click="showPlanModal = false" style="padding:4px 8px;">✕</button>
      </div>
      <div class="modal-body">
        <div style="margin-bottom:18px;padding:12px 14px;background:#f8fafc;border-radius:10px;border:1px solid var(--border);">
          <div style="font-weight:600;color:#0f172a;">{{ editingTenant.name }}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px;">账号 {{ editingTenant.username }} · {{ editingTenant.email }}</div>
        </div>
        <div class="input-group">
          <label>员工数量上限</label>
          <input class="input" type="number" min="1" v-model.number="plan.agentLimit" />
        </div>
        <div class="input-group">
          <label>客服渠道上限</label>
          <input class="input" type="number" min="1" v-model.number="plan.channelLimit" />
        </div>
        <div class="input-group">
          <label>消息保留天数</label>
          <input class="input" type="number" min="7" v-model.number="plan.messageRetentionDays" />
        </div>
        <div class="input-group">
          <label>附件存储上限 (MB)</label>
          <input class="input" type="number" min="100" v-model.number="plan.attachmentLimitMB" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" @click="showPlanModal = false">取消</button>
        <button class="btn btn-primary" @click="savePlan">保存修改</button>
      </div>
    </div>
  </div>
</template>
