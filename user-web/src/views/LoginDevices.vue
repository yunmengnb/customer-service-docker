<!-- 忆梦云团队开发 -->
<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api, { clearTenantSession, getDeviceInfo } from '../api'
import { clearIdentityCache, tenantIdentityScope } from '../chatCache'

const router = useRouter()
const sessions = ref([])
const loading = ref(false)
const error = ref('')
const canManageDevices = ref(false)
const revokingId = ref('')

const currentDeviceId = getDeviceInfo().deviceId

function unwrap(response) {
  const data = response?.data ?? response
  return Array.isArray(data) ? data : (data?.sessions || data?.items || [])
}

function field(session, ...names) {
  for (const name of names) if (session?.[name] !== undefined && session?.[name] !== null && session?.[name] !== '') return session[name]
  return '—'
}

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}

function isCurrent(session) {
  return Boolean(session?.current || session?.isCurrent || field(session, 'deviceId', 'fingerprint') === currentDeviceId)
}

function loginMethod(session) {
  return field(session, 'loginType', 'method', 'loginMethod', 'authType')
}

function loginMethodLabel(session) {
  const method = loginMethod(session)
  if (['key', 'login_key'].includes(method)) return '密钥方式登录'
  if (method === 'wechat') return '微信登录'
  return '账号密码登录'
}

async function loadSessions() {
  loading.value = true
  error.value = ''
  try {
    sessions.value = unwrap(await api.get('/tenant/auth/sessions'))
    const currentSession = sessions.value.find(session => session?.current || session?.isCurrent)
      || sessions.value.find(session => field(session, 'deviceId', 'fingerprint') === currentDeviceId)
    canManageDevices.value = loginMethod(currentSession) === 'password'
  } catch (e) {
    canManageDevices.value = false
    error.value = e?.message || '登录设备加载失败'
  } finally {
    loading.value = false
  }
}

async function revoke(session) {
  if (!canManageDevices.value || revokingId.value) return
  if (!window.confirm(`确定要登出${isCurrent(session) ? '当前设备' : '该设备'}吗？`)) return
  const sessionId = session._id || session.id
  revokingId.value = sessionId
  error.value = ''
  try {
    await api.post(`/tenant/auth/sessions/${encodeURIComponent(sessionId)}/revoke`)
    if (isCurrent(session)) {
      const identityScope = tenantIdentityScope()
      await clearIdentityCache(identityScope)
      clearTenantSession()
      await router.replace('/login')
    } else {
      await loadSessions()
    }
  } catch (e) {
    error.value = e?.message || '设备登出失败'
  } finally {
    revokingId.value = ''
  }
}

onMounted(loadSessions)
</script>

<template>
  <section class="security-page">
    <div class="page-intro">
      <div><h1>登录设备</h1><p>查看并管理当前账号已登录的设备。</p></div>
      <button class="secondary" :disabled="loading" @click="loadSessions">刷新</button>
    </div>
    <div v-if="error" class="state error">{{ error }} <button @click="loadSessions">重试</button></div>
    <div v-else-if="loading" class="state">正在加载登录设备...</div>
    <div v-else-if="!sessions.length" class="state empty">暂无登录设备</div>
    <template v-else>
      <div v-if="!canManageDevices" class="manage-tip">仅账号密码登录可管理设备</div>
      <div class="device-list">
        <article v-for="session in sessions" :key="session._id || session.id" class="device-card">
          <div class="device-info">
            <div class="device-heading">
              <strong>{{ field(session, 'clientType', 'client') === 'app' ? 'APP设备登录' : '网页端设备登录' }}</strong>
              <span v-if="isCurrent(session)" class="current">当前设备</span>
            </div>
            <div class="details">
              <div><span>登录方式</span>{{ loginMethodLabel(session) }}</div>
              <div><span>IP</span>{{ field(session, 'ip', 'ipAddress') }}</div>
              <div><span>浏览器指纹</span>{{ field(session, 'fingerprint', 'deviceId') }}</div>
              <div><span>设备名称</span>{{ field(session, 'deviceName', 'name') }}</div>
              <div><span>浏览器</span>{{ field(session, 'browser', 'browserName') }}</div>
              <div><span>操作系统</span>{{ field(session, 'os', 'operatingSystem') }}</div>
              <div><span>登录时间</span>{{ formatTime(field(session, 'loginAt', 'createdAt')) }}</div>
              <div><span>最近活跃</span>{{ formatTime(field(session, 'lastActiveAt', 'updatedAt')) }}</div>
            </div>
          </div>
          <button v-if="canManageDevices" class="danger" :disabled="Boolean(revokingId)" @click="revoke(session)">{{ revokingId === (session._id || session.id) ? '登出中...' : '登出' }}</button>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.security-page { max-width: 1040px; margin: 0 auto; color: #0f172a; }
.page-intro { display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:18px; }
h1 { margin:0; font-size:22px; } .page-intro p { margin:6px 0 0; color:#64748b; font-size:13px; }
.manage-tip { margin-bottom:14px; padding:12px 16px; border:1px solid #fde68a; border-radius:10px; color:#92400e; background:#fffbeb; font-size:13px; }
.device-list { display:grid; gap:14px; }.device-card { display:flex; align-items:center; gap:20px; padding:20px; border:1px solid #e2e8f0; border-radius:14px; background:#fff; box-shadow:0 4px 15px rgba(15,23,42,.04); }.device-info { flex:1; min-width:0; }.device-heading { display:flex; align-items:center; gap:9px; margin-bottom:14px; }.current { padding:3px 8px; border-radius:10px; color:#047857; background:#d1fae5; font-size:11px; }.details { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px 22px; color:#334155; font-size:13px; overflow-wrap:anywhere; }.details span { display:inline-block; min-width:82px; color:#94a3b8; }
button { font:inherit; cursor:pointer; }.secondary,.danger { padding:9px 16px; border-radius:9px; font-weight:600; }.secondary { border:1px solid #cbd5e1; color:#475569; background:#fff; }.danger { border:1px solid #dc2626; color:#fff; background:#dc2626; }.danger:disabled,.secondary:disabled { cursor:not-allowed; opacity:.55; }.state { padding:50px 20px; border:1px solid #e2e8f0; border-radius:14px; text-align:center; color:#64748b; background:#fff; }.state.error { color:#b91c1c; }.state button { margin-left:8px; border:0; color:#2563eb; background:transparent; }.empty { color:#94a3b8; }
@media (max-width:768px) { .security-page { padding:14px; }.page-intro h1 { display:none; }.page-intro { margin-bottom:12px; }.device-card { align-items:stretch; flex-direction:column; padding:16px; }.details { grid-template-columns:1fr; }.details span { min-width:78px; }.device-card>.danger { width:100%; } }
</style>
