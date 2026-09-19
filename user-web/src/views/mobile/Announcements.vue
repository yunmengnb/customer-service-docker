<!-- 忆梦云团队开发 - 移动端系统公告列表 -->
<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../../api'

const router = useRouter()
const announcements = ref([])
const loading = ref(false)
const loadingMore = ref(false)
const errorMessage = ref('')
const page = ref(1)
const limit = 10
const total = ref(0)

function normalizeList(data) {
  if (Array.isArray(data)) return { items: data, total: data.length }
  return {
    items: data?.items || data?.list || data?.announcements || [],
    total: Number(data?.total || data?.pagination?.total || 0),
  }
}

function announcementId(item) {
  return item?._id || item?.id
}

function announcementTime(item) {
  const value = item?.publishedAt || item?.publishAt || item?.createdAt
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '时间待定'
}

function announcementSummary(item) {
  return item?.summary || item?.excerpt || item?.content || '点击查看公告详情'
}

async function load(targetPage = 1, append = false) {
  append ? (loadingMore.value = true) : (loading.value = true)
  errorMessage.value = ''
  try {
    const res = await api.get('/tenant/announcements', { params: { page: targetPage, limit } })
    if (res.code !== 0) throw new Error(res.message || '公告加载失败')
    const normalized = normalizeList(res.data)
    announcements.value = append ? [...announcements.value, ...normalized.items] : normalized.items
    total.value = normalized.total
    page.value = targetPage
  } catch (error) {
    errorMessage.value = error?.message || '公告加载失败，请稍后重试'
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

onMounted(() => load())
</script>

<template>
  <section class="mobile-announcements">
    <div class="mobile-announcement-intro">
      <span>系统通知</span>
      <strong>及时掌握平台动态</strong>
      <small>更新、维护计划和重要通知将在这里发布</small>
    </div>

    <div v-if="loading" class="mobile-state">正在加载公告...</div>
    <div v-else-if="errorMessage && !announcements.length" class="mobile-state mobile-error">
      <span>{{ errorMessage }}</span>
      <button type="button" @click="load()">重新加载</button>
    </div>
    <div v-else-if="!announcements.length" class="mobile-state">暂无系统公告</div>
    <div v-else class="mobile-announcement-list">
      <button
        v-for="item in announcements"
        :key="announcementId(item)"
        type="button"
        class="mobile-announcement-card"
        @click="router.push(`/m/announcements/${announcementId(item)}`)"
      >
        <span class="mobile-announcement-icon">公</span>
        <span class="mobile-announcement-main">
          <strong>{{ item.title || '未命名公告' }}</strong>
          <span>{{ announcementSummary(item) }}</span>
          <time>{{ announcementTime(item) }}</time>
        </span>
        <span class="mobile-announcement-arrow" aria-hidden="true">›</span>
      </button>
    </div>

    <button
      v-if="announcements.length < total"
      type="button"
      class="mobile-load-more"
      :disabled="loadingMore"
      @click="load(page + 1, true)"
    >
      {{ loadingMore ? '正在加载...' : '加载更多' }}
    </button>
    <p v-if="errorMessage && announcements.length" class="mobile-inline-error">{{ errorMessage }}</p>
  </section>
</template>

<style scoped>
.mobile-announcements { min-height: 100%; padding: 14px 14px 24px; background: #f8fafc; }
.mobile-announcement-intro { display: flex; flex-direction: column; gap: 7px; padding: 22px; border-radius: 18px; background: linear-gradient(135deg, #0f3f91, #2563eb); color: #fff; box-shadow: 0 12px 32px rgba(37,99,235,.2); }
.mobile-announcement-intro span { font-size: 11px; font-weight: 700; letter-spacing: 1.5px; opacity: .72; }
.mobile-announcement-intro strong { font-size: 21px; line-height: 1.35; }
.mobile-announcement-intro small { color: rgba(255,255,255,.76); font-size: 12px; line-height: 1.6; }
.mobile-announcement-list { display: grid; gap: 10px; margin-top: 14px; }
.mobile-announcement-card { width: 100%; display: flex; align-items: center; gap: 12px; min-height: 112px; padding: 16px 14px; border: 1px solid #e2e8f0; border-radius: 15px; background: #fff; color: #0f172a; text-align: left; box-shadow: 0 4px 16px rgba(15,23,42,.04); }
.mobile-announcement-card:focus-visible { border-color: #2563eb; outline: 3px solid rgba(37,99,235,.14); }
.mobile-announcement-icon { width: 42px; height: 42px; flex: 0 0 42px; display: grid; place-items: center; border-radius: 12px; background: rgba(37,99,235,.1); color: #2563eb; font-weight: 800; }
.mobile-announcement-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 6px; }
.mobile-announcement-main strong { overflow: hidden; font-size: 15px; line-height: 1.45; text-overflow: ellipsis; white-space: nowrap; }
.mobile-announcement-main > span { display: -webkit-box; overflow: hidden; color: #64748b; font-size: 12px; line-height: 1.55; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.mobile-announcement-main time { color: #94a3b8; font-size: 11px; }
.mobile-announcement-arrow { color: #94a3b8; font-size: 25px; }
.mobile-state { margin-top: 14px; padding: 48px 20px; border: 1px solid #e2e8f0; border-radius: 15px; background: #fff; color: #64748b; text-align: center; }
.mobile-error { display: flex; flex-direction: column; align-items: center; gap: 12px; color: #dc2626; }
.mobile-error button, .mobile-load-more { min-height: 42px; padding: 0 18px; border: 1px solid #bfdbfe; border-radius: 10px; background: #eff6ff; color: #1d4ed8; font-weight: 600; }
.mobile-load-more { display: block; width: 100%; margin-top: 14px; }
.mobile-load-more:disabled { opacity: .55; }
.mobile-inline-error { margin: 10px 0 0; color: #dc2626; font-size: 12px; text-align: center; }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
</style>
