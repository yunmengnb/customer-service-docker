// 忆梦云团队开发
const PlatformAdmin = require('../models/PlatformAdmin');
const { ok, error, hashPassword, comparePassword, signToken, passwordVersion } = require('../utils');

class AdminAuthController {
  // POST /api/admin/auth/login
  async login(req, res) {
    const { username, password } = req.body;
    
    const admin = await PlatformAdmin.findOne({ username });
    if (!admin) {
      return error(res, '账号或密码错误', 401, 401);
    }
    if (admin.status !== 'active') {
      return error(res, '账号已被禁用', 403, 403);
    }
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      return error(res, '账号已被锁定，请稍后再试', 423, 423);
    }
    
    const matched = comparePassword(password, admin.password);
    if (!matched) {
      // 失败累加
      admin.loginAttempts = (admin.loginAttempts || 0) + 1;
      if (admin.loginAttempts >= 5) {
        admin.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        admin.loginAttempts = 0;
      }
      await admin.save();
      return error(res, '账号或密码错误', 401, 401);
    }
    
    // 登录成功
    admin.loginAttempts = 0;
    admin.lockedUntil = null;
    admin.lastLoginAt = new Date();
    await admin.save();
    
    const token = signToken({
      type: 'admin',
      id: admin._id.toString(),
      username: admin.username,
      role: admin.role,
      pv: passwordVersion(admin.password),
    });
    
    return ok(res, {
      token,
      admin: admin.toJSON(),
    });
  }
  
  // PATCH /api/admin/auth/profile
  async updateProfile(req, res) {
    const admin = await PlatformAdmin.findById(req.admin.id);
    if (!admin || admin.status !== 'active') return error(res, '账号不存在或已禁用', 404, 404);

    const { username, email, avatarUrl, currentPassword, newPassword } = req.body || {};
    if ([username, email, avatarUrl].some(value => value !== undefined && typeof value !== 'string')) return error(res, '资料字段格式无效');
    const nextUsername = username === undefined ? admin.username : username.trim();
    const nextEmail = email === undefined ? admin.email : email.trim().toLowerCase();
    if (nextUsername.length < 3 || nextUsername.length > 50) return error(res, '管理员账号须为 3-50 位');
    if (!/^\S+@\S+\.\S+$/.test(nextEmail)) return error(res, '邮箱格式不正确');

    const duplicate = await PlatformAdmin.findOne({
      _id: { $ne: admin._id },
      $or: [{ username: nextUsername }, { email: nextEmail }],
    });
    if (duplicate) return error(res, duplicate.username === nextUsername ? '管理员账号已存在' : '邮箱已被使用');

    if (newPassword) {
      if (String(newPassword).length < 6 || String(newPassword).length > 72) return error(res, '新密码须为 6-72 位');
      if (!currentPassword || !comparePassword(String(currentPassword), admin.password)) return error(res, '当前密码不正确', 4002, 400);
      admin.password = hashPassword(String(newPassword));
    }

    admin.username = nextUsername;
    admin.email = nextEmail;
    if (avatarUrl !== undefined) admin.avatarUrl = avatarUrl.trim();
    await admin.save();

    const token = signToken({
      type: 'admin', id: admin._id.toString(), username: admin.username, role: admin.role, pv: passwordVersion(admin.password),
    });
    return ok(res, { token, admin: admin.toJSON() }, '资料已更新');
  }

  // POST /api/admin/auth/logout
  async logout(req, res) {
    // 无状态 JWT，前端自行清除 token 即可
    return ok(res, null, '已退出');
  }
  
  // GET /api/admin/auth/me
  async me(req, res) {
    const admin = await PlatformAdmin.findById(req.admin.id);
    if (!admin || admin.status !== 'active') {
      return error(res, '账号不存在或已禁用', 404, 404);
    }
    return ok(res, admin.toJSON());
  }
}

module.exports = new AdminAuthController();