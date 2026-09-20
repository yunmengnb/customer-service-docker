<!-- 忆梦云团队开发 - 租户找回密码 -->
<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

const router = useRouter()
const form = ref({ email: '', emailCode: '', newPassword: '', confirmPassword: '' })
const err = ref('')
const notice = ref('')
const sending = ref(false)
const resetting = ref(false)

async function sendCode() {
  err.value = ''
  notice.value = ''
  if (!/^\S+@\S+\.\S+$/.test(form.value.email)) return (err.value = '请输入正确的注册邮箱')
  sending.value = true
  try {
    const res = await api.post('/tenant/auth/forgot-password/code', { email: form.value.email })
    if (res.code !== 0) throw new Error(res.message || '验证码发送失败')
    notice.value = res.message
  } catch (e) {
    err.value = e?.message || '验证码发送失败'
  } finally {
    sending.value = false
  }
}

async function resetPassword() {
  err.value = ''
  notice.value = ''
  const f = form.value
  if (!f.email || !f.emailCode || !f.newPassword || !f.confirmPassword) return (err.value = '请填写完整信息')
  if (f.newPassword.length < 6 || f.newPassword.length > 72) return (err.value = '新密码须为6-72位')
  if (f.newPassword !== f.confirmPassword) return (err.value = '两次输入的新密码不一致')
  resetting.value = true
  try {
    const res = await api.post('/tenant/auth/forgot-password/reset', f)
    if (res.code !== 0) throw new Error(res.message || '密码重置失败')
    router.replace({ path: '/login', query: { reset: '1' } })
  } catch (e) {
    err.value = e?.message || '密码重置失败'
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <div class="ambient ambient-one"></div><div class="ambient ambient-two"></div>
    <section class="auth-shell" aria-labelledby="forgot-title">
      <aside class="brand-panel">
        <div class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 11.5a8.5 8.5 0 0 1-9 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.8-5.2A8.5 8.5 0 1 1 21 11.5Z"/><path d="M8.5 10.5h7M8.5 14h4.5"/></svg></div>
        <div class="brand-copy"><span>YIMENGYUN SERVICE</span><h2>安全验证身份<br>快速恢复工作</h2><p>通过注册邮箱完成身份验证，重新设置客服后台登录密码。</p></div>
        <div class="brand-status"><i></i><span>客服工作台安全连接</span></div>
      </aside>
      <div class="form-panel">
        <div class="mobile-brand"><span class="mobile-logo"><svg viewBox="0 0 24 24"><path d="M21 11.5a8.5 8.5 0 0 1-9 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.8-5.2A8.5 8.5 0 1 1 21 11.5Z"/></svg></span>忆梦云客服</div>
        <header><span class="eyebrow">ACCOUNT RECOVERY</span><h1 id="forgot-title">找回密码</h1><p>验证注册邮箱并设置新的登录密码</p></header>
        <form @submit.prevent="resetPassword">
          <label class="field"><span>注册邮箱</span><input v-model.trim="form.email" type="email" autocomplete="email" placeholder="请输入客服后台注册邮箱"></label>
          <label class="field"><span>邮箱验证码</span><span class="code-row"><input v-model.trim="form.emailCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6位验证码"><button type="button" :disabled="sending" @click="sendCode">{{ sending ? '发送中...' : '发送验证码' }}</button></span></label>
          <label class="field"><span>新密码</span><input v-model="form.newPassword" type="password" autocomplete="new-password" placeholder="请输入6-72位新密码"></label>
          <label class="field"><span>确认新密码</span><input v-model="form.confirmPassword" type="password" autocomplete="new-password" placeholder="请再次输入新密码"></label>
          <div v-if="notice && !err" class="feedback success" role="status">{{ notice }}</div>
          <div v-if="err" class="feedback error" role="alert">{{ err }}</div>
          <button class="primary" type="submit" :disabled="resetting"><span v-if="resetting" class="spinner"></span>{{ resetting ? '重置中...' : '重置密码' }}<svg v-if="!resetting" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
        </form>
        <div class="account-links"><router-link to="/login">返回登录</router-link></div>
        <p class="security-tip">验证码与密码将通过加密连接安全传输</p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.auth-page{--primary:#2563eb;position:relative;min-height:100vh;min-height:100dvh;display:grid;place-items:center;overflow:hidden;padding:32px;color:#0f172a;background:radial-gradient(circle at 10% 10%,rgba(59,130,246,.2),transparent 31%),radial-gradient(circle at 88% 88%,rgba(14,165,233,.13),transparent 34%),linear-gradient(145deg,#eef5ff 0%,#f8fafc 48%,#eef6ff 100%)}
.ambient{position:absolute;border-radius:50%;pointer-events:none}.ambient-one{top:-180px;right:-130px;width:440px;height:440px;border:1px solid rgba(37,99,235,.12)}.ambient-two{bottom:-220px;left:-170px;width:520px;height:520px;border:1px solid rgba(14,165,233,.1)}
.auth-shell{position:relative;z-index:1;width:min(100%,940px);min-height:600px;display:grid;grid-template-columns:minmax(300px,.88fr) minmax(420px,1.12fr);overflow:hidden;border:1px solid rgba(255,255,255,.82);border-radius:24px;background:rgba(255,255,255,.94);box-shadow:0 28px 80px rgba(30,64,175,.16),0 3px 12px rgba(15,23,42,.06);backdrop-filter:blur(20px)}
.brand-panel{position:relative;isolation:isolate;display:flex;flex-direction:column;padding:50px 44px 40px;overflow:hidden;color:#fff;background:linear-gradient(150deg,#0f2f70 0%,#1d4ed8 54%,#2563eb 100%)}.brand-panel::before,.brand-panel::after{content:'';position:absolute;z-index:-1;border-radius:50%}.brand-panel::before{width:360px;height:360px;top:-165px;right:-190px;border:55px solid rgba(255,255,255,.06)}.brand-panel::after{width:250px;height:250px;left:-120px;bottom:-120px;background:rgba(56,189,248,.13)}
svg{fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}.brand-mark{width:52px;height:52px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.25);border-radius:16px;background:rgba(255,255,255,.12)}.brand-mark svg{width:28px}.brand-copy{margin:auto 0}.brand-copy>span,.eyebrow{font-size:11px;font-weight:700;letter-spacing:.16em}.brand-copy>span{color:rgba(219,234,254,.78)}.brand-copy h2{margin:16px 0 18px;font-size:clamp(27px,3vw,34px);line-height:1.35}.brand-copy p{margin:0;color:rgba(239,246,255,.72);font-size:14px;line-height:1.8}.brand-status{display:flex;align-items:center;gap:9px;color:rgba(239,246,255,.78);font-size:12px}.brand-status i{width:7px;height:7px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 5px rgba(74,222,128,.13)}
.form-panel{min-width:0;display:flex;flex-direction:column;justify-content:center;padding:42px 54px 34px}.mobile-brand{display:none}.form-panel header{margin-bottom:24px}.eyebrow{display:block;margin-bottom:9px;color:var(--primary)}h1{margin:0;font-size:28px;line-height:1.3}header p{margin:8px 0 0;color:#64748b;font-size:13px}.field{display:block;margin-bottom:15px}.field>span:first-child{display:block;margin-bottom:7px;color:#334155;font-size:12px;font-weight:600}.field input{width:100%;height:44px;padding:0 14px;border:1px solid #dbe3ee;border-radius:10px;outline:none;color:#0f172a;background:#fff;font:inherit;font-size:14px;transition:.2s}.field input:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(37,99,235,.1)}.field input::placeholder{color:#a1adbd}.code-row{display:grid!important;grid-template-columns:minmax(0,1fr) 112px;gap:9px;margin:0!important}.code-row button{border:1px solid #bfdbfe;border-radius:10px;background:#eff6ff;color:var(--primary);font:inherit;font-size:12px;font-weight:600;cursor:pointer}.code-row button:disabled{opacity:.55;cursor:not-allowed}
.feedback{margin:4px 0 12px;padding:9px 11px;border:1px solid;border-radius:9px;font-size:12px;line-height:1.5}.feedback.success{color:#047857;border-color:#bbf7d0;background:#f0fdf4}.feedback.error{color:#b91c1c;border-color:#fecaca;background:#fef2f2}.primary{width:100%;min-height:46px;display:flex;align-items:center;justify-content:center;gap:9px;margin-top:5px;border:0;border-radius:10px;color:#fff;background:linear-gradient(135deg,#2563eb,#1d4ed8);box-shadow:0 10px 22px -12px rgba(37,99,235,.85);font:inherit;font-size:14px;font-weight:600;cursor:pointer}.primary:hover:not(:disabled){transform:translateY(-1px)}.primary:disabled{opacity:.65;cursor:not-allowed}.primary svg{width:17px}.spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .75s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.account-links{text-align:center;margin-top:18px;font-size:12px}.account-links a{color:var(--primary);font-weight:600;text-decoration:none}.security-tip{margin:auto 0 0;padding-top:25px;text-align:center;color:#94a3b8;font-size:11px}
@media(max-width:820px){.auth-page{padding:24px}.auth-shell{width:min(100%,500px);min-height:auto;display:block}.brand-panel{display:none}.form-panel{padding:38px 42px 30px}.mobile-brand{display:flex;align-items:center;gap:10px;margin-bottom:27px;color:#1e3a8a;font-size:15px;font-weight:700}.mobile-logo{width:36px;height:36px;display:grid;place-items:center;border-radius:10px;color:#fff;background:linear-gradient(135deg,#2563eb,#1d4ed8)}.mobile-logo svg{width:20px}.security-tip{margin-top:0}}
@media(max-width:576px){.auth-page{display:block;overflow-y:auto;padding:max(14px,env(safe-area-inset-top)) 12px max(14px,env(safe-area-inset-bottom))}.auth-shell{width:100%;min-height:calc(100dvh - 28px);border-radius:18px}.form-panel{min-height:inherit;justify-content:center;padding:28px 22px 22px}.mobile-brand{margin-bottom:23px}h1{font-size:24px}.field input{height:46px;font-size:16px}.code-row{grid-template-columns:minmax(0,1fr) 108px}.primary{min-height:48px}.security-tip{padding-top:21px}}
@media(max-height:720px) and (min-width:821px){.auth-page{place-items:start center;overflow-y:auto;padding-block:20px}.auth-shell{min-height:560px}.brand-panel{padding-block:36px 30px}.form-panel{padding-block:30px 24px}.form-panel header{margin-bottom:16px}.field{margin-bottom:11px}.security-tip{padding-top:18px}}
@media(max-height:620px) and (max-width:820px){.auth-page{display:block;overflow-y:auto}.auth-shell{margin:0 auto}.form-panel{justify-content:flex-start;padding-block:25px 22px}.mobile-brand{margin-bottom:18px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
</style>
