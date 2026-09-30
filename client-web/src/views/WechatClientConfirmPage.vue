<!-- 忆梦云团队开发 -->
<template>
  <main class="wechat-confirm-page">
    <section class="wechat-confirm-card" aria-live="polite">
      <div class="wechat-mark">微</div>
      <p class="wechat-eyebrow">微信公众号安全确认</p>
      <h1>{{ title }}</h1>

      <div v-if="loading" class="wechat-confirm-state">正在核验本次微信操作...</div>

      <template v-else-if="context">
        <dl class="wechat-confirm-summary">
          <div><dt>公众号</dt><dd>{{ context.account }}</dd></div>
          <div><dt>客服渠道</dt><dd>{{ context.channel }}</dd></div>
          <div v-if="context.subject"><dt>绑定身份</dt><dd>{{ context.subject }}</dd></div>
          <div><dt>安全短语</dt><dd class="wechat-phrase">{{ context.phrase }}</dd></div>
        </dl>

        <fieldset v-if="context.purpose === 'login'" class="wechat-candidates">
          <legend>选择要恢复的身份</legend>
          <label v-for="candidate in context.candidates" :key="candidate.id" :class="{ selected: selectedBindingId === candidate.id }">
            <input v-model="selectedBindingId" type="radio" name="binding" :value="candidate.id" />
            <span><strong>{{ candidate.label }}</strong><small>{{ candidate.subjectType === 'visitor' ? '仅恢复该访客的当前会话' : '恢复此渠道的客户会话' }}</small></span>
          </label>
          <p v-if="!context.candidates.length" class="wechat-confirm-error">当前微信没有可用于此渠道的已绑定身份。</p>
        </fieldset>

        <p class="wechat-confirm-tip">请确认公众号、渠道和安全短语。{{ context.authMode === 'direct' ? '当前为同一微信浏览器直接授权，确认后可在本页安全完成操作。' : '确认后仍需回到原浏览器完成绑定或登录。' }}</p>
        <p v-if="message" :class="['wechat-confirm-message', success ? 'success' : 'error']">{{ message }}</p>
        <button v-if="!success" class="wechat-confirm-primary" type="button" :disabled="submitting || (context.purpose === 'login' && !selectedBindingId)" @click="confirm">
          {{ submitting ? '确认中...' : (context.purpose === 'bind' ? '确认绑定此微信' : '确认使用所选身份登录') }}
        </button>
        <button v-else-if="context.authMode === 'direct' && context.channelPublicToken" class="wechat-confirm-primary" type="button" @click="returnToConversation">
          返回当前会话
        </button>
      </template>

      <template v-else>
        <p class="wechat-confirm-message error">{{ message || '本次微信操作已过期或无效，请回到原浏览器重新发起。' }}</p>
        <button class="wechat-confirm-secondary" type="button" @click="closePage">关闭页面</button>
      </template>
    </section>
  </main>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import api from '../api'

const route = useRoute()
const challengeId = computed(() => String(route.query.id || ''))
const loading = ref(true)
const submitting = ref(false)
const context = ref(null)
const selectedBindingId = ref('')
const message = ref('')
const success = ref(false)
const title = computed(() => context.value?.purpose === 'bind' ? '确认绑定当前身份' : '确认微信授权登录')

async function loadContext() {
  loading.value = true
  message.value = ''
  try {
    if (!/^[a-f0-9]{24}$/.test(challengeId.value)) throw new Error('确认链接无效')
    const res = await api.get(`/wechat/client/confirm/${challengeId.value}`)
    if (res.code !== 0 || !res.data) throw new Error(res.message || '无法读取确认信息')
    context.value = res.data
    if (res.data.candidates?.length === 1) selectedBindingId.value = res.data.candidates[0].id
  } catch (error) {
    context.value = null
    message.value = error?.message || '本次微信操作已过期或无效'
  } finally {
    loading.value = false
  }
}

