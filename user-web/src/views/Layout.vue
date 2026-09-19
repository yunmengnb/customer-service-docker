<!-- 忆梦云团队开发 - 桌面端：可折叠侧边栏布局 -->
<script setup>
import { clearTenantSession, readTenantCache } from '../api'
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { clearIdentityCache, tenantIdentityScope } from '../chatCache'

const router = useRouter()
const route = useRoute()
const user = ref(readTenantCache('tenant_user'))
const tenant = readTenantCache('tenant_info')

// 侧边栏折叠状态（仅桌面端，且不是消息中心时才会隐藏）
const collapsed = ref(localStorage.getItem('layout_sidebar_collapsed') === '1')
const showLogoutConfirm = ref(false)

watch(collapsed, (v) => localStorage.setItem('layout_sidebar_collapsed', v ? '1' : '0'))

const navItems = computed(() => [
  { path: '/desktop/messages', icon: '💬', label: '消息中心' },
  { path: '/desktop/channels', icon: '🔗', label: '授权渠道' },
  { path: '/desktop/announcements', icon: '📢', label: '系统公告' },
  ...(['owner', 'admin'].includes(user.value?.role)
    ? [
        { path: '/desktop/employees', icon: '👥', label: '员工管理' },
        { path: '/desktop/extensions', icon: '▦', label: '扩展应用' },
      ]
    : []),
  ...(user.value?.role === 'owner'
    ? [{ path: '/desktop/account', icon: '◇', label: '企业套餐与用量' }]
    : []),
  { path: '/desktop/logs', icon: '🕓', label: '操作日志' },
  { path: '/desktop/profile', icon: '♙', label: '个人资料' },
])

function active(path) {
  return route.path === path || route.path.startsWith(path + '/')
}

async function logout() {
  showLogoutConfirm.value = false
  const identityScope = tenantIdentityScope()
  await clearIdentityCache(identityScope)
  clearTenantSession()
  router.replace('/login')
}

// 消息中心路由：占满全屏，去掉 header 内容 padding
const isMessagesPage = computed(() =>
  route.path.startsWith('/desktop/messages'),
)

function toggleSidebar() {
  collapsed.value = !collapsed.value
}

function handleProfileUpdated(event) {
  user.value = event.detail || user.value
}

onMounted(() => window.addEventListener('tenant-profile-updated', handleProfileUpdated))
onUnmounted(() => window.removeEventListener('tenant-profile-updated', handleProfileUpdated))

</script>

<template>
  <div class="dsk-app" :class="{ 'collapsed': collapsed }">
    <!-- ====== 桌面侧边栏 ====== -->
    <aside class="dsk-sidebar" :class="{ hidden: collapsed }">
      <div class="dsk-brand">
        <div class="dsk-logo-icon">Y</div>
        <div>
          <div class="dsk-brand-name">忆梦云客服</div>
          <div class="dsk-brand-sub">客服后台</div>
        </div>
      </div>

      <nav class="dsk-nav">
        <div class="dsk-nav-group">工作台</div>
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="dsk-nav-item"
          :class="{ 'is-active': active(item.path) }"
        >
          <span class="dsk-nav-icon">{{ item.icon }}</span>
          <span class="dsk-nav-label">{{ item.label }}</span>
        </router-link>
      </nav>

      <div class="dsk-user">
        <div class="dsk-user-avatar"><img v-if="user?.avatarUrl" :src="user.avatarUrl" alt="" /><span v-else>{{ (user?.displayName || user?.username || '?').slice(0, 1).toUpperCase() }}</span></div>
        <div class="dsk-user-who">
          <div class="dsk-user-name">{{ user?.displayName || user?.username || '未登录' }}</div>
          <div class="dsk-user-role">{{ user?.role === 'owner' ? '所有者' : (user?.displayName || user?.username || '员工') }}</div>
        </div>
        <button class="dsk-user-logout" title="退出登录" @click="showLogoutConfirm = true">↩</button>
      </div>
    </aside>

    <!-- ====== 主区域 ====== -->
    <div class="dsk-main">
      <!-- 粘性头部 -->
      <header class="dsk-header" :class="{ 'dsk-header-compact': isMessagesPage }">
        <button class="dsk-collapse-btn" @click="toggleSidebar" :title="collapsed ? '展开侧边栏' : '隐藏侧边栏'">
          <span class="hamburger"></span>
        </button>

        <template v-if="!isMessagesPage">
          <div class="dsk-header-title">{{ navItems.find(i => active(i.path))?.label || tenant?.name || '工作台' }}</div>
          <div class="dsk-header-right">
            <div class="dsk-header-who">
              <span class="dsk-header-who-name">{{ user?.displayName || user?.username }}</span>
              <span class="dsk-header-who-tenant">· {{ tenant?.name }}</span>
            </div>
          </div>
        </template>
      </header>

      <!-- 内容 -->
      <main class="dsk-content" :class="{ 'dsk-content-full': isMessagesPage }">
        <router-view />
      </main>
    </div>

    <ConfirmDialog
      :open="showLogoutConfirm"
      title="退出登录"
      message="确认退出当前账号吗？退出后需要重新登录。"
      confirm-text="确认退出"
      danger
      @confirm="logout"
      @cancel="showLogoutConfirm = false"
    />
  </div>
</template>

<style scoped>
.dsk-app {
  display: flex; height: 100vh; background: #f8fafc;
  font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', -apple-system, sans-serif;
  color: #0f172a;
}

