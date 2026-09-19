// 忆梦云团队开发 - 第三方网站客服悬浮挂件
;(function () {
  'use strict'

  var script = document.currentScript
  if (!script || script.dataset.yimengInitialized === 'true') return
  script.dataset.yimengInitialized = 'true'

  function initialize() {
    var token = (script.dataset.token || '').trim()
    var configuredUrl = (script.dataset.url || '').trim()
    var scriptUrl = new URL(script.src, window.location.href)
    var chatUrl

    try {
      chatUrl = configuredUrl
        ? new URL(configuredUrl, scriptUrl.origin)
        : new URL('/c/' + encodeURIComponent(token), scriptUrl.origin)
    } catch (_) {
      return
    }

    if (!configuredUrl && !token) {
      console.error('[忆梦云客服] 缺少 data-token 或 data-url 配置')
      return
    }

    chatUrl.searchParams.set('embed', '1')

    var text = (script.dataset.text || '联系客服').trim() || '联系客服'
    var brandColor = /^#[0-9a-f]{6}$/i.test(script.dataset.color || '')
      ? script.dataset.color
      : '#2563eb'
    var positionKey = 'yimeng-widget-position:' + chatUrl.origin + chatUrl.pathname

    var host = document.createElement('div')
    host.id = 'yimeng-chat-widget'
    host.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;z-index:2147483647;'
    document.body.appendChild(host)

    var root = host.attachShadow({ mode: 'open' })
    root.innerHTML = [
      '<style>',
      ':host{all:initial}',
      '*,*::before,*::after{box-sizing:border-box}',
      '.launcher{position:fixed;right:max(20px,env(safe-area-inset-right));bottom:max(20px,env(safe-area-inset-bottom));display:flex;align-items:center;gap:11px;min-width:148px;height:58px;padding:7px 18px 7px 8px;border:0;border-radius:18px;background:', brandColor, ';color:#fff;box-shadow:0 12px 32px rgba(15,23,42,.25);font:600 16px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;cursor:grab;touch-action:none;user-select:none;transition:transform .18s ease,box-shadow .18s ease}',
      '.launcher:hover{transform:translateY(-2px);box-shadow:0 16px 38px rgba(15,23,42,.3)}',
      '.launcher.dragging{cursor:grabbing;transform:none;transition:none;box-shadow:0 18px 42px rgba(15,23,42,.32)}',
      '.launcher:focus-visible,.close:focus-visible{outline:3px solid rgba(147,197,253,.95);outline-offset:3px}',
      '.icon{display:grid;width:44px;height:44px;flex:0 0 44px;place-items:center;border:2px solid rgba(255,255,255,.78);border-radius:14px;background:rgba(255,255,255,.18)}',
      '.icon svg{width:28px;height:28px;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.8}',
      '.overlay{position:fixed;inset:0;display:none;flex-direction:column;background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}',
      '.overlay.open{display:flex}',
      '.toolbar{display:flex;min-height:calc(48px + env(safe-area-inset-top));flex:0 0 auto;align-items:center;justify-content:space-between;padding:env(safe-area-inset-top) max(8px,env(safe-area-inset-right)) 0 max(16px,env(safe-area-inset-left));border-bottom:1px solid #e2e8f0;background:#fff;color:#0f172a;box-shadow:0 1px 4px rgba(15,23,42,.08)}',
      '.toolbar-title{overflow:hidden;font-size:16px;font-weight:600;line-height:48px;text-overflow:ellipsis;white-space:nowrap}',
      '.frame{display:block;width:100%;min-height:0;flex:1 1 auto;border:0;background:#fff}',
      '.close{display:grid;width:40px;height:40px;flex:0 0 40px;place-items:center;border:0;border-radius:10px;background:transparent;color:#475569;cursor:pointer}',
      '.close svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-linecap:round;stroke-width:2}',
      '.close:hover{background:#f1f5f9;color:#0f172a}',
      '@media(max-width:480px){.launcher{right:max(14px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));min-width:136px;height:54px;padding-right:15px;border-radius:17px;font-size:15px}.icon{width:40px;height:40px;flex-basis:40px;border-radius:12px}}',
      '@media(prefers-reduced-motion:reduce){.launcher{transition:none}}',
      '</style>',
      '<button class="launcher" type="button" aria-label="', escapeHtml(text), '，可拖动">',
      '<span class="icon"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 17v-2a10 10 0 0 1 20 0v2"/><path d="M6 16H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2zm20 0h2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2zM26 23c0 3-3 5-7 5h-2"/><circle cx="15" cy="28" r="1"/></svg></span>',
      '<span>', escapeHtml(text), '</span></button>',
      '<div class="overlay" role="dialog" aria-modal="true" aria-label="在线客服">',
      '<div class="toolbar"><span class="toolbar-title">在线客服</span>',
      '<button class="close" type="button" aria-label="关闭客服窗口"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>',
      '<iframe class="frame" title="在线客服" allow="clipboard-write" referrerpolicy="strict-origin-when-cross-origin"></iframe>',
      '</div>',
    ].join('')

    var launcher = root.querySelector('.launcher')
    var overlay = root.querySelector('.overlay')
    var frame = root.querySelector('.frame')
    var closeButton = root.querySelector('.close')
    var previousOverflow = ''
    var open = false
    var drag = null
    var ignoreClick = false

    function clamp(value, minimum, maximum) {
      return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
    }

    function setPosition(left, top, persist) {
      var rect = launcher.getBoundingClientRect()
      var margin = 8
      var nextLeft = clamp(left, margin, window.innerWidth - rect.width - margin)
      var nextTop = clamp(top, margin, window.innerHeight - rect.height - margin)
      launcher.style.left = nextLeft + 'px'
      launcher.style.top = nextTop + 'px'
      launcher.style.right = 'auto'
      launcher.style.bottom = 'auto'
      if (persist) {
        try {
          localStorage.setItem(positionKey, JSON.stringify({ left: nextLeft, top: nextTop }))
        } catch (_) {}
      }
    }

    function restorePosition() {
      try {
        var saved = JSON.parse(localStorage.getItem(positionKey) || 'null')
        if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
          setPosition(saved.left, saved.top, false)
        }
      } catch (_) {}
    }

    function handlePointerDown(event) {
      if (event.button !== undefined && event.button !== 0) return
      var rect = launcher.getBoundingClientRect()
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        moved: false,
      }
      launcher.setPointerCapture(event.pointerId)
    }

    function handlePointerMove(event) {
      if (!drag || event.pointerId !== drag.pointerId) return
      var deltaX = event.clientX - drag.startX
      var deltaY = event.clientY - drag.startY
      if (!drag.moved && Math.hypot(deltaX, deltaY) < 5) return
      drag.moved = true
      launcher.classList.add('dragging')
      setPosition(drag.left + deltaX, drag.top + deltaY, false)
    }

    function handlePointerUp(event) {
      if (!drag || event.pointerId !== drag.pointerId) return
      if (drag.moved) {
        ignoreClick = true
        var rect = launcher.getBoundingClientRect()
        setPosition(rect.left, rect.top, true)
      }
      launcher.classList.remove('dragging')
      if (launcher.hasPointerCapture(event.pointerId)) launcher.releasePointerCapture(event.pointerId)
      drag = null
    }

    function openChat() {
      if (ignoreClick) {
        ignoreClick = false
        return
      }
      if (open) return
      open = true
      previousOverflow = document.documentElement.style.overflow
      document.documentElement.style.overflow = 'hidden'
      if (!frame.src) frame.src = chatUrl.href
      overlay.classList.add('open')
      closeButton.focus()
      document.addEventListener('keydown', handleKeydown)
    }

    function closeChat() {
      if (!open) return
      open = false
      overlay.classList.remove('open')
      document.documentElement.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeydown)
      launcher.focus()
    }

    function handleKeydown(event) {
      if (event.key === 'Escape') closeChat()
    }

    launcher.addEventListener('pointerdown', handlePointerDown)
    launcher.addEventListener('pointermove', handlePointerMove)
    launcher.addEventListener('pointerup', handlePointerUp)
    launcher.addEventListener('pointercancel', handlePointerUp)
    launcher.addEventListener('click', openChat)
    closeButton.addEventListener('click', closeChat)
    window.addEventListener('resize', function () {
      if (launcher.style.left) {
        var rect = launcher.getBoundingClientRect()
        setPosition(rect.left, rect.top, false)
      }
    })
    restorePosition()
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[character]
    })
  }

  if (document.body) initialize()
  else document.addEventListener('DOMContentLoaded', initialize, { once: true })
})()
