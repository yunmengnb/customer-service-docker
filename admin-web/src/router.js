// 忆梦云团队开发 - 管理端路由
import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  { path: '/login', component: () => import('./views/Login.vue'), meta: { public: true } },
  { path: '/sso', component: () => import('./views/SsoCallback.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('./views/Layout.vue'),
    children: [
      { path: '', redirect: '/dashboard' },
      { path: 'dashboard', component: () => import('./views/Dashboard.vue'), meta: { keepAlive: true } },
      { path: 'tenants', component: () => import('./views/Tenants.vue'), meta: { keepAlive: true } },
      { path: 'customers', component: () => import('./views/Customers.vue'), meta: { keepAlive: true } },
      { path: 'conversations', component: () => import('./views/Conversations.vue') },
      { path: 'complaints', component: () => import('./views/Complaints.vue'), meta: { keepAlive: true } },
      { path: 'announcements', component: () => import('./views/Announcements.vue'), meta: { keepAlive: true } },
      { path: 'apps', component: () => import('./views/AppManagement.vue') },
      { path: 'extensions', component: () => import('./views/Extensions.vue'), meta: { requiresSuper: true } },
      { path: 'extensions/jingpro', component: () => import('./views/JingproExtension.vue'), meta: { requiresSuper: true } },
      { path: 'settings', component: () => import('./views/Settings.vue'), meta: { requiresSuper: true } },
      { path: 'version', component: () => import('./views/Version.vue'), meta: { keepAlive: true } },
      { path: 'profile', component: () => import('./views/Profile.vue') },
    ],
  },
]

const router = createRouter({ history: createWebHistory(), routes })

function isSuperAdmin() {
  try { return JSON.parse(localStorage.getItem('admin_info') || '{}').role === 'super' } catch { return false }
}

router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('admin_token')
  if (!to.meta.public && !token) next('/login')
  else if (to.path === '/login' && token) next('/dashboard')
  else if (to.matched.some(record => record.meta.requiresSuper) && !isSuperAdmin()) next('/dashboard')
  else next()
})

export default router