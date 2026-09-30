// 忆梦云团队开发
const config = require('../config');
const PlatformAdmin = require('../models/PlatformAdmin');
const { comparePassword, error } = require('../utils');

function canonicalHttpsOrigin(value) {
  if (typeof value !== 'string' || !value || /[\u0000-\u001f\u007f,]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    if (url.port && url.port !== '443') return null;
    return `https://${url.hostname.toLowerCase()}`;
  } catch (_) {
    return null;
  }
}

function requestSource(req) {
  const originHeader = req.headers.origin;
  if (originHeader !== undefined) return canonicalHttpsOrigin(originHeader);
  const referer = String(req.headers.referer || '');
  if (!referer || /[\u0000-\u001f\u007f,]/.test(referer)) return null;
  try {
    const url = new URL(referer);
    if (url.username || url.password) return null;
    return canonicalHttpsOrigin(`${url.protocol}//${url.host}`);
  } catch (_) {
    return null;
  }
}

function trustedRequestOrigin(req) {
  if (!req.app?.get('trust proxy fn')?.(req.socket?.remoteAddress, 0)) return null;
  const proto = String(req.headers['x-forwarded-proto'] || '');
  const host = String(req.headers['x-forwarded-host'] || '');
  if (proto !== 'https' || !host || /[\u0000-\u001f\u007f,]/.test(host)) return null;
  return canonicalHttpsOrigin(`${proto}://${host}`);
}

function originGuard(req, res, next) {
  const source = requestSource(req);
  const configured = config.admin.publicOrigins;
  const expected = new Set(configured);
  const proxied = trustedRequestOrigin(req);
  if (proxied) expected.add(proxied);
  if (!source || !expected.has(source)) return error(res, '来源校验失败', 4038, 403);
  if (String(req.headers['content-type'] || '').split(';')[0] !== 'application/json') return error(res, '请求格式无效', 4150, 415);
  next();
}
async function requirePassword(req, res, next) {
  const password = String(req.body?.currentPassword || '');
  const admin = await PlatformAdmin.findById(req.admin.id).select('+password');
  if (!password || !admin || !comparePassword(password, admin.password)) return error(res, '需要重新验证当前管理员密码', 4039, 403);
  delete req.body.currentPassword;
  next();
}
module.exports = { originGuard, requirePassword, canonicalHttpsOrigin, requestSource, trustedRequestOrigin };
