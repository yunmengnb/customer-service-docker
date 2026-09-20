<!-- 忆梦云团队开发 -->
<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import api from '../api'
import AuthCaptcha from '../components/AuthCaptcha.vue'

const router = useRouter()
const route = useRoute()
const form = ref({ username: '', password: '', tenant: '' })
const loginMode = ref('password')
const employeeToken = ref('')
const registerEnabled = ref(true)
const loginEnabled = ref(true)
const captcha = ref(null)
const err = ref('')
const needsTenant = ref(false)
const loading = ref(false)
const invalidEmployeeTokenReasons = new Set([
  'EMPLOYEE_TOKEN_MISSING',
  'EMPLOYEE_TOKEN_MALFORMED',
  'EMPLOYEE_TOKEN_UNKNOWN',
  'EMPLOYEE_TOKEN_INVALID',
  'EMPLOYEE_TOKEN_USED',
  'EMPLOYEE_TOKEN_UNRECOGNIZED',
  'EMPLOYEE_TOKEN_UNAVAILABLE',
])

const notice = computed(() => {
  if (route.query.registered === '1') return '注册成功，请登录'
  if (route.query.reset === '1') return '密码已重置，请使用新密码登录'
  return ''
})

function employeeTokenErrorMessage(error) {
  if (
    error?.reason === 'EMPLOYEE_TOKEN_EXPIRED'
    || Number(error?.code) === 401011
  ) return '密钥已过期'

  if (
    invalidEmployeeTokenReasons.has(error?.reason)
    || Number(error?.code) === 401010
  ) return '密钥错误'

  if (error?.isNetworkError) return '网络错误，请稍后重试'
  return error?.message || '登录失败，请稍后重试'
}

function saveLogin(data) {
  sessionStorage.removeItem('tenant_impersonation')
  sessionStorage.removeItem('tenant_token')
  sessionStorage.removeItem('tenant_user')
  sessionStorage.removeItem('tenant_info')
  localStorage.setItem('tenant_token', data.token)
  localStorage.setItem('tenant_user', JSON.stringify(data.user))
  localStorage.setItem('tenant_info', JSON.stringify(data.tenant))
  const target = typeof route.query.redirect === 'string' ? route.query.redirect : (data.redirect || '/messages')
  router.replace(target)
}

async function doLogin() {
  if (!loginEnabled.value) return err.value = '客服登录暂时关闭，有问题请联系管理员'
  if (loading.value) return
  err.value = ''
  if (loginMode.value === 'token' && !employeeToken.value.trim()) return err.value = '请粘贴员工密钥'
  if (loginMode.value === 'password' && (!form.value.username || !form.value.password)) return err.value = '请填写完整'
  loading.value = true
  try {
    const res = loginMode.value === 'token'
      ? await api.post('/integration/employee-token-login', { token: employeeToken.value.trim() })
      : await api.post('/tenant/auth/login', { ...form.value, ...await captcha.value.verify() })
    if (res.code === 0 || res.code === 200) {
      saveLogin(res.data)
    } else {
      err.value = res.message || '登录失败'
      if (res.code === 4092) needsTenant.value = true
    }
  } catch (e) {
    err.value = loginMode.value === 'token'
      ? employeeTokenErrorMessage(e)
      : (e?.message || (e?.isNetworkError ? '网络错误，请稍后重试' : '登录失败'))
    if (e?.code === 4092 || e?.httpStatus === 409) needsTenant.value = true
    await captcha.value?.reset()
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  try {
    const res = await api.get('/tenant/public-settings')
    registerEnabled.value = res.data?.tenantRegisterEnabled !== false
    loginEnabled.value = res.data?.tenantLoginEnabled !== false
  } catch (_) {}
})
</script>

