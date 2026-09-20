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
const emailVerificationEnabled = ref(false)
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
  if (!emailVerificationEnabled.value) return showToast('客服注册暂未开启邮箱验证', 'error')
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
    registerEnabled.value = res.data?.tenantRegisterEnabled !== false
    emailVerificationEnabled.value = res.data?.tenantRegisterEmailVerificationEnabled === true
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
  if (!f.name || !f.username || !f.email || !f.password || !f.confirmPassword
    || (emailVerificationEnabled.value && !f.emailCode)) {
    err.value = '请填写完整信息'
    return
  }
  if (emailVerificationEnabled.value && !/^\d{6}$/.test(f.emailCode)) { err.value = '请输入6位邮箱验证码'; return }
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
    err.value = e?.message || '网络错误，请稍后重试'
    await captcha.value?.reset()
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <div class="ambient ambient-one"></div><div class="ambient ambient-two"></div>
    <Transition name="toast"><div v-if="toast.message" class="top-toast" :class="toast.type" role="status">{{ toast.message }}</div></Transition>
    <section class="auth-shell" aria-labelledby="register-title">
      <aside class="brand-panel">
        <div class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 11.5a8.5 8.5 0 0 1-9 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.8-5.2A8.5 8.5 0 1 1 21 11.5Z"/><path d="M8.5 10.5h7M8.5 14h4.5"/></svg></div>
        <div class="brand-copy"><span>YIMENGYUN SERVICE</span><h2>连接团队与客户<br>从高效服务开始</h2><p>创建客服后台账号，统一管理服务渠道与客户会话。</p></div>
        <div class="brand-status"><i></i><span>客服工作台安全连接</span></div>
      </aside>
      <div class="form-panel">
        <div class="mobile-brand"><span class="mobile-logo"><svg viewBox="0 0 24 24"><path d="M21 11.5a8.5 8.5 0 0 1-9 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.8-5.2A8.5 8.5 0 1 1 21 11.5Z"/></svg></span>忆梦云客服</div>
        <header><span class="eyebrow">CREATE ACCOUNT</span><h1 id="register-title">注册客服后台</h1><p>填写账号信息，开始使用客服工作台</p></header>
        <div v-if="settingsLoaded && !registerEnabled" class="feedback error" role="alert">暂时无法注册，有问题请联系管理员</div>
        <form v-if="registerEnabled" @submit.prevent="doRegister">
          <div class="field-grid">
            <label class="field"><span>企业名称</span><input v-model.trim="form.name" autocomplete="organization" placeholder="请输入企业名称"></label>
            <label class="field"><span>登录用户名</span><input v-model.trim="form.username" autocomplete="username" placeholder="请输入登录用户名"></label>
          </div>
          <label class="field"><span>邮箱</span><input v-model.trim="form.email" type="email" autocomplete="email" placeholder="请输入邮箱"></label>
          <label v-if="emailVerificationEnabled" class="field"><span>邮箱验证码</span><span class="code-row"><input v-model.trim="form.emailCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6位验证码"><button type="button" :disabled="sendingCode" @click="sendCode">{{ sendingCode ? '发送中...' : '发送验证码' }}</button></span></label>
          <div class="field-grid">
            <label class="field"><span>登录密码</span><input v-model="form.password" type="password" autocomplete="new-password" placeholder="6-72位"></label>
            <label class="field"><span>确认密码</span><input v-model="form.confirmPassword" type="password" autocomplete="new-password" placeholder="再次输入密码"></label>
          </div>
          <AuthCaptcha ref="captcha" @submit="doRegister" />
          <label class="agreement-check"><input v-model="agreed" type="checkbox"><span>我已阅读并同意<router-link to="/agreements/disclaimer" target="_blank">《免责协议》</router-link>和<router-link to="/agreements/terms" target="_blank">《使用协议》</router-link></span></label>
          <div v-if="err" class="feedback error" role="alert">{{ err }}</div>
          <button class="primary" type="submit" :disabled="loading"><span v-if="loading" class="spinner"></span>{{ loading ? '注册中...' : '创建账号' }}<svg v-if="!loading" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
        </form>
        <div class="account-links">已有账号？<router-link to="/login">返回登录</router-link></div>
        <p class="security-tip">注册信息将通过加密连接安全传输</p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.auth-page{--primary:#2563eb;--dark:#1d4ed8;position:relative;min-height:100vh;min-height:100dvh;display:grid;place-items:center;overflow:hidden;padding:28px;color:#0f172a;background:radial-gradient(circle at 10% 10%,rgba(59,130,246,.2),transparent 31%),radial-gradient(circle at 88% 88%,rgba(14,165,233,.13),transparent 34%),linear-gradient(145deg,#eef5ff 0%,#f8fafc 48%,#eef6ff 100%)}
.ambient{position:absolute;border-radius:50%;pointer-events:none}.ambient-one{top:-180px;right:-130px;width:440px;height:440px;border:1px solid rgba(37,99,235,.12)}.ambient-two{bottom:-220px;left:-170px;width:520px;height:520px;border:1px solid rgba(14,165,233,.1)}
.auth-shell{position:relative;z-index:1;width:min(100%,1000px);min-height:640px;display:grid;grid-template-columns:minmax(300px,.82fr) minmax(500px,1.18fr);overflow:hidden;border:1px solid rgba(255,255,255,.82);border-radius:24px;background:rgba(255,255,255,.94);box-shadow:0 28px 80px rgba(30,64,175,.16),0 3px 12px rgba(15,23,42,.06);backdrop-filter:blur(20px)}
.brand-panel{position:relative;isolation:isolate;display:flex;flex-direction:column;padding:50px 44px 40px;overflow:hidden;color:#fff;background:linear-gradient(150deg,#0f2f70 0%,#1d4ed8 54%,#2563eb 100%)}.brand-panel::before,.brand-panel::after{content:'';position:absolute;z-index:-1;border-radius:50%}.brand-panel::before{width:360px;height:360px;top:-165px;right:-190px;border:55px solid rgba(255,255,255,.06)}.brand-panel::after{width:250px;height:250px;left:-120px;bottom:-120px;background:rgba(56,189,248,.13)}
.brand-mark{width:52px;height:52px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.25);border-radius:16px;background:rgba(255,255,255,.12)}svg{fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}.brand-mark svg{width:28px}.brand-copy{margin:auto 0}.brand-copy>span,.eyebrow{font-size:11px;font-weight:700;letter-spacing:.16em}.brand-copy>span{color:rgba(219,234,254,.78)}.brand-copy h2{margin:16px 0 18px;font-size:clamp(27px,3vw,34px);line-height:1.35}.brand-copy p{margin:0;color:rgba(239,246,255,.72);font-size:14px;line-height:1.8}.brand-status{display:flex;align-items:center;gap:9px;color:rgba(239,246,255,.78);font-size:12px}.brand-status i{width:7px;height:7px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 5px rgba(74,222,128,.13)}
.form-panel{min-width:0;display:flex;flex-direction:column;justify-content:center;padding:34px 46px 28px}.mobile-brand{display:none}.form-panel header{margin-bottom:18px}.eyebrow{display:block;margin-bottom:8px;color:var(--primary)}h1{margin:0;font-size:27px;line-height:1.3}header p{margin:7px 0 0;color:#64748b;font-size:13px}.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{display:block;margin-bottom:12px}.field>span:first-child{display:block;margin-bottom:6px;color:#334155;font-size:12px;font-weight:600}.field input{width:100%;height:43px;padding:0 13px;border:1px solid #dbe3ee;border-radius:10px;outline:none;background:#fff;color:#0f172a;font:inherit;font-size:14px;transition:.2s}.field input:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(37,99,235,.1)}.field input::placeholder{color:#a1adbd}.code-row{display:grid!important;grid-template-columns:minmax(0,1fr) 112px;gap:9px;margin:0!important}.code-row button{border:1px solid #bfdbfe;border-radius:10px;background:#eff6ff;color:var(--primary);font:inherit;font-size:12px;font-weight:600;cursor:pointer}.code-row button:disabled{opacity:.55;cursor:not-allowed}.form-panel :deep(.auth-captcha){margin-bottom:11px}
.agreement-check{display:flex;align-items:flex-start;gap:8px;margin-bottom:11px;color:#64748b;font-size:11px;line-height:1.55}.agreement-check input{width:15px;height:15px;margin:1px 0 0;flex:none}.agreement-check a,.account-links a{color:var(--primary);font-weight:600;text-decoration:none}.feedback{margin:3px 0 11px;padding:9px 11px;border:1px solid;border-radius:9px;font-size:12px;line-height:1.5}.feedback.error{color:#b91c1c;border-color:#fecaca;background:#fef2f2}.primary{width:100%;min-height:46px;display:flex;align-items:center;justify-content:center;gap:9px;border:0;border-radius:10px;color:#fff;background:linear-gradient(135deg,#2563eb,#1d4ed8);box-shadow:0 10px 22px -12px rgba(37,99,235,.85);font:inherit;font-size:14px;font-weight:600;cursor:pointer}.primary:hover:not(:disabled){transform:translateY(-1px)}.primary:disabled{opacity:.65;cursor:not-allowed}.primary svg{width:17px}.spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .75s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.account-links{text-align:center;margin-top:15px;color:#64748b;font-size:12px}.security-tip{margin:auto 0 0;padding-top:17px;text-align:center;color:#94a3b8;font-size:11px}
.top-toast{position:fixed;top:calc(18px + env(safe-area-inset-top,0px));left:50%;z-index:1000;max-width:calc(100vw - 32px);padding:11px 18px;border-radius:10px;color:#fff;background:#16a34a;box-shadow:0 8px 24px rgba(15,23,42,.22);font-size:14px;transform:translateX(-50%)}.top-toast.error{background:#dc2626}.toast-enter-active,.toast-leave-active{transition:.2s}.toast-enter-from,.toast-leave-to{opacity:0;transform:translate(-50%,-10px)}
@media(max-width:820px){.auth-page{padding:24px;overflow-y:auto}.auth-shell{width:min(100%,540px);min-height:auto;display:block}.brand-panel{display:none}.form-panel{padding:34px 40px 28px}.mobile-brand{display:flex;align-items:center;gap:10px;margin-bottom:22px;color:#1e3a8a;font-size:15px;font-weight:700}.mobile-logo{width:36px;height:36px;display:grid;place-items:center;border-radius:10px;color:#fff;background:linear-gradient(135deg,#2563eb,#1d4ed8)}.mobile-logo svg{width:20px}.security-tip{margin-top:0}}
@media(max-width:576px){.auth-page{display:block;padding:max(12px,env(safe-area-inset-top)) 10px max(12px,env(safe-area-inset-bottom))}.auth-shell{width:100%;min-height:calc(100dvh - 24px);border-radius:18px}.form-panel{min-height:inherit;justify-content:center;padding:25px 20px 20px}.field-grid{grid-template-columns:1fr;gap:0}.field input{height:46px;font-size:16px}.code-row{grid-template-columns:minmax(0,1fr) 108px}.primary{min-height:48px}h1{font-size:24px}.mobile-brand{margin-bottom:19px}}
@media(max-height:720px) and (min-width:821px){.auth-page{place-items:start center;overflow-y:auto;padding-block:18px}.auth-shell{min-height:620px}.brand-panel{padding-block:36px 30px}.form-panel{padding-block:25px 22px}.field{margin-bottom:9px}.field input{height:40px}.security-tip{padding-top:12px}}
@media(max-height:620px) and (max-width:820px){.auth-page{display:block;overflow-y:auto}.auth-shell{margin:0 auto}.form-panel{justify-content:flex-start}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
</style>
