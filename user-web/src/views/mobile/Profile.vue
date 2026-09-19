<!-- 忆梦云团队开发 - 移动端"我的"页面 -->
<script setup>
import api, { clearTenantSession, readTenantCache } from '../../api'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { clearIdentityCache, tenantIdentityScope } from '../../chatCache'

const router = useRouter()
const user = ref(readTenantCache('tenant_user'))
const tenant = ref(readTenantCache('tenant_info'))
const showLogoutConfirm = ref(false)

const roleLabel = computed(() => ({ owner: '客服后台所有者', admin: '管理员', agent: '客服' }[user.value?.role] || user.value?.role))

async function refreshUser() {
  try {
    const res = await api.get('/tenant/auth/me')
    if (res.code === 0 && res.data?.user) {
      user.value = res.data.user
      const storage = sessionStorage.getItem('tenant_token') ? sessionStorage : localStorage
      storage.setItem('tenant_user', JSON.stringify(res.data.user))
      if (res.data.tenant) {
        tenant.value = res.data.tenant
        storage.setItem('tenant_info', JSON.stringify(res.data.tenant))
      }
    }
  } catch (_) {}
}

onMounted(refreshUser)

function goProfileEdit() {
  router.push('/m/profile/edit')
}

function goAnnouncements() {
  router.push('/m/announcements')
}

function goAccount() {
  router.push('/m/profile/account')
}

function goExtensions() {
  router.push('/m/extensions')
}

function goAbout() {
  router.push('/m/profile/about')
}

function goLogs() {
  router.push('/m/logs')
}

async function doLogout() {
  showLogoutConfirm.value = false
  const identityScope = tenantIdentityScope()
  await clearIdentityCache(identityScope)
  clearTenantSession()
  router.push('/login')
}
</script>

<template>
  <section class="me-page">
    <!-- 用户信息卡片 -->
    <div class="me-header">
      <div class="me-avatar">
        <img v-if="user?.avatarUrl" :src="user.avatarUrl" alt="头像" />
        <span v-else>{{ (user?.displayName || user?.username || '?').slice(0, 1).toUpperCase() }}</span>
      </div>
      <div class="me-user-info">
        <div class="me-name">{{ user?.displayName || user?.username || '未登录' }}</div>
        <div class="me-meta">
          <span class="me-role">{{ roleLabel }}</span>
          <span v-if="tenant?.name" class="me-tenant">· {{ tenant.name }}</span>
        </div>
      </div>
    </div>

    <!-- 功能列表 -->
    <div class="me-menu">
      <button class="me-menu-item" @click="goProfileEdit">
        <span class="me-menu-icon">👤</span>
        <span class="me-menu-label">资料管理</span>
        <span class="me-menu-arrow">›</span>
      </button>
      <button class="me-menu-item" @click="goAnnouncements">
        <span class="me-menu-icon">📢</span>
        <span class="me-menu-label">系统公告</span>
        <span class="me-menu-arrow">›</span>
      </button>
      <button v-if="user?.role === 'owner'" class="me-menu-item" @click="goAccount">
        <span class="me-menu-icon">◇</span>
        <span class="me-menu-label">企业套餐与用量</span>
        <span class="me-menu-arrow">›</span>
      </button>
      <button v-if="['owner', 'admin'].includes(user?.role)" class="me-menu-item" @click="goExtensions">
        <span class="me-menu-icon">▦</span>
        <span class="me-menu-label">扩展应用</span>
        <span class="me-menu-arrow">›</span>
      </button>
      <button class="me-menu-item" @click="goLogs">
        <span class="me-menu-icon">🕓</span>
        <span class="me-menu-label">操作日志</span>
        <span class="me-menu-arrow">›</span>
      </button>
      <button class="me-menu-item" @click="goAbout">
        <span class="me-menu-icon">ⓘ</span>
        <span class="me-menu-label">关于软件</span>
        <span class="me-menu-arrow">›</span>
      </button>
    </div>

    <!-- 退出登录 -->
    <div class="me-logout-wrap">
      <button class="me-logout" @click="showLogoutConfirm = true">退出登录</button>
    </div>

    <!-- 退出确认 -->
    <div v-if="showLogoutConfirm" class="me-modal-mask" @click.self="showLogoutConfirm = false">
      <div class="me-modal">
        <div class="me-modal-title">退出登录</div>
        <div class="me-modal-message">确认退出当前账号吗？退出后需要重新登录。</div>
        <div class="me-modal-actions">
          <button class="me-modal-cancel" @click="showLogoutConfirm = false">取消</button>
          <button class="me-modal-confirm" @click="doLogout">确认退出</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.me-page { min-height: 100%; padding: 16px 14px 32px; background: #f5f6f8; }

.me-header {
  display: flex; align-items: center; gap: 14px;
  padding: 20px 18px; border-radius: 16px;
  background: linear-gradient(135deg, #2563eb, #0f3f91);
  color: #fff; box-shadow: 0 8px 24px rgba(37,99,235,.2);
}
.me-avatar {
  width: 56px; height: 56px; border-radius: 50%;
  background: rgba(255,255,255,.2);
  display: flex; align-items: center; justify-content: center;
  font-size: 24px; font-weight: 700; flex-shrink: 0;
  overflow: hidden;
}
.me-avatar img { width: 100%; height: 100%; object-fit: cover; }
.me-user-info { flex: 1; min-width: 0; }
.me-name { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
.me-meta { font-size: 13px; opacity: .85; }
.me-role { background: rgba(255,255,255,.2); padding: 2px 8px; border-radius: 4px; font-size: 11px; }

.me-menu { margin-top: 14px; background: #fff; border-radius: 14px; overflow: hidden; }
.me-menu-item {
  display: flex; align-items: center; gap: 12px;
  width: 100%; padding: 16px 16px; border: none; background: none;
  font-size: 15px; color: #0f172a; text-align: left;
  border-bottom: 1px solid #f1f5f9;
}
.me-menu-item:last-child { border-bottom: none; }
.me-menu-item:active { background: #f8fafc; }
.me-menu-icon { font-size: 20px; width: 28px; text-align: center; }
.me-menu-label { flex: 1; }
.me-menu-arrow { color: #94a3b8; font-size: 20px; }

.me-logout-wrap { margin-top: 28px; }
.me-logout {
  width: 100%; padding: 14px; border: none; border-radius: 14px;
  background: #fff; color: #dc2626; font-size: 15px; font-weight: 600;
}
.me-logout:active { background: #fef2f2; }

.me-modal-mask {
  position: fixed; inset: 0; background: rgba(15,23,42,.4);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.me-modal {
  width: 280px; background: #fff; border-radius: 14px; padding: 24px 20px;
}
.me-modal-title { font-size: 16px; font-weight: 600; text-align: center; margin-bottom: 10px; }
.me-modal-message { font-size: 14px; color: #64748b; text-align: center; line-height: 1.6; margin-bottom: 20px; }
.me-modal-actions { display: flex; gap: 12px; }
.me-modal-cancel, .me-modal-confirm {
  flex: 1; padding: 10px; border-radius: 8px; border: none; font-size: 14px; font-weight: 600;
}
.me-modal-cancel { background: #f1f5f9; color: #475569; }
.me-modal-confirm { background: #dc2626; color: #fff; }
</style>
