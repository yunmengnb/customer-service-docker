<!-- 忆梦云团队开发 -->
<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'
import AuthCaptcha from '../components/AuthCaptcha.vue'

const router = useRouter()
const form = ref({ name: '', username: '', email: '', emailCode: '', password: '', confirmPassword: '' })
const captcha = ref(null)
const agreed = ref(false)
const registerEnabled = ref(true)
const settingsLoaded = ref(false)
const err = ref('')
const loading = ref(false)
const sendingCode = ref(false)
const toast = ref({ message: '', type: 'success' })
let toastTimer = null

function showToast(message, type = 'success') {
  toast.value = { message, type }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value.message = '' }, 3000)
}

async function sendCode() {
  if (!registerEnabled.value) return showToast('暂时无法注册，有问题请联系管理员', 'error')
  if (sendingCode.value) return
  err.value = ''
  if (!/^\S+@\S+\.\S+$/.test(form.value.email)) {
    showToast('请输入正确的邮箱', 'error')
    return
  }
  sendingCode.value = true
  try {
    const res = await api.post('/tenant/auth/register-code', { email: form.value.email })
    if (res.code !== 0) throw new Error(res.message || '验证码发送失败')
    showToast(res.message || '验证码已发送')
  } catch (e) {
    showToast(e?.message || '验证码发送失败', 'error')
  } finally {
    sendingCode.value = false
  }
}

onMounted(async () => {
  try {
    const res = await api.get('/tenant/public-settings')
    registerEnabled.value = res.data?.registerEnabled !== false
  } finally {
    settingsLoaded.value = true
  }
})
onBeforeUnmount(() => clearTimeout(toastTimer))

async function doRegister() {
  if (!registerEnabled.value) return err.value = '暂时无法注册，有问题请联系管理员'
  if (loading.value) return
  err.value = ''
  const f = form.value
  if (!f.name || !f.username || !f.email || !f.emailCode || !f.password || !f.confirmPassword) {
    err.value = '请填写完整信息'
    return
  }
  if (!/^\d{6}$/.test(f.emailCode)) { err.value = '请输入6位邮箱验证码'; return }
  if (f.password.length < 6 || f.password.length > 72) { err.value = '密码须为6-72位'; return }
  if (f.password !== f.confirmPassword) { err.value = '两次输入的密码不一致'; return }
  if (!agreed.value) { err.value = '请先阅读并同意免责协议和使用协议'; return }
  loading.value = true
  try {
    const captchaPayload = await captcha.value.verify()
    const res = await api.post('/tenant/auth/register', { ...f, ...captchaPayload })
    if (res.code === 0) {
      router.replace({ path: '/login', query: { registered: '1' } })
    } else {
      err.value = res.message || '注册失败'
    }
  } catch (e) {
    err.value = e?.message || '网络错误'
    await captcha.value?.reset()
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="simple-page">
    <Transition name="toast">
      <div v-if="toast.message" class="top-toast" :class="toast.type" role="status">{{ toast.message }}</div>
    </Transition>
    <div class="simple-box">
      <h1>注册客服后台</h1>
      <div class="sub">加入客服系统，开始与客户沟通</div>
      <div v-if="settingsLoaded && !registerEnabled" class="err">暂时无法注册，有问题请联系管理员</div>
      <template v-if="registerEnabled">
      <input v-model.trim="form.name" autocomplete="organization" placeholder="企业名称" />
      <input v-model.trim="form.username" autocomplete="username" placeholder="登录用户名" />
      <input v-model.trim="form.email" type="email" autocomplete="email" placeholder="邮箱" />
      <div class="code-row">
        <input v-model.trim="form.emailCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6位邮箱验证码" />
        <button type="button" :disabled="sendingCode" @click="sendCode">{{ sendingCode ? '发送中...' : '发送验证码' }}</button>
      </div>
      <input v-model="form.password" type="password" autocomplete="new-password" placeholder="密码（6-72位）" />
      <input v-model="form.confirmPassword" type="password" autocomplete="new-password" placeholder="请再次输入密码" @keyup.enter="doRegister" />
      <AuthCaptcha ref="captcha" @submit="doRegister" />
      <label class="agreement-check">
        <input v-model="agreed" type="checkbox" />
        <span>我已阅读并同意<router-link to="/agreements/disclaimer" target="_blank">《免责协议》</router-link>和<router-link to="/agreements/terms" target="_blank">《使用协议》</router-link></span>
      </label>
      <div v-if="err" class="err">{{ err }}</div>
      <button type="button" @click="doRegister" :disabled="loading">
        {{ loading ? '注册中...' : '注册' }}
      </button>
      </template>
      <div class="link-row">
        已有账号？<router-link to="/login">返回登录</router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.top-toast {
  position: fixed;
  top: calc(18px + env(safe-area-inset-top, 0px));
  left: 50%;
  z-index: 1000;
  max-width: calc(100vw - 32px);
  padding: 11px 18px;
  border-radius: 10px;
  color: #fff;
  background: #16a34a;
  box-shadow: 0 8px 24px rgba(15, 23, 42, .22);
  font-size: 14px;
  line-height: 1.4;
  text-align: center;
  transform: translateX(-50%);
}
.top-toast.error { background: #dc2626; }
.toast-enter-active,.toast-leave-active { transition: opacity .2s ease, transform .2s ease; }
.toast-enter-from,.toast-leave-to { opacity: 0; transform: translate(-50%, -10px); }
.agreement-check { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 12px; font-size: 12px; color: #6b7280; line-height: 1.5; text-align: left; }
.agreement-check input[type="checkbox"] { width: 15px; height: 15px; padding: 0; margin: 2px 0 0; border: 1px solid #d1d5db; border-radius: 3px; flex-shrink: 0; }
.agreement-check a { color: #2563eb; text-decoration: none; }

</style>
