// 忆梦云团队开发 - 桌面端与手机端独立路由及旧 URL 兼容跳转
import { readTenantCache } from './api'
import { createRouter, createWebHistory } from 'vue-router'

const MOBILE_BREAKPOINT = 768
const desktopPrefix = '/desktop'
const mobilePrefix = '/m'
const publicPaths = new Set(['/login', '/register', '/forgot-password', '/sso'])

const devicePrefix = () => window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches ? mobilePrefix : desktopPrefix

function normalizeLegacyPath(path) {
  if (path === '/') return '/messages'
  return path
}

function mapPathToDevice(path, prefix = devicePrefix()) {
  const normalized = normalizeLegacyPath(path)
  if (normalized === desktopPrefix || normalized === mobilePrefix) return `${prefix}/messages`
  if (normalized === `${desktopPrefix}/account` || normalized === `${mobilePrefix}/profile/account`) {
    return prefix === mobilePrefix ? `${mobilePrefix}/profile/account` : `${desktopPrefix}/account`
  }
  if (normalized.startsWith(`${desktopPrefix}/`)) return `${prefix}${normalized.slice(desktopPrefix.length)}`
  if (normalized.startsWith(`${mobilePrefix}/`)) return `${prefix}${normalized.slice(mobilePrefix.length)}`
  return `${prefix}${normalized}`
}

