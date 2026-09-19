// 忆梦云团队开发 - 平台会话只读查询
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Tenant = require('../models/Tenant');
const Channel = require('../models/Channel');
const Customer = require('../models/Customer');
const TenantUser = require('../models/TenantUser');
const { ok, error } = require('../utils');

const ALLOWED_STATUSES = ['waiting', 'active', 'closed'];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseDate(value, endOfDay = false) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  if (endOfDay) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

class AdminConversationController {
  // GET /api/admin/conversations
  async list(req, res) {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const where = {};

    if (req.query.status) {
      if (!ALLOWED_STATUSES.includes(req.query.status)) return error(res, '状态值无效');
      where.status = req.query.status;
    }

    for (const field of ['tenantId', 'channelId']) {
      if (req.query[field]) {
        if (!mongoose.isValidObjectId(req.query[field])) return error(res, `${field} 无效`);
        where[field] = req.query[field];
      }
    }

    const startDate = parseDate(String(req.query.startDate || ''));
    const endDate = parseDate(String(req.query.endDate || ''), true);
    if (startDate === undefined || endDate === undefined) return error(res, '日期格式无效');
    if (startDate && endDate && startDate >= endDate) return error(res, '开始日期不能晚于结束日期');
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.$gte = startDate;
      if (endDate) where.createdAt.$lt = endDate;
    }

