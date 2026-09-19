// 忆梦云团队开发
const Tenant = require('../models/Tenant');
const TenantUser = require('../models/TenantUser');
const CustomerAccount = require('../models/CustomerAccount');
const PlatformAdmin = require('../models/PlatformAdmin');
const { ok, error, hashPassword } = require('../utils');

class TenantAdminController {
  // GET /api/admin/tenants
  async list(req, res) {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.keyword) {
      const kw = String(req.query.keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      where.$or = [
        { name: { $regex: kw, $options: 'i' } },
        { username: { $regex: kw, $options: 'i' } },
        { email: { $regex: kw, $options: 'i' } },
      ];
    }
    
    const [items, total] = await Promise.all([
      Tenant.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Tenant.countDocuments(where),
    ]);
    
    return ok(res, { items: items.map(t => t.toJSON()), total, page, limit });
  }
  
  // GET /api/admin/tenants/:id
  async detail(req, res) {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) return error(res, '租户不存在', 404, 404);
    
    const agentCount = await TenantUser.countDocuments({ tenantId: tenant._id });
    return ok(res, { ...tenant.toJSON(), agentCount });
  }
  
  async update(req, res) {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) return error(res, '租户不存在', 404, 404);
    const body = req.body || {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name || name.length > 100) return error(res, '租户名称须为1-100字');
      tenant.name = name;
    }
    if (body.username !== undefined) {
      const username = String(body.username).trim();
      if (username.length < 3 || username.length > 50) return error(res, '用户名须为3-50位');
      if (await Tenant.exists({ username, _id: { $ne: tenant._id } })) return error(res, '用户名已被使用');
      tenant.username = username;
    }
    if (body.email !== undefined) {
      const email = String(body.email).trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) return error(res, '邮箱格式不正确');
      if (await Tenant.exists({ email, _id: { $ne: tenant._id } })) return error(res, '邮箱已被使用');
      tenant.email = email;
    }
    if (body.qq !== undefined) {
      const qq = String(body.qq).trim();
      if (qq && !/^[1-9]\d{4,11}$/.test(qq)) return error(res, 'QQ号格式不正确');
      tenant.qq = qq;
    }
    if (body.password !== undefined) {
      if (typeof body.password !== 'string' || body.password.length < 6 || body.password.length > 72) return error(res, '密码须为6-72位');
      tenant.password = hashPassword(body.password);
    }
    if (body.status !== undefined) {
      if (!['active', 'disabled', 'trial'].includes(body.status)) return error(res, '状态值无效');
      tenant.status = body.status;
    }
    try {
      await tenant.save();
    } catch (err) {
      if (err?.code === 11000) return error(res, '用户名或邮箱已被使用');
      throw err;
    }
    const ownerUpdates = { displayName: tenant.name, username: tenant.username };
    if (body.password !== undefined) ownerUpdates.password = tenant.password;
    await TenantUser.updateOne({ tenantId: tenant._id, role: 'owner' }, { $set: ownerUpdates });
    if (tenant.status === 'disabled') {
      const io = req.app.get('io');
      const sockets = io ? await io.fetchSockets() : [];
      await Promise.all(sockets.filter(socket => String(socket.user?.tenantId) === String(tenant._id)).map(socket => socket.disconnect(true)));
    }
    return ok(res, tenant.toJSON(), '租户资料已更新');
  }

  // PATCH /api/admin/tenants/:id/status
  async updateStatus(req, res) {
    req.body = { status: req.body.status };
    return TenantAdminController.prototype.update(req, res);
  }
  
  // PATCH /api/admin/tenants/:id/plan
  async updatePlan(req, res) {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) return error(res, '租户不存在', 404, 404);
    
    const newPlan = {};
    // 保留已有 0 值语义；上限采用 JS 安全整数边界，不引入未经定义的商业配额限制。
    for (const field of ['agentLimit', 'channelLimit', 'messageRetentionDays', 'attachmentLimitMB']) {
      if (req.body[field] === undefined) continue;
      const value = req.body[field];
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        return error(res, field + '须为非负安全整数');
      }
      newPlan['plan.' + field] = value;
    }
    
    // 用 updateOne 避免触发完整 schema 校验（email/password/username required）
    await Tenant.updateOne({ _id: tenant._id }, { $set: newPlan }, { runValidators: true });
    
    // 重新获取最新数据返回
    const updated = await Tenant.findById(tenant._id);
    return ok(res, updated.toJSON());
  }
  
  // GET /api/admin/dashboard
  async dashboard(req, res) {
    const [tenantCount, activeTenants, agentCount, customerCount] = await Promise.all([
      Tenant.countDocuments(),
      Tenant.countDocuments({ status: { $in: ['active', 'trial'] } }),
      TenantUser.countDocuments(),
      CustomerAccount.countDocuments(),
    ]);
    
    return ok(res, {
      tenantCount,
      activeTenants,
      agentCount,
      customerCount,
    });
  }
}

module.exports = new TenantAdminController();
