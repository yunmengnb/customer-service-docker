// 忆梦云团队开发
const crypto = require('crypto');
const IntegrationNonce = require('../models/IntegrationNonce');
const TenantIntegration = require('../models/TenantIntegration');
const { getPlatformExtension, tenantAllowed } = require('../services/extensionPlatformService');

const JINGPRO_SETTING_KEY = 'jingpro.setting';

async function getJingproPlatformSetting() {
  return getPlatformExtension('jingpro');
}

function buildCanonical(method, path, ts, nonce, rawBody) {
  const m = String(method || 'GET').toUpperCase();
  const p = '/' + String(path || '/').replace(/^\/+/, '');
  const bodyStr = rawBody === undefined || rawBody === null ? '' : String(rawBody);
  const bodyHash = crypto.createHash('sha256').update(bodyStr, 'utf8').digest('hex');
  return `${m}\n${p}\n${ts}\n${nonce}\n${bodyHash}`;
}

function signRequest(method, path, ts, nonce, rawBody, secret) {
  const canonical = buildCanonical(method, path, ts, nonce, rawBody);
  return crypto.createHmac('sha256', String(secret || '')).update(canonical, 'utf8').digest('hex');
}

function multipartSignatureInput(fileSha256, fileSize) {
  return `file-sha256:${String(fileSha256 || '').toLowerCase()}\nfile-size:${String(fileSize)}`;
}

async function consumeNonce(nonce, scope, ttlMs = 600 * 1000) {
  if (!nonce) throw Object.assign(new Error('NONCE_EMPTY'), { code: 403003 });
  const key = `nonce:${String(scope)}:${String(nonce)}`;
  try {
    await IntegrationNonce.create({ key, type: 'nonce', expireAt: new Date(Date.now() + ttlMs) });
    return true;
  } catch (e) {
    if (e && e.code === 11000) throw Object.assign(new Error('NONCE_REPLAY'), { code: 403004 });
    throw e;
  }
}

async function consumeJti(jti, scope, ttlMs = 300 * 1000) {
  if (!jti) throw Object.assign(new Error('JTI_EMPTY'), { code: 40101 });
  const key = `jti:${String(scope)}:${String(jti)}`;
  try {
    await IntegrationNonce.create({ key, type: 'jti', expireAt: new Date(Date.now() + ttlMs) });
    return true;
  } catch (e) {
    if (e && e.code === 11000) throw Object.assign(new Error('JTI_REPLAY'), { code: 40102 });
    throw e;
  }
}

function timingSafeEqual(a, b) {
  try {
    const sa = Buffer.from(String(a || ''), 'utf8');
    const sb = Buffer.from(String(b || ''), 'utf8');
    return sa.length === sb.length && crypto.timingSafeEqual(sa, sb);
  } catch (e) {
    return false;
  }
}

