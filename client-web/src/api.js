// 忆梦云团队开发
import axios from 'axios'
import { io } from 'socket.io-client'

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

const isPublicAuthRequest = url => /^\/client\/(?:auth|channels\/[^/]+\/auth)\/(?:captcha|guest|login|register|register-code)$/.test(url || '')
  || /^\/client\/channels\/(?!history(?:\/|$))[^/]+(?:\/captcha)?$/.test(url || '')

// 请求拦截：仅为需要鉴权的接口注入 token
api.interceptors.request.use(config => {
  const token = localStorage.getItem('client_token')
  const isGuestBindingRequest = /\/client\/channels\/[^/]+\/auth\/(?:login|register)$/.test(config.url || '')
  if (token && (!isPublicAuthRequest(config.url) || isGuestBindingRequest)) {
    config.headers.Authorization = `Bearer ${token}`
  }
  if (/^\/wechat\/client\//.test(config.url || '') && String(config.method || 'get').toLowerCase() === 'post') {
    config.headers['X-Wechat-Intent'] = 'client-v1'
  }
  return config
})

// 响应拦截
api.interceptors.response.use(
  res => res.data,
  err => {
    if (err.response?.status === 401 && err.config?.headers?.Authorization) {
      clearClientSession()
    }
    const reason = err.response?.data || err
    if (reason && typeof reason === 'object') reason.httpStatus = err.response?.status
    return Promise.reject(reason)
  }
)

// Socket.IO 单例
let socket = null
let socketToken = null
function getSocket(token) {
  if (socket && socketToken === token) {
    if (!socket.connected) socket.connect()
    return socket
  }
  if (socket) socket.disconnect()
  socketToken = token
  socket = io({
    auth: { token, type: 'customer' },
    transports: ['polling', 'websocket'],
  })
  return socket
}

function disconnectClientSocket() {
  socket?.disconnect()
  socket = null
  socketToken = null
}

function clearClientSession() {
  localStorage.removeItem('client_token')
  disconnectClientSocket()
}

export { api, getSocket, disconnectClientSocket, clearClientSession }
export default api
