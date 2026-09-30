// 忆梦云团队开发
const express = require('express');
const rateLimit = require('express-rate-limit');
const Challenge = require('../models/WechatAuthChallenge');
const Binding = require('../models/WechatIdentityBinding');
const Follower = require('../models/WechatFollower');
const CustomerSession = require('../models/CustomerSession');
const auth = require('../services/wechatAuthService');
const client = require('../services/wechatClientService');
const secrets = require('../services/wechatCredentialService');
const sessions = require('../services/customerSessionService');
const { authCustomer } = require('../middleware/auth');
const { recordOperation } = require('../services/auditLogService');
const { assertPlatformEnabled } = require('../services/extensionPlatformService');

const router = express.Router();
const proofPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-f0-9]{24}$/;

function cookie(req, name) {
  const values = String(req.headers.cookie || '')
    .split(';')
    .map(value => value.trim())
    .filter(value => value.startsWith(`${name}=`));
  if (values.length !== 1) return '';
  const value = values[0].slice(name.length + 1);
  return proofPattern.test(value) ? value : '';
}

function setProof(res, name, value) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 120000,
  });
}

function clearProof(res, name) {
  res.clearCookie(name, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });
}

function guard(req) {
  if (
    req.headers.origin !== secrets.publicOrigin()
    || req.headers['x-wechat-intent'] !== 'client-v1'
    || !req.is('application/json')
  ) throw new Error('CSRF');
}

const wrap = fn => async (req, res) => {
  try {
    await assertPlatformEnabled('wechat_official');
    if (req.method === 'POST') guard(req);
    await fn(req, res);
  } catch (error) {
    res.status(403).json({
      code: error?.code === 'PLATFORM_DISABLED' ? 'PLATFORM_DISABLED' : 403,
      message: error?.code === 'PLATFORM_DISABLED'
        ? '平台已停用微信公众号扩展应用'
        : '微信操作不可用、已过期或权限不足，请重新发起。',
    });
  }
};

const ok = (res, data) => res.json({ code: 0, data });

async function context(record) {
  if (!record || record.clientSide !== 'client') throw new Error('CHALLENGE');
  const account = await client.current({
    _id: record.officialAccountId,
    tenantId: record.tenantId,
    appId: record.appId,
    generation: record.generation,
    configVersion: record.configVersion,
  }, record.purpose);
  if (record.purpose === 'bind' && !await client.initiatingSession(record)) {
    throw new Error('SESSION');
  }
  return account;
}

async function challenge(req, scan = false) {
  if (!idPattern.test(req.params.id || '')) throw new Error('ID');
  const name = scan ? '__Host-wx-client-scan' : `__Host-wx-client-${req.params.id}`;
  const proof = cookie(req, name);
  if (!proof) throw new Error('PROOF');
  const record = await Challenge.findOne({
    _id: req.params.id,
    [scan ? 'oauthBrowserProofHash' : 'browserProofHash']: auth.digest(proof),
    expiresAt: { $gt: new Date() },
  }).select('+verifiedOpenIdCipher');
  const account = await context(record);
  return { record, account, proof };
}

function openId(record) {
  return secrets.open(
    record.verifiedOpenIdCipher,
    `wechat-oauth:${record.tenantId}:${record.officialAccountId}:${record.appId}:${record.generation}:${record._id}`,
  );
}

async function loginCandidates(account, record) {
  const bindings = await Binding.find({
    ...client.scope(account),
    channelId: record.channelId,
    subjectType: { $in: ['customer', 'visitor'] },
    openIdHash: client.openHash(account, openId(record)),
    status: 'active',
  });
  const result = [];
  for (const binding of bindings) {
    const subject = await client.validSubject({
      subjectType: binding.subjectType,
      subjectId: binding.subjectId,
      tenantId: binding.tenantId,
      channelId: binding.channelId,
      conversationId: binding.conversationId,
    });
    if (!subject) continue;
    const label = binding.subjectType === 'visitor'
      ? `访客身份 ${String(binding.subjectId).slice(-6)}`
      : subject.account.nickname || `${subject.account.phone.slice(0, 3)}****${subject.account.phone.slice(-4)}`;
    result.push({
      id: String(binding._id),
      label,
      subjectType: binding.subjectType,
      version: binding.version,
    });
  }
  return result;
}

router.use((req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  next();
});
router.use(rateLimit({
  windowMs: 60000,
  limit: 90,
  standardHeaders: true,
  legacyHeaders: false,
}));

