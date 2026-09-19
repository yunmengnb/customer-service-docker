<!-- 忆梦云团队开发 - Jingpro 管理员 SSO 回调 -->
<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const error = ref('')

onMounted(() => {
  try {
    const params = new URLSearchParams(window.location.hash.slice(1))
    const data = JSON.parse(params.get('data') || '')
    if (data?.userType !== 'admin' || typeof data.token !== 'string' || !data.token || !data.admin || typeof data.admin !== 'object') {
      throw new Error('管理员登录数据无效')
    }
    localStorage.setItem('admin_token', data.token)
    localStorage.setItem('admin_info', JSON.stringify(data.admin))
    history.replaceState(null, '', window.location.pathname)
    router.replace('/dashboard')
  } catch (e) {
    history.replaceState(null, '', window.location.pathname)
    error.value = e?.message || '管理员登录失败'
  }
})
</script>

<template>
  <div class="login-wrap">
    <div class="login-box">
      <div class="login-brand">
        <div class="logo">Y</div>
        <h1>忆梦云客服</h1>
        <p class="sub">{{ error || '正在完成管理员登录...' }}</p>
      </div>
      <router-link v-if="error" class="btn btn-primary btn-lg" to="/login">返回登录页</router-link>
    </div>
  </div>
</template>