    const keyword = String(req.query.keyword || '').trim().slice(0, 100);
    let searchMessageMap = {};
    if (keyword) {
      const keywordRegex = new RegExp(escapeRegex(keyword), 'i');
      const matcher = { $regex: escapeRegex(keyword), $options: 'i' };
      const [customerIds, tenantIds, channelIds, matchingMessages] = await Promise.all([
        Customer.find({
          $or: [{ phone: matcher }, { nickname: matcher }, { qq: matcher }, { email: matcher }],
        }).distinct('_id'),
        Tenant.find({ $or: [{ name: matcher }, { username: matcher }, { email: matcher }] }).distinct('_id'),
        Channel.find({ $or: [{ name: matcher }, { brandName: matcher }] }).distinct('_id'),
        Message.aggregate([
          {
            $match: {
              recalledAt: null,
              $or: [{ content: keywordRegex }, { attachmentName: keywordRegex }],
            },
          },
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: '$conversationId',
              count: { $sum: 1 },
              message: { $first: '$$ROOT' },
            },
          },
        ]),
      ]);
      searchMessageMap = Object.fromEntries(matchingMessages.map(item => [String(item._id), {
        count: item.count,
        message: Message.applyAttachmentUrls(item.message),
      }]));
      where.$or = [
        { customerId: { $in: customerIds } },
        { tenantId: { $in: tenantIds } },
        { channelId: { $in: channelIds } },
        { _id: { $in: matchingMessages.map(item => item._id) } },
      ];
      if (mongoose.isValidObjectId(keyword)) where.$or.push({ _id: keyword });
    }

    const channelOptionWhere = req.query.tenantId && mongoose.isValidObjectId(req.query.tenantId)
      ? { tenantId: req.query.tenantId }
      : {};

    const [items, total, tenantOptions, channelOptions] = await Promise.all([
      Conversation.find(where)
        .sort({ lastMessageAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Conversation.countDocuments(where),
      Tenant.find().select('_id name username').sort({ name: 1 }).lean(),
      Channel.find(channelOptionWhere).select('_id tenantId name brandName').sort({ name: 1 }).lean(),
    ]);

    const tenantIds = [...new Set(items.map(item => String(item.tenantId)))];
    const channelIds = [...new Set(items.map(item => String(item.channelId)))];
    const customerIds = [...new Set(items.map(item => String(item.customerId)))];
    const agentIds = [...new Set(items.filter(item => item.assignedAgentId).map(item => String(item.assignedAgentId)))];

    const [tenants, channels, customers, agents] = await Promise.all([
      Tenant.find({ _id: { $in: tenantIds } }).select('_id name username').lean(),
      Channel.find({ _id: { $in: channelIds } }).select('_id name brandName').lean(),
      Customer.find({ _id: { $in: customerIds } }).select('_id phone nickname qq email avatarUrl').lean(),
      TenantUser.find({ _id: { $in: agentIds } }).select('_id username displayName').lean(),
    ]);

    const toMap = records => Object.fromEntries(records.map(record => [String(record._id), record]));
    const tenantMap = toMap(tenants);
    const channelMap = toMap(channels);
    const customerMap = toMap(customers);
    const agentMap = toMap(agents);
    const result = items.map(item => ({
      ...item,
      tenant: tenantMap[String(item.tenantId)] || null,
      channel: channelMap[String(item.channelId)] || null,
      customer: customerMap[String(item.customerId)] || null,
      assignedAgent: item.assignedAgentId ? agentMap[String(item.assignedAgentId)] || null : null,
      searchMatch: searchMessageMap[String(item._id)] || null,
    }));

    return ok(res, {
      items: result,
      total,
      page,
      limit,
      filters: { tenants: tenantOptions, channels: channelOptions },
    });
  }

  // GET /api/admin/conversations/:id/messages/search
  async searchMessages(req, res) {
    if (!mongoose.isValidObjectId(req.params.id)) return error(res, '会话 ID 无效');
    const conversation = await Conversation.findById(req.params.id).select('_id tenantId').lean();
    if (!conversation) return error(res, '会话不存在', 404, 404);

    const keyword = String(req.query.keyword || '').trim().slice(0, 100);
    if (!keyword) return ok(res, { items: [], total: 0 });

    const keywordRegex = new RegExp(escapeRegex(keyword), 'i');
    const query = {
      conversationId: conversation._id,
      tenantId: conversation.tenantId,
      recalledAt: null,
      $or: [{ content: keywordRegex }, { attachmentName: keywordRegex }],
    };
    const [items, total] = await Promise.all([
      Message.find(query).sort({ createdAt: -1, _id: -1 }).limit(200),
      Message.countDocuments(query),
    ]);
    return ok(res, { items: items.map(message => message.toJSON()), total });
  }

  // GET /api/admin/conversations/:id/messages
  async messages(req, res) {
    if (!mongoose.isValidObjectId(req.params.id)) return error(res, '会话 ID 无效');
    const conversation = await Conversation.findById(req.params.id).select('_id tenantId').lean();
    if (!conversation) return error(res, '会话不存在', 404, 404);

    const beforeId = req.query.before;
    const aroundId = req.query.around;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const scope = { conversationId: conversation._id, tenantId: conversation.tenantId };
    const senderPopulate = { path: 'senderId', select: 'username displayName nickname avatarUrl' };

    if (aroundId) {
      if (!mongoose.isValidObjectId(aroundId)) return error(res, '无效的消息定位参数');
      const target = await Message.findOne({ ...scope, _id: aroundId }).populate(senderPopulate);
      if (!target) return error(res, '消息不存在', 404, 404);

      const olderLimit = Math.floor((limit - 1) / 2);
      const newerLimit = limit - 1 - olderLimit;
      const [older, newer] = await Promise.all([
        olderLimit ? Message.find({ ...scope, $or: [{ createdAt: { $lt: target.createdAt } }, { createdAt: target.createdAt, _id: { $lt: target._id } }] })
          .populate(senderPopulate)
          .sort({ createdAt: -1, _id: -1 })
          .limit(olderLimit) : [],
        newerLimit ? Message.find({ ...scope, $or: [{ createdAt: { $gt: target.createdAt } }, { createdAt: target.createdAt, _id: { $gt: target._id } }] })
          .populate(senderPopulate)
          .sort({ createdAt: 1, _id: 1 })
          .limit(newerLimit) : [],
      ]);
      return ok(res, [...older.reverse(), target, ...newer].map(message => message.toJSON()));
    }

    const query = { ...scope };
    if (beforeId) {
      if (!mongoose.isValidObjectId(beforeId)) return error(res, '无效的分页参数');
      const cursor = await Message.findOne({ ...scope, _id: beforeId });
      if (!cursor) return error(res, '消息游标不属于当前会话');
      query.$or = [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, _id: { $lt: cursor._id } }];
    }
    const items = await Message.find(query)
      .populate(senderPopulate)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit);
    return ok(res, items.reverse().map(message => message.toJSON()));
  }
}

module.exports = new AdminConversationController();