/* 侧边栏 */
.dsk-sidebar {
  width: 248px; background: #0f172a; color: #e2e8f0;
  display: flex; flex-direction: column;
  flex-shrink: 0;
  transition: width .2s ease, transform .2s ease;
  overflow: hidden;
}
.dsk-sidebar.hidden {
  width: 0;
  min-width: 0;
  border: 0;
  visibility: hidden;
  pointer-events: none;
}
.dsk-brand {
  padding: 22px 20px 18px; border-bottom: 1px solid rgba(255,255,255,0.08);
  display: flex; align-items: center; gap: 12px; flex-shrink: 0;
  min-width: 248px;
}
.dsk-logo-icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  display: flex; align-items: center; justify-content: center;
  font-weight: 800; color: #fff; font-size: 16px;
  box-shadow: 0 4px 14px rgba(37, 99, 235, .5);
}
.dsk-brand-name { font-size: 15px; color: #fff; font-weight: 700; letter-spacing: .5px; }
.dsk-brand-sub { font-size: 11px; color: #64748b; margin-top: 2px; }

.dsk-nav { flex: 1; padding: 16px 12px; overflow-y: auto; min-width: 248px; }
.dsk-nav-group {
  font-size: 11px; font-weight: 600; color: #475569; text-transform: uppercase;
  letter-spacing: 1px; padding: 8px 12px 6px;
}
.dsk-nav-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border-radius: 10px;
  color: #cbd5e1; font-size: 14px; font-weight: 500;
  transition: all .18s; margin-bottom: 2px;
  text-decoration: none; position: relative;
}
.dsk-nav-item:hover { background: rgba(255,255,255,0.08); color: #fff; }
.dsk-nav-item.is-active {
  background: linear-gradient(135deg, rgba(37,99,235,.35), rgba(37,99,235,.15));
  color: #fff;
}
.dsk-nav-item.is-active::before {
  content: ''; position: absolute; left: -12px; top: 10px; bottom: 10px;
  width: 3px; background: #2563eb; border-radius: 0 3px 3px 0;
}
.dsk-nav-icon { width: 20px; font-size: 16px; display: flex; align-items: center; justify-content: center; }

.dsk-user {
  padding: 14px 16px; border-top: 1px solid rgba(255,255,255,0.08);
  display: flex; align-items: center; gap: 10px; min-width: 248px;
  flex-shrink: 0;
}
.dsk-user-avatar {
  width: 34px; height: 34px; border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #2563eb);
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; color: #fff; font-size: 13px; flex-shrink: 0;
}
.dsk-user-avatar img { width:100%; height:100%; border-radius:inherit; object-fit:cover; }
.dsk-user-who { flex: 1; min-width: 0; }
.dsk-user-name { font-size: 13px; color: #fff; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsk-user-role { font-size: 11px; color: #64748b; margin-top: 2px; }
.dsk-user-logout {
  background: transparent; border: 1px solid rgba(255,255,255,0.12);
  color: #94a3b8; width: 30px; height: 30px; border-radius: 8px;
  cursor: pointer; font-size: 13px; transition: all .15s;
}
.dsk-user-logout:hover { background: rgba(239, 68, 68, 0.15); color: #ef4444; border-color: rgba(239,68,68,.3); }

/* 主区域 */
.dsk-main { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: hidden; }

/* 粘性头部 */
.dsk-header {
  position: sticky; top: 0; z-index: 40; height: 56px;
  background: rgba(255,255,255,.95); backdrop-filter: blur(16px);
  border-bottom: 1px solid #e2e8f0;
  display: flex; align-items: center; padding: 0 16px; flex-shrink: 0;
  gap: 12px;
}
.dsk-header-compact { /* 消息页面去掉多余间距，更紧凑 */
  height: 44px; padding: 0 12px;
}
.dsk-collapse-btn {
  width: 36px; height: 36px; border: none; background: transparent;
  border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: #475569; flex-shrink: 0;
}
.dsk-collapse-btn:hover { background: #f1f5f9; color: #0f172a; }
.hamburger {
  width: 18px; height: 2px; background: currentColor; border-radius: 2px;
  box-shadow: 0 -5px 0 currentColor, 0 5px 0 currentColor;
}
.dsk-header-compact .dsk-collapse-btn { width: 32px; height: 32px; }

.dsk-header-title { font-size: 16px; font-weight: 700; flex: 1; color: #0f172a; }
.dsk-header-right { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
.dsk-header-who-name { font-size: 13px; font-weight: 600; color: #0f172a; }
.dsk-header-who-tenant { font-size: 12px; color: #64748b; }

/* 内容 */
.dsk-content {
  flex: 1; min-width: 0; min-height: 0;
  overflow-y: auto; padding: 20px;
}
.dsk-content-full {
  padding: 0; margin: 0; min-height: 0; overflow: hidden;
}

/* 移动端 */
@media (max-width: 768px) {
  .dsk-sidebar {
    position: fixed; left: 0; top: 0; bottom: 0; z-index: 50;
    transform: translateX(-100%); transition: transform .25s;
  }
  .dsk-sidebar.mobile-open { transform: translateX(0); }
  .dsk-sidebar.hidden { width: 248px; transform: translateX(-100%); }
  .dsk-mobile-mask {
    position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 45;
  }
  .dsk-header { height: 48px; padding: 0 12px; }
  .dsk-content { padding: 0; }
  .dsk-collapse-btn { display: flex; }
}
</style>