<template>
  <main class="login-page">
    <div class="ambient ambient-one"></div>
    <div class="ambient ambient-two"></div>

    <section class="login-shell" aria-labelledby="login-title">
      <aside class="brand-panel">
        <div class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 11.5a8.5 8.5 0 0 1-9 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.8-5.2A8.5 8.5 0 1 1 21 11.5Z" />
            <path d="M8.5 10.5h7M8.5 14h4.5" />
          </svg>
        </div>
        <div class="brand-copy">
          <span class="brand-eyebrow">YIMENGYUN SERVICE</span>
          <h2>让每一次沟通<br>清晰、高效、有温度</h2>
          <p>统一管理客户会话与服务渠道，为客服团队提供稳定流畅的工作体验。</p>
        </div>
        <div class="brand-status">
          <span class="status-dot"></span>
          <span>客服工作台安全连接</span>
        </div>
      </aside>

      <div class="form-panel">
        <div class="mobile-brand" aria-hidden="true">
          <span class="mobile-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 11.5a8.5 8.5 0 0 1-9 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.8-5.2A8.5 8.5 0 1 1 21 11.5Z" />
            </svg>
          </span>
          <span>忆梦云客服</span>
        </div>

        <header class="form-heading">
          <span class="form-eyebrow">WELCOME BACK</span>
          <h1 id="login-title">登录客服后台</h1>
          <p>管理员与员工使用同一入口</p>
        </header>

        <div v-if="loginEnabled" class="login-tabs" role="tablist" aria-label="登录方式">
          <button
            type="button"
            role="tab"
            :aria-selected="loginMode === 'password'"
            :class="{ active: loginMode === 'password' }"
            @click="loginMode = 'password'; err = ''"
          >账号 / 邮箱</button>
          <button
            type="button"
            role="tab"
            :aria-selected="loginMode === 'token'"
            :class="{ active: loginMode === 'token' }"
            @click="loginMode = 'token'; err = ''"
          >员工临时密钥</button>
        </div>

        <form v-if="loginEnabled" class="login-form" @submit.prevent="doLogin">
          <template v-if="loginMode === 'password'">
            <label class="field">
              <span class="field-label">账号或邮箱</span>
              <span class="input-wrap">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" /></svg>
                <input v-model="form.username" autocomplete="username" placeholder="请输入用户名或邮箱" />
              </span>
            </label>

            <label v-if="needsTenant || form.tenant" class="field">
              <span class="field-label">租户信息</span>
              <span class="input-wrap">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 10h1M14 10h1M9 14h1M14 14h1" /></svg>
                <input v-model.trim="form.tenant" autocomplete="organization" placeholder="请输入租户账号或租户标识" />
              </span>
              <span class="field-help">检测到同名账号，请补充所属租户</span>
            </label>

            <label class="field">
              <span class="field-label">登录密码</span>
              <span class="input-wrap">
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2" /></svg>
                <input v-model="form.password" type="password" autocomplete="current-password" placeholder="请输入登录密码" />
              </span>
            </label>

            <div class="captcha-wrap">
              <AuthCaptcha ref="captcha" @submit="doLogin" />
            </div>
          </template>

          <template v-else>
            <label class="field token-field">
              <span class="field-label">员工临时密钥</span>
              <textarea v-model.trim="employeeToken" rows="5" autocomplete="off" spellcheck="false" placeholder="请粘贴 Jingpro 员工临时登录密钥" @keyup.ctrl.enter="doLogin"></textarea>
              <span class="field-help">临时密钥具有时效性，请在生成后尽快使用；可按 Ctrl + Enter 登录</span>
            </label>
          </template>

          <div class="feedback-area" aria-live="polite">
            <div v-if="notice && !err" class="feedback success">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 12 3 3 7-7" /><circle cx="12" cy="12" r="9" /></svg>
              <span>{{ notice }}</span>
            </div>
            <div v-if="err" class="feedback error" role="alert">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" /></svg>
              <span>{{ err }}</span>
            </div>
          </div>

          <button type="submit" class="primary" :disabled="loading">
            <span v-if="loading" class="loading-spinner" aria-hidden="true"></span>
            {{ loading ? '正在登录...' : (loginMode === 'token' ? '使用密钥登录' : '登录客服后台') }}
            <svg v-if="!loading" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </form>

        <div v-else class="feedback error" role="alert">
          <span>客服登录暂时关闭，有问题请联系管理员</span>
        </div>

        <div v-if="loginMode === 'password'" class="account-links">
          <router-link to="/forgot-password">忘记密码？</router-link>
          <span v-if="registerEnabled" class="divider"></span>
          <span v-if="registerEnabled">还没有账号？<router-link to="/register">立即注册</router-link></span>
        </div>

        <p class="security-tip">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></svg>
          登录信息将通过加密连接安全传输
        </p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  --login-primary: #2563eb;
  --login-primary-dark: #1d4ed8;
  --login-text: #0f172a;
  --login-secondary: #64748b;
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  overflow: hidden;
  padding: 32px;
  color: var(--login-text);
  background:
    radial-gradient(circle at 10% 10%, rgba(59, 130, 246, .2), transparent 31%),
    radial-gradient(circle at 88% 88%, rgba(14, 165, 233, .13), transparent 34%),
    linear-gradient(145deg, #eef5ff 0%, #f8fafc 48%, #eef6ff 100%);
}

