// 忆梦云团队开发
const { verifyToken, error, passwordVersion } = require('../utils');
const PlatformAdmin = require('../models/PlatformAdmin');
const Tenant = require('../models/Tenant');
const TenantUser = require('../models/TenantUser');
const Customer = require('../models/Customer');
const CustomerAccount = require('../models/CustomerAccount');
const Channel = require('../models/Channel');

/**
 * 平台管理员认证中间件
 * 同时检查 token 合法性 + admin 是否活跃
 */
async function authAdmin(req, res, next, verifiedIdentity = null) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  
  if (!token && !verifiedIdentity) {
    return error(res, '未登录', 4011, 401);
  }
  
  const payload = verifiedIdentity || verifyToken(token);
  if (!payload || payload.type !== 'admin') {
    return error(res, '令牌无效或已过期', 4012, 401);
  }
  
  // 查数据库确认账号状态不被禁用
  try {
    const admin = await PlatformAdmin.findById(payload.id);
    if (!admin) {
      return error(res, '账号不存在', 4012, 401);
    }
    if (admin.status !== 'active') {
      return error(res, '账号已被禁用', 4032, 403);
    }
    if (payload.pv && passwordVersion(admin.password) !== payload.pv) {
      return error(res, '令牌已失效，请重新登录', 4012, 401);
    }
    // 用数据库最新数据覆盖 payload，防止 role 变更后 token 内信息过期
    req.admin = { ...payload, role: admin.role, status: admin.status };
  } catch (e) {
    return error(res, '服务异常', 5001, 500);
  }
  
  next();
}

/**
 * 必须超级管理员才能访问
 */
function requireSuperAdmin(req, res, next) {
  if (!req.admin) {
    return error(res, '未登录', 4011, 401);
  }
  if (req.admin.role !== 'super') {
    return error(res, '需要超级管理员权限', 4033, 403);
  }
  next();
}

/**
 * 租户用户认证中间件（包含所有者/管理员/员工）
 */
async function authTenantUser(req, res, next, verifiedIdentity = null) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  
  if (!token && !verifiedIdentity) {
    return error(res, '未登录', 4011, 401);
  }
  
  const payload = verifiedIdentity || verifyToken(token);
  if (!payload || payload.type !== 'tenant_user') {
    return error(res, '令牌无效或已过期', 4012, 401);
  }

  try {
    const user = await TenantUser.findOne({ _id: payload.id, tenantId: payload.tenantId });
    if (!user) return error(res, '账号不存在', 4012, 401);
    if (user.status !== 'active') return error(res, '账号已被禁用', 4032, 403);
    if (payload.pv && passwordVersion(user.password) !== payload.pv) {
      return error(res, '令牌已失效，请重新登录', 4012, 401);
    }

    const tenant = await Tenant.findById(user.tenantId);
    if (!tenant || !['active', 'trial'].includes(tenant.status)) {
      return error(res, '所属租户已被禁用', 4032, 403);
    }

    req.user = {
      ...payload,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
    };
    req.tenantId = user.tenantId.toString();
    next();
  } catch (e) {
    return error(res, '服务异常', 5001, 500);
  }
}

/**
 * 仅管理员（所有者/角色为 admin）可访问
 */
function requireTenantAdmin(req, res, next) {
  if (!req.user) {
    return error(res, '未登录', 4011, 401);
  }
  if (req.user.role !== 'owner' && req.user.role !== 'admin') {
    return error(res, '权限不足', 4031, 403);
  }
  next();
}

function requireTenantOwner(req, res, next) {
  if (!req.user) {
    return error(res, '未登录', 4011, 401);
  }
  if (req.user.role !== 'owner') {
    return error(res, '需要租户所有者权限', 4031, 403);
  }
  next();
}

/**
 * 客户认证中间件
 */
