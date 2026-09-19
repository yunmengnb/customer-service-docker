// 忆梦云团队开发 - 投诉提交与管理
const mongoose = require('mongoose');
const Complaint = require('../models/Complaint');
const Conversation = require('../models/Conversation');
const Customer = require('../models/Customer');
const CustomerAccount = require('../models/CustomerAccount');
const Tenant = require('../models/Tenant');
const Channel = require('../models/Channel');
const TenantUser = require('../models/TenantUser');
const crypto = require('crypto');
const config = require('../config');
const cache = require('../utils/cache');
const { sendMail } = require('../utils/mailer');
const { ok, error, getClientIp } = require('../utils');

const CATEGORIES = ['platform', 'agent'];
const STATUSES = ['pending', 'processing', 'resolved'];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function signImage(context, url) {
  const { customerId, accountId, tenantId, channelId, conversationId } = context;
  return crypto.createHmac('sha256', config.jwt.secret)
    .update(`${customerId}:${accountId}:${tenantId}:${channelId}:${conversationId}:${url}`)
    .digest('hex');
}

function hasValidSignature(signature, expected) {
  if (!/^[a-f0-9]{64}$/.test(signature) || signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

async function resolveCustomerContext(payload) {
  const { id: customerId, accountId, tenantId, channelId, conversationId } = payload;
  const contextIds = [customerId, accountId, tenantId, channelId, conversationId];
  if (!contextIds.every(value => mongoose.isValidObjectId(value))) return null;
  const [conversation, customer, account, tenant, channel] = await Promise.all([
    Conversation.findOne({ _id: conversationId, tenantId, channelId, customerId }).lean(),
    Customer.findOne({ _id: customerId, accountId, tenantId, channelId }).lean(),
    CustomerAccount.findOne({ _id: accountId, status: 'active' }).lean(),
    Tenant.findOne({ _id: tenantId, status: 'active' }).select('_id name').lean(),
    Channel.findOne({ _id: channelId, tenantId }).select('_id name brandName').lean(),
  ]);
  if (!conversation || !customer || !account || !tenant || !channel || customer.blocked) return null;
  return { customerId, accountId, tenantId, channelId, conversationId, conversation, customer, account, tenant, channel };
}

class ComplaintController {
  async sendEmailCode(req, res) {
    const context = await resolveCustomerContext(req.customer);
    if (!context) return error(res, '当前客户会话无效，请重新登录', 4012, 401);
    const { accountId, account } = context;
    if (!account.email) return error(res, '当前登录账号未绑定邮箱');

    const email = String(account.email).trim().toLowerCase();
    const key = `customer:complaint-code:${accountId}`;
    const existing = await cache.getJson(key);
    if (existing?.sentAt && Date.now() - existing.sentAt < 60000) {
      return error(res, '验证码发送过于频繁，请稍后再试', 4290, 429);
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = crypto.createHmac('sha256', config.jwt.secret).update(`${accountId}:${email}:${code}`).digest('hex');
    try {
      const sent = await sendMail({
        to: email,
        subject: '投诉提交邮箱验证码',
        text: `您的投诉提交验证码是 ${code}，10分钟内有效。如非本人操作，请忽略本邮件。`,
      });
      if (!sent) return error(res, '邮箱服务暂不可用', 5031, 503);
      await cache.setJson(key, { codeHash, sentAt: Date.now() }, 600);
      return ok(res, null, '验证码已发送');
    } catch (_) {
      return error(res, '验证码发送失败，请稍后重试', 5001, 500);
    }
  }

  async create(req, res) {
    const subject = String(req.body.subject || '').trim();
    const content = String(req.body.content || '').trim();
    const category = String(req.body.category || '');
    const images = Array.isArray(req.body.images) ? req.body.images.map(String) : [];
    const imageSignatures = Array.isArray(req.body.imageSignatures) ? req.body.imageSignatures.map(String) : [];
    const context = await resolveCustomerContext(req.customer);
    if (!context) return error(res, '当前客户会话无效，请重新登录', 4012, 401);
    const { customerId, accountId, tenantId, conversation, customer, account, tenant, channel } = context;

    if (!CATEGORIES.includes(category)) return error(res, '投诉类型无效');
    if (!subject || subject.length > 100) return error(res, '投诉标题须为1-100字');
    if (!content || content.length > 5000) return error(res, '投诉内容须为1-5000字');
    const imagePattern = new RegExp(`^/uploads/${tenantId}/complaints/[\\w.-]+$`);
    if (images.length > 5 || images.length !== imageSignatures.length || images.some((url, index) => (
      !imagePattern.test(url) || !hasValidSignature(imageSignatures[index], signImage(context, url))
    ))) {
      return error(res, '投诉图片无效，最多上传5张');
    }

    const agent = conversation.assignedAgentId
      ? await TenantUser.findOne({ _id: conversation.assignedAgentId, tenantId }).select('_id displayName username').lean()
      : null;
    if (category === 'agent' && !agent) return error(res, '当前会话尚无接待客服，不能投诉客服');

    const email = String(account.email || '').trim().toLowerCase();
    const emailCode = String(req.body.emailCode || '').trim();
    const codeKey = `customer:complaint-code:${accountId}`;
    const verification = await cache.consumeJson(codeKey);
    const submittedHash = crypto.createHmac('sha256', config.jwt.secret).update(`${accountId}:${email}:${emailCode}`).digest('hex');
    if (!/^\d{6}$/.test(emailCode) || !verification?.codeHash || verification.codeHash.length !== submittedHash.length
      || !crypto.timingSafeEqual(Buffer.from(verification.codeHash), Buffer.from(submittedHash))) {
      return error(res, '邮箱验证码错误或已过期', 4005, 400);
    }

    const complaint = await Complaint.create({
      conversationId: conversation._id,
      tenantSnapshot: { id: tenant._id, name: tenant.name },
      agentSnapshot: agent ? { id: agent._id, displayName: agent.displayName, username: agent.username } : {},
      channelSnapshot: { id: channel._id, name: channel.name, brandName: channel.brandName },
      customerSnapshot: {
        id: customer._id,
        accountId: account._id,
        phone: account.phone,
        email: account.email,
        qq: account.qq,
        nickname: account.nickname,
      },
      category,
      subject,
      content,
      images,
      submittedIp: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
    });
    res.status(201);
    return ok(res, { id: complaint._id, status: complaint.status }, '投诉提交成功');
  }

  async adminList(req, res) {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const where = {};
    if (STATUSES.includes(req.query.status)) where.status = req.query.status;
    if (CATEGORIES.includes(req.query.category)) where.category = req.query.category;
    const keyword = String(req.query.keyword || '').trim();
    if (keyword) {
      const pattern = escapeRegExp(keyword);
      where.$or = [
        { 'customerSnapshot.email': { $regex: pattern, $options: 'i' } },
        { 'customerSnapshot.phone': { $regex: pattern, $options: 'i' } },
        { 'tenantSnapshot.name': { $regex: pattern, $options: 'i' } },
        { 'channelSnapshot.name': { $regex: pattern, $options: 'i' } },
        { subject: { $regex: pattern, $options: 'i' } },
        { content: { $regex: pattern, $options: 'i' } },
      ];
    }
    const [items, total] = await Promise.all([
      Complaint.find(where).select('-submittedIp -userAgent').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Complaint.countDocuments(where),
    ]);
    return ok(res, { items, total, page, limit });
  }

  async adminDetail(req, res) {
    if (!mongoose.isValidObjectId(req.params.id)) return error(res, '投诉 ID 无效');
    const item = await Complaint.findById(req.params.id).lean();
    if (!item) return error(res, '投诉不存在', 404, 404);
    return ok(res, item);
  }

  async updateStatus(req, res) {
    if (!mongoose.isValidObjectId(req.params.id)) return error(res, '投诉 ID 无效');
    const status = String(req.body.status || '');
    if (!STATUSES.includes(status)) return error(res, '投诉状态无效');
    const item = await Complaint.findByIdAndUpdate(req.params.id, { status }, { new: true }).lean();
    if (!item) return error(res, '投诉不存在', 404, 404);
    return ok(res, item, '投诉状态已更新');
  }
}

module.exports = new ComplaintController();