.ambient {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  filter: blur(2px);
}
.ambient-one {
  top: -180px;
  right: -130px;
  width: 440px;
  height: 440px;
  border: 1px solid rgba(37, 99, 235, .12);
  box-shadow: inset 0 0 80px rgba(37, 99, 235, .05);
}
.ambient-two {
  bottom: -220px;
  left: -170px;
  width: 520px;
  height: 520px;
  border: 1px solid rgba(14, 165, 233, .1);
  box-shadow: inset 0 0 100px rgba(14, 165, 233, .05);
}

.login-shell {
  position: relative;
  z-index: 1;
  width: min(100%, 940px);
  min-height: 600px;
  display: grid;
  grid-template-columns: minmax(300px, .88fr) minmax(420px, 1.12fr);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, .82);
  border-radius: 24px;
  background: rgba(255, 255, 255, .94);
  box-shadow: 0 28px 80px rgba(30, 64, 175, .16), 0 3px 12px rgba(15, 23, 42, .06);
  backdrop-filter: blur(20px);
}

.brand-panel {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  padding: 50px 44px 40px;
  overflow: hidden;
  color: #fff;
  background: linear-gradient(150deg, #0f2f70 0%, #1d4ed8 54%, #2563eb 100%);
}
.brand-panel::before,
.brand-panel::after {
  content: '';
  position: absolute;
  z-index: -1;
  border-radius: 50%;
  pointer-events: none;
}
.brand-panel::before {
  width: 360px;
  height: 360px;
  top: -165px;
  right: -190px;
  border: 55px solid rgba(255, 255, 255, .06);
}
.brand-panel::after {
  width: 250px;
  height: 250px;
  left: -120px;
  bottom: -120px;
  background: rgba(56, 189, 248, .13);
  box-shadow: 0 0 90px rgba(56, 189, 248, .14);
}
.brand-mark {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, .25);
  border-radius: 16px;
  background: rgba(255, 255, 255, .12);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .2);
  backdrop-filter: blur(12px);
}
.brand-mark svg { width: 28px; height: 28px; }
.brand-copy { margin: auto 0; }
.brand-eyebrow,
.form-eyebrow {
  display: block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .16em;
}
.brand-eyebrow { color: rgba(219, 234, 254, .78); }
.brand-copy h2 {
  margin: 16px 0 18px;
  font-size: clamp(27px, 3vw, 34px);
  line-height: 1.35;
  letter-spacing: -.03em;
}
.brand-copy p {
  max-width: 320px;
  margin: 0;
  color: rgba(239, 246, 255, .72);
  font-size: 14px;
  line-height: 1.8;
}
.brand-status {
  display: flex;
  align-items: center;
  gap: 9px;
  color: rgba(239, 246, 255, .78);
  font-size: 12px;
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #4ade80;
  box-shadow: 0 0 0 5px rgba(74, 222, 128, .13);
}

