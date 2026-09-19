<!-- 忆梦云团队开发 - 员工管理 -->
<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const agents = ref([])
const showCreate = ref(false)
const createForm = ref({ username: '', displayName: '', password: '', role: 'agent' })
const resetTarget = ref(null)
const resetPwd = ref('')
const deleteTarget = ref(null)

async function load() {
  const res = await api.get('/tenant/employees')
  if (res.code === 0) agents.value = res.data
}

async function createAgent() {
  if (!createForm.value.username || !createForm.value.displayName || !createForm.value.password) {
    alert('请填写完整信息'); return
  }
  const res = await api.post('/tenant/employees', createForm.value)
  if (res.code === 0) {
    showCreate.value = false
    createForm.value = { username: '', displayName: '', password: '', role: 'agent' }
    await load()
  } else {
    alert(res.message)
  }
}

async function toggleStatus(a) {
  await api.patch(`/tenant/employees/${a._id}`, { status: a.status === 'active' ? 'disabled' : 'active' })
  await load()
}

async function delAgent() {
  if (!deleteTarget.value) return
  await api.delete(`/tenant/employees/${deleteTarget.value._id}`)
  deleteTarget.value = null
  await load()
}

async function doReset() {
  if (!resetTarget.value || !resetPwd.value) return
  const res = await api.post(`/tenant/employees/${resetTarget.value._id}/reset-password`, { password: resetPwd.value })
  if (res.code === 0) { alert('已重置'); resetTarget.value = null; resetPwd.value = '' }
  else alert(res.message)
}

onMounted(load)
</script>

<template>
  <div class="page-content">
    <div class="page-title">
      <span>员工管理</span>
      <button @click="showCreate = true">+ 新增员工</button>
    </div>
    
    <table class="data-table">
      <thead><tr><th>用户名</th><th>显示名</th><th>角色</th><th>状态</th><th>最后登录</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="a in agents" :key="a._id">
          <td>{{ a.username }}</td>
          <td>{{ a.displayName }}</td>
          <td>
            <span class="tag" :class="{ 'tag-blue': a.role === 'owner', 'tag-green': a.role === 'admin', 'tag-gray': a.role === 'agent' }">
              {{ { owner: '所有者', admin: '管理员', agent: '员工' }[a.role] }}
            </span>
          </td>
          <td>
            <span class="tag" :class="a.status === 'active' ? 'tag-green' : 'tag-red'">
              {{ a.status === 'active' ? '正常' : '已禁用' }}
            </span>
          </td>
          <td>{{ a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : '—' }}</td>
          <td>
            <button v-if="a.role !== 'owner'" class="action-btn" @click="toggleStatus(a)">
              {{ a.status === 'active' ? '禁用' : '启用' }}
            </button>
            <button class="action-btn" @click="resetTarget = a">重置密码</button>
            <button v-if="a.role !== 'owner'" class="action-btn danger" @click="deleteTarget = a">删除</button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 新增员工 -->
    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <div class="modal-box">
        <h3>新增员工</h3>
        <div class="form-group"><label>用户名</label><input v-model="createForm.username" /></div>
        <div class="form-group"><label>显示名</label><input v-model="createForm.displayName" /></div>
        <div class="form-group"><label>初始密码（至少6位）</label><input type="password" v-model="createForm.password" /></div>
        <div class="form-group">
          <label>角色</label>
          <select v-model="createForm.role">
            <option value="agent">员工</option>
            <option value="admin">管理员</option>
          </select>
        </div>
        <div class="modal-footer">
          <button class="btn-ghost" @click="showCreate = false">取消</button>
          <button class="btn-primary" @click="createAgent">创建</button>
        </div>
      </div>
    </div>

    <!-- 重置密码 -->
    <div v-if="resetTarget" class="modal-overlay" @click.self="resetTarget = null">
      <div class="modal-box">
        <h3>重置 {{ resetTarget.displayName }} 的密码</h3>
        <div class="form-group"><label>新密码</label><input type="password" v-model="resetPwd" /></div>
        <div class="modal-footer">
          <button class="btn-ghost" @click="resetTarget = null">取消</button>
          <button class="btn-primary" @click="doReset">确认重置</button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :open="!!deleteTarget"
      title="删除员工"
      :message="`确认删除员工「${deleteTarget?.displayName || ''}」吗？此操作无法撤销。`"
      confirm-text="确认删除"
      danger
      @confirm="delAgent"
      @cancel="deleteTarget = null"
    />
  </div>
</template>
