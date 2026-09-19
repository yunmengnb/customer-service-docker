<!-- 忆梦云团队开发 - 公告管理 -->
<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import api from '../api'

const announcements = ref([])
const total = ref(0)
const page = ref(1)
const limit = 10
const loading = ref(false)
const submitting = ref(false)
const operatingId = ref('')
const keyword = ref('')
const statusFilter = ref('')
const showFormModal = ref(false)
const editingAnnouncement = ref(null)
const notice = ref(null)
const form = reactive({ title: '', content: '', status: 'published' })

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit)))
const isEditing = computed(() => Boolean(editingAnnouncement.value))
const isSuper = computed(() => {
  try { return JSON.parse(localStorage.getItem('admin_info') || '{}').role === 'super' } catch { return false }
})

function showNotice(type, message) {
  notice.value = { type, message }
  window.setTimeout(() => {
    if (notice.value?.message === message) notice.value = null
  }, 3000)
}

async function loadAnnouncements(resetPage = false) {
  if (resetPage) page.value = 1
  loading.value = true
  try {
    const params = new URLSearchParams({ page: String(page.value), limit: String(limit) })
    if (keyword.value.trim()) params.set('keyword', keyword.value.trim())
    if (statusFilter.value) params.set('status', statusFilter.value)
    const res = await api.get(`/admin/announcements?${params.toString()}`)
    if (res.code !== 0) throw new Error(res.message || '公告列表加载失败')
    announcements.value = res.data.items || []
    total.value = res.data.total || 0
    if (!announcements.value.length && page.value > 1) {
      page.value -= 1
      await loadAnnouncements()
    }
  } catch (error) {
    showNotice('error', error?.message || '公告列表加载失败')
  } finally {
    loading.value = false
  }
}

function changePage(nextPage) {
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value) return
  page.value = nextPage
  loadAnnouncements()
}

function openCreateModal() {
  editingAnnouncement.value = null
  Object.assign(form, { title: '', content: '', status: 'published' })
  showFormModal.value = true
}

function openEditModal(item) {
  editingAnnouncement.value = item
  Object.assign(form, { title: item.title, content: item.content, status: item.status })
  showFormModal.value = true
}

function closeFormModal() {
  if (submitting.value) return
  showFormModal.value = false
  editingAnnouncement.value = null
}

async function submitAnnouncement() {
  if (submitting.value) return
  submitting.value = true
  try {
    const res = isEditing.value
      ? await api.put(`/admin/announcements/${editingAnnouncement.value._id}`, {
          title: form.title,
          content: form.content,
        })
      : await api.post('/admin/announcements', { ...form })
    if (res.code !== 0) throw new Error(res.message || `${isEditing.value ? '编辑' : '新增'}公告失败`)
    const message = isEditing.value ? '公告更新成功' : '公告创建成功'
    showFormModal.value = false
    editingAnnouncement.value = null
    showNotice('success', message)
    await loadAnnouncements(!isEditing.value)
  } catch (error) {
    showNotice('error', error?.message || `${isEditing.value ? '编辑' : '新增'}公告失败`)
  } finally {
    submitting.value = false
  }
}

async function toggleStatus(item) {
  if (operatingId.value) return
  const nextStatus = item.status === 'published' ? 'draft' : 'published'
  const action = nextStatus === 'published' ? '上架' : '下架'
  if (!window.confirm(`确认${action}公告「${item.title}」？`)) return
  operatingId.value = item._id
  try {
    const res = await api.patch(`/admin/announcements/${item._id}/status`, { status: nextStatus })
    if (res.code !== 0) throw new Error(res.message || `公告${action}失败`)
    Object.assign(item, res.data)
    showNotice('success', `公告已${action}`)
    if (statusFilter.value && statusFilter.value !== nextStatus) await loadAnnouncements()
  } catch (error) {
    showNotice('error', error?.message || `公告${action}失败`)
  } finally {
    operatingId.value = ''
  }
}

async function deleteAnnouncement(item) {
  if (item.key) {
    showNotice('error', '系统内置公告受保护，不能删除')
    return
  }
  if (operatingId.value || !window.confirm(`删除后无法恢复，确认删除公告「${item.title}」？`)) return
  operatingId.value = item._id
  try {
    const res = await api.delete(`/admin/announcements/${item._id}`)
    if (res.code !== 0) throw new Error(res.message || '公告删除失败')
    showNotice('success', '公告删除成功')
    await loadAnnouncements()
  } catch (error) {
    showNotice('error', error?.message || '公告删除失败')
  } finally {
    operatingId.value = ''
  }
}

function formatDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

onMounted(() => loadAnnouncements())
</script>

