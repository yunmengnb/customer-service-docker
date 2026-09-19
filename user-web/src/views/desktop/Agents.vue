<!-- 忆梦云团队开发 - 桌面端员工管理独立视图 -->
<script setup>
import { ref, onMounted } from 'vue'
import api from '../../api'
import ConfirmDialog from '../../components/ConfirmDialog.vue'

const employees = ref([])
const showCreate = ref(false)
const createForm = ref({ username: '', email: '', displayName: '', password: '', role: 'agent' })
const editTarget = ref(null)
const editForm = ref({ username: '', email: '', displayName: '', role: 'agent' })
const resetTarget = ref(null)
const resetPwd = ref('')
const deleteTarget = ref(null)
const loginTarget = ref(null)

async function load() {
  const res = await api.get('/tenant/employees')
  if (res.code === 0) employees.value = res.data
}

async function createEmployee() {
  if (!createForm.value.username || !createForm.value.displayName || !createForm.value.password) {
    alert('请填写完整信息'); return
  }
  const res = await api.post('/tenant/employees', createForm.value)
  if (res.code === 0) {
    showCreate.value = false
    createForm.value = { username: '', email: '', displayName: '', password: '', role: 'agent' }
    await load()
  } else alert(res.message)
}

function openEdit(employee) {
  editTarget.value = employee
  editForm.value = { username: employee.username, email: employee.email || '', displayName: employee.displayName, role: employee.role }
}

async function saveEmployee() {
  const res = await api.patch(`/tenant/employees/${editTarget.value._id}`, editForm.value)
  if (res.code === 0) { editTarget.value = null; await load() }
  else alert(res.message)
}

async function toggleStatus(employee) {
  await api.patch(`/tenant/employees/${employee._id}`, { status: employee.status === 'active' ? 'disabled' : 'active' })
  await load()
}

async function deleteEmployee() {
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

async function loginAsEmployee() {
  if (!loginTarget.value) return
  const target = window.open('', '_blank')
  if (!target) return alert('新窗口被浏览器拦截，请允许本站打开弹窗')

  try {
    const res = await api.post(`/tenant/employees/${loginTarget.value._id}/login`)
    if (res.code !== 0) throw new Error(res.message || '登录失败')

    const transferKey = `employee_login_${Date.now()}`
    localStorage.setItem(transferKey, JSON.stringify(res.data))
    target.location.replace(`/employee-login?key=${encodeURIComponent(transferKey)}`)
    loginTarget.value = null
  } catch (error) {
    target.close()
    alert(error?.message || '登录失败')
  }
}

onMounted(load)
</script>

<template>
  <div class="page-content">
    <div class="page-title"><span>员工管理</span><button @click="showCreate = true">+ 新增员工</button></div>
    <table class="data-table">
      <thead><tr><th>用户名</th><th>邮箱</th><th>显示名</th><th>角色</th><th>状态</th><th>最后登录</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="employee in employees" :key="employee._id">
          <td>{{ employee.username }}</td><td>{{ employee.email || '—' }}</td><td>{{ employee.displayName }}</td>
          <td><span class="tag" :class="{ 'tag-blue': employee.role === 'owner', 'tag-green': employee.role === 'admin', 'tag-gray': employee.role === 'agent' }">{{ { owner: '所有者', admin: '管理员', agent: '员工' }[employee.role] }}</span></td>
          <td><span class="tag" :class="employee.status === 'active' ? 'tag-green' : 'tag-red'">{{ employee.status === 'active' ? '正常' : '已禁用' }}</span></td>
          <td>{{ employee.lastLoginAt ? new Date(employee.lastLoginAt).toLocaleString() : '—' }}</td>
          <td>
            <template v-if="employee.role !== 'owner'">
              <button class="action-btn" @click="openEdit(employee)">编辑</button>
              <button class="action-btn" @click="toggleStatus(employee)">{{ employee.status === 'active' ? '禁用' : '启用' }}</button>
              <button v-if="employee.role === 'agent' && employee.status === 'active'" class="action-btn" @click="loginTarget = employee">登录员工后台</button>
              <button class="action-btn" @click="resetTarget = employee">重置密码</button>
              <button class="action-btn danger" @click="deleteTarget = employee">删除</button>
            </template>
            <span v-else>—</span>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false"><div class="modal-box">
      <h3>新增员工</h3>
      <div class="form-group"><label>用户名</label><input v-model="createForm.username" /></div>
      <div class="form-group"><label>邮箱（可选）</label><input v-model.trim="createForm.email" type="email" /></div>
      <div class="form-group"><label>显示名</label><input v-model="createForm.displayName" /></div>
      <div class="form-group"><label>初始密码（至少6位）</label><input type="password" v-model="createForm.password" /></div>
      <div class="form-group"><label>角色</label><select v-model="createForm.role"><option value="agent">员工</option><option value="admin">管理员</option></select></div>
      <div class="modal-footer"><button class="btn-ghost" @click="showCreate = false">取消</button><button class="btn-primary" @click="createEmployee">创建</button></div>
    </div></div>

    <div v-if="editTarget" class="modal-overlay" @click.self="editTarget = null"><div class="modal-box">
      <h3>编辑员工</h3>
      <div class="form-group"><label>用户名</label><input v-model="editForm.username" /></div>
      <div class="form-group"><label>邮箱（可选）</label><input v-model.trim="editForm.email" type="email" /></div>
      <div class="form-group"><label>显示名</label><input v-model="editForm.displayName" /></div>
      <div v-if="editTarget.role !== 'owner'" class="form-group"><label>角色</label><select v-model="editForm.role"><option value="agent">员工</option><option value="admin">管理员</option></select></div>
      <div class="modal-footer"><button class="btn-ghost" @click="editTarget = null">取消</button><button class="btn-primary" @click="saveEmployee">保存</button></div>
    </div></div>

    <div v-if="resetTarget" class="modal-overlay" @click.self="resetTarget = null"><div class="modal-box">
      <h3>重置 {{ resetTarget.displayName }} 的密码</h3>
      <div class="form-group"><label>新密码</label><input type="password" v-model="resetPwd" /></div>
      <div class="modal-footer"><button class="btn-ghost" @click="resetTarget = null">取消</button><button class="btn-primary" @click="doReset">确认重置</button></div>
    </div></div>

    <ConfirmDialog :open="!!loginTarget" title="登录员工后台" :message="`确认在新窗口登录员工「${loginTarget?.displayName || ''}」的后台吗？当前客服后台会保持登录。`" confirm-text="确认登录" @confirm="loginAsEmployee" @cancel="loginTarget = null" />
    <ConfirmDialog :open="!!deleteTarget" title="删除员工" :message="`确认删除员工「${deleteTarget?.displayName || ''}」吗？此操作无法撤销。`" confirm-text="确认删除" danger @confirm="deleteEmployee" @cancel="deleteTarget = null" />
  </div>
</template>
