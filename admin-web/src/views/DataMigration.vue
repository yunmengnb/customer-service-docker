<!-- 忆梦云团队开发 -->
<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import api from '../api'

const loading = ref(true)
const busy = ref(false)
const notice = ref('')
const loadError = ref('')
const overview = ref(null)
const oneTimeKey = ref('')
const featureDialog = ref(false)
const startDialog = ref(false)
const keyDialog = ref(false)
const featureForm = reactive({ currentPassword: '' })
const startForm = reactive({ overwriteConfirmed: false, currentPassword: '' })
const grant = reactive({ expectedSourceIp: '', currentPassword: '' })
const source = reactive({ targetUrl: '', migrationKey: '', targetIp: '' })
let poller

const setting = computed(() => overview.value?.setting || null)
const tasks = computed(() => overview.value?.tasks || [])
const visibleTasks = computed(() => tasks.value.slice(0, 5))
const activeStates = new Set([
  'preflight', 'awaiting_confirmation', 'freezing_source', 'exporting',
  'transferring', 'target_backup', 'importing_staging', 'verifying',
  'staging_verified', 'quiescing', 'switching', 'restart_pending', 'rolling_back',
  'manual_intervention',
])
const activeTask = computed(() => tasks.value.find(task => activeStates.has(task.state)))
const canStart = computed(() => Boolean(
  setting.value?.enabled
  && !activeTask.value
  && !busy.value
  && source.targetUrl
  && source.migrationKey
  && source.targetIp,
))

const stageLabels = {
  preflight: '准备连接',
  awaiting_confirmation: '等待开始',
  freezing_source: '锁定当前站数据',
  exporting: '整理当前站数据',
  transferring: '传输数据',
  target_backup: '备份目标站原数据',
  importing_staging: '导入目标站',
  verifying: '校验数据',
  staging_verified: '安全校验未通过',
  quiescing: '准备覆盖目标站',
  switching: '覆盖目标站数据',
  restart_pending: '应用新数据',
  completed: '迁移完成',
  failed: '迁移失败',
  cancelled: '已取消',
  rolling_back: '正在恢复目标站',
  rolled_back: '已恢复目标站',
  manual_intervention: '需要人工处理',
}

const statusLabels = {
  completed: '成功',
  failed: '失败',
  cancelled: '已取消',
  rolled_back: '已恢复',
  manual_intervention: '需处理',
}

const errorMessages = {
  TARGET_URL_INVALID: '目标站地址无效',
  TARGET_URL_UNSAFE: '目标站地址必须使用 HTTPS，且不能包含账号或特殊片段',
  TARGET_IP_UNSAFE: '目标服务器 IP 必须是合法公网 IP',
  TARGET_DNS_PIN_MISMATCH: '服务器 IP 与目标站解析结果不匹配',
  TARGET_TIMEOUT: '目标站连接超时，请检查地址、IP 和网络',
  MIGRATION_TOKEN_INVALID: '迁移密钥无效、已过期或已被使用',
  MIGRATION_SOURCE_IP_MISMATCH: '当前站 IP 与目标站密钥授权不匹配',
}

function friendlyError(err) {
  const raw = String(err?.message || '')
  return errorMessages[raw] || raw || '操作失败，请稍后重试'
}

function showError(err) {
  const requestId = err?.requestId
  notice.value = `${friendlyError(err)}${requestId ? `（请求 ID：${requestId}）` : ''}`
}

function stateClass(state) {
  if (state === 'completed') return 'tag-green'
  if (['failed', 'cancelled', 'rolled_back', 'manual_intervention', 'staging_verified'].includes(state)) return 'tag-red'
  return 'tag-blue'
}

function taskMessage(task) {
  if (task.state === 'completed') return '迁移完成'
  if (task.safeError) return task.safeError
  return task.logs?.at(-1)?.message || '等待处理'
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString() : '尚未开始'
}

async function load(silent = false) {
  try {
    overview.value = (await api.get('/migration/admin/overview')).data
    loadError.value = ''
  } catch (err) {
    loadError.value = friendlyError(err)
    if (!silent) showError(err)
  } finally {
    loading.value = false
  }
}

function openFeatureDialog() {
  featureForm.currentPassword = ''
  featureDialog.value = true
}

async function toggleFeature() {
  busy.value = true
  try {
    const enabling = !setting.value?.enabled
    const confirmPhrase = enabling ? '启用数据迁移功能' : '停用数据迁移功能'
    const res = await api.post(`/migration/admin/settings/${enabling ? 'enable' : 'disable'}`, {
      confirmPhrase,
      currentPassword: featureForm.currentPassword,
    })
    notice.value = enabling ? '数据迁移功能已启用' : '数据迁移功能已停用'
    featureDialog.value = false
    featureForm.currentPassword = ''
    await load(true)
  } catch (err) {
    showError(err)
  } finally {
    busy.value = false
  }
}

