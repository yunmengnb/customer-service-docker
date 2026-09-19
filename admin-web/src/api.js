// 忆梦云团队开发
import axios from 'axios'
const api = axios.create({ baseURL: '/api', timeout: 15000 })

api.interceptors.request.use(config => {
  const token = localStorage.getItem('admin_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
api.upload = function(url, formData) {
  return api.post(url, formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 5 * 60 * 1000 })
}

api.interceptors.response.use(
  res => res.data,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('admin_token')
      localStorage.removeItem('admin_info')
      if (window.location.pathname !== '/login') window.location.replace('/login')
    }
    return Promise.reject(err.response?.data || err)
  }
)
export default api