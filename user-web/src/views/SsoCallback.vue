<!-- 忆梦云团队开发 - Jingpro SSO 回调 -->
<script setup>
import { onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import api from '../api'

const router = useRouter()
const route = useRoute()
const status = ref('loading')
const message = ref('正在登录，请稍候...')
const errorDetail = ref('')

function adminSsoUrl(data) {
  const configured = String(import.meta.env.VITE_ADMIN_WEB_URL || '').trim()
  let origin
  if (configured) {
    origin = new URL(configured, window.location.origin)
  } else {
    const current = new URL(window.location.origin)
    if (current.hostname.startsWith('user.')) current.hostname = `admin.${current.hostname.slice(5)}`
    else if (['localhost', '127.0.0.1'].includes(current.hostname) && current.port === '5175') current.port = '5174'
    else current.pathname = '/admin/'
    origin = current
  }
  const target = new URL('sso', origin.href.endsWith('/') ? origin.href : `${origin.href}/`)
  target.hash = `data=${encodeURIComponent(JSON.stringify({ token: data.token, admin: data.admin, userType: data.userType }))}`
  return target.href
}

onMounted(async () => {
  const token = typeof route.query.token === 'string' ? route.query.token.trim() : ''
  if (!token) {
    status.value = 'error'
    message.value = '缺少登录令牌参数'
    return
  }
  try {
    const res = await api.post('/integration/sso-login', { token })
    if (res.code === 200 && res.data?.token) {
      const data = res.data
      if (data.userType === 'admin') {
        status.value = 'success'
        message.value = '管理员身份验证成功，正在跳转平台后台...'
        window.location.replace(adminSsoUrl(data))
        return
      }
      if (!data.user || !data.tenant) throw new Error('登录响应缺少租户信息')
      sessionStorage.removeItem('tenant_impersonation')
      for (const key of ['tenant_token', 'tenant_user', 'tenant_info']) sessionStorage.removeItem(key)
      localStorage.setItem('tenant_token', data.token)
      localStorage.setItem('tenant_user', JSON.stringify(data.user))
      localStorage.setItem('tenant_info', JSON.stringify(data.tenant))
      status.value = 'success'
      message.value = '登录成功，正在跳转...'
      setTimeout(() => router.replace(data.redirect || '/messages'), 500)
    } else if (res.code === 40102) {
      status.value = 'error'
      message.value = '该登录链接已使用过，请返回 Jingpro 后台重新生成'
    } else {
      status.value = 'error'
      message.value = res.msg || res.message || '登录失败'
    }
  } catch (e) {
    status.value = 'error'
    message.value = e?.msg || e?.message || '网络错误，请重试'
    errorDetail.value = String(e?.code || '')
  }
})
</script>

<template>
  <div class="simple-page">
    <div class="simple-box">
      <h1>Jingpro 联动登录</h1>
      <div class="sub">正在通过鲸商城插件凭证登录客服后台</div>
      <div v-if="status === 'loading'" class="loading">登录中...</div>
      <div v-else-if="status === 'success'" class="success">
        <div class="status-icon">✓</div>
        {{ message }}
      </div>
      <div v-else class="err">
        <div class="status-icon">✗</div>
        <div>{{ message }}</div>
        <div v-if="errorDetail" class="err-code">错误码：{{ errorDetail }}</div>
        <router-link to="/login" class="back-link">返回登录页</router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.loading { color: #409EFF; margin-top: 20px; }
.success { color: #67C23A; margin-top: 20px; }
.err { color: #F56C6C; margin-top: 20px; }
.status-icon { font-size: 32px; margin-bottom: 12px; }
.err-code { font-size: 12px; opacity: 0.7; margin-top: 8px; }
.back-link {
  display: inline-block;
  margin-top: 20px;
  color: #409EFF;
  text-decoration: none;
}
.back-link:hover { text-decoration: underline; }
</style>
