<!-- 忆梦云团队开发 - 免责协议与使用协议 -->
<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'

const route = useRoute()
const router = useRouter()
const loading = ref(true)
const errorMsg = ref('')
const content = ref('')

const type = computed(() => (route.params.type === 'terms' ? 'terms' : 'disclaimer'))
const title = computed(() => (type.value === 'terms' ? '使用协议' : '免责协议'))

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await api.get('/tenant/public-settings')
    if (res.code !== 0) throw new Error(res.message || '协议加载失败')
    content.value = res.data?.agreements?.[type.value] || ''
  } catch (error) {
    errorMsg.value = error?.message || '协议加载失败'
  } finally {
    loading.value = false
  }
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.replace('/register')
}

onMounted(load)
</script>

<template>
  <div class="agreement-page">
    <header class="agreement-header">
      <button class="agreement-back" type="button" @click="goBack">← 返回</button>
      <h1>{{ title }}</h1>
    </header>

    <main class="agreement-body">
      <div v-if="loading" class="agreement-state">正在加载协议...</div>
      <div v-else-if="errorMsg" class="agreement-state agreement-error">{{ errorMsg }}</div>
      <div v-else-if="content" class="agreement-content">{{ content }}</div>
      <div v-else class="agreement-state">协议内容暂未配置</div>
    </main>
  </div>
</template>

<style scoped>
.agreement-page { height: 100vh; height: 100dvh; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: #f5f6f8; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; }
.agreement-header { position: relative; z-index: 10; display: flex; flex: none; align-items: center; gap: 12px; height: 52px; padding: 0 16px; background: #fff; border-bottom: 1px solid #eceff1; }
.agreement-back { border: none; background: transparent; color: #2563eb; font-size: 14px; font-weight: 600; cursor: pointer; }
.agreement-header h1 { flex: 1; margin: 0; font-size: 17px; font-weight: 600; color: #0f172a; text-align: center; }
.agreement-body { flex: 1; min-height: 0; padding: 16px; overflow-x: hidden; overflow-y: auto; overscroll-behavior-y: contain; -webkit-overflow-scrolling: touch; }
.agreement-content { padding: 18px; border-radius: 14px; background: #fff; box-shadow: 0 2px 8px rgba(15,23,42,.04); color: #334155; font-size: 14px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }
.agreement-state { padding: 60px 20px; text-align: center; color: #64748b; }
.agreement-error { color: #b91c1c; }

@media (min-width: 769px) {
  .agreement-body { max-width: 860px; width: 100%; margin: 0 auto; padding: 24px; }
}
</style>
