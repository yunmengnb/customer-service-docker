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

      <section class="tutorial" aria-labelledby="tutorial-title">
        <div class="section-heading"><div><span>配置教程</span><h2 id="tutorial-title">Jingpro 联动接入步骤</h2><p>按顺序完成，每一步都与当前系统实际实现对应。</p></div></div>
        <details open>
          <summary><b>1</b> 了解联动关系</summary>
          <div class="step">
            <p>Jingpro（鲸商城）通过本系统提供的接口管理企业客服能力。当前企业在本系统配置的「平台密钥」会与 Jingpro 后台填写的密钥保持一致，用于双方接口的 HMAC 签名校验。</p>
            <p>平台名称与平台地址仅用于本系统展示与回调，不会自动同步到 Jingpro。</p>
          </div>
        </details>
        <details>
          <summary><b>2</b> 生成并保存接口密钥</summary>
          <div class="step">
            <ol>
              <li>点击「自动生成」生成 64 位安全随机密钥。</li>
              <li>立即复制该密钥，保存后系统不会再次回显。</li>
              <li>将同一密钥填写到 Jingpro 管理员后台对应的接口密钥字段。</li>
              <li>填写平台名称与平台地址后点击「保存配置」。</li>
            </ol>
            <p>密钥只写入加密存储；如后续需要轮换，点击「重新生成」并同步更新 Jingpro 后台。</p>
          </div>
        </details>
        <details>
          <summary><b>3</b> 查看 Key ID 与服务端地址</summary>
          <div class="step">
            <p>保存后系统会生成 Key ID，并显示服务端地址与挂件地址。这些地址由平台管理员统一配置，企业不可修改。</p>
            <div v-if="details.keyId" class="copy-field"><span>Key ID</span><span class="copy-row"><input readonly :value="details.keyId" /><button type="button" @click="copyValue('keyId', details.keyId)">{{ copied === 'keyId' ? '已复制' : '复制' }}</button></span></div>
            <p>将 Key ID 填写到 Jingpro 后台，用于标识当前企业的连接。</p>
          </div>
        </details>
        <details>
          <summary><b>4</b> 启用联动能力</summary>
          <div class="step">
            <p>勾选「启用 Jingpro 联动」并保存。启用后 Jingpro 可通过签名接口调用本系统的客服能力。</p>
            <p>若平台未授权当前企业使用此扩展，请联系平台管理员在扩展应用中开启授权。</p>
          </div>
        </details>
        <details>
          <summary><b>5</b> 常见错误排查</summary>
          <div class="step">
            <ul>
              <li><strong>密钥不匹配：</strong>确认本系统与 Jingpro 后台填写的密钥完全一致，注意不要多复制空格。</li>
              <li><strong>Key ID 错误：</strong>确认填写的是本系统「保存配置」后显示的 Key ID，不要手动编造。</li>
              <li><strong>平台未授权：</strong>联系平台管理员在「扩展应用」中为当前企业开启 Jingpro 授权。</li>
              <li><strong>连接状态异常：</strong>检查服务端地址是否可被 Jingpro 服务器访问，确认网络与防火墙规则。</li>
            </ul>
          </div>
        </details>
      </section>
    </div>
  </section>
</template>

<style scoped>
.jingpro-page{width:min(900px,100%);margin:0 auto;padding-bottom:24px}.page-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:18px;padding:24px 28px;border-radius:18px;background:linear-gradient(135deg,#172554,#2563eb);color:#fff}.page-heading a{color:#bfdbfe;font-size:13px;text-decoration:none}.page-heading h1{margin:7px 0 4px;font-size:25px}.page-heading p{margin:0;color:#dbeafe;font-size:13px}.status{padding:5px 10px;border-radius:999px;background:rgba(255,255,255,.16);font-size:12px}.status.enabled{background:#dcfce7;color:#15803d}.panel,.state-card{padding:26px;border:1px solid #e2e8f0;border-radius:16px;background:#fff;box-shadow:0 4px 16px rgba(15,23,42,.05)}.state-card{text-align:center;color:#64748b}.notice{margin-bottom:16px;padding:11px 13px;border-radius:9px;font-size:13px}.notice.success{background:#ecfdf5;color:#047857}.notice.error{background:#fef2f2;color:#b91c1c}.switch-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;padding:15px;border:1px solid #e2e8f0;border-radius:11px;background:#f8fafc}.switch-row span,.switch-row small{display:block}.switch-row small,.form-grid small{margin-top:4px;color:#64748b;font-size:12px}.switch-row input{width:20px;height:20px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.form-grid label{display:grid;gap:7px;color:#334155;font-size:13px;font-weight:600}.form-grid .full{grid-column:1/-1}.form-grid input{box-sizing:border-box;width:100%;padding:11px 12px;border:1px solid #cbd5e1;border-radius:9px;outline:none}.form-grid input:focus{border-color:#2563eb}.secret-field{display:flex;gap:9px}.secret-field input{min-width:0;flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.secret-field button{flex:none;padding:0 16px;border:1px solid #2563eb;border-radius:9px;background:#eff6ff;color:#1d4ed8;font-weight:600;cursor:pointer}.details{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:22px;padding:16px;border-radius:11px;background:#f8fafc}.details div{display:grid;gap:5px;min-width:0}.details div:nth-child(n+4){grid-column:span 3}.details span{color:#64748b;font-size:11px}.details strong,.details code{overflow-wrap:anywhere;color:#0f172a;font-size:12px}.actions{display:flex;justify-content:flex-end;align-items:center;gap:16px;margin-top:22px;padding-top:18px;border-top:1px solid #e2e8f0}.actions a{color:#64748b;text-decoration:none}.actions button{padding:10px 18px;border:0;border-radius:9px;background:#2563eb;color:#fff;font-weight:600}.actions button:disabled{opacity:.6}.tutorial{margin-top:18px;padding:24px;border:1px solid #e2e8f0;border-radius:16px;background:#fff;box-shadow:0 4px 16px rgba(15,23,42,.05)}.section-heading{margin-bottom:8px}.section-heading h2{font-size:18px}.section-heading p,.step{color:#475569;font-size:13px;line-height:1.7}.tutorial details{margin-top:10px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}.tutorial summary{display:flex;align-items:center;gap:10px;padding:15px;cursor:pointer;font-weight:700}.tutorial summary b{display:grid;width:28px;height:28px;border-radius:8px;background:#dbeafe;color:#1d4ed8;place-items:center}.step{padding:0 16px 16px}.step ol,.step ul{padding-left:20px}.step strong{color:#0f172a}.copy-field{margin-top:14px}.copy-row{display:flex;gap:8px}.copy-row input{min-width:0;flex:1;background:#f8fafc;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.copy-row button{flex:0 0 auto;padding:0 14px;border:1px solid #2563eb;border-radius:9px;background:#eff6ff;color:#1d4ed8;font-weight:600;cursor:pointer}@media(max-width:768px){.details{grid-template-columns:1fr}.details div:nth-child(n+4){grid-column:auto}.form-grid{grid-template-columns:1fr}}
</style>
