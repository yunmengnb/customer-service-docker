<script setup>
import { onMounted, reactive, ref } from 'vue'
import api from '../../api'

const loading = ref(true)
const saving = ref(false)
const message = ref('')
const error = ref('')
const secretVisible = ref(false)
const copied = ref('')
const details = reactive({ keyId: '', serverBaseUrl: '', widgetBaseUrl: '', hasSecret: false, status: '' })
const form = reactive({ platformName: '', platformUrl: '', platformSecret: '', enabled: false })

async function copyValue(key, value) {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    copied.value = key
    window.setTimeout(() => { if (copied.value === key) copied.value = '' }, 1800)
  } catch { message.value = '浏览器未允许复制，请手动选择文本。'; error.value = '' }
}

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
    <div v-if="loading" class="state-card">正在加载配置...</div>
    <form v-else class="setting-form" @submit.prevent="saveSetting">
      <div v-if="message" class="notice success">{{ message }}</div>
      <div v-if="error" class="notice error">{{ error }}</div>
      <label class="switch-row"><span><strong>启用 Jingpro 联动</strong><small>关闭后停止当前租户的联动能力</small></span><input v-model="form.enabled" type="checkbox" /></label>
      <div class="fields">
        <label><span>平台名称</span><input v-model="form.platformName" required placeholder="例如：鲸商城" /></label>
        <label><span>平台地址</span><input v-model="form.platformUrl" type="url" required placeholder="https://example.com" /></label>
        <label><span>平台密钥</span><div class="secret-field"><input v-model="form.platformSecret" :type="secretVisible ? 'text' : 'password'" :required="!details.hasSecret" autocomplete="new-password" :placeholder="details.hasSecret ? '已配置；留空保持原密钥' : '至少 16 个字符'" /><button type="button" @click="generateSecret">{{ details.hasSecret ? '重新生成' : '自动生成' }}</button></div><small>自动生成 64 位安全随机密钥。生成后请先复制到 Jingpro 管理员后台；保存后不会再次回填。</small></label>
      </div>
      <div class="details">
        <div><span>Key ID</span><code>{{ details.keyId || '保存后生成' }}</code></div>
        <div><span>接口密钥</span><strong>{{ details.hasSecret ? '已配置' : '未配置' }}</strong></div>
        <div><span>连接状态</span><strong>{{ details.status || 'unconfigured' }}</strong></div>
        <div><span>服务端地址</span><code>{{ details.serverBaseUrl || '-' }}</code></div>
        <div><span>挂件地址</span><code>{{ details.widgetBaseUrl || '-' }}</code></div>
      </div>
      <button class="save" type="submit" :disabled="saving">{{ saving ? '保存中...' : '保存配置' }}</button>

      <section class="tutorial">
        <div class="section-heading"><span>配置教程</span><h2>Jingpro 联动接入步骤</h2></div>
        <details open>
          <summary><b>1</b> 了解联动关系</summary>
          <div class="step"><p>Jingpro（鲸商城）通过本系统接口管理企业客服能力。本系统配置的「平台密钥」需与 Jingpro 后台填写的密钥一致，用于双方接口 HMAC 签名校验。</p></div>
        </details>
        <details>
          <summary><b>2</b> 生成并保存接口密钥</summary>
          <div class="step"><ol><li>点击「自动生成」生成 64 位安全随机密钥。</li><li>立即复制该密钥，保存后系统不会再次回显。</li><li>将同一密钥填写到 Jingpro 管理员后台的接口密钥字段。</li><li>填写平台名称与平台地址后点击「保存配置」。</li></ol></div>
        </details>
        <details>
          <summary><b>3</b> 查看 Key ID 与服务端地址</summary>
          <div class="step"><p>保存后系统会生成 Key ID，并显示服务端地址与挂件地址。这些地址由平台管理员统一配置，企业不可修改。</p><div v-if="details.keyId" class="copy-field"><span class="copy-row"><input readonly :value="details.keyId" /><button type="button" @click="copyValue('keyId', details.keyId)">{{ copied === 'keyId' ? '已复制' : '复制' }}</button></span></div></div>
        </details>
        <details>
          <summary><b>4</b> 启用联动能力</summary>
          <div class="step"><p>勾选「启用 Jingpro 联动」并保存。启用后 Jingpro 可通过签名接口调用本系统的客服能力。若平台未授权当前企业，请联系平台管理员。</p></div>
        </details>
        <details>
          <summary><b>5</b> 常见错误排查</summary>
          <div class="step"><ul><li><strong>密钥不匹配：</strong>确认本系统与 Jingpro 后台填写的密钥完全一致。</li><li><strong>Key ID 错误：</strong>填写本系统保存后显示的 Key ID，不要手动编造。</li><li><strong>平台未授权：</strong>联系平台管理员在「扩展应用」中为当前企业开启授权。</li><li><strong>连接状态异常：</strong>检查服务端地址是否可被 Jingpro 服务器访问。</li></ul></div>
        </details>
      </section>
    </form>
  </section>
