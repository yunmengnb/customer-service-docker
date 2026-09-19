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
const captcha = ref(null)
const err = ref('')
const needsTenant = ref(false)
const loading = ref(false)

const notice = computed(() => {
  if (route.query.registered === '1') return '注册成功，请登录'
  if (route.query.reset === '1') return '密码已重置，请使用新密码登录'
  return ''
})

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
    err.value = e?.message || '网络错误'
    if (e?.code === 4092 || e?.httpStatus === 409) needsTenant.value = true
    await captcha.value?.reset()
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  try {
    const res = await api.get('/tenant/public-settings')
    registerEnabled.value = res.data?.registerEnabled !== false
  } catch (_) {}
})
</script>

<template>
  <div class="simple-page">
    <div class="simple-box">
      <h1>客服后台</h1>
      <div class="sub">管理员与员工使用同一账号入口登录</div>
      <div class="login-tabs">
        <button type="button" :class="{ active: loginMode === 'password' }" @click="loginMode = 'password'; err = ''">账号密码</button>
        <button type="button" :class="{ active: loginMode === 'token' }" @click="loginMode = 'token'; err = ''">员工密钥</button>
      </div>

      <template v-if="loginMode === 'password'">
        <input v-model="form.username" autocomplete="username" placeholder="用户名或邮箱" @keyup.enter="doLogin" />
        <input v-if="needsTenant || form.tenant" v-model.trim="form.tenant" autocomplete="organization" placeholder="租户账号或租户标识" @keyup.enter="doLogin" />
        <input v-model="form.password" type="password" autocomplete="current-password" placeholder="密码" @keyup.enter="doLogin" />
        <AuthCaptcha ref="captcha" @submit="doLogin" />
      </template>
      <textarea v-else v-model.trim="employeeToken" rows="5" autocomplete="off" placeholder="请粘贴 Jingpro 员工密钥" @keyup.ctrl.enter="doLogin"></textarea>
      <div v-if="notice && !err" class="success">{{ notice }}</div>
      <div v-if="err" class="err">{{ err }}</div>
      <button type="button" class="primary" @click="doLogin" :disabled="loading">
        {{ loading ? '登录中...' : '登录' }}
      </button>
      <div v-if="loginMode === 'password'" class="link-row"><router-link to="/forgot-password">忘记密码？</router-link></div>
      <div v-if="registerEnabled && loginMode === 'password'" class="link-row">
        还没有账号？<router-link to="/register">立即注册</router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-tabs { display: flex; gap: 8px; margin: 14px 0; }
.login-tabs button { flex: 1; border: 1px solid #dcdfe6; background: #fff; color: #606266; }
.login-tabs button.active { border-color: #409eff; color: #409eff; background: #ecf5ff; }
textarea { width: 100%; box-sizing: border-box; resize: vertical; }
button.primary {
  background: #409EFF;
  color: #fff;
  border: none;
  margin-top: 14px;
}
button.primary:disabled {
  background: #a0cfff;
  cursor: not-allowed;
}
</style>
