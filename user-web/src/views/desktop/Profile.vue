<!-- 忆梦云团队开发 - 电脑端用户资料管理 -->
<script setup>
import { readTenantCache } from '../../api'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../../api'
import { clearIdentityCache, tenantIdentityScope } from '../../chatCache'

const router = useRouter()
const loading = ref(true)
const saving = ref(false)
const uploading = ref(false)
const sendingCode = ref('')
const notice = ref(null)
const form = reactive({ displayName: '', avatarUrl: '', username: '', role: '' })
const tenant = reactive({ email: '', qq: '' })
const emailForm = reactive({ email: '', emailCode: '' })
const passwordForm = reactive({ currentPassword: '', newPassword: '', confirmPassword: '', emailCode: '' })
const isOwner = computed(() => form.role === 'owner')

function showNotice(type, message) {
  notice.value = { type, message }
  window.setTimeout(() => { if (notice.value?.message === message) notice.value = null }, 2800)
}

function persist(data) {
  const storage = sessionStorage.getItem('tenant_token') ? sessionStorage : localStorage
  if (data?.token) storage.setItem('tenant_token', data.token)
  if (data?.user) {
    storage.setItem('tenant_user', JSON.stringify(data.user))
    Object.assign(form, data.user)
    window.dispatchEvent(new CustomEvent('tenant-profile-updated', { detail: data.user }))
  }
  if (data?.tenant) {
    storage.setItem('tenant_info', JSON.stringify(data.tenant))
    Object.assign(tenant, data.tenant)
    emailForm.email = data.tenant.email || ''
  }
}

async function loadProfile() {
  loading.value = true
  try {
    const res = await api.get('/tenant/auth/me')
    if (res.code !== 0 || !res.data?.user) throw new Error(res.message || '资料加载失败')
    persist(res.data)
  } catch (error) {
    showNotice('error', error?.message || '资料加载失败')
  } finally { loading.value = false }
}

async function uploadAvatar(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) return showNotice('error', '请选择图片文件')
  if (file.size > 5 * 1024 * 1024) return showNotice('error', '图片不能超过 5MB')
  uploading.value = true
  try {
    const data = new FormData(); data.append('file', file)
    const res = await api.upload('/upload/tenant', data)
    if (res.code !== 0 || !res.data?.url) throw new Error(res.message || '上传失败')
    form.avatarUrl = res.data.url
    showNotice('success', '头像上传成功，保存后生效')
  } catch (error) { showNotice('error', error?.message || '头像上传失败')
  } finally { uploading.value = false }
}

async function saveProfile() {
  const displayName = form.displayName.trim()
  const qq = tenant.qq.trim()
  if (!displayName) return showNotice('error', '昵称不能为空')
  if (qq && !/^[1-9]\d{4,11}$/.test(qq)) return showNotice('error', 'QQ号格式不正确')
  saving.value = true
  try {
    const res = await api.patch('/tenant/auth/profile', { displayName, avatarUrl: form.avatarUrl.trim(), ...(isOwner.value ? { qq } : {}) })
    if (res.code !== 0) throw new Error(res.message || '保存失败')
    persist(res.data)
    showNotice('success', '资料已保存')
  } catch (error) { showNotice('error', error?.message || '保存失败')
  } finally { saving.value = false }
}

async function sendEmailCode(purpose) {
  sendingCode.value = purpose
  try {
    const payload = { purpose }
    if (purpose === 'change-email') payload.email = emailForm.email
    const res = await api.post('/tenant/auth/profile/email-code', payload)
    if (res.code !== 0) throw new Error(res.message || '验证码发送失败')
    showNotice('success', res.message || '验证码已发送')
  } catch (error) { showNotice('error', error?.message || '验证码发送失败')
  } finally { sendingCode.value = '' }
}