function validateSource() {
  try {
    const url = new URL(source.targetUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) {
      throw new Error('TARGET_URL_UNSAFE')
    }
  } catch (err) {
    notice.value = friendlyError(err?.message === 'TARGET_URL_UNSAFE' ? err : { message: 'TARGET_URL_INVALID' })
    return false
  }
  if (!source.migrationKey.trim()) {
    notice.value = '请填写目标站生成的迁移密钥'
    return false
  }
  if (!source.targetIp.trim()) {
    notice.value = '请填写目标服务器公网 IP'
    return false
  }
  return true
}

function openStartDialog() {
  if (!validateSource()) return
  startForm.overwriteConfirmed = false
  startForm.currentPassword = ''
  startDialog.value = true
}

async function startMigration() {
  if (!startForm.overwriteConfirmed || !startForm.currentPassword) return
  busy.value = true
  try {
    const password = startForm.currentPassword
    const preflight = await api.post('/migration/admin/preflight', {
      targetUrl: source.targetUrl,
      targetIp: source.targetIp,
      migrationKey: source.migrationKey,
      currentPassword: password,
    })
    await api.post(`/migration/admin/tasks/${preflight.data.taskId}/start`, {
      instanceName: preflight.data.targetInstanceName,
      confirmPhrase: '目标站原数据将被覆盖',
      overwriteConfirmed: true,
      currentPassword: password,
    })
    source.migrationKey = ''
    startForm.currentPassword = ''
    startForm.overwriteConfirmed = false
    startDialog.value = false
    notice.value = '迁移已开始，可在下方查看任务进度'
    await load(true)
  } catch (err) {
    showError(err)
    await load(true)
  } finally {
    busy.value = false
  }
}

function openKeyDialog() {
  grant.currentPassword = ''
  keyDialog.value = true
}

async function generateKey() {
  busy.value = true
  oneTimeKey.value = ''
  try {
    const res = await api.post('/migration/admin/grants', grant)
    oneTimeKey.value = res.data.key
    grant.currentPassword = ''
    keyDialog.value = false
    notice.value = '本站迁入密钥已生成：10 分钟有效、仅显示一次'
    await load(true)
  } catch (err) {
    showError(err)
  } finally {
    busy.value = false
  }
}

async function copyKey() {
  try {
    await navigator.clipboard.writeText(oneTimeKey.value)
    notice.value = '迁移密钥已复制'
  } catch {
    notice.value = '复制失败，请手动复制并妥善保存'
  }
}

onMounted(() => {
  load()
  poller = setInterval(() => load(true), 4000)
})
onUnmounted(() => clearInterval(poller))
</script>

