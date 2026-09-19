// 忆梦云团队开发
import axios from 'axios'
import { reportDebugEvent } from './attachmentActions'

export function readTenantCache(key, fallback = null) {
  try {
    const isolated = sessionStorage.getItem('tenant_impersonation') === '1'
    const raw = sessionStorage.getItem(key) || (!isolated ? localStorage.getItem(key) : null)
    const value = JSON.parse(raw || 'null')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback
  } catch (_) {
    return fallback
  }
}

export function clearTenantSession() {
  const impersonating = sessionStorage.getItem('tenant_impersonation') === '1'
  const storage = impersonating || sessionStorage.getItem('tenant_token') ? sessionStorage : localStorage
  for (const key of ['tenant_token', 'tenant_user', 'tenant_info']) storage.removeItem(key)
  // 保留隔离标志直到显式登录成功，401 后重复退出也不能回落或清除原管理员身份。
}

const api = axios.create({ baseURL: '/api', timeout: 15000 })

function isSameOriginApiRequest(config) {
  const url = config.url || ''
  const requestUrl = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(url) || url.startsWith('//')
    ? url
    : `${String(config.baseURL || '').replace(/\/$/, '')}/${url.replace(/^\//, '')}`, window.location.origin)
  return requestUrl.origin === window.location.origin && /^\/api(?:\/|$)/.test(requestUrl.pathname)
}

api.interceptors.request.use(config => {
  const impersonating = sessionStorage.getItem('tenant_impersonation') === '1'
  const token = sessionStorage.getItem('tenant_token') || (!impersonating ? localStorage.getItem('tenant_token') : '')
  if (token && isSameOriginApiRequest(config)) config.headers.Authorization = `Bearer ${token}`
  // #region debug-point E:blob-request-start
  if (config.responseType === 'blob') {
    config._debugBlobStartedAt = Date.now()
    const path = String(config.url || '').split('?')[0]
    reportDebugEvent('E', 'api.js:request', 'authenticated blob request start', { phase: 'request-start', resourceKind: path.endsWith('/thumbnail') ? 'thumbnail' : path.includes('avatar') ? 'avatar' : 'media', stableId: path.split('/').filter(Boolean).at(-1)?.slice(-6) || 'media', cachePath: 'network', timeout: Number(config.timeout || 0), authorizationAttached: Boolean(token && isSameOriginApiRequest(config)) })
  }
  // #endregion
  return config
})
api.interceptors.response.use(
  res => {
    // #region debug-point E:blob-request-end
    if (res.config?.responseType === 'blob') {
      const path = String(res.config.url || '').split('?')[0]
      reportDebugEvent('E', 'api.js:response', 'authenticated blob request end', { phase: 'request-end', resourceKind: path.endsWith('/thumbnail') ? 'thumbnail' : path.includes('avatar') ? 'avatar' : 'media', stableId: path.split('/').filter(Boolean).at(-1)?.slice(-6) || 'media', cachePath: 'network', status: Number(res.status || 0), durationMs: Date.now() - Number(res.config._debugBlobStartedAt || Date.now()), cacheControl: String(res.headers?.['cache-control'] || '').slice(0, 80), etagPresent: Boolean(res.headers?.etag), expiresPresent: Boolean(res.headers?.expires) })
    }
    // #endregion
    return res.data
  },
  err => {
    // #region debug-point E:blob-request-error
    if (err.config?.responseType === 'blob') {
      const path = String(err.config.url || '').split('?')[0]
      reportDebugEvent('E', 'api.js:response-error', 'authenticated blob request failed', { phase: 'request-end', resourceKind: path.endsWith('/thumbnail') ? 'thumbnail' : path.includes('avatar') ? 'avatar' : 'media', stableId: path.split('/').filter(Boolean).at(-1)?.slice(-6) || 'media', cachePath: 'network', status: Number(err.response?.status || 0), durationMs: Date.now() - Number(err.config._debugBlobStartedAt || Date.now()), cacheControl: String(err.response?.headers?.['cache-control'] || '').slice(0, 80), etagPresent: Boolean(err.response?.headers?.etag), expiresPresent: Boolean(err.response?.headers?.expires), errorKind: String(err.code || 'request-error').slice(0, 40) })
    }
    // #endregion
    if (err.response?.status === 401) {
      if (sessionStorage.getItem('tenant_impersonation') === '1') {
        sessionStorage.removeItem('tenant_token')
        sessionStorage.removeItem('tenant_user')
        sessionStorage.removeItem('tenant_info')
      } else {
        const storage = sessionStorage.getItem('tenant_token') ? sessionStorage : localStorage
        storage.removeItem('tenant_token')
      }
    }
    const reason = err.response?.data || err
    if (reason && typeof reason === 'object') reason.httpStatus = err.response?.status
    return Promise.reject(reason)
  }
)

// FormData 上传（axios.post 传 FormData 即可，但要确保 Content-Type 被自动设置）
api.upload = function(url, formData, extraHeaders = {}) {
  return api.post(url, formData, {
    headers: { 'Content-Type': 'multipart/form-data', ...extraHeaders },
    timeout: 30000,
  })
}

export default api
