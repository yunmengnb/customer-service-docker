// 忆梦云团队开发
import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/c/:token',
    name: 'chat',
    component: () => import('./views/ChatPage.vue'),
  },
  {
    path: '/account',
    name: 'account',
    component: () => import('./views/AccountPage.vue'),
  },
  {
    path: '/agreements/:type',
    name: 'agreement',
    component: () => import('./views/AgreementPage.vue'),
  },
  {
    path: '/',
    redirect: () => localStorage.getItem('client_token') ? '/account' : '/c/default',
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
