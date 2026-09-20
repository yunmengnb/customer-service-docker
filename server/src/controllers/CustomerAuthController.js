// 忆梦云团队开发
const CustomerAccount = require('../models/CustomerAccount');
const Customer = require('../models/Customer');
const Channel = require('../models/Channel');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { unreadLookup } = require('../services/conversationUnreadService');
const crypto = require('crypto');
const config = require('../config');
const cache = require('../utils/cache');
const { sendMail } = require('../utils/mailer');
const { normalizeEmail, sendEmailCode, verifyEmailCode } = require('../utils/emailVerification');
const presence = require('../utils/presence');
const { getSystemSettings, authSettings } = require('../utils/systemSettings');
const { ok, error, hashPassword, comparePassword, signToken, verifyToken, normalizePhone, qqAvatarUrl, customerAvatarUrl, hashFingerprint, getClientIp, passwordVersion } = require('../utils');

async function getChannelByToken(publicToken) {
  const key = `config:channel:token:${publicToken}`;
  const cached = await cache.getJson(key);
  if (cached) return cached;
  const channel = await Channel.findOne({ publicToken }).lean();
  if (channel) await cache.setJson(key, channel, config.redis.cacheTtlSeconds);
  return channel;
}

// 调用方已验证全局账号；旧绑定还必须证明同一凭据，不能仅凭邮箱或手机号接管历史。
async function findSessionBinding(channel, account, password) {
  const scope = { tenantId: channel.tenantId, channelId: channel._id };
  const existing = await Customer.findOne({ ...scope, accountId: account._id });
  if (existing) return existing;
  const legacy = await Customer.findOne({ ...scope, phone: account.phone });
  if (!legacy) return null;
  if (legacy.accountId) {
    if (String(legacy.accountId) === String(account._id)) return legacy;
    throw Object.assign(new Error('渠道账号绑定冲突'), { status: 409 });
  }
  const sameCredentials = legacy.password && (legacy.password === account.password
    || (password && comparePassword(password, account.password) && comparePassword(password, legacy.password)));
  if (legacy.identityType === 'guest' || !sameCredentials) {
    throw Object.assign(new Error('旧渠道账号凭据不一致，请联系管理员处理'), { status: 409 });
  }
  const linked = await Customer.findOneAndUpdate(
    { ...scope, _id: legacy._id, accountId: null, password: legacy.password },
    { $set: { accountId: account._id } }, { new: true },
  );
  if (linked) return linked;
  const winner = await Customer.findOne({ ...scope, _id: legacy._id, accountId: account._id });
  if (winner) return winner;
  throw Object.assign(new Error('渠道账号绑定冲突，请重试'), { status: 409 });
}

async function resolveConversation(channel, customerId) {
  const scope = {
    tenantId: channel.tenantId,
    channelId: channel._id,
    customerId,
  };
  let conversation = await Conversation.findOne({
    ...scope,
    status: { $in: ['waiting', 'active'] },
  }).sort({ lastMessageAt: -1 });
  if (conversation) return { conversation, created: false };

  conversation = await Conversation.findOneAndUpdate(
    { ...scope, status: 'closed' },
    {
      $set: { status: 'waiting', assignedAgentId: null },
      $unset: { acceptedAt: 1, closedAt: 1 },
    },
    { new: true, sort: { lastMessageAt: -1 } }
  );
  if (conversation) return { conversation, created: false };

  conversation = await Conversation.findOne({
    ...scope,
    status: { $in: ['waiting', 'active'] },
  }).sort({ lastMessageAt: -1 });
  if (conversation) return { conversation, created: false };

  conversation = await Conversation.create({ ...scope, status: 'waiting' });
  return { conversation, created: true };
}

async function createGreetingMessages(channel, conversation) {
  const messages = [];
  const welcomeContent = String(channel.welcomeMessage || '').trim();
  const welcomeImageUrl = String(channel.welcomeImageUrl || '').trim();
  if (welcomeContent || welcomeImageUrl) {
    messages.push(await Message.create({
      tenantId: channel.tenantId,
      conversationId: conversation._id,
      senderType: 'bot',
      messageType: welcomeImageUrl ? 'image' : 'text',
      autoReplyType: 'welcome',
      content: welcomeContent,
      attachmentUrl: welcomeImageUrl,
      attachmentName: channel.welcomeImageName || '',
    }));
  }
  const offlineContent = String(channel.offlineMessage || '').trim();
  if (channel.status === 'offline' && offlineContent) {
    messages.push(await Message.create({
      tenantId: channel.tenantId,
      conversationId: conversation._id,
      senderType: 'bot',
      messageType: 'text',
      autoReplyType: 'offline',
      content: offlineContent,
    }));
  }
  if (messages.length) {
    conversation.lastMessageAt = messages[messages.length - 1].createdAt;
    await conversation.save();
  }
}

