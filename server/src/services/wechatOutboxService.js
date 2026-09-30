// 忆梦云团队开发
const crypto = require('crypto');
const Outbox = require('../models/WechatNotificationOutbox');
const { isPlatformEnabled } = require('./extensionPlatformService');

async function transactionCapability(connection, { probe = false } = {}) {
  if (!connection?.db || connection.readyState !== 1) {
    return { available: false, reason: 'database_unavailable' };
  }
  try {
    const hello = await connection.db.admin().command({ hello: 1 });
    const available = hello.logicalSessionTimeoutMinutes != null
      && ((Boolean(hello.setName) && hello.maxWireVersion >= 7)
        || (hello.msg === 'isdbgrid' && hello.maxWireVersion >= 8));
    if (!available) return { available: false, reason: 'replica_set_required' };
    if (!probe) return { available: true, reason: 'available' };

    const session = await connection.startSession();
    try {
      await session.withTransaction(
        () => connection.db.collection('wechat_official_accounts').findOne(
          {},
          { session, projection: { _id: 1 } },
        ),
        {
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
          readPreference: 'primary',
        },
      );
      return { available: true, reason: 'available' };
    } finally {
      await session.endSession();
    }
  } catch {
    return { available: false, reason: 'transaction_probe_failed' };
  }
}

function eventFor({ account, message, conversation }) {
  if (!account?.enabled || !account.notificationEnabled || !account.isCurrent) return null;
  if (!message || !conversation || !message._id || !conversation._id
      || String(message.tenantId) !== String(account.tenantId)
      || String(conversation.tenantId) !== String(account.tenantId)
      || String(message.conversationId) !== String(conversation._id)) {
    throw new Error('WECHAT_OUTBOX_SCOPE_MISMATCH');
  }
  if (!['agent', 'customer'].includes(message.senderType)) return null;
  if (message.senderType === 'customer' && String(message.senderId) !== String(conversation.customerId)) {
    throw new Error('WECHAT_OUTBOX_SENDER_MISMATCH');
  }
  const recipientType = message.senderType === 'customer' ? 'staff' : 'customer';
  const recipientId = recipientType === 'staff' ? conversation.assignedAgentId : conversation.customerId;
  if (!recipientId || conversation.status !== 'active') return null;
  return {
    tenantId: account.tenantId,
    officialAccountId: account._id,
    appId: account.appId,
    generation: account.generation,
    configVersion: account.configVersion,
    channelId: conversation.channelId,
    conversationId: conversation._id,
    messageId: message._id,
    recipientType,
    recipientId,
    availableAt: new Date(Date.now() + 10000),
  };
}

async function appendEvent(context, session, Model = Outbox) {
  if (!session?.inTransaction()) throw new Error('WECHAT_OUTBOX_REQUIRES_TRANSACTION');
  const event = eventFor(context);
  if (!event) return null;
  const key = {
    tenantId: event.tenantId,
    officialAccountId: event.officialAccountId,
    generation: event.generation,
    messageId: event.messageId,
    recipientType: event.recipientType,
    recipientId: event.recipientId,
  };
  return Model.updateOne(key, { $setOnInsert: event }, { session, upsert: true });
}

async function publishWithOutbox({ connection, account, publish }, Model = Outbox) {
  if (!account || account.notificationEnabled === false
      || !await isPlatformEnabled('wechat_official', account.tenantId)) return publish(null);
  const capability = await transactionCapability(connection);
  if (!capability.available) throw new Error('WECHAT_NOTIFICATIONS_REQUIRE_TRANSACTIONS');
  const session = await connection.startSession();
  try {
    return await session.withTransaction(async () => {
      const result = await publish(session);
      await appendEvent({ account, message: result.message, conversation: result.conversation }, session, Model);
      return result;
    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
    });
  } finally {
    await session.endSession();
  }
}

async function claim({ now = new Date(), leaseMs = 30000, Model = Outbox } = {}) {
  const leaseId = crypto.randomBytes(24).toString('hex');
  const leaseUntil = new Date(now.getTime() + leaseMs);
  return Model.findOneAndUpdate({
    availableAt: { $lte: now },
    $or: [
      { state: 'pending' },
      { state: 'leased', leaseUntil: { $lte: now } },
    ],
  }, {
    $set: { state: 'leased', leaseId, leaseUntil, lastAttemptAt: now },
    $inc: { attempts: 1 },
  }, { sort: { availableAt: 1, _id: 1 }, new: true });
}

function retryDelay(attempts) {
  return Math.min(6 * 60 * 60 * 1000, 15000 * (2 ** Math.min(Math.max(attempts - 1, 0), 10)));
}

async function settle(item, outcome, { now = new Date(), Model = Outbox } = {}) {
  const scope = { _id: item._id, state: 'leased', leaseId: item.leaseId };
  const code = String(outcome?.code || '').slice(0, 80);
  if (outcome?.state === 'sent') {
    return Model.updateOne(scope, { $set: { state: 'sent', sentAt: now, resultCode: code }, $unset: { leaseId: 1, leaseUntil: 1 } });
  }
  if (outcome?.state === 'paused') {
    return Model.updateOne(scope, {
      $set: { state: 'pending', resultCode: code, availableAt: now },
      $inc: { attempts: -1 },
      $unset: { leaseId: 1, leaseUntil: 1 },
    });
  }
  if (outcome?.state === 'suppressed') {
    return Model.updateOne(scope, { $set: { state: 'suppressed', resultCode: code }, $unset: { leaseId: 1, leaseUntil: 1 } });
  }
  if (outcome?.state === 'unknown') {
    return Model.updateOne(scope, { $set: { state: 'unknown', resultCode: code }, $unset: { leaseId: 1, leaseUntil: 1 } });
  }
  const exhausted = item.attempts >= item.maxAttempts || outcome?.permanent === true;
  return Model.updateOne(scope, exhausted ? {
    $set: { state: 'dead', resultCode: code },
    $unset: { leaseId: 1, leaseUntil: 1 },
  } : {
    $set: { state: 'pending', resultCode: code, availableAt: new Date(now.getTime() + retryDelay(item.attempts)) },
    $unset: { leaseId: 1, leaseUntil: 1 },
  });
}

module.exports = {
  transactionCapability,
  eventFor,
  appendEvent,
  publishWithOutbox,
  claim,
  settle,
  retryDelay,
};