async function authCustomer(req, res, next, verifiedIdentity = null) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token && !verifiedIdentity) return error(res, '未登录', 4011, 401);
  const payload = verifiedIdentity || verifyToken(token);
  if (!payload || payload.type !== 'customer') return error(res, '令牌无效或已过期', 4012, 401);

  try {
    // 纯账号令牌仍可访问账号中心；带聊天上下文的令牌必须对应有效渠道和租户。
    if (payload.id || payload.channelId || payload.tenantId) {
      if (!payload.id || !payload.channelId || !payload.tenantId) return error(res, '客户上下文无效', 4012, 401);
      const [channel, tenant] = await Promise.all([
        Channel.findOne({ _id: payload.channelId, tenantId: payload.tenantId }).select('_id'),
        Tenant.findOne({ _id: payload.tenantId, status: { $in: ['active', 'trial'] } }).select('_id'),
      ]);
      if (!channel || !tenant) return error(res, '渠道不存在或已不可用', 4035, 403);
    }
    if (payload.identity === 'guest') {
      const binding = await Customer.findOne({
        _id: payload.id,
        accountId: null,
        tenantId: payload.tenantId,
        channelId: payload.channelId,
        identityType: 'guest',
        status: 'active',
        blocked: false,
      }).select('_id');
      if (!binding) return error(res, '访客身份无效或已绑定，请重新进入', 4012, 401);
      req.customer = payload;
      req.tenantId = payload.tenantId;
      return next();
    }
    let legacyBinding = null;
    let accountId = payload.accountId;
    if (!accountId && payload.id) {
      legacyBinding = await Customer.findOne({
        _id: payload.id,
        tenantId: payload.tenantId,
        channelId: payload.channelId,
        identityType: 'customer',
        status: 'active',
        blocked: false,
      });
      accountId = legacyBinding?.accountId;
      if (legacyBinding && !accountId) {
        let migrated = await CustomerAccount.findOne({ phone: legacyBinding.phone });
        if (!migrated) {
          const accountData = {
            phone: legacyBinding.phone,
            password: legacyBinding.password,
            qq: legacyBinding.qq,
            email: legacyBinding.email,
            nickname: legacyBinding.nickname,
            avatarUrl: legacyBinding.avatarUrl,
            registerIp: legacyBinding.registerIp,
            registerUserAgent: legacyBinding.registerUserAgent,
            registerFingerprintHash: legacyBinding.registerFingerprintHash,
            lastLoginIp: legacyBinding.lastLoginIp,
            lastLoginAt: legacyBinding.lastLoginAt,
            status: legacyBinding.status,
          };
          try {
            migrated = await CustomerAccount.create(accountData);
          } catch (err) {
            if (err?.code !== 11000) throw err;
            migrated = await CustomerAccount.findOne({ phone: legacyBinding.phone });
            if (!migrated && legacyBinding.email) {
              accountData.email = '';
              try {
                migrated = await CustomerAccount.create(accountData);
              } catch (retryErr) {
                if (retryErr?.code !== 11000) throw retryErr;
                migrated = await CustomerAccount.findOne({ phone: legacyBinding.phone });
              }
            }
          }
        }
        // 旧 JWT 无法证明现有全局账户的密码；仅接受完全相同的迁移凭据。
        if (migrated && (!legacyBinding.password || migrated.password !== legacyBinding.password)) {
          return error(res, '账号凭据已变更，请重新登录', 4012, 401);
        }
        if (migrated) {
          legacyBinding.accountId = migrated._id;
          await legacyBinding.save();
          accountId = migrated._id;
        }
      }
    }
    const account = await CustomerAccount.findOne({ _id: accountId, status: 'active' }).select('_id password');
    if (!account) return error(res, '账号已被禁用或不存在', 4032, 403);
    if (payload.pv && passwordVersion(account.password) !== payload.pv) {
      return error(res, '令牌已失效，请重新登录', 4012, 401);
    }
    if (payload.id) {
      const binding = await Customer.findOne({
        _id: payload.id,
        accountId: account._id,
        tenantId: payload.tenantId,
        channelId: payload.channelId,
        status: 'active',
        blocked: false,
      }).select('_id');
      if (!binding) return error(res, '当前账号已被限制访问', 4035, 403);
    }
    req.customer = { ...payload, identity: 'customer', accountId: account._id.toString() };
    req.tenantId = payload.tenantId;
    next();
  } catch (_) {
    return error(res, '服务异常', 5001, 500);
  }
}

/**
 * 私有文件统一认证，根据令牌类型复用现有数据库回查鉴权。
 */
async function authAny(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload) return error(res, '未登录', 4011, 401);
  if (payload.type === 'admin') return authAdmin(req, res, next);
  if (payload.type === 'tenant_user') return authTenantUser(req, res, next);
  if (payload.type === 'customer') return authCustomer(req, res, next);
  return error(res, '令牌无效或已过期', 4012, 401);
}

/**
 * 可选认证（未登录也可访问，但如果登录了会注入用户信息）
 */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      if (payload.type === 'admin') req.admin = payload;
      else if (payload.type === 'tenant_user') { req.user = payload; req.tenantId = payload.tenantId; }
      else if (payload.type === 'customer') { req.customer = payload; req.tenantId = payload.tenantId; }
    }
  }
  next();
}

/**
 * 请求 ID 生成
 */
function requestId(req, res, next) {
  res.locals.requestId = crypto.randomUUID();
  next();
}

const crypto = require('crypto');

module.exports = {
  authAdmin,
  requireSuperAdmin,
  authTenantUser,
  requireTenantAdmin,
  requireTenantOwner,
  authCustomer,
  authAny,
  optionalAuth,
  requestId,
};
