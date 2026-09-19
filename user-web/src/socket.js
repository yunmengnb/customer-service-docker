// 忆梦云团队开发 - 客服后台全局 Socket.IO 单例
import { io } from 'socket.io-client'

let tenantSocket = null
let tenantSocketToken = ''

function getTenantToken() {
  const impersonating = sessionStorage.getItem('tenant_impersonation') === '1'
  return sessionStorage.getItem('tenant_token') || (!impersonating ? localStorage.getItem('tenant_token') : '') || ''
}

export function getTenantSocket() {
  const token = getTenantToken()
  if (!token) {
    disconnectTenantSocket()
    return null
  }

  if (tenantSocket && tenantSocketToken === token) return tenantSocket

  disconnectTenantSocket()
  tenantSocketToken = token
  tenantSocket = io({
    auth: { token, type: 'tenant_user' },
    transports: ['polling', 'websocket'],
  })
  return tenantSocket
}

export function disconnectTenantSocket() {
  tenantSocket?.disconnect()
  tenantSocket = null
  tenantSocketToken = ''
}
