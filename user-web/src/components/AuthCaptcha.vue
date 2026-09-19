<!-- 忆梦云团队开发 - 租户认证统一验证码组件 -->
<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import api from '../api'

const emit = defineEmits(['submit'])

const loading = ref(true)
const loadError = ref('')
const config = ref({ enabled: false })
const captchaCode = ref('')
let geetest = null
let pendingVerification = null

const GEETEST_SCRIPT = 'https://static.geetest.com/static/tools/gt.js'

function loadGeetestScript() {
  if (window.initGeetest) return Promise.resolve()
  if (window.__tenantGeetestScriptPromise) return window.__tenantGeetestScriptPromise

  window.__tenantGeetestScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GEETEST_SCRIPT}"]`)
    const script = existing || document.createElement('script')
    const onLoad = () => window.initGeetest ? resolve() : reject(new Error('极验组件初始化失败'))
    const onError = () => reject(new Error('极验组件加载失败，请检查网络后重试'))
    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener('error', onError, { once: true })
    if (!existing) {
      script.src = GEETEST_SCRIPT
      script.async = true
      document.head.appendChild(script)
    }
  }).catch((error) => {
    delete window.__tenantGeetestScriptPromise
    throw error
  })

  return window.__tenantGeetestScriptPromise
}

async function initGeetest(captchaConfig) {
  const gt = captchaConfig.gt
  const challenge = captchaConfig.challenge
  if (!gt || !challenge) throw new Error('极验 V3 初始化参数不完整')

  await loadGeetestScript()
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('极验组件加载超时，请重试')), 10000)
    window.initGeetest({
      gt,
      challenge,
      offline: captchaConfig.success === false || captchaConfig.success === 0,
      new_captcha: captchaConfig.new_captcha ?? captchaConfig.newCaptcha ?? true,
      product: 'bind',
      width: '100%',
    }, (instance) => {
      geetest = instance
      instance.onReady(() => {
        clearTimeout(timeout)
        resolve()
      })
      instance.onSuccess(() => {
        const validation = instance.getValidate()
        if (!validation || !pendingVerification) return
        pendingVerification.resolve(validation)
        pendingVerification = null
      })
      instance.onClose(() => {
        if (!pendingVerification) return
        pendingVerification.reject(new Error('请完成极验验证'))
        pendingVerification = null
      })
      instance.onError(() => {
        clearTimeout(timeout)
        if (!pendingVerification) return
        pendingVerification.reject(new Error('极验验证失败，请重试'))
        pendingVerification = null
      })
    })
  })
}

async function loadCaptcha() {
  loading.value = true
  loadError.value = ''
  captchaCode.value = ''
  geetest?.destroy?.()
  geetest = null
  try {
    const response = await api.get('/tenant/auth/captcha')
    if (response.code !== 0) throw new Error(response.message || '验证码加载失败')
    config.value = response.data || { enabled: false }
    if (config.value.enabled && config.value.provider === 'geetest') {
      await initGeetest(config.value)
    }
  } catch (error) {
    config.value = { enabled: true }
    loadError.value = error?.message || '验证码加载失败'
  } finally {
    loading.value = false
  }
}

async function verify() {
  if (loading.value) throw new Error('验证码正在加载，请稍候')
  if (loadError.value) throw new Error(loadError.value)
  if (!config.value.enabled) return {}

  if (config.value.provider === 'image') {
    const value = captchaCode.value.trim()
    if (!value) throw new Error('请输入图形验证码')
    return { captchaId: config.value.captchaId, captchaCode: value }
  }

  if (config.value.provider === 'geetest') {
    if (!geetest) throw new Error('极验组件尚未就绪')
    if (pendingVerification) throw new Error('请先完成当前验证')
    return new Promise((resolve, reject) => {
      pendingVerification = { resolve, reject }
      geetest.verify()
    })
  }

  throw new Error('暂不支持当前验证码类型')
}

async function reset() {
  if (!config.value.enabled) return
  if (config.value.provider === 'image') {
    await loadCaptcha()
  } else {
    geetest?.reset?.()
  }
}

onMounted(loadCaptcha)
onBeforeUnmount(() => {
  pendingVerification?.reject(new Error('验证已取消'))
  pendingVerification = null
  geetest?.destroy?.()
})

defineExpose({ verify, reset })
</script>

<template>
  <div class="auth-captcha" aria-live="polite">
    <div v-if="loading" class="captcha-status">验证码加载中...</div>
    <div v-else-if="loadError" class="captcha-status captcha-error">
      <span>{{ loadError }}</span>
      <button type="button" class="captcha-retry" @click="loadCaptcha">重试</button>
    </div>
    <div v-else-if="config.enabled && config.provider === 'image'" class="image-captcha">
      <input
        v-model="captchaCode"
        aria-label="图形验证码"
        autocomplete="off"
        maxlength="12"
        placeholder="图形验证码"
        @keyup.enter="emit('submit')"
      />
      <button type="button" class="captcha-image-button" title="点击刷新验证码" @click="loadCaptcha">
        <img :src="config.image" alt="图形验证码，点击刷新" />
      </button>
    </div>
    <div v-else-if="config.enabled && config.provider === 'geetest'" class="captcha-status captcha-ready">
      提交后将进行极验安全验证
    </div>
  </div>
</template>