</template>

<style scoped>
.jingpro-page{min-height:100%;padding:14px;background:#f5f6f8}.setting-form,.state-card{padding:16px;border:1px solid #e6ebf2;border-radius:15px;background:#fff;box-shadow:0 6px 20px rgba(15,23,42,.04)}.state-card{text-align:center;color:#8490a5}.notice{margin-bottom:12px;padding:10px 12px;border-radius:9px;font-size:13px}.notice.success{background:#ecfdf5;color:#047857}.notice.error{background:#fef2f2;color:#b91c1c}.switch-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;padding:14px;border-radius:11px;background:#f8fafc}.switch-row span,.switch-row small{display:block}.switch-row strong{font-size:14px}.switch-row small{margin-top:4px;color:#8490a5;font-size:11px}.switch-row input{width:20px;height:20px}.fields{display:grid;gap:15px}.fields label{display:grid;gap:7px;color:#334155;font-size:13px;font-weight:600}.fields input{box-sizing:border-box;width:100%;padding:11px 12px;border:1px solid #d8e0ea;border-radius:9px;font-size:14px;outline:none}.fields input:focus{border-color:#2563eb}.secret-field{display:flex;gap:8px}.secret-field input{min-width:0;flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.secret-field button{flex:none;padding:0 12px;border:1px solid #2563eb;border-radius:9px;background:#eff6ff;color:#1d4ed8;font-weight:600}.fields small{color:#8490a5;font-size:11px;font-weight:400}.details{display:grid;gap:12px;margin-top:18px;padding:14px;border-radius:11px;background:#f8fafc}.details div{display:grid;gap:4px;min-width:0}.details span{color:#8490a5;font-size:11px}.details strong,.details code{overflow-wrap:anywhere;color:#0f172a;font-size:12px}.save{width:100%;margin-top:18px;padding:12px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-size:14px;font-weight:600}.save:disabled{opacity:.6}.tutorial{margin-top:16px;padding:14px;border:1px solid #e6ebf2;border-radius:15px;background:#fff;box-shadow:0 6px 20px rgba(15,23,42,.04)}.section-heading{margin-bottom:8px}.section-heading span{color:#8490a5;font-size:11px;font-weight:600}.section-heading h2{margin:4px 0 0;font-size:16px}.tutorial details{margin-top:8px;border:1px solid #e6ebf2;border-radius:11px;overflow:hidden}.tutorial summary{display:flex;align-items:center;gap:8px;padding:12px;cursor:pointer;font-weight:600;font-size:14px}.tutorial summary b{display:grid;width:24px;height:24px;border-radius:7px;background:#dbeafe;color:#1d4ed8;place-items:center;font-size:12px}.step{padding:0 12px 14px;color:#475569;font-size:12px;line-height:1.7}.step ol,.step ul{padding-left:18px}.step strong{color:#0f172a}.copy-field{margin-top:10px}.copy-row{display:flex;gap:7px}.copy-row input{min-width:0;flex:1;padding:8px 10px;border:1px solid #d8e0ea;border-radius:8px;background:#f8fafc;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.copy-row button{flex:none;padding:0 12px;border:1px solid #2563eb;border-radius:8px;background:#eff6ff;color:#1d4ed8;font-weight:600;font-size:12px}
</style>
