<script setup>
import { onMounted, reactive, ref } from 'vue'
import api from '../../api'

const loading = ref(true)
const saving = ref(false)
const message = ref('')
const error = ref('')
const secretVisible = ref(false)
const details = reactive({ keyId: '', serverBaseUrl: '', widgetBaseUrl: '', hasSecret: false, status: '' })
const form = reactive({ platformName: '', platformUrl: '', platformSecret: '', enabled: false })

function applyData(data = {}) {
  form.platformName = data?.platformName || ''
  form.platformUrl = data?.platformUrl || ''
  form.platformSecret = ''
  form.enabled = data?.enabled === true
  details.keyId = data?.keyId || ''
  details.serverBaseUrl = data?.serverBaseUrl || ''
  details.widgetBaseUrl = data?.widgetBaseUrl || ''
  details.hasSecret = data?.hasSecret === true
  details.status = data?.status || 'unconfigured'
}

function generateSecret() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  form.platformSecret = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  secretVisible.value = true
  message.value = '已生成新密钥，请复制到 Jingpro 管理员后台并保存本页配置'
  error.value = ''
}

async function loadSetting() {
  loading.value = true
  error.value = ''
  try {
    const res = await api.get('/tenant/extensions/jingpro')
    if (![0, 200].includes(res.code)) throw new Error(res.msg || res.message || '配置加载失败')
    applyData(res.data)
  } catch (err) {
    error.value = err?.msg || err?.message || 'Jingpro 配置加载失败'
  } finally {
    loading.value = false
  }
}

async function saveSetting() {
  if (saving.value) return
  error.value = ''
  message.value = ''
  if (!form.platformName.trim() || !form.platformUrl.trim()) {
    error.value = '请填写平台名称和平台地址'
    return
  }
  if (!details.hasSecret && form.platformSecret.trim().length < 16) {
    error.value = '首次配置的接口密钥至少需要 16 个字符'
    return
  }
  saving.value = true
  try {
    const payload = {
      platformName: form.platformName.trim(),
      platformUrl: form.platformUrl.trim(),
      enabled: form.enabled,
    }
    if (form.platformSecret.trim()) payload.platformSecret = form.platformSecret.trim()
    const res = await api.post('/tenant/extensions/jingpro', payload)
    if (![0, 200].includes(res.code)) throw new Error(res.msg || res.message || '保存失败')
    applyData(res.data)
    message.value = 'Jingpro 扩展配置已保存'
  } catch (err) {
    error.value = err?.msg || err?.message || 'Jingpro 配置保存失败'
  } finally {
    saving.value = false
  }
}

onMounted(loadSetting)
</script>

<template>
  <section class="jingpro-page">
    <header class="page-heading">
      <div><RouterLink to="/desktop/extensions">← 返回扩展应用</RouterLink><h1>Jingpro 扩展配置</h1><p>配置当前租户与鲸商城平台的连接信息。</p></div>
      <span class="status" :class="{ enabled: form.enabled }">{{ form.enabled ? '已启用' : '未启用' }}</span>
    </header>

    <div v-if="loading" class="state-card">正在加载配置...</div>
    <div v-else class="panel">
      <div v-if="message" class="notice success">{{ message }}</div>
      <div v-if="error" class="notice error">{{ error }}</div>
      <form @submit.prevent="saveSetting">
        <label class="switch-row"><span><strong>启用 Jingpro 联动</strong><small>关闭后平台将无法使用当前租户的联动能力。</small></span><input v-model="form.enabled" type="checkbox" /></label>
        <div class="form-grid">
          <label><span>平台名称</span><input v-model="form.platformName" required placeholder="例如：鲸商城" /></label>
          <label><span>平台地址</span><input v-model="form.platformUrl" type="url" required placeholder="https://example.com" /></label>
          <label class="full"><span>平台密钥</span><div class="secret-field"><input v-model="form.platformSecret" :type="secretVisible ? 'text' : 'password'" :required="!details.hasSecret" autocomplete="new-password" :placeholder="details.hasSecret ? '已配置；留空则保持原密钥' : '至少 16 个字符'" /><button type="button" @click="generateSecret">{{ details.hasSecret ? '重新生成' : '自动生成' }}</button></div><small>自动生成 64 位安全随机密钥。生成后请先复制到 Jingpro 管理员后台；保存后不会再次回填。</small></label>
        </div>
        <div class="details">
          <div><span>Key ID</span><code>{{ details.keyId || '保存后生成' }}</code></div>
          <div><span>接口密钥</span><strong>{{ details.hasSecret ? '已配置' : '未配置' }}</strong></div>
          <div><span>连接状态</span><strong>{{ details.status || 'unconfigured' }}</strong></div>
          <div><span>服务端地址</span><code>{{ details.serverBaseUrl || '-' }}</code></div>
          <div><span>挂件地址</span><code>{{ details.widgetBaseUrl || '-' }}</code></div>
        </div>
        <div class="actions"><RouterLink to="/desktop/extensions">取消</RouterLink><button type="submit" :disabled="saving">{{ saving ? '保存中...' : '保存配置' }}</button></div>
      </form>
    </div>
  </section>
