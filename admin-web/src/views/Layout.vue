<!-- 忆梦云团队开发 - 管理员布局 -->
<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()
const sidebarOpen = ref(false)

const adminInfo = ref(readAdminInfo())

function readAdminInfo() {
  try { return JSON.parse(localStorage.getItem('admin_info') || '{}') } catch { return {} }
}

function handleProfileUpdated(event) {
  adminInfo.value = event.detail || readAdminInfo()
}

onMounted(() => window.addEventListener('admin-profile-updated', handleProfileUpdated))
onUnmounted(() => window.removeEventListener('admin-profile-updated', handleProfileUpdated))

const isSuper = computed(() => adminInfo.value.role === 'super')

const navItems = computed(() => {
  const items = [
    { path: '/dashboard', icon: '▦', label: '仪表盘' },
    { path: '/tenants', icon: '▣', label: '租户管理' },
    { path: '/customers', icon: '♙', label: '客户管理' },
    { path: '/conversations', icon: '▤', label: '系统会话' },
    { path: '/complaints', icon: '◇', label: '投诉管理' },
    { path: '/announcements', icon: '◈', label: '公告管理' },
    { path: '/apps', icon: '▣', label: 'APP 管理' },
    { path: '/version', icon: '▤', label: '版本信息' },
    { path: '/profile', icon: '♙', label: '个人资料' },
  ]
  if (isSuper.value) {
    items.splice(7, 0,
      { path: '/extensions', icon: '◇', label: '扩展应用' },
      { path: '/settings', icon: '⚙', label: '系统设置' },
    )
  }
  return items
})

function navClick(path) {
  router.push(path)
  sidebarOpen.value = false
}

function logout() {
  localStorage.removeItem('admin_token')
  localStorage.removeItem('admin_info')
  router.replace('/login')
}

function initials(name) {
  if (!name) return 'A'
  return name.slice(0, 1).toUpperCase()
}
</script>

<template>
  <div class="admin-app">
    <!-- 移动端遮罩 -->
    <div
      v-if="sidebarOpen"
      style="position:fixed;inset:0;background:rgba(15,23,42,.4);z-index:40;"
      @click="sidebarOpen = false"
    ></div>

    <!-- 侧边栏 -->
    <aside class="admin-sidebar" :class="{ open: sidebarOpen }">
      <div class="admin-sidebar-brand">
        <div class="logo-row">
          <div class="logo-icon">Y</div>
          <div>
            <h1>忆梦云客服</h1>
            <div class="sub">平台管理</div>
          </div>
        </div>
      </div>

      <nav class="admin-sidebar-nav">
        <div class="nav-group-title">主菜单</div>
        <div
          v-for="item in navItems"
          :key="item.path"
          class="nav-item"
          :class="{ active: route.path.startsWith(item.path) }"
          @click="navClick(item.path)"
        >
          <span class="icon">{{ item.icon }}</span>
          <span class="nav-text">{{ item.label }}</span>
        </div>
      </nav>

      <button type="button" class="admin-sidebar-footer" @click="navClick('/profile')">
        <div class="avatar"><img v-if="adminInfo.avatarUrl" :src="adminInfo.avatarUrl" alt="" /><span v-else>{{ initials(adminInfo.username || 'A') }}</span></div>
        <div class="who">
          <div class="name">{{ adminInfo.username || 'admin' }}</div>
          <div class="role">{{ adminInfo.role === 'super' ? '超级管理员' : '运营管理员' }}</div>
        </div>
      </button>
    </aside>

    <!-- 主内容 -->
    <div class="admin-main">
      <header class="admin-header">
        <button class="menu-btn" @click="sidebarOpen = !sidebarOpen" aria-label="菜单">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
        <div class="page-title">
          <span v-if="route.path.startsWith('/dashboard')">仪表盘</span>
          <span v-else-if="route.path.startsWith('/tenants')">租户管理</span>
          <span v-else-if="route.path.startsWith('/customers')">客户管理</span>
          <span v-else-if="route.path.startsWith('/conversations')">系统会话</span>
          <span v-else-if="route.path.startsWith('/announcements')">公告管理</span>
          <span v-else-if="route.path.startsWith('/apps')">APP 管理</span>
          <span v-else-if="route.path.startsWith('/extensions')">扩展应用</span>
          <span v-else-if="route.path.startsWith('/settings')">系统设置</span>
          <span v-else-if="route.path.startsWith('/version')">版本信息</span>
          <span v-else-if="route.path.startsWith('/profile')">个人资料</span>
        </div>

        <div class="header-right">
          <div class="header-action" title="通知">
            🔔
            <span class="badge"></span>
          </div>
          <button type="button" class="user-badge" @click="navClick('/profile')" title="修改个人资料">
            <div class="avatar"><img v-if="adminInfo.avatarUrl" :src="adminInfo.avatarUrl" alt="" /><span v-else>{{ initials(adminInfo.username || 'A') }}</span></div>
            <span class="name">{{ adminInfo.username || 'admin' }}</span>
          </button>
          <button type="button" class="header-logout" @click="logout">退出</button>
        </div>
      </header>

      <main class="admin-content">
        <router-view v-slot="{ Component, route: currentRoute }">
          <KeepAlive>
            <component :is="Component" v-if="currentRoute.meta.keepAlive" />
          </KeepAlive>
          <component :is="Component" v-if="!currentRoute.meta.keepAlive" />
        </router-view>
      </main>
    </div>
  </div>
</template>