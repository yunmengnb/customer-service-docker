<!-- 忆梦云团队开发 -->
<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api, { clearTenantSession } from '../api'
import { disconnectTenantSocket } from '../socket'
const route = useRoute(), router = useRouter()
const mode = computed(() => route.path === '/wechat-confirm' ? 'confirm' : route.path === '/wechat-login' ? 'login' : 'bind')
const company = ref(String(route.query.company || '')), password = ref(''), info = ref(null), ticket = ref(null), state = ref(''), selected = ref(''), busy = ref(false), feedback = ref(''), finished = ref(false)
let timer
const post = (path, data = {}) => api.post(`/wechat/staff/${path}`, data, { headers: { 'X-Wechat-Intent': 'staff-v1' } })
async function perform(fn) {
  if (busy.value) return
  busy.value = true; feedback.value = ''
  try { await fn() } catch (e) { feedback.value = e.message || '请求失败' }
  finally { password.value = ''; busy.value = false }
}
async function load() {
  if (mode.value === 'confirm') info.value = (await api.get(`/wechat/staff/confirm/${encodeURIComponent(String(route.query.id || ''))}`)).data
  else if (mode.value === 'bind') info.value = (await api.get('/wechat/staff/binding')).data
  else info.value = (await api.get(`/wechat/staff/context/${encodeURIComponent(company.value.trim())}`)).data
}
async function poll() {
  if (!ticket.value || finished.value) return
  if (ticket.value.expiresAt && Date.now() >= new Date(ticket.value.expiresAt).getTime()) {
    clearInterval(timer); state.value = 'expired'; feedback.value = '二维码已过期，请重新生成。'; return
  }
  try {
    const result = await api.get(`/wechat/staff/status/${ticket.value.id}`)
    state.value = result.data.state
    if (['consumed', 'cancelled'].includes(state.value)) clearInterval(timer)
  } catch (e) { feedback.value = e.message || '状态查询暂时失败，将自动重试。' }
}
async function start() {
  if (ticket.value) await post(`cancel/${ticket.value.id}`).catch(() => {})
  clearInterval(timer); finished.value = false
  ticket.value = (await post(mode.value, mode.value === 'bind' ? { password: password.value } : { publicCode: company.value.trim() })).data
  state.value = 'pending'; timer = setInterval(poll, 2500)
}
async function finish() {
  if (mode.value === 'confirm') {
    await post(`confirm/${encodeURIComponent(String(route.query.id || ''))}`, { confirm: true, bindingId: selected.value })
    finished.value = true; feedback.value = '已确认，请回到原浏览器完成操作。'; return
  }
  const result = await post(`${mode.value === 'bind' ? 'finish-bind' : 'redeem'}/${ticket.value.id}`, { confirm: true })
  finished.value = true; clearInterval(timer); ticket.value = null
  if (mode.value === 'bind') { await load(); feedback.value = '绑定成功。通知尚未开放。'; return }
  // 临时会话仅保存当前标签页，隔离已有本地账号，不覆盖其他窗口。
  sessionStorage.setItem('tenant_impersonation', '1')
  sessionStorage.setItem('tenant_token', result.data.token)
  sessionStorage.setItem('tenant_user', JSON.stringify(result.data.user))
  sessionStorage.setItem('tenant_info', JSON.stringify(result.data.tenant))
  feedback.value = '微信登录成功，正在进入客服工作台。'
  await new Promise(resolve => setTimeout(resolve, 300))
  await router.replace('/messages')
}
async function cancel() {
  if (state.value !== 'expired') await post(`cancel/${ticket.value.id}`)
  clearInterval(timer); ticket.value = null; state.value = ''; feedback.value = ''
}
async function unbind() {
  await post('unbind', { password: password.value })
  clearTenantSession()
  disconnectTenantSocket()
  feedback.value = '已解绑，该绑定的微信会话已撤销，请重新登录。'
  await router.replace('/login')
}
onMounted(() => { if (mode.value !== 'login' || company.value) perform(load) })
onUnmounted(() => clearInterval(timer))
</script>
<template>
  <main class="wx-page">
    <header><h1>{{ mode === 'confirm' ? '微信端明确确认' : mode === 'login' ? '企业客服微信登录' : '我的微信绑定' }}</h1><p>仅客服身份；绑定不等于关注，不发送模板通知。</p></header>
    <p v-if="feedback" role="status">{{ feedback }}</p>
    <form v-if="mode === 'login' && !ticket" @submit.prevent="perform(load)"><label>企业公开标识<input v-model="company" required maxlength="64" /></label><button :disabled="busy">确认企业</button></form>
    <section v-if="info">
      <h2>{{ info.company || info.account }}</h2><p v-if="info.company">公众号：{{ info.account }}</p>
      <template v-if="mode === 'confirm' && !finished">
        <p>用途：<strong>{{ info.purpose === 'bind' ? '绑定当前客服账号（不是登录）' : '授权原浏览器登录客服账号' }}</strong></p>
        <p>请核对原浏览器校验短语：<strong>{{ info.phrase }}</strong></p>
        <p v-if="info.purpose === 'bind'">目标客服：{{ info.subject }}。确认后还需原浏览器最终确认。</p>
        <fieldset v-else><legend>选择已有绑定身份（不会合并账号）</legend><label v-for="item in info.candidates" :key="item.id"><input v-model="selected" type="radio" :value="item.id" />{{ item.label }}</label><p v-if="!info.candidates.length">暂无可用绑定，请先在已登录客服浏览器绑定。</p></fieldset>
        <button :disabled="busy || (info.purpose === 'login' && !selected)" @click="perform(finish)">我已核对，明确同意</button>
      </template>
      <template v-if="mode === 'bind' && !ticket">
        <p>{{ info.bound ? '当前身份已绑定微信。解绑将撤销此绑定派生的微信登录。' : info.available ? '输入账号密码独立验证后，用微信扫描二维码。' : '企业尚未启用客服微信能力，请联系管理员。' }}</p>
        <form @submit.prevent="perform(info.bound ? unbind : start)"><label>当前账号密码<input v-model="password" type="password" autocomplete="current-password" required maxlength="200" /></label><button :disabled="busy || (!info.bound && !info.available)">{{ info.bound ? '确认解绑并撤销微信会话' : '生成绑定二维码' }}</button></form>
      </template>
      <button v-if="mode === 'login' && !ticket" :disabled="busy" @click="perform(start)">为此企业生成登录二维码</button>
    </section>
    <section v-if="ticket"><img :src="ticket.scanUrl" referrerpolicy="no-referrer" alt="请使用微信扫描授权二维码" /><p>校验短语：<strong>{{ ticket.phrase }}</strong></p><p>两分钟有效；请勿转发二维码。扫码不自动绑定或登录。</p><p>当前状态：{{ { pending: '等待扫码', scanned: '等待微信授权', oauth_verified: '等待微信端确认', confirmed: '微信端已确认，请在此完成', expired: '已失效，请重新生成', consumed: '已使用', cancelled: '已取消' }[state] || state }}</p><div class="actions"><button v-if="state === 'confirmed'" :disabled="busy" @click="perform(finish)">{{ mode === 'bind' ? '核对短语一致，完成绑定' : '确认登录此浏览器（2小时）' }}</button><button :disabled="busy" @click="perform(cancel)">{{ state === 'expired' ? '重新生成' : '取消' }}</button></div></section>
    <RouterLink :to="mode === 'login' || mode === 'confirm' ? '/login' : '/messages'">返回</RouterLink>
  </main>
</template>
<style scoped>
.wx-page{max-width:640px;margin:24px auto;padding:16px;color:#0f172a;overflow-wrap:anywhere}header{padding:24px;background:linear-gradient(135deg,#172554,#2563eb);color:white;border-radius:16px}h1{font-size:24px}h2{font-size:20px}section,form{padding:16px;margin:16px 0;border:1px solid #e2e8f0;border-radius:12px;background:white}label{display:block;margin:12px 0}input:not([type=radio]){display:block;box-sizing:border-box;width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:8px;margin-top:8px}button{min-height:44px;background:#2563eb;color:white;padding:10px 16px;border:0;border-radius:8px;cursor:pointer}button:disabled{opacity:.5;cursor:not-allowed}img{display:block;max-width:100%;height:auto;margin:auto}.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:16px}p{line-height:1.7}a{color:#2563eb}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}@media(max-width:576px){.wx-page{margin:0 auto;padding:12px}header{padding:16px}fieldset{min-width:0}}
</style>
