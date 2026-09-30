// 忆梦云团队开发
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const Account = require('../models/WechatOfficialAccount');
const outbox = require('../services/wechatOutboxService');
const TenantUser = require('../models/TenantUser');
const secrets = require('../services/wechatCredentialService');
const { recordOperation } = require('../services/auditLogService');
const { getPlatformExtension, assertPlatformEnabled, tenantAllowed } = require('../services/extensionPlatformService');
function completeness(account) {
  if (!account) return 0;
  return Math.round(([account.displayName, account.appId, account.credentialCheckedAt, account.callbackCheckedAt]
    .filter(Boolean).length / 4) * 100);
}
function safe(account) {
  return account ? {
    appId: account.appId, displayName: account.displayName, generation: account.generation,
    configVersion: account.configVersion, credentialVersion: account.credentialVersion,
    status: account.status, enabled: !!account.enabled, bindingEnabled: !!account.bindingEnabled, loginEnabled: !!account.loginEnabled, notificationEnabled: !!account.notificationEnabled,
    notificationTemplateId: account.notificationTemplateId || '',
    notificationFieldMapping: account.notificationFieldMapping instanceof Map
      ? Object.fromEntries(account.notificationFieldMapping)
      : account.notificationFieldMapping || {},
    staffLoginUrl: `${secrets.publicOrigin()}/wechat-login?company=${account.publicCode}`,
    credentialsSet: { appSecret: true, token: true, encodingAESKey: true },
    callbackUrl: `${secrets.publicOrigin()}/api/wechat/callback/${account.callbackRouteId}`,
    oauthDomain: new URL(secrets.publicOrigin()).hostname,
    credentialCheckedAt: account.credentialCheckedAt, callbackCheckedAt: account.callbackCheckedAt,
    lastCredentialResult: account.lastCredentialResult,
  } : null;
}
const respond = (res, data) => res.json({ code: 0, data });
function endpoint(fn) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { return await fn(req, res); } catch (err) {
      const status = err.code === 11000 ? 409 : err.status || 503;
      return res.status(status).json({ code: status, message: err.code === 11000 ? '配置冲突，请刷新；AppID 不可跨企业复用' : err.publicMessage || '微信配置服务不可用，请检查部署配置后重试' });
    }
  };
}
function reject(message, status = 400) { const error = new Error('WECHAT_REJECTED'); error.status = status; error.publicMessage = message; throw error; }
async function revokeDerivedSessions(req, account, reason) {
  const Binding = require('../models/WechatIdentityBinding');
  const bindingIds = (await Binding.find({
    tenantId: req.tenantId,
    officialAccountId: account._id,
  }).select('_id')).map(item => item._id);
  await require('../models/TenantUserSession').updateMany(
    { wechatBindingId: { $in: bindingIds }, revokedAt: null },
    { $set: { revokedAt: new Date(), revokeReason: reason } },
  );
  await require('../services/customerSessionService').revokeMany(
    { wechatBindingId: { $in: bindingIds } },
    reason,
    req.app.get('io'),
  );
  await require('../models/WechatAuthChallenge').updateMany({
    tenantId: req.tenantId,
    officialAccountId: account._id,
    state: { $nin: ['consumed', 'cancelled', 'expired'] },
  }, { $set: { state: 'cancelled' } });
  req.app.get('io')?.in(`wechat-account-${account._id}`).disconnectSockets(true);
}
async function stepUp(req) {
  if (req.headers.origin !== secrets.publicOrigin()) reject('请从配置的同源 HTTPS 页面操作', 403);
  const password = req.body?.password;
  if (typeof password !== 'string' || !password || password.length > 200) reject('请输入当前账号密码进行独立验证', 403);
  const user = await TenantUser.findOne({ _id: req.user.id, tenantId: req.tenantId, status: 'active' });
  if (!user || !await bcrypt.compare(password, user.password)) reject('密码验证失败', 403);
}
const get = endpoint(async (req, res) => {
  const [account, platform] = await Promise.all([
    Account.findOne({ tenantId: req.tenantId, isCurrent: true }),
    getPlatformExtension('wechat_official'),
  ]);
  return respond(res, {
    configuration: safe(account),
    platformEnabled: platform.enabled,
    authorized: tenantAllowed(platform, req.tenantId),
    authorizationReason: platform.enabled ? (tenantAllowed(platform, req.tenantId) ? '' : '当前企业未获平台授权使用微信公众号扩展') : '平台已停用微信公众号扩展',
    tenantEnabled: account?.enabled === true,
    configured: !!account,
    configurationCompleteness: completeness(account),
    deploymentReady: platform.deploymentReady,
    deploymentStatus: platform.deploymentStatus,
    phase: 'customer-notification',
    capabilities: { configuration: true, safeCallback: true, staffBinding: true, staffLogin: true, customerLogin: true, notifications: true },
  });
});
const save = endpoint(async (req, res) => {
  await assertPlatformEnabled('wechat_official', req.tenantId);
  await stepUp(req);
  secrets.publicOrigin();
  const body = req.body || {};
  if (['enabled', 'bindingEnabled', 'loginEnabled', 'notificationEnabled'].some(field => body[field] === true)) reject('配置保存不会直接启用能力，请完成检测后使用独立启用操作');
  if (!/^wx[a-fA-F0-9]{16}$/.test(body.appId) || typeof body.displayName !== 'string' || !body.displayName.trim() || body.displayName.length > 80) reject('公众号名称或 AppID 格式错误');
  const current = await Account.findOne({ tenantId: req.tenantId, isCurrent: true }).select('+credentialCipher');
  if (current && (body.configVersion !== current.configVersion || body.appId !== current.appId)) reject('版本冲突或尝试换号；请刷新，换号流程尚未开放', 409);
  if (!current && body.configVersion !== 0) reject('配置版本错误', 409);
  const scope = current || { tenantId: req.tenantId, appId: body.appId, generation: 1 };
  const cipher = { ...(current?.credentialCipher || {}) };
  const patterns = { appSecret: /^[A-Za-z0-9]{16,128}$/, token: /^[A-Za-z0-9]{3,32}$/, encodingAESKey: /^[A-Za-z0-9+/]{43}$/ };
  let changed = false;
  for (const field of Object.keys(patterns)) {
    const value = body[field];
    if (value !== undefined && typeof value !== 'string') reject('凭据格式错误');
    if (value) {
      if (!patterns[field].test(value)) reject('凭据格式错误');
      cipher[field] = secrets.seal(value, secrets.context(scope, field)); changed = true;
    }
    if (!cipher[field]) reject('首次配置须填写全部安全模式凭据');
  }
  // 已完成检测的凭据禁止直接覆盖，避免未经检测轮换生效。
  if (current?.credentialCheckedAt && changed) reject('已检测凭据的安全轮换流程尚未开放', 409);
  const values = { displayName: body.displayName.trim(), credentialCipher: cipher, status: 'draft', enabled: false, bindingEnabled: false, loginEnabled: false, notificationEnabled: false };
  if (changed) Object.assign(values, { credentialCheckedAt: null, callbackCheckedAt: null, lastCredentialResult: 'not_checked' });
  let account;
  if (current) {
    account = await Account.findOneAndUpdate({ _id: current._id, tenantId: req.tenantId, configVersion: body.configVersion }, { $set: values, $inc: { configVersion: 1, credentialVersion: changed ? 1 : 0 } }, { new: true });
    if (!account) reject('配置已被更新，请刷新', 409);
  } else account = await Account.create({ ...values, ...scope, callbackRouteId: crypto.randomBytes(32).toString('hex'), publicCode: crypto.randomBytes(32).toString('hex') });
  if (current) await revokeDerivedSessions(req, current, '公众号配置已变更');
  recordOperation({ req, tenantId: req.tenantId, user: req.user, action: 'wechat.config.save', detail: `version=${account.configVersion}` });
  return respond(res, safe(account));
});
const verify = endpoint(async (req, res) => {
  await assertPlatformEnabled('wechat_official', req.tenantId);
  await stepUp(req);
  const account = await Account.findOne({ tenantId: req.tenantId, isCurrent: true, configVersion: req.body.configVersion }).select('+credentialCipher');
  if (!account) reject('配置不存在或版本变化', 409);
  let result;
  try { result = await secrets.checkCredential(account); } catch (_) { result = 'upstream_unavailable'; }
  await Account.updateOne({ _id: account._id, tenantId: req.tenantId, configVersion: account.configVersion }, { $set: { lastCredentialResult: result, credentialCheckedAt: result === 'passed' ? new Date() : null } });
  recordOperation({ req, tenantId: req.tenantId, user: req.user, action: 'wechat.config.verify', detail: result });
  return respond(res, { result, oauth: 'pending_real_device_verification', notifications: 'not_implemented' });
});
const activation = endpoint(async (req, res) => {
  await assertPlatformEnabled('wechat_official', req.tenantId);
  await stepUp(req);
  if (typeof req.body.enabled !== 'boolean') reject('启停参数错误');
  const account = await Account.findOne({ tenantId: req.tenantId, isCurrent: true, configVersion: req.body.configVersion });
  if (!account) reject('配置版本冲突', 409);
  if (req.body.enabled && (!account.credentialCheckedAt || !account.callbackCheckedAt || req.body.oauthAcknowledged !== true)) reject('请先完成凭据检测、安全回调握手，并确认网页授权域名与权限');
  const updated = await Account.findOneAndUpdate({ _id: account._id, configVersion: account.configVersion }, { $set: { enabled: req.body.enabled, bindingEnabled: req.body.enabled, loginEnabled: req.body.enabled, notificationEnabled: false }, $inc: { configVersion: 1 } }, { new: true });
  if (!updated) reject('配置版本冲突', 409);
  // 启停都会递增配置版本；所有旧派生 sid 必须立即失效，不能等待下次 HTTP 回查。
  await revokeDerivedSessions(
    req,
    account,
    req.body.enabled ? '公众号配置已启用新版本' : '公众号停用',
  );
  recordOperation({ req, tenantId: req.tenantId, user: req.user, action: 'wechat.staff.activation', detail: `enabled=${updated.enabled}` });
  return respond(res, safe(updated));
});

