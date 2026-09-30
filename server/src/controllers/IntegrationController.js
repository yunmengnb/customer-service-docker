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
const { getSystemSettings, authSettings } = require('../utils/systemSettings');
const {
  JINGPRO_SETTING_KEY,
  getJingproPlatformSetting,
  consumeJti,
  jwtDecodeHeader,
  jwtVerifyHS256,
} = require('../middleware/integrationAuth');
const { hashPassword, generateToken } = require('../utils');
const { createSessionAndToken } = require('../services/tenantSessionService');
const { generateTemporaryLoginKey } = require('../services/tenantLoginKeyService');
const WechatOfficialAccount = require('../models/WechatOfficialAccount');
const TenantUserSession = require('../models/TenantUserSession');
const WechatAuthChallenge = require('../models/WechatAuthChallenge');
const customerSessionService = require('../services/customerSessionService');
const { recordOperation } = require('../services/auditLogService');
const {
  getPlatformExtension,
  listPlatformExtensions,
  setPlatformControl,
  tenantAllowed,
} = require('../services/extensionPlatformService');

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

async function extensionUsage(platforms) {
  const [jingproConfigured, jingproEnabled, wechatConfigured, wechatEnabled] = await Promise.all([
    TenantIntegration.countDocuments({ provider: 'jingpro' }),
    TenantIntegration.countDocuments({ provider: 'jingpro', enabled: true }),
    WechatOfficialAccount.countDocuments({ isCurrent: true }),
    WechatOfficialAccount.countDocuments({ isCurrent: true, enabled: true }),
  ]);
  const usage = {
    jingpro: { configuredTenants: jingproConfigured, enabledTenants: jingproEnabled },
    wechat_official: { configuredTenants: wechatConfigured, enabledTenants: wechatEnabled },
  };
  return platforms.map(item => ({ ...item, usage: usage[item.provider] || { configuredTenants: 0, enabledTenants: 0 } }));
}

