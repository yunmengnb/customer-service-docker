// 忆梦云团队开发
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const TenantUser = require('../models/TenantUser');
const TenantUserLoginKey = require('../models/TenantUserLoginKey');
const TenantUserSession = require('../models/TenantUserSession');
const { ok, error, hashPassword, comparePassword } = require('../utils');
const { getSystemSettings, authSettings } = require('../utils/systemSettings');
const { normalizeEmail, sendEmailCode, verifyEmailCode } = require('../utils/emailVerification');
const { recordLogin, recordOperation } = require('../services/auditLogService');
const {
  createSessionAndToken,
  revokeSession,
  signForSession,
} = require('../services/tenantSessionService');
const {
  consumeTemporaryLoginKey,
  generateTemporaryLoginKey,
} = require('../services/tenantLoginKeyService');

const REGISTER_DISABLED_MESSAGE = '暂时无法注册，有问题请联系管理员';

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

async function emailInUse(email, excludeTenantId) {
  if (!email) return false;
  const tenantQuery = { email };
  if (excludeTenantId) tenantQuery._id = { $ne: excludeTenantId };
  const [tenant, user] = await Promise.all([
    Tenant.exists(tenantQuery),
    TenantUser.exists({ email }),
  ]);
  return !!(tenant || user);
}

function requireOwner(req, res) {
  if (req.user.role !== 'owner') {
    error(res, '仅租户所有者可修改租户资料', 4031, 403);
    return false;
  }
  return true;
}

class TenantAuthController {
  async sendRegisterCode(req, res) {
    const settings = authSettings(await getSystemSettings());
    if (!settings.tenantRegisterEnabled) return error(res, REGISTER_DISABLED_MESSAGE, 4034, 403);
    if (!settings.tenantRegisterEmailVerificationEnabled) {
      return error(res, '客服注册暂未开启邮箱验证', 4035, 403);
    }
    const email = normalizeEmail(req.body.email);
    if (await emailInUse(email)) return error(res, '邮箱已被注册');
    const result = await sendEmailCode({ scope: 'tenant-register', email, subject: '租户注册邮箱验证码', action: '租户注册' });
    if (!result.ok) return error(res, result.message, result.code, result.status);
    return ok(res, null, '验证码已发送');
  }

  async register(req, res) {
    const { name, password } = req.body;
    const username = normalizeUsername(req.body.username);
    const email = normalizeEmail(req.body.email);
    const settings = authSettings(await getSystemSettings());
    if (!settings.tenantRegisterEnabled) return error(res, REGISTER_DISABLED_MESSAGE, 4034, 403);
    if (settings.tenantRegisterEmailVerificationEnabled) {
      const valid = await verifyEmailCode({ scope: 'tenant-register', email, code: req.body.emailCode });
      if (!valid) return error(res, '邮箱验证码错误或已过期', 4004, 400);
    }
    const [tenantUsernameInUse, userUsernameInUse] = await Promise.all([
      Tenant.exists({ username }),
      TenantUser.exists({ username }),
    ]);
    if (tenantUsernameInUse || userUsernameInUse) return error(res, '用户名已被注册', 409, 409);
    if (await emailInUse(email)) return error(res, '邮箱已被注册');

    const passwordHash = hashPassword(password);
    let tenant;
    try {
      tenant = await Tenant.create({ name, username, password: passwordHash, email, status: 'active' });
      const owner = await TenantUser.create({ tenantId: tenant._id, username, password: passwordHash, displayName: name, role: 'owner', status: 'active' });
      return ok(res, { tenant: tenant.toJSON(), owner: owner.toJSON() });
    } catch (err) {
      if (tenant?._id) await Tenant.deleteOne({ _id: tenant._id });
      if (err?.code === 11000) return error(res, '用户名或邮箱已被注册', 409, 409);
      throw err;
    }
  }