function decodeJwtPart(value) {
  try {
    return JSON.parse(Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch (e) {
    return null;
  }
}

function jwtDecodeHeader(token) {
  const parts = String(token || '').split('.');
  return parts.length === 3 ? decodeJwtPart(parts[0]) : null;
}

function jwtVerifyHS256(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const header = decodeJwtPart(parts[0]);
  if (!header || header.alg !== 'HS256' || header.typ !== 'JWT') return null;
  const expected = crypto.createHmac('sha256', String(secret || '')).update(parts[0] + '.' + parts[1], 'utf8').digest('base64url');
  if (!timingSafeEqual(expected, parts[2])) return null;
  return decodeJwtPart(parts[1]);
}

async function authenticateIntegration(req, res, next, requireActive) {
  const keyId = String(req.header('X-Integration-Key') || '').trim();
  const ts = String(req.header('X-Timestamp') || '');
  const nonce = String(req.header('X-Nonce') || '');
  const sig = String(req.header('X-Signature') || '');
  const version = String(req.header('X-Signature-Version') || '').trim().toLowerCase();
  if (!keyId || !ts || !nonce || !sig || !version) {
    return res.status(403).json({ code: 403001, msg: 'Missing required signature headers (X-Integration-Key, X-Timestamp, X-Nonce, X-Signature, X-Signature-Version)', data: null });
  }
  if (version !== 'v2') {
    return res.status(403).json({ code: 403007, msg: 'Unsupported signature version', data: null });
  }
  const platformSetting = await getJingproPlatformSetting();
  if (!platformSetting.enabled) {
    return res.status(403).json({ code: 403006, msg: 'Jingpro integration is disabled', data: null });
  }
  const connectionQuery = { keyId, provider: 'jingpro', enabled: true };
  if (requireActive) connectionQuery.status = 'active';
  const connection = await TenantIntegration.findOne(connectionQuery).select('+platformSecret').exec();
  if (!connection || !connection.platformSecret) {
    return res.status(403).json({ code: 403002, msg: requireActive ? 'Integration connection not active' : 'Integration connection not found or disabled', data: null });
  }
  if (!tenantAllowed(platformSetting, connection.tenantId)) {
    return res.status(403).json({ code: 403006, msg: 'Tenant is not authorized for Jingpro integration', data: null });
  }
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
    return res.status(403).json({ code: 403003, msg: 'Request timestamp expired (±300s allowed)', data: { serverTs: Math.floor(Date.now() / 1000), clientTs: tsNum } });
  }
  const isMultipart = /^multipart\/form-data\b/i.test(String(req.headers['content-type'] || ''));
  let rawBody;
  if (isMultipart) {
    const fileSha256 = String(req.header('X-File-SHA256') || '').trim().toLowerCase();
    const fileSize = String(req.header('X-File-Size') || '').trim();
    if (!/^[a-f0-9]{64}$/.test(fileSha256) || !/^(0|[1-9]\d*)$/.test(fileSize)) {
      return res.status(403).json({ code: 403008, msg: 'Multipart requests require valid X-File-SHA256 and X-File-Size headers', data: null });
    }
    rawBody = multipartSignatureInput(fileSha256, fileSize);
    req.integrationSignedFile = { sha256: fileSha256, size: Number(fileSize) };
  } else {
    rawBody = typeof req.rawBody === 'string' ? req.rawBody : (req.rawBody && Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : (req.body && typeof req.body !== 'string' ? JSON.stringify(req.body) : ''));
  }
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  const expected = signRequest(req.method, path, ts, nonce, rawBody, connection.platformSecret);
  if (!timingSafeEqual(expected, sig)) {
    return res.status(403).json({ code: 403005, msg: 'Signature verification failed', data: null });
  }
  try {
    await consumeNonce(nonce, connection._id, 600 * 1000);
  } catch (e) {
    if (e && e.code === 403004) return res.status(403).json({ code: 403004, msg: 'Nonce replayed', data: null });
    return res.status(500).json({ code: 500001, msg: 'Nonce store error: ' + String(e && e.message || e), data: null });
  }
  req.integration = {
    connectionId: String(connection._id),
    tenantId: String(connection.tenantId),
    keyId: connection.keyId,
    platformName: connection.platformName,
  };
  req.integrationConnection = connection;
  req.integrationPlatformSetting = platformSetting;
  next();
}

function integrationAuth(req, res, next) {
  return authenticateIntegration(req, res, next, true);
}

function integrationPingAuth(req, res, next) {
  return authenticateIntegration(req, res, next, false);
}

function verifyMultipartFile(req, res, next) {
  if (!req.file || !req.integrationSignedFile) {
    return res.status(403).json({ code: 403008, msg: 'Signed multipart file is required', data: null });
  }
  const actualSha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  const actualSize = req.file.buffer.length;
  if (actualSize !== req.integrationSignedFile.size || !timingSafeEqual(actualSha256, req.integrationSignedFile.sha256)) {
    return res.status(403).json({ code: 403009, msg: 'Multipart file digest or size mismatch', data: null });
  }
  next();
}

module.exports = {
  JINGPRO_SETTING_KEY,
  getJingproPlatformSetting,
  buildCanonical,
  signRequest,
  multipartSignatureInput,
  consumeNonce,
  consumeJti,
  timingSafeEqual,
  jwtDecodeHeader,
  jwtVerifyHS256,
  integrationAuth,
  integrationPingAuth,
  verifyMultipartFile,
};
