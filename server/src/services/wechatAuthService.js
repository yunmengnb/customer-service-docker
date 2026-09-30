// 忆梦云团队开发
// 客服微信绑定与登录 challenge/OAuth 状态机。
const crypto = require('crypto');
const Challenge = require('../models/WechatAuthChallenge');
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const random = () => crypto.randomBytes(32).toString('hex');
async function createChallenge({ account, purpose, clientSide, authMode = 'qr', origin, sessionId, subjectId, subjectType, channelId, conversationId, createQr }, Model = Challenge) {
  if (!['bind', 'login'].includes(purpose) || !['staff', 'client'].includes(clientSide) || !['qr', 'direct'].includes(authMode)) throw new Error('INVALID_PURPOSE');
  if (purpose === 'bind' && (!sessionId || !subjectId)) throw new Error('BIND_REQUIRES_SESSION');
  if (clientSide === 'client' && (!channelId || (purpose === 'bind' && (!conversationId || !['customer', 'visitor'].includes(subjectType))))) {
    throw new Error('CLIENT_SCOPE_REQUIRED');
  }
  if (!account?.tenantId || !account?._id || !account?.appId || !account?.generation || new URL(origin).protocol !== 'https:') throw new Error('INVALID_CONTEXT');
  const scanTicket = random(), browserProof = random();
  const record = await Model.create({
    tenantId: account.tenantId, officialAccountId: account._id, appId: account.appId, generation: account.generation,
    credentialVersion: account.credentialVersion, configVersion: account.configVersion,
    purpose, clientSide, authMode, initiatingSessionId: sessionId, initiatingSubject: subjectId,
    initiatingSubjectType: subjectType, channelId, conversationId, origin,
    scanTicketHash: digest(scanTicket), browserProofHash: digest(browserProof), phrase: crypto.randomBytes(3).toString('hex').toUpperCase(),
    expiresAt: new Date(Date.now() + 120000), state: 'pending',
  });
  // 单元协议可跳过真实二维码；公开 HTTP 路由始终传入固定微信二维码创建器。
  if (!createQr) return { record, scanTicket, browserProof };
  try {
    const qr = await createQr(account, `wxauth_${record._id}`);
    const expiresAt = new Date(Math.min(record.expiresAt.getTime(), Date.now() + qr.expiresIn * 1000));
    await Model.updateOne({ _id: record._id, state: 'pending' }, { $set: { qrTicketHash: digest(qr.ticket), qrExpiresAt: expiresAt } });
    record.qrExpiresAt = expiresAt;
    return { record, scanTicket, browserProof, qrUrl: qr.url };
  } catch (error) {
    await Model.updateOne({ _id: record._id, state: 'pending' }, { $set: { state: 'cancelled' } }).catch(() => {});
    throw error;
  }
}
async function consumeConfirmed({ id, purpose, browserProof, origin, tenantId, officialAccountId, generation, initiatingSessionId }, Model = Challenge) {
  if (!['bind', 'login'].includes(purpose) || !/^[a-f0-9]{64}$/.test(browserProof || '') || !tenantId || !officialAccountId || !generation || (purpose === 'bind' && !initiatingSessionId)) return null;
  const now = new Date();
  return Model.findOneAndUpdate({
    _id: id, tenantId, officialAccountId, generation, purpose, browserProofHash: digest(browserProof), origin,
    ...(purpose === 'bind' ? { initiatingSessionId } : {}), state: 'confirmed',
    confirmedAt: { $gte: new Date(now.getTime() - 60000), $lte: now }, expiresAt: { $gt: now },
  }, { $set: { state: 'consumed', consumedAt: now } }, { new: true });
}
function scope(account) {
  require('./wechatApiService').cacheContext(account);
  if (!Number.isSafeInteger(account.configVersion) || account.configVersion < 1) throw new Error('INVALID_CONFIG_VERSION');
  return { tenantId: account.tenantId, officialAccountId: account._id, appId: account.appId, generation: account.generation,
    credentialVersion: account.credentialVersion, configVersion: account.configVersion };
}
function validProof(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function oauthAad(record) {
  return `wechat-oauth:${record.tenantId}:${record.officialAccountId}:${record.appId}:${record.generation}:${record._id}`;
}
function authorizationUrl(account, state) {
  const callback = `${require('./wechatCredentialService').publicOrigin()}/api/wechat/oauth/callback`;
  const url = new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
  url.search = new URLSearchParams({ appid: account.appId, redirect_uri: callback, response_type: 'code', scope: 'snsapi_base', state }).toString();
  url.hash = 'wechat_redirect';
  return url.toString();
}
async function claimScan({ account, challengeId, scanOpenIdHash }, Model = Challenge) {
  if (!/^[a-f0-9]{24}$/.test(String(challengeId || '')) || !validProof(scanOpenIdHash)) throw new Error('INVALID_SCAN_IDENTITY');
  const now = new Date();
  const record = await Model.findOneAndUpdate({ _id: challengeId, ...scope(account), state: 'pending', expiresAt: { $gt: now } },
    { $set: { state: 'scanned', scanOpenIdHash } }, { new: true });
  if (!record) throw new Error('CHALLENGE_UNAVAILABLE');
  return record;
}
async function beginClaimedOAuth({ account, challengeId }, Model = Challenge) {
  if (!/^[a-f0-9]{24}$/.test(String(challengeId || ''))) throw new Error('INVALID_CHALLENGE');
  const state = random(), browserProof = random(), now = new Date();
  const record = await Model.findOneAndUpdate({ _id: challengeId, ...scope(account), state: 'scanned',
    scanOpenIdHash: { $type: 'string' }, oauthStateHash: { $exists: false }, expiresAt: { $gt: now } },
  { $set: { oauthStateHash: digest(state), oauthBrowserProofHash: digest(browserProof),
    oauthExpiresAt: new Date(Math.min(now.getTime() + 300000, now.getTime() + 120000)) } }, { new: true });
  if (!record) throw new Error('CHALLENGE_UNAVAILABLE');
  return { record, browserProof, authorizationUrl: authorizationUrl(account, state) };
}
async function beginDirectOAuth({ account, challengeId, browserProof }, Model = Challenge) {
  if (!/^[a-f0-9]{24}$/.test(String(challengeId || '')) || !validProof(browserProof)) throw new Error('INVALID_CHALLENGE');
  const state = random(), oauthProof = random(), now = new Date();
  const record = await Model.findOneAndUpdate({ _id: challengeId, ...scope(account), authMode: 'direct', state: 'pending',
    browserProofHash: digest(browserProof), oauthStateHash: { $exists: false }, expiresAt: { $gt: now } },
  { $set: { state: 'scanned', oauthStateHash: digest(state), oauthBrowserProofHash: digest(oauthProof),
    oauthExpiresAt: new Date(Math.min(now.getTime() + 300000, now.getTime() + 120000)) } }, { new: true });
  if (!record) throw new Error('CHALLENGE_UNAVAILABLE');
  return { record, browserProof: oauthProof, authorizationUrl: authorizationUrl(account, state) };
}
async function completeOAuth({ account, state, browserProof, code }, Model = Challenge, exchange = require('./wechatApiService').exchangeOAuthCode) {
  if (!validProof(state) || !validProof(browserProof) || typeof code !== 'string' || !/^[\w-]{1,512}$/.test(code)) throw new Error('INVALID_OAUTH_PROOF');
  const now = new Date();
  // Claim state BEFORE spending the upstream one-use code; parallel/replayed callbacks fail closed.
  const record = await Model.findOneAndUpdate({
    ...scope(account), state: 'scanned', oauthStateHash: digest(state), oauthBrowserProofHash: digest(browserProof),
    oauthClaimedAt: { $exists: false }, oauthExpiresAt: { $gt: now }, expiresAt: { $gt: now },
  }, { $set: { oauthClaimedAt: now }, $unset: { oauthStateHash: 1 } }, { new: true });
  if (!record) throw new Error('OAUTH_STATE_UNAVAILABLE');
  try {
    const { openId } = await exchange(account, code);
    if (record.scanOpenIdHash) {
      const expected = digest(`${account.tenantId}:${account._id}:${account.appId}:${account.generation}:${openId}`);
      if (expected !== record.scanOpenIdHash) throw new Error('OAUTH_IDENTITY_MISMATCH');
    }
    const cipher = require('./wechatCredentialService').seal(openId, oauthAad(record));
    const result = await Model.findOneAndUpdate({
      _id: record._id, ...scope(account), state: 'scanned', oauthClaimedAt: now, expiresAt: { $gt: new Date() },
    }, { $set: { state: 'oauth_verified', verifiedOpenIdCipher: cipher } }, { new: true });
    if (!result) throw new Error('CHALLENGE_UNAVAILABLE');
    return result;
  } catch {
    await Model.updateOne({ _id: record._id, ...scope(account), state: 'scanned' },
      { $set: { state: 'cancelled' }, $unset: { oauthBrowserProofHash: 1 } });
    throw new Error('OAUTH_VERIFICATION_FAILED');
  }
}
async function cancelChallenge({ id, account, browserProof, origin }, Model = Challenge) {
  if (!validProof(browserProof)) return null;
  return Model.findOneAndUpdate({ _id: id, ...scope(account), origin, browserProofHash: digest(browserProof),
    state: { $in: ['pending', 'scanned', 'oauth_verified', 'confirmed'] }, expiresAt: { $gt: new Date() },
  }, { $set: { state: 'cancelled' }, $unset: { oauthStateHash: 1, oauthBrowserProofHash: 1, verifiedOpenIdCipher: 1 } }, { new: true });
}
module.exports = { digest, scope, createChallenge, consumeConfirmed, claimScan, beginClaimedOAuth, beginDirectOAuth, completeOAuth, cancelChallenge };
