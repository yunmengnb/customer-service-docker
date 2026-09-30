// 忆梦云团队开发
const crypto = require('crypto');
const config = require('../config');
const TenantUserSession = require('../models/TenantUserSession');
const { getClientIp, passwordVersion, signToken } = require('../utils');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LAST_SEEN_INTERVAL_MS = 60 * 1000;

function cleanHeader(value, maxLength) {
  return String(Array.isArray(value) ? value[0] : value || '').trim().slice(0, maxLength);
}

function parseUserAgent(userAgent) {
  const ua = String(userAgent || '');
  const browser = /wv\).*Chrome\/([\d.]+)/i.test(ua) ? 'Android WebView'
    : /Edg\/([\d.]+)/i.test(ua) ? 'Edge'
      : /Chrome\/([\d.]+)/i.test(ua) ? 'Chrome'
        : /Firefox\/([\d.]+)/i.test(ua) ? 'Firefox'
          : /Version\/([\d.]+).*Safari/i.test(ua) ? 'Safari'
            : '未知浏览器';
  const androidMatch = /Android\s+([^;)]+)/i.exec(ua);
  const iosMatch = /iPhone OS ([\d_]+)/i.exec(ua);
  const macMatch = /Mac OS X ([\d_]+)/i.exec(ua);
  const os = androidMatch ? `Android ${androidMatch[1]}`
    : iosMatch ? `iOS ${iosMatch[1].replaceAll('_', '.')}`
      : /Windows NT 10\.0/i.test(ua) ? 'Windows'
        : macMatch ? `macOS ${macMatch[1].replaceAll('_', '.')}`
          : /Linux/i.test(ua) ? 'Linux' : '未知系统';
  return { browser, os };
}

function extractRequestMeta(req) {
  const userAgent = cleanHeader(req?.headers?.['user-agent'], 500);
  const requestedClientType = cleanHeader(req?.headers?.['x-client-type'] || req?.body?.clientType, 20).toLowerCase();
  const deviceType = requestedClientType === 'app' || /YimengCustomerServiceApp/i.test(userAgent) ? 'app' : 'web';
  const deviceId = cleanHeader(req?.headers?.['x-device-id'] || req?.body?.deviceId, 200);
  const deviceName = cleanHeader(req?.headers?.['x-device-name'] || req?.body?.deviceName, 100);
  const parsed = parseUserAgent(userAgent);
  return {
    fingerprint: deviceId,
    deviceId,
    deviceType,
    deviceName: deviceName || `${parsed.os} · ${parsed.browser}`,
    browser: parsed.browser,
    os: parsed.os,
    userAgent,
    ip: cleanHeader(getClientIp(req), 100),
  };
}

function tokenPayload(user, sessionId) {
  return {
    type: 'tenant_user',
    id: String(user._id),
    tenantId: String(user.tenantId),
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    pv: passwordVersion(user.password),
    sid: String(sessionId),
  };
}

async function createSessionAndToken({ user, req, loginMethod = 'password', expiresIn = config.jwt.expiresIn, binding }) {
  const now = new Date();
  if (loginMethod === 'wechat') {
    binding = binding && await require('./wechatStaffService').activeBinding(binding._id, user._id, user.tenantId);
    if (!binding) throw new Error('WECHAT_BINDING_REVOKED');
  }
  if (loginMethod === 'wechat') expiresIn = '2h';
  const session = await TenantUserSession.create({
    tenantId: user.tenantId,
    userId: user._id,
    ...extractRequestMeta(req),
    loginMethod,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + (loginMethod === 'wechat' ? 7200000 : SESSION_TTL_MS)),
    ...(loginMethod === 'wechat' ? { wechatBindingId: binding._id, wechatBindingVersion: binding.version, wechatConfigVersion: binding.currentConfigVersion } : {}),
  });
  return { session, token: signToken(tokenPayload(user, session._id), expiresIn) };
}

async function signForSession(user, sessionId, expiresIn = config.jwt.expiresIn) {
  const session = await TenantUserSession.findOne({
    _id: sessionId,
    tenantId: user.tenantId,
    userId: user._id,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!session || !await validateSession({ sid: sessionId, id: user._id, tenantId: user.tenantId }, { touch: false })) return null;
  if (session.loginMethod === 'wechat') expiresIn = Math.max(1, Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
  return signToken(tokenPayload(user, session._id), expiresIn);
}

async function validateSession(payload, { touch = true } = {}) {
  if (!payload?.sid || !payload?.id || !payload?.tenantId) return null;
  const now = new Date();
  const session = await TenantUserSession.findOne({
    _id: payload.sid,
    tenantId: payload.tenantId,
    userId: payload.id,
    revokedAt: null,
    expiresAt: { $gt: now },
  });
  if (!session) return null;
  if (session.loginMethod === 'wechat') {
    const binding = await require('./wechatStaffService').activeBinding(session.wechatBindingId, payload.id, payload.tenantId);
    if (!binding || binding.version !== session.wechatBindingVersion || binding.currentConfigVersion !== session.wechatConfigVersion) return null;
  }
  if (touch && now.getTime() - new Date(session.lastSeenAt).getTime() >= LAST_SEEN_INTERVAL_MS) {
    TenantUserSession.updateOne(
      { _id: session._id, lastSeenAt: { $lte: new Date(now.getTime() - LAST_SEEN_INTERVAL_MS) } },
      { $set: { lastSeenAt: now } },
    ).catch(() => {});
  }
  return session;
}

async function revokeSession({ sessionId, tenantId, userId, revokedBy, reason = '用户撤销', io }) {
  const session = await TenantUserSession.findOneAndUpdate(
    { _id: sessionId, tenantId, userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedBy: revokedBy || userId, revokeReason: String(reason).slice(0, 200) } },
    { new: true },
  );
  if (session) io?.in(`tenant-session-${session._id}`).disconnectSockets(true);
  return session;
}

function loginKeyDigest(keyId, secret) {
  return crypto.createHmac('sha256', config.jwt.secret).update(`${keyId}:${secret}`).digest('hex');
}

function safeDigestEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'hex');
  const b = Buffer.from(String(right || ''), 'hex');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

module.exports = {
  createSessionAndToken,
  extractRequestMeta,
  loginKeyDigest,
  revokeSession,
  safeDigestEqual,
  signForSession,
  validateSession,
};