async function revokeWechatPlatformSessions(req, reason, tenantFilter = {}) {
  const now = new Date();
  const tenantSessions = await TenantUserSession.find({
    ...tenantFilter,
    loginMethod: 'wechat',
    revokedAt: null,
  }).select('_id wechatBindingId');
  if (tenantSessions.length) {
    await TenantUserSession.updateMany(
      { _id: { $in: tenantSessions.map(item => item._id) }, revokedAt: null },
      { $set: { revokedAt: now, revokeReason: reason } },
    );
  }
  const customerCount = await customerSessionService.revokeMany(
    { ...tenantFilter, loginMethod: 'wechat' },
    reason,
    req.app.get('io'),
  );
  await WechatAuthChallenge.updateMany(
    { ...tenantFilter, state: { $nin: ['consumed', 'cancelled'] } },
    { $set: { state: 'cancelled' } },
  );
  const io = req.app.get('io');
  for (const session of tenantSessions) {
    io?.in(`tenant-session-${session._id}`).disconnectSockets(true);
    if (session.wechatBindingId) io?.in(`wechat-binding-${session.wechatBindingId}`).disconnectSockets(true);
  }
  return { tenantSessions: tenantSessions.length, customerSessions: customerCount };
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
    const [platforms, connection, wechat] = await Promise.all([
      listPlatformExtensions(),
      TenantIntegration.findOne({ tenantId: req.tenantId, provider: 'jingpro' }).select('+platformSecret').exec(),
      WechatOfficialAccount.findOne({ tenantId: req.tenantId, isCurrent: true }).exec(),
    ]);
    const byProvider = Object.fromEntries(platforms.map(item => [item.provider, item]));
    const jingpro = connectionResponse(connection, byProvider.jingpro);
    const jingproAuthorized = tenantAllowed(byProvider.jingpro, req.tenantId);
    const wechatAuthorized = tenantAllowed(byProvider.wechat_official, req.tenantId);
    return res.json({ code: 200, msg: 'ok', data: [
      {
        ...byProvider.jingpro,
        authorized: jingproAuthorized,
        configured: !!connection,
        configurationCompleteness: connection
          ? (connection.platformName && connection.platformUrl && connection.platformSecret ? 100 : 67)
          : 0,
        tenantEnabled: connection?.enabled === true,
        connectionEnabled: connection?.enabled === true,
        ...(jingpro || {}),
        platformEnabled: byProvider.jingpro.enabled,
        enabled: jingproAuthorized && connection?.enabled === true,
      },
      {
        ...byProvider.wechat_official,
        authorized: wechatAuthorized,
        configured: !!wechat,
        configurationCompleteness: wechat
          ? Math.round(([wechat.displayName, wechat.appId, wechat.credentialCheckedAt, wechat.callbackCheckedAt].filter(Boolean).length / 4) * 100)
          : 0,
        tenantEnabled: wechat?.enabled === true,
        platformEnabled: byProvider.wechat_official.enabled,
        enabled: wechatAuthorized && wechat?.enabled === true,
      },
    ] });
  },

  async getTenantJingpro(req, res) {
    const setting = await getJingproPlatformSetting();
    const connection = await TenantIntegration.findOne({ tenantId: req.tenantId, provider: 'jingpro' }).select('+platformSecret').exec();
    return res.json({ code: 200, msg: 'ok', data: {
      ...(connectionResponse(connection, setting) || {}),
      platformEnabled: setting.enabled,
      authorized: tenantAllowed(setting, req.tenantId),
      tenantEnabled: connection?.enabled === true,
      configured: !!connection,
      configurationCompleteness: connection
        ? (connection.platformName && connection.platformUrl && connection.platformSecret ? 100 : 67)
        : 0,
    } });
  },

  async saveTenantJingpro(req, res) {
    const setting = await getJingproPlatformSetting();
    if (!tenantAllowed(setting, req.tenantId)) return res.status(403).json({ code: 403006, msg: setting.enabled ? '当前企业未获平台授权使用 JingPro 扩展应用' : '平台已停用 JingPro 扩展应用', data: null });
    const body = req.body || {};
    const current = await TenantIntegration.findOne({ tenantId: req.tenantId, provider: 'jingpro' }).select('+platformSecret').exec();
    const platformName = body.platformName == null ? String(current?.platformName || '').trim() : String(body.platformName).trim();
    const platformUrl = body.platformUrl == null ? String(current?.platformUrl || '').trim() : String(body.platformUrl).trim();
    const secretProvided = Object.prototype.hasOwnProperty.call(body, 'platformSecret') && String(body.platformSecret || '').trim() !== '';
    const platformSecret = secretProvided ? String(body.platformSecret).trim() : current?.platformSecret;
    const submittedSecret = Buffer.from(String(platformSecret || ''), 'utf8');
    const storedSecret = Buffer.from(String(current?.platformSecret || ''), 'utf8');
    const secretChanged = secretProvided && (
      submittedSecret.length !== storedSecret.length
      || !crypto.timingSafeEqual(submittedSecret, storedSecret)
    );
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
    const connectionChanged = secretChanged || platformUrl !== String(current?.platformUrl || '').trim();
    values.status = values.enabled
      ? (current?.status === 'active' && !connectionChanged ? 'active' : 'unverified')
      : 'disabled';
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
    const [agentCount, channelCount] = await Promise.all([
      TenantUser.countDocuments({ tenantId: tenant._id, role: { $ne: 'owner' } }),
      Channel.countDocuments({ tenantId: tenant._id }),
    ]);
    if (agentCount >= tenant.plan.agentLimit) {
      return res.status(409).json({ code: 409004, msg: '已达到员工数量上限', data: null });
    }
    if (channelCount >= tenant.plan.channelLimit) {
      return res.status(409).json({ code: 409005, msg: '已达到渠道数量上限', data: null });
    }
    const username = String(body.username || body.owner_username || body.ownerUsername || '').trim().toLowerCase();
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
      const [usernameTenant, usernameUser] = await Promise.all([
        Tenant.exists({ username }),
        TenantUser.findOne({ username }),
      ]);
      user = usernameUser;
      if (usernameTenant || user) {
        return res.status(409).json({ code: 409002, msg: '该商户账号已被客服企业中的其他用户占用，请先修改冲突账号', data: null });
      } else {
        const [emailTenant, emailUser] = await Promise.all([
          Tenant.exists({ email }),
          TenantUser.exists({ email }),
        ]);
        if (emailTenant || emailUser) {
          return res.status(409).json({ code: 409003, msg: '该邮箱已被使用', data: null });
        }
        user = await TenantUser.create({
          tenantId: tenant._id,
          username,
          email,
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
        return res.status(409).json({ code: 409002, msg: '用户名或邮箱已被使用', data: null });
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
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.resolve(__dirname, '..', '..', 'uploads'), relativeDir);
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

  async generateLoginKey(req, res) {
    const jingproUserId = req.body?.jingpro_user_id != null
      ? String(req.body.jingpro_user_id).trim()
      : '';
    if (!jingproUserId) {
      return res.status(400).json({ code: 400001, msg: 'Missing jingpro_user_id', data: null });
    }
    const binding = await IntegrationBinding.findOne({
      platformId: 'jingpro',
      connectionId: req.integration.connectionId,
      tenantId: req.integration.tenantId,
      jingproUserId,
    }).exec();
    if (!binding || !await bindingAvailable(binding)) {
      return res.status(403).json({ code: 403012, msg: '当前商户客服账号未绑定或已失效', data: null });
    }
    const user = await TenantUser.findOne({
      _id: binding.ownerUserId,
      tenantId: binding.tenantId,
      role: 'agent',
      status: 'active',
    }).exec();
    if (!user) {
      return res.status(403).json({ code: 403013, msg: '当前商户客服账号不可用', data: null });
    }
    const { key, expiresAt, expiresIn } = await generateTemporaryLoginKey({
      tenantId: binding.tenantId,
      userId: binding.ownerUserId,
      source: 'jingpro',
    });
    await TenantIntegration.updateOne(
      { _id: req.integration.connectionId },
      { $set: { lastUsedAt: new Date() } },
    );
    res.set('Cache-Control', 'no-store');
    return res.json({
      code: 200,
      msg: '生成成功（120 秒内有效）',
      data: { key, loginKey: key, expiresAt, expiresIn },
    });
  },

  async employeeTokenLogin(req, res) {
    const setting = await getJingproPlatformSetting();
    if (!setting.enabled) {
      return res.status(403).json({ code: 403006, msg: '平台已停用 JingPro 扩展应用', data: null });
    }
    const tokenError = (reason = 'EMPLOYEE_TOKEN_INVALID', expired = false) => res.status(401).json({
      code: expired ? 401011 : 401010,
      msg: expired ? '密钥已过期' : '密钥错误',
      reason,
      data: null,
    });
    const settings = authSettings(await getSystemSettings());
    if (!settings.tenantLoginEnabled) {
      return res.status(403).json({ code: 4034, msg: '客服登录暂时关闭，有问题请联系管理员', data: null });
    }
    const token = String(req.body?.token || '').trim();
    if (!token) return tokenError('EMPLOYEE_TOKEN_MISSING');
    const header = jwtDecodeHeader(token);
    const keyId = header && String(header.kid || '').trim();
    if (!keyId || header.alg !== 'HS256' || header.typ !== 'JWT') return tokenError('EMPLOYEE_TOKEN_MALFORMED');
    const connection = await TenantIntegration.findOne({ keyId, provider: 'jingpro', enabled: true, status: 'active' }).select('+platformSecret').exec();
    if (!connection?.platformSecret) return tokenError('EMPLOYEE_TOKEN_UNKNOWN');
    if (!tenantAllowed(setting, connection.tenantId)) {
      return res.status(403).json({ code: 403006, msg: '当前企业未获平台授权使用 JingPro 扩展应用', data: null });
    }
    const payload = jwtVerifyHS256(token, connection.platformSecret);
    if (!payload) return tokenError('EMPLOYEE_TOKEN_INVALID');
    const now = Math.floor(Date.now() / 1000);
    const issuedAt = payload.iat;
    const expiresAt = payload.exp;
    if (Number.isInteger(expiresAt) && expiresAt <= now) return tokenError('EMPLOYEE_TOKEN_EXPIRED', true);
    const tenantId = String(payload.tenant_id || '');
    const employeeUserId = String(payload.employee_user_id || '');
    const jingproUserId = String(payload.jingpro_user_id || '');
    if (!Number.isInteger(issuedAt) || !Number.isInteger(expiresAt)
      || issuedAt > now + 30 || expiresAt <= issuedAt || expiresAt - issuedAt > 120
      || String(payload.sub || '') !== 'employee-login' || String(payload.aud || '') !== 'kefu-employee-login'
      || String(payload.iss || '') !== `jingpro:${keyId}` || String(payload.connection_id || '') !== keyId
      || tenantId !== String(connection.tenantId) || !jingproUserId || !employeeUserId || !String(payload.jti || '').trim()
      || !ObjectId.isValid(tenantId) || !ObjectId.isValid(employeeUserId)) {
      return tokenError('EMPLOYEE_TOKEN_INVALID');
    }
    const binding = await IntegrationBinding.findOne({
      connectionId: connection._id,
      tenantId: connection.tenantId,
      jingproUserId,
      ownerUserId: employeeUserId,
    }).exec();
    if (!binding) return tokenError('EMPLOYEE_TOKEN_UNRECOGNIZED');
    const [user, tenant, channel] = await Promise.all([
      TenantUser.findById(employeeUserId),
      Tenant.findById(tenantId),
      Channel.findOne({ _id: binding.channelId, tenantId, agentIds: employeeUserId }).select('_id').lean(),
    ]);
    if (!userAvailable(user, binding) || user.role !== 'agent' || !tenantAvailable(tenant) || !channel) {
      return tokenError('EMPLOYEE_TOKEN_UNAVAILABLE');
    }
    try {
      await consumeJti(String(payload.jti), connection._id, Math.max(1000, (expiresAt - now) * 1000));
    } catch (e) {
      if (e?.code === 40102) return tokenError('EMPLOYEE_TOKEN_USED');
      return res.status(503).json({ code: 503005, msg: '登录服务暂不可用，请稍后重试', reason: 'EMPLOYEE_TOKEN_STORE_UNAVAILABLE', data: null });
    }
    user.lastLoginAt = new Date();
    await Promise.all([
      user.save(),
      TenantIntegration.updateOne({ _id: connection._id }, { $set: { lastUsedAt: new Date() } }),
    ]);
    const { token: realToken } = await createSessionAndToken({ user, req, loginMethod: 'key' });
    return res.json({ code: 200, msg: 'ok', data: { token: realToken, user: sanitize(user), tenant: sanitize(tenant), redirect: '/messages' } });
  },

  async createSsoCode(req, res) {
    const token = String(req.body?.token || '').trim();
    if (!token) return res.status(400).json({ code: 400010, msg: 'Missing SSO token', data: null });
    const header = jwtDecodeHeader(token);
    if (!header || String(header.kid || '') !== String(req.integration.keyId) || header.alg !== 'HS256' || header.typ !== 'JWT') {
      return res.status(400).json({ code: 400011, msg: 'Invalid SSO token header', data: null });
    }
    const payload = jwtVerifyHS256(token, req.integrationConnection.platformSecret);
    const now = Math.floor(Date.now() / 1000);
    if (!payload || String(payload.sub || '') !== 'sso' || String(payload.aud || '') !== 'kefu-sso'
      || String(payload.iss || '') !== `jingpro:${req.integration.keyId}`
      || String(payload.connection_id || '') !== String(req.integration.keyId)
      || !String(payload.jti || '').trim() || payload.jingpro_user_id == null
      || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)
      || payload.iat > now + 30 || payload.exp <= payload.iat
      || payload.exp <= now || payload.exp - payload.iat > 300) {
      return res.status(400).json({ code: 400012, msg: 'Invalid or expired SSO token', data: null });
    }
    const code = crypto.randomBytes(32).toString('base64url');
    await cache.setJson(`integration:sso-code:${code}`, {
      token,
      connectionId: String(req.integration.connectionId),
    }, Math.max(1, Math.min(120, payload.exp - now)));
    res.set('Cache-Control', 'no-store');
    return res.json({ code: 200, msg: 'ok', data: { code } });
  },

  async ssoLogin(req, res) {
    const settings = authSettings(await getSystemSettings());
    if (!settings.tenantLoginEnabled) {
      return res.status(403).json({ code: 4034, msg: '客服登录暂时关闭，有问题请联系管理员', data: null });
    }
    const code = String(req.body?.code || '').trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(code)) {
      return res.status(401).json({ code: 401001, msg: 'Missing or invalid SSO code', data: null });
    }
    const exchanged = await cache.consumeJson(`integration:sso-code:${code}`);
    const token = exchanged && typeof exchanged.token === 'string' ? exchanged.token : '';
    const exchangedConnectionId = exchanged && typeof exchanged.connectionId === 'string'
      ? exchanged.connectionId
      : '';
    if (!token || !exchangedConnectionId) {
      return res.status(401).json({ code: 401001, msg: 'Invalid or used SSO code', data: null });
    }
    const setting = await getJingproPlatformSetting();
    if (!setting.enabled) return res.status(403).json({ code: 403006, msg: 'Jingpro integration is disabled', data: null });
    const header = jwtDecodeHeader(token);
    const keyId = header && String(header.kid || '').trim();
    if (!keyId || header.alg !== 'HS256' || header.typ !== 'JWT') return res.status(401).json({ code: 401002, msg: 'Invalid SSO token header', data: null });
    const connection = await TenantIntegration.findOne({ keyId, provider: 'jingpro', enabled: true, status: 'active' }).select('+platformSecret').exec();
    if (!connection || exchangedConnectionId !== String(connection._id)) {
      return res.status(401).json({ code: 401003, msg: 'Unknown, disabled or inactive integration key', data: null });
    }
    if (!tenantAllowed(setting, connection.tenantId)) {
      return res.status(403).json({ code: 403006, msg: '当前企业未获平台授权使用 JingPro 扩展应用', data: null });
    }
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
    try {
      await consumeJti(String(payload.jti), connection._id, Math.max(1000, (expiresAt - now) * 1000));
    } catch (e) {
      if (e && e.code === 40102) return res.status(401).json({ code: 40102, msg: 'SSO token already used', data: null });
      return res.status(500).json({ code: 500005, msg: 'JTI store error', data: null });
    }
    await TenantIntegration.updateOne({ _id: connection._id }, { $set: { lastUsedAt: new Date() } });
    const { token: realToken } = await createSessionAndToken({ user, req, loginMethod: 'key', expiresIn: '7d' });
    return res.json({ code: 200, msg: 'ok', data: { token: realToken, userType: 'merchant', user: sanitize(user), tenant: sanitize(tenant), redirect: '/messages' } });
  },

  async listAdminExtensions(req, res) {
    const platforms = await listPlatformExtensions();
    return res.json({ code: 200, msg: 'ok', data: await extensionUsage(platforms) });
  },

  async getAdminExtension(req, res) {
    try {
      const items = await extensionUsage([await getPlatformExtension(req.params.provider)]);
      return res.json({ code: 200, msg: 'ok', data: items[0] });
    } catch (error) {
      return res.status(error.status || 404).json({ code: 404001, msg: '扩展应用不存在', data: null });
    }
  },

  async setAdminExtensionStatus(req, res) {
    const scopeMode = req.body?.scopeMode === 'selected' ? 'selected' : 'all';
    const tenantIds = Array.isArray(req.body?.tenantIds) ? [...new Set(req.body.tenantIds.map(String))] : [];
    if (req.body?.confirmed !== true || typeof req.body?.enabled !== 'boolean') {
      return res.status(400).json({ code: 400004, msg: '请确认启停操作', data: null });
    }
    if (scopeMode === 'selected' && (!tenantIds.length || tenantIds.some(id => !ObjectId.isValid(id)))) {
      return res.status(400).json({ code: 400005, msg: '指定企业范围无效', data: null });
    }
    if (scopeMode === 'selected' && await Tenant.countDocuments({ _id: { $in: tenantIds } }) !== tenantIds.length) {
      return res.status(400).json({ code: 400005, msg: '指定企业不存在', data: null });
    }
    const provider = req.params.provider;
    const patch = { enabled: req.body.enabled, scopeMode, tenantIds };
    if (provider === 'jingpro') {
      const serverBaseUrl = req.body?.serverBaseUrl == null ? undefined : String(req.body.serverBaseUrl).trim();
      const widgetBaseUrl = req.body?.widgetBaseUrl == null ? undefined : String(req.body.widgetBaseUrl).trim();
      if (serverBaseUrl !== undefined && !isPublicHttpUrl(serverBaseUrl)) {
        return res.status(400).json({ code: 400001, msg: '客服 API 公共地址必须是完整的 http/https URL', data: null });
      }
      if (widgetBaseUrl !== undefined && !isPublicHttpUrl(widgetBaseUrl)) {
        return res.status(400).json({ code: 400001, msg: '客户聊天公共地址必须是完整的 http/https URL', data: null });
      }
      if (serverBaseUrl !== undefined) patch.serverBaseUrl = serverBaseUrl;
      if (widgetBaseUrl !== undefined) patch.widgetBaseUrl = widgetBaseUrl;
    }
    try {
      const before = await getPlatformExtension(provider);
      const after = await setPlatformControl(provider, patch);
      let revoked = null;
      if (after.provider === 'wechat_official') {
        if (before.enabled && !after.enabled) {
          revoked = await revokeWechatPlatformSessions(req, '微信公众号扩展已被平台停用');
        } else if (after.enabled && after.scopeMode === 'selected') {
          const previouslyAllowedAll = before.enabled && before.scopeMode !== 'selected';
          const removedTenantIds = previouslyAllowedAll
            ? await Tenant.find({ _id: { $nin: after.tenantIds } }).distinct('_id')
            : before.tenantIds.filter(id => !after.tenantIds.includes(id));
          if (removedTenantIds.length) {
            revoked = await revokeWechatPlatformSessions(
              req,
              '当前企业的微信公众号平台授权已被撤销',
              { tenantId: { $in: removedTenantIds } },
            );
          }
        }
      }
      await recordOperation({
        req,
        tenantId: null,
        user: req.admin,
        action: after.enabled ? 'extension.platform.enable' : 'extension.platform.disable',
        detail: `provider=${after.provider};before=${before.enabled};after=${after.enabled};scopeBefore=${before.scopeMode};scopeAfter=${after.scopeMode};scopeCount=${after.tenantIds.length};changed=${before.enabled !== after.enabled || before.scopeMode !== after.scopeMode || before.tenantIds.join(',') !== after.tenantIds.join(',')};tenantSessionsRevoked=${revoked?.tenantSessions || 0};customerSessionsRevoked=${revoked?.customerSessions || 0}`,
      });
      const [result] = await extensionUsage([after]);
      return res.json({
        code: 200,
        msg: before.enabled !== after.enabled
          ? (after.enabled ? '平台已启用' : '平台已停用')
          : (before.scopeMode !== after.scopeMode || before.tenantIds.join(',') !== after.tenantIds.join(',')
            ? '企业授权范围已更新'
            : '平台设置未变化'),
        data: result,
      });
    } catch (error) {
      return res.status(error.status || 404).json({ code: 404001, msg: '扩展应用不存在', data: null });
    }
  },

  async getAdminSetting(req, res) {
    const setting = await getJingproPlatformSetting();
    return res.json({ code: 200, msg: 'ok', data: setting });
  },

  async setAdminSetting(req, res) {
    const body = req.body || {};
    const current = await getJingproPlatformSetting();
    if (body.enabled != null && body.enabled !== current.enabled) {
      return res.status(400).json({ code: 400004, msg: '请使用扩展应用启停接口并完成二次确认', data: null });
    }
    const setting = {
      ...current,
      enabled: current.enabled,
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