  async login(req, res) {
    const username = normalizeUsername(req.body.username);
    const { password } = req.body;
    const tenantIdentifier = normalizeUsername(req.body.tenant);
    const settings = authSettings(await getSystemSettings());
    if (!settings.tenantLoginEnabled) return error(res, '客服登录暂时关闭，有问题请联系管理员', 4034, 403);

    let specifiedTenant = null;
    if (tenantIdentifier) {
      const tenantQuery = [{ username: tenantIdentifier }];
      if (mongoose.isValidObjectId(tenantIdentifier)) tenantQuery.push({ _id: tenantIdentifier });
      specifiedTenant = await Tenant.findOne({ $or: tenantQuery });
      if (!specifiedTenant) return error(res, '租户账号或标识不存在', 4041, 404);
    }

    const loginEmail = normalizeEmail(username);
    const isEmailLogin = /^\S+@\S+\.\S+$/.test(loginEmail);
    const ownerTenant = specifiedTenant
      ? (specifiedTenant.username === username || specifiedTenant.email === loginEmail ? specifiedTenant : null)
      : await Tenant.findOne(isEmailLogin ? { email: loginEmail } : { username });
    if (ownerTenant && (ownerTenant.username === username || ownerTenant.email === loginEmail) && comparePassword(password, ownerTenant.password)) {
      if (!['active', 'trial'].includes(ownerTenant.status)) {
        recordLogin({ req, tenantId: ownerTenant._id, user: { username, displayName: ownerTenant.name, role: 'owner' }, result: 'failure', detail: '账号已被禁用' });
        return error(res, '账号已被禁用', 403, 403);
      }
      ownerTenant.lastLoginAt = new Date();
      await ownerTenant.save();
      let owner = await TenantUser.findOne({ tenantId: ownerTenant._id, role: 'owner' });
      if (!owner) {
        try {
          owner = await TenantUser.create({ tenantId: ownerTenant._id, username: normalizeUsername(ownerTenant.username), password: ownerTenant.password, displayName: ownerTenant.name, role: 'owner', status: 'active' });
        } catch (err) {
          if (err?.code === 11000) return error(res, '用户名已被使用', 409, 409);
          throw err;
        }
      }
      if (owner.status !== 'active') return error(res, '账号已被禁用', 403, 403);
      owner.lastLoginAt = new Date();
      await owner.save();
      const { token } = await createSessionAndToken({ user: owner, req, loginMethod: 'password' });
      recordLogin({ req, tenantId: ownerTenant._id, user: owner, result: 'success', detail: '登录成功' });
      return ok(res, { token, tenant: ownerTenant.toJSON(), user: owner.toJSON() });
    }

    const userQuery = isEmailLogin ? { email: loginEmail } : { username };
    if (specifiedTenant) userQuery.tenantId = specifiedTenant._id;
    const user = await TenantUser.findOne(userQuery);
    if (!user || !comparePassword(password, user.password)) {
      recordLogin({ req, tenantId: user ? user.tenantId : (ownerTenant ? ownerTenant._id : null), user: user || { username }, result: 'failure', detail: '账号或密码错误' });
      return error(res, '账号或密码错误', 401, 401);
    }
    if (user.status !== 'active') {
      recordLogin({ req, tenantId: user.tenantId, user, result: 'failure', detail: '账号已被禁用' });
      return error(res, '账号已被禁用', 403, 403);
    }
    const tenantObj = specifiedTenant || await Tenant.findById(user.tenantId);
    if (!tenantObj || !['active', 'trial'].includes(tenantObj.status)) {
      recordLogin({ req, tenantId: user.tenantId, user, result: 'failure', detail: '所属租户已被禁用' });
      return error(res, '所属租户已被禁用', 403, 403);
    }
    user.lastLoginAt = new Date();
    await user.save();
    const { token } = await createSessionAndToken({ user, req, loginMethod: 'password' });
    recordLogin({ req, tenantId: user.tenantId, user, result: 'success', detail: '登录成功' });
    return ok(res, { token, tenant: tenantObj.toJSON(), user: user.toJSON() });
  }

  async keyLogin(req, res) {
    const settings = authSettings(await getSystemSettings());
    if (!settings.tenantLoginEnabled) return error(res, '客服登录暂时关闭，有问题请联系管理员', 4034, 403);
    const rawKey = String(req.body?.key || req.body?.loginKey || '').trim();
    const keyError = (reason = 'LOGIN_KEY_INVALID') => {
      const expired = reason === 'LOGIN_KEY_EXPIRED';
      const used = reason === 'LOGIN_KEY_USED';
      return res.status(401).json({
        code: expired ? 401011 : used ? 401012 : 401010,
        message: expired ? '登录密钥已过期' : used ? '登录密钥已使用' : '登录密钥错误',
        reason,
        data: null,
        requestId: res.locals.requestId,
      });
    };
    const consumed = await consumeTemporaryLoginKey(rawKey);
    if (!consumed.loginKey) return keyError(consumed.reason);
    const loginKey = consumed.loginKey;
    const [user, tenant] = await Promise.all([
      TenantUser.findOne({ _id: loginKey.userId, tenantId: loginKey.tenantId }),
      Tenant.findById(loginKey.tenantId),
    ]);
    if (!user || user.status !== 'active' || !tenant || !['active', 'trial'].includes(tenant.status)) {
      return keyError('LOGIN_KEY_UNAVAILABLE');
    }
    user.lastLoginAt = new Date();
    await user.save();
    const { token } = await createSessionAndToken({ user, req, loginMethod: 'key' });
    recordLogin({ req, tenantId: user.tenantId, user, result: 'success', detail: '临时登录密钥登录成功' });
    return ok(res, { token, tenant: tenant.toJSON(), user: user.toJSON() });
  }

