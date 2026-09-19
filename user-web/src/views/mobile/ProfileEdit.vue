<!-- 忆梦云团队开发 - 移动端资料管理 -->
<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../../api'
import { clearIdentityCache, tenantIdentityScope } from '../../chatCache'

const router = useRouter()
const user = reactive({ displayName: '', avatarUrl: '', role: '' })
const tenant = reactive({ email: '', qq: '' })
const emailForm = reactive({ email: '', emailCode: '' })
const passwordForm = reactive({ currentPassword: '', newPassword: '', confirmPassword: '', emailCode: '' })
const loading = ref(true)
const busy = ref(false)
const sending = ref('')
const notice = ref({ type: '', text: '' })
const isOwner = computed(() => user.role === 'owner')

function showNotice(type, text) { notice.value = { type, text }; setTimeout(() => { if (notice.value.text === text) notice.value = { type: '', text: '' } }, 2600) }
function persist(data) {
  const storage = sessionStorage.getItem('tenant_token') ? sessionStorage : localStorage
  if (data?.token) storage.setItem('tenant_token', data.token)
  if (data?.user) { Object.assign(user, data.user); storage.setItem('tenant_user', JSON.stringify(data.user)) }
  if (data?.tenant) { Object.assign(tenant, data.tenant); emailForm.email = data.tenant.email || ''; storage.setItem('tenant_info', JSON.stringify(data.tenant)) }
}
onMounted(async () => { try { const res = await api.get('/tenant/auth/me'); if (res.code !== 0) throw new Error(res.message); persist(res.data) } catch (e) { showNotice('error', e?.message || '加载资料失败') } finally { loading.value = false } })

async function onAvatarChange(event) {
  const file = event.target.files?.[0]; event.target.value = ''
  if (!file) return
  if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) return showNotice('error', '请选择不超过5MB的图片')
  busy.value = true
  try { const fd = new FormData(); fd.append('file', file); const res = await api.upload('/upload/tenant', fd); if (res.code !== 0) throw new Error(res.message); user.avatarUrl = res.data.url } catch (e) { showNotice('error', e?.message || '上传失败') } finally { busy.value = false }
}
async function saveProfile() {
  const displayName = user.displayName.trim(), qq = tenant.qq.trim()
  if (!displayName) return showNotice('error', '昵称不能为空')
  if (qq && !/^[1-9]\d{4,11}$/.test(qq)) return showNotice('error', 'QQ号格式不正确')
  busy.value = true
  try { const res = await api.patch('/tenant/auth/profile', { displayName, avatarUrl: user.avatarUrl.trim(), ...(isOwner.value ? { qq } : {}) }); if (res.code !== 0) throw new Error(res.message); persist(res.data); showNotice('success', '资料已保存') } catch (e) { showNotice('error', e?.message || '保存失败') } finally { busy.value = false }
}
async function sendCode(purpose) {
  sending.value = purpose
  try { const res = await api.post('/tenant/auth/profile/email-code', { purpose, ...(purpose === 'change-email' ? { email: emailForm.email } : {}) }); if (res.code !== 0) throw new Error(res.message); showNotice('success', res.message) } catch (e) { showNotice('error', e?.message || '验证码发送失败') } finally { sending.value = '' }
}
async function updateEmail() {
  busy.value = true
  try { const res = await api.patch('/tenant/auth/profile/email', emailForm); if (res.code !== 0) throw new Error(res.message); tenant.email = res.data.email; emailForm.emailCode = ''; showNotice('success', res.message) } catch (e) { showNotice('error', e?.message || '邮箱修改失败') } finally { busy.value = false }
}
async function updatePassword() {
  busy.value = true
  try { const res = await api.patch('/tenant/auth/profile/password', passwordForm); if (res.code !== 0) throw new Error(res.message); await clearIdentityCache(tenantIdentityScope()); for (const storage of [sessionStorage, localStorage]) { storage.removeItem('tenant_token'); storage.removeItem('tenant_user'); storage.removeItem('tenant_info') } router.replace({ path: '/login', query: { reset: '1' } }) } catch (e) { showNotice('error', e?.message || '密码修改失败') } finally { busy.value = false }
}
</script>

