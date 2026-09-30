// 忆梦云团队开发
const config = require('../config');
const CustomerSession = require('../models/CustomerSession');
const { getClientIp, passwordVersion, signToken } = require('../utils');

const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const WECHAT_TTL_MS = 2 * 60 * 60 * 1000;
const LAST_SEEN_INTERVAL_MS = 60 * 1000;

function clean(value, maxLength) {
  return String(Array.isArray(value) ? value[0] : value || '').trim().slice(0, maxLength);
}

function requestMeta(req) {
  const userAgent = clean(req?.headers?.['user-agent'], 500);
  const requestedType = clean(req?.headers?.['x-client-type'] || req?.body?.clientType, 20).toLowerCase();
  return {
    fingerprint: clean(req?.body?.fingerprint, 512),
    deviceId: clean(req?.headers?.['x-device-id'] || req?.body?.deviceId, 200),
    deviceType: requestedType === 'app' || /YimengCustomer/i.test(userAgent) ? 'app' : 'web',
    userAgent,
    ip: clean(getClientIp(req), 100),
  };
}

function tokenPayload({ session, account, binding }) {
  const payload = {
    type: 'customer',
    sid: String(session._id),
    identity: session.subjectType === 'visitor' ? 'guest' : 'customer',
  };
  if (session.scopeType === 'account') {
    payload.accountId = String(session.accountId);
    payload.pv = passwordVersion(account.password);
    return payload;
  }
  return {
    ...payload,
    id: String(session.subjectId),
    accountId: session.accountId ? String(session.accountId) : undefined,
    tenantId: String(session.tenantId),
    channelId: String(session.channelId),
    conversationId: session.conversationId ? String(session.conversationId) : undefined,
    ...(account ? { pv: passwordVersion(account.password) } : {}),
  };
}

async function createSessionAndToken({ req, account = null, binding = null, conversationId = null, loginMethod = 'password', wechatBinding = null }) {
  if (!account && !binding) throw new Error('CUSTOMER_SESSION_SUBJECT_REQUIRED');
  const accountScope = !binding;
  const subjectType = binding?.identityType === 'guest' ? 'visitor' : 'customer';
  const now = new Date();
  const ttl = loginMethod === 'wechat' ? WECHAT_TTL_MS : SESSION_TTL_MS;
  const session = await CustomerSession.create({
    subjectType,
    subjectId: accountScope ? account._id : binding._id,
    accountId: account?._id || binding?.accountId || null,
    tenantId: accountScope ? null : binding.tenantId,
    channelId: accountScope ? null : binding.channelId,
    conversationId: accountScope ? null : conversationId,
    scopeType: accountScope ? 'account' : 'channel',
    loginMethod,
    ...requestMeta(req),
    ...(wechatBinding ? {
      wechatBindingId: wechatBinding._id,
      wechatBindingVersion: wechatBinding.version,
      wechatConfigVersion: wechatBinding.currentConfigVersion,
    } : {}),
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + ttl),
  });
  const expiresIn = loginMethod === 'wechat' ? '2h' : config.jwt.customerExpiresIn;
  return { session, token: signToken(tokenPayload({ session, account, binding }), expiresIn) };
}

function same(left, right) {
  return String(left || '') === String(right || '');
}

async function validateSession(payload, { touch = true } = {}) {
  if (!payload?.sid || payload.type !== 'customer') return null;
  const now = new Date();
  const session = await CustomerSession.findOne({
    _id: payload.sid,
    revokedAt: null,
    expiresAt: { $gt: now },
  });
  if (!session) return null;
  const expectedType = payload.identity === 'guest' ? 'visitor' : 'customer';
  if (session.subjectType !== expectedType) return null;
  if (session.scopeType === 'account') {
    if (payload.id || payload.tenantId || payload.channelId || payload.conversationId || !same(payload.accountId, session.accountId)) return null;
  } else if (!same(payload.id, session.subjectId)
    || !same(payload.accountId, session.accountId)
    || !same(payload.tenantId, session.tenantId)
    || !same(payload.channelId, session.channelId)
    || !same(payload.conversationId, session.conversationId)) return null;
  if (session.loginMethod === 'wechat') {
    const binding = await require('./wechatClientService').activeBinding(
      session.wechatBindingId,
      session,
    );
    if (!binding) return null;
  }
  if (touch && now.getTime() - new Date(session.lastSeenAt).getTime() >= LAST_SEEN_INTERVAL_MS) {
    CustomerSession.updateOne(
      { _id: session._id, lastSeenAt: { $lte: new Date(now.getTime() - LAST_SEEN_INTERVAL_MS) } },
      { $set: { lastSeenAt: now } },
    ).catch(() => {});
  }
  return session;
}

async function revokeSession({ sessionId, reason = '会话已撤销', io }) {
  const session = await CustomerSession.findOneAndUpdate(
    { _id: sessionId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokeReason: String(reason).slice(0, 200) } },
    { new: true },
  );
  if (session) io?.in(`customer-session-${session._id}`).disconnectSockets(true);
  return session;
}

async function revokeMany(filter, reason, io) {
  const sessions = await CustomerSession.find({ ...filter, revokedAt: null }).select('_id');
  if (!sessions.length) return 0;
  await CustomerSession.updateMany(
    { _id: { $in: sessions.map(item => item._id) }, revokedAt: null },
    { $set: { revokedAt: new Date(), revokeReason: String(reason).slice(0, 200) } },
  );
  for (const session of sessions) io?.in(`customer-session-${session._id}`).disconnectSockets(true);
  return sessions.length;
}

module.exports = { createSessionAndToken, requestMeta, revokeMany, revokeSession, validateSession };
