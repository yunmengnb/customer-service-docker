// 忆梦云团队开发
const Account = require('../models/WechatOfficialAccount');
const Binding = require('../models/WechatIdentityBinding');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const Channel = require('../models/Channel');
const Customer = require('../models/Customer');
const TenantUser = require('../models/TenantUser');
const DeliveryLog = require('../models/WechatNotificationDeliveryLog');
const secrets = require('./wechatCredentialService');
const api = require('./wechatApiService');
const outbox = require('./wechatOutboxService');
const notificationLinks = require('./wechatNotificationLinkService');
const maintenance = require('./maintenanceService');
const { isPlatformEnabled } = require('./extensionPlatformService');

let timer = null;
let stopping = false;
let running = false;

function mapping(account) {
  const source = account.notificationFieldMapping instanceof Map
    ? Object.fromEntries(account.notificationFieldMapping)
    : account.notificationFieldMapping || {};
  const required = ['title', 'sender', 'time', 'remark'];
  if (!account.notificationTemplateId || required.some(key => !/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(source[key] || ''))) {
    throw new Error('template_invalid');
  }
  return source;
}

function value(text, max = 80) {
  return { value: String(text || '').replace(/[\r\n\t]+/g, ' ').slice(0, max) };
}

async function recipientBinding(item) {
  return Binding.findOne({
    tenantId: item.tenantId,
    officialAccountId: item.officialAccountId,
    appId: item.appId,
    generation: item.generation,
    subjectType: item.recipientType === 'staff' ? 'staff' : { $in: ['customer', 'visitor'] },
    subjectId: item.recipientId,
    channelId: item.recipientType === 'customer' ? item.channelId : { $exists: false },
    status: 'active',
    subscribeStatus: 'subscribed',
    notificationPreference: 'enabled',
  }).select('+openIdCipher');
}

function notificationLinkFailure(error) {
  const permanent = new Set([
    'WECHAT_NOTIFICATION_LINK_KEY_UNAVAILABLE',
    'WECHAT_NOTIFICATION_ACCOUNT_SCOPE_INVALID',
    'WECHAT_NOTIFICATION_LINK_EXPIRED',
    'WECHAT_ORIGIN_UNAVAILABLE',
  ]);
  return permanent.has(error?.message)
    ? { state: 'dead', permanent: true, code: 'notification_link_invalid' }
    : { state: 'retry', code: 'notification_link_unavailable' };
}

