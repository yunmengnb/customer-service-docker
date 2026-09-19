<!-- 忆梦云团队开发 - 渠道详情与配置 -->
<script setup>
import { ref, onMounted, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const route = useRoute()
const router = useRouter()
const channel = ref(null)
const employees = ref([])
const keywords = ref([])
const quickReplies = ref([])
const deleteTarget = ref(null)

// 基础信息表单
const form = reactive({
  brandName: '', brandColor: '#2563eb', welcomeMessage: '', offlineMessage: '', status: 'online',
})

// 关键词弹窗
const krModal = reactive({ show: false, editing: null, form: { keyword: '', matchType: 'contains', replyContent: '', priority: 0 } })
// 快捷回复弹窗
const qrModal = reactive({ show: false, editing: null, form: { title: '', content: '', sortOrder: 0 } })

async function load() {
  const res = await api.get(`/tenant/channels/${route.params.id}`)
  if (res.code === 0) {
    channel.value = res.data
    Object.assign(form, {
      brandName: res.data.brandName,
      brandColor: res.data.brandColor,
      welcomeMessage: res.data.welcomeMessage,
      offlineMessage: res.data.offlineMessage,
      status: res.data.status,
    })
    employees.value = res.data.employees || []
  }
  const kr = await api.get(`/tenant/channels/${route.params.id}/keywords`)
  if (kr.code === 0) keywords.value = kr.data
  
  const qr = await api.get(`/tenant/channels/${route.params.id}/quick-replies`)
  if (qr.code === 0) quickReplies.value = qr.data.filter(q => q.status === 'active')
}

async function saveBasic() {
  const res = await api.patch(`/tenant/channels/${route.params.id}`, form)
  if (res.code === 0) { alert('已保存'); await load() }
  else alert(res.message)
}

function openKr(kr = null) {
  krModal.show = true
  krModal.editing = kr
  krModal.form = kr ? { keyword: kr.keyword, matchType: kr.matchType, replyContent: kr.replyContent, priority: kr.priority } : { keyword: '', matchType: 'contains', replyContent: '', priority: 0 }
}

async function saveKr() {
  const f = krModal.form
  if (!f.keyword || !f.replyContent) { alert('关键词和回复内容不能为空'); return }
  const res = krModal.editing
    ? await api.patch(`/tenant/channels/${route.params.id}/keywords/${krModal.editing._id}`, f)
    : await api.post(`/tenant/channels/${route.params.id}/keywords`, f)
  if (res.code === 0) { krModal.show = false; await load() }
  else alert(res.message)
}

async function delKr(kr) {
  deleteTarget.value = { type: 'keyword', item: kr }
}

function openQr(qr = null) {
  qrModal.show = true
  qrModal.editing = qr
  qrModal.form = qr ? { title: qr.title, content: qr.content, sortOrder: qr.sortOrder } : { title: '', content: '', sortOrder: 0 }
}

async function saveQr() {
  const f = qrModal.form
  if (!f.title || !f.content) { alert('标题和内容不能为空'); return }
  const res = qrModal.editing
    ? await api.patch(`/tenant/channels/${route.params.id}/quick-replies/${qrModal.editing._id}`, f)
    : await api.post(`/tenant/channels/${route.params.id}/quick-replies`, f)
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
  await api.delete(`/tenant/channels/${route.params.id}/${resource}/${target.item._id}`)
  deleteTarget.value = null
  await load()
}

function copyLink() {
  const host = window.location.hostname
  const url = `${window.location.protocol}//${host}:5176${channel.value.link}`
  const doCopy = (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text)
    }
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy'); document.body.removeChild(ta); resolve() }
      catch (e) { document.body.removeChild(ta); reject(e) }
    })
  }
  doCopy(url).then(
    () => alert('客服链接已复制:\n' + url),
    () => alert('复制失败，请手动复制:\n' + url)
  )
}

onMounted(load)
</script>

