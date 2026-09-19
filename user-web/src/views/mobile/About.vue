<!-- 忆梦云团队开发 - 移动端关于软件 -->
<script setup>
import { onMounted, ref } from 'vue'
import api from '../../api'

const versionName = ref('网页版')
const isAndroidApp = ref(false)
const downloading = ref(false)
const downloadError = ref('')

onMounted(() => {
  const bridge = window.YiMengAndroid
  if (!bridge) return
  isAndroidApp.value = true
  try {
    const info = JSON.parse(bridge.getAppInfo?.() || '{}')
    if (info.versionName) versionName.value = info.versionName
  } catch (_) {}
})

function checkForUpdate() {
  window.YiMengAndroid?.checkForUpdate?.()
}

async function downloadAndroidApp() {
  downloading.value = true
  downloadError.value = ''
  try {
    const res = await api.get('/app/android/version')
    const downloadUrl = res.code === 0 ? res.data?.downloadUrl : ''
    if (!downloadUrl) throw new Error('暂无可下载的坐席客户端')
    window.location.assign(downloadUrl)
  } catch (error) {
    downloadError.value = error?.message || '客户端下载配置获取失败，请稍后重试。'
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <section class="about-page">
    <div class="about-card">
      <div class="about-logo">Y</div>
      <h1>忆梦云客服</h1>
      <p>多租户在线客服工作台</p>
      <span class="about-version">版本 {{ versionName }}</span>
      <div class="about-actions">
        <button v-if="isAndroidApp" type="button" @click="checkForUpdate">检查更新</button>
        <button v-else type="button" :disabled="downloading" @click="downloadAndroidApp">{{ downloading ? '获取中...' : '下载客服端APP' }}</button>
        <span v-if="downloadError" class="about-error">{{ downloadError }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.about-page {
  min-height: 100%; padding: 24px 14px; box-sizing: border-box; background: #f5f6f8;
}
.about-card {
  display: flex; flex-direction: column; align-items: center;
  padding: 52px 24px; border-radius: 16px; background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, .06); text-align: center;
}
.about-logo {
  width: 72px; height: 72px; border-radius: 20px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #2563eb, #0f3f91);
  color: #fff; font-size: 34px; font-weight: 700;
  box-shadow: 0 10px 24px rgba(37, 99, 235, .22);
}
h1 { margin: 22px 0 8px; color: #0f172a; font-size: 21px; }
p { margin: 0; color: #64748b; font-size: 14px; }
.about-version { margin-top: 18px; color: #94a3b8; font-size: 12px; }
.about-actions { display: grid; width: 100%; gap: 10px; margin-top: 28px; }
.about-actions button { min-height: 44px; border: 1px solid #bfdbfe; border-radius: 10px; background: #eff6ff; color: #1d4ed8; font-size: 14px; font-weight: 600; }
.about-actions button:disabled { cursor: wait; opacity: .65; }
.about-actions button:active { background: #dbeafe; }
.about-error { color: #dc2626; font-size: 12px; line-height: 1.5; }
</style>
