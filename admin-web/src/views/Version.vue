<!-- 忆梦云团队开发 - 系统版本信息 -->
<script setup>
import { onMounted, ref } from 'vue'
import api from '../api'

const loading = ref(true)
const errorMessage = ref('')
const versionInfo = ref({ version: '', edition: '', releasedAt: '', changelog: [] })

async function loadVersion() {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await api.get('/admin/version')
    if (res.code !== 0) throw new Error(res.message || '版本信息加载失败')
    versionInfo.value = res.data || versionInfo.value
  } catch (error) {
    errorMessage.value = error?.message || '版本信息加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(loadVersion)
</script>

<template>
  <div class="page-header"><h1>版本信息</h1><p class="desc">查看当前系统版本和历史更新内容</p></div>
  <div v-if="loading" class="version-state">正在加载...</div>
  <div v-else-if="errorMessage" class="version-state error"><p>{{ errorMessage }}</p><button type="button" class="btn btn-primary btn-sm" @click="loadVersion">重新加载</button></div>
  <div v-else class="version-content">
    <section class="card version-summary">
      <div><span class="summary-label">当前版本</span><strong>v{{ versionInfo.version }}</strong><p>{{ versionInfo.edition }} 版本</p></div>
      <span class="tag tag-green">当前运行版本</span>
      <dl><div><dt>版本号</dt><dd>v{{ versionInfo.version }}</dd></div><div><dt>版本类型</dt><dd>{{ versionInfo.edition }}</dd></div><div><dt>发布日期</dt><dd>{{ versionInfo.releasedAt }}</dd></div></dl>
    </section>
    <section class="card changelog-card">
      <div class="section-heading"><h2>版本更新日志</h2><span>共 {{ versionInfo.changelog?.length || 0 }} 个版本</span></div>
      <div v-if="!versionInfo.changelog?.length" class="empty-state">暂无更新日志</div>
      <article v-for="item in versionInfo.changelog" :key="`${item.version}-${item.releasedAt}`" class="release-item">
        <div class="release-marker"></div><div class="release-body"><div class="release-heading"><div><strong>v{{ item.version }}</strong><h3>{{ item.title }}</h3></div><time>{{ item.releasedAt }}</time></div><ul><li v-for="change in item.changes" :key="change">{{ change }}</li></ul></div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.version-content { display:grid; gap:20px; }.version-summary { position:relative; padding:28px; overflow:hidden; }.version-summary::after { position:absolute; top:-55px; right:-40px; width:190px; height:190px; border-radius:50%; background:linear-gradient(135deg,rgba(37,99,235,.14),rgba(99,102,241,.04)); content:''; }.version-summary > div:first-child { position:relative; z-index:1; }.summary-label { display:block; margin-bottom:10px; color:var(--text-muted); font-size:13px; }.version-summary strong { color:var(--primary); font-size:36px; letter-spacing:-1px; }.version-summary p { margin:7px 0 0; color:var(--text-sec); }.version-summary > .tag { position:absolute; top:28px; right:28px; z-index:1; }.version-summary dl { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin:28px 0 0; }.version-summary dl div { padding:14px 16px; border:1px solid var(--border); border-radius:12px; background:var(--bg-soft); }.version-summary dt { color:var(--text-muted); font-size:12px; }.version-summary dd { margin:6px 0 0; color:var(--text-main); font-weight:700; }.changelog-card { padding:24px 28px; }.section-heading { display:flex; align-items:center; justify-content:space-between; padding-bottom:20px; border-bottom:1px solid var(--border); }.section-heading h2 { font-size:18px; }.section-heading span { color:var(--text-muted); font-size:13px; }.release-item { position:relative; display:grid; grid-template-columns:18px minmax(0,1fr); gap:16px; padding:24px 0 4px; }.release-item:not(:last-child)::before { position:absolute; top:35px; bottom:-25px; left:6px; width:2px; background:var(--border); content:''; }.release-marker { z-index:1; width:14px; height:14px; margin-top:5px; border:3px solid #dbeafe; border-radius:50%; background:var(--primary); }.release-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }.release-heading > div { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }.release-heading strong { padding:4px 9px; border-radius:7px; background:#eff6ff; color:var(--primary); font-size:13px; }.release-heading h3 { font-size:16px; }.release-heading time { flex:0 0 auto; color:var(--text-muted); font-size:13px; }.release-body ul { display:grid; gap:9px; margin:16px 0 20px; padding-left:18px; color:var(--text-sec); font-size:14px; line-height:1.7; }.version-state { padding:56px 20px; border:1px solid var(--border); border-radius:var(--radius-lg); background:#fff; color:var(--text-muted); text-align:center; }.version-state.error { color:#991b1b; }.version-state.error p { margin-bottom:16px; }.empty-state { padding:40px; color:var(--text-muted); text-align:center; }
@media (max-width:768px) { .version-summary,.changelog-card { padding:20px; }.version-summary > .tag { position:static; display:inline-flex; margin-top:16px; }.version-summary dl { grid-template-columns:1fr; margin-top:20px; }.release-heading { flex-direction:column; gap:8px; }.release-heading time { order:-1; }.release-item { gap:10px; } }
@media (max-width:390px) { .version-summary strong { font-size:30px; }.section-heading { align-items:flex-start; flex-direction:column; gap:6px; } }
</style>