router.get('/client/context/:token', wrap(async (req, res) => {
  const { account, channel } = await client.channelContext(req.params.token, 'login');
  ok(res, {
    channel: channel.brandName || channel.name,
    account: account.displayName,
  });
}));

router.get('/client/binding', authCustomer, wrap(async (req, res) => {
  if (!req.customer.id || !req.customer.channelId || !req.customer.conversationId) {
    throw new Error('CHANNEL_SESSION_REQUIRED');
  }
  const account = await client.current({ tenantId: req.customer.tenantId }, 'bind');
  const subjectType = req.customer.identity === 'guest' ? 'visitor' : 'customer';
  const binding = await Binding.findOne({
    ...client.scope(account),
    subjectType,
    subjectId: req.customer.id,
    channelId: req.customer.channelId,
    conversationId: req.customer.conversationId,
    status: 'active',
  });
  ok(res, {
    bound: !!binding,
    available: true,
    account: account.displayName,
  });
}));

async function create(req, res, purpose, direct = false) {
  let account;
  let channel;
  let session;
  if (purpose === 'bind') {
    if (!req.customer.id || !req.customer.channelId || !req.customer.conversationId) {
      throw new Error('CHANNEL_SESSION_REQUIRED');
    }
    session = await sessions.validateSession(req.customer, { touch: false });
    if (!session || session.scopeType !== 'channel') throw new Error('SESSION');
    account = await client.current({ tenantId: session.tenantId }, purpose);
    channel = await require('../models/Channel').findOne({
      _id: session.channelId,
      tenantId: session.tenantId,
    });
  } else {
    ({ account, channel } = await client.channelContext(req.body.channelToken, purpose));
  }
  if (!channel) throw new Error('CHANNEL');
  const result = await auth.createChallenge({
    account,
    purpose,
    clientSide: 'client',
    authMode: direct ? 'direct' : 'qr',
    origin: secrets.publicOrigin(),
    sessionId: session?._id,
    subjectId: session?.subjectId,
    subjectType: session?.subjectType,
    channelId: channel._id,
    conversationId: session?.conversationId,
    createQr: direct ? undefined : require('../services/wechatApiService').createTemporaryQr,
  });
  setProof(res, `__Host-wx-client-${result.record._id}`, result.browserProof);
  if (direct) {
    const oauth = await auth.beginDirectOAuth({
      account,
      challengeId: String(result.record._id),
      browserProof: result.browserProof,
    });
    setProof(res, '__Host-wx-client-scan', oauth.browserProof);
    return ok(res, {
      id: result.record._id,
      phrase: result.record.phrase,
      expiresAt: result.record.expiresAt,
      authorizationUrl: oauth.authorizationUrl,
    });
  }
  ok(res, {
    id: result.record._id,
    phrase: result.record.phrase,
    expiresAt: result.record.qrExpiresAt || result.record.expiresAt,
    scanUrl: result.qrUrl,
  });
}

router.post('/client/bind', authCustomer, wrap((req, res) => create(req, res, 'bind')));
router.post('/client/login', wrap((req, res) => create(req, res, 'login')));
router.post('/client/direct-bind', authCustomer, wrap((req, res) => create(req, res, 'bind', true)));
router.post('/client/direct-login', wrap((req, res) => create(req, res, 'login', true)));

router.get('/client/oauth-start/:id', wrap(async (req, res) => {
  if (!idPattern.test(req.params.id || '')) throw new Error('LINK');
  const record = await Challenge.findOne({
    _id: req.params.id,
    clientSide: 'client',
    state: 'scanned',
    scanOpenIdHash: { $type: 'string' },
    oauthStateHash: { $exists: false },
    expiresAt: { $gt: new Date() },
  });
  const account = await context(record);
  const result = await auth.beginClaimedOAuth({ account, challengeId: req.params.id });
  setProof(res, '__Host-wx-client-scan', result.browserProof);
  res.redirect(result.authorizationUrl);
}));

