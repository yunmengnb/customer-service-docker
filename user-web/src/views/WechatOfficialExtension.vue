<!-- 忆梦云团队开发 -->
<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import api from '../api'
const state = reactive({ configuration: null, platformEnabled: false, authorized: false, authorizationReason: '', tenantEnabled: false, configured: false, configurationCompleteness: 0, deploymentReady: false, deploymentStatus: {} })
const busy = ref(false), loaded = ref(false), feedback = ref(''), oauthAcknowledged = ref(false), copied = ref('')
const form = reactive({ displayName: '', appId: '', appSecret: '', token: '', encodingAESKey: '', password: '', configVersion: 0 })
const notificationForm = reactive({ templateId: '', title: '', sender: '', time: '', remark: '' })
const configuration = computed(() => state.configuration)
const writable = computed(() => state.platformEnabled && state.authorized)
function clearSecrets() { for (const key of ['appSecret', 'token', 'encodingAESKey', 'password']) form[key] = '' }
function errorMessage(error, fallback = '请求失败') { return error?.message || error?.msg || fallback }
async function load() {
  const result = await api.get('/tenant/extensions/wechat-official')
  if (result.code !== 0) throw new Error(result.message || '加载失败')
  Object.assign(state, result.data)
  const current = state.configuration
  Object.assign(form, { displayName: current?.displayName || '', appId: current?.appId || '', configVersion: current?.configVersion || 0 })
  Object.assign(notificationForm, { templateId: current?.notificationTemplateId || '', title: current?.notificationFieldMapping?.title || '', sender: current?.notificationFieldMapping?.sender || '', time: current?.notificationFieldMapping?.time || '', remark: current?.notificationFieldMapping?.remark || '' })
  loaded.value = true
}
async function perform(action) {
  if (busy.value || (action !== 'load' && !writable.value)) return
  busy.value = true; feedback.value = ''
  try {
    if (action === 'load') await load()
    else {
      const result = action === 'save' ? await api.put('/tenant/extensions/wechat-official', { ...form }) : await api.post('/tenant/extensions/wechat-official/verify', { password: form.password, configVersion: form.configVersion })
      if (result.code !== 0) throw new Error(result.message || '操作失败')
      feedback.value = action === 'save' ? '草稿已保存；保存不会自动启用能力。' : `凭据检测：${result.data.result === 'passed' ? '通过；OAuth、模板权限仍需分别验收' : '未通过，请核对凭据、出口 IP 白名单与网络'}`
      await load()
    }
  } catch (error) { feedback.value = errorMessage(error) } finally { clearSecrets(); busy.value = false }
}
async function activate() {
  if (busy.value || !writable.value) return
  busy.value = true
  try {
    const result = await api.post('/tenant/extensions/wechat-official/activation', { enabled: !configuration.value.enabled, configVersion: form.configVersion, password: form.password, oauthAcknowledged: oauthAcknowledged.value })
    if (result.code !== 0) throw new Error(result.message || '启停失败')
    await load(); feedback.value = '公众号绑定与登录能力状态已更新。'
  } catch (error) { feedback.value = errorMessage(error, '启停失败') } finally { clearSecrets(); busy.value = false }
}
async function configureNotification() {
  if (busy.value || !writable.value) return
  busy.value = true; feedback.value = ''
  try {
    const result = await api.post('/tenant/extensions/wechat-official/notification', { enabled: !configuration.value.notificationEnabled, configVersion: form.configVersion, password: form.password, notificationTemplateId: notificationForm.templateId, notificationFieldMapping: { title: notificationForm.title, sender: notificationForm.sender, time: notificationForm.time, remark: notificationForm.remark } })
    if (result.code !== 0) throw new Error(result.message || '通知配置失败')
    await load(); feedback.value = configuration.value.notificationEnabled ? '微信消息通知已启用。' : '微信消息通知已停用，模板配置已保存。'
  } catch (error) { feedback.value = errorMessage(error, '通知配置失败') } finally { clearSecrets(); busy.value = false }
}
async function copyValue(key, value) {
  if (!value) return
  try { await navigator.clipboard.writeText(value); copied.value = key; window.setTimeout(() => { if (copied.value === key) copied.value = '' }, 1800) } catch { feedback.value = '浏览器未允许复制，请手动选择文本。' }
}
onMounted(() => perform('load'))
</script>