async function deliver(item, { fetcher = fetch } = {}) {
  if (!await isPlatformEnabled('wechat_official', item.tenantId)) {
    return { state: 'paused', code: 'platform_or_tenant_disabled' };
  }
  const [account, conversation, message, channel, binding] = await Promise.all([
    Account.findOne({
      _id: item.officialAccountId,
      tenantId: item.tenantId,
      appId: item.appId,
      generation: item.generation,
      configVersion: item.configVersion,
      isCurrent: true,
      enabled: true,
      notificationEnabled: true,
    }).select('+credentialCipher'),
    Conversation.findOne({ _id: item.conversationId, tenantId: item.tenantId, channelId: item.channelId }),
    Message.findOne({ _id: item.messageId, tenantId: item.tenantId, conversationId: item.conversationId }),
    Channel.findOne({ _id: item.channelId, tenantId: item.tenantId }).select('name brandName'),
    recipientBinding(item),
  ]);
  if (!account || !conversation || !message || !channel || !binding) {
    return { state: 'suppressed', code: 'recipient_or_scope_inactive' };
  }
  if (item.recipientType === 'staff' && String(conversation.assignedAgentId) !== String(item.recipientId)) {
    return { state: 'suppressed', code: 'staff_assignment_changed' };
  }
  if (item.recipientType === 'customer'
      && (String(conversation.customerId) !== String(item.recipientId)
        || (binding.subjectType === 'visitor' && String(binding.conversationId) !== String(conversation._id)))) {
    return { state: 'suppressed', code: 'customer_scope_changed' };
  }
  let fields;
  try {
    fields = mapping(account);
  } catch {
    return { state: 'dead', permanent: true, code: 'template_invalid' };
  }
  const sender = message.senderType === 'customer'
    ? await Customer.findById(message.senderId).select('nickname')
    : await TenantUser.findById(message.senderId).select('displayName');
  const cipherField = binding.subjectType === 'staff'
    ? `staff:${binding.subjectId}`
    : `${binding.subjectType}:${binding.subjectId}:${binding.channelId}`;
  const openId = secrets.open(binding.openIdCipher, secrets.context(account, cipherField));
  let landing;
  try {
    const ensured = await notificationLinks.ensure(item, account, binding);
    landing = notificationLinks.publicUrl(ensured.reference);
  } catch (error) {
    return notificationLinkFailure(error);
  }
  const data = {
    [fields.title]: value(channel.brandName || channel.name || '客服消息'),
    [fields.sender]: value(sender?.displayName || sender?.nickname || (message.senderType === 'customer' ? '客户' : '客服')),
    [fields.time]: value(new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Shanghai' }).format(message.createdAt)),
    [fields.remark]: value(message.messageType === 'text' ? '您有一条新消息' : `您有一条新的${{ image: '图片', video: '视频', file: '文件' }[message.messageType] || '消息'}`),
  };
  try {
    await api.sendTemplateMessage(account, {
      toUser: openId,
      templateId: account.notificationTemplateId,
      url: landing,
      data,
    }, { fetcher });
    return { state: 'sent', code: 'ok' };
  } catch (error) {
    if (error.message === 'WECHAT_SEND_REJECTED') return { state: 'dead', permanent: true, code: 'wechat_rejected' };
    if (error.message === 'WECHAT_SEND_UNKNOWN') return { state: 'unknown', code: 'transport_unknown' };
    return { state: 'retry', code: 'upstream_unavailable' };
  }
}

async function tick() {
  if (stopping || running || await maintenance.isFrozen()) return;
  running = true;
  await maintenance.markBusinessWriteAccepted();
  const finish = maintenance.beginWrite();
  try {
    if (await maintenance.isFrozen() || !await isPlatformEnabled('wechat_official')) return;
    for (let count = 0; count < 20 && !stopping; count++) {
      const item = await outbox.claim();
      if (!item) break;
      const startedAt = new Date();
      let outcome;
      try {
        outcome = await deliver(item);
      } catch {
        outcome = { state: 'retry', code: 'worker_delivery_error' };
      }
      const settled = await outbox.settle(item, outcome);
      if (settled?.modifiedCount === 1) {
        const exhausted = item.attempts >= item.maxAttempts || outcome.permanent === true;
        const finalOutcome = outcome.state === 'retry' && exhausted ? 'dead' : outcome.state;
        await DeliveryLog.updateOne(
          { outboxId: item._id, attempt: item.attempts },
          {
            $setOnInsert: {
              tenantId: item.tenantId,
              outboxId: item._id,
              attempt: item.attempts,
              startedAt,
              finishedAt: new Date(),
              outcome: finalOutcome,
              resultCode: String(outcome.code || '').slice(0, 80) || 'unspecified',
            },
          },
          { upsert: true },
        );
      }
    }
  } catch (error) {
    console.error('[WechatNotificationWorker]', error?.message || 'worker_error');
  } finally {
    finish();
    running = false;
  }
}

function start() {
  if (timer) return;
  stopping = false;
  timer = setInterval(tick, 2000);
  timer.unref?.();
  tick();
}

async function stop({ timeoutMs = 10000 } = {}) {
  stopping = true;
  clearInterval(timer);
  timer = null;
  const deadline = Date.now() + timeoutMs;
  while (running && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return !running;
}

module.exports = { start, stop, tick, deliver, mapping, notificationLinkFailure };
