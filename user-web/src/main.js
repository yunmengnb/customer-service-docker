// 忆梦云团队开发
import { createApp } from 'vue'
import router from './router'
import App from './App.vue'
import api from './api'
import './style.css'

function setMeta(name, content) {
  let element = document.querySelector(`meta[name="${name}"]`)
  if (!element) {
    element = document.createElement('meta')
    element.name = name
    document.head.appendChild(element)
  }
  element.content = content || ''
}

api.get('/client/public-settings').then(res => {
  if (res.code !== 0) return
  document.title = res.data.siteTitle || '忆梦云客服'
  setMeta('keywords', res.data.siteKeywords)
  setMeta('description', res.data.siteDescription)
}).catch(() => {})

createApp(App).use(router).mount('#app')
