<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../../api'

const router = useRouter()
const extensions = ref([])
const loading = ref(true)
const error = ref('')

function normalizeExtensions(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.extensions)) return data.extensions
  return Object.entries(data || {}).filter(([, value]) => value && typeof value === 'object').map(([key, value]) => ({ key, ...value }))
}

function extensionKey(item) {
  return String(item.provider || item.key || item.code || item.slug || item.id || '').toLowerCase()
}

async function loadExtensions() {
  loading.value = true
  error.value = ''
  try {
    const res = await api.get('/tenant/extensions')
    if (![0, 200].includes(res.code)) throw new Error(res.message || res.msg || '扩展应用加载失败')
    extensions.value = normalizeExtensions(res.data)
  } catch (err) {
    error.value = err?.message || err?.msg || '扩展应用加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function openExtension(item) {
  if (extensionKey(item) === 'jingpro') router.push('/desktop/extensions/jingpro')
}

onMounted(loadExtensions)
</script>

<template>
  <section class="extension-page">
    <header class="extension-heading">
      <div><span>企业应用</span><h1>扩展应用</h1><p>配置租户可用的第三方平台连接。</p></div>
    </header>
    <div v-if="loading" class="state-card">正在加载扩展应用...</div>
    <div v-else-if="error" class="state-card error"><strong>加载失败</strong><span>{{ error }}</span><button @click="loadExtensions">重新加载</button></div>
    <div v-else-if="extensions.length" class="extension-grid">
      <article v-for="item in extensions" :key="extensionKey(item)" class="extension-card">
        <div class="app-mark">J</div>
        <div class="app-content">
          <div class="app-title"><h2>{{ item.name || item.platformName || (extensionKey(item) === 'jingpro' ? 'Jingpro' : extensionKey(item)) }}</h2><span :class="{ enabled: item.enabled || item.tenantEnabled || item.connectionEnabled }">{{ item.enabled || item.tenantEnabled || item.connectionEnabled ? '已启用' : '未启用' }}</span></div>
          <p>{{ item.description || '连接 Jingpro 平台，为当前租户提供客服能力对接。' }}</p>
        </div>
        <button type="button" @click="openExtension(item)">进入配置</button>
      </article>
    </div>
    <div v-else class="state-card">暂无可用扩展应用</div>
  </section>
</template>

<style scoped>
.extension-page{width:min(1000px,100%);margin:0 auto;padding-bottom:24px}.extension-heading{margin-bottom:20px;padding:28px 30px;border-radius:20px;background:linear-gradient(135deg,#172554,#2563eb);color:#fff;box-shadow:0 16px 40px rgba(37,99,235,.2)}.extension-heading span{font-size:12px;font-weight:700;opacity:.75}.extension-heading h1{margin:5px 0;font-size:27px}.extension-heading p{margin:0;opacity:.82}.extension-grid{display:grid;gap:16px}.extension-card{display:flex;align-items:center;gap:18px;padding:22px;border:1px solid #e2e8f0;border-radius:16px;background:#fff;box-shadow:0 4px 16px rgba(15,23,42,.05)}.app-mark{display:grid;width:54px;height:54px;flex:0 0 54px;border-radius:14px;background:linear-gradient(135deg,#2563eb,#1e3a8a);color:#fff;font-size:22px;font-weight:800;place-items:center}.app-content{flex:1;min-width:0}.app-title{display:flex;align-items:center;gap:10px}.app-title h2{margin:0;font-size:18px}.app-title span{padding:3px 8px;border-radius:999px;background:#f1f5f9;color:#64748b;font-size:11px}.app-title span.enabled{background:#dcfce7;color:#15803d}.app-content p{margin:7px 0 0;color:#64748b;font-size:13px}.extension-card>button,.state-card button{padding:9px 16px;border:0;border-radius:9px;background:#2563eb;color:#fff;font-weight:600;cursor:pointer}.state-card{display:grid;justify-items:center;gap:9px;padding:52px 20px;border:1px solid #e2e8f0;border-radius:16px;background:#fff;color:#64748b}.state-card.error strong{color:#b91c1c}
</style>