router.get('/client/confirm/:id', wrap(async (req, res) => {
  const { record, account } = await challenge(req, true);
  if (record.state !== 'oauth_verified') throw new Error('STATE');
  const channel = await require('../models/Channel').findOne({
    _id: record.channelId,
    tenantId: record.tenantId,
  });
  if (!channel) throw new Error('CHANNEL');
  const subject = record.purpose === 'bind'
    ? await client.validSubject({
      subjectType: record.initiatingSubjectType,
      subjectId: record.initiatingSubject,
      tenantId: record.tenantId,
      channelId: record.channelId,
      conversationId: record.conversationId,
    })
    : null;
  if (record.purpose === 'bind' && !subject) throw new Error('SUBJECT');
  ok(res, {
    purpose: record.purpose,
    authMode: record.authMode || 'qr',
    phrase: record.phrase,
    channel: channel.brandName || channel.name,
    channelPublicToken: channel.publicToken,
    account: account.displayName,
    subject: record.initiatingSubjectType === 'visitor'
      ? '当前访客身份'
      : subject?.account?.nickname || '当前客户身份',
    candidates: record.purpose === 'login'
      ? await loginCandidates(account, record)
      : [],
  });
}));

router.post('/client/confirm/:id', wrap(async (req, res) => {
  const { record, account, proof } = await challenge(req, true);
  if (req.body.confirm !== true || record.state !== 'oauth_verified') {
    throw new Error('CONFIRM');
  }
  let selected;
  if (record.purpose === 'login') {
    selected = (await loginCandidates(account, record))
      .find(candidate => candidate.id === req.body.bindingId);
    if (!selected) throw new Error('BINDING');
  } else if (!await client.initiatingSession(record)) {
    throw new Error('SESSION');
  }
  const done = await Challenge.findOneAndUpdate({
    _id: record._id,
    state: 'oauth_verified',
    oauthBrowserProofHash: auth.digest(proof),
    expiresAt: { $gt: new Date() },
  }, {
    $set: {
      state: 'confirmed',
      confirmedAt: new Date(),
      ...(selected ? {
        selectedBindingId: selected.id,
        selectedBindingVersion: selected.version,
      } : {}),
    },
  }, { new: true });
  if (!done) throw new Error('REPLAY');
  ok(res, { confirmed: true });
}));

router.get('/client/status/:id', wrap(async (req, res) => {
  const { record } = await challenge(req);
  ok(res, {
    state: record.state,
    phrase: record.phrase,
    purpose: record.purpose,
    expiresAt: record.expiresAt,
  });
}));

router.post('/client/cancel/:id', wrap(async (req, res) => {
  const { account, proof } = await challenge(req);
  const cancelled = await auth.cancelChallenge({
    id: req.params.id,
    account,
    browserProof: proof,
    origin: secrets.publicOrigin(),
  });
  if (!cancelled) throw new Error('CANCEL');
  clearProof(res, `__Host-wx-client-${req.params.id}`);
  ok(res, { cancelled: true });
}));

router.post('/client/finish-bind/:id', authCustomer, wrap(async (req, res) => {
  const { record, account, proof } = await challenge(req);
  const session = await sessions.validateSession(req.customer, { touch: false });
  if (
    req.body.confirm !== true
    || record.state !== 'confirmed'
    || record.purpose !== 'bind'
    || !session
    || String(record.initiatingSessionId) !== String(session._id)
    || String(record.initiatingSubject) !== String(session.subjectId)
    || record.initiatingSubjectType !== session.subjectType
    || String(record.channelId) !== String(session.channelId)
    || String(record.conversationId) !== String(session.conversationId)
  ) throw new Error('SUBJECT');
  const oid = openId(record);
  const openIdHash = client.openHash(account, oid);
  const follower = await Follower.findOne({
    ...client.scope(account),
    openIdHash,
  });
  let binding;
  let created = false;
  try {
    const now = new Date();
    binding = await Binding.create({
      ...client.scope(account),
      subjectId: session.subjectId,
      subjectType: session.subjectType,
      channelId: session.channelId,
      conversationId: session.conversationId,
      openIdHash,
      openIdCipher: secrets.seal(
        oid,
        secrets.context(account, `${session.subjectType}:${session.subjectId}:${session.channelId}`),
      ),
      followerId: follower?._id,
      subscribeStatus: follower?.subscribeStatus || 'unknown',
      status: 'active',
      version: 1,
      notificationPreference: 'disabled',
      consentVersion: 'client-login-v1',
      consentedAt: now,
      boundAt: now,
      verifiedAt: now,
      verificationMethod: 'wechat_oauth_snsapi_base',
    });
    created = true;
  } catch (error) {
    if (error.code !== 11000) throw error;
    binding = await Binding.findOne({
      ...client.scope(account),
      subjectId: session.subjectId,
      subjectType: session.subjectType,
      channelId: session.channelId,
      conversationId: session.conversationId,
      status: 'active',
      openIdHash,
    });
    if (!binding) throw error;
  }
  const consumed = await auth.consumeConfirmed({
    id: record._id,
    purpose: 'bind',
    browserProof: proof,
    origin: secrets.publicOrigin(),
    ...client.scope(account),
    initiatingSessionId: session._id,
  });
  if (!consumed) {
    if (created) await Binding.deleteOne({
      _id: binding._id,
      status: 'active',
      version: 1,
    });
    throw new Error('REPLAY');
  }
  clearProof(res, `__Host-wx-client-${record._id}`);
  recordOperation({
    req,
    tenantId: session.tenantId,
    user: { id: String(session.subjectId), role: session.subjectType },
    action: 'wechat.client.bind',
    detail: 'client wechat',
  });
  ok(res, { bound: true });
}));

