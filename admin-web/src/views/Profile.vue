<!-- 忆梦云团队开发 - 管理员资料修改 -->
<script setup>
import { onMounted, reactive, ref } from 'vue'
import api from '../api'

const loading = ref(true)
const saving = ref(false)
const uploading = ref(false)
const notice = ref(null)
const form = reactive({ username: '', email: '', avatarUrl: '', currentPassword: '', newPassword: '', confirmPassword: '' })

function showNotice(type, message) {
  notice.value = { type, message }
  window.setTimeout(() => { if (notice.value?.message === message) notice.value = null }, 3000)
}

function applyAdmin(admin) {
  Object.assign(form, {
    username: admin?.username || '', email: admin?.email || '', avatarUrl: admin?.avatarUrl || '',
    currentPassword: '', newPassword: '', confirmPassword: '',
  })
}

async function loadProfile() {
  loading.value = true
  try {
    const res = await api.get('/admin/auth/me')
    if (res.code !== 0) throw new Error(res.message || '资料加载失败')
    applyAdmin(res.data)
    localStorage.setItem('admin_info', JSON.stringify(res.data))
    window.dispatchEvent(new CustomEvent('admin-profile-updated', { detail: res.data }))
  } catch (error) {
    showNotice('error', error?.message || '资料加载失败')
  } finally {
    loading.value = false
  }
}

async function uploadAvatar(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) return showNotice('error', '请选择图片文件')
  if (file.size > 5 * 1024 * 1024) return showNotice('error', '头像不能超过 5MB')
  uploading.value = true
  try {
    const data = new FormData()
    data.append('file', file)
    const res = await api.upload('/upload/admin', data)
    if (res.code !== 0 || !res.data?.url) throw new Error(res.message || '上传失败')
    form.avatarUrl = res.data.url
    showNotice('success', '头像上传成功，保存资料后生效')
  } catch (error) {
    showNotice('error', error?.message || '头像上传失败')
  } finally {
    uploading.value = false
  }
}

async function saveProfile() {
  if (saving.value) return
  if (form.username.trim().length < 3) return showNotice('error', '管理员账号至少 3 位')
  if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return showNotice('error', '请输入正确的邮箱')
  if (form.newPassword && form.newPassword.length < 6) return showNotice('error', '新密码至少 6 位')
  if (form.newPassword !== form.confirmPassword) return showNotice('error', '两次输入的新密码不一致')
  if (form.newPassword && !form.currentPassword) return showNotice('error', '修改密码时请输入当前密码')

  saving.value = true
  try {
    const res = await api.patch('/admin/auth/profile', {
      username: form.username.trim(), email: form.email.trim(), avatarUrl: form.avatarUrl,
      currentPassword: form.currentPassword, newPassword: form.newPassword,
    })
    if (res.code !== 0) throw new Error(res.message || '保存失败')
    localStorage.setItem('admin_token', res.data.token)
    localStorage.setItem('admin_info', JSON.stringify(res.data.admin))
    applyAdmin(res.data.admin)
    window.dispatchEvent(new CustomEvent('admin-profile-updated', { detail: res.data.admin }))
    showNotice('success', '管理员资料已保存')
  } catch (error) {
    showNotice('error', error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(loadProfile)
</script>

<template>
  <div class="page-header"><h1>个人资料</h1><p class="desc">维护管理员账号、邮箱、头像与登录密码</p></div>
  <div v-if="notice" class="profile-notice" :class="notice.type" role="status">{{ notice.message }}</div>
  <div v-if="loading" class="profile-state">正在加载...</div>
  <form v-else class="profile-grid" @submit.prevent="saveProfile">
    <section class="card profile-card">
      <h2>基本资料</h2><p>账号与头像会显示在管理后台导航中。</p>
      <div class="avatar-editor">
        <div class="profile-avatar"><img v-if="form.avatarUrl" :src="form.avatarUrl" alt="管理员头像" /><span v-else>{{ (form.username || 'A').slice(0, 1).toUpperCase() }}</span></div>
        <div class="avatar-actions"><label class="btn btn-ghost">{{ uploading ? '上传中...' : '上传头像' }}<input type="file" accept="image/*" :disabled="uploading" hidden @change="uploadAvatar" /></label><button v-if="form.avatarUrl" type="button" class="btn-link danger" @click="form.avatarUrl = ''">移除</button><small>支持 JPG、PNG、GIF、WebP，建议不超过 5MB</small></div>
      </div>
      <div class="input-group"><label for="admin-username">管理员账号</label><input id="admin-username" v-model="form.username" class="input" maxlength="50" autocomplete="username" required /></div>
      <div class="input-group"><label for="admin-email">邮箱</label><input id="admin-email" v-model="form.email" class="input" maxlength="120" type="email" autocomplete="email" required /></div>
    </section>
    <section class="card profile-card">
      <h2>修改密码</h2><p>不修改密码时，下列输入框保持为空。</p>
      <div class="input-group"><label for="current-password">当前密码</label><input id="current-password" v-model="form.currentPassword" class="input" type="password" autocomplete="current-password" /></div>
      <div class="input-group"><label for="new-password">新密码</label><input id="new-password" v-model="form.newPassword" class="input" type="password" minlength="6" maxlength="72" autocomplete="new-password" /></div>
      <div class="input-group"><label for="confirm-password">确认新密码</label><input id="confirm-password" v-model="form.confirmPassword" class="input" type="password" autocomplete="new-password" /></div>
    </section>
    <div class="profile-actions"><button type="submit" class="btn btn-primary" :disabled="saving || uploading">{{ saving ? '保存中...' : '保存修改' }}</button></div>
  </form>
</template>

<style scoped>
.profile-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:20px; }
.profile-card { padding:24px; }
.profile-card h2 { font-size:17px; }
.profile-card > p { margin:5px 0 22px; color:var(--text-sec); font-size:13px; }
.avatar-editor { display:flex; align-items:center; gap:18px; margin-bottom:24px; padding:16px; border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--bg-soft); }
.profile-avatar { display:grid; width:76px; height:76px; flex:0 0 76px; overflow:hidden; border-radius:50%; background:linear-gradient(135deg,#6366f1,#2563eb); color:#fff; font-size:26px; font-weight:800; place-items:center; }
.profile-avatar img { width:100%; height:100%; object-fit:cover; }
.avatar-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }.avatar-actions small { flex-basis:100%; color:var(--text-muted); }
.profile-actions { grid-column:1/-1; display:flex; justify-content:flex-end; }
.profile-notice { margin-bottom:16px; padding:12px 14px; border:1px solid #bbf7d0; border-radius:10px; background:#f0fdf4; color:#166534; }.profile-notice.error { border-color:#fecaca; background:#fef2f2; color:#991b1b; }
.profile-state { padding:48px; text-align:center; color:var(--text-muted); }
@media (max-width:768px) { .profile-grid { grid-template-columns:1fr; }.profile-card { padding:18px; }.profile-actions { position:sticky; bottom:10px; }.profile-actions .btn { width:100%; min-height:44px; } }
@media (max-width:390px) { .avatar-editor { align-items:flex-start; }.profile-avatar { width:64px; height:64px; flex-basis:64px; }.avatar-actions { align-items:stretch; flex:1; }.avatar-actions .btn { width:100%; } }
</style>
