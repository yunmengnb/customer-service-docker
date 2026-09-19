// 忆梦云团队开发 - 平台客户管理
const CustomerAccount = require('../models/CustomerAccount');
const Customer = require('../models/Customer');
const { ok, error, hashPassword, normalizePhone, qqAvatarUrl } = require('../utils');

class AdminCustomerController {
  async list(req, res) {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const where = {};
    if (req.query.status) {
      if (!['active', 'disabled'].includes(req.query.status)) return error(res, '状态值无效');
      where.status = req.query.status;
    }
    const keyword = String(req.query.keyword || '').trim();
    if (keyword) {
      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matcher = { $regex: escapedKeyword, $options: 'i' };
      where.$or = [{ phone: matcher }, { nickname: matcher }, { qq: matcher }, { email: matcher }];
    }
    const [items, total] = await Promise.all([
      CustomerAccount.find(where).select('-password -registerFingerprintHash -registerUserAgent').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      CustomerAccount.countDocuments(where),
    ]);
    return ok(res, { items, total, page, limit });
  }

  async update(req, res) {
    const account = await CustomerAccount.findById(req.params.id);
    if (!account) return error(res, '客户不存在', 404, 404);
    const body = req.body || {};
    if (body.phone !== undefined) {
      const phone = normalizePhone(body.phone);
      if (!/^[\d+][\d+-]{5,19}$/.test(phone)) return error(res, '手机号格式不正确');
      if (await CustomerAccount.exists({ phone, _id: { $ne: account._id } })) return error(res, '手机号已被使用');
      account.phone = phone;
    }
    if (body.email !== undefined) {
      const email = String(body.email).trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) return error(res, '邮箱格式不正确');
      if (await CustomerAccount.exists({ email, _id: { $ne: account._id } })) return error(res, '邮箱已被使用');
      account.email = email;
    }
    if (body.qq !== undefined) {
      const qq = String(body.qq).trim();
      if (qq && !/^[1-9]\d{4,11}$/.test(qq)) return error(res, 'QQ号格式不正确');
      const previousQQAvatar = qqAvatarUrl(account.qq);
      account.qq = qq;
      if (!account.avatarUrl || account.avatarUrl === previousQQAvatar) account.avatarUrl = '';
    }
    if (body.nickname !== undefined) {
      const nickname = String(body.nickname).trim();
      if (!nickname || nickname.length > 50) return error(res, '昵称须为1-50字');
      account.nickname = nickname;
    }
    if (body.password !== undefined) {
      if (typeof body.password !== 'string' || body.password.length < 6 || body.password.length > 72) return error(res, '密码须为6-72位');
      account.password = hashPassword(body.password);
    }
    if (body.status !== undefined) {
      if (!['active', 'disabled'].includes(body.status)) return error(res, '状态值无效');
      account.status = body.status;
    }
    try {
      await account.save();
    } catch (err) {
      if (err?.code === 11000) return error(res, '手机号或邮箱已被使用');
      throw err;
    }
    await Customer.updateMany({ accountId: account._id }, { $set: { phone: account.phone, email: account.email, qq: account.qq, nickname: account.nickname, avatarUrl: account.avatarUrl, password: account.password, status: account.status } });
    if (account.status === 'disabled') req.app.get('io')?.in(`customer-account-${account._id}`).disconnectSockets(true);
    return ok(res, account.toJSON(), '客户资料已更新');
  }

  async updateStatus(req, res) {
    req.body = { status: req.body.status };
    return AdminCustomerController.prototype.update(req, res);
  }
}

module.exports = new AdminCustomerController();
