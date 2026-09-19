// 忆梦云团队开发
const Channel = require('../models/Channel');
const IntegrationBinding = require('../models/IntegrationBinding');
const KeywordReply = require('../models/KeywordReply');
const QuickReply = require('../models/QuickReply');
const Tenant = require('../models/Tenant');
const TenantUser = require('../models/TenantUser');
const config = require('../config');
const cache = require('../utils/cache');
const { ok, error, generateToken } = require('../utils');
const { getSystemSettings, buildCustomerServiceLink } = require('../utils/systemSettings');
const { recordOperation } = require('../services/auditLogService');

function invalidateChannelConfig(...tokens) {
  return cache.remove(...tokens.map(token => token && `config:channel:token:${token}`));
}

function keywordRuntimeCacheKey(tenantId, channelId) {
  return `replies:keyword:runtime:${tenantId}:${channelId}`;
}

function keywordListCacheKey(tenantId, channelId) {
  return `replies:keyword:list:${tenantId}:${channelId}`;
}

function quickReplyListCacheKey(tenantId, channelId) {
  return `replies:quick:list:${tenantId}:${channelId}`;
}

function invalidateKeywordReplies(tenantId, channelId) {
  return cache.remove(
    keywordRuntimeCacheKey(tenantId, channelId),
    keywordListCacheKey(tenantId, channelId),
  );
}

function invalidateQuickReplies(tenantId, channelId) {
  return cache.remove(quickReplyListCacheKey(tenantId, channelId));
}

function channelScope(req, id) {
  const where = { _id: id, tenantId: req.tenantId };
  if (req.user.role === 'agent') where.agentIds = req.user.id;
  return where;
}

class ChannelController {
  // GET /api/tenant/channels
  async list(req, res) {
    const where = { tenantId: req.tenantId };
    if (req.user.role === 'agent') where.agentIds = req.user.id;
    const [channels, settings] = await Promise.all([
      Channel.find(where).sort({ createdAt: -1 }),
      getSystemSettings(),
    ]);
    return ok(res, channels.map(c => {
      const obj = c.toJSON();
      obj.link = buildCustomerServiceLink(settings, c.publicToken);
      return obj;
    }));
  }
  
  // POST /api/tenant/channels
  async create(req, res) {
    const { tenantId, user } = req;
    const tenant = await Tenant.findById(tenantId);
    
    // 数量限制
    const currentCount = await Channel.countDocuments({ tenantId });
    if (currentCount >= tenant.plan.channelLimit) {
      return error(res, '已达到渠道数量上限');
    }
    
    const { name, brandName, brandColor, welcomeMessage } = req.body;
    const publicToken = generateToken(24);
    
    const channel = await Channel.create({
      tenantId,
      name,
      publicToken,
      brandName: brandName || '在线客服',
      brandColor: brandColor || '#2563eb',
      welcomeMessage: welcomeMessage || '您好，欢迎咨询，请问有什么可以帮助您？',
      agentIds: user.role === 'owner' ? [] : [user.id],
      createdBy: user.id,
    });
    
    recordOperation({ req, tenantId, user, action: 'channel_create', detail: `新增渠道「${name}」` });
    return ok(res, channel.toJSON());
  }
  
  // GET /api/tenant/channels/:id
  async detail(req, res) {
    const channel = await Channel.findOne(channelScope(req, req.params.id));
    if (!channel) return error(res, '渠道不存在或无权访问', 404, 404);
    const obj = channel.toJSON();
    const settings = await getSystemSettings();
    obj.link = buildCustomerServiceLink(settings, channel.publicToken);
    const employees = await TenantUser.find({ _id: { $in: channel.agentIds }, tenantId: req.tenantId });
    obj.employees = employees.map(employee => ({
      id: employee._id,
      username: employee.username,
      displayName: employee.displayName,
    }));
    return ok(res, obj);
  }
  