function accountJson(account, binding = null) {
  const data = account.toJSON();
  data.accountId = data._id;
  data.identityType = 'customer';
  data.avatarUrl = customerAvatarUrl(data);
  if (binding) {
    data._id = binding._id;
    data.bindingId = binding._id;
    data.tenantId = binding.tenantId;
    data.channelId = binding.channelId;
    data.messageReceivingDisabled = binding.messageReceivingDisabled;
    data.blocked = binding.blocked;
  }
  return data;
}

function guestJson(binding) {
  const data = binding.toJSON();
  data.identityType = 'guest';
  data.bindingId = data._id;
  delete data.phone;
  delete data.email;
  delete data.qq;
  data.avatarUrl = '';
  return data;
}

function channelJson(channel) {
  return {
    id: channel._id,
    name: channel.name,
    brandName: channel.brandName,
    brandColor: channel.brandColor,
    avatarUrl: channel.avatarUrl,
    welcomeMessage: channel.welcomeMessage,
    welcomeImageUrl: channel.welcomeImageUrl || '',
    welcomeImageName: channel.welcomeImageName || '',
    offlineMessage: channel.offlineMessage || '',
    status: channel.status,
  };
}

function createAccountSession(res, account, isNew = false) {
  const token = signToken({ type: 'customer', accountId: account._id.toString(), pv: passwordVersion(account.password) }, config.jwt.customerExpiresIn);
  return ok(res, { token, isNew, profileRequired: !account.qq, customer: accountJson(account) });
}

function getGuestPayload(req, channel) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.type !== 'customer' || payload.identity !== 'guest') return null;
  if (String(payload.channelId) !== String(channel._id) || String(payload.tenantId) !== String(channel.tenantId)) return null;
  return payload;
}

async function bindGuestToAccount(req, channel, account) {
  const guestPayload = getGuestPayload(req, channel);
  if (!guestPayload?.id) return { binding: null };
  const guestBinding = await Customer.findOne({
    _id: guestPayload.id,
    accountId: null,
    tenantId: channel.tenantId,
    channelId: channel._id,
    identityType: 'guest',
    status: 'active',
    blocked: false,
  });
  if (!guestBinding) return { binding: null };
  const existing = await Customer.findOne({ accountId: account._id, channelId: channel._id }).select('_id');
  if (existing && String(existing._id) !== String(guestBinding._id)) {
    return { conflict: true };
  }
  guestBinding.accountId = account._id;
  guestBinding.phone = account.phone;
  guestBinding.password = account.password;
  guestBinding.qq = account.qq;
  guestBinding.email = account.email;
  guestBinding.nickname = account.nickname;
  guestBinding.avatarUrl = account.avatarUrl;
  guestBinding.identityType = 'customer';
  await guestBinding.save();
  return { binding: guestBinding };
}

async function resolveAccount(payload) {
  if (!payload || payload.identity === 'guest') return null;
  if (payload.accountId) {
    const account = await CustomerAccount.findById(payload.accountId);
    if (account) return account;
  }
  const binding = await Customer.findById(payload.id);
  if (!binding || binding.identityType !== 'customer' || binding.status !== 'active' || binding.blocked) return null;
  if (String(binding.tenantId) !== String(payload.tenantId) || String(binding.channelId) !== String(payload.channelId)) return null;
  if (binding.accountId) return CustomerAccount.findById(binding.accountId);

  // 兼容迁移前签发的 JWT：沿用原 Customer ID，并按旧资料补建账户。
  let account = await CustomerAccount.findOne({ phone: binding.phone });
  if (!account) {
    try {
      account = await CustomerAccount.create({
        phone: binding.phone,
        password: binding.password,
        qq: binding.qq,
        email: binding.email,
        nickname: binding.nickname,
        avatarUrl: binding.avatarUrl,
        registerIp: binding.registerIp,
        registerUserAgent: binding.registerUserAgent,
        registerFingerprintHash: binding.registerFingerprintHash,
        lastLoginIp: binding.lastLoginIp,
        lastLoginAt: binding.lastLoginAt,
        status: binding.status,
      });
    } catch (err) {
      if (err?.code !== 11000) throw err;
      account = await CustomerAccount.findOne({ phone: binding.phone });
      // 邮箱已属于其他手机号时仅放弃迁移邮箱，不能按邮箱合并账号。
      if (!account && binding.email) {
        try {
          account = await CustomerAccount.create({
            phone: binding.phone,
            password: binding.password,
            qq: binding.qq,
            email: '',
            nickname: binding.nickname,
            avatarUrl: binding.avatarUrl,
            registerIp: binding.registerIp,
            registerUserAgent: binding.registerUserAgent,
            registerFingerprintHash: binding.registerFingerprintHash,
            lastLoginIp: binding.lastLoginIp,
            lastLoginAt: binding.lastLoginAt,
            status: binding.status,
          });
        } catch (retryErr) {
          if (retryErr?.code !== 11000) throw retryErr;
          account = await CustomerAccount.findOne({ phone: binding.phone });
        }
      }
    }
  }
  // 包含唯一键竞争后的重查结果，不能仅凭手机号接管已有全局身份。
  if (!account || !binding.password || account.password !== binding.password) return null;
  binding.accountId = account._id;
  await binding.save();
  return account;
}