function notificationSettings(body) {
  const templateId = typeof body.notificationTemplateId === 'string'
    ? body.notificationTemplateId.trim()
    : '';
  const source = body.notificationFieldMapping;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(templateId)
      || !source || typeof source !== 'object' || Array.isArray(source)) {
    reject('请填写有效的微信模板 ID 和字段映射');
  }
  const mapping = {};
  for (const key of ['title', 'sender', 'time', 'remark']) {
    const field = typeof source[key] === 'string' ? source[key].trim() : '';
    if (!/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(field)) {
      reject(`模板字段 ${key} 格式错误`);
    }
    mapping[key] = field;
  }
  if (new Set(Object.values(mapping)).size !== 4) reject('模板字段映射不能重复');
  return { templateId, mapping };
}

const notification = endpoint(async (req, res) => {
  await assertPlatformEnabled('wechat_official', req.tenantId);
  await stepUp(req);
  if (typeof req.body.enabled !== 'boolean') reject('通知启停参数错误');
  const account = await Account.findOne({
    tenantId: req.tenantId,
    isCurrent: true,
    configVersion: req.body.configVersion,
  });
  if (!account) reject('配置版本冲突', 409);
  const settings = notificationSettings(req.body);
  if (req.body.enabled) {
    if (!account.enabled || !account.credentialCheckedAt || !account.callbackCheckedAt) {
      reject('请先启用公众号并完成凭据检测与安全回调握手');
    }
    const capability = await outbox.transactionCapability(mongoose.connection, { probe: true });
    if (!capability.available) {
      reject('当前 MongoDB 未确认支持事务；通知必须使用副本集或 mongos，系统未修改生产数据库配置', 409);
    }
  }
  const updated = await Account.findOneAndUpdate(
    { _id: account._id, tenantId: req.tenantId, configVersion: account.configVersion },
    {
      $set: {
        notificationTemplateId: settings.templateId,
        notificationFieldMapping: settings.mapping,
        notificationEnabled: req.body.enabled,
      },
      $inc: { configVersion: 1 },
    },
    { new: true },
  );
  if (!updated) reject('配置版本冲突', 409);
  await revokeDerivedSessions(req, account, '公众号通知配置已变更');
  recordOperation({
    req,
    tenantId: req.tenantId,
    user: req.user,
    action: 'wechat.notification.configure',
    detail: `enabled=${updated.notificationEnabled};version=${updated.configVersion}`,
  });
  return respond(res, safe(updated));
});

module.exports = { get, save, verify, safe, activation, notification };
