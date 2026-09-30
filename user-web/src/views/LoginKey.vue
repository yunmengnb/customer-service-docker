<script setup>
import { onMounted, ref } from 'vue'
import api from '../api'
import { copyText } from '../clipboard'

const keyInfo = ref(null)
const revealedKey = ref('')
const loading = ref(false)
const action = ref('')
const error = ref('')
const notice = ref('')

function unwrap(response) { return response?.data ?? response ?? null }
function summary(info) {
  if (!info) return ''
  if (info.summary || info.maskedKey || info.keyPreview) return info.summary || info.maskedKey || info.keyPreview
  const prefix = info.prefix || ''
  const suffix = info.suffix || info.lastFour || ''
  return prefix || suffix ? `${prefix}${prefix && suffix ? '••••••••' : ''}${suffix}` : '已生成登录密钥'
}

async function loadKey() {
  loading.value = true
  error.value = ''
  try { keyInfo.value = unwrap(await api.get('/tenant/auth/login-key')) }
  catch (e) { error.value = e?.message || '登录密钥加载失败' }
  finally { loading.value = false }
}

async function generate() {
  if (action.value) return
  action.value = 'generate'; error.value = ''; notice.value = ''; revealedKey.value = ''
  try {
    const data = unwrap(await api.post('/tenant/auth/login-key/generate'))
    revealedKey.value = data?.key || data?.loginKey || data?.token || ''
    keyInfo.value = data?.loginKeyInfo || data
    notice.value = revealedKey.value ? '临时登录密钥已生成，120 秒内有效且仅可使用一次，请立即复制。' : '临时登录密钥已生成。'
  } catch (e) { error.value = e?.message || '生成登录密钥失败' }
  finally { action.value = '' }
}

async function revoke() {
  if (action.value || !window.confirm('确认撤销当前登录密钥吗？撤销后将无法继续使用。')) return
  action.value = 'revoke'; error.value = ''; notice.value = ''
  try {
    await api.delete('/tenant/auth/login-key')
    keyInfo.value = null; revealedKey.value = ''; notice.value = '登录密钥已撤销'
  } catch (e) { error.value = e?.message || '撤销登录密钥失败' }
  finally { action.value = '' }
}

async function copyKey() {
  try { await copyText(revealedKey.value); notice.value = '完整密钥已复制，请妥善保存' }
  catch (e) { error.value = e?.message || '复制失败，请手动复制' }
}

onMounted(loadKey)
</script>

<template>
  <section class="key-page">
    <div class="page-intro"><div><h1>临时登录密钥</h1><p>密钥生成后 120 秒内有效，且只能成功登录一次。</p></div></div>
    <div v-if="error" class="feedback error">{{ error }}</div>
    <div v-if="notice" class="feedback success">{{ notice }}</div>
    <div v-if="loading" class="key-card state">正在加载登录密钥...</div>
    <article v-else class="key-card">
      <div class="key-icon">⌘</div>
      <div class="key-content">
        <h2>{{ keyInfo ? '当前登录密钥' : '尚未生成登录密钥' }}</h2>
        <p v-if="keyInfo" class="summary">{{ summary(keyInfo) }}</p>
        <p v-else class="description">生成后完整密钥仅显示一次，有效期为 120 秒。</p>
        <div v-if="revealedKey" class="revealed">
          <div class="warning">请立即复制并妥善保存此密钥，离开本页面后无法再次查看完整内容。</div>
          <code>{{ revealedKey }}</code>
          <button class="copy" @click="copyKey">复制完整密钥</button>
        </div>
      </div>
      <div class="key-actions">
        <button class="primary" :disabled="Boolean(action)" @click="generate">{{ action === 'generate' ? '生成中...' : keyInfo ? '重新生成' : '生成登录密钥' }}</button>
        <button v-if="keyInfo" class="danger-outline" :disabled="Boolean(action)" @click="revoke">{{ action === 'revoke' ? '撤销中...' : '撤销' }}</button>
      </div>
    </article>
    <div class="tips"><strong>安全提示</strong><ul><li>临时密钥仅在生成后 120 秒内有效。</li><li>密钥成功登录一次后立即失效。</li><li>重新生成会使此前尚未使用的密钥失效。</li></ul></div>
  </section>
</template>

<style scoped>
.key-page { max-width:900px; margin:0 auto; color:#0f172a; }.page-intro { margin-bottom:18px; }.page-intro h1 { margin:0; font-size:22px; }.page-intro p { margin:6px 0 0; color:#64748b; font-size:13px; }.key-card { display:flex; align-items:flex-start; gap:18px; padding:24px; border:1px solid #e2e8f0; border-radius:16px; background:#fff; box-shadow:0 4px 15px rgba(15,23,42,.04); }.key-card.state { justify-content:center; color:#64748b; }.key-icon { display:grid; place-items:center; flex:0 0 48px; height:48px; border-radius:13px; color:#2563eb; background:#dbeafe; font-size:23px; font-weight:700; }.key-content { flex:1; min-width:0; }.key-content h2 { margin:2px 0 8px; font-size:17px; }.summary { display:inline-block; margin:0; padding:7px 10px; border-radius:7px; background:#f1f5f9; color:#334155; font-family:monospace; overflow-wrap:anywhere; }.description { margin:0; color:#64748b; font-size:13px; }.key-actions { display:flex; gap:8px; }.key-actions button,.copy { padding:9px 14px; border-radius:9px; font:inherit; font-size:13px; font-weight:600; cursor:pointer; }.primary { border:1px solid #2563eb; color:#fff; background:#2563eb; }.danger-outline { border:1px solid #fecaca; color:#dc2626; background:#fff; }.key-actions button:disabled { cursor:not-allowed; opacity:.55; }.revealed { margin-top:16px; padding:14px; border:1px solid #fde68a; border-radius:10px; background:#fffbeb; }.warning { margin-bottom:10px; color:#92400e; font-size:12px; line-height:1.6; }.revealed code { display:block; padding:10px; border-radius:7px; background:#fff; color:#0f172a; overflow-wrap:anywhere; user-select:all; }.copy { margin-top:10px; border:1px solid #2563eb; color:#2563eb; background:#fff; }.feedback { margin-bottom:12px; padding:10px 13px; border-radius:9px; font-size:13px; }.feedback.error { color:#b91c1c; background:#fef2f2; }.feedback.success { color:#047857; background:#ecfdf5; }.tips { margin-top:16px; padding:18px 20px; border-radius:14px; color:#475569; background:#f1f5f9; font-size:13px; }.tips ul { margin:9px 0 0; padding-left:20px; line-height:1.9; }
@media(max-width:768px){.key-page{padding:14px}.page-intro h1{display:none}.page-intro{margin-bottom:10px}.key-card{flex-direction:column;padding:18px}.key-actions{width:100%;display:grid;grid-template-columns:1fr 1fr}.key-actions button{min-height:42px}.tips{margin-top:12px}}
</style>