<template>
  <div class="page-header announcement-heading">
    <div>
      <h1>公告管理</h1>
      <p class="desc">管理面向租户发布的系统公告，共 {{ total }} 条</p>
    </div>
    <button v-if="isSuper" class="btn btn-primary" type="button" @click="openCreateModal">新增公告</button>
  </div>

  <div v-if="notice" class="announcement-notice" :class="notice.type" role="status">{{ notice.message }}</div>

  <div class="toolbar">
    <div class="search">
      <span class="icon" aria-hidden="true">⌕</span>
      <input v-model="keyword" class="input" placeholder="搜索公告标题或内容" @keydown.enter="loadAnnouncements(true)" />
    </div>
    <select v-model="statusFilter" class="select status-filter" @change="loadAnnouncements(true)">
      <option value="">全部状态</option>
      <option value="published">已上架</option>
      <option value="draft">已下架</option>
    </select>
    <button class="btn btn-primary btn-sm" type="button" :disabled="loading" @click="loadAnnouncements(true)">查询</button>
  </div>

  <div class="table-wrap">
    <table class="table">
      <thead><tr><th>公告标题</th><th>内容摘要</th><th>状态</th><th>发布时间</th><th>创建时间</th><th v-if="isSuper" class="action-heading">操作</th></tr></thead>
      <tbody>
        <tr v-for="item in announcements" :key="item._id">
          <td data-label="公告标题">
            <strong>{{ item.title }}</strong>
            <span v-if="item.key" class="protected-label" title="系统内置公告不能删除">系统保护</span>
          </td>
          <td data-label="内容摘要" class="content-cell">{{ item.content }}</td>
          <td data-label="状态"><span class="tag" :class="item.status === 'published' ? 'tag-green' : 'tag-gray'">{{ item.status === 'published' ? '已上架' : '已下架' }}</span></td>
          <td data-label="发布时间">{{ formatDate(item.publishedAt) }}</td>
          <td data-label="创建时间">{{ formatDate(item.createdAt) }}</td>
          <td data-label="操作" v-if="isSuper" class="action-cell">
            <div class="action-list">
              <button class="btn-link" type="button" :disabled="Boolean(operatingId)" @click="openEditModal(item)">编辑</button>
              <button class="btn-link" :class="{ danger: item.status === 'published' }" type="button" :disabled="Boolean(operatingId)" @click="toggleStatus(item)">{{ item.status === 'published' ? '下架' : '上架' }}</button>
              <button class="btn-link danger" type="button" :disabled="Boolean(operatingId) || Boolean(item.key)" :title="item.key ? '系统内置公告不能删除' : '删除公告'" @click="deleteAnnouncement(item)">删除</button>
            </div>
          </td>
        </tr>
        <tr v-if="loading"><td :colspan="isSuper ? 6 : 5" class="empty-cell">正在加载...</td></tr>
        <tr v-else-if="!announcements.length"><td :colspan="isSuper ? 6 : 5" class="empty-cell">暂无公告数据</td></tr>
      </tbody>
    </table>
  </div>

  <div class="pagination">
    <span>第 {{ page }} / {{ totalPages }} 页</span>
    <button class="btn btn-ghost btn-sm" type="button" :disabled="loading || page <= 1" @click="changePage(page - 1)">上一页</button>
    <button class="btn btn-ghost btn-sm" type="button" :disabled="loading || page >= totalPages" @click="changePage(page + 1)">下一页</button>
  </div>

  <div v-if="showFormModal" class="modal-overlay" @click.self="closeFormModal">
    <form class="modal" @submit.prevent="submitAnnouncement">
      <div class="modal-header">
        <div><h3>{{ isEditing ? '编辑公告' : '新增公告' }}</h3><p>{{ isEditing ? '修改后将保留公告当前上下架状态' : '已上架公告将立即展示给租户用户' }}</p></div>
        <button class="modal-close" type="button" aria-label="关闭" :disabled="submitting" @click="closeFormModal">×</button>
      </div>
      <div class="modal-body">
        <div class="input-group"><label for="announcement-title">公告标题</label><input id="announcement-title" v-model.trim="form.title" class="input" maxlength="200" required /></div>
        <div class="input-group"><label for="announcement-content">公告内容</label><textarea id="announcement-content" v-model.trim="form.content" class="textarea" rows="8" required></textarea></div>
        <div v-if="!isEditing" class="input-group"><label for="announcement-status">发布状态</label><select id="announcement-status" v-model="form.status" class="select"><option value="published">立即上架</option><option value="draft">暂不上架</option></select></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" type="button" :disabled="submitting" @click="closeFormModal">取消</button>
        <button class="btn btn-primary" type="submit" :disabled="submitting">{{ submitting ? '提交中...' : (isEditing ? '保存修改' : '确认新增') }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.announcement-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
.announcement-notice { margin-bottom:16px; padding:12px 14px; border:1px solid #bbf7d0; border-radius:10px; color:#166534; background:#f0fdf4; }
.announcement-notice.error { border-color:#fecaca; color:#991b1b; background:#fef2f2; }
.status-filter { width:150px; }
.content-cell { max-width:360px; overflow:hidden; color:#64748b !important; text-overflow:ellipsis; white-space:nowrap; }
.protected-label { display:inline-flex; margin-left:8px; padding:2px 7px; border-radius:999px; color:#1d4ed8; background:#dbeafe; font-size:11px; font-weight:600; vertical-align:middle; }
.action-heading { text-align:right !important; }
.action-cell { text-align:right; }
.action-list { display:flex; justify-content:flex-end; gap:2px; white-space:nowrap; }
.btn-link:disabled { opacity:.45; cursor:not-allowed; }
.empty-cell { padding:44px !important; text-align:center; color:#94a3b8 !important; }
.pagination { display:flex; align-items:center; justify-content:flex-end; gap:10px; margin-top:16px; color:#64748b; font-size:13px; }
.modal-header p { margin:4px 0 0; color:#64748b; font-size:12px; }
.modal-close { border:0; background:transparent; color:#64748b; font-size:24px; cursor:pointer; }
.modal-close:disabled { opacity:.45; cursor:not-allowed; }
.textarea { resize:vertical; }
@media (max-width:768px) { .content-cell { max-width:none; white-space:normal; overflow-wrap:anywhere; text-align:right; } .action-list { flex-wrap:wrap; } }
@media (max-width:576px) { .announcement-heading { align-items:stretch; flex-direction:column; } .announcement-heading .btn, .status-filter { width:100%; } .pagination { justify-content:center; } .modal-overlay { align-items:flex-end; padding:10px; } .modal { max-height:calc(100vh - 20px); overflow-y:auto; } .modal-body { padding:18px; } }
</style>