async function confirm() {
  if (submitting.value) return
  submitting.value = true
  message.value = ''
  try {
    const res = await api.post(`/wechat/client/confirm/${challengeId.value}`, {
      confirm: true,
      ...(context.value.purpose === 'login' ? { bindingId: selectedBindingId.value } : {}),
    })
    if (res.code !== 0) throw new Error(res.message || '确认失败')
    if (context.value.authMode === 'direct') {
      const endpoint = context.value.purpose === 'bind' ? 'finish-bind' : 'redeem'
      const finished = await api.post(`/wechat/client/${endpoint}/${challengeId.value}`, context.value.purpose === 'bind' ? { confirm: true } : {})
      if (finished.code !== 0) throw new Error(finished.message || '微信操作失败')
      if (context.value.purpose === 'login') {
        if (!finished.data?.token || !context.value.channelPublicToken) throw new Error('登录结果无效')
        localStorage.setItem('client_token', finished.data.token)
        window.location.replace(`/c/${encodeURIComponent(context.value.channelPublicToken)}`)
        return
      }
      success.value = true
      message.value = '绑定成功，可以返回当前会话继续使用。'
      return
    }
    success.value = true
    message.value = '确认成功，请回到原浏览器继续。此页面可以关闭。'
  } catch (error) {
    success.value = false
    message.value = error?.message || '确认失败，请回到原浏览器重新发起'
  } finally {
    submitting.value = false
  }
}

function returnToConversation() {
  if (!context.value?.channelPublicToken) return
  window.location.replace(`/c/${encodeURIComponent(context.value.channelPublicToken)}`)
}

function closePage() {
  window.close()
  if (!window.closed) window.history.back()
}

onMounted(() => {
  document.title = '微信安全确认'
  window.history.replaceState({}, document.title, '/wechat-client-confirm')
  loadContext()
})
</script>

<style scoped>
.wechat-confirm-page { min-height: 100dvh; display: grid; place-items: center; padding: 24px; background: linear-gradient(145deg, #eff6ff, #f8fafc 48%, #ecfdf5); color: #0f172a; }
.wechat-confirm-card { width: min(520px, 100%); padding: 32px; border: 1px solid rgba(226,232,240,.9); border-radius: 22px; background: rgba(255,255,255,.96); box-shadow: 0 22px 65px rgba(37,99,235,.14); }
.wechat-mark { width: 52px; height: 52px; display: grid; place-items: center; border-radius: 16px; background: #07c160; color: #fff; font-size: 22px; font-weight: 800; box-shadow: 0 12px 28px rgba(7,193,96,.22); }
.wechat-eyebrow { margin: 18px 0 5px; color: #2563eb; font-size: 12px; font-weight: 800; letter-spacing: .08em; }
h1 { margin: 0 0 22px; font-size: 27px; }
.wechat-confirm-state { padding: 36px 0; color: #64748b; text-align: center; }
.wechat-confirm-summary { display: grid; gap: 10px; margin: 0; }
.wechat-confirm-summary div { display: flex; justify-content: space-between; gap: 16px; padding: 13px 14px; border-radius: 11px; background: #f8fafc; }
dt { color: #64748b; font-size: 13px; } dd { margin: 0; text-align: right; font-size: 14px; font-weight: 700; }
.wechat-phrase { color: #1d4ed8; font-family: 'DM Sans', monospace; letter-spacing: .14em; }
.wechat-candidates { display: grid; gap: 9px; margin: 20px 0 0; padding: 0; border: 0; }
.wechat-candidates legend { margin-bottom: 10px; font-size: 14px; font-weight: 800; }
.wechat-candidates label { display: flex; align-items: center; gap: 11px; padding: 13px; border: 1px solid #e2e8f0; border-radius: 12px; cursor: pointer; }
.wechat-candidates label.selected { border-color: #60a5fa; background: #eff6ff; }
.wechat-candidates span, .wechat-candidates strong, .wechat-candidates small { display: block; }
.wechat-candidates span { min-width: 0; } .wechat-candidates strong { font-size: 14px; } .wechat-candidates small { margin-top: 4px; color: #64748b; font-size: 12px; }
.wechat-confirm-tip { margin: 20px 0 14px; color: #64748b; font-size: 13px; line-height: 1.7; }
.wechat-confirm-message { padding: 11px 12px; border-radius: 10px; font-size: 13px; line-height: 1.5; }
.wechat-confirm-message.success { background: #ecfdf5; color: #047857; } .wechat-confirm-message.error, .wechat-confirm-error { background: #fef2f2; color: #b91c1c; }
.wechat-confirm-primary, .wechat-confirm-secondary { width: 100%; min-height: 48px; margin-top: 10px; border: 0; border-radius: 11px; font-weight: 800; cursor: pointer; }
.wechat-confirm-primary { background: #07c160; color: #fff; } .wechat-confirm-secondary { background: #e2e8f0; color: #334155; }
.wechat-confirm-primary:disabled { opacity: .55; cursor: not-allowed; }
@media (max-width: 576px) { .wechat-confirm-page { padding: 12px; align-items: end; } .wechat-confirm-card { padding: 22px 18px; border-radius: 20px; } h1 { font-size: 23px; } }
</style>
