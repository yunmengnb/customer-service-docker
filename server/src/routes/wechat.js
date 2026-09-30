// 忆梦云团队开发
const express = require('express');
const rateLimit = require('express-rate-limit');
const Account = require('../models/WechatOfficialAccount');
const Tenant = require('../models/Tenant');
const callback = require('../services/wechatCallbackService');
const secrets = require('../services/wechatCredentialService');
const controller = require('../controllers/WechatOfficialController');
const { authTenantUser, requireTenantAdmin } = require('../middleware/auth');
const { assertPlatformEnabled } = require('../services/extensionPlatformService');
const management = express.Router();
management.use(authTenantUser, requireTenantAdmin);
management.use(rateLimit({ windowMs: 60000, limit: 10, standardHeaders: true, legacyHeaders: false }));
management.get('/', controller.get);
management.put('/', controller.save);
management.post('/verify', controller.verify);
management.post('/activation', controller.activation);
management.post('/notification', controller.notification);
const publicRouter = express.Router();
publicRouter.use((req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); next(); });
publicRouter.all('/callback/:route', express.text({ type: ['text/xml', 'application/xml', 'text/plain'], limit: '64kb' }), async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) return res.sendStatus(405);
  let account;
  try {
    await assertPlatformEnabled('wechat_official');
    if (!/^[a-f0-9]{64}$/.test(req.params.route)) throw new Error();
    account = await Account.findOne({ callbackRouteId: req.params.route, isCurrent: true }).select('+credentialCipher');
    if (!account || !await Tenant.exists({ _id: account.tenantId, status: { $in: ['active', 'trial'] } })) throw new Error();
    await assertPlatformEnabled('wechat_official', account.tenantId);
    const encrypted = req.method === 'GET' ? req.query.echostr : callback.parseXml(req.body).Encrypt;
    // 仅安全模式，不降级为明文或兼容模式。
    if (typeof encrypted !== 'string' || encrypted.length > 65536) throw new Error();
    callback.verifySignature({ token: secrets.credential(account, 'token'), timestamp: req.query.timestamp, nonce: req.query.nonce, signature: req.query.msg_signature, encrypted });
    const plain = callback.decrypt(encrypted, secrets.credential(account, 'encodingAESKey'), account.appId);
    if (req.method === 'GET') {
      await Account.updateOne({ _id: account._id, credentialVersion: account.credentialVersion }, { $set: { callbackCheckedAt: new Date() } });
      return res.type('text/plain').send(plain);
    }
    const event = callback.parseXml(plain);
    // 校验通过后必须持久化成功才 ACK；异常由微信重试，不输出报文。
    try { await callback.persist(account, event); } catch (_) { return res.status(503).type('text/plain').send('retry'); }
    const challengeId = callback.sceneId({ type: String(event.Event || '').toLowerCase(), key: event.EventKey || '' });
    if (challengeId) {
      await callback.claimEvent(account, { type: String(event.Event || '').toLowerCase(), key: event.EventKey || '', openId: event.FromUserName });
      const challenge = await require('../models/WechatAuthChallenge').findOne({
        _id: challengeId,
        officialAccountId: account._id,
        state: 'scanned',
        expiresAt: { $gt: new Date() },
      }).select('clientSide');
      if (!challenge) throw new Error();
      const side = challenge.clientSide === 'client' ? 'client' : 'staff';
      const link = `${secrets.publicOrigin()}/api/wechat/${side}/oauth-start/${challengeId}`;
      const reply = callback.textReply(event, `扫码已确认，请点击继续完成微信身份确认：${link}`);
      return res.type('text/xml').send(callback.encryptReply(reply, secrets.credential(account, 'token'),
        secrets.credential(account, 'encodingAESKey'), account.appId));
    }
    return res.type('text/plain').send('success');
  } catch (error) {
    if (['PLATFORM_DISABLED', 'TENANT_NOT_AUTHORIZED'].includes(error?.code)) {
      return res.status(403).type('text/plain').send('extension unavailable');
    }
    return res.status(400).type('text/plain').send('invalid callback');
  }
});
publicRouter.use(require('./wechatStaff').router);
publicRouter.use(require('./wechatClient').router);
publicRouter.use(require('./wechatNotification').router);
publicRouter.use((err, req, res, next) => res.status(400).type('text/plain').send('invalid request'));
module.exports = { management, publicRouter };
