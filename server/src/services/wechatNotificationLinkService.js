// 忆梦云团队开发
const crypto = require('crypto');
const Link = require('../models/WechatNotificationLink');
const Account = require('../models/WechatOfficialAccount');
const Binding = require('../models/WechatIdentityBinding');
const Channel = require('../models/Channel');
const Conversation = require('../models/Conversation');
const User = require('../models/TenantUser');
const client = require('./wechatClientService');
const staff = require('./wechatStaffService');
const api = require('./wechatApiService');
const secrets = require('./wechatCredentialService');
const customerSessions = require('./customerSessionService');
const tenantSessions = require('./tenantSessionService');
const { assertPlatformEnabled } = require('./extensionPlatformService');

const LINK_TTL_MS = 48 * 60 * 60 * 1000;
const OAUTH_TTL_MS = 5 * 60 * 1000;
const EXCHANGE_TTL_MS = 2 * 60 * 1000;
const rawPattern = /^[a-f0-9]{64}$/;
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const random = () => crypto.randomBytes(32).toString('hex');
function referenceFor(outboxId) {
  const key = process.env.WECHAT_NOTIFICATION_LINK_KEY || '';
  if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new Error('WECHAT_NOTIFICATION_LINK_KEY_UNAVAILABLE');
  return crypto.createHmac('sha256', Buffer.from(key, 'hex')).update(`notification:${outboxId}`).digest('hex');
}

function publicUrl(reference) {
  return `${secrets.publicOrigin()}/api/wechat/notification/open/${reference}`;
}

async function ensure(item, account, binding, { Model = Link } = {}) {
  if (String(account?._id) !== String(item.officialAccountId)
    || String(account?.tenantId) !== String(item.tenantId)
    || account?.appId !== item.appId
    || account?.generation !== item.generation
    || account?.configVersion !== item.configVersion) {
    throw new Error('WECHAT_NOTIFICATION_ACCOUNT_SCOPE_INVALID');
  }
  const reference = referenceFor(item._id);
  const referenceHash = digest(reference);
  const readExisting = async () => {
    const existing = await Model.findOne({ outboxId: item._id }).select('+referenceHash');
    if (!existing) return null;
    if (new Date(existing.expiresAt).getTime() <= Date.now() || existing.referenceHash !== referenceHash) {
      throw new Error('WECHAT_NOTIFICATION_LINK_EXPIRED');
    }
    return { record: existing, reference };
  };
  const existing = await readExisting();
  if (existing) return existing;
  try {
    const record = await Model.create({
      outboxId: item._id,
      referenceHash,
      tenantId: item.tenantId,
      officialAccountId: item.officialAccountId,
      appId: item.appId,
      generation: item.generation,
      configVersion: item.configVersion,
      bindingId: binding._id,
      bindingVersion: binding.version,
      subjectType: binding.subjectType,
      subjectId: binding.subjectId,
      channelId: item.channelId,
      conversationId: item.conversationId,
      messageId: item.messageId,
      expiresAt: new Date(Date.now() + LINK_TTL_MS),
    });
    return { record, reference };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const raced = await readExisting();
    if (!raced) throw error;
    return raced;
  }
}

async function resolveReference(reference, { Model = Link } = {}) {
  if (!rawPattern.test(reference || '')) return null;
  return Model.findOne({
    referenceHash: digest(reference),
    consumedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  });
}

async function accountFor(record) {
  return Account.findOne({
    _id: record.officialAccountId,
    tenantId: record.tenantId,
    appId: record.appId,
    generation: record.generation,
    configVersion: record.configVersion,
    isCurrent: true,
    enabled: true,
    loginEnabled: true,
  }).select('+credentialCipher');
}

async function authorize(reference, browserProof, { Model = Link } = {}) {
  const record = await resolveReference(reference, { Model });
  if (record) await assertPlatformEnabled('wechat_official', record.tenantId);
  const account = record && await accountFor(record);
  if (!record || !account) throw new Error('WECHAT_NOTIFICATION_LINK_INVALID');
  const state = random();
  const proof = browserProof || random();
  const now = new Date();
  const claimed = await Model.findOneAndUpdate({
    _id: record._id,
    consumedAt: { $exists: false },
    expiresAt: { $gt: now },
    $or: [
      { oauthStateHash: { $exists: false } },
      { oauthExpiresAt: { $lte: now } },
    ],
  }, {
    $set: {
      oauthStateHash: digest(state),
      browserProofHash: digest(proof),
      oauthExpiresAt: new Date(now.getTime() + OAUTH_TTL_MS),
    },
    $unset: { oauthClaimedAt: 1, verifiedAt: 1, exchangeProofHash: 1, exchangeExpiresAt: 1 },
  }, { new: true });
  if (!claimed) throw new Error('WECHAT_NOTIFICATION_LINK_BUSY');
  const callback = `${secrets.publicOrigin()}/api/wechat/notification/callback`;
  const url = new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
  url.search = new URLSearchParams({ appid: account.appId, redirect_uri: callback, response_type: 'code', scope: 'snsapi_base', state }).toString();
  url.hash = 'wechat_redirect';
  return { authorizationUrl: url.toString(), browserProof: proof };
}

