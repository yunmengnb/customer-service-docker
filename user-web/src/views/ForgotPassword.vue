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
  if (f.newPassword.length < 6) return (err.value = '新密码至少6位')
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
  <div class="simple-page">
    <form class="simple-box" @submit.prevent="resetPassword">
      <h1>找回密码</h1>
      <div class="sub">通过客服后台注册邮箱验证身份并设置新密码</div>
      <input v-model.trim="form.email" type="email" autocomplete="email" placeholder="注册邮箱" />
      <div class="code-row">
        <input v-model.trim="form.emailCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6位邮箱验证码" />
        <button type="button" :disabled="sending" @click="sendCode">{{ sending ? '发送中...' : '发送验证码' }}</button>
      </div>
      <input v-model="form.newPassword" type="password" autocomplete="new-password" placeholder="新密码（6-72位）" />
      <input v-model="form.confirmPassword" type="password" autocomplete="new-password" placeholder="再次输入新密码" />
      <div v-if="notice && !err" class="success">{{ notice }}</div>
      <div v-if="err" class="err">{{ err }}</div>
      <button type="submit" :disabled="resetting">{{ resetting ? '重置中...' : '重置密码' }}</button>
      <div class="link-row"><router-link to="/login">返回登录</router-link></div>
    </form>
  </div>
</template>
