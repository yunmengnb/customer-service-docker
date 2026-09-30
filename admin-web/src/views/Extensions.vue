<!-- 忆梦云团队开发 - 扩展应用统一控制 -->
<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import api from '../api'

const loading = ref(true)
const saving = ref('')
const error = ref('')
const success = ref('')
const extensions = ref([])
const tenants = ref([])
const dialog = reactive({
  open: false,
  provider: '',
  enabled: false,
  scopeMode: 'all',
  tenantIds: [],
  password: '',
  confirmed: false,
  serverBaseUrl: '',
  widgetBaseUrl: '',
})
const current = computed(() => extensions.value.find(item => item.provider === dialog.provider))
const isJingpro = computed(() => dialog.provider === 'jingpro')

function messageOf(err, fallback) { return err?.msg || err?.message || fallback }
function deploymentLabel(key) {
  return ({ serverBaseUrl: 'API 公共地址', widgetBaseUrl: '挂件公共地址', publicOrigin: '微信公开服务域名', credentialKey: '凭据加密能力', notificationLinkKey: '通知链接签名能力' })[key] || key
}
async function load() {
  loading.value = true; error.value = ''
  try {
    const [extensionRes, tenantRes] = await Promise.all([
      api.get('/integration/admin/extensions'),
      api.get('/admin/tenants?limit=1000'),
    ])
    if (extensionRes.code !== 200) throw new Error(extensionRes.msg || '扩展目录加载失败')
    extensions.value = extensionRes.data || []
    tenants.value = tenantRes.data?.items || []
  } catch (err) { error.value = messageOf(err, '扩展目录加载失败') }
  finally { loading.value = false }
}
function openControl(item) {
  Object.assign(dialog, {
    open: true,
    provider: item.provider,
    enabled: item.enabled,
    scopeMode: item.scopeMode || 'all',
    tenantIds: [...(item.tenantIds || [])],
    password: '',
    confirmed: false,
    serverBaseUrl: item.serverBaseUrl || '',
    widgetBaseUrl: item.widgetBaseUrl || '',
  })
  error.value = ''; success.value = ''
}
function closeControl() { if (!saving.value) dialog.open = false }
async function saveControl() {
  if (!dialog.password) { error.value = '请输入当前平台管理员密码完成二次验证'; return }
  if (!dialog.confirmed) { error.value = '请勾选确认本次平台控制操作'; return }
  if (dialog.scopeMode === 'selected' && !dialog.tenantIds.length) { error.value = '请至少选择一个授权企业'; return }
  if (current.value?.enabled && !dialog.enabled && !window.confirm('危险操作：平台停用后，所有企业将立即无法调用该扩展，但已有配置会保留。确认继续？')) return
  saving.value = dialog.provider; error.value = ''
  try {
    const body = {
      enabled: dialog.enabled,
      scopeMode: dialog.scopeMode,
      tenantIds: dialog.scopeMode === 'selected' ? dialog.tenantIds : [],
      confirmed: true,
      currentPassword: dialog.password,
    }
    if (dialog.provider === 'jingpro') {
      body.serverBaseUrl = dialog.serverBaseUrl.trim()
      body.widgetBaseUrl = dialog.widgetBaseUrl.trim()
    }
    const res = await api.patch(`/integration/admin/extensions/${dialog.provider}/status`, body)
    if (res.code !== 200) throw new Error(res.msg || '保存失败')
    const index = extensions.value.findIndex(item => item.provider === dialog.provider)
    extensions.value.splice(index, 1, res.data)
    success.value = res.msg || '扩展平台设置已更新'
    dialog.open = false
  } catch (err) { error.value = messageOf(err, '扩展设置保存失败') }
  finally { saving.value = '' }
}
onMounted(load)
</script>

