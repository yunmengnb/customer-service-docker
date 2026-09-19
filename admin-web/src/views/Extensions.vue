<!-- 忆梦云团队开发 - 扩展应用 -->
<script setup>
import { onMounted, ref } from 'vue'
import api from '../api'

const loading = ref(true)
const error = ref('')
const setting = ref({ enabled: false, hasSecret: false })

async function loadSetting() {
  loading.value = true
  error.value = ''
  try {
    const res = await api.get('/integration/admin/setting')
    if (res.code !== 200) throw new Error(res.msg || res.message || '扩展配置加载失败')
    setting.value = {
      enabled: res.data?.enabled === true,
      hasSecret: res.data?.hasSecret === true,
    }
  } catch (err) {
    error.value = err?.msg || err?.message || '扩展配置加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(loadSetting)
</script>

<template>
  <div class="page-header">
    <h1>扩展应用</h1>
    <p class="desc">管理平台扩展及其联动配置</p>
  </div>

  <div v-if="error" class="extension-notice error" role="alert">{{ error }}</div>

  <div class="extension-grid">
    <article class="card extension-card">
      <div class="extension-card-header">
        <div class="extension-logo">J</div>
        <span v-if="loading" class="tag tag-gray">读取中</span>
        <span v-else class="tag" :class="setting.enabled ? 'tag-green' : 'tag-gray'">
          {{ setting.enabled ? '已启用' : '未启用' }}
        </span>
      </div>
      <div class="extension-card-body">
        <h2>Jingpro 联动扩展</h2>
        <p>提供商户账号绑定、永久渠道、快捷登录与客服回复同步能力。</p>
        <div class="secret-state">接口凭据：{{ setting.hasSecret ? '已就绪' : '未配置' }}</div>
      </div>
      <div class="extension-card-footer">
        <RouterLink class="btn btn-primary" to="/extensions/jingpro">配置扩展</RouterLink>
      </div>
    </article>
  </div>
</template>

<style scoped>
.extension-notice { margin-bottom: 16px; padding: 11px 14px; border: 1px solid; border-radius: var(--radius-md); font-size: 13px; }
.extension-notice.error { border-color: rgba(239, 68, 68, .3); background: var(--danger-soft); color: #b91c1c; }
.extension-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 380px)); gap: 20px; }
.extension-card { display: flex; min-height: 270px; flex-direction: column; padding: 22px; }
.extension-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.extension-logo { display: flex; width: 46px; height: 46px; align-items: center; justify-content: center; border-radius: 12px; background: var(--primary); color: #fff; font-size: 23px; font-weight: 700; }
.extension-card-body { flex: 1; padding: 20px 0; }
.extension-card-body h2 { font-size: 18px; }
.extension-card-body p { margin: 8px 0 16px; color: var(--text-sec); font-size: 13px; }
.secret-state { color: var(--text-muted); font-size: 12px; }
.extension-card-footer { display: flex; justify-content: flex-end; padding-top: 16px; border-top: 1px solid var(--border); }
@media (max-width: 576px) { .extension-grid { grid-template-columns: 1fr; } .extension-card-footer .btn { width: 100%; } }
</style>
