// 忆梦云团队开发
const Account = require('../models/WechatOfficialAccount');
const Binding = require('../models/WechatIdentityBinding');
const Channel = require('../models/Channel');
const Conversation = require('../models/Conversation');
const Customer = require('../models/Customer');
const CustomerAccount = require('../models/CustomerAccount');
const CustomerSession = require('../models/CustomerSession');
const Tenant = require('../models/Tenant');
const { digest } = require('./wechatAuthService');
const { assertPlatformEnabled } = require('./extensionPlatformService');

function scope(account) {
  return {
    tenantId: account.tenantId,
    officialAccountId: account._id,
    appId: account.appId,
    generation: account.generation,
  };
}

async function current(filter, purpose) {
  if (!filter?.tenantId) throw new Error('UNAVAILABLE');
  await assertPlatformEnabled('wechat_official', filter.tenantId);
  const feature = purpose === 'bind' ? 'bindingEnabled' : 'loginEnabled';
  const account = await Account.findOne({
    ...filter,
    isCurrent: true,
    enabled: true,
    [feature]: true,
  }).select('+credentialCipher');
  if (!account || !await Tenant.exists({
    _id: account.tenantId,
    status: { $in: ['active', 'trial'] },
  })) throw new Error('UNAVAILABLE');
  return account;
}

async function channelContext(publicToken, purpose) {
  if (typeof publicToken !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(publicToken)) {
    throw new Error('CHANNEL_UNAVAILABLE');
  }
  const channel = await Channel.findOne({ publicToken });
  if (!channel) throw new Error('CHANNEL_UNAVAILABLE');
  const account = await current({ tenantId: channel.tenantId }, purpose);
  return { account, channel };
}

function openHash(account, openId) {
  return digest(`${account.tenantId}:${account._id}:${account.appId}:${account.generation}:${openId}`);
}

async function validSubject({ subjectType, subjectId, tenantId, channelId, conversationId }) {
  const binding = await Customer.findOne({
    _id: subjectId,
    tenantId,
    channelId,
    identityType: subjectType === 'visitor' ? 'guest' : 'customer',
    status: 'active',
    blocked: false,
    ...(subjectType === 'visitor' ? { accountId: null } : { accountId: { $ne: null } }),
  });
  if (!binding) return null;
  const conversation = await Conversation.findOne({
    _id: conversationId,
    tenantId,
    channelId,
    customerId: subjectId,
  }).select('_id');
  if (!conversation) return null;
  if (subjectType === 'customer') {
    const account = await CustomerAccount.findOne({
      _id: binding.accountId,
      status: 'active',
    });
    if (!account) return null;
    return { binding, account, conversation };
  }
  return { binding, account: null, conversation };
}

async function initiatingSession(record) {
  if (!record?.initiatingSessionId || record.clientSide !== 'client' || record.purpose !== 'bind') return null;
  const session = await CustomerSession.findOne({
    _id: record.initiatingSessionId,
    subjectType: record.initiatingSubjectType,
    subjectId: record.initiatingSubject,
    tenantId: record.tenantId,
    channelId: record.channelId,
    conversationId: record.conversationId,
    scopeType: 'channel',
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!session) return null;
  return await validSubject({
    subjectType: session.subjectType,
    subjectId: session.subjectId,
    tenantId: session.tenantId,
    channelId: session.channelId,
    conversationId: session.conversationId,
  }) ? session : null;
}

async function activeBinding(id, session) {
  if (!session || session.scopeType !== 'channel') return null;
  const binding = await Binding.findOne({
    _id: id,
    tenantId: session.tenantId,
    subjectType: session.subjectType,
    subjectId: session.subjectId,
    channelId: session.channelId,
    conversationId: session.conversationId,
    status: 'active',
    version: session.wechatBindingVersion,
  });
  if (!binding) return null;
  try {
    const account = await current({
      _id: binding.officialAccountId,
      tenantId: binding.tenantId,
      appId: binding.appId,
      generation: binding.generation,
    }, 'login');
    if (account.configVersion !== session.wechatConfigVersion) return null;
    if (!await validSubject({
      subjectType: binding.subjectType,
      subjectId: binding.subjectId,
      tenantId: binding.tenantId,
      channelId: binding.channelId,
      conversationId: binding.conversationId,
    })) return null;
    binding.currentConfigVersion = account.configVersion;
    return binding;
  } catch {
    return null;
  }
}

module.exports = {
  activeBinding,
  channelContext,
  current,
  initiatingSession,
  openHash,
  scope,
  validSubject,
};
