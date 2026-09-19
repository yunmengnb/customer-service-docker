// 忆梦云团队开发
const TenantUser = require('../models/TenantUser');
const Tenant = require('../models/Tenant');
const Channel = require('../models/Channel');
const Conversation = require('../models/Conversation');
const cache = require('../utils/cache');

function normalizedEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email || undefined;
}

async function emailInUse(email, excludeUserId) {
  if (!email) return false;
  const userQuery = { email };
  if (excludeUserId) userQuery._id = { $ne: excludeUserId };
  const [tenant, user] = await Promise.all([
    Tenant.exists({ email }),
    TenantUser.exists(userQuery),
  ]);
  return !!(tenant || user);
}

async function releaseEmployee(req, user) {
  const tenantId = req.tenantId;
  const channels = await Channel.find({ tenantId, agentIds: user._id }).select('publicToken');
  await Channel.updateMany({ tenantId, agentIds: user._id }, { $pull: { agentIds: user._id } });
  await cache.remove(...channels.map(channel => `config:channel:token:${channel.publicToken}`));
  const scope = { tenantId, assignedAgentId: user._id, status: { $in: ['active', 'waiting'] } };
  const conversations = await Conversation.find(scope);
  const io = req.app.get('io');
  for (const conv of conversations) {
    const updated = await Conversation.findOneAndUpdate({ ...scope, _id: conv._id },
      { $set: { status: 'waiting', assignedAgentId: null, acceptedAt: null, closedAt: null } }, { new: true });
    if (!updated || !io) continue;
    const data = { conversationId: conv._id, status: 'waiting', assignedAgentId: null, acceptedAt: null, agent: null };
    io.to(`tenant-${tenantId}`).to(`channel-staff-${conv.channelId}`).to(`agent-${user._id}`).to(`customer-${conv.customerId}`).emit('conversation.updated', data);
  }
  io?.in(`agent-${user._id}`).disconnectSockets(true);
}

function invalidEmployee(body, creating = false) {
  for (const [field, min, max] of [['username', 3, 50], ['displayName', 1, 50]]) {
    if (creating || body[field] !== undefined) {
      if (typeof body[field] !== 'string' || body[field].trim().length < min || body[field].trim().length > max) return `${field}须为${min}-${max}位字符串`;
    }
  }
  if (body.role !== undefined && !['admin', 'agent'].includes(body.role)) return '角色无效';
  if (body.status !== undefined && !['active', 'disabled'].includes(body.status)) return '状态无效';
  if (body.avatarUrl !== undefined && typeof body.avatarUrl !== 'string') return '头像格式无效';
  if (creating && (typeof body.password !== 'string' || body.password.length < 6 || body.password.length > 72)) return '密码须为6-72位';
  return '';
}
const { ok, error, hashPassword, signToken, passwordVersion } = require('../utils');
const { recordOperation } = require('../services/auditLogService');

class AgentController {
  // GET /api/tenant/employees
  async list(req, res) {
    const { tenantId } = req;
    const users = await TenantUser.find({ tenantId }).sort({ createdAt: -1 });
    return ok(res, users.map(u => u.toJSON()));
  }
  
  // POST /api/tenant/employees
  async create(req, res) {
    const { tenantId } = req;
    const invalid = invalidEmployee(req.body, true);
    if (invalid) return error(res, invalid);
    const { password, role = 'agent' } = req.body;
    const username = req.body.username.trim();
    const displayName = req.body.displayName.trim();
    const emailAddress = normalizedEmail(req.body.email);
    
    // 数量限制
    const tenant = await Tenant.findById(tenantId);
    const currentCount = await TenantUser.countDocuments({
      tenantId,
      role: { $ne: 'owner' },
    });
    if (currentCount >= tenant.plan.agentLimit) {
      return error(res, '已达到员工数量上限');
    }
    
    // 唯一用户名
    if (await TenantUser.findOne({ tenantId, username })) {
      return error(res, '用户名已存在');
    }
    if (await emailInUse(emailAddress)) return error(res, '邮箱已被使用', 409, 409);
    
    let user;
    try {
      user = await TenantUser.create({
      tenantId,
      username,
      email: emailAddress,
      password: hashPassword(password),
      displayName,
      role,
      status: req.body.status || 'active',
      });
    } catch (err) {
      if (err?.code === 11000) return error(res, emailAddress ? '用户名或邮箱已存在' : '用户名已存在', 409, 409);
      throw err;
    }
    
    recordOperation({ req, tenantId, user: req.user, action: 'employee_create', detail: `新增员工「${displayName || username}」` });
    return ok(res, user.toJSON());
  }
  