  // PATCH /api/tenant/channels/:id
  async update(req, res) {
    const channel = await Channel.findOne(channelScope(req, req.params.id));
    if (!channel) return error(res, '渠道不存在或无权访问', 404, 404);
    
    const allowed = req.user.role === 'agent'
      ? ['brandName', 'brandColor', 'avatarUrl', 'welcomeMessage', 'welcomeImageUrl', 'welcomeImageName', 'offlineMessage']
      : ['name', 'brandName', 'brandColor', 'avatarUrl', 'welcomeMessage', 'welcomeImageUrl', 'welcomeImageName', 'offlineMessage', 'assignmentMode', 'status'];
    for (const k of allowed) {
      if (req.body[k] !== undefined) channel[k] = req.body[k];
    }
    await channel.save();
    await invalidateChannelConfig(channel.publicToken);
    recordOperation({ req, tenantId: req.tenantId, user: req.user, action: 'channel_update', detail: `修改渠道「${channel.name}」` });
    return ok(res, channel.toJSON());
  }
  
  // POST /api/tenant/channels/:id/rotate-token
  async rotateToken(req, res) {
    const channel = await Channel.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!channel) return error(res, '渠道不存在', 404, 404);
    
    if (await IntegrationBinding.exists({ platformId: 'jingpro', channelId: channel._id, tenantId: req.tenantId })) {
      return error(res, '鲸商城永久绑定渠道不支持更换客服链接', 409, 409);
    }
    const oldToken = channel.publicToken;
    channel.publicToken = generateToken(24);
    await channel.save();
    await invalidateChannelConfig(oldToken, channel.publicToken);
    
