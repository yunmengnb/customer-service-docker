<!-- 忆梦云团队开发 - 系统设置 -->
<script setup>
import { computed, onMounted, reactive, ref, toRaw, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import api from '../api'

const tabs = [
  { key: 'upload', label: '存储配置' },
  { key: 'data', label: '数据管理' },
  { key: 'captcha', label: '验证码' },
  { key: 'smtp', label: '发信邮箱' },
  { key: 'auth', label: '注册登录' },
  { key: 'forbiddenWords', label: '违禁词' },
  { key: 'agreements', label: '协议内容' },
  { key: 'other', label: '其他' },
]

const defaults = {
  tenantRegisterEnabled: true,
  customerRegisterEnabled: true,
  tenantLoginEnabled: true,
  customerLoginEnabled: true,
  tenantRegisterEmailVerificationEnabled: false,
  customerRegisterEmailVerificationEnabled: true,
  customerServiceDomain: '',
  customerServiceClientDownloadPromptEnabled: true,
  siteTitle: '忆梦云客服',
  siteKeywords: '',
  siteDescription: '',
  forbiddenWords: '',
  agreements: {
    disclaimer: '',
    terms: '',
  },
  upload: {
    maxFileSizeMB: 50,
    allowedTypes: 'jpg,jpeg,png,gif,webp,pdf,docx,xlsx,zip,txt,mp3,wav,mp4,webm',
  },
  storage: {
    conversationAttachmentRetentionDays: 2,
    pendingAttachmentHours: 24,
    cleanupBatchSize: 100,
  },
  captcha: {
    enabled: false,
    provider: 'image',
    imageLength: 4,
    expireSeconds: 300,
    geetestId: '',
    geetestKey: '',
  },
  smtp: {
    enabled: false,
    host: '',
    port: 465,
    secure: true,
    username: '',
    password: '',
    fromName: '',
    fromEmail: '',
  },
}

const route = useRoute()
const router = useRouter()
const tabKeys = new Set(tabs.map(tab => tab.key))
const activeTab = ref(tabKeys.has(route.query.tab) ? route.query.tab : 'upload')
const loading = ref(true)
const saving = ref(false)
const testingEmail = ref(false)
const testEmailTo = ref('')
const loadingCleanupStatus = ref(false)
const estimatingCleanup = ref(false)
const cleaningFiles = ref(false)
const cleanupEstimate = ref(null)
const cleanupStatus = ref(null)
const loadingOverview = ref(false)
const overview = ref(null)
const cleaningHistory = ref(false)
const cleanupForm = reactive({ types: [], before: '' })
const exportForm = reactive({ type: 'tenants', format: 'csv' })
const exporting = ref(false)
const notice = ref(null)
const form = reactive(structuredClone(defaults))
const currentTab = computed(() => tabs.find(tab => tab.key === activeTab.value) || tabs[0])

watch(() => route.query.tab, tab => {
  if (tabKeys.has(tab)) activeTab.value = tab
})

function selectTab(tab) {
  activeTab.value = tab
  router.replace({ path: route.path, query: { ...route.query, tab } })
}

function applySettings(data) {
  const source = data?.settings || data || {}
  for (const key of [
    'tenantRegisterEnabled',
    'customerRegisterEnabled',
    'tenantLoginEnabled',
    'customerLoginEnabled',
    'tenantRegisterEmailVerificationEnabled',
    'customerRegisterEmailVerificationEnabled',
    'customerServiceClientDownloadPromptEnabled',
  ]) {
    if (typeof source[key] === 'boolean') form[key] = source[key]
  }
  if (Array.isArray(source.forbiddenWords)) form.forbiddenWords = source.forbiddenWords.join('\n')
  if (source.agreements) Object.assign(form.agreements, source.agreements)
  for (const key of ['customerServiceDomain', 'siteTitle', 'siteKeywords', 'siteDescription']) {
    if (source[key] !== undefined) form[key] = source[key]
  }
  if (source.upload) {
    Object.assign(form.upload, source.upload)
    if (Array.isArray(source.upload.allowedTypes)) {
      form.upload.allowedTypes = source.upload.allowedTypes.join(',')
    }
  }
  if (source.storage) Object.assign(form.storage, source.storage)
  if (source.captcha) Object.assign(form.captcha, source.captcha, { geetestKey: '' })
  if (source.smtp) Object.assign(form.smtp, source.smtp, { password: '' })
}

function showNotice(type, message) {
  notice.value = { type, message }
  window.setTimeout(() => {
    if (notice.value?.message === message) notice.value = null
  }, 3000)
}

async function loadSettings() {
  loading.value = true
  notice.value = null
  try {
    const res = await api.get('/admin/settings')
    if (res.code !== 0) throw new Error(res.message || '系统设置加载失败')
    applySettings(res.data)
  } catch (error) {
    showNotice('error', error?.message || '系统设置加载失败')
  } finally {
    loading.value = false
  }
}

async function saveSettings() {
  if (activeTab.value === 'data' && !window.confirm('保存后，超过有效期的会话附件可能被永久删除且无法恢复。只删除附件，不会删除聊天文字和消息记录。确认保存数据清理配置？')) return
  saving.value = true
  notice.value = null
  try {
    const payload = structuredClone(toRaw(form))
    payload.upload.allowedTypes = payload.upload.allowedTypes
      .split(',')
      .map(type => type.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean)
    payload.forbiddenWords = payload.forbiddenWords
      .split(/[\n,，]+/)
      .map(word => word.trim())
      .filter(Boolean)
    const res = await api.put('/admin/settings', payload)
    if (res.code !== 0) throw new Error(res.message || '系统设置保存失败')
    applySettings(res.data)
    showNotice('success', '系统设置已保存')
  } catch (error) {
    showNotice('error', error?.message || '系统设置保存失败')
  } finally {
    saving.value = false
  }
}

function formatFileSize(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatDateTime(value) {
  if (!value) return '暂无'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '暂无' : date.toLocaleString('zh-CN', { hour12: false })
}

async function loadCleanupStatus(showError = false) {
  loadingCleanupStatus.value = true
  try {
    const res = await api.get('/admin/storage/conversation-files/status')
    if (res.code !== 0) throw new Error(res.message || '清理状态加载失败')
    cleanupStatus.value = res.data || {}
  } catch (error) {
    if (showError) showNotice('error', error?.message || '清理状态加载失败')
  } finally {
    loadingCleanupStatus.value = false
  }
}

async function estimateCleanup() {
  estimatingCleanup.value = true
  try {
    const res = await api.post('/admin/storage/conversation-files/estimate')
    if (res.code !== 0) throw new Error(res.message || '清理预估失败')
    cleanupEstimate.value = res.data || {}
    showNotice('success', '清理预估已完成，本次未删除任何文件')
  } catch (error) {
    showNotice('error', error?.message || '清理预估失败')
  } finally {
    estimatingCleanup.value = false
  }
}

async function cleanupConversationFiles() {
  if (!window.confirm('超过有效期的会话附件将永久删除且无法恢复。此操作只删除附件，不会删除聊天文字和消息记录。确认立即清理？')) return
  cleaningFiles.value = true
  try {
    const res = await api.post('/admin/storage/conversation-files/cleanup')
    if (res.code !== 0) throw new Error(res.message || '清理任务启动失败')
    showNotice('success', res.message || '清理任务已启动')
    await loadCleanupStatus()
  } catch (error) {
    showNotice('error', error?.message || '清理任务启动失败')
  } finally {
    cleaningFiles.value = false
  }
}

async function loadOverview() {
  loadingOverview.value = true
  try {
    const res = await api.get('/admin/data/overview')
    if (res.code !== 0) throw new Error(res.message || '数据统计加载失败')
    overview.value = res.data || {}
  } catch (error) {
    showNotice('error', error?.message || '数据统计加载失败')
  } finally {
    loadingOverview.value = false
  }
}

async function cleanupHistory() {
  if (!cleanupForm.before) { showNotice('error', '请选择清理截止时间'); return }
  if (!cleanupForm.types.length) { showNotice('error', '请选择要清理的数据类型'); return }
  const labels = { login_logs: '登录日志', operation_logs: '操作日志', conversations: '已关闭会话与消息' }
  const typeText = cleanupForm.types.map(type => labels[type]).join('、')
  if (!window.confirm(`将永久删除 ${cleanupForm.before} 之前的${typeText}，此操作不可恢复。确认继续？`)) return
  cleaningHistory.value = true
  try {
    const res = await api.post('/admin/data/cleanup', { before: cleanupForm.before, types: cleanupForm.types })
    if (res.code !== 0) throw new Error(res.message || '历史数据清理失败')
    showNotice('success', `清理完成：登录日志 ${res.data?.loginLogs ?? 0} 条，操作日志 ${res.data?.operationLogs ?? 0} 条，会话 ${res.data?.conversations ?? 0} 个，消息 ${res.data?.messages ?? 0} 条`)
    await loadOverview()
  } catch (error) {
    showNotice('error', error?.message || '历史数据清理失败')
  } finally {
    cleaningHistory.value = false
  }
}

async function exportData() {
  exporting.value = true
  try {
    const blob = await api.get('/admin/data/export', {
      params: { type: exportForm.type, format: exportForm.format },
      responseType: 'blob',
    })
    if (!(blob instanceof Blob)) throw new Error('导出失败')
    if ((blob.type || '').includes('application/json')) {
      let message = '导出失败'
      try { message = JSON.parse(await blob.text()).message || message } catch (_) {}
      throw new Error(message)
    }
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${exportForm.type}.${exportForm.format}`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    showNotice('success', '数据导出完成')
  } catch (error) {
    let message = '导出失败'
    if (error instanceof Blob) {
      try { message = JSON.parse(await error.text()).message || message } catch (_) {}
    } else {
      message = error?.message || message
    }
    showNotice('error', message)
  } finally {
    exporting.value = false
  }
}

async function testEmail() {
  if (!/^\S+@\S+\.\S+$/.test(testEmailTo.value.trim())) {
    showNotice('error', '请输入正确的收件邮箱')
    return
  }
  testingEmail.value = true
  notice.value = null
  try {
    const res = await api.post('/admin/settings/test-email', { to: testEmailTo.value.trim() })
    if (res.code !== 0) throw new Error(res.message || '测试邮件发送失败')
    showNotice('success', res.message || '测试邮件已发送')
  } catch (error) {
    showNotice('error', error?.message || '测试邮件发送失败')
  } finally {
    testingEmail.value = false
  }
}

onMounted(() => {
  loadSettings()
  loadCleanupStatus()
  loadOverview()
})
</script>

<template>
  <div class="page-header settings-heading">
    <div>
      <h1>系统设置</h1>
      <p class="desc">配置存储与附件清理、验证码、发信邮箱、注册登录、网站信息以及违禁词规则</p>
    </div>
    <button class="btn btn-primary" :disabled="loading || saving" @click="saveSettings">
      {{ saving ? '保存中...' : '保存设置' }}
    </button>
  </div>

  <div v-if="notice" class="settings-notice" :class="notice.type" role="status">
    {{ notice.message }}
  </div>

  <div class="settings-shell">
    <div class="settings-tabs" role="tablist" aria-label="系统设置分类">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="settings-tab"
        :class="{ active: activeTab === tab.key }"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.key"
        @click="selectTab(tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="settings-panel">
      <div v-if="loading" class="settings-state">正在加载系统设置...</div>

      <template v-else>
        <div class="panel-title">
          <h2>{{ currentTab.label }}设置</h2>
          <p v-if="activeTab === 'upload'">配置平台上传限制（文件大小与扩展名）。</p>
          <p v-else-if="activeTab === 'data'">查看数据统计、导出数据、清理历史数据与过期附件。</p>
          <p v-else-if="activeTab === 'captcha'">配置人机验证服务及验证码有效期。</p>
          <p v-else-if="activeTab === 'smtp'">配置用于通知和验证邮件的 SMTP 服务。</p>
          <p v-else-if="activeTab === 'auth'">控制账号注册和登录功能。</p>
          <p v-else-if="activeTab === 'forbiddenWords'">配置消息内容中不允许出现的词语。</p>
          <p v-else-if="activeTab === 'agreements'">配置客服后台和客户中心注册时展示的免责协议与使用协议。</p>
          <p v-else>配置客服访问域名与网站搜索展示信息。</p>
        </div>

        <div v-if="activeTab === 'upload'" class="settings-grid storage-settings">
          <h3 class="section-heading full-width">上传规则</h3>
          <div class="input-group">
            <label for="upload-limit">单文件大小上限（MB）</label>
            <input id="upload-limit" v-model.number="form.upload.maxFileSizeMB" class="input" type="number" min="1" max="1024" />
          </div>
          <div class="input-group full-width">
            <label for="upload-types">允许的文件扩展名</label>
            <input id="upload-types" v-model.trim="form.upload.allowedTypes" class="input" placeholder="jpg,png,pdf,zip" />
            <span class="hint">多个扩展名请使用英文逗号分隔，不要包含点号。</span>
          </div>
        </div>

        <div v-else-if="activeTab === 'data'" class="settings-grid data-settings">
          <h3 class="section-heading full-width">数据统计概览</h3>
          <div class="overview-grid full-width">
            <div class="overview-card"><span>租户</span><strong>{{ overview?.tenantCount ?? '-' }}</strong></div>
            <div class="overview-card"><span>活跃租户</span><strong>{{ overview?.activeTenants ?? '-' }}</strong></div>
            <div class="overview-card"><span>客服账号</span><strong>{{ overview?.agentCount ?? '-' }}</strong></div>
            <div class="overview-card"><span>客户账号</span><strong>{{ overview?.customerAccountCount ?? '-' }}</strong></div>
            <div class="overview-card"><span>渠道绑定</span><strong>{{ overview?.customerCount ?? '-' }}</strong></div>
            <div class="overview-card"><span>渠道</span><strong>{{ overview?.channelCount ?? '-' }}</strong></div>
            <div class="overview-card"><span>会话</span><strong>{{ overview?.conversationCount ?? '-' }}</strong></div>
            <div class="overview-card"><span>消息</span><strong>{{ overview?.messageCount ?? '-' }}</strong></div>
            <div class="overview-card"><span>登录日志</span><strong>{{ overview?.loginLogCount ?? '-' }}</strong></div>
            <div class="overview-card"><span>操作日志</span><strong>{{ overview?.operationLogCount ?? '-' }}</strong></div>
            <div class="overview-card"><span>附件</span><strong>{{ overview?.attachmentCount ?? '-' }}</strong></div>
            <div class="overview-card"><span>附件占用</span><strong>{{ formatFileSize(overview?.attachmentBytes) }}</strong></div>
          </div>
          <button class="btn btn-ghost full-width" type="button" :disabled="loadingOverview" @click="loadOverview">{{ loadingOverview ? '统计中...' : '刷新统计' }}</button>

          <div class="storage-divider full-width"></div>
          <div class="section-title-row full-width">
            <div><h3>会话附件清理</h3><p>附件按消息创建时间计算有效期；上传后未关联消息的文件按 pending 保留时间清理。</p></div>
            <span class="safety-label">只删附件，不删消息</span>
          </div>
          <div class="input-group">
            <label for="retention-days">附件有效天数</label>
            <input id="retention-days" v-model.number="form.storage.conversationAttachmentRetentionDays" class="input" type="number" min="1" max="365" />
            <span class="hint">默认 2 天，超过有效期后附件不可恢复。</span>
          </div>
          <div class="input-group">
            <label for="pending-hours">待绑定附件保留小时</label>
            <input id="pending-hours" v-model.number="form.storage.pendingAttachmentHours" class="input" type="number" min="1" max="168" />
            <span class="hint">清理上传后未关联到消息的文件。</span>
          </div>
          <div class="input-group full-width">
            <label for="cleanup-batch-size">单次清理数量</label>
            <input id="cleanup-batch-size" v-model.number="form.storage.cleanupBatchSize" class="input" type="number" min="1" max="100" />
            <span class="hint">每次定时或手动任务最多处理的附件数量。</span>
          </div>

          <div class="cleanup-card full-width">
            <div class="cleanup-card-header">
              <div><h3>附件清理状态</h3><p>查看最近一次任务执行结果，或预估当前可清理内容。</p></div>
              <button class="btn btn-ghost" type="button" :disabled="loadingCleanupStatus" @click="loadCleanupStatus(true)">{{ loadingCleanupStatus ? '刷新中...' : '刷新状态' }}</button>
            </div>
            <div class="status-grid">
              <div><span>运行状态</span><strong>{{ cleanupStatus?.isRunning || cleanupStatus?.running ? '正在清理' : '空闲' }}</strong></div>
              <div><span>上次开始</span><strong>{{ formatDateTime(cleanupStatus?.lastRun?.startedAt) }}</strong></div>
              <div><span>上次完成</span><strong>{{ formatDateTime(cleanupStatus?.lastRun?.finishedAt) }}</strong></div>
              <div><span>上次删除</span><strong>{{ cleanupStatus?.lastRun?.deleted ?? 0 }} 个文件</strong></div>
              <div><span>上次释放</span><strong>{{ formatFileSize(cleanupStatus?.lastRun?.releasedBytes) }}</strong></div>
              <div><span>最近错误</span><strong :class="{ 'status-error': cleanupStatus?.lastRun?.failed }">{{ cleanupStatus?.lastRun?.failed ? `${cleanupStatus.lastRun.failed} 个文件清理失败` : '无' }}</strong></div>
            </div>
            <div v-if="cleanupEstimate" class="estimate-result">
              <strong>预估结果</strong>
              <span>当前到期 {{ cleanupEstimate.due?.count ?? 0 }} 个</span>
              <span>预计释放 {{ formatFileSize(cleanupEstimate.due?.bytes) }}</span>
              <span>统计时间 {{ formatDateTime(cleanupEstimate.generatedAt) }}</span>
            </div>
            <div class="cleanup-actions">
              <button class="btn btn-ghost" type="button" :disabled="estimatingCleanup || cleaningFiles" @click="estimateCleanup">{{ estimatingCleanup ? '预估中...' : '预估清理' }}</button>
              <button class="btn btn-danger" type="button" :disabled="cleaningFiles || cleanupStatus?.isRunning || cleanupStatus?.running" @click="cleanupConversationFiles">{{ cleaningFiles ? '启动中...' : '立即清理' }}</button>
            </div>
            <p class="danger-tip">危险操作：超过有效期的会话附件将永久删除且无法恢复，聊天文字和消息记录不会删除。</p>
          </div>

          <div class="storage-divider full-width"></div>
          <div class="section-title-row full-width">
            <div><h3>历史数据清理</h3><p>按截止时间清理历史数据，操作不可恢复，请谨慎。</p></div>
          </div>
          <div class="input-group full-width">
            <label for="cleanup-before">清理截止时间</label>
            <input id="cleanup-before" v-model="cleanupForm.before" class="input" type="date" />
            <span class="hint">将清理该时间之前产生的历史数据。</span>
          </div>
          <div class="cleanup-type-row full-width">
            <label class="check-field"><input v-model="cleanupForm.types" type="checkbox" value="login_logs" /> 登录日志</label>
            <label class="check-field"><input v-model="cleanupForm.types" type="checkbox" value="operation_logs" /> 操作日志</label>
            <label class="check-field"><input v-model="cleanupForm.types" type="checkbox" value="conversations" /> 已关闭会话与消息</label>
          </div>
          <div class="cleanup-actions full-width">
            <button class="btn btn-danger" type="button" :disabled="cleaningHistory" @click="cleanupHistory">{{ cleaningHistory ? '清理中...' : '执行历史数据清理' }}</button>
          </div>

          <div class="storage-divider full-width"></div>
          <div class="section-title-row full-width">
            <div><h3>数据导出</h3><p>将平台数据导出为 CSV 或 JSON 文件。</p></div>
          </div>
          <div class="input-group">
            <label for="export-type">导出类型</label>
            <select id="export-type" v-model="exportForm.type" class="select">
              <option value="tenants">租户</option>
              <option value="customers">客户</option>
              <option value="conversations">会话</option>
            </select>
          </div>
          <div class="input-group">
            <label for="export-format">导出格式</label>
            <select id="export-format" v-model="exportForm.format" class="select">
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </div>
          <div class="cleanup-actions full-width">
            <button class="btn btn-primary" type="button" :disabled="exporting" @click="exportData">{{ exporting ? '导出中...' : '导出数据' }}</button>
          </div>
        </div>

        <div v-else-if="activeTab === 'captcha'" class="settings-grid">
          <div class="setting-switch full-width">
            <div><strong>启用验证码服务</strong><span>关闭后所有验证码场景将停止校验。</span></div>
            <label class="switch"><input v-model="form.captcha.enabled" type="checkbox" /><span class="slider"></span></label>
          </div>
          <div class="input-group">
            <label for="captcha-provider">验证码类型</label>
            <select id="captcha-provider" v-model="form.captcha.provider" class="select">
              <option value="image">图片验证码</option>
              <option value="geetest">极验 V3 验证码</option>
            </select>
          </div>
          <div class="input-group">
            <label for="captcha-expire">有效期（秒）</label>
            <input id="captcha-expire" v-model.number="form.captcha.expireSeconds" class="input" type="number" min="60" max="1800" />
          </div>
          <div v-if="form.captcha.provider === 'image'" class="input-group">
            <label for="captcha-image-length">图片验证码长度</label>
            <input id="captcha-image-length" v-model.number="form.captcha.imageLength" class="input" type="number" min="4" max="8" />
          </div>
          <template v-else>
            <div class="input-group">
              <label for="captcha-geetest-id">极验 V3 验证 ID</label>
              <input id="captcha-geetest-id" v-model.trim="form.captcha.geetestId" class="input" autocomplete="off" />
            </div>
            <div class="input-group">
              <label for="captcha-geetest-key">极验 V3 验证 Key</label>
              <input id="captcha-geetest-key" v-model="form.captcha.geetestKey" class="input" type="password" autocomplete="new-password" placeholder="留空则不修改" />
              <span v-if="form.captcha.geetestKeyConfigured" class="hint">已配置验证 Key。</span>
            </div>
          </template>
        </div>

        <div v-else-if="activeTab === 'smtp'" class="settings-grid">
          <div class="setting-switch full-width">
            <div><strong>启用 SMTP 发信</strong><span>启用后系统将使用以下配置发送通知和验证邮件。</span></div>
            <label class="switch"><input v-model="form.smtp.enabled" type="checkbox" /><span class="slider"></span></label>
          </div>
          <div class="input-group">
            <label for="mail-host">SMTP 服务器</label>
            <input id="mail-host" v-model.trim="form.smtp.host" class="input" placeholder="smtp.example.com" />
          </div>
          <div class="input-group">
            <label for="mail-port">SMTP 端口</label>
            <input id="mail-port" v-model.number="form.smtp.port" class="input" type="number" min="1" max="65535" />
          </div>
          <div class="input-group">
            <label for="mail-username">登录账号</label>
            <input id="mail-username" v-model.trim="form.smtp.username" class="input" autocomplete="off" />
          </div>
          <div class="input-group">
            <label for="mail-password">登录密码 / 授权码</label>
            <input id="mail-password" v-model="form.smtp.password" class="input" type="password" autocomplete="new-password" placeholder="留空则不修改" />
            <span v-if="form.smtp.passwordConfigured" class="hint">已配置登录密码。</span>
          </div>
          <div class="input-group">
            <label for="mail-from-name">发件人名称</label>
            <input id="mail-from-name" v-model.trim="form.smtp.fromName" class="input" placeholder="忆梦云客服" />
          </div>
          <div class="input-group">
            <label for="mail-from-email">发件邮箱</label>
            <input id="mail-from-email" v-model.trim="form.smtp.fromEmail" class="input" type="email" placeholder="service@example.com" />
          </div>
          <div class="setting-switch full-width">
            <div><strong>SSL/TLS 加密</strong><span>通常 465 端口开启，587 端口关闭并使用 STARTTLS。</span></div>
            <label class="switch"><input v-model="form.smtp.secure" type="checkbox" /><span class="slider"></span></label>
          </div>
          <div class="email-test full-width">
            <div class="input-group">
              <label for="test-email-to">测试收件邮箱</label>
              <input id="test-email-to" v-model.trim="testEmailTo" class="input" type="email" placeholder="recipient@example.com" @keyup.enter="testEmail" />
            </div>
            <button class="btn" type="button" :disabled="saving || testingEmail" @click="testEmail">
              {{ testingEmail ? '发送中...' : '发送测试邮件' }}
            </button>
          </div>
        </div>

        <div v-else-if="activeTab === 'auth'" class="settings-grid">
          <h3 class="section-heading full-width">客服端</h3>
          <div class="setting-switch full-width">
            <div><strong>客服注册</strong><span>控制客服后台注册入口和服务端客服注册接口。</span></div>
            <label class="switch"><input v-model="form.tenantRegisterEnabled" type="checkbox" /><span class="slider"></span></label>
          </div>
          <div class="setting-switch full-width">
            <div><strong>客服登录</strong><span>控制客服账号、邮箱密码登录及员工临时密钥登录。</span></div>
            <label class="switch"><input v-model="form.tenantLoginEnabled" type="checkbox" /><span class="slider"></span></label>
          </div>
          <div class="setting-switch full-width">
            <div><strong>客服后台注册邮箱验证</strong><span>开启后客服注册时必须获取并填写邮箱验证码。</span></div>
            <label class="switch"><input v-model="form.tenantRegisterEmailVerificationEnabled" type="checkbox" /><span class="slider"></span></label>
          </div>

          <h3 class="section-heading full-width">客户端</h3>
          <div class="setting-switch full-width">
            <div><strong>客户注册</strong><span>同时控制客户后台与客服链接面板的注册入口和接口。</span></div>
            <label class="switch"><input v-model="form.customerRegisterEnabled" type="checkbox" /><span class="slider"></span></label>
          </div>
          <div class="setting-switch full-width">
            <div><strong>客户登录</strong><span>同时控制客户后台与客服链接面板的登录入口和接口。</span></div>
            <label class="switch"><input v-model="form.customerLoginEnabled" type="checkbox" /><span class="slider"></span></label>
          </div>
          <div class="setting-switch full-width">
            <div><strong>客户后台注册邮箱验证</strong><span>同时控制客户后台与客服链接面板注册时的邮箱验证码要求。</span></div>
            <label class="switch"><input v-model="form.customerRegisterEmailVerificationEnabled" type="checkbox" /><span class="slider"></span></label>
          </div>
        </div>

        <div v-else-if="activeTab === 'forbiddenWords'" class="settings-grid">
          <div class="input-group full-width">
            <label for="forbidden-words">违禁词列表</label>
            <textarea id="forbidden-words" v-model="form.forbiddenWords" class="textarea forbidden-words-input" rows="10" placeholder="违禁词一&#10;违禁词二,违禁词三"></textarea>
            <span class="hint">多个违禁词支持每行一个，或使用中英文逗号分隔。</span>
          </div>
        </div>

        <div v-else-if="activeTab === 'agreements'" class="settings-grid">
          <div class="input-group full-width">
            <label for="agreement-disclaimer">免责协议</label>
            <textarea id="agreement-disclaimer" v-model="form.agreements.disclaimer" class="textarea agreement-input" rows="10" placeholder="请输入免责协议内容，支持多行文本"></textarea>
            <span class="hint">客服后台与客户中心注册页及协议页将展示此内容。</span>
          </div>
          <div class="input-group full-width">
            <label for="agreement-terms">使用协议</label>
            <textarea id="agreement-terms" v-model="form.agreements.terms" class="textarea agreement-input" rows="10" placeholder="请输入使用协议内容，支持多行文本"></textarea>
            <span class="hint">客服后台与客户中心注册页及协议页将展示此内容。</span>
          </div>
        </div>

        <div v-else class="settings-grid">
          <div class="setting-switch full-width">
            <div><strong>客服链接客户端下载提示</strong><span>控制客户通过客服链接进入聊天后是否显示客户端下载安装引导。</span></div>
            <label class="switch"><input v-model="form.customerServiceClientDownloadPromptEnabled" type="checkbox" /><span class="slider"></span></label>
          </div>
          <div class="input-group full-width">
            <label for="customer-service-domain">客服专属域名</label>
            <input id="customer-service-domain" v-model.trim="form.customerServiceDomain" class="input" placeholder="https://chat.example.com" />
            <span class="hint">用于用户后台生成渠道客服链接；不填写时继续使用 /c/ 开头的相对链接。</span>
          </div>
          <div class="input-group full-width">
            <label for="site-title">网站标题</label>
            <input id="site-title" v-model.trim="form.siteTitle" class="input" maxlength="120" placeholder="忆梦云客服" />
          </div>
          <div class="input-group full-width">
            <label for="site-keywords">网站关键词</label>
            <input id="site-keywords" v-model.trim="form.siteKeywords" class="input" maxlength="500" placeholder="在线客服,客户服务" />
          </div>
          <div class="input-group full-width">
            <label for="site-description">网站描述</label>
            <textarea id="site-description" v-model.trim="form.siteDescription" class="textarea" rows="4" maxlength="500" placeholder="请输入网站描述"></textarea>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.settings-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.settings-shell { overflow: hidden; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); }
.settings-tabs { display: flex; gap: 6px; padding: 10px 18px 0; overflow-x: auto; border-bottom: 1px solid var(--border); }
.settings-tab { position: relative; flex: 0 0 auto; padding: 12px 18px; color: var(--text-sec); font-size: 14px; font-weight: 600; }
.settings-tab:hover { color: var(--primary); }
.settings-tab.active { color: var(--primary); }
.settings-tab.active::after { position: absolute; right: 10px; bottom: -1px; left: 10px; height: 2px; border-radius: 2px 2px 0 0; background: var(--primary); content: ''; }
.settings-panel { min-height: 390px; padding: 28px; }
.panel-title { margin-bottom: 24px; }
.panel-title h2 { font-size: 18px; }
.panel-title p { margin: 6px 0 0; color: var(--text-muted); font-size: 13px; }
.settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 24px; max-width: 820px; }
.settings-grid .full-width { grid-column: 1 / -1; }
.check-field { display: flex; align-items: center; gap: 8px; color: var(--text-sec); font-size: 13px; }
.section-heading { margin-bottom: 10px; font-size: 15px; }
.storage-divider { height: 1px; margin: 14px 0 18px; background: var(--border); }
.section-title-row, .cleanup-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.section-title-row h3, .cleanup-card h3 { font-size: 15px; }
.section-title-row p, .cleanup-card-header p { margin: 5px 0 0; color: var(--text-muted); font-size: 12px; line-height: 1.5; }
.safety-label { flex: 0 0 auto; padding: 5px 9px; border-radius: 999px; background: var(--success-soft); color: #047857; font-size: 12px; font-weight: 600; }
.cleanup-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 20px; margin: 4px 0 18px; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-md); background: #f8fafc; }
.cleanup-card { padding: 18px; border: 1px solid var(--border); border-radius: var(--radius-md); }
.status-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
.status-grid > div { min-width: 0; padding: 12px; border-radius: var(--radius-md); background: #f8fafc; }
.status-grid span, .status-grid strong { display: block; overflow-wrap: anywhere; }
.status-grid span { margin-bottom: 5px; color: var(--text-muted); font-size: 12px; }
.status-grid strong { color: var(--text-main); font-size: 13px; }
.status-grid .status-error { color: var(--danger); }
.estimate-result { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 16px; padding: 12px 14px; border-radius: var(--radius-md); background: var(--primary-soft); color: var(--text-sec); font-size: 12px; }
.cleanup-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.danger-tip { margin: 12px 0 0; color: var(--danger); font-size: 12px; line-height: 1.6; text-align: right; }
.overview-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.overview-card { padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-md); background: #f8fafc; }
.overview-card span, .overview-card strong { display: block; }
.overview-card span { color: var(--text-muted); font-size: 12px; }
.overview-card strong { margin-top: 6px; color: var(--text-main); font-size: 20px; font-weight: 700; }
.cleanup-type-row { display: flex; flex-wrap: wrap; gap: 12px 22px; padding: 14px 16px; border: 1px solid var(--border); border-radius: var(--radius-md); background: #f8fafc; }
.forbidden-words-input { min-height: 220px; line-height: 1.6; resize: vertical; }
.agreement-input { min-height: 200px; line-height: 1.7; resize: vertical; white-space: pre-wrap; }
.email-test { display: flex; align-items: flex-end; gap: 16px; }
.email-test .input-group { flex: 1; margin-bottom: 0; }
.email-test .btn { flex: 0 0 auto; margin-bottom: 16px; }
.setting-switch { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 68px; margin-bottom: 12px; padding: 12px 16px; border: 1px solid var(--border); border-radius: var(--radius-md); background: #f8fafc; }
.setting-switch strong, .setting-switch span { display: block; }
.setting-switch strong { margin-bottom: 2px; color: var(--text-main); font-size: 13px; }
.setting-switch div > span { color: var(--text-muted); font-size: 12px; }
.setting-switch .switch { flex: 0 0 42px; }
.settings-state { display: flex; min-height: 330px; align-items: center; justify-content: center; color: var(--text-muted); }
.settings-notice { margin-bottom: 16px; padding: 11px 14px; border: 1px solid; border-radius: var(--radius-md); font-size: 13px; }
.settings-notice.success { border-color: rgba(16, 185, 129, .3); background: var(--success-soft); color: #047857; }
.settings-notice.error { border-color: rgba(239, 68, 68, .3); background: var(--danger-soft); color: #b91c1c; }
@media (max-width: 768px) {
  .settings-heading { align-items: stretch; flex-direction: column; }
  .settings-heading .btn { width: 100%; }
  .settings-tabs { padding-right: 10px; padding-left: 10px; }
  .settings-tab { padding-right: 14px; padding-left: 14px; }
  .settings-panel { padding: 22px 16px; }
  .settings-grid { grid-template-columns: 1fr; }
  .settings-grid .full-width { grid-column: auto; }
  .overview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .section-title-row, .cleanup-card-header { align-items: stretch; flex-direction: column; }
  .safety-label { align-self: flex-start; }
  .cleanup-options, .status-grid { grid-template-columns: 1fr; }
  .cleanup-actions { align-items: stretch; flex-direction: column; }
  .cleanup-actions .btn { width: 100%; }
  .danger-tip { text-align: left; }
  .email-test { align-items: stretch; flex-direction: column; }
  .email-test .btn { margin-bottom: 12px; }
  .setting-switch { gap: 16px; }
}
</style>