async function updateEmail() {
  saving.value = true
  try {
    const res = await api.patch('/tenant/auth/profile/email', emailForm)
    if (res.code !== 0) throw new Error(res.message || '邮箱修改失败')
    tenant.email = res.data.email
    emailForm.emailCode = ''
    const storage = sessionStorage.getItem('tenant_token') ? sessionStorage : localStorage
    storage.setItem('tenant_info', JSON.stringify({ ...readTenantCache('tenant_info', {}), ...res.data }))
    showNotice('success', res.message)
  } catch (error) { showNotice('error', error?.message || '邮箱修改失败')
  } finally { saving.value = false }
}

async function updatePassword() {
  saving.value = true
  try {
    const res = await api.patch('/tenant/auth/profile/password', passwordForm)
    if (res.code !== 0) throw new Error(res.message || '密码修改失败')
    await clearIdentityCache(tenantIdentityScope())
    for (const storage of [sessionStorage, localStorage]) {
      storage.removeItem('tenant_token'); storage.removeItem('tenant_user'); storage.removeItem('tenant_info')
    }
    router.replace({ path: '/login', query: { reset: '1' } })
  } catch (error) { showNotice('error', error?.message || '密码修改失败')
  } finally { saving.value = false }
}

onMounted(loadProfile)
</script>

<template>
  <section class="profile-page">
    <header class="profile-heading"><div><span>账号设置</span><h1>个人资料</h1><p>维护个人资料与租户账号安全信息。</p></div></header>
    <div v-if="notice" class="profile-notice" :class="notice.type" role="status">{{ notice.message }}</div>
    <div v-if="loading" class="profile-state">正在加载...</div>
    <template v-else>
      <form class="profile-card" @submit.prevent="saveProfile">
        <div class="avatar-section"><div class="avatar-preview"><img v-if="form.avatarUrl" :src="form.avatarUrl" alt="用户头像" /><span v-else>{{ (form.displayName || form.username || '?').slice(0, 1).toUpperCase() }}</span></div><div><h2>个人头像</h2><p>支持常见图片格式，建议不超过 5MB。</p><div class="avatar-actions"><label class="secondary-btn">{{ uploading ? '上传中...' : '选择图片' }}<input type="file" accept="image/*" :disabled="uploading" hidden @change="uploadAvatar" /></label><button v-if="form.avatarUrl" type="button" class="link-danger" @click="form.avatarUrl = ''">移除头像</button></div></div></div>
        <div class="form-grid">
          <label><span>登录账号</span><input :value="form.username" disabled /></label>
          <label><span>账号角色</span><input :value="({ owner: '所有者', admin: '管理员', agent: '员工' })[form.role] || form.role" disabled /></label>
          <label class="wide"><span>显示昵称</span><input v-model="form.displayName" maxlength="50" required /></label>
          <label v-if="isOwner" class="wide"><span>QQ</span><input v-model.trim="tenant.qq" maxlength="12" inputmode="numeric" placeholder="请输入QQ号" /></label>
        </div>
        <footer><button type="submit" :disabled="saving || uploading">{{ saving ? '保存中...' : '保存基本资料' }}</button></footer>
      </form>

      <form v-if="isOwner" class="profile-card security-card" @submit.prevent="updateEmail">
        <div class="section-title"><h2>修改邮箱</h2><p>验证码将发送到新邮箱，验证通过后生效。</p></div>
        <div class="form-grid"><label class="wide"><span>新邮箱</span><input v-model.trim="emailForm.email" type="email" required /></label><label class="wide"><span>邮箱验证码</span><div class="code-field"><input v-model.trim="emailForm.emailCode" maxlength="6" required /><button type="button" :disabled="sendingCode === 'change-email'" @click="sendEmailCode('change-email')">发送验证码</button></div></label></div>
        <footer><button type="submit" :disabled="saving">确认修改邮箱</button></footer>
      </form>

      <form v-if="isOwner" class="profile-card security-card" @submit.prevent="updatePassword">
        <div class="section-title"><h2>修改密码</h2><p>验证码将发送到当前邮箱 {{ tenant.email }}。</p></div>
        <div class="form-grid"><label><span>当前密码</span><input v-model="passwordForm.currentPassword" type="password" required /></label><label><span>邮箱验证码</span><div class="code-field"><input v-model.trim="passwordForm.emailCode" maxlength="6" required /><button type="button" :disabled="sendingCode === 'change-password'" @click="sendEmailCode('change-password')">发送验证码</button></div></label><label><span>新密码</span><input v-model="passwordForm.newPassword" type="password" minlength="6" required /></label><label><span>确认新密码</span><input v-model="passwordForm.confirmPassword" type="password" minlength="6" required /></label></div>
        <footer><button type="submit" :disabled="saving">确认修改密码</button></footer>
      </form>
    </template>
  </section>