    const obj = channel.toJSON();
    const settings = await getSystemSettings();
    obj.link = buildCustomerServiceLink(settings, channel.publicToken);
    recordOperation({ req, tenantId: req.tenantId, user: req.user, action: 'channel_rotate_token', detail: `更换渠道「${channel.name}」客服链接` });
    return ok(res, obj);
  }
  
  // DELETE /api/tenant/channels/:id
  async delete(req, res) {
    const channel = await Channel.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!channel) return error(res, '渠道不存在', 404, 404);
    
    if (await IntegrationBinding.exists({ platformId: 'jingpro', channelId: channel._id, tenantId: req.tenantId })) {
      return error(res, '鲸商城永久绑定渠道不可删除，请在鲸商城关闭挂件', 409, 409);
    }
    await Channel.deleteOne({ _id: channel._id, tenantId: req.tenantId });
    // 保留客户、会话与消息历史，仅撤销已删除渠道的实时订阅。
    const io = req.app.get('io');
    if (io) {
      io.in(`channel-${channel._id}`).disconnectSockets(true);
      io.in(`channel-staff-${channel._id}`).socketsLeave(`channel-staff-${channel._id}`);
    }
    await Promise.all([
      invalidateChannelConfig(channel.publicToken),
      invalidateKeywordReplies(req.tenantId, channel._id),
      invalidateQuickReplies(req.tenantId, channel._id),
    ]);
    // 清理关联数据
    await KeywordReply.deleteMany({ channelId: channel._id, tenantId: req.tenantId });
    await QuickReply.deleteMany({ channelId: channel._id, tenantId: req.tenantId });
    
    recordOperation({ req, tenantId: req.tenantId, user: req.user, action: 'channel_delete', detail: `删除渠道「${channel.name}」` });
    return ok(res, null, '已删除');
  }
  
  // PUT /api/tenant/channels/:id/employees
  async setAgents(req, res) {
    const channel = await Channel.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!channel) return error(res, '渠道不存在', 404, 404);
    
    const { employeeIds } = req.body;
    if (!Array.isArray(employeeIds)) return error(res, 'employeeIds 必须是数组');
    
    // 验证员工归属当前租户
    const validAgents = await TenantUser.find({
      _id: { $in: employeeIds },
      tenantId: req.tenantId,
      role: { $in: ['owner', 'admin', 'agent'] },
      status: 'active',
    }).select('_id');
    
    const newAgentIds = validAgents.map(a => a._id.toString());
    const previousAgentIds = (channel.agentIds || []).map(id => id.toString());
    const removedAgentIds = previousAgentIds.filter(id => !newAgentIds.includes(id));
    
    channel.agentIds = validAgents.map(a => a._id);
    await channel.save();
    
    // 撤销坐席后立即断开其连接，重连时会重新校验渠道授权，避免旧 Socket 继续收到渠道消息
    const io = req.app.get('io');
    if (io && removedAgentIds.length) {
      for (const agentId of removedAgentIds) {
        io.in(`agent-${agentId}`).disconnectSockets(true);
      }
    }
    
    recordOperation({ req, tenantId: req.tenantId, user: req.user, action: 'channel_set_agents', detail: `调整渠道「${channel.name}」授权坐席` });
    return ok(res, channel.toJSON());
  }
  
  // ============ 关键词回复 ============
  
  async listKeywordReplies(req, res) {
    const { channelId } = req.params;
    const channel = await Channel.findOne(channelScope(req, channelId));
    if (!channel) return error(res, '渠道不存在或无权访问', 404, 404);
    
    const key = keywordListCacheKey(req.tenantId, channelId);
    let items = await cache.getJson(key);
    if (!items) {
      items = await KeywordReply.find({ tenantId: req.tenantId, channelId })
        .sort({ priority: -1, createdAt: -1 })
        .lean();
      await cache.setJson(key, items, config.redis.cacheTtlSeconds);
    }
    return ok(res, items);
  }
  
  async createKeywordReply(req, res) {
    const { channelId } = req.params;
    const channel = await Channel.findOne(channelScope(req, channelId));
    if (!channel) return error(res, '渠道不存在或无权访问', 404, 404);
    
    const { keyword, matchType, replyContent, imageUrl, imageName, priority, status } = req.body;
    if (!String(replyContent || '').trim() && !String(imageUrl || '').trim()) {
      return error(res, '回复内容和图片至少填写一项');
    }
    const item = await KeywordReply.create({
      keyword,
      matchType,
      replyContent: String(replyContent || '').trim(),
      imageUrl: String(imageUrl || '').trim(),
      imageName: imageName || '',
      priority,
      status,
      tenantId: req.tenantId,
      channelId,
    });
    await invalidateKeywordReplies(req.tenantId, channelId);
    return ok(res, item);
  }
  
  async updateKeywordReply(req, res) {
    const channel = await Channel.findOne(channelScope(req, req.params.channelId));
    if (!channel) return error(res, '渠道不存在或无权访问', 404, 404);
    const item = await KeywordReply.findOne({ _id: req.params.krId, channelId: req.params.channelId, tenantId: req.tenantId });
    if (!item) return error(res, '配置不存在', 404, 404);
    
    const { keyword, matchType, replyContent, imageUrl, imageName, priority, status } = req.body;
    if (keyword !== undefined && !String(keyword).trim()) return error(res, '关键词不能为空');
    if (keyword !== undefined) item.keyword = String(keyword).trim();
    if (matchType !== undefined) item.matchType = matchType;
    if (replyContent !== undefined) item.replyContent = String(replyContent || '').trim();
    if (imageUrl !== undefined) item.imageUrl = String(imageUrl || '').trim();
    if (imageName !== undefined) item.imageName = imageName || '';
    if (!item.replyContent && !item.imageUrl) return error(res, '回复内容和图片至少填写一项');
    if (priority !== undefined) item.priority = priority;
    if (status !== undefined) item.status = status;
    await item.save();
    await invalidateKeywordReplies(req.tenantId, req.params.channelId);
    return ok(res, item);
  }
  
  async deleteKeywordReply(req, res) {
    const channel = await Channel.findOne(channelScope(req, req.params.channelId));
    if (!channel) return error(res, '渠道不存在或无权访问', 404, 404);
    const result = await KeywordReply.deleteOne({ _id: req.params.krId, channelId: req.params.channelId, tenantId: req.tenantId });
    if (result.deletedCount === 0) return error(res, '配置不存在', 404, 404);
    await invalidateKeywordReplies(req.tenantId, req.params.channelId);
    return ok(res, null, '已删除');
  }
  
  // ============ 快捷回复 ============
  
  async listQuickReplies(req, res) {
    const { channelId } = req.params;
    const channelWhere = { _id: channelId, tenantId: req.tenantId };
    if (req.user.role === 'agent') channelWhere.agentIds = req.user.id;
    const channel = await Channel.findOne(channelWhere);
    if (!channel) return error(res, '渠道不存在或无权访问', 404, 404);

    // 返回该渠道专属 + 租户通用（channelId=null）
    const key = quickReplyListCacheKey(req.tenantId, channelId);
    let items = await cache.getJson(key);
    if (!items) {
      items = await QuickReply.find({
        tenantId: req.tenantId,
        $or: [{ channelId }, { channelId: null }],
      }).sort({ sortOrder: 1, createdAt: -1 }).lean();
      await cache.setJson(key, items, config.redis.cacheTtlSeconds);
    }
    return ok(res, items);
  }
  
  async createQuickReply(req, res) {
    const { channelId } = req.params;
    const channel = await Channel.findOne(channelScope(req, channelId));
    if (!channel) return error(res, '渠道不存在或无权访问', 404, 404);
    
    const { title, content, imageUrl, imageName, sortOrder, status } = req.body;
    if (!String(content || '').trim() && !String(imageUrl || '').trim()) {
      return error(res, '回复内容和图片至少填写一项');
    }
    const item = await QuickReply.create({
      tenantId: req.tenantId,
      channelId,
      title,
      content: String(content || '').trim(),
      imageUrl: String(imageUrl || '').trim(),
      imageName: imageName || '',
      sortOrder,
      status,
      createdBy: req.user.id,
    });
    await invalidateQuickReplies(req.tenantId, channelId);
    return ok(res, item);
  }
  
  async updateQuickReply(req, res) {
    const channel = await Channel.findOne(channelScope(req, req.params.channelId));
    if (!channel) return error(res, '渠道不存在或无权访问', 404, 404);
    const item = await QuickReply.findOne({ _id: req.params.qrId, channelId: req.params.channelId, tenantId: req.tenantId });
    if (!item) return error(res, '配置不存在', 404, 404);
    
    const { title, content, imageUrl, imageName, sortOrder, status } = req.body;
    if (title !== undefined && !String(title).trim()) return error(res, '标题不能为空');
    if (title !== undefined) item.title = title;
    if (content !== undefined) item.content = String(content || '').trim();
    if (imageUrl !== undefined) item.imageUrl = String(imageUrl || '').trim();
    if (imageName !== undefined) item.imageName = imageName || '';
    if (!item.content && !item.imageUrl) return error(res, '回复内容和图片至少填写一项');
    if (sortOrder !== undefined) item.sortOrder = sortOrder;
    if (status !== undefined) item.status = status;
    await item.save();
    await invalidateQuickReplies(req.tenantId, req.params.channelId);
    return ok(res, item);
  }
  
  async deleteQuickReply(req, res) {
    const channel = await Channel.findOne(channelScope(req, req.params.channelId));
    if (!channel) return error(res, '渠道不存在或无权访问', 404, 404);
    const result = await QuickReply.deleteOne({ _id: req.params.qrId, channelId: req.params.channelId, tenantId: req.tenantId });
    if (result.deletedCount === 0) return error(res, '配置不存在', 404, 404);
    await invalidateQuickReplies(req.tenantId, req.params.channelId);
    return ok(res, null, '已删除');
  }
}

module.exports = new ChannelController();