<template>
  <div class="detail-page" v-if="channel">
    <router-link class="back-link" :to="`${routePrefix}/channels`">← 返回渠道列表</router-link>
    
    <div class="detail-section">
      <h3>基础配置</h3>
      <div class="kv-row"><span class="label">渠道名称</span><span class="value">{{ channel.name }}</span></div>
      <div class="kv-row"><span class="label">客服链接</span>
        <span class="value">
          <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:12px;">{{ channel.link }}</code>
          <button class="action-btn" style="margin-left:10px;" @click="copyLink">复制链接</button>
        </span>
      </div>
    </div>
    
    <div class="detail-section">
      <h3>品牌与消息</h3>
      <div class="form-group"><label>品牌名</label><input v-model="form.brandName" /></div>
      <div class="form-group"><label>品牌色</label><input type="color" v-model="form.brandColor" style="width:80px;height:36px;padding:2px;" /></div>
      <div class="form-group"><label>欢迎词（客户首次进入自动发送）</label><textarea v-model="form.welcomeMessage"></textarea></div>
      <div class="form-group"><label>离线提示</label><textarea v-model="form.offlineMessage"></textarea></div>
      <button class="btn-primary" style="padding:8px 20px;border:none;border-radius:6px;cursor:pointer;" @click="saveBasic">保存</button>
    </div>
    
    <div class="detail-section">
      <h3 style="display:flex;justify-content:space-between;align-items:center;">
        <span>关键词回复</span>
        <button class="btn-primary" style="padding:6px 14px;border:none;border-radius:6px;cursor:pointer;font-size:13px;" @click="openKr()">+ 新增</button>
      </h3>
      <table class="data-table">
        <thead><tr><th>关键词</th><th>匹配方式</th><th>回复内容</th><th>优先级</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="kr in keywords" :key="kr._id">
            <td>{{ kr.keyword }}</td>
            <td>{{ kr.matchType === 'exact' ? '精确匹配' : '包含匹配' }}</td>
            <td style="max-width:300px;">{{ kr.replyContent }}</td>
            <td>{{ kr.priority }}</td>
            <td>
              <button class="action-btn" @click="openKr(kr)">编辑</button>
              <button class="action-btn danger" @click="delKr(kr)">删除</button>
            </td>
          </tr>
          <tr v-if="keywords.length === 0"><td colspan="5" style="text-align:center;color:#9ca3af;padding:24px;">暂无关键词</td></tr>
        </tbody>
      </table>
    </div>
    
    <div class="detail-section">
      <h3 style="display:flex;justify-content:space-between;align-items:center;">
        <span>快捷回复（员工聊天时可快速插入）</span>
        <button class="btn-primary" style="padding:6px 14px;border:none;border-radius:6px;cursor:pointer;font-size:13px;" @click="openQr()">+ 新增</button>
      </h3>
      <table class="data-table">
        <thead><tr><th>标题</th><th>内容</th><th>排序</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="qr in quickReplies" :key="qr._id">
            <td>{{ qr.title }}</td>
            <td style="max-width:350px;">{{ qr.content }}</td>
            <td>{{ qr.sortOrder }}</td>
            <td>
              <button class="action-btn" @click="openQr(qr)">编辑</button>
              <button class="action-btn danger" @click="delQr(qr)">删除</button>
            </td>
          </tr>
          <tr v-if="quickReplies.length === 0"><td colspan="4" style="text-align:center;color:#9ca3af;padding:24px;">暂无快捷回复</td></tr>
        </tbody>
      </table>
    </div>

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
        <div class="form-group"><label>回复内容</label><textarea v-model="krModal.form.replyContent"></textarea></div>
        <div class="form-group"><label>优先级（数值越大越优先）</label><input type="number" v-model.number="krModal.form.priority" /></div>
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
        <div class="form-group"><label>内容</label><textarea v-model="qrModal.form.content"></textarea></div>
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