</template>

<style scoped>
.profile-page{width:min(900px,100%);margin:0 auto;padding-bottom:24px}.profile-heading{margin-bottom:20px;padding:28px 30px;border-radius:20px;background:linear-gradient(135deg,#172554,#2563eb);color:#fff;box-shadow:0 16px 40px rgba(37,99,235,.2)}.profile-heading span{font-size:12px;font-weight:700;opacity:.75}.profile-heading h1{margin:5px 0;font-size:27px}.profile-heading p{margin:0;opacity:.82}.profile-card{overflow:hidden;border:1px solid #e2e8f0;border-radius:16px;background:#fff;box-shadow:0 4px 16px rgba(15,23,42,.05)}.security-card{margin-top:18px}.section-title{padding:22px 26px 0}.section-title h2{margin:0 0 4px;font-size:18px}.section-title p{margin:0;color:#64748b;font-size:13px}.avatar-section{display:flex;align-items:center;gap:20px;padding:26px;border-bottom:1px solid #e2e8f0}.avatar-preview{display:grid;width:84px;height:84px;flex:0 0 84px;overflow:hidden;border-radius:50%;background:#2563eb;color:#fff;font-size:30px;font-weight:800;place-items:center}.avatar-preview img{width:100%;height:100%;object-fit:cover}.avatar-section h2{margin:0 0 4px;font-size:17px}.avatar-section p{margin:0 0 12px;color:#64748b;font-size:13px}.avatar-actions{display:flex;align-items:center;gap:12px}.secondary-btn{padding:8px 14px;border:1px solid #bfdbfe;border-radius:9px;background:#eff6ff;color:#2563eb;font-size:13px;font-weight:600;cursor:pointer}.link-danger{border:0;background:none;color:#dc2626}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;padding:26px}.form-grid label{display:flex;flex-direction:column;gap:7px;color:#475569;font-size:13px;font-weight:600}.form-grid label.wide{grid-column:1/-1}.form-grid input{width:100%;padding:11px 13px;border:1px solid #e2e8f0;border-radius:9px;outline:none}.form-grid input:focus{border-color:#2563eb}.form-grid input:disabled{background:#f8fafc;color:#64748b}.code-field{display:flex;gap:10px}.code-field button{flex:0 0 110px;border:1px solid #bfdbfe;border-radius:9px;background:#eff6ff;color:#2563eb}.profile-card footer{display:flex;justify-content:flex-end;padding:18px 26px;border-top:1px solid #e2e8f0;background:#f8fafc}.profile-card footer button{min-width:140px;padding:10px 20px;border:0;border-radius:9px;background:#2563eb;color:#fff;font-weight:600}.profile-card button:disabled{opacity:.55}.profile-notice{margin-bottom:16px;padding:12px 14px;border:1px solid #bbf7d0;border-radius:10px;background:#f0fdf4;color:#166534}.profile-notice.error{border-color:#fecaca;background:#fef2f2;color:#991b1b}.profile-state{padding:50px;text-align:center;color:#64748b}
</style>
