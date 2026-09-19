<!-- 忆梦云团队开发 - Jingpro 扩展配置 -->
<script setup>
import { onMounted, reactive, ref } from 'vue'
import api from '../api'

const loading = ref(true)
const saving = ref(false)
const notice = ref(null)
const form = reactive({ enabled: false, serverBaseUrl: '', widgetBaseUrl: '' })

function showNotice(type, message) {
  notice.value = { type, message }
  window.setTimeout(() => {
    if (notice.value?.message === message) notice.value = null
  }, 3000)
}

function applySetting(data = {}) {
  form.enabled = data.enabled === true
  form.serverBaseUrl = data.serverBaseUrl || ''
  form.widgetBaseUrl = data.widgetBaseUrl || ''
}

async function loadSetting() {
  loading.value = true
  try {
    const res = await api.get('/integration/admin/setting')
    if (res.code !== 200) throw new Error(res.msg || res.message || '配置加载失败')
    applySetting(res.data)
  } catch (error) {
    showNotice('error', error?.msg || error?.message || 'Jingpro 配置加载失败')
  } finally {
    loading.value = false
  }
}

async function saveSetting() {
  saving.value = true
  notice.value = null
  try {
    const res = await api.post('/integration/admin/setting', {
      action: 'save',
      enabled: form.enabled,
      serverBaseUrl: form.serverBaseUrl.trim(),
      widgetBaseUrl: form.widgetBaseUrl.trim(),
    })
    if (res.code !== 200) throw new Error(res.msg || res.message || '保存失败')
    applySetting({
      ...res.data,
      enabled: res.data?.enabled ?? form.enabled,
    })
    showNotice('success', 'Jingpro 扩展配置已保存')
  } catch (error) {
    showNotice('error', error?.msg || error?.message || 'Jingpro 配置保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(loadSetting)
</script>

<template>
  <div class="page-header extension-heading">
    <div>
      <RouterLink class="back-link" to="/extensions">返回扩展应用</RouterLink>
      <h1>Jingpro 联动扩展</h1>
      <p class="desc">配置扩展开关及客服服务的公共访问地址</p>
    </div>
  </div>

  <div v-if="notice" class="extension-notice" :class="notice.type" role="status">{{ notice.message }}</div>

  <div class="card extension-panel">
    <div v-if="loading" class="loading-state">正在加载 Jingpro 配置...</div>
    <form v-else @submit.prevent="saveSetting">
      <div class="panel-title">
        <div>
          <h2>扩展配置</h2>
          <p>地址应填写可供 Jingpro 服务访问的完整公共地址。</p>
        </div>
      </div>

      <div class="setting-switch">
        <div><strong>启用 Jingpro 联动</strong><span>关闭后停止使用该扩展的联动能力。</span></div>
        <label class="switch"><input v-model="form.enabled" type="checkbox" /><span class="slider"></span></label>
      </div>

      <div class="form-grid">
        <div class="input-group full-width">
          <label for="jingpro-server-url">客服 API 公共地址</label>
          <input id="jingpro-server-url" v-model.trim="form.serverBaseUrl" class="input" type="url" placeholder="https://api.example.com" required />
          <span class="hint">供 Jingpro 调用客服服务 API，不要以 / 结尾。</span>
        </div>
        <div class="input-group full-width">
          <label for="jingpro-widget-url">客户聊天/挂件公共地址</label>
          <input id="jingpro-widget-url" v-model.trim="form.widgetBaseUrl" class="input" type="url" placeholder="https://chat.example.com" required />
          <span class="hint">用于生成客户聊天页面及客服挂件地址。</span>
        </div>
      </div>

      <div class="panel-actions">
        <RouterLink class="btn btn-ghost" to="/extensions">取消</RouterLink>
        <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? '保存中...' : '保存配置' }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.extension-heading { display: flex; align-items: flex-start; justify-content: space-between; }
.back-link { display: inline-block; margin-bottom: 8px; font-size: 13px; font-weight: 600; }
.extension-notice { margin-bottom: 16px; padding: 11px 14px; border: 1px solid; border-radius: var(--radius-md); font-size: 13px; }
.extension-notice.success { border-color: rgba(16, 185, 129, .3); background: var(--success-soft); color: #047857; }
.extension-notice.error { border-color: rgba(239, 68, 68, .3); background: var(--danger-soft); color: #b91c1c; }
.extension-panel { max-width: 820px; padding: 28px; }
.loading-state { display: flex; min-height: 300px; align-items: center; justify-content: center; color: var(--text-muted); }
.panel-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.panel-title h2 { font-size: 18px; }
.panel-title p { margin: 6px 0 0; color: var(--text-muted); font-size: 13px; }
.setting-switch { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 22px; padding: 15px 16px; border: 1px solid var(--border); border-radius: var(--radius-md); background: #f8fafc; }
.setting-switch strong, .setting-switch span { display: block; }
.setting-switch div > span { margin-top: 2px; color: var(--text-muted); font-size: 12px; }
.setting-switch .switch { flex: 0 0 42px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 24px; }
.full-width { grid-column: 1 / -1; }
.panel-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; padding-top: 20px; border-top: 1px solid var(--border); }
@media (max-width: 576px) { .extension-panel { padding: 20px 16px; } .panel-title { flex-direction: column; } .form-grid { grid-template-columns: 1fr; } .full-width { grid-column: auto; } .panel-actions { flex-direction: column-reverse; } .panel-actions .btn { width: 100%; } }
</style>