  // PATCH /api/tenant/employees/:id
  async update(req, res) {
    const { tenantId } = req;
    const { id } = req.params;
    const user = await TenantUser.findOne({ _id: id, tenantId });
    if (!user) return error(res, '员工不存在', 404, 404);
    if (user.role === 'owner') return error(res, '不能修改所有者账号');

    const invalid = invalidEmployee(req.body);
    if (invalid) return error(res, invalid);
    if (req.body.username !== undefined && req.body.username !== user.username) {
      const username = String(req.body.username).trim();
      if (username.length < 3) return error(res, '用户名至少3位');
      if (await TenantUser.findOne({ tenantId, username, _id: { $ne: user._id } })) {
        return error(res, '用户名已存在');
      }
      user.username = username;
    }
    if (req.body.email !== undefined) {
      const emailAddress = normalizedEmail(req.body.email);
      if (await emailInUse(emailAddress, user._id)) return error(res, '邮箱已被使用', 409, 409);
      user.email = emailAddress;
    }
    if (req.body.displayName !== undefined) user.displayName = req.body.displayName;
    if (req.body.role !== undefined && ['admin', 'agent'].includes(req.body.role)) user.role = req.body.role;
    if (req.body.status !== undefined && ['active', 'disabled'].includes(req.body.status)) user.status = req.body.status;
    if (req.body.avatarUrl !== undefined) user.avatarUrl = req.body.avatarUrl;
    
    try {
      await user.save();
    } catch (err) {
      if (err?.code === 11000) return error(res, '用户名或邮箱已存在', 409, 409);
      throw err;
    }
    if (user.status === 'disabled') await releaseEmployee(req, user);
    recordOperation({ req, tenantId, user: req.user, action: 'employee_update', detail: `修改员工「${user.displayName || user.username}」` });
    return ok(res, user.toJSON());
  }
  
  // DELETE /api/tenant/employees/:id
  async delete(req, res) {
    const { tenantId } = req;
    const { id } = req.params;
    const user = await TenantUser.findOne({ _id: id, tenantId });
    if (!user) return error(res, '员工不存在', 404, 404);
    
    if (user.role === 'owner') {
      return error(res, '不能删除所有者账号');
    }
    if (String(user._id) === String(req.user.id)) {
      return error(res, '不能删除当前登录账号');
    }
    
    await TenantUser.deleteOne({ _id: id, tenantId });
    await releaseEmployee(req, user);
    // releaseEmployee 已断开旧连接。
    recordOperation({ req, tenantId, user: req.user, action: 'employee_delete', detail: `删除员工「${user.displayName || user.username}」` });
    return ok(res, null, '已删除');
  }
  
  // POST /api/tenant/employees/:id/reset-password
  async resetPassword(req, res) {
    const { tenantId } = req;
    const { id } = req.params;
    const { password } = req.body;
    
    if (typeof password !== 'string' || password.length < 6 || password.length > 72) {
      return error(res, '密码至少6位');
    }
    
    const user = await TenantUser.findOne({ _id: id, tenantId });
    if (!user) return error(res, '员工不存在', 404, 404);
    if (user.role === 'owner') return error(res, '不能重置所有者密码');
    
    user.password = hashPassword(password);
    await user.save();
    // 重置密码后立即断开其连接，使旧凭证对应的 Socket 会话失效
    req.app.get('io')?.in(`agent-${user._id}`).disconnectSockets(true);
    recordOperation({ req, tenantId, user: req.user, action: 'employee_reset_password', detail: `重置员工「${user.displayName || user.username}」密码` });
    return ok(res, null, '已重置');
  }

  // POST /api/tenant/employees/:id/login
  async loginAsEmployee(req, res) {
    const employee = await TenantUser.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
      role: 'agent',
    });

    if (!employee) return error(res, '员工不存在', 4041, 404);
    if (employee.status !== 'active') return error(res, '员工账号已被禁用', 4032, 403);

    employee.lastLoginAt = new Date();
    await employee.save();

    const tenant = await Tenant.findById(req.tenantId);
    const token = signToken({
      type: 'tenant_user',
      id: employee._id.toString(),
      tenantId: employee.tenantId.toString(),
      username: employee.username,
      displayName: employee.displayName,
      role: employee.role,
      pv: passwordVersion(employee.password),
    });

    return ok(res, {
      token,
      user: employee.toJSON(),
      tenant: tenant ? tenant.toJSON() : null,
    });
  }
}

module.exports = new AgentController();
