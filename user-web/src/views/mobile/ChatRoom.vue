<!-- 忆梦云团队开发 - 手机端聊天房间独立视图 -->
<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChatPanel from './ChatPanel.vue'
const route = useRoute()
const router = useRouter()
const conversationId = computed(() => route.params.id)
const targetMessageId = computed(() => String(route.query.message || '') || null)
function back() {
  const query = { ...route.query }
  delete query.message
  router.push({ path: '/m/messages', query })
}
</script>
<template><main class="mobile-chat-room"><ChatPanel :conversation-id="conversationId" :target-message-id="targetMessageId" @back="back" /></main></template>
<style scoped>.mobile-chat-room{position:fixed;inset:0;overflow:hidden;background:#f8fafc}</style>
