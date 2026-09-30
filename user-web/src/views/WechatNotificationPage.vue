<!-- 忆梦云团队开发 -->
<template>
  <main class="notification-page">
    <section class="notification-card" aria-live="polite">
      <div class="notification-mark">微</div>
      <p class="eyebrow">微信公众号客服消息</p>
      <h1>{{ done ? '正在进入会话' : '正在安全核验' }}</h1>
      <p>{{ message }}</p>
      <button v-if="failed" type="button" @click="back">返回重新打开通知</button>
    </section>
  </main>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'

const route = useRoute()
const router = useRouter()
const message = ref('正在确认公众号、客服身份和当前处理权限，请稍候。')
const failed = ref(false)
const done = ref(false)

function back() { window.history.back() }

onMounted(async () => {
  window.history.replaceState({}, document.title, '/wechat-notification')
  if (route.query.failed === '1') {
    failed.value = true
    message.value = '通知链接已失效、已使用，或当前微信无权处理该会话。'
    return
  }
  try {
    const result = await api.post('/wechat/notification/exchange', {}, { headers: { 'X-Wechat-Intent': 'notification-v1' } })
    if (result.code !== 0 || !result.data?.token || result.data.subjectType !== 'staff') throw new Error(result.message || '兑换失败')
    sessionStorage.setItem('tenant_impersonation', '1')
    sessionStorage.setItem('tenant_token', result.data.token)
    sessionStorage.setItem('tenant_user', JSON.stringify(result.data.user))
    sessionStorage.setItem('tenant_info', JSON.stringify(result.data.tenant))
    done.value = true
    message.value = '验证成功，正在打开准确会话。'
    const prefix = window.matchMedia('(max-width: 768px)').matches ? '/m' : '/desktop'
    await router.replace(`${prefix}/messages/${encodeURIComponent(result.data.conversationId)}`)
  } catch (error) {
    failed.value = true
    message.value = error?.message || '通知链接已失效、已使用，或当前微信无权处理该会话。'
  }
})
</script>

<style scoped>
.notification-page{min-height:100dvh;display:grid;place-items:center;padding:20px;background:linear-gradient(145deg,#eff6ff,#f8fafc 50%,#ecfdf5);color:#0f172a}.notification-card{width:min(480px,100%);box-sizing:border-box;padding:32px;border:1px solid #e2e8f0;border-radius:22px;background:rgba(255,255,255,.96);box-shadow:0 22px 65px rgba(37,99,235,.14)}.notification-mark{width:52px;height:52px;display:grid;place-items:center;border-radius:16px;background:#07c160;color:#fff;font-size:22px;font-weight:800}.eyebrow{margin:18px 0 5px;color:#2563eb;font-size:12px;font-weight:800;letter-spacing:.08em}h1{margin:0 0 16px;font-size:27px}p{line-height:1.7}button{width:100%;min-height:48px;margin-top:12px;border:0;border-radius:11px;background:#2563eb;color:#fff;font-weight:700}@media(max-width:576px){.notification-page{align-items:end;padding:12px}.notification-card{padding:24px 18px;border-radius:20px}h1{font-size:23px}}
</style>