<template>
  <section class="edit-shell">
    <header><button type="button" @click="router.back()">‹</button><strong>资料管理</strong></header>
    <main>
      <div v-if="notice.text" class="notice" :class="notice.type">{{ notice.text }}</div>
      <div v-if="loading" class="state">正在加载...</div>
      <template v-else>
        <form class="card" @submit.prevent="saveProfile">
          <h2>基本资料</h2>
          <div class="avatar"><div><img v-if="user.avatarUrl" :src="user.avatarUrl" alt="头像" /><span v-else>{{ (user.displayName || '?')[0] }}</span></div><label>选择图片<input type="file" accept="image/*" hidden @change="onAvatarChange" /></label></div>
          <label><span>昵称</span><input v-model="user.displayName" maxlength="50" required /></label>
          <label v-if="isOwner"><span>QQ</span><input v-model.trim="tenant.qq" inputmode="numeric" maxlength="12" placeholder="请输入QQ号" /></label>
          <button type="submit" :disabled="busy">保存基本资料</button>
        </form>
        <form v-if="isOwner" class="card" @submit.prevent="updateEmail">
          <h2>修改邮箱</h2><p>验证码将发送到新邮箱。</p>
          <label><span>新邮箱</span><input v-model.trim="emailForm.email" type="email" required /></label>
          <label><span>邮箱验证码</span><div class="code"><input v-model.trim="emailForm.emailCode" maxlength="6" required /><button type="button" :disabled="sending === 'change-email'" @click="sendCode('change-email')">发送验证码</button></div></label>
          <button type="submit" :disabled="busy">确认修改邮箱</button>
        </form>
        <form v-if="isOwner" class="card" @submit.prevent="updatePassword">
          <h2>修改密码</h2><p>验证码将发送到 {{ tenant.email }}。</p>
          <label><span>当前密码</span><input v-model="passwordForm.currentPassword" type="password" required /></label>
          <label><span>邮箱验证码</span><div class="code"><input v-model.trim="passwordForm.emailCode" maxlength="6" required /><button type="button" :disabled="sending === 'change-password'" @click="sendCode('change-password')">发送验证码</button></div></label>
          <label><span>新密码</span><input v-model="passwordForm.newPassword" type="password" minlength="6" required /></label>
          <label><span>确认新密码</span><input v-model="passwordForm.confirmPassword" type="password" minlength="6" required /></label>
          <button type="submit" :disabled="busy">确认修改密码</button>
        </form>
      </template>
    </main>
  </section>
</template>

<style scoped>
.edit-shell{width:100%;height:100vh;height:100dvh;min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior-y:contain;-webkit-overflow-scrolling:touch;background:#f5f6f8}.edit-shell main{padding:14px 14px calc(24px + env(safe-area-inset-bottom,0))}.edit-shell>header{position:sticky;top:0;z-index:2;height:52px;display:flex;align-items:center;justify-content:center;border-bottom:1px solid #e5e7eb;background:#fff}.edit-shell>header button{position:absolute;left:10px;border:0;background:none;color:#2563eb;font-size:30px}.notice{position:fixed;top:60px;left:50%;z-index:5;transform:translateX(-50%);width:max-content;max-width:90%;padding:10px 16px;border-radius:9px;background:#dcfce7;color:#15803d}.notice.error{background:#fee2e2;color:#dc2626}.state{text-align:center;padding:48px;color:#64748b}.card{margin-bottom:14px;padding:16px;border-radius:14px;background:#fff}.card h2{margin:0 0 4px;font-size:17px}.card p{margin:0 0 16px;color:#64748b;font-size:12px}.card>label{display:block;margin-top:14px}.card>label>span{display:block;margin-bottom:7px;color:#64748b;font-size:13px}.card input{width:100%;padding:12px;border:1px solid #e2e8f0;border-radius:10px;font-size:15px}.card>button{width:100%;margin-top:18px;padding:13px;border:0;border-radius:11px;background:#2563eb;color:#fff;font-weight:600}.card button:disabled{opacity:.55}.avatar{display:flex;align-items:center;gap:14px;margin:16px 0}.avatar>div{display:grid;width:64px;height:64px;overflow:hidden;border-radius:50%;background:#dbeafe;color:#2563eb;font-size:24px;place-items:center}.avatar img{width:100%;height:100%;object-fit:cover}.avatar label{padding:8px 14px;border:1px solid #bfdbfe;border-radius:8px;color:#2563eb;font-size:13px}.code{display:flex;gap:8px}.code button{flex:0 0 105px;border:1px solid #bfdbfe;border-radius:10px;background:#eff6ff;color:#2563eb}
</style>
