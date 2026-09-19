// 忆梦云团队开发 - 桌面与手机共享消息阅读位置生命周期
import { ref, watch, nextTick, onUnmounted } from 'vue'

export function useChatPosition(container, messages) {
  const following = ref(true)
  const mode = ref('latest')
  const pending = ref(0)
  let anchor = null
  let observer, mutation, frame = 0, epoch = 0, intentUntil = 0, touchY = 0
  function capture() {
    const el = container.value
    if (!el) return
    const top = el.getBoundingClientRect().top
    const row = [...el.querySelectorAll('[data-message-id]')].find(r => r.getBoundingClientRect().bottom > top + 1)
    if (row) {
      anchor = {
        id: row.dataset.messageId,
        offset: row.getBoundingClientRect().top - top,
        height: el.scrollHeight,
      }
    }
  }
  function restore() {
    const el = container.value
    if (!el) return
    if (following.value && mode.value === 'latest') {
      el.scrollTop = el.scrollHeight
    } else if (anchor) {
      const row = [...el.querySelectorAll('[data-message-id]')].find(r => r.dataset.messageId === anchor.id)
      if (row) {
        el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.offset
      } else if (Number.isFinite(anchor.height)) {
        el.scrollTop += el.scrollHeight - anchor.height
      }
      anchor.height = el.scrollHeight
    }
  }
  function schedule() {
    cancelAnimationFrame(frame)
    const current = epoch
    frame = requestAnimationFrame(() => { if (current === epoch) restore() })
  }
  function observe() {
    observer?.disconnect()
    const el = container.value
    if (!el) return
    observer = new ResizeObserver(schedule)
    observer.observe(el)
    el.querySelectorAll('[data-message-id]').forEach(row => observer.observe(row))
  }
  function reset(target = false) {
    epoch++
    cancelAnimationFrame(frame)
    observer?.disconnect(); mutation?.disconnect()
    following.value = !target; mode.value = target ? 'search' : 'latest'
    pending.value = 0; anchor = null; intentUntil = 0
    observe()
    if (container.value) {
      mutation = new MutationObserver(() => { observe(); schedule() })
      mutation.observe(container.value, { childList: true, subtree: true })
    }
  }
  function input(event) {
    if (event.type === 'touchstart') { touchY = event.touches[0]?.clientY || 0; return }
    if (event.type === 'keydown' && !['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)) return
    if (event.type === 'pointerdown' && event.clientX < container.value.getBoundingClientRect().right - 18) return
    intentUntil = performance.now() + 1200
    const upward = event.deltaY < 0 || ['ArrowUp','PageUp','Home'].includes(event.key) || (event.type === 'touchmove' && event.touches[0]?.clientY > touchY)
    if (upward || event.type === 'pointerdown') { following.value = false; capture() }
  }
  function scroll() {
    if (performance.now() > intentUntil) return false
    const el = container.value
    following.value = mode.value !== 'search' && el.scrollHeight - el.scrollTop - el.clientHeight <= 24
    mode.value = following.value ? 'latest' : 'history'
    if (following.value) pending.value = 0
    capture()
    return true
  }
  function receive(count = 1) {
    if (!following.value || mode.value === 'search') pending.value += count
    schedule()
  }
  watch(container, el => {
    observer?.disconnect(); mutation?.disconnect()
    if (!el) return
    el.style.overflowAnchor = 'none'
    observe()
    mutation = new MutationObserver(() => { observe(); schedule() })
    mutation.observe(el, { childList: true, subtree: true })
    schedule()
  }, { flush: 'post' })
  watch(() => messages.value.length, async () => { const current = epoch; await nextTick(); if (current === epoch) { observe(); schedule() } }, { flush: 'post' })
  onUnmounted(() => { epoch++; cancelAnimationFrame(frame); observer?.disconnect(); mutation?.disconnect() })
  return { following, mode, pending, reset, capture, restore, schedule, input, scroll, receive }
}
