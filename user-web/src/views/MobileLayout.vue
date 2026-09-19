<!-- 忆梦云团队开发 - 移动端：底部 4 Tab + 企业微信风格 -->
<script setup>
import { clearTenantSession, readTenantCache } from '../api'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { clearIdentityCache, tenantIdentityScope } from '../chatCache'

const route = useRoute()
const router = useRouter()
const user = readTenantCache('tenant_user')
const showLogoutConfirm = ref(false)

const tabs = computed(() => [
  { path: '/m/messages', icon: '💬', activeIcon: '💬', label: '消息', badge: 0 },
  { path: '/m/channels', icon: '🔗', label: '授权渠道', badge: 0 },
  ...(['owner', 'admin'].includes(user?.role)
    ? [{ path: '/m/employees', icon: '👥', label: '员工', badge: 0 }]
    : []),
  { path: '/m/profile', icon: '👤', label: '我的', badge: 0 },
])

const tabPaths = computed(() => new Set(tabs.value.map(tab => tab.path)))
const showPrimaryNavigation = computed(() => tabPaths.value.has(route.path))
const current = computed(() => tabs.value.find(tab => route.path === tab.path) || null)
const isChannelMessages = computed(() => route.path === '/m/messages' && Boolean(route.query.channelId))
const pageTitle = computed(() => {
  if (isChannelMessages.value) return String(route.query.channelName || '渠道会话')
  return current.value?.label || ({
    '/m/announcements': '系统公告',
    '/m/profile/account': '企业套餐与用量',
    '/m/profile/about': '关于软件',
    '/m/logs': '操作日志',
    '/m/extensions': '扩展应用',
    '/m/extensions/jingpro': 'Jingpro 配置',
  }[route.path] || (route.path.startsWith('/m/announcements/') ? '公告详情' : '详情'))
})

function returnToChannels() {
  const query = { ...route.query }
  delete query.channelId
  delete query.channelName
  router.replace({ path: route.path, query })
}

function go(tab) {
  if (route.path !== tab.path) {
    router.push(tab.path)
  }
}

async function logout() {
  showLogoutConfirm.value = false
  const identityScope = tenantIdentityScope()
  await clearIdentityCache(identityScope)
  clearTenantSession()
  router.push('/login')
}

function activeIcon(tab) {
  // 消息 Tab 可以区分图标
  return tab.icon
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.replace('/m/profile')
}
</script>

<template>
  <div class="mob-app" :class="{ 'message-list-page': route.path === '/m/messages', 'without-tabbar': !showPrimaryNavigation }">
    <!-- 顶部状态栏 -->
    <header class="mob-header">
      <button v-if="isChannelMessages" class="mob-channel-back" type="button" @click="returnToChannels">‹ 返回渠道</button>
      <button v-else-if="!showPrimaryNavigation" class="mob-header-back" type="button" aria-label="返回" @click="goBack">←</button>
      <div class="mob-header-title">{{ pageTitle }}</div>
      <div class="mob-header-right">
        <button v-if="showPrimaryNavigation && !isChannelMessages" class="mob-announcement-link" type="button" aria-label="系统公告" @click="router.push('/m/announcements')">公告</button>
      </div>
    </header>

    <!-- 内容 slot -->
    <main class="mob-content">
      <router-view />
    </main>

    <!-- 底部 Tab 栏：仅一级页面显示 -->
    <nav v-if="showPrimaryNavigation" class="mob-tabbar">
      <div
        v-for="tab in tabs"
        :key="tab.path"
        class="mob-tab"
        :class="{ 'is-active': current?.path === tab.path }"
        @click="go(tab)"
      >
        <div class="mob-tab-icon">{{ activeIcon(tab) }}</div>
        <div class="mob-tab-label">{{ tab.label }}</div>
        <div v-if="tab.badge > 0" class="mob-tab-badge">{{ tab.badge > 99 ? '99+' : tab.badge }}</div>
      </div>
    </nav>

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
.mob-app {
  display: flex; flex-direction: column; height: 100vh; height: 100dvh;
  min-height: 0; overflow: hidden; background: #f5f6f8;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: #0f172a; max-width: 480px; margin: 0 auto;
}

/* 顶部状态栏：仿企业微信 */
.mob-header {
  height: 52px; background: #fff;
  border-bottom: 1px solid #eceff1;
  display: flex; align-items: center; padding: 0 16px;
  flex-shrink: 0;
  padding-top: env(safe-area-inset-top, 0);
}
.mob-header-title {
  font-size: 17px; font-weight: 600; color: #0f172a; flex: 1; text-align: center;
}
.mob-header-back, .mob-channel-back, .mob-announcement-link {
  position: absolute; border: none; background: transparent; color: #2563eb; cursor: pointer;
}
.mob-header-back {
  left: 10px; padding: 8px; font-size: 21px; line-height: 1;
}
.mob-channel-back { left: 10px; padding: 8px 4px; font-size: 13px; font-weight: 600; }
.mob-header-right {
  position: absolute; right: 12px;
}
.mob-announcement-link { position: static; padding: 8px 4px; font-size: 14px; font-weight: 600; }

/* 内容 */
.mob-content {
  flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
  padding-bottom: calc(60px + env(safe-area-inset-bottom, 0));
}
.without-tabbar .mob-content { padding-bottom: env(safe-area-inset-bottom, 0); }
.message-list-page {
  display: block;
  height: 100vh;
  height: 100dvh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: calc(60px + env(safe-area-inset-bottom, 0));
}
.message-list-page .mob-content {
  overflow: visible;
  padding-bottom: 0;
}

/* 底部 Tab */
.mob-tabbar {
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: 0; width: 100%; max-width: 480px;
  height: calc(60px + env(safe-area-inset-bottom, 0));
  background: #fff;
  border-top: 1px solid #eceff1;
  display: flex; padding-bottom: env(safe-area-inset-bottom, 0);
  z-index: 50;
  box-shadow: 0 -2px 12px rgba(0,0,0,.04);
}
.mob-tab {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 3px; cursor: pointer; position: relative;
  transition: color .15s;
  padding-top: 4px;
}
.mob-tab-icon { font-size: 22px; line-height: 1; transition: transform .15s; }
.mob-tab-label { font-size: 11px; color: #94a3b8; font-weight: 500; }
.mob-tab.is-active .mob-tab-icon { transform: scale(1.05); }
.mob-tab.is-active .mob-tab-label { color: #2563eb; font-weight: 600; }
.mob-tab.is-active { color: #2563eb; }

/* 未读红点 */
.mob-tab-badge {
  position: absolute; top: 4px; min-width: 18px; height: 18px;
  background: #ef4444; color: #fff; font-size: 10px; font-weight: 600;
  border-radius: 9px; padding: 0 5px; line-height: 18px; text-align: center;
  border: 2px solid #fff;
}
</style>
