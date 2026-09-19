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

onMounted(loadExtensions)
</script>

<template>
  <section class="extension-page">
    <div v-if="loading" class="state-card">正在加载扩展应用...</div>
    <div v-else-if="error" class="state-card error"><strong>加载失败</strong><span>{{ error }}</span><button @click="loadExtensions">重新加载</button></div>
    <div v-else-if="extensions.length" class="extension-list">
      <button v-for="item in extensions" :key="extensionKey(item)" class="extension-card" type="button" @click="extensionKey(item) === 'jingpro' && router.push('/m/extensions/jingpro')">
        <span class="app-mark">J</span>
        <span class="app-content"><span class="app-title">{{ item.name || item.platformName || (extensionKey(item) === 'jingpro' ? 'Jingpro' : extensionKey(item)) }}</span><span class="app-description">{{ item.description || '第三方平台客服能力对接' }}</span></span>
        <span class="app-status" :class="{ enabled: item.enabled || item.tenantEnabled || item.connectionEnabled }">{{ item.enabled || item.tenantEnabled || item.connectionEnabled ? '已启用' : '未启用' }}</span>
        <span class="arrow">›</span>
      </button>
    </div>
    <div v-else class="state-card">暂无可用扩展应用</div>
  </section>
</template>

<style scoped>
.extension-page{min-height:100%;padding:16px 14px 30px;background:#f5f6f8}.extension-list{display:grid;gap:12px}.extension-card{display:flex;width:100%;align-items:center;gap:12px;padding:16px;border:1px solid #e6ebf2;border-radius:15px;background:#fff;color:#0f172a;text-align:left;box-shadow:0 6px 20px rgba(15,23,42,.04)}.app-mark{display:grid;width:46px;height:46px;flex:0 0 46px;border-radius:13px;background:linear-gradient(135deg,#2563eb,#1e3a8a);color:#fff;font-size:19px;font-weight:800;place-items:center}.app-content{display:grid;min-width:0;flex:1;gap:5px}.app-title{font-size:16px;font-weight:600}.app-description{overflow:hidden;color:#8490a5;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.app-status{padding:4px 7px;border-radius:999px;background:#f1f5f9;color:#64748b;font-size:10px}.app-status.enabled{background:#dcfce7;color:#15803d}.arrow{color:#94a3b8;font-size:22px}.state-card{display:grid;justify-items:center;gap:8px;padding:46px 18px;border:1px solid #e6ebf2;border-radius:15px;background:#fff;color:#8490a5;text-align:center}.state-card.error strong{color:#b91c1c}.state-card button{margin-top:5px;padding:8px 15px;border:0;border-radius:8px;background:#2563eb;color:#fff}
</style>
