// 忆梦云团队开发
const crypto = require('crypto');
const TenantUserLoginKey = require('../models/TenantUserLoginKey');
const { loginKeyDigest, safeDigestEqual } = require('./tenantSessionService');

const LOGIN_KEY_TTL_SECONDS = 120;
const LOGIN_KEY_PATTERN = /^kf_([A-Za-z0-9-]{8,64})_([A-Za-z0-9_-]{32,128})$/;

async function generateTemporaryLoginKey({ tenantId, userId, source = 'tenant' }) {
  const keyId = crypto.randomBytes(12).toString('hex');
  const secret = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOGIN_KEY_TTL_SECONDS * 1000);
  const loginKey = await TenantUserLoginKey.findOneAndUpdate(
    { userId },
    {
      $set: {
        tenantId,
        keyId,
        secretDigest: loginKeyDigest(keyId, secret),
        source,
        expiresAt,
        consumedAt: null,
        lastUsedAt: null,
        revokedAt: null,
      },
      $setOnInsert: { userId },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return {
    key: `kf_${keyId}_${secret}`,
    loginKey,
    expiresAt,
    expiresIn: LOGIN_KEY_TTL_SECONDS,
  };
}

async function consumeTemporaryLoginKey(rawKey) {
  const match = LOGIN_KEY_PATTERN.exec(String(rawKey || '').trim());
  if (!match) return { reason: rawKey ? 'LOGIN_KEY_MALFORMED' : 'LOGIN_KEY_MISSING' };

  const loginKey = await TenantUserLoginKey.findOne({ keyId: match[1] }).select('+secretDigest');
  if (!loginKey) return { reason: 'LOGIN_KEY_UNKNOWN' };
  if (!safeDigestEqual(loginKey.secretDigest, loginKeyDigest(loginKey.keyId, match[2]))) {
    return { reason: 'LOGIN_KEY_INVALID' };
  }
  if (loginKey.revokedAt) return { reason: 'LOGIN_KEY_REVOKED' };
  if (loginKey.consumedAt || loginKey.lastUsedAt) return { reason: 'LOGIN_KEY_USED' };
  if (!loginKey.expiresAt || loginKey.expiresAt.getTime() <= Date.now()) {
    return { reason: 'LOGIN_KEY_EXPIRED' };
  }

  const now = new Date();
  const consumed = await TenantUserLoginKey.findOneAndUpdate(
    {
      _id: loginKey._id,
      keyId: loginKey.keyId,
      revokedAt: null,
      consumedAt: null,
      lastUsedAt: null,
      expiresAt: { $gt: now },
    },
    { $set: { consumedAt: now, lastUsedAt: now } },
    { new: true },
  );
  if (consumed) return { loginKey: consumed };

  const current = await TenantUserLoginKey.findById(loginKey._id).lean();
  if (current?.consumedAt || current?.lastUsedAt) return { reason: 'LOGIN_KEY_USED' };
  if (current?.revokedAt) return { reason: 'LOGIN_KEY_REVOKED' };
  return { reason: 'LOGIN_KEY_EXPIRED' };
}

module.exports = {
  LOGIN_KEY_TTL_SECONDS,
  consumeTemporaryLoginKey,
  generateTemporaryLoginKey,
};
