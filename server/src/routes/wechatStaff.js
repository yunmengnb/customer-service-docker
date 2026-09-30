// 忆梦云团队开发
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const Challenge = require('../models/WechatAuthChallenge');
const Binding = require('../models/WechatIdentityBinding');
const Follower = require('../models/WechatFollower');
const User = require('../models/TenantUser');
const Tenant = require('../models/Tenant');
const Session = require('../models/TenantUserSession');
const auth = require('../services/wechatAuthService');
const staff = require('../services/wechatStaffService');
const secrets = require('../services/wechatCredentialService');
const sessions = require('../services/tenantSessionService');
const { authTenantUser } = require('../middleware/auth');
const { recordOperation } = require('../services/auditLogService');
const { assertPlatformEnabled } = require('../services/extensionPlatformService');
const router = express.Router();
const proofPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-f0-9]{24}$/;
function cookie(req, name) {
  const values = String(req.headers.cookie || '').split(';').map(x => x.trim()).filter(x => x.startsWith(`${name}=`));
  if (values.length !== 1) return '';
  const value = values[0].slice(name.length + 1);
  return proofPattern.test(value) ? value : '';
}
function setProof(res, name, value) { res.cookie(name, value, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 120000 }); }
function clearProof(res, name) { res.clearCookie(name, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' }); }
function guard(req) {
  if (req.headers.origin !== secrets.publicOrigin() || req.headers['x-wechat-intent'] !== 'staff-v1' || !req.is('application/json')) throw new Error('CSRF');
}
const wrap = fn => async (req, res) => {
  try {
    await assertPlatformEnabled('wechat_official');
    if (req.method === 'POST') guard(req);
    await fn(req, res);
  }
  catch (error) {
    res.status(403).json({
      code: error?.code === 'PLATFORM_DISABLED' ? 'PLATFORM_DISABLED' : 403,
      message: error?.code === 'PLATFORM_DISABLED'
        ? '平台已停用微信公众号扩展应用'
        : '微信操作不可用、已过期或权限不足，请重新发起。',
    });
  }
};
const ok = (res, data) => res.json({ code: 0, data });
const audit = (req, action) => recordOperation({ req, tenantId: req.tenantId, user: req.user, action, detail: 'staff wechat' });
async function password(req) {
  const u = await User.findOne({ _id: req.user.id, tenantId: req.tenantId, status: 'active' });
  if (typeof req.body.password !== 'string' || req.body.password.length > 200 || !u || !await bcrypt.compare(req.body.password, u.password)) throw new Error('PASSWORD');
  return u;
}
async function enabledLogin() {
  const { authSettings, getSystemSettings } = require('../utils/systemSettings');
  if (!authSettings(await getSystemSettings()).tenantLoginEnabled) throw new Error('LOGIN_DISABLED');
}
async function context(record) {
  if (!record || record.clientSide !== 'staff') throw new Error('CHALLENGE');
  const a = await staff.current({ _id: record.officialAccountId, tenantId: record.tenantId, appId: record.appId, generation: record.generation,
    credentialVersion: record.credentialVersion, configVersion: record.configVersion }, record.purpose);
  if (record.purpose === 'login') await enabledLogin();
  if (record.purpose === 'bind' && !await sessions.validateSession({ sid: record.initiatingSessionId, id: record.initiatingSubject, tenantId: record.tenantId })) throw new Error('SESSION');
  return a;
}
async function challenge(req, scan = false) {
  if (!idPattern.test(req.params.id || '')) throw new Error('ID');
  const name = scan ? '__Host-wx-scan' : `__Host-wx-${req.params.id}`;
  const proof = cookie(req, name);
  if (!proof) throw new Error('PROOF');
  const r = await Challenge.findOne({ _id: req.params.id, [scan ? 'oauthBrowserProofHash' : 'browserProofHash']: auth.digest(proof), expiresAt: { $gt: new Date() } }).select('+verifiedOpenIdCipher');
  const a = await context(r);
  return { r, a, proof };
}
function openId(r) { return secrets.open(r.verifiedOpenIdCipher, `wechat-oauth:${r.tenantId}:${r.officialAccountId}:${r.appId}:${r.generation}:${r._id}`); }
async function candidates(a, r) {
  const bindings = await Binding.find({ ...staff.scope(a), subjectType: 'staff', openIdHash: staff.openHash(a, openId(r)), status: 'active' });
  const result = [];
  for (const b of bindings) {
    const u = await User.findOne({ _id: b.subjectId, tenantId: a.tenantId, status: 'active' });
    if (u) result.push({ id: String(b._id), label: u.displayName || `${u.username.slice(0, 2)}***`, version: b.version });
  }
  return result;
}
router.use((req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); next(); });
router.use(rateLimit({ windowMs: 60000, limit: 90, standardHeaders: true, legacyHeaders: false }));
router.get('/staff/context/:code', wrap(async (req, res) => {
  if (!proofPattern.test(req.params.code)) throw new Error('CODE');
  const a = await staff.current({ publicCode: req.params.code }, 'login');
  const t = await Tenant.findById(a.tenantId);
  ok(res, { company: t.name, account: a.displayName });
}));
router.get('/staff/binding', authTenantUser, wrap(async (req, res) => {
  const Account = require('../models/WechatOfficialAccount');
  const a = await Account.findOne({ tenantId: req.tenantId, isCurrent: true });
  const b = a && await Binding.findOne({ ...staff.scope(a), subjectId: req.user.id, subjectType: 'staff', status: 'active' });
  ok(res, { bound: !!b, available: !!(a?.enabled && a.bindingEnabled), loginCode: a?.publicCode || '', account: a?.displayName || '' });
}));
async function create(req, res, purpose) {
  const a = purpose === 'bind' ? await staff.current({ tenantId: req.tenantId }, purpose)
    : await staff.current({ publicCode: proofPattern.test(req.body.publicCode || '') ? req.body.publicCode : 'invalid' }, purpose);
  if (purpose === 'bind') await password(req); else await enabledLogin();
  const { record, browserProof, qrUrl } = await auth.createChallenge({ account: a, purpose, clientSide: 'staff', origin: secrets.publicOrigin(),
    sessionId: req.user?.sid, subjectId: req.user?.id, createQr: require('../services/wechatApiService').createTemporaryQr });
  setProof(res, `__Host-wx-${record._id}`, browserProof);
  ok(res, { id: record._id, phrase: record.phrase, expiresAt: record.qrExpiresAt || record.expiresAt, scanUrl: qrUrl });
}
router.post('/staff/bind', authTenantUser, wrap((req, res) => create(req, res, 'bind')));
router.post('/staff/login', wrap((req, res) => create(req, res, 'login')));
router.get('/staff/oauth-start/:id', wrap(async (req, res) => {
  if (!idPattern.test(req.params.id || '')) throw new Error('LINK');
  // 只接受由公众号安全回调用扫码人的 OpenID 占用过的 challenge，禁止原浏览器绕过扫码或转发替换。
  const r = await Challenge.findOne({ _id: req.params.id, state: 'scanned', scanOpenIdHash: { $type: 'string' },
    oauthStateHash: { $exists: false }, expiresAt: { $gt: new Date() } });
  const a = await context(r);
  const result = await auth.beginClaimedOAuth({ account: a, challengeId: req.params.id });
  setProof(res, '__Host-wx-scan', result.browserProof);
  res.redirect(result.authorizationUrl);
}));
router.get('/oauth/callback', wrap(async (req, res) => {
  if (!proofPattern.test(req.query.state || '') || typeof req.query.code !== 'string' || req.query.code.length > 256) throw new Error('STATE');
  const r = await Challenge.findOne({ oauthStateHash: auth.digest(req.query.state), state: 'scanned', expiresAt: { $gt: new Date() } });
  if (!r) throw new Error('STATE');
  if (r.clientSide === 'client') {
    const a = await require('../services/wechatClientService').current({
      _id: r.officialAccountId,
      tenantId: r.tenantId,
      appId: r.appId,
      generation: r.generation,
      configVersion: r.configVersion,
    }, r.purpose);
    if (r.purpose === 'bind' && !await require('../services/wechatClientService').initiatingSession(r)) throw new Error('SESSION');
    const done = await auth.completeOAuth({ account: a, state: req.query.state, code: req.query.code, browserProof: cookie(req, '__Host-wx-client-scan') });
    return res.redirect(`${secrets.publicOrigin()}/wechat-client-confirm?id=${done._id}`);
  }
  const a = await context(r);
  const done = await auth.completeOAuth({ account: a, state: req.query.state, code: req.query.code, browserProof: cookie(req, '__Host-wx-scan') });
  res.redirect(`${secrets.publicOrigin()}/wechat-confirm?id=${done._id}`);
}));
router.get('/staff/confirm/:id', wrap(async (req, res) => {
  const { r, a } = await challenge(req, true);
  if (r.state !== 'oauth_verified') throw new Error('STATE');
  const t = await Tenant.findById(a.tenantId);
  const u = r.purpose === 'bind' && await User.findOne({ _id: r.initiatingSubject, tenantId: a.tenantId, status: 'active' });
  if (r.purpose === 'bind' && !u) throw new Error('USER');
  ok(res, { purpose: r.purpose, phrase: r.phrase, company: t.name, account: a.displayName, subject: u?.displayName || u?.username,
    candidates: r.purpose === 'login' ? await candidates(a, r) : [] });
}));
router.post('/staff/confirm/:id', wrap(async (req, res) => {
  const { r, a, proof } = await challenge(req, true);
  if (req.body.confirm !== true || r.state !== 'oauth_verified') throw new Error('CONFIRM');
  let selected;
  if (r.purpose === 'login') {
    selected = (await candidates(a, r)).find(x => x.id === req.body.bindingId);
    if (!selected) throw new Error('BINDING');
  } else if (!await User.exists({ _id: r.initiatingSubject, tenantId: a.tenantId, status: 'active' })) throw new Error('USER');
  const done = await Challenge.findOneAndUpdate({ _id: r._id, state: 'oauth_verified', oauthBrowserProofHash: auth.digest(proof), expiresAt: { $gt: new Date() } },
    { $set: { state: 'confirmed', confirmedAt: new Date(), ...(selected ? { selectedBindingId: selected.id, selectedBindingVersion: selected.version } : {}) } }, { new: true });
  if (!done) throw new Error('REPLAY');
  ok(res, { confirmed: true });
}));
router.get('/staff/status/:id', wrap(async (req, res) => {
  const { r } = await challenge(req);
  ok(res, { state: r.state, phrase: r.phrase, purpose: r.purpose, expiresAt: r.expiresAt });
}));
router.post('/staff/cancel/:id', wrap(async (req, res) => {
  const { a, proof } = await challenge(req);
  const cancelled = await auth.cancelChallenge({ id: req.params.id, account: a, browserProof: proof, origin: secrets.publicOrigin() });
  if (!cancelled) throw new Error('CANCEL');
  clearProof(res, `__Host-wx-${req.params.id}`);
  ok(res, { cancelled: true });
}));
router.post('/staff/finish-bind/:id', authTenantUser, wrap(async (req, res) => {
  const { r, a, proof } = await challenge(req);
  if (r.state !== 'confirmed' || r.purpose !== 'bind' || String(r.initiatingSubject) !== req.user.id || String(r.initiatingSessionId) !== req.user.sid || String(r.tenantId) !== req.tenantId || req.body.confirm !== true) throw new Error('SUBJECT');
  const oid = openId(r), openIdHash = staff.openHash(a, oid);
  const follower = await Follower.findOne({ ...staff.scope(a), openIdHash });
  let binding, created = false;
  try {
    const now = new Date();
    binding = await Binding.create({ ...staff.scope(a), subjectId: req.user.id, subjectType: 'staff', openIdHash,
      openIdCipher: secrets.seal(oid, secrets.context(a, `staff:${req.user.id}`)), followerId: follower?._id,
      status: 'active', version: 1, notificationPreference: 'disabled', consentVersion: 'staff-login-v1',
      consentedAt: now, boundAt: now, verifiedAt: now, verificationMethod: 'wechat_oauth_snsapi_base' });
    created = true;
  } catch (error) {
    if (error.code !== 11000) throw error;
    binding = await Binding.findOne({ ...staff.scope(a), subjectId: req.user.id, subjectType: 'staff', status: 'active', openIdHash });
    if (!binding) throw error;
  }
  const done = await auth.consumeConfirmed({ id: r._id, purpose: 'bind', browserProof: proof, origin: secrets.publicOrigin(), ...staff.scope(a), initiatingSessionId: req.user.sid });
  if (!done) {
    if (created) await Binding.deleteOne({ _id: binding._id, status: 'active', version: 1 });
    throw new Error('REPLAY');
  }
  clearProof(res, `__Host-wx-${r._id}`);
  audit(req, 'wechat.staff.bind');
  ok(res, { bound: true });
}));
router.post('/staff/redeem/:id', wrap(async (req, res) => {
  const { r, a, proof } = await challenge(req);
  if (r.purpose !== 'login' || r.state !== 'confirmed') throw new Error('PURPOSE');
  const b = await Binding.findOne({ _id: r.selectedBindingId, ...staff.scope(a), subjectType: 'staff', status: 'active', version: r.selectedBindingVersion, openIdHash: staff.openHash(a, openId(r)) });
  if (!b) throw new Error('BINDING');
  const u = await User.findOne({ _id: b.subjectId, tenantId: a.tenantId, status: 'active' });
  if (!u) throw new Error('USER');
  const issued = await sessions.createSessionAndToken({ user: u, req, loginMethod: 'wechat', binding: b });
  if (!await auth.consumeConfirmed({ id: r._id, purpose: 'login', browserProof: proof, origin: secrets.publicOrigin(), ...staff.scope(a) })) {
    await Session.updateOne({ _id: issued.session._id, loginMethod: 'wechat', revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: '微信登录兑换冲突' } }).catch(() => {});
    throw new Error('REPLAY');
  }
  const { token } = issued;
  clearProof(res, `__Host-wx-${r._id}`);
  req.tenantId = String(a.tenantId); req.user = { id: String(u._id), role: u.role };
  audit(req, 'wechat.staff.login');
  const t = await Tenant.findById(a.tenantId);
  ok(res, { token, user: { _id: u._id, username: u.username, displayName: u.displayName, role: u.role }, tenant: { _id: t._id, name: t.name }, expiresIn: 7200 });
}));
router.post('/staff/unbind', authTenantUser, wrap(async (req, res) => {
  await password(req);
  const b = await Binding.findOneAndUpdate({ tenantId: req.tenantId, subjectId: req.user.id, subjectType: 'staff', status: 'active' },
    { $set: { status: 'revoked', revokedAt: new Date(), revokedByType: 'self', revokedById: req.user.id, revokeReason: 'password_session_unbind' }, $inc: { version: 1 } }, { new: true });
  if (b) {
    await Session.updateMany({ wechatBindingId: b._id, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: '微信解绑' } });
    await Challenge.updateMany({ tenantId: req.tenantId, $or: [{ selectedBindingId: b._id }, { initiatingSubject: req.user.id, purpose: 'bind' }], state: { $ne: 'consumed' } }, { $set: { state: 'cancelled' } });
    req.app.get('io')?.in(`wechat-binding-${b._id}`).disconnectSockets(true);
  }
  audit(req, 'wechat.staff.unbind');
  ok(res, { bound: false });
}));
module.exports = { router, cookie, guard };
