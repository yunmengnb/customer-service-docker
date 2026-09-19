<!-- 忆梦云团队开发 - 桌面端渠道详情独立视图 -->
<script setup>
import { readTenantCache } from '../../api'
import { ref, onMounted, reactive, computed } from 'vue'
import { useRoute } from 'vue-router'
import api from '../../api'
import { buildCustomerServiceUrl, buildCustomerServiceWidgetCode, copyText } from '../../clipboard'
import ConfirmDialog from '../../components/ConfirmDialog.vue'

const props = defineProps({ channelId: String, embedded: Boolean })
const emit = defineEmits(['close', 'saved'])
const route = useRoute()
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
    if (kr.code !== 0) throw new Error(kr.message || '关键词回复加载失败')
    if (qr.code !== 0) throw new Error(qr.message || '快捷回复加载失败')

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
    if (target === 'welcome') {
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
    window.prompt('自动复制失败，请选择链接并手动复制', url)
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
    window.prompt('自动复制失败，请选择代码并手动复制', widgetCode.value)
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
    <button v-if="embedded" class="btn-ghost" @click="emit('close')">关闭配置</button>
    <router-link v-else to="/desktop/channels">返回渠道列表</router-link>
  </div>
  <div v-else-if="channel" class="detail-page" :class="{ embedded }">
    <header class="config-header">
      <div class="header-identity">
        <div class="channel-avatar" :style="{ background: form.brandColor }">
          <img v-if="form.avatarUrl" :src="form.avatarUrl" alt="渠道头像" />
          <span v-else>{{ (form.brandName || channel.name || '渠').slice(0, 1) }}</span>
        </div>
        <div>
          <span class="config-eyebrow">授权渠道配置</span>
          <h2>{{ channel.name }}</h2>
          <p>{{ form.brandName || '未设置品牌名' }} · {{ channel.status === 'online' ? '在线服务' : '离线状态' }}</p>
        </div>
      </div>
      <button v-if="embedded" type="button" class="config-close" aria-label="关闭配置" @click="emit('close')">关闭</button>
      <router-link v-else class="config-close" to="/desktop/channels">返回列表</router-link>
    </header>

    <main class="detail-content">
      <section class="detail-section overview-section">
        <div class="section-heading"><span class="section-index">01</span><div><h3>渠道概览</h3><p>渠道身份与客户访问入口</p></div></div>
        <div class="overview-grid">
          <div class="info-block"><span>渠道名称</span><strong>{{ channel.name }}</strong></div>
          <div class="info-block link-info"><span>客服链接</span><code>{{ channel.link }}</code><button class="action-btn" @click="copyLink">复制链接</button></div>
          <div class="info-block widget-info"><span>接入代码</span><code>{{ widgetCode }}</code><button class="action-btn" @click="copyWidgetCode">复制接入代码</button></div>
        </div>
      </section>

      <div class="settings-grid">
        <section class="detail-section brand-section">
          <div class="section-heading"><span class="section-index">02</span><div><h3>品牌与消息</h3><p>设置客户看到的品牌形象和提示内容</p></div></div>
          <div class="form-grid">
            <div class="form-group"><label>品牌名</label><input v-model="form.brandName" /></div>
            <div class="form-group"><label>品牌色</label><div class="color-field"><input type="color" v-model="form.brandColor" /><code>{{ form.brandColor }}</code></div></div>
          </div>
          <div class="form-group">
            <label>渠道头像</label>
            <div class="avatar-upload">
              <img v-if="form.avatarUrl" :src="form.avatarUrl" alt="渠道头像" />
              <span v-else :style="{ background: form.brandColor }">{{ form.brandName?.[0] || '客' }}</span>
              <label class="action-btn upload-button">{{ uploadingAvatar ? '上传中...' : '上传图片' }}<input type="file" accept="image/*" :disabled="uploadingAvatar" @change="uploadAvatar" /></label>
              <button v-if="form.avatarUrl" class="action-btn" @click="removeAvatar">移除</button>
            </div>
          </div>
          <div class="form-group">
            <label>欢迎词 <small>客户首次进入时自动发送</small></label>
            <textarea v-model="form.welcomeMessage" placeholder="文字和图片至少填写一项"></textarea>
            <div class="reply-image-editor">
              <img v-if="form.welcomeImageUrl" :src="form.welcomeImageUrl" alt="欢迎语图片预览" />
              <label class="action-btn upload-button">{{ uploadingReplyImage ? '上传中...' : '添加欢迎图片' }}<input type="file" accept="image/*" :disabled="uploadingReplyImage" @change="uploadReplyImage($event, 'welcome')" /></label>
              <button v-if="form.welcomeImageUrl" class="action-btn" @click="form.welcomeImageUrl = ''; form.welcomeImageName = ''">移除</button>
            </div>
          </div>
          <div class="form-group"><label>离线提示</label><textarea v-model="form.offlineMessage"></textarea></div>
          <div class="section-actions"><button class="btn-primary" @click="saveBasic">保存品牌设置</button></div>
        </section>

        <section v-if="isAdmin" class="detail-section employee-section">
          <div class="section-heading"><span class="section-index">03</span><div><h3>接待人员</h3><p>选择可处理该渠道会话的员工</p></div></div>
          <div class="employee-options">
            <label v-for="employee in employees" :key="employee._id">
              <input v-model="selectedEmployeeIds" type="checkbox" :value="employee._id" />
              <span><strong>{{ employee.displayName }}</strong><small>{{ employee.username }}{{ employee._id === user?._id ? ' · 我' : '' }}</small></span>
            </label>
            <span v-if="employees.length === 0" class="empty-inline">暂无可选接待人</span>
          </div>
          <div class="section-actions"><button class="btn-primary" @click="saveEmployees">保存接待人员</button></div>
        </section>
      </div>

      <section class="detail-section replies-section">
        <div class="section-heading heading-actions"><span class="section-index">{{ isAdmin ? '04' : '03' }}</span><div><h3>关键词回复</h3><p>客户消息命中关键词时自动响应</p></div><button class="btn-primary" @click="openKr()">新增关键词</button></div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>关键词</th><th>匹配方式</th><th>回复内容</th><th>优先级</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="kr in keywords" :key="kr._id">
                <td><strong>{{ kr.keyword }}</strong></td><td>{{ kr.matchType === 'exact' ? '精确匹配' : '包含匹配' }}</td>
                <td><div class="reply-cell"><img v-if="kr.imageUrl" :src="kr.imageUrl" alt="附图" /><span>{{ kr.replyContent || '仅图片' }}</span></div></td>
                <td>{{ kr.priority }}</td><td><span :class="['tag', kr.status === 'active' ? 'tag-green' : 'tag-gray']">{{ kr.status === 'active' ? '启用' : '停用' }}</span></td>
                <td class="row-actions"><button class="action-btn" @click="openKr(kr)">编辑</button><button class="action-btn danger" @click="delKr(kr)">删除</button></td>
              </tr>
              <tr v-if="keywords.length === 0"><td colspan="6" class="empty-cell">暂无关键词</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="detail-section replies-section">
        <div class="section-heading heading-actions"><span class="section-index">{{ isAdmin ? '05' : '04' }}</span><div><h3>快捷回复</h3><p>员工聊天时可快速插入常用内容</p></div><button class="btn-primary" @click="openQr()">新增回复</button></div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>标题</th><th>内容</th><th>排序</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="qr in quickReplies" :key="qr._id">
                <td><strong>{{ qr.title }}</strong></td><td><div class="reply-cell"><img v-if="qr.imageUrl" :src="qr.imageUrl" alt="附图" /><span>{{ qr.content || '仅图片' }}</span></div></td>
                <td>{{ qr.sortOrder }}</td><td class="row-actions"><button class="action-btn" @click="openQr(qr)">编辑</button><button class="action-btn danger" @click="delQr(qr)">删除</button></td>
              </tr>
              <tr v-if="quickReplies.length === 0"><td colspan="4" class="empty-cell">暂无快捷回复</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>

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
.detail-page { width: 100%; height: 100dvh; min-width: 0; min-height: 0; overflow-y: auto; overscroll-behavior-y: contain; background: #f4f7fb; color: #172033; }
.detail-page.embedded { height: 100%; border: 0; border-radius: 0; }
.config-header { position: sticky; top: 0; z-index: 8; display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 18px 28px; border-bottom: 1px solid #e5eaf1; background: rgba(255, 255, 255, .96); backdrop-filter: blur(16px); }
.header-identity { min-width: 0; display: flex; align-items: center; gap: 13px; }
.channel-avatar { width: 46px; height: 46px; flex: 0 0 46px; display: grid; place-items: center; overflow: hidden; border-radius: 14px; color: #fff; font-weight: 700; box-shadow: 0 7px 16px rgba(37, 99, 235, .18); }
.channel-avatar img { width: 100%; height: 100%; object-fit: cover; }
.config-header h2 { margin: 2px 0; overflow: hidden; color: #111827; font-size: 20px; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
.config-header p { margin: 0; color: #7c889d; font-size: 12px; }
.config-eyebrow { color: #2563eb; font-size: 10px; font-weight: 800; letter-spacing: .12em; }
.config-close { flex: 0 0 auto; padding: 9px 15px; border: 1px solid #dbe3ee; border-radius: 10px; background: #fff; color: #334155; font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; }
.config-close:hover { border-color: #93c5fd; color: #1d4ed8; background: #eff6ff; }
.detail-content { width: min(1180px, 100%); margin: 0 auto; padding: 24px 28px 34px; }
.detail-section { min-width: 0; margin-bottom: 18px; padding: 22px; border: 1px solid #e4e9f1; border-radius: 16px; background: #fff; box-shadow: 0 8px 24px rgba(15, 23, 42, .04); }
.section-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.section-heading h3 { margin: 0; padding: 0; border: 0; color: #172033; font-size: 16px; }
.section-heading p { margin: 3px 0 0; color: #94a0b3; font-size: 12px; }
.section-index { display: grid; width: 34px; height: 34px; flex: 0 0 34px; place-items: center; border-radius: 10px; background: #eaf2ff; color: #2563eb; font-size: 11px; font-weight: 800; }
.overview-section { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 24px; }
.overview-section .section-heading { margin: 0; align-self: center; }
.overview-grid { min-width: 0; display: grid; grid-template-columns: minmax(150px, .7fr) minmax(300px, 1.6fr); gap: 12px; }
.info-block { min-width: 0; display: grid; align-content: center; gap: 5px; padding: 14px 16px; border-radius: 12px; background: #f7f9fc; }
.widget-info { grid-column: 1 / -1; grid-template-columns: minmax(0, 1fr) auto; }
.widget-info > span { grid-column: 1 / -1; }
.widget-info code { min-width: 0; overflow: hidden; color: #475569; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.info-block > span { color: #8792a6; font-size: 11px; }
.info-block strong { font-size: 14px; }
.link-info { grid-template-columns: minmax(0, 1fr) auto; }
.link-info > span { grid-column: 1 / -1; }
.link-info code { min-width: 0; overflow: hidden; color: #475569; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.settings-grid { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(280px, .8fr); gap: 18px; align-items: start; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.form-group label small { margin-left: 6px; color: #94a0b3; font-weight: 400; }
.color-field { display: flex; align-items: center; gap: 10px; }
.color-field input { width: 58px; height: 40px; padding: 3px; }
.color-field code { color: #64748b; font-size: 12px; }
.avatar-upload { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.avatar-upload img, .avatar-upload > span { width: 56px; height: 56px; border-radius: 14px; object-fit: cover; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; }
.upload-button { cursor: pointer; }
.upload-button input { display: none; }
.employee-options { display: grid; gap: 9px; }
.employee-options label { display: flex; align-items: center; gap: 10px; padding: 11px 12px; border: 1px solid #e5eaf1; border-radius: 11px; background: #f9fafc; cursor: pointer; }
.employee-options label > span { min-width: 0; display: grid; gap: 2px; }
.employee-options strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.employee-options small { overflow: hidden; color: #8b96a8; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.empty-inline { padding: 24px 0; color: #94a3b8; text-align: center; }
.section-actions { display: flex; justify-content: flex-end; margin-top: 18px; padding-top: 16px; border-top: 1px solid #edf0f5; }
.section-actions .btn-primary, .heading-actions .btn-primary { padding: 8px 15px; border: 0; border-radius: 9px; cursor: pointer; }
.heading-actions > div { min-width: 0; flex: 1; }
.table-scroll { width: 100%; overflow-x: auto; }
.replies-section .data-table { min-width: 720px; }
.reply-image-editor { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
.reply-image-editor img { width: 96px; height: 72px; object-fit: cover; border: 1px solid #e2e8f0; border-radius: 10px; }
.reply-cell { min-width: 180px; max-width: 360px; display: flex; align-items: center; gap: 8px; }
.reply-cell span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reply-cell img { width: 44px; height: 44px; flex: 0 0 44px; object-fit: cover; border-radius: 8px; }
.row-actions { white-space: nowrap; }
.empty-cell { padding: 28px !important; color: #9ca3af; text-align: center; }
.detail-state { min-height: 100%; display: grid; place-content: center; justify-items: center; gap: 12px; padding: 36px; color: #64748b; background: #f8fafc; text-align: center; }
.error-state strong { color: #b91c1c; }
.detail-state .action-btn, .detail-state .btn-ghost { padding: 8px 14px; border: 1px solid #dbe3ee; border-radius: 8px; background: #fff; color: #2563eb; cursor: pointer; }
@media (max-width: 980px) {
  .overview-section { grid-template-columns: 1fr; }
  .settings-grid { grid-template-columns: 1fr; }
  .employee-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 720px) {
  .config-header, .detail-content { padding-right: 18px; padding-left: 18px; }
  .overview-grid, .form-grid, .employee-options { grid-template-columns: 1fr; }
}
</style>