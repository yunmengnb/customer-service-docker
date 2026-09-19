<!-- 忆梦云团队开发 - 桌面端聊天房间独立视图 -->
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
  router.push({ path: '/desktop/messages', query })
}
</script>
<template><main class="desktop-chat-room"><header><button @click="back">返回消息中心</button><strong>会话工作台</strong></header><ChatPanel :conversation-id="conversationId" :target-message-id="targetMessageId" @back="back" /></main></template>
<style scoped>.desktop-chat-room{height:100dvh;display:flex;flex-direction:column;overflow:hidden;background:#f8fafc}.desktop-chat-room>header{height:52px;flex:none;display:flex;align-items:center;gap:16px;padding:0 20px;background:#fff;border-bottom:1px solid #e2e8f0}.desktop-chat-room>header button{border:0;background:#eff6ff;color:#2563eb;border-radius:8px;padding:8px 12px;cursor:pointer}.desktop-chat-room>header strong{color:#0f172a}</style>
