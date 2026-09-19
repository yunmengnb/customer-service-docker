// 忆梦云团队开发
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { ObjectId } = mongoose.Types;

const Tenant = require('../models/Tenant');
const TenantUser = require('../models/TenantUser');
const TenantIntegration = require('../models/TenantIntegration');
const Channel = require('../models/Channel');
const IntegrationBinding = require('../models/IntegrationBinding');
const KeywordReply = require('../models/KeywordReply');
const QuickReply = require('../models/QuickReply');
const SystemConfig = require('../models/SystemConfig');
const cache = require('../utils/cache');
const {
  JINGPRO_SETTING_KEY,
  getJingproPlatformSetting,
  consumeJti,
  jwtDecodeHeader,
  jwtVerifyHS256,
} = require('../middleware/integrationAuth');
const { hashPassword, signToken, generateToken } = require('../utils');

function genHex(len) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}

function maskSecret(secret) {
  const value = String(secret || '');
  if (!value) return '';
  if (value.length <= 8) return '*'.repeat(value.length);
  return value.slice(0, 4) + '*'.repeat(Math.min(16, value.length - 8)) + value.slice(-4);
}

function pickAliases(obj, aliases) {
  const out = {};
  if (!obj) return out;
  Object.entries(aliases).forEach(([field, keys]) => {
    const key = keys.find(k => Object.prototype.hasOwnProperty.call(obj, k));
    if (key) out[field] = obj[key];
  });
  return out;
}

function connectionResponse(connection, platformSetting) {
  if (!connection) return null;
  const data = typeof connection.toObject === 'function' ? connection.toObject() : { ...connection };
  delete data.platformSecret;
  delete data.__v;
  return {
    ...data,
    tenantId: String(data.tenantId),
    keyId: data.keyId,
    hasSecret: !!connection.platformSecret,
    maskedSecret: maskSecret(connection.platformSecret),
    serverBaseUrl: platformSetting.serverBaseUrl,
    widgetBaseUrl: platformSetting.widgetBaseUrl,
  };
}

function invalidateChannelCaches(binding) {
  return cache.remove(
    `config:channel:token:${binding.publicToken}`,
    `replies:keyword:runtime:${binding.tenantId}:${binding.channelId}`,
    `replies:keyword:list:${binding.tenantId}:${binding.channelId}`,
    `replies:quick:list:${binding.tenantId}:${binding.channelId}`,
  );
}

function tenantAvailable(tenant) {
  return !!tenant && ['active', 'trial'].includes(tenant.status)
    && tenant.membershipStatus === 'active'
    && (!tenant.expiresAt || new Date(tenant.expiresAt).getTime() > Date.now());
}

function userAvailable(user, binding) {
  return !!user && user.status === 'active' && String(user.tenantId) === String(binding.tenantId);
}

async function bindingAvailable(binding) {
  if (!binding) return false;
  const [tenant, user, channel, userBindingCount] = await Promise.all([
    Tenant.findById(binding.tenantId).exec(),
    TenantUser.findById(binding.ownerUserId).exec(),
    Channel.findOne({
      _id: binding.channelId,
      tenantId: binding.tenantId,
      publicToken: binding.publicToken,
      agentIds: binding.ownerUserId,
    }).exec(),
    IntegrationBinding.countDocuments({ ownerUserId: binding.ownerUserId }),
  ]);
  return tenantAvailable(tenant)
    && userAvailable(user, binding)
    && user.role === 'agent'
    && userBindingCount === 1
    && !!channel;
}

async function getBoundChannel(req, channelId) {
  if (!ObjectId.isValid(channelId) || !req.integration) return null;
  const binding = await IntegrationBinding.findOne({
    platformId: 'jingpro',
    connectionId: req.integration.connectionId,
    tenantId: req.integration.tenantId,
    channelId: new ObjectId(channelId),
  }).exec();
  return await bindingAvailable(binding) ? binding : null;
}

