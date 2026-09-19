<!-- 忆梦云团队开发 - 桌面与移动端统一确认弹窗 -->
<script setup>
import { onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '请确认' },
  message: { type: String, required: true },
  confirmText: { type: String, default: '确认' },
  cancelText: { type: String, default: '取消' },
  danger: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['confirm', 'cancel'])

function cancel() {
  if (!props.loading) emit('cancel')
}

function onKeydown(event) {
  if (props.open && event.key === 'Escape') cancel()
}

watch(() => props.open, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm-dialog">
      <div v-if="open" class="confirm-dialog-mask" @click.self="cancel">
        <section
          class="confirm-dialog"
          role="alertdialog"
          aria-modal="true"
          :aria-labelledby="'confirm-dialog-title'"
          :aria-describedby="'confirm-dialog-message'"
        >
          <div class="confirm-dialog-icon" :class="{ danger }">!</div>
          <div class="confirm-dialog-content">
            <h2 id="confirm-dialog-title">{{ title }}</h2>
            <p id="confirm-dialog-message">{{ message }}</p>
          </div>
          <div class="confirm-dialog-actions">
            <button type="button" class="confirm-dialog-cancel" :disabled="loading" @click="cancel">
              {{ cancelText }}
            </button>
            <button
              type="button"
              class="confirm-dialog-confirm"
              :class="{ danger }"
              :disabled="loading"
              autofocus
              @click="emit('confirm')"
            >
              {{ loading ? '处理中...' : confirmText }}
            </button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(15, 23, 42, .48);
  backdrop-filter: blur(4px);
}
.confirm-dialog {
  width: min(400px, 100%);
  padding: 24px;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 24px 64px rgba(15, 23, 42, .2);
  font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
.confirm-dialog-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  margin-bottom: 16px;
  border-radius: 12px;
  background: #dbeafe;
  color: #2563eb;
  font-size: 22px;
  font-weight: 800;
}
.confirm-dialog-icon.danger { background: #fee2e2; color: #dc2626; }
.confirm-dialog-content h2 { margin: 0; color: #0f172a; font-size: 18px; font-weight: 700; }
.confirm-dialog-content p { margin: 8px 0 0; color: #64748b; font-size: 14px; line-height: 1.6; }
.confirm-dialog-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; }
.confirm-dialog-actions button {
  min-width: 88px;
  min-height: 40px;
  padding: 9px 18px;
  border-radius: 10px;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: transform .15s ease, background .15s ease, border-color .15s ease;
}
.confirm-dialog-actions button:hover:not(:disabled) { transform: translateY(-1px); }
.confirm-dialog-actions button:focus-visible { outline: 3px solid rgba(37, 99, 235, .25); outline-offset: 2px; }
.confirm-dialog-actions button:disabled { cursor: wait; opacity: .65; }
.confirm-dialog-cancel { border: 1px solid #e2e8f0; background: #fff; color: #475569; }
.confirm-dialog-cancel:hover:not(:disabled) { background: #f8fafc; border-color: #cbd5e1; }
.confirm-dialog-confirm { border: 1px solid #2563eb; background: #2563eb; color: #fff; }
.confirm-dialog-confirm:hover:not(:disabled) { background: #1d4ed8; }
.confirm-dialog-confirm.danger { border-color: #dc2626; background: #dc2626; }
.confirm-dialog-confirm.danger:hover:not(:disabled) { background: #b91c1c; }
.confirm-dialog-enter-active, .confirm-dialog-leave-active { transition: opacity .18s ease; }
.confirm-dialog-enter-active .confirm-dialog, .confirm-dialog-leave-active .confirm-dialog { transition: transform .18s ease; }
.confirm-dialog-enter-from, .confirm-dialog-leave-to { opacity: 0; }
.confirm-dialog-enter-from .confirm-dialog, .confirm-dialog-leave-to .confirm-dialog { transform: translateY(8px) scale(.98); }
@media (max-width: 576px) {
  .confirm-dialog-mask { align-items: flex-end; padding: 12px; }
  .confirm-dialog { padding: 20px; border-radius: 16px; }
  .confirm-dialog-actions { display: grid; grid-template-columns: 1fr 1fr; }
  .confirm-dialog-actions button { width: 100%; min-height: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  .confirm-dialog-mask, .confirm-dialog, .confirm-dialog-actions button { transition: none !important; }
}
</style>