<template>
  <div class="migration-page">
    <header class="page-header">
      <div>
        <h2>数据迁移</h2>
        <p>将当前站的数据安全推送到目标站，并覆盖目标站原数据。</p>
      </div>
      <div v-if="setting" class="feature-state">
        <span class="status-dot" :class="{ enabled: setting.enabled }"></span>
        <strong>{{ setting.enabled ? '已启用' : '未启用' }}</strong>
        <button class="btn btn-ghost btn-sm" :disabled="busy || Boolean(activeTask)" @click="openFeatureDialog">
          {{ setting.enabled ? '停用' : '启用数据迁移' }}
        </button>
      </div>
    </header>

    <div v-if="notice" class="migration-notice" role="status">{{ notice }}</div>
    <div v-if="loading" class="card migration-card">正在加载迁移状态...</div>

    <template v-else-if="overview">
      <section v-if="setting?.enabled" class="card migration-card start-card">
        <div class="card-title">
          <div>
            <h3>迁移到目标站</h3>
            <p>以下密钥应由目标站生成。点击一次“开始迁移”，系统将自动检查连接并开始任务。</p>
          </div>
        </div>
        <div class="migration-form">
          <label>
            <span>目标站点地址</span>
            <input v-model.trim="source.targetUrl" class="input" type="url" inputmode="url" placeholder="https://target.example.com" autocomplete="url" />
          </label>
          <label>
            <span>迁移密钥</span>
            <input v-model="source.migrationKey" class="input" type="password" placeholder="填写目标站生成的密钥" autocomplete="off" />
          </label>
          <label>
            <span>目标服务器 IP</span>
            <input v-model.trim="source.targetIp" class="input" placeholder="例如 203.0.113.20" autocapitalize="off" />
          </label>
        </div>
        <button class="btn btn-primary start-button" :disabled="!canStart" @click="openStartDialog">
          {{ activeTask ? '已有迁移任务进行中' : '开始迁移' }}
        </button>
      </section>

      <section v-else class="card migration-card disabled-state">
        <h3>启用后即可开始迁移</h3>
        <p>启用操作需要重新验证超级管理员密码。</p>
        <button class="btn btn-primary" :disabled="busy" @click="openFeatureDialog">启用数据迁移</button>
      </section>

      <section v-if="setting?.enabled" class="card migration-card key-card">
        <div>
          <h3>允许其他站点迁入本站</h3>
          <p>这里生成的是本站密钥，仅供其他站点把数据迁入本站，不要填入上方迁出表单。</p>
        </div>
        <div class="key-actions">
          <input v-model.trim="grant.expectedSourceIp" class="input" placeholder="可选：绑定对方站点公网 IP" />
          <button class="btn btn-ghost" :disabled="busy || Boolean(activeTask)" @click="openKeyDialog">生成本站迁入密钥</button>
        </div>
        <div v-if="oneTimeKey" class="secret-box">
          <code>{{ oneTimeKey }}</code>
          <button class="btn btn-ghost btn-sm" @click="copyKey">复制</button>
        </div>
      </section>

      <section class="card migration-card tasks-card">
        <div class="card-title">
          <div>
            <h3>任务进度</h3>
            <p>页面刷新后仍会恢复当前或最近任务。</p>
          </div>
        </div>
        <div v-if="!visibleTasks.length" class="empty-state">
          <strong>暂无迁移任务</strong>
          <span>开始迁移后，进度会显示在这里。</span>
        </div>
        <article v-for="task in visibleTasks" :key="task._id || task.taskId" class="task-row">
          <div class="task-head">
            <div>
              <strong>{{ task.targetInstanceName || '迁移任务' }}</strong>
              <span class="task-time">开始时间：{{ formatTime(task.startedAt) }}</span>
            </div>
            <span class="tag" :class="stateClass(task.state)">{{ statusLabels[task.state] || '进行中' }}</span>
          </div>
          <div class="task-progress-title">
            <span>{{ stageLabels[task.state] || '处理中' }}</span>
            <strong>{{ task.percent || 0 }}%</strong>
          </div>
          <div class="progress" :aria-label="`迁移进度 ${task.percent || 0}%`">
            <i :style="{ width: `${Math.max(0, Math.min(100, task.percent || 0))}%` }"></i>
          </div>
          <p class="task-message">{{ taskMessage(task) }}</p>
          <p v-if="task.requestId && ['failed', 'manual_intervention', 'staging_verified'].includes(task.state)" class="request-id">请求 ID：{{ task.requestId }}</p>
        </article>
      </section>
    </template>

    <section v-else class="card migration-card load-failure" role="alert">
      <h3>迁移状态暂不可用</h3>
      <p>{{ loadError || '请稍后重试。' }}</p>
      <button class="btn btn-primary" :disabled="busy" @click="load()">重新加载</button>
    </section>

    <div v-if="featureDialog" class="modal-backdrop" @click.self="featureDialog = false">
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="feature-title">
        <h3 id="feature-title">{{ setting?.enabled ? '停用数据迁移' : '启用数据迁移' }}</h3>
        <p>请输入当前超级管理员密码完成验证。</p>
        <label>
          <span>管理员密码</span>
          <input v-model="featureForm.currentPassword" class="input" type="password" autocomplete="current-password" @keyup.enter="toggleFeature" />
        </label>
        <div class="modal-actions">
          <button class="btn btn-ghost" :disabled="busy" @click="featureDialog = false">取消</button>
          <button class="btn" :class="setting?.enabled ? 'btn-danger' : 'btn-primary'" :disabled="busy || !featureForm.currentPassword" @click="toggleFeature">确认</button>
        </div>
      </section>
    </div>

    <div v-if="startDialog" class="modal-backdrop" @click.self="startDialog = false">
      <section class="modal-card danger-modal" role="dialog" aria-modal="true" aria-labelledby="start-title">
        <h3 id="start-title">确认开始迁移</h3>
        <p class="danger-copy">目标站原数据将被覆盖。系统会先备份并验证，安全检查未通过时不会覆盖。</p>
        <label class="check-row">
          <input v-model="startForm.overwriteConfirmed" type="checkbox" />
          <span>我已确认目标站原数据将被覆盖</span>
        </label>
        <label>
          <span>管理员密码</span>
          <input v-model="startForm.currentPassword" class="input" type="password" autocomplete="current-password" />
        </label>
        <div class="modal-actions">
          <button class="btn btn-ghost" :disabled="busy" @click="startDialog = false">取消</button>
          <button class="btn btn-danger" :disabled="busy || !startForm.overwriteConfirmed || !startForm.currentPassword" @click="startMigration">{{ busy ? '正在检查并启动...' : '确认开始迁移' }}</button>
        </div>
      </section>
    </div>

    <div v-if="keyDialog" class="modal-backdrop" @click.self="keyDialog = false">
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="key-title">
        <h3 id="key-title">生成本站迁入密钥</h3>
        <p>密钥 10 分钟有效、仅显示一次，首次连接后立即失效。</p>
        <label>
          <span>管理员密码</span>
          <input v-model="grant.currentPassword" class="input" type="password" autocomplete="current-password" @keyup.enter="generateKey" />
        </label>
        <div class="modal-actions">
          <button class="btn btn-ghost" :disabled="busy" @click="keyDialog = false">取消</button>
          <button class="btn btn-primary" :disabled="busy || !grant.currentPassword" @click="generateKey">生成密钥</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.migration-page{display:grid;gap:20px;max-width:1280px;margin:0 auto}.page-header{display:flex;align-items:center;justify-content:space-between;gap:20px}.page-header h2,.migration-card h3,.modal-card h3{margin:0}.page-header p,.card-title p,.key-card p,.disabled-state p,.modal-card p{margin:6px 0 0;color:var(--text-sec)}.feature-state{display:flex;align-items:center;gap:9px;padding:8px 10px 8px 14px;border:1px solid var(--border);border-radius:999px;background:var(--bg-card)}.status-dot{width:9px;height:9px;border-radius:50%;background:#94a3b8}.status-dot.enabled{background:#16a34a;box-shadow:0 0 0 4px rgba(22,163,74,.12)}.migration-notice{padding:12px 16px;border:1px solid #bfdbfe;border-radius:12px;background:#eff6ff;color:#1d4ed8}.migration-card{padding:24px}.card-title{display:flex;justify-content:space-between;gap:16px;margin-bottom:20px}.migration-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.migration-card label,.modal-card label{display:grid;gap:7px;color:var(--text-sec);font-weight:600}.start-button{margin-top:20px;min-width:160px}.disabled-state{display:grid;justify-items:start;gap:14px}.key-card{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,520px);gap:24px;align-items:center}.key-actions{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px}.secret-box{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid #bfdbfe;border-radius:12px;background:#eff6ff;overflow:auto}.secret-box code{overflow-wrap:anywhere}.empty-state{display:grid;justify-items:center;gap:7px;padding:44px 20px;border:1px dashed var(--border);border-radius:14px;color:var(--text-sec)}.task-row{padding:20px 0;border-top:1px solid var(--border)}.task-row:first-of-type{border-top:0}.task-head,.task-progress-title{display:flex;align-items:center;justify-content:space-between;gap:14px}.task-head>div{display:grid;gap:5px}.task-time,.request-id{color:var(--text-sec);font-size:13px}.task-progress-title{margin-top:18px}.progress{height:9px;margin-top:9px;overflow:hidden;border-radius:999px;background:#e2e8f0}.progress i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#2563eb,#3b82f6);transition:width .3s ease}.task-message{margin:10px 0 0;color:var(--text-sec)}.request-id{margin:6px 0 0}.modal-backdrop{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.52);backdrop-filter:blur(5px)}.modal-card{width:min(100%,480px);max-height:calc(100vh - 36px);overflow:auto;padding:24px;border:1px solid rgba(255,255,255,.5);border-radius:18px;background:#fff;box-shadow:0 24px 80px rgba(15,23,42,.24)}.modal-card label{margin-top:18px}.modal-actions{display:flex;justify-content:flex-end;gap:12px;margin-top:22px}.danger-copy{padding:12px 14px;border:1px solid #fecaca;border-radius:12px;background:#fff1f2;color:#991b1b!important}.check-row{display:flex!important;align-items:flex-start;grid-template-columns:auto 1fr!important;gap:10px!important;padding:12px;border:1px solid var(--border);border-radius:12px}.check-row input{width:18px;height:18px;margin:1px 0 0}.tag-red{background:#fee2e2;color:#b91c1c}@media(max-width:900px){.migration-form{grid-template-columns:1fr}.key-card{grid-template-columns:1fr}.key-actions{grid-template-columns:1fr auto}}@media(max-width:576px){.migration-page{gap:16px}.page-header{align-items:flex-start;flex-direction:column}.feature-state{width:100%;border-radius:14px}.feature-state .btn{margin-left:auto}.migration-card{padding:18px}.key-actions{grid-template-columns:1fr}.start-button,.key-actions .btn{width:100%}.task-head{align-items:flex-start}.modal-card{padding:20px}.modal-actions{flex-direction:column-reverse}.modal-actions .btn{width:100%}}@media(prefers-reduced-motion:reduce){.progress i{transition:none}}
</style>