  async me(req, res) {
    const user = await TenantUser.findById(req.user.id);
    if (!user) return error(res, '账号不存在', 404, 404);
    const tenant = await Tenant.findById(user.tenantId);
    return ok(res, { user: user.toJSON(), tenant: tenant ? tenant.toJSON() : null });
  }

  async listSessions(req, res) {
    const sessions = await TenantUserSession.find({
      tenantId: req.tenantId,
      userId: req.user.id,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).sort({ lastSeenAt: -1 }).lean();
    return ok(res, sessions.map(session => ({
      ...session,
      id: String(session._id),
      current: String(session._id) === String(req.user.sid),
      isCurrent: String(session._id) === String(req.user.sid),
      clientType: session.deviceType,
      loginType: session.loginMethod,
      method: session.loginMethod,
      loginAt: session.createdAt,
      lastActiveAt: session.lastSeenAt,
    })));
  }

  async revokeSession(req, res) {
    const currentSession = await TenantUserSession.findOne({
      _id: req.user.sid,
      tenantId: req.tenantId,
      userId: req.user.id,
      loginMethod: 'password',
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!currentSession) return error(res, '仅账号密码登录可管理登录设备', 403, 403);

    const session = mongoose.isValidObjectId(req.params.id) && await TenantUserSession.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
      userId: req.user.id,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!session) return error(res, '登录设备不存在或已退出', 404, 404);
    await revokeSession({
      sessionId: session._id,
      tenantId: req.tenantId,
      userId: req.user.id,
      revokedBy: req.user.id,
      reason: '通过设备管理撤销',
      io: req.app.get('io'),
    });
    return ok(res, null, '设备已登出');
  }

  async getLoginKey(req, res) {
    const loginKey = await TenantUserLoginKey.findOne({
      userId: req.user.id,
      tenantId: req.tenantId,
      revokedAt: null,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    }).lean();
    if (!loginKey) return ok(res, null);
    return ok(res, {
      id: String(loginKey._id),
      keyId: loginKey.keyId,
      prefix: `kf_${loginKey.keyId}_`,
      suffix: '',
      summary: `kf_${loginKey.keyId}_••••••••`,
      maskedKey: `kf_${loginKey.keyId}_••••••••`,
      source: loginKey.source,
      createdAt: loginKey.createdAt,
      expiresAt: loginKey.expiresAt,
    });
  }

  async generateLoginKey(req, res) {
    const { key, loginKey, expiresAt, expiresIn } = await generateTemporaryLoginKey({
      tenantId: req.tenantId,
      userId: req.user.id,
      source: 'tenant',
    });
    recordOperation({ req, tenantId: req.tenantId, user: req.user, action: 'generate_login_key', detail: '生成 120 秒临时登录密钥' });
    return ok(res, {
      key,
      loginKey: key,
      expiresAt,
      expiresIn,
      loginKeyInfo: {
        id: String(loginKey._id),
        keyId: loginKey.keyId,
        prefix: `kf_${loginKey.keyId}_`,
        summary: `kf_${loginKey.keyId}_••••••••`,
        maskedKey: `kf_${loginKey.keyId}_••••••••`,
        source: loginKey.source,
        createdAt: loginKey.createdAt,
        expiresAt,
        expiresIn,
      },
    }, '临时登录密钥已生成');
  }

  async revokeLoginKey(req, res) {
    const result = await TenantUserLoginKey.updateOne(
      { userId: req.user.id, tenantId: req.tenantId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    if (result.modifiedCount) recordOperation({ req, tenantId: req.tenantId, user: req.user, action: 'revoke_login_key', detail: '撤销登录密钥' });
    return ok(res, null, '登录密钥已撤销');
  }

  async logout(req, res) {
    await revokeSession({
      sessionId: req.user.sid,
      tenantId: req.tenantId,
      userId: req.user.id,
      revokedBy: req.user.id,
      reason: '当前设备退出登录',
      io: req.app.get('io'),
    });
    return ok(res, null, '已退出');
  }

  async updateProfile(req, res) {
    const user = await TenantUser.findById(req.user.id);
    if (!user) return error(res, '账号不存在', 404, 404);
    const { displayName, avatarUrl, qq } = req.body || {};
    if (displayName !== undefined) {
      const name = String(displayName).trim();
      if (!name) return error(res, '昵称不能为空');
      if (name.length > 50) return error(res, '昵称最多 50 字');
      user.displayName = name;
    }
    if (avatarUrl !== undefined) user.avatarUrl = String(avatarUrl).trim();
    if (qq !== undefined) {
      if (!requireOwner(req, res)) return;
      const normalizedQQ = String(qq).trim();
      if (normalizedQQ && !/^[1-9]\d{4,11}$/.test(normalizedQQ)) return error(res, 'QQ号格式不正确');
      await Tenant.updateOne({ _id: req.tenantId }, { $set: { qq: normalizedQQ } });
    }
    await user.save();
    const tenant = await Tenant.findById(req.tenantId);
    const token = await signForSession(user, req.user.sid);
    if (!token) return error(res, '登录会话已失效，请重新登录', 4012, 401);
    recordOperation({ req, tenantId: req.tenantId, user, action: 'update_profile', detail: '修改个人资料' });
    return ok(res, { token, user: user.toJSON(), tenant: tenant.toJSON() }, '资料已更新');
  }

  async sendProfileEmailCode(req, res) {
    if (!requireOwner(req, res)) return;
    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant) return error(res, '租户不存在', 404, 404);
    const purpose = req.body.purpose;
    const email = purpose === 'change-email' ? normalizeEmail(req.body.email) : tenant.email;
    if (purpose === 'change-email' && await emailInUse(email, tenant._id)) return error(res, '邮箱已被使用');
    const result = await sendEmailCode({ scope: `tenant-profile:${tenant._id}:${purpose}`, email, subject: '租户资料安全验证码', action: purpose === 'change-email' ? '修改邮箱' : '修改密码' });
    if (!result.ok) return error(res, result.message, result.code, result.status);
    return ok(res, null, '验证码已发送');
  }

  async updateEmail(req, res) {
    if (!requireOwner(req, res)) return;
    const email = normalizeEmail(req.body.email);
    if (await emailInUse(email, req.tenantId)) return error(res, '邮箱已被使用');
    const valid = await verifyEmailCode({ scope: `tenant-profile:${req.tenantId}:change-email`, email, code: req.body.emailCode });
    if (!valid) return error(res, '邮箱验证码错误或已过期', 4004, 400);
    const tenant = await Tenant.findByIdAndUpdate(req.tenantId, { email }, { new: true, runValidators: true });
    recordOperation({ req, tenantId: req.tenantId, user: req.user, action: 'update_email', detail: '修改租户邮箱' });
    return ok(res, tenant.toJSON(), '邮箱修改成功');
  }

  async updatePassword(req, res) {
    if (!requireOwner(req, res)) return;
    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant) return error(res, '租户不存在', 404, 404);
    if (!comparePassword(req.body.currentPassword, tenant.password)) return error(res, '当前密码错误', 4001, 400);
    if (comparePassword(req.body.newPassword, tenant.password)) return error(res, '新密码不能与当前密码相同', 4002, 400);
    const valid = await verifyEmailCode({ scope: `tenant-profile:${tenant._id}:change-password`, email: tenant.email, code: req.body.emailCode });
    if (!valid) return error(res, '邮箱验证码错误或已过期', 4004, 400);
    const password = hashPassword(req.body.newPassword);
    tenant.password = password;
    await tenant.save();
    await TenantUser.updateOne({ tenantId: tenant._id, role: 'owner' }, { $set: { password } });
    // 修改密码后断开所有者现有连接，旧凭证将无法继续接收实时消息
    req.app.get('io')?.in(`agent-${req.user.id}`).disconnectSockets(true);
    recordOperation({ req, tenantId: req.tenantId, user: req.user, action: 'update_password', detail: '修改登录密码' });
    return ok(res, null, '密码修改成功，请使用新密码登录');
  }

  async sendResetCode(req, res) {
    const email = normalizeEmail(req.body.email);
    const tenant = await Tenant.findOne({ email });
    if (tenant) {
      const result = await sendEmailCode({ scope: 'tenant-reset-password', email, subject: '租户找回密码验证码', action: '找回密码' });
      if (!result.ok) return error(res, result.message, result.code, result.status);
    }
    return ok(res, null, '如邮箱已注册，验证码将发送至该邮箱');
  }

  async resetPassword(req, res) {
    const email = normalizeEmail(req.body.email);
    const tenant = await Tenant.findOne({ email });
    const valid = await verifyEmailCode({ scope: 'tenant-reset-password', email, code: req.body.emailCode });
    if (!tenant || !valid) return error(res, '邮箱验证码错误或已过期', 4004, 400);
    const password = hashPassword(req.body.newPassword);
    tenant.password = password;
    await tenant.save();
    await TenantUser.updateOne({ tenantId: tenant._id, role: 'owner' }, { $set: { password } });
    return ok(res, null, '密码已重置，请使用新密码登录');
  }
}

module.exports = new TenantAuthController();