.form-panel {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 42px 54px 34px;
}
.mobile-brand { display: none; }
.form-heading { margin-bottom: 23px; }
.form-eyebrow { margin-bottom: 9px; color: var(--login-primary); }
.form-heading h1 {
  margin: 0;
  font-size: 28px;
  line-height: 1.3;
  letter-spacing: -.025em;
}
.form-heading p {
  margin: 8px 0 0;
  color: var(--login-secondary);
  font-size: 13px;
  line-height: 1.65;
}

.login-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin-bottom: 22px;
  padding: 4px;
  border-radius: 12px;
  background: #f1f5f9;
}
.login-tabs button {
  min-height: 40px;
  padding: 8px 12px;
  border: 0;
  border-radius: 9px;
  color: #64748b;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: color .2s ease, background .2s ease, box-shadow .2s ease;
}
.login-tabs button:hover { color: var(--login-primary); }
.login-tabs button.active {
  color: var(--login-primary-dark);
  background: #fff;
  box-shadow: 0 2px 8px rgba(15, 23, 42, .08);
}
.login-tabs button:focus-visible,
.primary:focus-visible,
.account-links a:focus-visible {
  outline: 3px solid rgba(37, 99, 235, .2);
  outline-offset: 2px;
}

.login-form { min-width: 0; }
.field {
  display: block;
  margin-bottom: 15px;
}
.field-label {
  display: block;
  margin-bottom: 7px;
  color: #334155;
  font-size: 12px;
  font-weight: 600;
}
.input-wrap { position: relative; display: block; }
.input-wrap svg {
  position: absolute;
  top: 50%;
  left: 14px;
  width: 17px;
  height: 17px;
  transform: translateY(-50%);
  fill: none;
  stroke: #94a3b8;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
  transition: stroke .2s ease;
}
.input-wrap:focus-within svg { stroke: var(--login-primary); }
.input-wrap input,
.token-field textarea {
  width: 100%;
  border: 1px solid #dbe3ee;
  border-radius: 10px;
  outline: none;
  color: #0f172a;
  background: #fff;
  font: inherit;
  font-size: 14px;
  transition: border-color .2s ease, box-shadow .2s ease, background .2s ease;
}
.input-wrap input {
  height: 44px;
  padding: 0 14px 0 42px;
}
.input-wrap input::placeholder,
.token-field textarea::placeholder { color: #a1adbd; }
.input-wrap input:hover,
.token-field textarea:hover { border-color: #b8c6d8; }
.input-wrap input:focus,
.token-field textarea:focus {
  border-color: var(--login-primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, .1);
}
.field-help {
  display: block;
  margin-top: 6px;
  color: #8492a6;
  font-size: 11px;
  line-height: 1.55;
}
.token-field textarea {
  min-height: 132px;
  padding: 12px 14px;
  resize: vertical;
  line-height: 1.65;
  word-break: break-all;
}
.captcha-wrap { margin-top: 2px; }
.captcha-wrap :deep(.auth-captcha) { margin-bottom: 0; }

.feedback-area { min-height: 0; }
.feedback {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 4px 0 12px;
  padding: 9px 11px;
  border: 1px solid;
  border-radius: 9px;
  font-size: 12px;
  line-height: 1.5;
}
.feedback svg {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  margin-top: 1px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.feedback.success { color: #047857; border-color: #bbf7d0; background: #f0fdf4; }
.feedback.error { color: #b91c1c; border-color: #fecaca; background: #fef2f2; }

.primary {
  width: 100%;
  min-height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  margin-top: 5px;
  padding: 10px 16px;
  border: 0;
  border-radius: 10px;
  color: #fff;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  box-shadow: 0 10px 22px -12px rgba(37, 99, 235, .85);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: transform .18s ease, box-shadow .18s ease, filter .18s ease;
}
.primary:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.04);
  box-shadow: 0 14px 28px -13px rgba(37, 99, 235, .95);
}
.primary:active:not(:disabled) { transform: translateY(0); }
.primary:disabled { cursor: not-allowed; opacity: .65; box-shadow: none; }
.primary > svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, .4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin .75s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.account-links {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
  color: #64748b;
  font-size: 12px;
}
.account-links a {
  color: var(--login-primary);
  font-weight: 600;
  text-decoration: none;
}
.account-links a:hover { color: var(--login-primary-dark); text-decoration: underline; }
.divider { width: 1px; height: 12px; background: #dbe3ee; }
.security-tip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: auto 0 0;
  padding-top: 25px;
  color: #94a3b8;
  font-size: 11px;
}
.security-tip svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

@media (max-width: 820px) {
  .login-page { padding: 24px; }
  .login-shell {
    width: min(100%, 500px);
    min-height: auto;
    display: block;
  }
  .brand-panel { display: none; }
  .form-panel { padding: 38px 42px 30px; }
  .mobile-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 27px;
    color: #1e3a8a;
    font-size: 15px;
    font-weight: 700;
  }
  .mobile-logo {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    color: #fff;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    box-shadow: 0 8px 18px -9px rgba(37, 99, 235, .9);
  }
  .mobile-logo svg { width: 20px; height: 20px; }
  .security-tip { margin-top: 0; }
}

@media (max-width: 576px) {
  .login-page {
    display: block;
    overflow-y: auto;
    padding: max(14px, env(safe-area-inset-top)) 12px max(14px, env(safe-area-inset-bottom));
  }
  .login-shell {
    width: 100%;
    min-height: calc(100vh - 28px);
    min-height: calc(100dvh - 28px);
    border-radius: 18px;
  }
  .form-panel {
    min-height: inherit;
    justify-content: center;
    padding: 28px 22px 22px;
  }
  .mobile-brand { margin-bottom: 23px; }
  .form-heading { margin-bottom: 19px; }
  .form-heading h1 { font-size: 24px; }
  .form-heading p { font-size: 12px; }
  .login-tabs { margin-bottom: 19px; }
  .login-tabs button { min-height: 42px; padding-inline: 7px; font-size: 12px; }
  .input-wrap input { height: 46px; font-size: 16px; }
  .token-field textarea { font-size: 16px; }
  .primary { min-height: 48px; }
  .security-tip { padding-top: 21px; }
}

@media (max-width: 380px) {
  .login-page { padding-inline: 8px; }
  .login-shell { min-height: calc(100dvh - 28px); border-radius: 15px; }
  .form-panel { padding: 24px 17px 18px; }
  .mobile-brand { margin-bottom: 18px; }
  .form-heading h1 { font-size: 22px; }
  .login-tabs button { font-size: 11.5px; }
  .account-links { gap: 8px; }
}

@media (max-height: 720px) and (min-width: 821px) {
  .login-page { place-items: start center; overflow-y: auto; padding-block: 20px; }
  .login-shell { min-height: 560px; }
  .brand-panel { padding-block: 36px 30px; }
  .form-panel { padding-block: 30px 24px; }
  .form-heading { margin-bottom: 16px; }
  .login-tabs { margin-bottom: 16px; }
  .field { margin-bottom: 11px; }
  .security-tip { padding-top: 18px; }
}

@media (max-height: 620px) and (max-width: 820px) {
  .login-page { display: block; overflow-y: auto; }
  .login-shell { margin: 0 auto; }
  .form-panel { justify-content: flex-start; padding-block: 25px 22px; }
  .mobile-brand { margin-bottom: 18px; }
  .security-tip { padding-top: 18px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
</style>