async function validateTarget(record, account, openId) {
  const binding = await Binding.findOne({
    _id: record.bindingId,
    tenantId: record.tenantId,
    officialAccountId: record.officialAccountId,
    appId: record.appId,
    generation: record.generation,
    subjectType: record.subjectType,
    subjectId: record.subjectId,
    ...(record.subjectType === 'staff' ? {
      channelId: { $exists: false },
      conversationId: { $exists: false },
    } : {
      channelId: record.channelId,
      conversationId: record.conversationId,
    }),
    version: record.bindingVersion,
    status: 'active',
    openIdHash: client.openHash(account, openId),
  });
  if (!binding) return null;
  const [channel, conversation] = await Promise.all([
    Channel.findOne({ _id: record.channelId, tenantId: record.tenantId }),
    Conversation.findOne({ _id: record.conversationId, tenantId: record.tenantId, channelId: record.channelId }),
  ]);
  if (!channel || !conversation) return null;
  if (record.subjectType === 'staff') {
    if (conversation.status !== 'active' || String(conversation.assignedAgentId) !== String(record.subjectId)) return null;
    const user = await User.findOne({ _id: record.subjectId, tenantId: record.tenantId, status: 'active' });
    return user ? { binding, conversation, user } : null;
  }
  if (String(conversation.customerId) !== String(record.subjectId)) return null;
  const subject = await client.validSubject({
    subjectType: record.subjectType,
    subjectId: record.subjectId,
    tenantId: record.tenantId,
    channelId: record.channelId,
    conversationId: record.conversationId,
  });
  return subject ? { binding, channel, conversation, subject } : null;
}

async function complete({ state, code, browserProof, fetcher = fetch, Model = Link }) {
  if (!rawPattern.test(state || '') || !rawPattern.test(browserProof || '')) throw new Error('WECHAT_NOTIFICATION_STATE_INVALID');
  const now = new Date();
  const record = await Model.findOneAndUpdate({
    oauthStateHash: digest(state),
    browserProofHash: digest(browserProof),
    oauthClaimedAt: { $exists: false },
    oauthExpiresAt: { $gt: now },
    consumedAt: { $exists: false },
    expiresAt: { $gt: now },
  }, {
    $set: { oauthClaimedAt: now },
    $unset: { oauthStateHash: 1 },
  }, { new: true });
  if (record) await assertPlatformEnabled('wechat_official', record.tenantId);
  const account = record && await accountFor(record);
  if (!record || !account) throw new Error('WECHAT_NOTIFICATION_STATE_INVALID');
  const { openId } = await api.exchangeOAuthCode(account, code, { fetcher });
  const target = await validateTarget(record, account, openId);
  if (!target) throw new Error('WECHAT_NOTIFICATION_TARGET_INVALID');
  const exchangeProof = random();
  const verified = await Model.findOneAndUpdate({
    _id: record._id,
    oauthClaimedAt: now,
    consumedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  }, {
    $set: {
      verifiedAt: new Date(),
      exchangeProofHash: digest(exchangeProof),
      exchangeExpiresAt: new Date(Date.now() + EXCHANGE_TTL_MS),
    },
  }, { new: true });
  if (!verified) throw new Error('WECHAT_NOTIFICATION_REPLAY');
  return { record: verified, exchangeProof };
}

async function exchange({ proof, req, Model = Link }) {
  if (!rawPattern.test(proof || '')) throw new Error('WECHAT_NOTIFICATION_EXCHANGE_INVALID');
  const now = new Date();
  const record = await Model.findOne({
    exchangeProofHash: digest(proof),
    verifiedAt: { $exists: true },
    exchangeExpiresAt: { $gt: now },
    consumedAt: { $exists: false },
    expiresAt: { $gt: now },
  });
  if (record) await assertPlatformEnabled('wechat_official', record.tenantId);
  const account = record && await accountFor(record);
  if (!record || !account) throw new Error('WECHAT_NOTIFICATION_EXCHANGE_INVALID');
  const binding = await Binding.findOne({ _id: record.bindingId, tenantId: record.tenantId, officialAccountId: record.officialAccountId, status: 'active', version: record.bindingVersion }).select('+openIdCipher');
  if (!binding) throw new Error('WECHAT_NOTIFICATION_TARGET_INVALID');
  const cipherField = binding.subjectType === 'staff' ? `staff:${binding.subjectId}` : `${binding.subjectType}:${binding.subjectId}:${binding.channelId}`;
  const openId = secrets.open(binding.openIdCipher, secrets.context(account, cipherField));
  const target = await validateTarget(record, account, openId);
  if (!target) throw new Error('WECHAT_NOTIFICATION_TARGET_INVALID');
  binding.currentConfigVersion = account.configVersion;
  let issued;
  if (record.subjectType === 'staff') {
    issued = await tenantSessions.createSessionAndToken({ user: target.user, req, loginMethod: 'wechat', binding });
  } else {
    issued = await customerSessions.createSessionAndToken({
      req,
      account: target.subject.account,
      binding: target.subject.binding,
      conversationId: record.conversationId,
      loginMethod: 'wechat',
      wechatBinding: binding,
    });
  }
  const consumed = await Model.findOneAndUpdate({
    _id: record._id,
    exchangeProofHash: digest(proof),
    consumedAt: { $exists: false },
    exchangeExpiresAt: { $gt: new Date() },
  }, {
    $set: { consumedAt: new Date() },
    $unset: { exchangeProofHash: 1 },
  });
  if (!consumed) {
    const Session = record.subjectType === 'staff' ? require('../models/TenantUserSession') : require('../models/CustomerSession');
    await Session.updateOne({ _id: issued.session._id, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: '微信通知链接兑换冲突' } }).catch(() => {});
    throw new Error('WECHAT_NOTIFICATION_REPLAY');
  }
  return {
    token: issued.token,
    subjectType: record.subjectType,
    conversationId: String(record.conversationId),
    ...(record.subjectType === 'staff' ? {
      user: { _id: target.user._id, username: target.user.username, displayName: target.user.displayName, role: target.user.role },
      tenant: { _id: record.tenantId },
    } : {
      channelPublicToken: target.channel.publicToken,
    }),
  };
}

module.exports = { LINK_TTL_MS, digest, referenceFor, ensure, publicUrl, resolveReference, authorize, complete, exchange, validateTarget };