router.post('/client/redeem/:id', wrap(async (req, res) => {
  const { record, account, proof } = await challenge(req);
  if (record.purpose !== 'login' || record.state !== 'confirmed') {
    throw new Error('PURPOSE');
  }
  const binding = await Binding.findOne({
    _id: record.selectedBindingId,
    ...client.scope(account),
    channelId: record.channelId,
    subjectType: { $in: ['customer', 'visitor'] },
    status: 'active',
    version: record.selectedBindingVersion,
    openIdHash: client.openHash(account, openId(record)),
  });
  if (!binding) throw new Error('BINDING');
  const subject = await client.validSubject({
    subjectType: binding.subjectType,
    subjectId: binding.subjectId,
    tenantId: binding.tenantId,
    channelId: binding.channelId,
    conversationId: binding.conversationId,
  });
  if (!subject) throw new Error('SUBJECT');
  binding.currentConfigVersion = account.configVersion;
  const issued = await sessions.createSessionAndToken({
    req,
    account: subject.account,
    binding: subject.binding,
    conversationId: binding.conversationId,
    loginMethod: 'wechat',
    wechatBinding: binding,
  });
  const consumed = await auth.consumeConfirmed({
    id: record._id,
    purpose: 'login',
    browserProof: proof,
    origin: secrets.publicOrigin(),
    ...client.scope(account),
  });
  if (!consumed) {
    await CustomerSession.updateOne({
      _id: issued.session._id,
      loginMethod: 'wechat',
      revokedAt: null,
    }, {
      $set: {
        revokedAt: new Date(),
        revokeReason: '微信登录兑换冲突',
      },
    }).catch(() => {});
    throw new Error('REPLAY');
  }
  clearProof(res, `__Host-wx-client-${record._id}`);
  ok(res, {
    token: issued.token,
    identity: binding.subjectType,
    conversationId: String(binding.conversationId),
    expiresIn: 7200,
  });
}));

router.post('/client/unbind', authCustomer, wrap(async (req, res) => {
  const session = await sessions.validateSession(req.customer, { touch: false });
  if (!session || session.scopeType !== 'channel') throw new Error('SESSION');
  const binding = await Binding.findOneAndUpdate({
    tenantId: session.tenantId,
    subjectId: session.subjectId,
    subjectType: session.subjectType,
    channelId: session.channelId,
    conversationId: session.conversationId,
    status: 'active',
  }, {
    $set: {
      status: 'revoked',
      revokedAt: new Date(),
      revokedByType: 'self',
      revokedById: session.subjectId,
      revokeReason: 'client_session_unbind',
    },
    $inc: { version: 1 },
  }, { new: true });
  if (binding) {
    await sessions.revokeMany(
      { wechatBindingId: binding._id },
      '微信解绑',
      req.app.get('io'),
    );
    await Challenge.updateMany({
      tenantId: session.tenantId,
      clientSide: 'client',
      $or: [
        { selectedBindingId: binding._id },
        {
          initiatingSubject: session.subjectId,
          channelId: session.channelId,
          conversationId: session.conversationId,
          purpose: 'bind',
        },
      ],
      state: { $ne: 'consumed' },
    }, { $set: { state: 'cancelled' } });
    req.app.get('io')?.in(`wechat-binding-${binding._id}`).disconnectSockets(true);
  }
  ok(res, { bound: false });
}));

module.exports = { router, cookie, guard };
