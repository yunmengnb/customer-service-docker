// 忆梦云团队开发 - 平台数据管理（统计概览、历史清理、数据导出）
const Tenant = require('../models/Tenant');
const TenantUser = require('../models/TenantUser');
const CustomerAccount = require('../models/CustomerAccount');
const Customer = require('../models/Customer');
const Channel = require('../models/Channel');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const ConversationAttachment = require('../models/ConversationAttachment');
const AuditLog = require('../models/AuditLog');
const { ok, error } = require('../utils');

const EXPORT_TYPES = ['tenants', 'customers', 'conversations'];

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function csvCell(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

function toCsv(headers, rows) {
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}

class DataManagementController {
  // GET /api/admin/data/overview
  async overview(req, res) {
    const [
      tenantCount,
      activeTenants,
      agentCount,
      customerAccountCount,
      customerCount,
      channelCount,
      conversationCount,
      messageCount,
      loginLogCount,
      operationLogCount,
      attachmentStats,
    ] = await Promise.all([
      Tenant.countDocuments(),
      Tenant.countDocuments({ status: 'active' }),
      TenantUser.countDocuments(),
      CustomerAccount.countDocuments(),
      Customer.countDocuments(),
      Channel.countDocuments(),
      Conversation.countDocuments(),
      Message.countDocuments(),
      AuditLog.countDocuments({ type: 'login' }),
      AuditLog.countDocuments({ type: 'operation' }),
      ConversationAttachment.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, bytes: { $sum: '$size' } } },
      ]),
    ]);

    const attachments = {};
    let attachmentCount = 0;
    let attachmentBytes = 0;
    for (const row of attachmentStats) {
      attachments[row._id] = { count: row.count, bytes: row.bytes || 0 };
      attachmentCount += row.count || 0;
      attachmentBytes += row.bytes || 0;
    }

    return ok(res, {
      tenantCount,
      activeTenants,
      agentCount,
      customerAccountCount,
      customerCount,
      channelCount,
      conversationCount,
      messageCount,
      loginLogCount,
      operationLogCount,
      attachmentCount,
      attachmentBytes,
      attachments,
    });
  }

  // POST /api/admin/data/cleanup
  async cleanup(req, res) {
    const body = req.body || {};
    const cutoff = body.before ? new Date(body.before) : null;
    if (!cutoff || Number.isNaN(cutoff.getTime())) return error(res, '请选择有效的清理截止时间');

    const allowed = ['login_logs', 'operation_logs', 'conversations'];
    const types = Array.isArray(body.types) ? body.types.filter(type => allowed.includes(type)) : [];
    if (!types.length) return error(res, '请选择要清理的数据类型');

    const result = {
      loginLogs: 0,
      operationLogs: 0,
      conversations: 0,
      messages: 0,
      attachmentsMarked: 0,
    };

    if (types.includes('login_logs')) {
      result.loginLogs = (await AuditLog.deleteMany({ type: 'login', createdAt: { $lt: cutoff } })).deletedCount;
    }
    if (types.includes('operation_logs')) {
      result.operationLogs = (await AuditLog.deleteMany({ type: 'operation', createdAt: { $lt: cutoff } })).deletedCount;
    }
    if (types.includes('conversations')) {
      const conversations = await Conversation.find({
        status: 'closed',
        lastMessageAt: { $lt: cutoff },
      }).select('_id').lean();
      const conversationIds = conversations.map(item => item._id);
      if (conversationIds.length) {
        const attachmentResult = await ConversationAttachment.updateMany(
          { conversationId: { $in: conversationIds }, status: { $in: ['pending', 'active', 'deleting', 'failed'] } },
          {
            $set: {
              status: 'deleting',
              deleteAfter: new Date(),
              deleteReason: 'orphaned',
              cleanupLeaseUntil: null,
              cleanupLeaseId: '',
            },
          },
        );
        result.attachmentsMarked = attachmentResult.modifiedCount || 0;
        result.messages = (await Message.deleteMany({ conversationId: { $in: conversationIds } })).deletedCount;
        result.conversations = (await Conversation.deleteMany({ _id: { $in: conversationIds } })).deletedCount;
      }
    }

    return ok(res, result, '历史数据清理完成');
  }

  // GET /api/admin/data/export?type=tenants|customers|conversations&format=csv|json
  async exportData(req, res) {
    const type = String(req.query.type || 'tenants');
    const format = String(req.query.format || 'csv').toLowerCase();
    if (!EXPORT_TYPES.includes(type)) return error(res, '不支持的导出类型', 400, 400);
    if (!['csv', 'json'].includes(format)) return error(res, '不支持的导出格式', 400, 400);

    let headers;
    let rows;
    let filename;

    if (type === 'tenants') {
      const tenants = await Tenant.find().sort({ createdAt: -1 }).lean();
      headers = ['租户名称', '用户名', '邮箱', 'QQ', '员工上限', '渠道上限', '消息保留天数', '状态', '创建时间'];
      rows = tenants.map(item => [
        item.name,
        item.username,
        item.email,
        item.qq || '',
        item.plan?.agentLimit ?? '',
        item.plan?.channelLimit ?? '',
        item.plan?.messageRetentionDays ?? '',
        item.status,
        formatDate(item.createdAt),
      ]);
      filename = 'tenants';
    } else if (type === 'customers') {
      const customers = await CustomerAccount.find().sort({ createdAt: -1 }).lean();
      headers = ['手机号', 'QQ', '邮箱', '昵称', '状态', '注册时间', '最后登录时间'];
      rows = customers.map(item => [
        item.phone,
        item.qq || '',
        item.email || '',
        item.nickname || '',
        item.status,
        formatDate(item.createdAt),
        formatDate(item.lastLoginAt),
      ]);
      filename = 'customers';
    } else {
      const conversations = await Conversation.find()
        .sort({ createdAt: -1 })
        .limit(50000)
        .populate('tenantId', 'name')
        .populate('channelId', 'name brandName')
        .populate('customerId', 'phone qq nickname')
        .lean();
      headers = ['租户', '渠道', '客户手机号', '客户QQ', '客户昵称', '状态', '接待坐席ID', '最后消息时间', '创建时间'];
      rows = conversations.map(item => [
        item.tenantId?.name || '',
        item.channelId?.brandName || item.channelId?.name || '',
        item.customerId?.phone || '',
        item.customerId?.qq || '',
        item.customerId?.nickname || '',
        item.status,
        item.assignedAgentId ? String(item.assignedAgentId) : '',
        formatDate(item.lastMessageAt),
        formatDate(item.createdAt),
      ]);
      filename = 'conversations';
    }

    const objects = rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])));

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      return res.send(JSON.stringify(objects, null, 2));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send('\uFEFF' + toCsv(headers, rows));
  }
}

module.exports = new DataManagementController();
