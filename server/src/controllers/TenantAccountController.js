// 忆梦云团队开发
const Tenant = require('../models/Tenant');
const TenantUser = require('../models/TenantUser');
const Channel = require('../models/Channel');
const Customer = require('../models/Customer');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const KeywordReply = require('../models/KeywordReply');
const QuickReply = require('../models/QuickReply');
const ConversationAttachment = require('../models/ConversationAttachment');
const TenantPointTransaction = require('../models/TenantPointTransaction');
const { ok, error } = require('../utils');

function quota(used, limit) {
  const remaining = Math.max(0, limit - used);
  return {
    used,
    limit,
    remaining,
    percent: limit === 0 ? (used === 0 ? 0 : 100) : Math.min(100, Number(((used / limit) * 100).toFixed(2))),
  };
}

function membershipStatus(tenant) {
  if (tenant.membershipStatus === 'suspended') return 'suspended';
  if (tenant.expiresAt && tenant.expiresAt.getTime() <= Date.now()) return 'expired';
  return tenant.membershipStatus === 'expired' ? 'expired' : 'active';
}

class TenantAccountController {
  async overview(req, res) {
    const tenantId = req.tenantId;
    const tenant = await Tenant.findOne({ _id: tenantId });
    if (!tenant) return error(res, '租户不存在', 404, 404);

    const validAttachmentWhere = {
      tenantId: tenant._id,
      status: 'active',
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    };
    const [employees, channels, customers, conversations, messages, keywords, quickReplies, attachments, oldestMessage] = await Promise.all([
      TenantUser.countDocuments({ tenantId, role: { $ne: 'owner' } }),
      Channel.countDocuments({ tenantId }),
      Customer.countDocuments({ tenantId }),
      Conversation.countDocuments({ tenantId }),
      Message.countDocuments({ tenantId }),
      KeywordReply.countDocuments({ tenantId }),
      QuickReply.countDocuments({ tenantId }),
      ConversationAttachment.aggregate([
        { $match: validAttachmentWhere },
        { $group: { _id: null, count: { $sum: 1 }, sizeBytes: { $sum: '$size' } } },
      ]),
      Message.findOne({ tenantId }).sort({ createdAt: 1 }).select('createdAt').lean(),
    ]);

    const attachment = attachments[0] || { count: 0, sizeBytes: 0 };
    const attachmentLimitBytes = tenant.plan.attachmentLimitMB * 1024 * 1024;
    const retainedDays = oldestMessage
      ? Math.max(0, Math.ceil((Date.now() - new Date(oldestMessage.createdAt).getTime()) / 86400000))
      : 0;

    return ok(res, {
      tenant: {
        id: tenant._id,
        name: tenant.name,
        username: tenant.username,
        email: tenant.email,
        status: tenant.status,
      },
      membership: {
        status: membershipStatus(tenant),
        configuredStatus: tenant.membershipStatus,
        expiresAt: tenant.expiresAt || null,
      },
      points: { balance: tenant.pointsBalance },
      plan: tenant.plan,
      usage: {
        employees: quota(employees, tenant.plan.agentLimit),
        channels: quota(channels, tenant.plan.channelLimit),
        messageRetentionDays: quota(retainedDays, tenant.plan.messageRetentionDays),
        attachments: {
          ...quota(attachment.sizeBytes, attachmentLimitBytes),
          count: attachment.count,
          usedBytes: attachment.sizeBytes,
          limitBytes: attachmentLimitBytes,
          remainingBytes: Math.max(0, attachmentLimitBytes - attachment.sizeBytes),
          usedMB: Number((attachment.sizeBytes / 1024 / 1024).toFixed(2)),
          limitMB: tenant.plan.attachmentLimitMB,
          remainingMB: Number((Math.max(0, attachmentLimitBytes - attachment.sizeBytes) / 1024 / 1024).toFixed(2)),
        },
        customers: { count: customers },
        conversations: { count: conversations },
        messages: { count: messages },
        keywords: { count: keywords },
        quickReplies: { count: quickReplies },
      },
    });
  }

  async transactions(req, res) {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const where = { tenantId: req.tenantId };
    const [items, total] = await Promise.all([
      TenantPointTransaction.find(where).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      TenantPointTransaction.countDocuments(where),
    ]);
    return ok(res, { items, total, page, limit });
  }
}

module.exports = new TenantAccountController();
