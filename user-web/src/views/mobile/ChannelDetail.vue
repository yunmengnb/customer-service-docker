<!-- 忆梦云团队开发 - 手机端渠道详情独立视图 -->
<script setup>
import { readTenantCache } from '../../api'
import { ref, onMounted, reactive, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../../api'
import { buildCustomerServiceUrl, buildCustomerServiceWidgetCode, copyText } from '../../clipboard'
import ConfirmDialog from '../../components/ConfirmDialog.vue'

const props = defineProps({ channelId: String, embedded: Boolean })
const emit = defineEmits(['close', 'saved'])
const route = useRoute()
const routePrefix = '/m'
const currentChannelId = computed(() => props.channelId || route.params.id)
const user = readTenantCache('tenant_user')
const isAdmin = computed(() => ['owner', 'admin'].includes(user?.role))
const channel = ref(null)
const loading = ref(true)
const loadError = ref('')
const employees = ref([])
const selectedEmployeeIds = ref([])
const keywords = ref([])
const quickReplies = ref([])
const deleteTarget = ref(null)

// 基础信息表单
const form = reactive({
  brandName: '', brandColor: '#2563eb', avatarUrl: '', welcomeMessage: '', welcomeImageUrl: '', welcomeImageName: '', offlineMessage: '',
})
const uploadingAvatar = ref(false)
const uploadingReplyImage = ref(false)

// 关键词弹窗
const krModal = reactive({ show: false, editing: null, form: { keyword: '', matchType: 'contains', replyContent: '', imageUrl: '', imageName: '', priority: 0 } })
// 快捷回复弹窗
const qrModal = reactive({ show: false, editing: null, form: { title: '', content: '', imageUrl: '', imageName: '', sortOrder: 0 } })

async function load() {
  const channelId = currentChannelId.value
  loading.value = true
  loadError.value = ''
  try {
    const requests = [
      api.get(`/tenant/channels/${channelId}`),
      api.get(`/tenant/channels/${channelId}/keywords`),
      api.get(`/tenant/channels/${channelId}/quick-replies`),
    ]
    if (isAdmin.value) requests.push(api.get('/tenant/employees'))
    const [res, kr, qr, employeeRes] = await Promise.all(requests)
    if (res.code !== 0) throw new Error(res.message || '渠道配置加载失败')
    channel.value = res.data
    Object.assign(form, {
      brandName: res.data.brandName,
      brandColor: res.data.brandColor,
      avatarUrl: res.data.avatarUrl || '',
      welcomeMessage: res.data.welcomeMessage,
      welcomeImageUrl: res.data.welcomeImageUrl || '',
      welcomeImageName: res.data.welcomeImageName || '',
      offlineMessage: res.data.offlineMessage,
      status: res.data.status,
    })
    selectedEmployeeIds.value = (res.data.employees || []).map(employee => employee.id)
    if (kr.code !== 0) throw new Error(kr.message || '关键词回复加载失败')
    if (qr.code !== 0) throw new Error(qr.message || '快捷回复加载失败')
    keywords.value = kr.data || []
    quickReplies.value = qr.data || []
    if (employeeRes) {
      if (employeeRes.code !== 0) throw new Error(employeeRes.message || '接待人加载失败')
      employees.value = (employeeRes.data || []).filter(employee => employee.status === 'active')
    }
  } catch (error) {
    channel.value = null
    loadError.value = error?.message || '渠道配置加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

async function saveEmployees() {
  const res = await api.put(`/tenant/channels/${currentChannelId.value}/employees`, {
    employeeIds: selectedEmployeeIds.value,
  })
  if (res.code === 0) { alert('接待人已保存'); await load() }
  else alert(res.message)
}

async function saveBasic() {
  const res = await api.patch(`/tenant/channels/${currentChannelId.value}`, form)
  if (res.code === 0) { alert('已保存'); await load(); emit('saved') }
  else alert(res.message)
}

async function removeAvatar() {
  try {
    const res = await api.patch(`/tenant/channels/${currentChannelId.value}`, { avatarUrl: '' })
    if (res.code === 0) {
      form.avatarUrl = ''
      channel.value.avatarUrl = ''
      emit('saved')
      alert('渠道头像已移除')
    } else {
      alert(res.message || '移除失败')
    }
  } catch (e) {
    alert(e?.message || '移除失败')
  }
}

async function uploadAvatar(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) { alert('请选择图片文件'); return }
  uploadingAvatar.value = true
  try {
    const data = new FormData()
    data.append('file', file)
    const res = await api.upload('/upload/tenant', data)
    if (res.code !== 0) {
      alert(res.message)
      return
    }
    const saveRes = await api.patch(`/tenant/channels/${currentChannelId.value}`, {
      avatarUrl: res.data.url,
    })
    if (saveRes.code === 0) {
      form.avatarUrl = saveRes.data.avatarUrl
      channel.value.avatarUrl = saveRes.data.avatarUrl
      emit('saved')
      alert('渠道头像已保存')
    } else {
      alert(saveRes.message || '渠道头像保存失败')
    }
  } catch (e) {
    alert(e?.message || '头像上传失败')
  } finally {
    uploadingAvatar.value = false
  }
}

async function uploadReplyImage(event, target) {
  const isWelcome = target === 'welcome'
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) { alert('请选择图片文件'); return }
  uploadingReplyImage.value = true
  try {
    const data = new FormData()
    data.append('file', file)
    const res = await api.upload('/upload/tenant', data)
    if (res.code !== 0) throw new Error(res.message || '上传失败')
    if (isWelcome) {
      form.welcomeImageUrl = res.data.url
      form.welcomeImageName = res.data.name || file.name
      return
    }
    target.imageUrl = res.data.url
    target.imageName = res.data.name || file.name
  } catch (e) { alert(e?.message || '图片上传失败') }
  finally { uploadingReplyImage.value = false }
}

function openKr(kr = null) {
  krModal.show = true
  krModal.editing = kr
  krModal.form = kr ? { keyword: kr.keyword, matchType: kr.matchType, replyContent: kr.replyContent || '', imageUrl: kr.imageUrl || '', imageName: kr.imageName || '', priority: kr.priority, status: kr.status } : { keyword: '', matchType: 'contains', replyContent: '', imageUrl: '', imageName: '', priority: 0, status: 'active' }
}

async function saveKr() {
  const f = krModal.form
  if (!f.keyword || (!f.replyContent?.trim() && !f.imageUrl)) { alert('关键词不能为空，回复内容和图片至少填写一项'); return }
  const res = krModal.editing
    ? await api.patch(`/tenant/channels/${currentChannelId.value}/keywords/${krModal.editing._id}`, f)
    : await api.post(`/tenant/channels/${currentChannelId.value}/keywords`, f)
  if (res.code === 0) { krModal.show = false; await load() }
  else alert(res.message)
}

async function delKr(kr) {
  deleteTarget.value = { type: 'keyword', item: kr }
}

function openQr(qr = null) {
  qrModal.show = true
  qrModal.editing = qr
  qrModal.form = qr ? { title: qr.title, content: qr.content || '', imageUrl: qr.imageUrl || '', imageName: qr.imageName || '', sortOrder: qr.sortOrder } : { title: '', content: '', imageUrl: '', imageName: '', sortOrder: 0 }
}

async function saveQr() {
  const f = qrModal.form
  if (!f.title || (!f.content?.trim() && !f.imageUrl)) { alert('标题不能为空，内容和图片至少填写一项'); return }
  const res = qrModal.editing
    ? await api.patch(`/tenant/channels/${currentChannelId.value}/quick-replies/${qrModal.editing._id}`, f)
    : await api.post(`/tenant/channels/${currentChannelId.value}/quick-replies`, f)
  if (res.code === 0) { qrModal.show = false; await load() }
  else alert(res.message)
}

async function delQr(qr) {
  deleteTarget.value = { type: 'quickReply', item: qr }
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target) return
  const resource = target.type === 'keyword' ? 'keywords' : 'quick-replies'
  await api.delete(`/tenant/channels/${currentChannelId.value}/${resource}/${target.item._id}`)
  deleteTarget.value = null
  await load()
}

