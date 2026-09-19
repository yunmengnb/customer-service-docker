// 忆梦云团队开发
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const TenantPointTransaction = require('../models/TenantPointTransaction');
const { ok, error } = require('../utils');

const PLAN_LIMIT_FIELDS = ['agentLimit', 'channelLimit', 'messageRetentionDays', 'attachmentLimitMB'];
const MEMBERSHIP_FIELDS = new Set(['plan', 'membershipStatus', 'expiresAt']);
const PLAN_FIELDS = new Set(['code', 'name', ...PLAN_LIMIT_FIELDS]);

function displayMembershipStatus(tenant) {
  if (tenant.membershipStatus === 'suspended') return 'suspended';
  if (tenant.expiresAt && tenant.expiresAt.getTime() <= Date.now()) return 'expired';
  return tenant.membershipStatus === 'expired' ? 'expired' : 'active';
}

function accountData(tenant) {
  return {
    tenant: {
      id: tenant._id,
      name: tenant.name,
      username: tenant.username,
      email: tenant.email,
      status: tenant.status,
    },
    membership: {
      status: displayMembershipStatus(tenant),
      configuredStatus: tenant.membershipStatus,
      expiresAt: tenant.expiresAt || null,
    },
    points: { balance: tenant.pointsBalance },
    plan: tenant.plan,
  };
}

class AdminTenantAccountController {
  async account(req, res) {
    if (!mongoose.isValidObjectId(req.params.id)) return error(res, '租户 ID 无效');
    const tenant = await Tenant.findOne({ _id: req.params.id });
    if (!tenant) return error(res, '租户不存在', 404, 404);
    return ok(res, accountData(tenant));
  }

  async updateMembership(req, res) {
    if (!mongoose.isValidObjectId(req.params.id)) return error(res, '租户 ID 无效');
    const body = req.body || {};
    const bodyKeys = Object.keys(body);
    if (!bodyKeys.length || bodyKeys.some(key => !MEMBERSHIP_FIELDS.has(key))) {
      return error(res, '会员更新字段无效');
    }

    const updates = {};
    if (body.membershipStatus !== undefined) {
      if (!['active', 'expired', 'suspended'].includes(body.membershipStatus)) return error(res, '会员状态无效');
      updates.membershipStatus = body.membershipStatus;
    }
    if (body.expiresAt !== undefined) {
      if (body.expiresAt === null) {
        updates.expiresAt = null;
      } else {
        const expiresAt = new Date(body.expiresAt);
        if (Number.isNaN(expiresAt.getTime())) return error(res, '到期时间无效');
        updates.expiresAt = expiresAt;
      }
    }
    if (body.plan !== undefined) {
      if (!body.plan || typeof body.plan !== 'object' || Array.isArray(body.plan)) return error(res, '套餐参数无效');
      const planKeys = Object.keys(body.plan);
      if (!planKeys.length || planKeys.some(key => !PLAN_FIELDS.has(key))) return error(res, '套餐字段无效');
      for (const field of ['code', 'name']) {
        if (body.plan[field] === undefined) continue;
        if (typeof body.plan[field] !== 'string') return error(res, `plan.${field}须为字符串`);
        const value = body.plan[field].trim();
        if (!value || value.length > 50) return error(res, `plan.${field}须为1-50个字符`);
        updates[`plan.${field}`] = value;
      }
      for (const field of PLAN_LIMIT_FIELDS) {
        if (body.plan[field] === undefined) continue;
        const value = body.plan[field];
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
          return error(res, `plan.${field}须为非负安全整数`);
        }
        updates[`plan.${field}`] = value;
      }
    }

    const tenant = await Tenant.findOneAndUpdate(
      { _id: req.params.id },
      { $set: updates },
      { new: true, runValidators: true },
    );
    if (!tenant) return error(res, '租户不存在', 404, 404);
    return ok(res, accountData(tenant), '会员信息已更新');
  }

  async adjustPoints(req, res) {
    if (!mongoose.isValidObjectId(req.params.id)) return error(res, '租户 ID 无效');
    const { delta, reason } = req.body || {};
    if (typeof delta !== 'number' || !Number.isSafeInteger(delta) || delta === 0) {
      return error(res, 'delta须为非零安全整数');
    }
    const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
    if (!normalizedReason || normalizedReason.length > 500) return error(res, 'reason必填且不能超过500个字符');
    const idempotencyKey = req.body.idempotencyKey === undefined ? undefined : String(req.body.idempotencyKey).trim();
    if (idempotencyKey !== undefined && (!idempotencyKey || idempotencyKey.length > 200)) {
      return error(res, 'idempotencyKey须为1-200个字符');
    }

    if (idempotencyKey) {
      const existing = await TenantPointTransaction.findOne({ tenantId: req.params.id, idempotencyKey });
      if (existing) return ok(res, { transaction: existing, balance: existing.balanceAfter }, '积分已调整');
    }

    const session = await mongoose.startSession();
    let transaction;
    try {
      await session.withTransaction(async () => {
        if (idempotencyKey) {
          const existing = await TenantPointTransaction.findOne({ tenantId: req.params.id, idempotencyKey }).session(session);
          if (existing) {
            transaction = existing;
            return;
          }
        }

        const balanceCondition = delta < 0
          ? { pointsBalance: { $gte: -delta } }
          : { $or: [{ pointsBalance: { $exists: false } }, { pointsBalance: { $lte: Number.MAX_SAFE_INTEGER - delta } }] };
        const tenant = await Tenant.findOneAndUpdate(
          { _id: req.params.id, ...balanceCondition },
          { $inc: { pointsBalance: delta } },
          { new: true, runValidators: true, session },
        );
        if (!tenant) {
          const exists = await Tenant.exists({ _id: req.params.id }).session(session);
          const err = new Error(exists ? '积分余额不足或调整后超出安全整数范围' : '租户不存在');
          err.status = exists ? 400 : 404;
          throw err;
        }
        [transaction] = await TenantPointTransaction.create([{
          tenantId: tenant._id,
          delta,
          balanceAfter: tenant.pointsBalance,
          type: 'adjust',
          reason: normalizedReason,
          operatorType: 'platform_admin',
          operatorId: req.admin.id,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        }], { session });
      });
    } catch (err) {
      if (idempotencyKey && err?.code === 11000) {
        transaction = await TenantPointTransaction.findOne({ tenantId: req.params.id, idempotencyKey });
        if (transaction) return ok(res, { transaction, balance: transaction.balanceAfter }, '积分已调整');
      }
      if (err.status) return error(res, err.message, err.status, err.status);
      throw err;
    } finally {
      await session.endSession();
    }
    return ok(res, { transaction, balance: transaction.balanceAfter }, '积分已调整');
  }

  async transactions(req, res) {
    if (!mongoose.isValidObjectId(req.params.id)) return error(res, '租户 ID 无效');
    const exists = await Tenant.exists({ _id: req.params.id });
    if (!exists) return error(res, '租户不存在', 404, 404);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const where = { tenantId: req.params.id };
    const [items, total] = await Promise.all([
      TenantPointTransaction.find(where).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      TenantPointTransaction.countDocuments(where),
    ]);
    return ok(res, { items, total, page, limit });
  }
}

module.exports = new AdminTenantAccountController();