function imageExtension(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';
  if (buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && buffer.length >= 24 && buffer.toString('ascii', 12, 16) === 'IHDR') return '.png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9) return '.jpg';
  if (['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6)) && buffer[buffer.length - 1] === 0x3b) return '.gif';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' && buffer.length > 20 && buffer.readUInt32LE(4) + 8 === buffer.length) return '.webp';
  return '';
}

function sanitize(document) {
  if (!document) return null;
  const value = typeof document.toObject === 'function' ? document.toObject() : { ...document };
  delete value.password;
  delete value.__v;
  return value;
}

function buildCustomerServiceLink(baseUrl, publicToken) {
  const base = String(baseUrl || process.env.WEB_BASE_URL || '').replace(/\/+$/, '');
  return base ? `${base}/c/${publicToken}` : `/c/${publicToken}`;
}

function isPublicHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) && !!url.hostname;
  } catch (_) {
    return false;
  }
}

const IntegrationController = {
  async listTenantExtensions(req, res) {
    const setting = await getJingproPlatformSetting();
    if (!setting.enabled) return res.json({ code: 200, msg: 'ok', data: [] });
    const connection = await TenantIntegration.findOne({ tenantId: req.tenantId, provider: 'jingpro' }).select('+platformSecret').exec();
    return res.json({ code: 200, msg: 'ok', data: [{ provider: 'jingpro', configured: !!connection, ...(connectionResponse(connection, setting) || {}) }] });
  },

  async getTenantJingpro(req, res) {
    const setting = await getJingproPlatformSetting();
    if (!setting.enabled) return res.status(404).json({ code: 404001, msg: 'Jingpro extension is not available', data: null });
    const connection = await TenantIntegration.findOne({ tenantId: req.tenantId, provider: 'jingpro' }).select('+platformSecret').exec();
    return res.json({ code: 200, msg: 'ok', data: connectionResponse(connection, setting) });
  },

  async saveTenantJingpro(req, res) {
    const setting = await getJingproPlatformSetting();
    if (!setting.enabled) return res.status(404).json({ code: 404001, msg: 'Jingpro extension is not available', data: null });
    const body = req.body || {};
    const current = await TenantIntegration.findOne({ tenantId: req.tenantId, provider: 'jingpro' }).select('+platformSecret').exec();
    const platformName = body.platformName == null ? String(current?.platformName || '').trim() : String(body.platformName).trim();
    const platformUrl = body.platformUrl == null ? String(current?.platformUrl || '').trim() : String(body.platformUrl).trim();
    const secretProvided = Object.prototype.hasOwnProperty.call(body, 'platformSecret') && String(body.platformSecret || '').trim() !== '';
    const platformSecret = secretProvided ? String(body.platformSecret).trim() : current?.platformSecret;
    if (!platformName || !platformUrl) return res.status(400).json({ code: 400001, msg: 'platformName and platformUrl are required', data: null });
    if (!isPublicHttpUrl(platformUrl)) return res.status(400).json({ code: 400003, msg: 'platformUrl must be a complete http/https URL', data: null });
    if (!platformSecret || platformSecret.length < 16) return res.status(400).json({ code: 400002, msg: 'platformSecret must be at least 16 characters', data: null });
    const values = {
      platformName,
      platformUrl,
      platformSecret,
      enabled: body.enabled == null ? (current?.enabled || false) : body.enabled === true,
    };
    if (!current) values.keyId = `jingpro_${genHex(24)}`;
    values.status = values.enabled ? (current?.status === 'active' ? 'active' : 'unverified') : 'disabled';
    const connection = await TenantIntegration.findOneAndUpdate(
      { tenantId: req.tenantId, provider: 'jingpro' },
      { $set: values, $setOnInsert: { tenantId: req.tenantId, provider: 'jingpro' } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).select('+platformSecret').exec();
    return res.json({ code: 200, msg: 'saved', data: connectionResponse(connection, setting) });
  },

  async ping(req, res) {
    const now = new Date();
    const tenant = await Tenant.findById(req.integration.tenantId).select('_id name').lean();
    if (!tenant) return res.status(404).json({ code: 404001, msg: 'Target tenant not found', data: null });
    await TenantIntegration.updateOne({ _id: req.integration.connectionId }, { $set: { status: 'active', lastVerifiedAt: now, lastUsedAt: now } });
    return res.json({
      code: 200,
      msg: 'pong',
      data: {
        ts: Math.floor(now.getTime() / 1000),
        platformId: 'jingpro',
        tenantId: String(tenant._id),
        tenantName: tenant.name,
        connectionId: req.integration.connectionId,
        keyId: req.integration.keyId,
        platformName: req.integration.platformName,
        serverBaseUrl: req.integrationPlatformSetting.serverBaseUrl,
        widgetBaseUrl: req.integrationPlatformSetting.widgetBaseUrl,
      },
    });
  },

  async ensureTenantAndChannel(req, res) {
    const body = req.body || {};
    const jingproUserId = body.jingpro_user_id != null ? String(body.jingpro_user_id) : '';
    if (!jingproUserId) return res.status(400).json({ code: 400001, msg: 'Missing jingpro_user_id', data: null });
    const tenant = await Tenant.findById(req.integration.tenantId).exec();
    if (!tenantAvailable(tenant)) return res.status(403).json({ code: 403011, msg: 'Target tenant is disabled or inactive', data: null });
    const bindingQuery = { connectionId: req.integration.connectionId, tenantId: tenant._id, jingproUserId };
    const existing = await IntegrationBinding.findOne(bindingQuery).exec();
    const widgetBase = String(req.integrationPlatformSetting.widgetBaseUrl || '').replace(/\/+$/, '');
    if (existing) {
      if (!await bindingAvailable(existing)) return res.status(409).json({ code: 409001, msg: '原绑定已失效或账号停用，请租户管理员修复', data: null });
      const existingUser = await TenantUser.findById(existing.ownerUserId).select('username').lean();
      return res.json({ code: 200, msg: 'ok', data: {
        created: false, platformId: existing.platformId, jingproUserId: existing.jingproUserId,
        tenantId: String(existing.tenantId), tenant: tenant.username, connectionId: String(existing.connectionId),
        ownerUserId: String(existing.ownerUserId), channelId: String(existing.channelId), username: existingUser?.username || '',
        publicToken: existing.publicToken, link: existing.link || buildCustomerServiceLink(widgetBase, existing.publicToken),
      } });
    }
    const username = String(body.username || body.owner_username || body.ownerUsername || '').trim();
    const password = typeof body.password === 'string' ? body.password : '';
    const email = String(body.email || '').trim().toLowerCase();
    if (username.length < 3 || username.length > 50) return res.status(400).json({ code: 400002, msg: 'username/owner_username 必须为 3-50 位', data: null });
    if (password.length < 6 || password.length > 72) return res.status(400).json({ code: 400005, msg: 'password 必须为 6-72 位', data: null });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ code: 400006, msg: 'email 格式不正确', data: null });
    const channelName = String(body.channel_name || body.channelName || body.platform_name || body.platformName || `${req.integration.platformName}官方客服`);
    const brandName = String(body.brand_name || body.brandName || tenant.name);
    const publicToken = typeof generateToken === 'function' ? generateToken(24) : genHex(24);
    let user;
    let channel;
    let binding;
    let createdUser = false;
    try {
      user = await TenantUser.findOne({ tenantId: tenant._id, username });
      if (user) {
        return res.status(409).json({ code: 409002, msg: '该商户账号已被客服企业中的其他用户占用，请先修改冲突账号', data: null });
      } else {
        user = await TenantUser.create({
          tenantId: tenant._id,
          username,
          displayName: String(body.display_name || body.displayName || username).slice(0, 50),
          password: await hashPassword(password),
          role: 'agent',
          status: 'active',
        });
        createdUser = true;
      }
      channel = await Channel.create({
        tenantId: tenant._id, name: channelName, publicToken, brandName,
        brandColor: String(body.brand_color || body.brandColor || '#409EFF'),
        avatarUrl: String(body.avatar_url || body.avatarUrl || ''),
        welcomeMessage: String(body.welcome_message || body.welcomeMessage || '您好~欢迎光临！请问有什么可以帮您？'),
        welcomeImageUrl: String(body.welcome_image_url || body.welcomeImageUrl || ''),
        welcomeImageName: String(body.welcome_image_name || body.welcomeImageName || ''),
        offlineMessage: '当前客服不在线，请稍后再联系', assignmentMode: 'round_robin',
        agentIds: [user._id], createdBy: user._id, status: 'online',
      });
      binding = await IntegrationBinding.create({
        platformId: 'jingpro', connectionId: req.integration.connectionId, jingproUserId,
        tenantId: tenant._id, ownerUserId: user._id, channelId: channel._id, publicToken,
        link: buildCustomerServiceLink(widgetBase, publicToken),
        meta: { email, widgetText: String(body.widget_text || body.widgetText || '在线客服'), widgetBaseUrl: widgetBase },
      });
      await TenantIntegration.updateOne({ _id: req.integration.connectionId }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
      return res.json({ code: 200, msg: 'created', data: {
        created: true, platformId: 'jingpro', jingproUserId, tenantId: String(tenant._id), tenant: tenant.username,
        connectionId: req.integration.connectionId, ownerUserId: String(user._id), channelId: String(channel._id),
        username: user.username, publicToken, link: binding.link,
      } });
    } catch (e) {
      if (channel?._id && !binding?._id) await Channel.deleteOne({ _id: channel._id }).catch(() => {});
      if (createdUser && user?._id && !binding?._id) await TenantUser.deleteOne({ _id: user._id }).catch(() => {});
      if (e && e.code === 11000) {
        const retry = await IntegrationBinding.findOne(bindingQuery).exec();
        if (retry && await bindingAvailable(retry)) return res.json({ code: 200, msg: 'ok (retry)', data: {
          created: false, platformId: retry.platformId, jingproUserId: retry.jingproUserId,
          tenantId: String(retry.tenantId), tenant: tenant.username, connectionId: String(retry.connectionId), ownerUserId: String(retry.ownerUserId),
          channelId: String(retry.channelId), username, publicToken: retry.publicToken, link: retry.link || '',
        } });
      }
      return res.status(500).json({ code: 500002, msg: '创建绑定失败: ' + String(e && e.message || e), data: null });
    }
  },

  async uploadImage(req, res) {
    const binding = await getBoundChannel(req, req.params.channelId);
    if (!binding) return res.status(403).json({ code: 403010, msg: 'Channel not managed by this integration connection', data: null });
    if (!req.file) return res.status(400).json({ code: 400001, msg: '请选择图片', data: null });
    const extensionByMime = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
    const ext = imageExtension(req.file.buffer);
    if (!req.file.buffer || req.file.buffer.length > 5 * 1024 * 1024) return res.status(400).json({ code: 400001, msg: '图片大小不能超过 5MB', data: null });
    if (!ext || ext !== extensionByMime[String(req.file.mimetype).toLowerCase()]) return res.status(400).json({ code: 400001, msg: '不支持的图片类型', data: null });
    const relativeDir = path.join(String(binding.tenantId), 'integration');
    const uploadDir = path.resolve(__dirname, '..', '..', 'uploads', relativeDir);
    await fs.promises.mkdir(uploadDir, { recursive: true });
    const filename = Date.now() + '_' + crypto.randomBytes(6).toString('hex') + ext;
    await fs.promises.writeFile(path.join(uploadDir, filename), req.file.buffer, { flag: 'wx' });
    const baseUrl = String(req.integrationPlatformSetting.serverBaseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    return res.json({ code: 200, msg: 'uploaded', data: { url: `${baseUrl}/uploads/${binding.tenantId}/integration/${filename}`, name: req.file.originalname, size: req.file.size } });
  },

  async patchChannel(req, res) {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ code: 400002, msg: 'Invalid channel id', data: null });
    const binding = await getBoundChannel(req, req.params.id);
    if (!binding) return res.status(403).json({ code: 403010, msg: 'Channel not managed by this integration connection', data: null });
    const updateData = pickAliases(req.body, {
      name: ['name', 'channel_name', 'platformName', 'platform_name'], brandName: ['brandName', 'brand_name'],
      brandColor: ['brandColor', 'brand_color'], avatarUrl: ['avatarUrl', 'avatar_url'], welcomeMessage: ['welcomeMessage', 'welcome_message'],
      welcomeImageUrl: ['welcomeImageUrl', 'welcome_image_url'], welcomeImageName: ['welcomeImageName', 'welcome_image_name'],
      offlineMessage: ['offlineMessage', 'offline_message'], widgetText: ['widgetText', 'widget_text'],
      assignmentMode: ['assignmentMode', 'assignment_mode'], agentIds: ['agentIds', 'agent_ids'], status: ['status'],
    });
    const channel = await Channel.findOne({ _id: binding.channelId, tenantId: req.integration.tenantId }).exec();
    if (!channel) return res.status(404).json({ code: 404001, msg: 'Channel not found', data: null });
    if (updateData.agentIds !== undefined) {
      const requestedAgentIds = Array.isArray(updateData.agentIds) ? updateData.agentIds.map(String) : [];
      if (requestedAgentIds.length !== 1 || requestedAgentIds[0] !== String(binding.ownerUserId)) {
        return res.status(400).json({ code: 400003, msg: 'Jingpro channel must keep its bound merchant agent', data: null });
      }
      const agent = await TenantUser.findOne({
        _id: binding.ownerUserId,
        tenantId: req.integration.tenantId,
        role: 'agent',
        status: 'active',
      }).select('_id');
      if (!agent) return res.status(400).json({ code: 400004, msg: 'Bound merchant agent is unavailable', data: null });
      updateData.agentIds = [agent._id];
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'widgetText')) {
      binding.meta = { ...(binding.meta || {}), widgetText: updateData.widgetText };
      delete updateData.widgetText;
      await binding.save();
    }
    Object.assign(channel, updateData);
    await channel.save();
    await invalidateChannelCaches(binding);
    return res.json({ code: 200, msg: 'updated', data: channel.toObject() });
  },

  async listKeywordReplies(req, res) {
    const binding = await getBoundChannel(req, req.params.channelId);
    if (!binding) return res.status(403).json({ code: 403010, msg: 'Channel not managed by this integration connection', data: null });
    const items = await KeywordReply.find({ tenantId: req.integration.tenantId, channelId: binding.channelId }).sort({ priority: -1, createdAt: -1 }).lean();
    return res.json({ code: 200, msg: 'ok', data: items });
  },

  async createKeywordReply(req, res) {
    const binding = await getBoundChannel(req, req.params.channelId);
    if (!binding) return res.status(403).json({ code: 403010, msg: 'Channel not managed by this integration connection', data: null });
    const data = pickAliases(req.body, { keyword: ['keyword'], matchType: ['matchType', 'match_type'], replyContent: ['replyContent', 'reply_content', 'content'], imageUrl: ['imageUrl', 'image_url'], imageName: ['imageName', 'image_name'], priority: ['priority'], status: ['status'] });
    if (!String(data.keyword || '').trim() || (!String(data.replyContent || '').trim() && !String(data.imageUrl || '').trim())) return res.status(400).json({ code: 400001, msg: 'keyword and replyContent/imageUrl are required', data: null });
    const item = await KeywordReply.create({ ...data, keyword: String(data.keyword).trim(), tenantId: req.integration.tenantId, channelId: binding.channelId });
    await invalidateChannelCaches(binding);
    return res.json({ code: 200, msg: 'created', data: item });
  },

  async updateKeywordReply(req, res) {
    const binding = await getBoundChannel(req, req.params.channelId);
    if (!binding) return res.status(403).json({ code: 403010, msg: 'Channel not managed by this integration connection', data: null });
    const item = ObjectId.isValid(req.params.itemId) ? await KeywordReply.findOne({ _id: req.params.itemId, tenantId: req.integration.tenantId, channelId: binding.channelId }) : null;
    if (!item) return res.status(404).json({ code: 404001, msg: 'Keyword reply not found', data: null });
    Object.assign(item, pickAliases(req.body, { keyword: ['keyword'], matchType: ['matchType', 'match_type'], replyContent: ['replyContent', 'reply_content', 'content'], imageUrl: ['imageUrl', 'image_url'], imageName: ['imageName', 'image_name'], priority: ['priority'], status: ['status'] }));
    await item.save(); await invalidateChannelCaches(binding);
    return res.json({ code: 200, msg: 'updated', data: item });
  },

  async deleteKeywordReply(req, res) {
    const binding = await getBoundChannel(req, req.params.channelId);
    if (!binding) return res.status(403).json({ code: 403010, msg: 'Channel not managed by this integration connection', data: null });
    const result = ObjectId.isValid(req.params.itemId) ? await KeywordReply.deleteOne({ _id: req.params.itemId, tenantId: req.integration.tenantId, channelId: binding.channelId }) : { deletedCount: 0 };
    if (!result.deletedCount) return res.status(404).json({ code: 404001, msg: 'Keyword reply not found', data: null });
    await invalidateChannelCaches(binding); return res.json({ code: 200, msg: 'deleted', data: null });
  },

  async listQuickReplies(req, res) {
    const binding = await getBoundChannel(req, req.params.channelId);
    if (!binding) return res.status(403).json({ code: 403010, msg: 'Channel not managed by this integration connection', data: null });
    const items = await QuickReply.find({ tenantId: req.integration.tenantId, channelId: binding.channelId }).sort({ sortOrder: 1, createdAt: -1 }).lean();
    return res.json({ code: 200, msg: 'ok', data: items });
  },

  async createQuickReply(req, res) {
    const binding = await getBoundChannel(req, req.params.channelId);
    if (!binding) return res.status(403).json({ code: 403010, msg: 'Channel not managed by this integration connection', data: null });
    const data = pickAliases(req.body, { title: ['title'], content: ['content', 'replyContent', 'reply_content'], imageUrl: ['imageUrl', 'image_url'], imageName: ['imageName', 'image_name'], sortOrder: ['sortOrder', 'sort_order'], status: ['status'] });
    if (!String(data.title || '').trim() || (!String(data.content || '').trim() && !String(data.imageUrl || '').trim())) return res.status(400).json({ code: 400001, msg: 'title and content/imageUrl are required', data: null });
    const item = await QuickReply.create({ ...data, title: String(data.title).trim(), tenantId: req.integration.tenantId, channelId: binding.channelId, createdBy: binding.ownerUserId });
    await invalidateChannelCaches(binding); return res.json({ code: 200, msg: 'created', data: item });
  },

  async updateQuickReply(req, res) {
    const binding = await getBoundChannel(req, req.params.channelId);
    if (!binding) return res.status(403).json({ code: 403010, msg: 'Channel not managed by this integration connection', data: null });
    const item = ObjectId.isValid(req.params.itemId) ? await QuickReply.findOne({ _id: req.params.itemId, tenantId: req.integration.tenantId, channelId: binding.channelId }) : null;
    if (!item) return res.status(404).json({ code: 404001, msg: 'Quick reply not found', data: null });
    Object.assign(item, pickAliases(req.body, { title: ['title'], content: ['content', 'replyContent', 'reply_content'], imageUrl: ['imageUrl', 'image_url'], imageName: ['imageName', 'image_name'], sortOrder: ['sortOrder', 'sort_order'], status: ['status'] }));
    await item.save(); await invalidateChannelCaches(binding); return res.json({ code: 200, msg: 'updated', data: item });
  },

  async deleteQuickReply(req, res) {
    const binding = await getBoundChannel(req, req.params.channelId);
    if (!binding) return res.status(403).json({ code: 403010, msg: 'Channel not managed by this integration connection', data: null });
    const result = ObjectId.isValid(req.params.itemId) ? await QuickReply.deleteOne({ _id: req.params.itemId, tenantId: req.integration.tenantId, channelId: binding.channelId }) : { deletedCount: 0 };
    if (!result.deletedCount) return res.status(404).json({ code: 404001, msg: 'Quick reply not found', data: null });
    await invalidateChannelCaches(binding); return res.json({ code: 200, msg: 'deleted', data: null });
  },

  async ssoLogin(req, res) {
    const token = (req.body && req.body.token) || (req.header('Authorization') || '').replace(/^Bearer\s+/i, '') || '';
    if (!token) return res.status(401).json({ code: 401001, msg: 'Missing SSO token', data: null });
    const setting = await getJingproPlatformSetting();
    if (!setting.enabled) return res.status(403).json({ code: 403006, msg: 'Jingpro integration is disabled', data: null });
    const header = jwtDecodeHeader(token);
    const keyId = header && String(header.kid || '').trim();
    if (!keyId || header.alg !== 'HS256' || header.typ !== 'JWT') return res.status(401).json({ code: 401002, msg: 'Invalid SSO token header', data: null });
    const connection = await TenantIntegration.findOne({ keyId, provider: 'jingpro', enabled: true }).select('+platformSecret').exec();
    if (!connection) return res.status(401).json({ code: 401003, msg: 'Unknown or disabled integration key', data: null });
    const payload = jwtVerifyHS256(token, connection.platformSecret);
    if (!payload) return res.status(401).json({ code: 401003, msg: 'Invalid SSO token signature', data: null });
    const now = Math.floor(Date.now() / 1000);
    const issuedAt = Number(payload.iat);
    const expiresAt = Number(payload.exp);
    const expectedIssuer = `jingpro:${keyId}`;
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
      || issuedAt > now + 30 || expiresAt <= now || expiresAt <= issuedAt || expiresAt - issuedAt > 300
      || String(payload.sub || '') !== 'sso' || String(payload.aud || '') !== 'kefu-sso'
      || String(payload.iss || '') !== expectedIssuer || String(payload.connection_id || '') !== keyId
      || !String(payload.jti || '').trim()) {
      return res.status(401).json({ code: 401004, msg: 'Invalid or expired SSO token claims', data: null });
    }
    const jingproUserId = payload.jingpro_user_id != null ? String(payload.jingpro_user_id) : '';
    if (!jingproUserId) return res.status(401).json({ code: 401007, msg: 'SSO token missing jingpro_user_id claim', data: null });
    try {
      await consumeJti(String(payload.jti), connection._id, 300 * 1000);
    } catch (e) {
      if (e && e.code === 40102) return res.status(401).json({ code: 40102, msg: 'SSO token already used', data: null });
      return res.status(500).json({ code: 500005, msg: 'JTI store error', data: null });
    }
    const binding = await IntegrationBinding.findOne({ connectionId: connection._id, tenantId: connection.tenantId, jingproUserId }).exec();
    if (!binding) return res.status(401).json({ code: 401008, msg: 'No matching linked user found', data: null });
    const [user, tenant, channel] = await Promise.all([
      TenantUser.findById(binding.ownerUserId),
      Tenant.findById(connection.tenantId),
      Channel.findOne({
        _id: binding.channelId,
        tenantId: connection.tenantId,
        agentIds: binding.ownerUserId,
      }).select('_id').lean(),
    ]);
    if (!userAvailable(user, binding) || user.role !== 'agent' || !tenantAvailable(tenant) || !channel) {
      return res.status(401).json({ code: 401009, msg: 'Linked user, tenant or channel is unavailable', data: null });
    }
    await TenantIntegration.updateOne({ _id: connection._id }, { $set: { lastUsedAt: new Date() } });
    const realToken = signToken({ type: 'tenant_user', id: String(user._id), tenantId: String(connection.tenantId), role: user.role }, '7d');
    return res.json({ code: 200, msg: 'ok', data: { token: realToken, userType: 'merchant', user: sanitize(user), tenant: sanitize(tenant), redirect: '/messages' } });
  },

  async getAdminSetting(req, res) {
    const setting = await getJingproPlatformSetting();
    return res.json({ code: 200, msg: 'ok', data: setting });
  },

  async setAdminSetting(req, res) {
    const body = req.body || {};
    const current = await getJingproPlatformSetting();
    const setting = {
      enabled: body.enabled == null ? current.enabled : body.enabled === true,
      serverBaseUrl: body.serverBaseUrl == null ? current.serverBaseUrl : String(body.serverBaseUrl).trim().replace(/\/+$/, ''),
      widgetBaseUrl: body.widgetBaseUrl == null ? current.widgetBaseUrl : String(body.widgetBaseUrl).trim().replace(/\/+$/, ''),
    };
    if (!isPublicHttpUrl(setting.serverBaseUrl) || !isPublicHttpUrl(setting.widgetBaseUrl)) {
      return res.status(400).json({ code: 400001, msg: '公共地址必须是完整的 http/https URL', data: null });
    }
    await SystemConfig.set(JINGPRO_SETTING_KEY, setting, 'Jingpro 平台扩展总开关与公共地址');
    return res.json({ code: 200, msg: '保存成功', data: setting });
  },
};

module.exports = IntegrationController;