async function copyLink() {
  const url = buildCustomerServiceUrl(channel.value.link)
  try {
    await copyText(url)
    alert('客服链接已复制:\n' + url)
  } catch {
    window.prompt('自动复制失败，请长按链接并选择复制', url)
  }
}

const widgetCode = computed(() => channel.value
  ? buildCustomerServiceWidgetCode(channel.value.link, {
      avatar: channel.value.avatarUrl,
      color: channel.value.brandColor,
    })
  : '')

async function copyWidgetCode() {
  try {
    await copyText(widgetCode.value)
    alert('网站嵌入代码已复制')
  } catch {
    window.prompt('自动复制失败，请长按代码并选择复制', widgetCode.value)
  }
}

onMounted(load)
</script>

<template>
  <div v-if="loading" class="detail-state">正在加载渠道配置...</div>
  <div v-else-if="loadError" class="detail-state error-state">
    <strong>配置加载失败</strong>
    <span>{{ loadError }}</span>
    <button class="action-btn" @click="load">重新加载</button>
    <router-link :to="`${routePrefix}/channels`">返回渠道列表</router-link>
  </div>
  <div v-else-if="channel" :class="['detail-page', { embedded }]">
    <nav class="mobile-nav">
      <button v-if="embedded" type="button" class="back-link" @click="emit('close')">返回</button>
      <router-link v-else class="back-link" :to="`${routePrefix}/channels`">返回</router-link>
      <strong>渠道配置</strong><span></span>
    </nav>

    <header class="config-hero">
      <div class="hero-avatar" :style="{ background: form.brandColor }"><img v-if="form.avatarUrl" :src="form.avatarUrl" alt="渠道头像" /><span v-else>{{ (form.brandName || channel.name || '渠').slice(0, 1) }}</span></div>
      <div><span>授权渠道</span><h1>{{ channel.name }}</h1><p>{{ form.brandName || '未设置品牌名' }} · {{ channel.status === 'online' ? '在线服务' : '离线状态' }}</p></div>
    </header>

    <section class="detail-section overview-section">
      <div class="section-heading"><span>01</span><div><h3>渠道概览</h3><p>渠道身份与客户访问入口</p></div></div>
      <div class="info-item"><span>渠道名称</span><strong>{{ channel.name }}</strong></div>
      <div class="link-item"><span>客服链接</span><code>{{ channel.link }}</code><button class="action-btn" @click="copyLink">复制</button></div>
      <div class="link-item widget-item"><span>网站客服挂件</span><code>{{ widgetCode }}</code><button class="action-btn" @click="copyWidgetCode">复制代码</button></div>
    </section>

    <section class="detail-section brand-section">
      <div class="section-heading"><span>02</span><div><h3>品牌与消息</h3><p>客户看到的品牌形象和提示内容</p></div></div>
      <div class="form-group"><label>品牌名</label><input v-model="form.brandName" /></div>
      <div class="form-group">
        <label>渠道头像</label>
        <div class="avatar-upload">
          <img v-if="form.avatarUrl" :src="form.avatarUrl" alt="渠道头像" />
          <span v-else>{{ form.brandName?.[0] || '客' }}</span>
          <label class="action-btn upload-button">
            {{ uploadingAvatar ? '上传中...' : '上传图片' }}
            <input type="file" accept="image/*" :disabled="uploadingAvatar" @change="uploadAvatar" />
          </label>
          <button v-if="form.avatarUrl" class="action-btn" @click="removeAvatar">移除</button>
        </div>
      </div>
      <div class="form-group"><label>品牌色</label><input type="color" v-model="form.brandColor" style="width:80px;height:36px;padding:2px;" /></div>
      <div class="form-group"><label>欢迎词（客户首次进入自动发送）</label><textarea v-model="form.welcomeMessage" placeholder="文字和图片至少填写一项"></textarea></div>
      <div class="form-group">
        <label>欢迎语图片</label>
        <div class="reply-image-editor">
          <img v-if="form.welcomeImageUrl" :src="form.welcomeImageUrl" alt="欢迎语图片预览" />
          <label class="action-btn upload-button">{{ uploadingReplyImage ? '上传中...' : '上传图片' }}<input type="file" accept="image/*" :disabled="uploadingReplyImage" @change="uploadReplyImage($event, 'welcome')" /></label>
          <button v-if="form.welcomeImageUrl" class="action-btn" @click="form.welcomeImageUrl = ''; form.welcomeImageName = ''">移除</button>
        </div>
      </div>
      <div class="form-group"><label>离线提示</label><textarea v-model="form.offlineMessage"></textarea></div>
      <div class="section-actions"><button class="btn-primary" @click="saveBasic">保存品牌设置</button></div>
    </section>

    <section v-if="isAdmin" class="detail-section employee-section">
      <div class="section-heading"><span>03</span><div><h3>接待人员</h3><p>选择可处理该渠道会话的员工</p></div></div>
      <div class="employee-options">
        <label v-for="employee in employees" :key="employee._id">
          <input v-model="selectedEmployeeIds" type="checkbox" :value="employee._id" />
          <span><strong>{{ employee.displayName }}</strong><small>{{ employee.username }}{{ employee._id === user?._id ? ' · 我' : '' }}</small></span>
        </label>
        <span v-if="employees.length === 0" class="empty-inline">暂无可选接待人</span>
      </div>
      <div class="section-actions"><button class="btn-primary" @click="saveEmployees">保存接待人员</button></div>
    </section>

    <section class="detail-section">
      <div class="section-heading heading-actions"><span>{{ isAdmin ? '04' : '03' }}</span><div><h3>关键词回复</h3><p>客户消息命中关键词时自动响应</p></div><button class="btn-primary" @click="openKr()">新增</button></div>
      <div v-if="keywords.length" class="reply-list">
        <article v-for="kr in keywords" :key="kr._id" class="reply-card">
          <div class="reply-card-title">
            <strong>{{ kr.keyword }}</strong>
            <span class="scope-label">{{ kr.matchType === 'exact' ? '精确匹配' : '包含匹配' }}</span>
            <span :class="['status-label', kr.status === 'active' ? 'active' : 'disabled']">{{ kr.status === 'active' ? '启用' : '停用' }}</span>
          </div>
          <div class="reply-cell"><img v-if="kr.imageUrl" :src="kr.imageUrl" alt="附图" /><span>{{ kr.replyContent || '仅图片' }}</span></div>
          <div class="reply-card-footer"><span>优先级 {{ kr.priority }}</span><div><button class="action-btn" @click="openKr(kr)">编辑</button><button class="action-btn danger" @click="delKr(kr)">删除</button></div></div>
        </article>
      </div>
      <div v-else class="empty-state">暂无关键词</div>
    </section>

    <section class="detail-section">
      <div class="section-heading heading-actions"><span>{{ isAdmin ? '05' : '04' }}</span><div><h3>快捷回复</h3><p>员工聊天时可快速插入常用内容</p></div><button class="btn-primary" @click="openQr()">新增</button></div>
      <div v-if="quickReplies.length" class="reply-list">
        <article v-for="qr in quickReplies" :key="qr._id" class="reply-card">
          <div class="reply-card-title">
            <strong>{{ qr.title }}</strong>
            <span class="scope-label">{{ qr.channelId ? '本渠道' : '通用' }}</span>
            <span :class="['status-label', qr.status === 'active' ? 'active' : 'disabled']">{{ qr.status === 'active' ? '启用' : '停用' }}</span>
          </div>
          <div class="reply-cell"><img v-if="qr.imageUrl" :src="qr.imageUrl" alt="附图" /><span>{{ qr.content || '仅图片' }}</span></div>
          <div class="reply-card-footer">
            <span>排序 {{ qr.sortOrder }}</span>
            <div v-if="qr.channelId"><button class="action-btn" @click="openQr(qr)">编辑</button><button class="action-btn danger" @click="delQr(qr)">删除</button></div>
            <small v-else>通用回复在所有渠道中可用</small>
          </div>
        </article>
      </div>
      <div v-else class="empty-state">暂无快捷回复</div>
    </section>

    <!-- 关键词弹窗 -->
    <div v-if="krModal.show" class="modal-overlay" @click.self="krModal.show = false">
      <div class="modal-box">
        <h3>{{ krModal.editing ? '编辑' : '新增' }}关键词回复</h3>
        <div class="form-group"><label>关键词</label><input v-model="krModal.form.keyword" /></div>
        <div class="form-group">
          <label>匹配方式</label>
          <select v-model="krModal.form.matchType">
            <option value="contains">包含匹配</option>
            <option value="exact">精确匹配</option>
          </select>
        </div>
        <div class="form-group"><label>回复内容</label><textarea v-model="krModal.form.replyContent" placeholder="文字和图片至少填写一项"></textarea></div>
        <div class="form-group"><label>回复图片</label><div class="reply-image-editor"><img v-if="krModal.form.imageUrl" :src="krModal.form.imageUrl" alt="回复图片预览" /><label class="action-btn upload-button">{{ uploadingReplyImage ? '上传中...' : '上传图片' }}<input type="file" accept="image/*" :disabled="uploadingReplyImage" @change="uploadReplyImage($event, krModal.form)" /></label><button v-if="krModal.form.imageUrl" class="action-btn" @click="krModal.form.imageUrl = ''; krModal.form.imageName = ''">移除</button></div></div>
        <div class="form-group"><label>优先级（数值越大越优先）</label><input type="number" v-model.number="krModal.form.priority" /></div>
        <div class="form-group"><label>状态</label><select v-model="krModal.form.status"><option value="active">启用</option><option value="disabled">停用</option></select></div>
        <div class="modal-footer">
          <button class="btn-ghost" @click="krModal.show = false">取消</button>
          <button class="btn-primary" @click="saveKr">保存</button>
        </div>
      </div>
    </div>

    <!-- 快捷回复弹窗 -->
    <div v-if="qrModal.show" class="modal-overlay" @click.self="qrModal.show = false">
      <div class="modal-box">
        <h3>{{ qrModal.editing ? '编辑' : '新增' }}快捷回复</h3>
        <div class="form-group"><label>标题</label><input v-model="qrModal.form.title" /></div>
        <div class="form-group"><label>内容</label><textarea v-model="qrModal.form.content" placeholder="文字和图片至少填写一项"></textarea></div>
        <div class="form-group"><label>回复图片</label><div class="reply-image-editor"><img v-if="qrModal.form.imageUrl" :src="qrModal.form.imageUrl" alt="回复图片预览" /><label class="action-btn upload-button">{{ uploadingReplyImage ? '上传中...' : '上传图片' }}<input type="file" accept="image/*" :disabled="uploadingReplyImage" @change="uploadReplyImage($event, qrModal.form)" /></label><button v-if="qrModal.form.imageUrl" class="action-btn" @click="qrModal.form.imageUrl = ''; qrModal.form.imageName = ''">移除</button></div></div>
        <div class="form-group"><label>排序</label><input type="number" v-model.number="qrModal.form.sortOrder" /></div>
        <div class="modal-footer">
          <button class="btn-ghost" @click="qrModal.show = false">取消</button>
          <button class="btn-primary" @click="saveQr">保存</button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :open="!!deleteTarget"
      :title="deleteTarget?.type === 'keyword' ? '删除关键词回复' : '删除快捷回复'"
      message="确认删除该条配置吗？此操作无法撤销。"
      confirm-text="确认删除"
      danger
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
    />
  </div>