<template>
  <div class="page-header"><h1>扩展应用</h1><p class="desc">统一控制平台扩展开关、企业授权范围与部署能力</p></div>
  <div v-if="error" class="notice error" role="alert">{{ error }}</div>
  <div v-if="success" class="notice success" role="status">{{ success }}</div>
  <div v-if="loading" class="card loading">正在加载扩展目录...</div>
  <div v-else class="extension-grid">
    <article v-for="item in extensions" :key="item.provider" class="card extension-card">
      <div class="extension-head">
        <div class="extension-logo" :class="{ wechat: item.provider === 'wechat_official' }">{{ item.provider === 'wechat_official' ? '微' : 'J' }}</div>
        <span class="tag" :class="item.enabled ? 'tag-green' : 'tag-gray'">{{ item.enabled ? '平台已启用' : '平台已停用' }}</span>
      </div>
      <div class="body"><h2>{{ item.name }}</h2><p>{{ item.description }}</p>
        <div class="metrics"><div><strong>{{ item.usage?.configuredTenants || 0 }}</strong><span>已配置企业</span></div><div><strong>{{ item.usage?.enabledTenants || 0 }}</strong><span>企业已启用</span></div><div><strong>{{ item.scopeMode === 'selected' ? item.tenantIds.length : '全部' }}</strong><span>授权范围</span></div></div>
        <div class="deployment"><strong>部署能力：{{ item.deploymentReady ? '已就绪' : '待完善' }}</strong><span v-for="(ready, key) in item.deploymentStatus" :key="key" :class="{ ready }">{{ deploymentLabel(key) }} {{ ready ? '已配置' : '未配置' }}</span></div>
      </div>
      <div class="footer"><button class="btn btn-primary" @click="openControl(item)">平台控制</button></div>
    </article>
  </div>

  <div v-if="dialog.open" class="modal-mask" @click.self="closeControl">
    <section class="modal card" role="dialog" aria-modal="true" aria-labelledby="control-title">
      <h2 id="control-title">控制 {{ current?.name }}</h2><p>此处设置会持久化并立即约束企业配置、OAuth、回调、API 与 worker。</p>
      <label class="switch-row"><span><strong>平台全局启用</strong><small>关闭不会删除企业已有配置</small></span><input v-model="dialog.enabled" type="checkbox" /></label>
      <fieldset><legend>企业可用范围</legend><label><input v-model="dialog.scopeMode" value="all" type="radio" /> 全部企业</label><label><input v-model="dialog.scopeMode" value="selected" type="radio" /> 指定企业</label></fieldset>
      <div v-if="dialog.scopeMode === 'selected'" class="tenant-list"><label v-for="tenant in tenants" :key="tenant._id"><input v-model="dialog.tenantIds" :value="tenant._id" type="checkbox" /> <span>{{ tenant.name }}<small>{{ tenant.username }}</small></span></label></div>
      <template v-if="isJingpro">
        <div class="sub-section">
          <h3>公共访问地址</h3>
          <p class="sub-desc">供 Jingpro 服务调用客服接口与生成客户聊天页面，必须填写完整公共地址。</p>
          <label class="field">客服 API 公共地址<input v-model="dialog.serverBaseUrl" type="url" placeholder="https://api.example.com" /></label>
          <label class="field">客户聊天/挂件公共地址<input v-model="dialog.widgetBaseUrl" type="url" placeholder="https://chat.example.com" /></label>
        </div>
      </template>
      <label class="field">当前管理员密码<input v-model="dialog.password" type="password" autocomplete="current-password" placeholder="用于本次敏感操作验证" /></label>
      <label class="confirm"><input v-model="dialog.confirmed" type="checkbox" /> 我已确认平台开关及企业授权范围</label>
      <div class="modal-actions"><button class="btn btn-ghost" :disabled="!!saving" @click="closeControl">取消</button><button class="btn" :class="dialog.enabled ? 'btn-primary' : 'btn-danger'" :disabled="!!saving" @click="saveControl">{{ saving ? '保存中...' : '确认保存' }}</button></div>
    </section>
  </div>
</template>

<style scoped>
.notice{margin-bottom:16px;padding:12px 14px;border:1px solid;border-radius:10px}.notice.error{border-color:#fecaca;background:#fef2f2;color:#b91c1c}.notice.success{border-color:#bbf7d0;background:#f0fdf4;color:#047857}.loading{padding:40px;text-align:center;color:var(--text-muted)}.extension-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:20px}.extension-card{display:flex;min-height:390px;flex-direction:column;padding:22px}.extension-head,.footer,.switch-row,.modal-actions{display:flex;align-items:center;justify-content:space-between;gap:14px}.extension-logo{display:grid;width:48px;height:48px;border-radius:13px;background:linear-gradient(135deg,#2563eb,#1e3a8a);color:#fff;font-size:22px;font-weight:800;place-items:center}.extension-logo.wechat{background:linear-gradient(135deg,#16a34a,#15803d)}.body{flex:1;padding:18px 0}.body h2{font-size:19px}.body>p{min-height:42px;margin:7px 0 18px;color:var(--text-sec);font-size:13px}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.metrics div{padding:12px 8px;border-radius:10px;background:#f8fafc;text-align:center}.metrics strong,.metrics span{display:block}.metrics strong{font-size:18px}.metrics span{margin-top:3px;color:var(--text-muted);font-size:11px}.deployment{display:flex;flex-wrap:wrap;gap:7px;margin-top:16px}.deployment strong{width:100%;font-size:13px}.deployment span{padding:4px 8px;border-radius:99px;background:#fee2e2;color:#b91c1c;font-size:11px}.deployment span.ready{background:#dcfce7;color:#15803d}.footer{justify-content:flex-end;padding-top:16px;border-top:1px solid var(--border)}.modal-mask{position:fixed;z-index:500;inset:0;display:grid;padding:18px;background:rgba(15,23,42,.5);place-items:center}.modal{width:min(620px,100%);max-height:calc(100vh - 36px);overflow:auto;padding:24px}.modal>p{color:var(--text-sec);font-size:13px}.switch-row{margin:18px 0;padding:14px;border:1px solid var(--border);border-radius:10px}.switch-row span,.switch-row small{display:block}.switch-row small{margin-top:4px;color:var(--text-muted);font-weight:400}fieldset{display:flex;gap:20px;margin:0;padding:14px;border:1px solid var(--border);border-radius:10px}fieldset label,.confirm{display:flex;align-items:center;gap:7px}.tenant-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;max-height:220px;margin-top:12px;overflow:auto}.tenant-list label{display:flex;align-items:center;gap:8px;padding:9px;border:1px solid var(--border);border-radius:8px}.tenant-list span,.tenant-list small{display:block;min-width:0}.tenant-list small{color:var(--text-muted)}.field{display:grid;gap:7px;margin-top:16px}.field input{min-height:42px;padding:9px 11px;border:1px solid var(--border);border-radius:8px}.confirm{margin:16px 0}.modal-actions{justify-content:flex-end;padding-top:14px;border-top:1px solid var(--border)}.btn-danger{background:#dc2626;color:#fff}.sub-section{margin-top:18px;padding:16px;border:1px solid var(--border);border-radius:10px;background:#f8fafc}.sub-section h3{margin:0 0 6px;font-size:15px}.sub-desc{margin:0 0 14px;color:var(--text-muted);font-size:12px;line-height:1.6}@media(max-width:576px){.extension-grid{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,1fr)}.tenant-list{grid-template-columns:1fr}.modal{padding:18px}.modal-actions .btn{flex:1}}
</style>
