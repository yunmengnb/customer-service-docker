<!-- 忆梦云团队开发 - 桌面端系统公告列表 -->
<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../../api'

const router = useRouter()
const announcements = ref([])
const loading = ref(false)
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

async function load(targetPage = page.value) {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await api.get('/tenant/announcements', { params: { page: targetPage, limit } })
    if (res.code !== 0) throw new Error(res.message || '公告加载失败')
    const normalized = normalizeList(res.data)
    announcements.value = normalized.items
    total.value = normalized.total
    page.value = targetPage
  } catch (error) {
    errorMessage.value = error?.message || '公告加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function openDetail(item) {
  const id = announcementId(item)
  if (id) router.push(`/desktop/announcements/${id}`)
}

onMounted(() => load(1))
</script>

<template>
  <section class="announcement-page">
    <div class="announcement-hero">
      <div>
        <span class="announcement-eyebrow">SYSTEM NOTICE</span>
        <h1>系统公告</h1>
        <p>及时了解平台更新、维护计划和重要通知。</p>
      </div>
      <div class="announcement-count">共 {{ total }} 条</div>
    </div>

    <div v-if="loading" class="state-card">正在加载公告...</div>
    <div v-else-if="errorMessage" class="state-card state-error">
      <span>{{ errorMessage }}</span>
      <button type="button" @click="load()">重新加载</button>
    </div>
    <div v-else-if="!announcements.length" class="state-card">暂无系统公告</div>
    <div v-else class="announcement-list">
      <button
        v-for="item in announcements"
        :key="announcementId(item)"
        type="button"
        class="announcement-card"
        @click="openDetail(item)"
      >
        <span class="announcement-icon">公</span>
        <span class="announcement-main">
          <span class="announcement-meta">
            <span class="announcement-tag">系统公告</span>
            <time>{{ announcementTime(item) }}</time>
          </span>
          <strong>{{ item.title || '未命名公告' }}</strong>
          <span class="announcement-summary">{{ announcementSummary(item) }}</span>
        </span>
        <span class="announcement-arrow" aria-hidden="true">›</span>
      </button>
    </div>

    <nav v-if="total > limit" class="pagination" aria-label="公告分页">
      <button type="button" :disabled="page <= 1 || loading" @click="load(page - 1)">上一页</button>
      <span>第 {{ page }} / {{ Math.ceil(total / limit) }} 页</span>
      <button type="button" :disabled="page >= Math.ceil(total / limit) || loading" @click="load(page + 1)">下一页</button>
    </nav>
  </section>
</template>

<style scoped>
.announcement-page { max-width: 1120px; margin: 0 auto; }
.announcement-hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding: 32px; border-radius: 20px; background: linear-gradient(135deg, #0f3f91, #2563eb); color: #fff; box-shadow: 0 16px 40px rgba(37,99,235,.2); }
.announcement-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 1.8px; opacity: .72; }
h1 { margin: 8px 0; font-size: 30px; line-height: 1.2; }
p { margin: 0; color: rgba(255,255,255,.78); font-size: 14px; }
.announcement-count { padding: 9px 14px; border: 1px solid rgba(255,255,255,.22); border-radius: 999px; background: rgba(255,255,255,.12); backdrop-filter: blur(12px); font-size: 13px; white-space: nowrap; }
.announcement-list { display: grid; gap: 14px; margin-top: 20px; }
.announcement-card { width: 100%; display: flex; align-items: center; gap: 18px; padding: 20px; text-align: left; border: 1px solid #e2e8f0; border-radius: 16px; background: #fff; color: #0f172a; cursor: pointer; transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease; }
.announcement-card:hover, .announcement-card:focus-visible { transform: translateY(-2px); border-color: #2563eb; box-shadow: 0 10px 40px rgba(37,99,235,.12); outline: none; }
.announcement-icon { width: 48px; height: 48px; flex: 0 0 48px; display: grid; place-items: center; border-radius: 14px; background: rgba(37,99,235,.1); color: #2563eb; font-weight: 800; }
.announcement-main { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 7px; }
.announcement-meta { display: flex; align-items: center; gap: 10px; color: #94a3b8; font-size: 12px; }
.announcement-tag { padding: 3px 8px; border-radius: 999px; background: rgba(37,99,235,.1); color: #2563eb; font-weight: 600; }
.announcement-main strong { font-size: 17px; line-height: 1.45; }
.announcement-summary { overflow: hidden; color: #64748b; font-size: 13px; line-height: 1.65; text-overflow: ellipsis; white-space: nowrap; }
.announcement-arrow { color: #94a3b8; font-size: 28px; }
.state-card { margin-top: 20px; padding: 56px 24px; border: 1px solid #e2e8f0; border-radius: 16px; background: #fff; color: #64748b; text-align: center; }
.state-error { display: flex; align-items: center; justify-content: center; gap: 14px; color: #dc2626; }
.state-error button, .pagination button { padding: 8px 14px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; color: #334155; cursor: pointer; }
.pagination { display: flex; align-items: center; justify-content: center; gap: 16px; margin: 22px 0 4px; color: #64748b; font-size: 13px; }
.pagination button:disabled { cursor: not-allowed; opacity: .45; }
@media (prefers-reduced-motion: reduce) { .announcement-card { transition: none; } }
</style>