</template>

<style scoped>
.jingpro-page{width:min(900px,100%);margin:0 auto;padding-bottom:24px}.page-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:18px;padding:24px 28px;border-radius:18px;background:linear-gradient(135deg,#172554,#2563eb);color:#fff}.page-heading a{color:#bfdbfe;font-size:13px;text-decoration:none}.page-heading h1{margin:7px 0 4px;font-size:25px}.page-heading p{margin:0;color:#dbeafe;font-size:13px}.status{padding:5px 10px;border-radius:999px;background:rgba(255,255,255,.16);font-size:12px}.status.enabled{background:#dcfce7;color:#15803d}.panel,.state-card{padding:26px;border:1px solid #e2e8f0;border-radius:16px;background:#fff;box-shadow:0 4px 16px rgba(15,23,42,.05)}.state-card{text-align:center;color:#64748b}.notice{margin-bottom:16px;padding:11px 13px;border-radius:9px;font-size:13px}.notice.success{background:#ecfdf5;color:#047857}.notice.error{background:#fef2f2;color:#b91c1c}.switch-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;padding:15px;border:1px solid #e2e8f0;border-radius:11px;background:#f8fafc}.switch-row span,.switch-row small{display:block}.switch-row small,.form-grid small{margin-top:4px;color:#64748b;font-size:12px}.switch-row input{width:20px;height:20px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.form-grid label{display:grid;gap:7px;color:#334155;font-size:13px;font-weight:600}.form-grid .full{grid-column:1/-1}.form-grid input{box-sizing:border-box;width:100%;padding:11px 12px;border:1px solid #cbd5e1;border-radius:9px;outline:none}.form-grid input:focus{border-color:#2563eb}.secret-field{display:flex;gap:9px}.secret-field input{min-width:0;flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.secret-field button{flex:none;padding:0 16px;border:1px solid #2563eb;border-radius:9px;background:#eff6ff;color:#1d4ed8;font-weight:600;cursor:pointer}.details{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:22px;padding:16px;border-radius:11px;background:#f8fafc}.details div{display:grid;gap:5px;min-width:0}.details div:nth-child(n+4){grid-column:span 3}.details span{color:#64748b;font-size:11px}.details strong,.details code{overflow-wrap:anywhere;color:#0f172a;font-size:12px}.actions{display:flex;justify-content:flex-end;align-items:center;gap:16px;margin-top:22px;padding-top:18px;border-top:1px solid #e2e8f0}.actions a{color:#64748b;text-decoration:none}.actions button{padding:10px 18px;border:0;border-radius:9px;background:#2563eb;color:#fff;font-weight:600}.actions button:disabled{opacity:.6}
</style>