<template>
  <section class="wechat-config">
    <header class="hero"><span>企业扩展 · 安全模式</span><h1>微信公众号</h1><p>企业独立服务号配置、微信身份绑定登录与模板通知</p></header>
    <p v-if="feedback" role="status" class="feedback">{{ feedback }}</p>
    <button v-if="!loaded" :disabled="busy" @click="perform('load')">{{ busy ? '加载中…' : '重新加载' }}</button>
    <template v-else>
      <aside v-if="!writable" class="blocked" role="alert"><strong>当前不可配置</strong><span>{{ state.authorizationReason || '平台尚未授权当前企业使用此扩展' }}</span><small>已有配置不会被删除；平台重新授权后可继续使用。</small></aside>
      <div class="status-grid">
        <div><span>平台授权</span><strong :class="{ ok: state.authorized }">{{ state.authorized ? '已授权' : '未授权' }}</strong></div>
        <div><span>企业能力</span><strong :class="{ ok: state.tenantEnabled }">{{ state.tenantEnabled ? '已启用' : '未启用' }}</strong></div>
        <div><span>凭据完整度</span><strong :class="{ ok: state.configurationCompleteness >= 75 }">{{ state.configurationCompleteness }}%</strong></div>
        <div><span>回调握手</span><strong :class="{ ok: !!configuration?.callbackCheckedAt }">{{ configuration?.callbackCheckedAt ? '已验证' : '待验证' }}</strong></div>
        <div><span>部署能力</span><strong :class="{ ok: state.deploymentReady }">{{ state.deploymentReady ? '已就绪' : '待完善' }}</strong></div>
      </div>

      <form @submit.prevent="perform('save')">
        <div class="section-heading"><div><h2>基础信息与安全凭据</h2><p>Secret、Token 和 EncodingAESKey 仅写入加密存储，页面与接口永不回显明文。</p></div></div>
        <div class="fields">
          <label>服务号名称<input v-model="form.displayName" required maxlength="80" :disabled="busy || !writable" /></label>
          <label>AppID<input v-model="form.appId" required pattern="wx[a-fA-F0-9]{16}" :disabled="busy || !writable || !!configuration" /><small>创建后不可直接换号，历史绑定不可继承。</small></label>
          <label v-for="(title, key) in { appSecret: 'AppSecret', token: 'Token', encodingAESKey: 'EncodingAESKey' }" :key="key">{{ title }}<input v-model="form[key]" type="password" autocomplete="new-password" :disabled="busy || !writable || !!configuration?.credentialCheckedAt" :required="!configuration" :placeholder="configuration ? '已设置；留空保持不变' : '只写入，不回显'" /><small>已检测凭据暂不支持在线覆盖，请按安全轮换流程处理。</small></label>
          <label>当前账号密码<input v-model="form.password" type="password" autocomplete="current-password" required maxlength="200" :disabled="busy || !writable" /><small>保存、检测、启停均需二次验证。</small></label>
        </div>
        <div class="actions"><button :disabled="busy || !writable">{{ busy ? '处理中…' : '保存草稿' }}</button><button type="button" :disabled="busy || !writable || !configuration || !form.password" @click="perform('verify')">验证配置</button></div>
      </form>

      <article v-if="configuration" class="capability-panel">
        <h2>能力启用</h2><p>须先完成凭据检测、安全回调握手，并确认网页授权权限和 HTTPS 域名。</p>
        <label class="check-row"><input v-model="oauthAcknowledged" type="checkbox" :disabled="!writable" />我已核对网页授权权限和同源 HTTPS 域名；启用后会进行真实设备验收。</label>
        <div class="actions"><button type="button" :disabled="busy || !writable || !form.password || (!configuration.enabled && !oauthAcknowledged)" @click="activate">{{ configuration.enabled ? '停用并撤销微信会话' : '启用客服绑定与登录' }}</button><RouterLink to="/wechat-binding">前往我的微信绑定</RouterLink></div>
        <label class="copy-field"><span>企业客服微信登录链接</span><span class="copy-row"><input readonly :value="configuration.staffLoginUrl" /><button type="button" :disabled="!configuration.staffLoginUrl" @click="copyValue('staff', configuration.staffLoginUrl)">{{ copied === 'staff' ? '已复制' : '复制' }}</button></span></label>
      </article>

      <article v-if="configuration" class="notification-panel">
        <h2>模板消息通知</h2><p>必须使用当前公众号后台的真实模板 ID；启用前系统会检测 MongoDB 事务能力，不会自动修改数据库。</p>
        <div class="fields notification-fields"><label>模板 ID<input v-model="notificationForm.templateId" maxlength="128" :disabled="busy || !writable" /></label><label>标题字段<input v-model="notificationForm.title" maxlength="32" :disabled="busy || !writable" placeholder="例如 first" /></label><label>发送者字段<input v-model="notificationForm.sender" maxlength="32" :disabled="busy || !writable" placeholder="例如 keyword1" /></label><label>时间字段<input v-model="notificationForm.time" maxlength="32" :disabled="busy || !writable" placeholder="例如 keyword2" /></label><label>备注字段<input v-model="notificationForm.remark" maxlength="32" :disabled="busy || !writable" placeholder="例如 remark" /></label></div>
        <button type="button" :disabled="busy || !writable || !form.password || !configuration.enabled" @click="configureNotification">{{ configuration.notificationEnabled ? '停用通知并保存模板' : '检查事务并启用通知' }}</button>
      </article>

      <section class="tutorial" aria-labelledby="tutorial-title"><div class="section-heading"><div><span>内嵌教程</span><h2 id="tutorial-title">微信公众平台配置步骤</h2><p>按顺序完成，每一步都与当前系统实际实现对应。</p></div></div>
        <details open><summary><b>1</b> 前置条件与账号要求</summary><div class="step"><p>准备已认证的微信公众号服务号，并确保账号具备网页授权和模板消息能力。系统只支持“安全模式”回调，不支持明文或兼容模式。</p><p>若回调已由其他系统接管，请先规划迁移；一个公众号服务器配置不能同时交给多个系统处理。</p></div></details>
        <details><summary><b>2</b> 获取 AppID 与 AppSecret</summary><div class="step"><p>登录微信公众平台，在“设置与开发 → 基本配置”查看 AppID，并按微信安全流程生成或重置 AppSecret。将它们填写到本页，AppSecret 只写入、不回显。</p><p>重置 AppSecret 会使旧凭据立即失效；请先停用相关能力，在维护窗口完成轮换和重新验证。</p></div></details>
        <details><summary><b>3</b> 设置服务器 URL、Token 与 EncodingAESKey</summary><div class="step"><p>在“设置与开发 → 基本配置 → 服务器配置”填写以下动态回调 URL，消息加解密方式选择“安全模式”。Token 填本页保存的同一随机值；EncodingAESKey 可由微信后台随机生成。</p><label class="copy-field"><span>服务器回调 URL</span><span class="copy-row"><input readonly :value="configuration?.callbackUrl || '保存公众号配置后生成'" /><button type="button" :disabled="!configuration?.callbackUrl" @click="copyValue('callback', configuration?.callbackUrl)">{{ copied === 'callback' ? '已复制' : '复制' }}</button></span></label><p>Token 建议使用随机字母数字，EncodingAESKey 必须为 43 位；不要通过聊天或日志传播。轮换前先停用企业能力，更新后重新保存、验证并完成微信握手。</p></div></details>
        <details><summary><b>4</b> 配置网页授权域名</summary><div class="step"><p>在“设置与开发 → 公众号设置 → 功能设置 → 网页授权域名”填写下列域名，仅填域名，不含协议、路径和端口。</p><label class="copy-field"><span>网页授权域名</span><span class="copy-row"><input readonly :value="configuration?.oauthDomain || '保存公众号配置后生成'" /><button type="button" :disabled="!configuration?.oauthDomain" @click="copyValue('oauth', configuration?.oauthDomain)">{{ copied === 'oauth' ? '已复制' : '复制' }}</button></span></label><p>本实现不调用微信 JS-SDK，因此不要求为本扩展额外配置 JS 接口安全域名或业务域名。域名必须与系统公开 HTTPS 服务域名一致。</p></div></details>
        <details><summary><b>5</b> 配置模板通知字段</summary><div class="step"><p>在微信公众平台“广告与服务 → 模板消息”选择模板，将模板 ID 填入本页，并把模板字段分别映射到 title、sender、time、remark。示例字段 first、keyword1、keyword2、remark 仅供参考，必须以实际模板为准。</p><p>通知只发送给已关注且已完成绑定的接收人；“验证配置”不会验证模板是否存在，模板发送权限需在启用后按真实设备验收。</p></div></details>
        <details><summary><b>6</b> 配置 IP 白名单并验证</summary><div class="step"><p>在微信公众平台配置调用 API 的出口公网 IP 白名单。应填写服务器或 NAT 的固定出口 IP，不是浏览器 IP。</p><ol><li>填写并保存草稿。</li><li>点击“验证配置”，安全调用微信 token/API 检查 AppID、AppSecret 与白名单。</li><li>在微信后台保存服务器配置，系统收到有效握手后“回调握手”显示已验证。</li><li>确认网页授权后启用绑定与登录；最后用真实微信设备验收 OAuth 和模板通知。</li></ol></div></details>
        <details><summary><b>7</b> 常见错误排查</summary><div class="step"><ul><li><strong>invalid appid/secret：</strong>核对公众号 AppID、AppSecret，确认 Secret 未被重置。</li><li><strong>redirect_uri 域名错误：</strong>网页授权域名只填域名，并与上方动态值完全一致。</li><li><strong>token 签名失败：</strong>微信后台 Token 必须与本系统保存值一致，且必须选择安全模式。</li><li><strong>IP 白名单错误：</strong>确认生产服务实际出口公网 IP，注意容器/NAT 出口。</li><li><strong>模板不存在：</strong>核对模板 ID、模板所属公众号及四个字段映射，字段不能重复。</li></ul><p>在线验证只能确认凭据/API 连通性；OAuth、回调与模板发送必须分别通过微信实际流程验证。</p></div></details>
      </section>
    </template>
  </section>
