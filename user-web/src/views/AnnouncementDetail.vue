<!-- 忆梦云团队开发 - 系统公告详情 -->
<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import api from '../api'

const route = useRoute()
const announcement = ref(null)
const loading = ref(false)
const errorMessage = ref('')
const listPath = computed(() => route.path.startsWith('/m/') ? '/m/announcements' : '/desktop/announcements')

function announcementTime(item) {
  const value = item?.publishedAt || item?.publishAt || item?.createdAt
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '时间待定'
}

async function load() {
  loading.value = true
  errorMessage.value = ''
  announcement.value = null
  try {
    const res = await api.get(`/tenant/announcements/${route.params.id}`)
    if (res.code !== 0) throw new Error(res.message || '公告加载失败')
    announcement.value = res.data
  } catch (error) {
    errorMessage.value = error?.message || '公告加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => route.params.id, load)
</script>

<template>
  <section class="announcement-detail-page">
    <router-link class="announcement-back" :to="listPath">← 返回公告列表</router-link>

    <div v-if="loading" class="detail-state">正在加载公告...</div>
    <div v-else-if="errorMessage" class="detail-state detail-error">
      <span>{{ errorMessage }}</span>
      <button type="button" @click="load">重新加载</button>
    </div>
    <article v-else-if="announcement" class="announcement-article">
      <header>
        <span class="announcement-tag">系统公告</span>
        <h1>{{ announcement.title || '未命名公告' }}</h1>
        <time>{{ announcementTime(announcement) }}</time>
      </header>
      <div class="announcement-divider"></div>
      <div class="announcement-content">{{ announcement.content }}</div>
    </article>
  </section>
</template>

<style scoped>
.announcement-detail-page { width: 100%; max-width: 920px; margin: 0 auto; }
.announcement-back { display: inline-flex; align-items: center; min-height: 40px; margin-bottom: 14px; color: #2563eb; font-size: 13px; font-weight: 600; text-decoration: none; }
.announcement-back:focus-visible { border-radius: 8px; outline: 3px solid rgba(37,99,235,.16); outline-offset: 2px; }
.announcement-article { padding: 38px 42px; border: 1px solid #e2e8f0; border-radius: 20px; background: #fff; box-shadow: 0 12px 34px rgba(15,23,42,.06); }
.announcement-article header { text-align: center; }
.announcement-tag { display: inline-flex; padding: 5px 10px; border-radius: 999px; background: rgba(37,99,235,.1); color: #2563eb; font-size: 12px; font-weight: 700; }
h1 { margin: 16px auto 12px; color: #0f172a; font-size: clamp(24px, 3vw, 34px); line-height: 1.35; overflow-wrap: anywhere; }
time { color: #94a3b8; font-size: 13px; }
.announcement-divider { height: 1px; margin: 30px 0; background: #e2e8f0; }
.announcement-content { color: #334155; font-size: 15px; line-height: 1.9; overflow-wrap: anywhere; white-space: pre-wrap; }
.detail-state { padding: 72px 24px; border: 1px solid #e2e8f0; border-radius: 18px; background: #fff; color: #64748b; text-align: center; }
.detail-error { display: flex; align-items: center; justify-content: center; gap: 14px; color: #dc2626; }
.detail-error button { min-height: 38px; padding: 0 14px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; color: #334155; cursor: pointer; }
@media (max-width: 768px) {
  .announcement-detail-page { min-height: 100%; padding: 14px; background: #f8fafc; }
  .announcement-back { margin-bottom: 8px; }
  .announcement-article { padding: 26px 20px; border-radius: 16px; }
  h1 { margin-top: 13px; font-size: 23px; }
  .announcement-divider { margin: 24px 0; }
  .announcement-content { font-size: 15px; line-height: 1.85; }
  .detail-state { padding: 52px 18px; }
  .detail-error { flex-direction: column; }
}
</style>
