<!-- 忆梦云团队开发 - 路由根组件，负责跨路由客户消息铃声 -->
<script setup>
import { onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
let socket = null
let socketModule = null
let socketSetupId = 0
let isUnmounted = false
let notificationAudioContext = null

function getNotificationAudioContext() {
  if (!notificationAudioContext) {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (AudioContext) notificationAudioContext = new AudioContext()
  }
  return notificationAudioContext
}

async function unlockNotificationSound() {
  const context = getNotificationAudioContext()
  if (context?.state === 'suspended') await context.resume().catch(() => {})
}

function playNotificationSound() {
  const context = getNotificationAudioContext()
  if (!context || context.state !== 'running') return
  const start = context.currentTime
  ;[
    { delay: 0, frequency: 1320 },
    { delay: 0.14, frequency: 1760 },
    { delay: 0.3, frequency: 1480 },
  ].forEach(({ delay, frequency }) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'square'
    oscillator.frequency.setValueAtTime(frequency, start + delay)
    gain.gain.setValueAtTime(0.0001, start + delay)
    gain.gain.exponentialRampToValueAtTime(0.7, start + delay + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.13)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(start + delay)
    oscillator.stop(start + delay + 0.14)
  })
}

function handleNotificationMessage(message) {
  if (message.senderType === 'customer') playNotificationSound()
}

async function setupNotificationSocket() {
  const setupId = ++socketSetupId
  const token = sessionStorage.getItem('tenant_token') || localStorage.getItem('tenant_token')
  if (!token) {
    socket?.off('message.new', handleNotificationMessage)
    socket = null
    socketModule?.disconnectTenantSocket()
    return
  }

  const loadedSocketModule = socketModule || await import('./socket')
  if (isUnmounted || setupId !== socketSetupId) return
  socketModule = loadedSocketModule
  const nextSocket = loadedSocketModule.getTenantSocket()
  if (socket === nextSocket) return
  socket?.off('message.new', handleNotificationMessage)
  socket = nextSocket
  socket?.on('message.new', handleNotificationMessage)
}

watch(() => route.fullPath, setupNotificationSocket)

onMounted(() => {
  window.addEventListener('pointerdown', unlockNotificationSound, { passive: true })
  window.addEventListener('keydown', unlockNotificationSound)
  setupNotificationSocket()
})

onUnmounted(() => {
  isUnmounted = true
  socketSetupId++
  socket?.off('message.new', handleNotificationMessage)
  socketModule?.disconnectTenantSocket()
  notificationAudioContext?.close().catch(() => {})
  window.removeEventListener('pointerdown', unlockNotificationSound)
  window.removeEventListener('keydown', unlockNotificationSound)
})
</script>

<template>
  <router-view />
</template>
