<!-- 忆梦云团队开发 - 管理员登录 -->
<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

const router = useRouter()
const username = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref('')

async function login() {
  if (loading.value) return
  errorMsg.value = ''
  if (!username.value.trim() || !password.value) {
    errorMsg.value = '请输入账号和密码'
    return
  }
  loading.value = true
  try {
    const res = await api.post('/admin/auth/login', {
      username: username.value.trim(),
      password: password.value,
    })
    if (res.code !== 0) throw new Error(res.message || '登录失败')
    localStorage.setItem('admin_token', res.data.token)
    localStorage.setItem('admin_info', JSON.stringify(res.data.admin))
    router.replace('/dashboard')
  } catch (error) {
    errorMsg.value = error?.message || '网络错误'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="login-box">
      <div class="login-brand">
        <div class="logo">Y</div>
        <h1>忆梦云客服</h1>
        <p class="sub">平台管理后台 · 请登录</p>
      </div>

      <div class="input-group">
        <label for="u">管理员账号</label>
        <input
          id="u"
          v-model="username"
          class="input"
          type="text"
          placeholder="请输入账号"
          autocomplete="username"
          :disabled="loading"
          @keydown.enter.prevent="login"
        />
      </div>

      <div class="input-group">
        <label for="p">登录密码</label>
        <input
          id="p"
          v-model="password"
          class="input"
          :class="{ error: errorMsg }"
          type="password"
          placeholder="请输入密码"
          autocomplete="current-password"
          :disabled="loading"
          @keydown.enter.prevent="login"
        />
      </div>

      <div v-if="errorMsg" class="toast error login-error" role="alert">
        <div class="toast-title">登录失败</div>
        <div class="toast-msg">{{ errorMsg }}</div>
      </div>

      <button
        class="btn btn-primary btn-lg login-submit"
        :disabled="loading"
        @click="login"
      >
        {{ loading ? '登录中...' : '登 录' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.captcha-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 120px;
  gap: 10px;
}

.captcha-image {
  width: 120px;
  height: 42px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: #f1f5f9;
  color: var(--text-muted);
  font-size: 12px;
  transition: border-color .18s ease, box-shadow .18s ease;
}

.captcha-image:hover:not(:disabled),
.captcha-image:focus-visible {
  border-color: var(--primary);
  outline: none;
  box-shadow: 0 0 0 3px var(--primary-ring);
}

.captcha-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.captcha-status {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 42px;
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: #f8fafc;
  color: var(--text-sec);
  font-size: 13px;
}

.captcha-status-icon {
  width: 9px;
  height: 9px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--warning);
  box-shadow: 0 0 0 3px var(--warning-soft);
}

.captcha-status-icon.ready {
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft);
}

.login-error {
  position: static;
  margin-bottom: 14px;
  animation: none;
}

.login-submit { width: 100%; }
.login-tip { margin-top: 18px; color: #94a3b8; font-size: 12px; text-align: center; }

@media (max-width: 390px) {
  .captcha-row { grid-template-columns: minmax(0, 1fr) 108px; }
  .captcha-image { width: 108px; }
}
</style>
