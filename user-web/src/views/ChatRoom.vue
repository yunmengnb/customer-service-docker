<!-- 忆梦云团队开发 - 聊天独立页壳子（移动端从消息列表跳转进入，桌面端也可直接访问） -->
<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChatPanel from '../components/ChatPanel.vue'

const route = useRoute()
const router = useRouter()
const convId = computed(() => route.params.id)
const showBack = computed(() => !!convId.value)

function back() {
  router.push(route.path.startsWith('/m/') ? '/m/messages' : '/desktop/messages')
}
</script>

<template>
  <div class="cr-wrap">
    <div class="cr-mobile-bar" v-if="showBack">
      <button class="cr-back" @click="back">← 返回</button>
      <span class="cr-title">聊天</span>
      <span class="cr-spacer"></span>
    </div>
    <ChatPanel :conversationId="convId" @back="back" />
  </div>
</template>

<style scoped>
.cr-wrap { width: 100%; height: 100%; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.cr-mobile-bar {
  display: none;
}
@media (max-width: 768px) {
  .cr-mobile-bar {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; background: #fff; border-bottom: 1px solid #e2e8f0;
    flex-shrink: 0;
  }
  .cr-back {
    border: none; background: transparent; color: #2563eb;
    font-size: 14px; font-weight: 600; cursor: pointer; padding: 4px 8px;
  }
  .cr-title { font-weight: 600; font-size: 14px; color: #0f172a; }
  .cr-spacer { flex: 1; }
}
</style>
