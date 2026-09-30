// 忆梦云团队开发
const express = require('express');
const rateLimit = require('express-rate-limit');
const links = require('../services/wechatNotificationLinkService');
const secrets = require('../services/wechatCredentialService');
const { assertPlatformEnabled } = require('../services/extensionPlatformService');

const router = express.Router();
const rawPattern = /^[a-f0-9]{64}$/;

function cookie(req, name) {
  const values = String(req.headers.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  if (values.length !== 1) return '';
  const value = values[0].slice(name.length + 1);
  return rawPattern.test(value) ? value : '';
}
function setProof(res, name, value, maxAge) {
  res.cookie(name, value, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge });
}
function clearProof(res, name) {
  res.clearCookie(name, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
}
function sameOrigin(req) {
  if (req.headers.origin !== secrets.publicOrigin() || req.headers['x-wechat-intent'] !== 'notification-v1' || !req.is('application/json')) {
    throw new Error('CSRF');
  }
}
const fail = res => res.status(403).json({ code: 403, message: '通知链接已失效、已使用或当前微信无权访问。' });

router.use((req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
  next();
});
router.use(rateLimit({ windowMs: 60000, limit: 60, standardHeaders: true, legacyHeaders: false }));

router.get('/notification/open/:reference', async (req, res) => {
  try {
    await assertPlatformEnabled('wechat_official');
    const result = await links.authorize(req.params.reference);
    setProof(res, '__Host-wx-notification-oauth', result.browserProof, 5 * 60 * 1000);
    res.redirect(result.authorizationUrl);
  } catch {
    res.status(403).type('text/plain').send('通知链接已失效或当前不可访问。');
  }
});

router.get('/notification/callback', async (req, res) => {
  try {
    await assertPlatformEnabled('wechat_official');
    if (!rawPattern.test(req.query.state || '') || typeof req.query.code !== 'string' || req.query.code.length > 256) throw new Error('STATE');
    const result = await links.complete({
      state: req.query.state,
      code: req.query.code,
      browserProof: cookie(req, '__Host-wx-notification-oauth'),
    });
    clearProof(res, '__Host-wx-notification-oauth');
    setProof(res, '__Host-wx-notification-exchange', result.exchangeProof, 2 * 60 * 1000);
    res.redirect(`${secrets.publicOrigin()}/wechat-notification`);
  } catch {
    clearProof(res, '__Host-wx-notification-oauth');
    res.redirect(`${secrets.publicOrigin()}/wechat-notification?failed=1`);
  }
});

router.post('/notification/exchange', async (req, res) => {
  try {
    await assertPlatformEnabled('wechat_official');
    sameOrigin(req);
    const proof = cookie(req, '__Host-wx-notification-exchange');
    const result = await links.exchange({ proof, req });
    clearProof(res, '__Host-wx-notification-exchange');
    res.json({ code: 0, data: result });
  } catch {
    clearProof(res, '__Host-wx-notification-exchange');
    fail(res);
  }
});

module.exports = { router, cookie, sameOrigin };