class CustomerAuthController {
  // POST /api/client/channels/:token/auth/guest
  async guest(req, res) {
    const channel = await getChannelByToken(req.params.token);
    if (!channel) return error(res, '客服链接无效或已过期', 404, 404);

    const fingerprintHash = hashFingerprint(req.body.fingerprint);
    const ip = getClientIp(req);
    let binding = await Customer.findOne({
      channelId: channel._id,
      identityType: 'guest',
      registerFingerprintHash: fingerprintHash,
    }).sort({ lastLoginAt: -1, createdAt: -1 });
    let restored = Boolean(binding);

    if (!binding) {
      const guestKey = crypto.randomBytes(16).toString('hex');
      try {
        binding = await Customer.create({
          accountId: null,
          tenantId: channel.tenantId,
          channelId: channel._id,
          phone: `guest_${channel._id}_${guestKey}`,
          password: hashPassword(crypto.randomBytes(32).toString('hex')),
          nickname: '访客',
          identityType: 'guest',
          registerIp: ip,
          registerUserAgent: req.headers['user-agent'] || '',
          registerFingerprintHash: fingerprintHash,
          lastLoginIp: ip,
          lastLoginAt: new Date(),
        });
        restored = false;
      } catch (err) {
        if (err?.code !== 11000) throw err;
        binding = await Customer.findOne({
          channelId: channel._id,
          identityType: 'guest',
          registerFingerprintHash: fingerprintHash,
        });
        if (!binding) throw err;
        restored = true;
      }
    } else {
      if (binding.blocked || binding.status !== 'active') return error(res, '当前访客已被限制访问', 4035, 403);
      binding.lastLoginIp = ip;
      binding.lastLoginAt = new Date();
      await binding.save();
    }

    const resolved = await resolveConversation(channel, binding._id);
    if (resolved.created) await createGreetingMessages(channel, resolved.conversation);
    const jwt = signToken({
      type: 'customer',
      identity: 'guest',
      id: binding._id.toString(),
      tenantId: channel.tenantId.toString(),
      channelId: channel._id.toString(),
      conversationId: resolved.conversation._id.toString(),
    }, config.jwt.customerExpiresIn);
    return ok(res, {
      token: jwt,
      restored,
      profileRequired: false,
      customer: guestJson(binding),
      channel: channelJson(channel),
      conversation: { id: resolved.conversation._id, status: resolved.conversation.status },
    });
  }

  // POST /api/client/auth/login
  async accountLogin(req, res) {
    const settings = authSettings(await getSystemSettings());
    if (!settings.customerLoginEnabled) return error(res, '客户登录暂时关闭，有问题请联系管理员', 4034, 403);

    const identifier = String(req.body.identifier).trim().toLowerCase();
    const isEmail = identifier.includes('@');
    const normalized = isEmail ? identifier : normalizePhone(identifier);
    const account = await CustomerAccount.findOne(isEmail ? { email: normalized } : { phone: normalized });
    if (!account || !comparePassword(req.body.password, account.password)) return error(res, '账号或密码错误', 401, 401);
    if (account.status !== 'active') return error(res, '账号已被禁用', 403, 403);
    account.lastLoginIp = getClientIp(req);
    account.lastLoginAt = new Date();
    await account.save();
    return createAccountSession(res, account);
  }

