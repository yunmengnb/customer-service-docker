// 忆梦云团队开发 - 跨浏览器文本复制兼容工具
function legacyCopy(text) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.setAttribute('aria-hidden', 'true')
  textarea.style.cssText = 'position:fixed;top:0;left:-9999px;width:1px;height:1px;font-size:16px;'
  document.body.appendChild(textarea)
  textarea.focus({ preventScroll: true })
  textarea.select()
  textarea.setSelectionRange(0, text.length)

  try {
    if (!document.execCommand('copy')) throw new Error('浏览器拒绝复制')
  } finally {
    textarea.remove()
  }
}

export async function copyText(text) {
  if (!text) throw new Error('没有可复制的内容')

  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      legacyCopy(text)
      return
    }
  }

  legacyCopy(text)
}

export function buildCustomerServiceUrl(link) {
  if (/^https?:\/\//i.test(link || '')) return link
  return `${window.location.protocol}//${window.location.hostname}:5176${link || ''}`
}

function escapeAttribute(value) {
  return String(value).replace(/[&"<>]/g, character => ({
    '&': '&amp;',
    '"': '&quot;',
    '<': '&lt;',
    '>': '&gt;',
  })[character])
}

export function buildCustomerServiceWidgetCode(link, options = {}) {
  const chatUrl = new URL(buildCustomerServiceUrl(link))
  const widgetUrl = new URL('/widget.js', chatUrl.origin)
  const attributes = [
    `src="${escapeAttribute(widgetUrl.href)}"`,
    `data-url="${escapeAttribute(chatUrl.href)}"`,
    `data-text="${escapeAttribute(options.text || '联系客服')}"`,
  ]

  if (/^#[0-9a-f]{6}$/i.test(options.color || '')) {
    attributes.push(`data-color="${options.color}"`)
  }

  return `<script ${attributes.join(' ')} defer><\/script>`
}