</template>

<style scoped>
.detail-page { width: 100%; height: 100vh; height: 100dvh; min-width: 0; min-height: 0; padding: 0 14px max(28px, env(safe-area-inset-bottom)); overflow-x: hidden; overflow-y: auto; overscroll-behavior-y: contain; -webkit-overflow-scrolling: touch; background: #f4f7fb; color: #172033; }
.detail-page.embedded { border: 0; border-radius: 0; }
.mobile-nav { position: sticky; top: 0; z-index: 6; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; margin: 0 -14px 14px; padding: max(12px, env(safe-area-inset-top)) 14px 11px; border-bottom: 1px solid #e6eaf0; background: rgba(255,255,255,.96); backdrop-filter: blur(14px); }
.mobile-nav strong { font-size: 15px; text-align: center; }
.back-link { width: max-content; padding: 4px 0; border: 0; color: #2563eb; background: transparent; font-size: 13px; text-decoration: none; cursor: pointer; }
.config-hero { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; padding: 18px; overflow: hidden; border-radius: 18px; background: linear-gradient(135deg, #17366f 0%, #2563eb 72%, #60a5fa 100%); color: #fff; box-shadow: 0 12px 28px rgba(37, 99, 235, .18); }
.hero-avatar { width: 52px; height: 52px; flex: 0 0 52px; display: grid; place-items: center; overflow: hidden; border: 2px solid rgba(255,255,255,.35); border-radius: 15px; font-weight: 700; }
.hero-avatar img { width: 100%; height: 100%; object-fit: cover; }
.config-hero > div:last-child { min-width: 0; }
.config-hero span { font-size: 10px; font-weight: 700; letter-spacing: .12em; opacity: .76; }
.config-hero h1 { margin: 3px 0; overflow: hidden; font-size: 20px; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
.config-hero p { margin: 0; font-size: 11px; opacity: .8; }
.detail-section { min-width: 0; margin-bottom: 14px; padding: 16px; border: 1px solid #e5eaf1; border-radius: 16px; background: #fff; box-shadow: 0 7px 20px rgba(15, 23, 42, .035); }
.section-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.section-heading > span { display: grid; width: 32px; height: 32px; flex: 0 0 32px; place-items: center; border-radius: 9px; background: #eaf2ff; color: #2563eb; font-size: 11px; font-weight: 800; }
.section-heading > div { min-width: 0; flex: 1; }
.section-heading h3 { margin: 0; font-size: 15px; }
.section-heading p { margin: 3px 0 0; color: #94a0b3; font-size: 10px; }
.heading-actions .btn-primary { padding: 7px 11px; border: 0; border-radius: 8px; font-size: 12px; }
.info-item, .link-item { min-width: 0; padding: 12px; border-radius: 11px; background: #f7f9fc; }
.info-item { display: grid; gap: 4px; margin-bottom: 9px; }
.info-item span, .link-item > span { color: #8b96a8; font-size: 10px; }
.info-item strong { font-size: 13px; }
.link-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 10px; align-items: center; }
.link-item > span { grid-column: 1 / -1; }
.link-item code { min-width: 0; overflow: hidden; color: #475569; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.widget-item { margin-top: 9px; }
.widget-item code { grid-column: 1 / -1; padding: 10px; overflow: visible; overflow-wrap: anywhere; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; line-height: 1.55; text-overflow: clip; white-space: pre-wrap; }
.widget-item .action-btn { grid-column: 1 / -1; justify-self: end; }
.avatar-upload { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.avatar-upload img, .avatar-upload > span { width: 52px; height: 52px; border-radius: 14px; object-fit: cover; display: flex; align-items: center; justify-content: center; background: #2563eb; color: #fff; font-weight: 600; }
.upload-button { cursor: pointer; }
.upload-button input { display: none; }
.employee-options { display: grid; gap: 9px; }
.employee-options label { display: flex; align-items: center; gap: 10px; padding: 11px; border: 1px solid #e5eaf1; border-radius: 10px; background: #f9fafc; }
.employee-options label > span { min-width: 0; display: grid; gap: 2px; }
.employee-options strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.employee-options small { overflow: hidden; color: #8b96a8; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.empty-inline { padding: 20px; color: #94a3b8; text-align: center; }
.section-actions { display: flex; justify-content: flex-end; margin-top: 16px; padding-top: 14px; border-top: 1px solid #edf0f5; }
.section-actions .btn-primary { padding: 9px 14px; border: 0; border-radius: 9px; }
.reply-image-editor { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
.reply-image-editor img { width: 96px; height: 72px; object-fit: cover; border: 1px solid #e2e8f0; border-radius: 8px; }
.reply-list { display: grid; gap: 10px; }
.reply-card { padding: 13px; border: 1px solid #e7ebf2; border-radius: 12px; background: #fbfcfe; }
.reply-card-title { display: flex; align-items: center; gap: 7px; }
.reply-card-title strong { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scope-label, .status-label { padding: 3px 7px; border-radius: 999px; font-size: 11px; }
.scope-label { color: #2563eb; background: #eaf2ff; }
.status-label.active { color: #15803d; background: #dcfce7; }
.status-label.disabled { color: #64748b; background: #eef2f6; }
.reply-cell { display: flex; align-items: center; gap: 9px; min-width: 0; margin-top: 10px; color: #475569; font-size: 13px; line-height: 1.5; }
.reply-cell span { min-width: 0; overflow-wrap: anywhere; }
.reply-cell img { width: 48px; height: 48px; flex: 0 0 48px; object-fit: cover; border-radius: 7px; }
.reply-card-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 11px; color: #94a3b8; font-size: 11px; }
.reply-card-footer > div { display: flex; gap: 6px; }
.reply-card-footer .action-btn { padding: 5px 9px; }
.empty-state { padding: 22px; color: #94a3b8; text-align: center; }
.detail-state { min-height: 100dvh; display: grid; place-content: center; justify-items: center; gap: 10px; padding: 24px; color: #64748b; background: #f5f7fb; text-align: center; }
.error-state strong { color: #b91c1c; }
.error-state .action-btn { padding: 8px 16px; }
.modal-box { width: calc(100vw - 28px); max-height: calc(100dvh - 28px); overflow-y: auto; }
</style>