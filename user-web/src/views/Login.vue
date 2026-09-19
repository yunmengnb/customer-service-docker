<!-- 忆梦云团队开发 -->
<script setup>
import { computed, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import api from '../api'
import AuthCaptcha from '../components/AuthCaptcha.vue'

const router = useRouter()
const route = useRoute()
const form = ref({ username: '', password: '', tenant: '' })
const captcha = ref(null)
const err = ref('')
const needsTenant = ref(false)
const loading = ref(false)

const notice = computed(() => {
  if (route.query.registered === '1') return '注册成功，请登录'
  if (route.query.reset === '1') return '密码已重置，请使用新密码登录'
  return ''
})

async function doLogin() {
  if (loading.value) return
  err.value = ''
  if (!form.value.username || !form.value.password) {
    err.value = '请填写完整'
    return
  }
  loading.value = true
  try {
    const captchaPayload = await captcha.value.verify()
    const res = await api.post('/tenant/auth/login', { ...form.value, ...captchaPayload })
    if (res.code === 0) {
      sessionStorage.removeItem('tenant_impersonation')
      sessionStorage.removeItem('tenant_token')
      sessionStorage.removeItem('tenant_user')
      sessionStorage.removeItem('tenant_info')
      localStorage.setItem('tenant_token', res.data.token)
      localStorage.setItem('tenant_user', JSON.stringify(res.data.user))
      localStorage.setItem('tenant_info', JSON.stringify(res.data.tenant))
      const target = typeof route.query.redirect === 'string' ? route.query.redirect : '/messages'
      router.replace(target)
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
</script>

<template>
  <div class="simple-page">
    <div class="simple-box">
      <h1>客服后台</h1>
      <div class="sub">管理员与员工使用同一账号入口登录</div>

      <input v-model="form.username" autocomplete="username" placeholder="用户名" @keyup.enter="doLogin" />
      <input v-if="needsTenant || form.tenant" v-model.trim="form.tenant" autocomplete="organization" placeholder="租户账号或租户标识" @keyup.enter="doLogin" />
      <input v-model="form.password" type="password" autocomplete="current-password" placeholder="密码" @keyup.enter="doLogin" />
      <AuthCaptcha ref="captcha" @submit="doLogin" />
      <div v-if="notice && !err" class="success">{{ notice }}</div>
      <div v-if="err" class="err">{{ err }}</div>
      <button type="button" class="primary" @click="doLogin" :disabled="loading">
        {{ loading ? '登录中...' : '登录' }}
      </button>
      <div class="link-row"><router-link to="/forgot-password">忘记密码？</router-link></div>
      <div class="link-row">
        还没有账号？<router-link to="/register">立即注册</router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