</template>


<style scoped>
.wechat-config{max-width:1100px;margin:auto;padding:16px;color:#0f172a}.hero{padding:28px;border-radius:18px;color:#fff;background:linear-gradient(135deg,#172554,#2563eb);box-shadow:0 16px 40px rgba(37,99,235,.2)}.hero h1{margin:8px 0;font-size:28px}.hero p{margin:0;opacity:.86}.feedback,.blocked{margin:16px 0;padding:14px 16px;border-radius:12px;line-height:1.6}.feedback{background:#eff6ff;color:#1e40af}.blocked{display:grid;gap:4px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b}.blocked small{color:#b91c1c}.status-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:16px 0}.status-grid div{padding:14px;border:1px solid #e2e8f0;border-radius:13px;background:#fff}.status-grid span,.status-grid strong{display:block}.status-grid span{color:#64748b;font-size:12px}.status-grid strong{margin-top:6px;color:#b45309}.status-grid strong.ok{color:#15803d}form,article,.tutorial{margin-top:16px;padding:24px;border:1px solid #e2e8f0;border-radius:16px;background:#fff}.section-heading h2,h2{margin:4px 0;font-size:19px}.section-heading p,article p,.step{color:#475569;font-size:13px;line-height:1.7}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:18px}label{display:flex;min-width:0;flex-direction:column;gap:7px;font-weight:600}input{width:100%;min-height:44px;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit}small{color:#64748b;font-size:12px;line-height:1.5;font-weight:400}.actions{display:flex;align-items:center;gap:12px;margin-top:22px;flex-wrap:wrap}button,.actions a{min-height:44px;box-sizing:border-box;padding:11px 18px;border:0;border-radius:9px;background:#2563eb;color:#fff;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}button:disabled{opacity:.48;cursor:not-allowed}.check-row{display:flex;align-items:flex-start;flex-direction:row;margin-top:12px}.check-row input{width:18px;min-height:18px}.copy-field{margin-top:14px}.copy-row{display:flex;gap:8px}.copy-row input{min-width:0;flex:1;background:#f8fafc}.copy-row button{flex:0 0 auto}.tutorial details{margin-top:10px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}.tutorial summary{display:flex;align-items:center;gap:10px;padding:15px;cursor:pointer;font-weight:700}.tutorial summary b{display:grid;width:28px;height:28px;border-radius:8px;background:#dbeafe;color:#1d4ed8;place-items:center}.step{padding:0 16px 16px}.step ol,.step ul{padding-left:20px}.step strong{color:#0f172a}input:focus-visible,button:focus-visible,summary:focus-visible,a:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}@media(max-width:900px){.status-grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:768px){.fields{grid-template-columns:1fr}.status-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:576px){.wechat-config{padding:12px}.hero,form,article,.tutorial{padding:17px}.status-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.copy-row{align-items:stretch;flex-direction:column}.copy-row button,.actions button,.actions a{width:100%;text-align:center}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style>