  // POST /api/client/auth/register-code
  async sendAccountRegisterCode(req, res) {
    // #region debug-point E:account-entry
    const reportRegisterDebug = (msg, data) => fetch('http://email-debug:7777/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'email-verification', runId: 'pre-fix', hypothesisId: 'E', location: 'server/src/controllers/CustomerAuthController.js:sendAccountRegisterCode', msg: `[DEBUG] ${msg}`, data, ts: Date.now() }) }).catch(() => {});
    reportRegisterDebug('register-code-entry', { entryType: 'account' });
    // #endregion
    const settings = authSettings(await getSystemSettings());
    if (!settings.customerRegisterEnabled) {
      reportRegisterDebug('register-code-result', { entryType: 'account', resultStatus: 'registration-disabled', httpCode: 403, cacheHitCategory: 'not-checked' });
      return error(res, '暂时无法注册，有问题请联系管理员', 4034, 403);
    }
    if (!settings.customerRegisterEmailVerificationEnabled) {
      return error(res, '客户注册暂未开启邮箱验证', 4035, 403);
    }
    const email = String(req.body.email).trim().toLowerCase();
    if (await CustomerAccount.exists({ email })) {
      reportRegisterDebug('register-code-result', { entryType: 'account', resultStatus: 'already-registered', httpCode: 400, cacheHitCategory: 'not-checked' });
      return error(res, '邮箱已被注册');
    }
    const key = `customer:register-code:${crypto.createHash('sha256').update(email).digest('hex')}`;
    const existing = await cache.getJson(key);
    if (existing?.sentAt && Date.now() - existing.sentAt < 60000) {
      reportRegisterDebug('register-code-result', { entryType: 'account', resultStatus: 'rate-limited', httpCode: 429, cacheHitCategory: 'fresh' });
      return error(res, '验证码发送过于频繁，请稍后再试', 4290, 429);
    }
    const cacheHitCategory = existing ? 'stale' : 'miss';
    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = crypto.createHmac('sha256', config.jwt.secret).update(`${email}:${code}`).digest('hex');
    try {
      const sent = await sendMail({ to: email, subject: '客户注册邮箱验证码', text: `您的注册验证码是 ${code}，10分钟内有效。如非本人操作，请忽略本邮件。` });
      if (!sent) {
        reportRegisterDebug('register-code-result', { entryType: 'account', resultStatus: 'mail-unavailable', httpCode: 503, cacheHitCategory });
        return error(res, '邮箱服务暂不可用', 5031, 503);
      }
      await cache.setJson(key, { codeHash, sentAt: Date.now() }, 600);
      reportRegisterDebug('register-code-result', { entryType: 'account', resultStatus: 'success', httpCode: 200, cacheHitCategory });
      return ok(res, null, '验证码已发送');
    } catch (_) {
      reportRegisterDebug('register-code-result', { entryType: 'account', resultStatus: 'send-failed', httpCode: 500, cacheHitCategory });
      return error(res, '验证码发送失败，请稍后重试', 5001, 500);
    }
  }

  // POST /api/client/auth/register
  async accountRegister(req, res) {
    const settings = authSettings(await getSystemSettings());
    if (!settings.customerRegisterEnabled) return error(res, '暂时无法注册，有问题请联系管理员', 4034, 403);
    if (req.body.agreementAccepted !== true) return error(res, '请先阅读并同意免责协议和使用协议', 4001, 400);
    const phone = normalizePhone(req.body.phone);
    const email = String(req.body.email).trim().toLowerCase();
    if (await CustomerAccount.exists({ phone })) return error(res, '手机号已被注册');
    if (await CustomerAccount.exists({ email })) return error(res, '邮箱已被注册');
    if (settings.customerRegisterEmailVerificationEnabled) {
      const codeKey = `customer:register-code:${crypto.createHash('sha256').update(email).digest('hex')}`;
      const verification = await cache.getJson(codeKey);
      const submittedHash = crypto.createHmac('sha256', config.jwt.secret).update(`${email}:${req.body.emailCode}`).digest('hex');
      if (!verification?.codeHash || verification.codeHash.length !== submittedHash.length || !crypto.timingSafeEqual(Buffer.from(verification.codeHash), Buffer.from(submittedHash))) return error(res, '邮箱验证码错误或已过期', 4004, 400);
      if (!await cache.consumeMatchingJson(codeKey, submittedHash)) return error(res, '邮箱验证码错误或已过期', 4004, 400);
    }
    const ip = getClientIp(req);
    let account;
    try {
      account = await CustomerAccount.create({ phone, qq: req.body.qq, email, password: hashPassword(req.body.password), registerIp: ip, registerUserAgent: req.headers['user-agent'] || '', registerFingerprintHash: hashFingerprint(req.body.fingerprint), lastLoginIp: ip, lastLoginAt: new Date() });
    } catch (err) {
      if (err?.code === 11000) return error(res, '手机号或邮箱已被注册');
      throw err;
    }

    return createAccountSession(res, account, true);
  }

  // POST /api/client/channels/:token/auth/login
  async login(req, res) {
    const channel = await getChannelByToken(req.params.token);
    if (!channel) return error(res, '客服链接无效或已过期', 404, 404);
    const settings = authSettings(await getSystemSettings());
    if (!settings.customerLoginEnabled) return error(res, '客户登录暂时关闭，有问题请联系管理员', 4034, 403);

    const identifier = String(req.body.identifier).trim().toLowerCase();
    const isEmail = identifier.includes('@');
    const normalized = isEmail ? identifier : normalizePhone(identifier);
    const query = isEmail ? { email: normalized } : { phone: normalized };
    let account = await CustomerAccount.findOne(query);

    // 兼容尚未执行迁移的旧手机号数据。
    if (!account && !isEmail) {
      const legacyBinding = await Customer.findOne({ channelId: channel._id, phone: normalized });
      if (legacyBinding && comparePassword(req.body.password, legacyBinding.password)) {
        account = await CustomerAccount.create({
          phone: normalized,
          password: legacyBinding.password,
          qq: legacyBinding.qq,
          email: legacyBinding.email,
          nickname: legacyBinding.nickname,
          avatarUrl: legacyBinding.avatarUrl,
          registerIp: legacyBinding.registerIp,
          registerUserAgent: legacyBinding.registerUserAgent,
          registerFingerprintHash: legacyBinding.registerFingerprintHash,
          status: legacyBinding.status,
        });
        legacyBinding.accountId = account._id;
        await legacyBinding.save();
      }
    }
    if (!account || !comparePassword(req.body.password, account.password)) return error(res, '账号或密码错误', 401, 401);
    if (account.status !== 'active') return error(res, '账号已被禁用', 403, 403);

    account.lastLoginIp = getClientIp(req);
    account.lastLoginAt = new Date();
    await account.save();
    const guestBinding = await bindGuestToAccount(req, channel, account);
    if (guestBinding.conflict) return error(res, '该客户账号已和该客服有对话，暂无法绑定', 4091, 409);
    return CustomerAuthController.prototype.createSession(req, res, channel, account, false, guestBinding.binding);
  }

  // POST /api/client/channels/:token/auth/register-code
  async sendRegisterCode(req, res) {
    // #region debug-point E:channel-entry
    const reportRegisterDebug = (msg, data) => fetch('http://email-debug:7777/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'email-verification', runId: 'pre-fix', hypothesisId: 'E', location: 'server/src/controllers/CustomerAuthController.js:sendRegisterCode', msg: `[DEBUG] ${msg}`, data, ts: Date.now() }) }).catch(() => {});
    reportRegisterDebug('register-code-entry', { entryType: 'channel' });
    // #endregion
    const channel = await getChannelByToken(req.params.token);
    if (!channel) {
      reportRegisterDebug('register-code-result', { entryType: 'channel', resultStatus: 'channel-not-found', httpCode: 404, cacheHitCategory: 'not-checked' });
      return error(res, '客服链接无效或已过期', 404, 404);
    }
    const settings = authSettings(await getSystemSettings());
    if (!settings.customerRegisterEnabled) {
      reportRegisterDebug('register-code-result', { entryType: 'channel', resultStatus: 'registration-disabled', httpCode: 403, cacheHitCategory: 'not-checked' });
      return error(res, '暂时无法注册，有问题请联系管理员', 4034, 403);
    }
    if (!settings.customerRegisterEmailVerificationEnabled) {
      return error(res, '客户注册暂未开启邮箱验证', 4035, 403);
    }

    const email = String(req.body.email).trim().toLowerCase();
    if (await CustomerAccount.exists({ email })) {
      reportRegisterDebug('register-code-result', { entryType: 'channel', resultStatus: 'already-registered', httpCode: 400, cacheHitCategory: 'not-checked' });
      return error(res, '邮箱已被注册');
    }
    const key = `customer:register-code:${crypto.createHash('sha256').update(email).digest('hex')}`;
    const existing = await cache.getJson(key);
    if (existing?.sentAt && Date.now() - existing.sentAt < 60000) {
      reportRegisterDebug('register-code-result', { entryType: 'channel', resultStatus: 'rate-limited', httpCode: 429, cacheHitCategory: 'fresh' });
      return error(res, '验证码发送过于频繁，请稍后再试', 4290, 429);
    }
    const cacheHitCategory = existing ? 'stale' : 'miss';

    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = crypto.createHmac('sha256', config.jwt.secret).update(`${email}:${code}`).digest('hex');
    try {
      const sent = await sendMail({
        to: email,
        subject: '客户注册邮箱验证码',
        text: `您的注册验证码是 ${code}，10分钟内有效。如非本人操作，请忽略本邮件。`,
      });
      if (!sent) {
        reportRegisterDebug('register-code-result', { entryType: 'channel', resultStatus: 'mail-unavailable', httpCode: 503, cacheHitCategory });
        return error(res, '邮箱服务暂不可用', 5031, 503);
      }
      await cache.setJson(key, { codeHash, sentAt: Date.now() }, 600);
      reportRegisterDebug('register-code-result', { entryType: 'channel', resultStatus: 'success', httpCode: 200, cacheHitCategory });
      return ok(res, null, '验证码已发送');
    } catch (_) {
      reportRegisterDebug('register-code-result', { entryType: 'channel', resultStatus: 'send-failed', httpCode: 500, cacheHitCategory });
      return error(res, '验证码发送失败，请稍后重试', 5001, 500);
    }
  }

  // POST /api/client/channels/:token/auth/register
  async register(req, res) {
    const channel = await getChannelByToken(req.params.token);
    if (!channel) return error(res, '客服链接无效或已过期', 404, 404);
    const settings = authSettings(await getSystemSettings());
    if (!settings.customerRegisterEnabled) return error(res, '暂时无法注册，有问题请联系管理员', 4034, 403);
    if (req.body.agreementAccepted !== true) return error(res, '请先阅读并同意免责协议和使用协议', 4001, 400);

    const phone = normalizePhone(req.body.phone);
    const email = String(req.body.email).trim().toLowerCase();
    if (await CustomerAccount.exists({ phone })) return error(res, '手机号已被注册');
    if (await CustomerAccount.exists({ email })) return error(res, '邮箱已被注册');

    if (settings.customerRegisterEmailVerificationEnabled) {
      const codeKey = `customer:register-code:${crypto.createHash('sha256').update(email).digest('hex')}`;
      const verification = await cache.getJson(codeKey);
      const submittedHash = crypto.createHmac('sha256', config.jwt.secret).update(`${email}:${req.body.emailCode}`).digest('hex');
      if (!verification?.codeHash || verification.codeHash.length !== submittedHash.length || !crypto.timingSafeEqual(Buffer.from(verification.codeHash), Buffer.from(submittedHash))) {
        return error(res, '邮箱验证码错误或已过期', 4004, 400);
      }

      if (!await cache.consumeMatchingJson(codeKey, submittedHash)) return error(res, '邮箱验证码错误或已过期', 4004, 400);
    }
    const ip = getClientIp(req);
    let account;
    try {
      account = await CustomerAccount.create({
        phone,
        qq: req.body.qq,
        email,
        password: hashPassword(req.body.password),
        registerIp: ip,
        registerUserAgent: req.headers['user-agent'] || '',
        registerFingerprintHash: hashFingerprint(req.body.fingerprint),
        lastLoginIp: ip,
        lastLoginAt: new Date(),
      });
    } catch (err) {
      if (err?.code === 11000) return error(res, '手机号或邮箱已被注册');
      throw err;
    }

    const guestBinding = await bindGuestToAccount(req, channel, account);
    if (guestBinding.conflict) return error(res, '当前访客记录无法绑定到该客户账号，请刷新后登录已有账号', 4091, 409);
    return CustomerAuthController.prototype.createSession(req, res, channel, account, true, guestBinding.binding);
  }

  async createSession(req, res, channel, account, isNew, preferredBinding = null) {
    const ip = getClientIp(req);
    let binding;
    try { binding = preferredBinding || await findSessionBinding(channel, account, req.body?.password); }
    catch (err) { if (err.status === 409) return error(res, err.message, 4091, 409); throw err; }
    if (!binding) {
      binding = await Customer.create({
        accountId: account._id,
        tenantId: channel.tenantId,
        channelId: channel._id,
        phone: account.phone,
        password: account.password,
        qq: account.qq,
        email: account.email,
        nickname: account.nickname,
        identityType: 'customer',
        avatarUrl: account.avatarUrl,
        registerIp: ip,
        registerUserAgent: req.headers['user-agent'] || '',
        registerFingerprintHash: account.registerFingerprintHash,
        lastLoginIp: ip,
        lastLoginAt: new Date(),
      });
    } else {
      if (binding.blocked) return error(res, '当前账号已被限制访问', 4035, 403);
      binding.lastLoginIp = ip;
      binding.lastLoginAt = new Date();
      await binding.save();
    }

    const resolved = await resolveConversation(channel, binding._id);
    const conversation = resolved.conversation;
    if (resolved.created) await createGreetingMessages(channel, conversation);

    const jwt = signToken({
      type: 'customer',
      id: binding._id.toString(),
      accountId: account._id.toString(),
      tenantId: channel.tenantId.toString(),
      channelId: channel._id.toString(),
      conversationId: conversation._id.toString(),
      pv: passwordVersion(account.password),
    }, config.jwt.customerExpiresIn);
    return ok(res, {
      token: jwt,
      isNew,
      profileRequired: !account.qq,
      customer: accountJson(account, binding),
      channel: {
        id: channel._id,
        name: channel.name,
        brandName: channel.brandName,
        brandColor: channel.brandColor,
        avatarUrl: channel.avatarUrl,
        welcomeMessage: channel.welcomeMessage,
        welcomeImageUrl: channel.welcomeImageUrl || '',
        welcomeImageName: channel.welcomeImageName || '',
        offlineMessage: channel.offlineMessage || '',
        status: channel.status,
      },
      conversation: { id: conversation._id, status: conversation.status },
    });
  }

  // POST /api/client/channels/:token/switch
  async switchChannel(req, res) {
    const account = await resolveAccount(req.customer);
    if (!account) return error(res, '账号不存在', 404, 404);
    const channel = await getChannelByToken(req.params.token);
    if (!channel) return error(res, '客服链接无效或已过期', 404, 404);

    const ip = getClientIp(req);
    let binding;
    try { binding = await findSessionBinding(channel, account, req.body?.password); }
    catch (err) { if (err.status === 409) return error(res, err.message, 4091, 409); throw err; }
    if (!binding) {
      binding = await Customer.create({
        accountId: account._id,
        tenantId: channel.tenantId,
        channelId: channel._id,
        phone: account.phone,
        password: account.password,
        qq: account.qq,
        email: account.email,
        nickname: account.nickname,
        avatarUrl: account.avatarUrl,
        registerIp: ip,
        registerUserAgent: req.headers['user-agent'] || '',
        registerFingerprintHash: account.registerFingerprintHash,
        lastLoginIp: ip,
        lastLoginAt: new Date(),
      });
    } else {
      if (binding.blocked) return error(res, '当前账号已被限制访问', 4035, 403);
      binding.lastLoginIp = ip;
      binding.lastLoginAt = new Date();
      await binding.save();
    }

    const resolved = await resolveConversation(channel, binding._id);
    const conversation = resolved.conversation;
    if (resolved.created) await createGreetingMessages(channel, conversation);

    const jwt = signToken({
      type: 'customer',
      id: binding._id.toString(),
      accountId: account._id.toString(),
      tenantId: channel.tenantId.toString(),
      channelId: channel._id.toString(),
      conversationId: conversation._id.toString(),
      pv: passwordVersion(account.password),
    }, config.jwt.customerExpiresIn);
    return ok(res, { token: jwt });
  }

  // GET /api/client/channels/:token
  async getChannelInfo(req, res) {
    const { token: publicToken } = req.params;
    const channel = await getChannelByToken(publicToken);
    if (!channel) return error(res, '客服链接无效或已过期', 404, 404);
    const agentIds = (channel.agentIds || []).map(id => String(id));
    const onlineStates = await Promise.all(agentIds.map(id => presence.isOnline('tenant_user', id)));
    return ok(res, {
      id: channel._id,
      name: channel.name,
      brandName: channel.brandName,
      brandColor: channel.brandColor,
      avatarUrl: channel.avatarUrl,
      welcomeMessage: channel.welcomeMessage,
      offlineMessage: channel.offlineMessage,
      status: channel.status,
      agentIds,
      agentOnline: channel.status === 'online' && onlineStates.some(Boolean),
    });
  }

  // POST /api/client/profile/qq
  async updateQQ(req, res) {
    if (req.customer.identity === 'guest') return error(res, '访客不能修改客户资料，请先绑定客户账号', 4036, 403);
    const account = await resolveAccount(req.customer);
    const binding = await Customer.findById(req.customer.id);
    if (!account || !binding) return error(res, '账号不存在', 404, 404);
    const { qq } = req.body;
    const previousQQAvatar = qqAvatarUrl(account.qq);
    account.qq = qq;
    if (!account.avatarUrl || account.avatarUrl === previousQQAvatar) account.avatarUrl = '';
    await account.save();
    await Customer.updateMany(
      { accountId: account._id },
      { $set: { qq: account.qq, avatarUrl: account.avatarUrl } },
    );
    return ok(res, accountJson(account, binding));
  }

  // GET /api/client/me
  async me(req, res) {
    if (req.customer.identity === 'guest') {
      const binding = await Customer.findById(req.customer.id);
      if (!binding) return error(res, '访客身份不存在', 404, 404);
      return ok(res, guestJson(binding));
    }
    const account = await resolveAccount(req.customer);
    if (!account) return error(res, '账号不存在', 404, 404);
    const binding = req.customer.id ? await Customer.findById(req.customer.id) : null;
    return ok(res, accountJson(account, binding));
  }

  // GET /api/client/channels/history
  async channelHistory(req, res) {
    const account = await resolveAccount(req.customer);
    if (!account) return error(res, '账号不存在', 404, 404);
    const bindings = await Customer.find({ accountId: account._id }).lean();
    const channelIds = bindings.map(item => item.channelId);
    const bindingIds = bindings.map(item => item._id);
    const [channels, conversations] = await Promise.all([
      Channel.find({ _id: { $in: channelIds } })
        .select('_id tenantId publicToken name brandName brandColor avatarUrl status')
        .lean(),
      Conversation.aggregate([
        { $match: { customerId: { $in: bindingIds } } },
        ...unreadLookup(),
        { $sort: { lastMessageAt: -1, createdAt: -1 } },
        { $group: { _id: '$customerId', conversation: { $first: '$$ROOT' } } },
      ]),
    ]);
    const conversationIds = conversations.map(item => item.conversation._id);
    const latestMessages = conversationIds.length ? await Message.aggregate([
      { $match: { conversationId: { $in: conversationIds }, deletedForCustomerAt: null } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$conversationId', message: { $first: '$$ROOT' } } },
    ]) : [];
    const channelMap = Object.fromEntries(channels.map(item => [String(item._id), item]));
    const conversationMap = Object.fromEntries(conversations.map(item => [String(item._id), item.conversation]));
    const messageMap = Object.fromEntries(latestMessages.map(item => [String(item._id), Message.applyAttachmentUrls(item.message)]));
    const items = bindings.flatMap(binding => {
      const channel = channelMap[String(binding.channelId)];
      if (!channel || String(channel.tenantId) !== String(binding.tenantId)) return [];
      const conversation = conversationMap[String(binding._id)];
      const lastMessage = conversation ? messageMap[String(conversation._id)] || null : null;
      return [{
        _id: channel._id,
        bindingId: binding._id,
        publicToken: channel.publicToken,
        name: channel.name,
        brandName: channel.brandName,
        brandColor: channel.brandColor,
        avatarUrl: channel.avatarUrl,
        status: channel.status,
        current: String(binding.channelId) === String(req.customer.channelId),
        conversationId: conversation?._id || null,
        lastMessage,
        lastMessageAt: lastMessage?.createdAt || conversation?.createdAt || binding.createdAt,
        unreadCount: conversation?.customerUnreadCount || 0,
      }];
    }).sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
    return ok(res, items);
  }

  async sendProfilePasswordCode(req, res) {
    const account = await resolveAccount(req.customer);
    if (!account) return error(res, '账号不存在', 404, 404);
    const result = await sendEmailCode({ scope: `customer-profile:${account._id}:change-password`, email: account.email, subject: '客户修改密码验证码', action: '修改密码' });
    if (!result.ok) return error(res, result.message, result.code, result.status);
    return ok(res, null, '验证码已发送');
  }

  async sendResetCode(req, res) {
    const phone = normalizePhone(req.body.phone);
    const email = normalizeEmail(req.body.email);
    const account = await CustomerAccount.findOne({ phone, email });
    if (account) {
      const result = await sendEmailCode({ scope: `customer-reset-password:${account._id}`, email, subject: '客户找回密码验证码', action: '找回密码' });
      if (!result.ok) return error(res, result.message, result.code, result.status);
    }
    return ok(res, null, '如手机号与邮箱匹配，验证码将发送至该邮箱');
  }

  async resetPassword(req, res) {
    const phone = normalizePhone(req.body.phone);
    const email = normalizeEmail(req.body.email);
    const account = await CustomerAccount.findOne({ phone, email });
    const valid = account && await verifyEmailCode({ scope: `customer-reset-password:${account._id}`, email, code: req.body.emailCode });
    if (!valid) return error(res, '手机号、邮箱或验证码错误', 4004, 400);
    account.password = hashPassword(req.body.newPassword);
    await account.save();
    await Customer.updateMany({ accountId: account._id }, { $set: { password: account.password } });
    return ok(res, null, '密码已重置，请使用新密码登录');
  }

  // POST /api/client/profile/password
  async updatePassword(req, res) {
    try {
      const { currentPassword, newPassword, confirmPassword, emailCode } = req.body;
      if (req.customer.identity === 'guest') return error(res, '访客不能修改密码，请先绑定客户账号', 4036, 403);
      if (newPassword !== confirmPassword) return error(res, '两次输入的新密码不一致', 4003, 400);
      const account = await resolveAccount(req.customer);
      if (!account) return error(res, '账号不存在', 4041, 404);
      if (!comparePassword(currentPassword, account.password)) return error(res, '当前密码错误', 4001, 400);
      if (comparePassword(newPassword, account.password)) return error(res, '新密码不能与当前密码相同', 4002, 400);
      const valid = await verifyEmailCode({ scope: `customer-profile:${account._id}:change-password`, email: account.email, code: emailCode });
      if (!valid) return error(res, '邮箱验证码错误或已过期', 4004, 400);
      account.password = hashPassword(newPassword);
      await account.save();
      // 旧 Customer.password 暂时同步，保证迁移期间旧版本服务仍可验证。
      await Customer.updateMany({ accountId: account._id }, { $set: { password: account.password } });
      return ok(res, null, '密码修改成功，请使用新密码登录');
    } catch (err) {
      return error(res, '密码修改失败，请稍后重试', 5001, 500);
    }
  }
}

module.exports = new CustomerAuthController();