const routes = [
  { path: '/login', component: () => import('./views/Login.vue'), meta: { public: true } },
  { path: '/register', component: () => import('./views/Register.vue'), meta: { public: true } },
  { path: '/forgot-password', component: () => import('./views/ForgotPassword.vue'), meta: { public: true } },
  { path: '/sso', component: () => import('./views/SsoCallback.vue'), meta: { public: true } },
  { path: '/agreements/:type', component: () => import('./views/AgreementPage.vue'), meta: { public: true } },
  {
    path: '/employee-login',
    component: { template: '<div></div>' },
    meta: { public: true },
    beforeEnter: (to) => {
      // 失败也保持隔离，禁止使用原窗口的管理员身份。
      sessionStorage.setItem('tenant_impersonation', '1')
      for (const field of ['tenant_token', 'tenant_user', 'tenant_info']) sessionStorage.removeItem(field)
      try {
        const key = typeof to.query.key === 'string' ? to.query.key : ''
        if (!/^employee_login_\d+$/.test(key)) return '/login'
        const raw = localStorage.getItem(key)
        localStorage.removeItem(key)
        const data = JSON.parse(raw || 'null')
        if (!data || typeof data.token !== 'string' || !data.token || !data.user?._id || !['admin', 'agent'].includes(data.user.role) || !data.tenant?._id) return '/login'
        sessionStorage.setItem('tenant_token', data.token)
        sessionStorage.setItem('tenant_user', JSON.stringify(data.user))
        sessionStorage.setItem('tenant_info', JSON.stringify(data.tenant))
        return `${devicePrefix()}/messages`
      } catch (_) {
        sessionStorage.removeItem('tenant_token')
        return '/login'
      }
    },
  },

  {
    path: desktopPrefix,
    component: () => import('./views/Layout.vue'),
    meta: { device: 'desktop' },
    children: [
      { path: '', redirect: `${desktopPrefix}/messages` },
      { path: 'messages', component: () => import('./views/desktop/Messages.vue') },
      { path: 'channels', component: () => import('./views/desktop/Channels.vue') },
      { path: 'announcements', component: () => import('./views/desktop/Announcements.vue') },
      { path: 'announcements/:id', component: () => import('./views/AnnouncementDetail.vue') },
      { path: 'employees', component: () => import('./views/desktop/Agents.vue'), meta: { adminOnly: true } },
      { path: 'extensions', component: () => import('./views/desktop/Extensions.vue'), meta: { adminOnly: true } },
      { path: 'extensions/jingpro', component: () => import('./views/desktop/JingproExtension.vue'), meta: { adminOnly: true } },
      { path: 'account', component: () => import('./views/Account.vue'), meta: { ownerOnly: true } },
      { path: 'profile', component: () => import('./views/desktop/Profile.vue') },
      { path: 'logs', component: () => import('./views/desktop/Logs.vue') },
    ],
  },
  { path: `${desktopPrefix}/messages/:id`, component: () => import('./views/desktop/ChatRoom.vue'), meta: { device: 'desktop', standalone: true } },
  { path: `${desktopPrefix}/channels/:id`, component: () => import('./views/desktop/ChannelDetail.vue'), meta: { device: 'desktop', standalone: true } },

  {
    path: mobilePrefix,
    component: () => import('./views/MobileLayout.vue'),
    meta: { device: 'mobile' },
    children: [
      { path: '', redirect: `${mobilePrefix}/messages` },
      { path: 'messages', component: () => import('./views/mobile/Messages.vue') },
      { path: 'channels', component: () => import('./views/mobile/Channels.vue') },
      { path: 'announcements', component: () => import('./views/mobile/Announcements.vue') },
      { path: 'announcements/:id', component: () => import('./views/AnnouncementDetail.vue') },
      { path: 'profile', component: () => import('./views/mobile/Profile.vue') },
      { path: 'profile/account', component: () => import('./views/Account.vue'), meta: { ownerOnly: true } },
      { path: 'profile/about', component: () => import('./views/mobile/About.vue') },
      { path: 'employees', component: () => import('./views/mobile/Agents.vue'), meta: { adminOnly: true } },
      { path: 'extensions', component: () => import('./views/mobile/Extensions.vue'), meta: { adminOnly: true } },
      { path: 'extensions/jingpro', component: () => import('./views/mobile/JingproExtension.vue'), meta: { adminOnly: true } },
      { path: 'logs', component: () => import('./views/mobile/Logs.vue') },
    ],
  },
  { path: `${mobilePrefix}/messages/:id`, component: () => import('./views/mobile/ChatRoom.vue'), meta: { device: 'mobile', standalone: true } },
  { path: `${mobilePrefix}/channels/:id`, component: () => import('./views/mobile/ChannelDetail.vue'), meta: { device: 'mobile', standalone: true } },
  { path: `${mobilePrefix}/profile/edit`, component: () => import('./views/mobile/ProfileEdit.vue'), meta: { device: 'mobile', standalone: true } },

  // 原 URL 保持可访问，并按当前设备跳转到新的独立页面文件。
  ...['/messages', '/messages/:id', '/channels', '/channels/:id', '/announcements', '/announcements/:id', '/employees', '/profile'].map((path) => ({
    path,
    redirect: (to) => ({
      path: mapPathToDevice(to.path),
      query: to.query,
      hash: to.hash,
    }),
  })),
  {
    path: '/:pathMatch(.*)*',
    redirect: () => `${devicePrefix()}/messages`,
  },
]

const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach((to) => {
  const isPublic = publicPaths.has(to.path) || to.matched.some((record) => record.meta.public)
  const impersonating = sessionStorage.getItem('tenant_impersonation') === '1'
  const token = sessionStorage.getItem('tenant_token') || (!impersonating ? localStorage.getItem('tenant_token') : '')
  if (!isPublic && !token) return { path: '/login', query: { redirect: to.fullPath } }
  if (isPublic) return true

  const user = readTenantCache('tenant_user')
  if (to.matched.some((record) => record.meta.adminOnly) && !['owner', 'admin'].includes(user?.role)) {
    return { path: `${devicePrefix()}/messages`, replace: true }
  }
  if (to.matched.some((record) => record.meta.ownerOnly) && user?.role !== 'owner') {
    return { path: `${devicePrefix()}/messages`, replace: true }
  }

  const expectedDevice = devicePrefix() === mobilePrefix ? 'mobile' : 'desktop'
  const routeDevice = to.matched.find((record) => record.meta.device)?.meta.device
  if (routeDevice && routeDevice !== expectedDevice) {
    return { path: mapPathToDevice(to.path), query: to.query, hash: to.hash, replace: true }
  }
  return true
})

export { mapPathToDevice }
export default router