// 忆梦云团队开发
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.WECHAT_CREDENTIAL_KEY = '34'.repeat(32);
process.env.WECHAT_PUBLIC_ORIGIN = 'https://staff.example.test';
const secrets = require('./src/services/wechatCredentialService');
const api = require('./src/services/wechatApiService');
const auth = require('./src/services/wechatAuthService');
const outbox = require('./src/services/wechatOutboxService');
test('outbox refuses standalone Mongo and writes only within transaction', async () => {
  const connection = { readyState: 1, db: { admin: () => ({ command: async () => ({ maxWireVersion: 21, logicalSessionTimeoutMinutes: 30 }) }) } };
  assert.deepEqual(await outbox.transactionCapability(connection), { available: false, reason: 'replica_set_required' });
  await assert.rejects(outbox.publishWithOutbox({ connection, account: {}, publish: async () => { assert.fail('must not publish'); } }), /REQUIRE_TRANSACTIONS/);
  await assert.rejects(outbox.appendEvent({}, { inTransaction: () => false }), /REQUIRES_TRANSACTION/);
});
test('outbox targets actual assigned agent or exact customer and excludes bot/waiting', async () => {
  const a = { ...account(), enabled: true, notificationEnabled: true, isCurrent: true };
  const conversation = { _id: 'conv', tenantId: a.tenantId, channelId: 'channel', customerId: 'customer', assignedAgentId: 'agent', status: 'active' };
  const message = { _id: 'message', tenantId: a.tenantId, conversationId: 'conv', senderType: 'customer', senderId: 'customer' };
  const context = { account: a, conversation, message };
  assert.equal(outbox.eventFor(context).recipientId, 'agent');
  assert.equal(outbox.eventFor({ ...context, message: { ...message, senderType: 'agent', senderId: 'agent' } }).recipientId, 'customer');
  assert.equal(outbox.eventFor({ ...context, conversation: { ...conversation, status: 'waiting' } }), null);
  assert.equal(outbox.eventFor({ ...context, message: { ...message, senderType: 'bot' } }), null);
  assert.throws(() => outbox.eventFor({ ...context, message: { ...message, tenantId: 'other' } }), /SCOPE_MISMATCH/);
  const session = { inTransaction: () => true };
  let writes = 0;
  await outbox.appendEvent(context, session, { updateOne: async (key, update, options) => {
    writes++; assert.equal(options.session, session); assert.equal(options.upsert, true);
    assert.equal(key.messageId, 'message'); assert.equal(update.$setOnInsert.recipientId, 'agent');
    assert.equal(update.$setOnInsert.content, undefined);
  } });
  assert.equal(writes, 1);
});
test('transaction abort propagates, ends session and never falls back to dual writes', async () => {
  const session = { inTransaction: () => true, ended: false,
    async withTransaction(fn, options) { assert.equal(options.writeConcern.w, 'majority'); return fn(); },
    async endSession() { this.ended = true; } };
  const connection = { readyState: 1, db: { admin: () => ({ command: async () => ({ setName: 'test-rs', maxWireVersion: 21, logicalSessionTimeoutMinutes: 30 }) }) },
    startSession: async () => session };
  let publications = 0;
  const a = { ...account(), enabled: true, notificationEnabled: true, isCurrent: true };
  await assert.rejects(outbox.publishWithOutbox({ connection, account: a, publish: async received => {
    publications++; assert.equal(received, session);
    return { message: { _id: 'm', tenantId: 'tenant', conversationId: 'c', senderType: 'agent' },
      conversation: { _id: 'c', tenantId: 'tenant', customerId: 'customer', channelId: 'channel', status: 'active' } };
  } }, { updateOne: async () => { throw new Error('simulated-outbox-failure'); } }), /simulated-outbox-failure/);
  assert.equal(publications, 1); assert.equal(session.ended, true);
});
function account() {
  const a = { _id: 'account', tenantId: 'tenant', appId: 'wx1234567890abcdef', generation: 1, credentialVersion: 1, configVersion: 1 };
  a.credentialCipher = { appSecret: secrets.seal('mock-secret', secrets.context(a, 'appSecret')) };
  return a;
}
function redisMock() {
  const values = new Map();
  return { values, async get(k) { return values.get(k) || null; },
    async set(k, v, options) { if (options?.NX && values.has(k)) return null; values.set(k, v); return 'OK'; },
    async eval(script, { keys, arguments: args }) {
      if (values.get(keys[0]) !== args[0]) return 0;
      if (keys.length === 2) { values.set(keys[1], args[1]); this.ttl = Number(args[2]); }
      else values.delete(keys[0]);
      return 1;
    },
  };
}
test('token cache encrypts credentials, reuses token and scopes generations', async () => {
  const a = account(), redis = redisMock(); let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.weixin.qq.com/cgi-bin/stable_token');
    assert.equal(options.redirect, 'error');
    assert.equal(JSON.parse(options.body).secret, 'mock-secret');
    return { ok: true, json: async () => ({ access_token: 'mock-access-token', expires_in: 7200 }) };
  };
  assert.equal(await api.getAccessToken(a, { redis, fetcher }), 'mock-access-token');
  assert.equal(await api.getAccessToken(a, { redis, fetcher }), 'mock-access-token');
  assert.equal(calls, 1); assert.equal(redis.ttl, 7080000);
  assert.ok(!JSON.stringify([...redis.values]).includes('mock-access-token'));
  assert.notEqual(api.cacheContext(a), api.cacheContext({ ...a, generation: 2 }));
  assert.notEqual(api.cacheContext(a), api.cacheContext({ ...a, credentialVersion: 2 }));
  assert.notEqual(api.cacheContext(a), api.cacheContext({ ...a, tenantId: 'another' }));
});
test('token requests fail closed without Redis or when another owner holds lease', async () => {
  const a = account(); let calls = 0;
  const fetcher = async () => { calls++; throw new Error('must not call'); };
  await assert.rejects(api.getAccessToken(a, { redis: null, fetcher }), /CACHE_UNAVAILABLE/);
  const redis = redisMock(); redis.set = async () => null;
  await assert.rejects(api.getAccessToken(a, { redis, fetcher, wait: async () => {} }), /TOKEN_BUSY/);
  assert.equal(calls, 0);
});
test('expired lock owner cannot publish or delete replacement owner lock', async () => {
  const redis = redisMock();
  const fetcher = async () => {
    for (const key of redis.values.keys()) redis.values.set(key, 'new-owner');
    return { ok: true, json: async () => ({ access_token: 'stale-token', expires_in: 7200 }) };
  };
  await assert.rejects(api.getAccessToken(account(), { redis, fetcher }), /LEASE_LOST/);
  assert.deepEqual([...redis.values.values()], ['new-owner']);
});
test('temporary QR uses fixed API, bounded scene/expiry and returns no access token', async () => {
  const a = account(), redis = redisMock(); let calls = 0;
  const result = await api.createTemporaryQr(a, 'wxauth_507f1f77bcf86cd799439011', { redis, fetcher: async (raw, options) => {
    calls++;
    if (calls === 1) return { ok: true, json: async () => ({ access_token: 'mock-access-token', expires_in: 7200 }) };
    const url = new URL(raw); assert.equal(url.origin, 'https://api.weixin.qq.com'); assert.equal(url.pathname, '/cgi-bin/qrcode/create');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { expire_seconds: 120, action_name: 'QR_STR_SCENE', action_info: { scene: { scene_str: 'wxauth_507f1f77bcf86cd799439011' } } });
    return { ok: true, json: async () => ({ ticket: 'qr-ticket', expire_seconds: 300 }) };
  } });
  assert.deepEqual(result, { ticket: 'qr-ticket', url: 'https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=qr-ticket', expiresIn: 120 });
  assert.ok(!JSON.stringify(result).includes('mock-access-token'));
  await assert.rejects(api.createTemporaryQr(a, '../invalid', { redis }), /SCENE_INVALID/);
});
test('OAuth uses fixed host, discards tokens and sanitizes upstream errors', async () => {
  const result = await api.exchangeOAuthCode(account(), 'mock-code', { fetcher: async (raw, options) => {
    const url = new URL(raw); assert.equal(url.origin, 'https://api.weixin.qq.com');
    assert.equal(url.pathname, '/sns/oauth2/access_token'); assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ openid: 'openid-A', access_token: 'discard-me', unionid: 'discard-union' }) };
  } });
  assert.deepEqual(result, { openId: 'openid-A' });
  await assert.rejects(api.exchangeOAuthCode(account(), 'mock-code', { fetcher: async () => { throw new Error('secret-in-url'); } }),
    error => error.message === 'WECHAT_UPSTREAM_UNAVAILABLE');
  await assert.rejects(api.exchangeOAuthCode(account(), 'mock-code', { fetcher: async () => ({ ok: true, json: async () => ({ appid: 'wx0000000000000000', openid: 'openid-A', access_token: 'discard-me' }) }) }), /OAUTH_REJECTED/);
  await assert.rejects(api.exchangeOAuthCode(account(), '../invalid'), /CODE_INVALID/);
});
function challengeMock() {
  let row;
  const matches = (query) => row && Object.entries(query).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('$gt' in value && !(row[key] > value.$gt)) return false;
      if ('$gte' in value && !(row[key] >= value.$gte)) return false;
      if ('$lte' in value && !(row[key] <= value.$lte)) return false;
      if ('$exists' in value) return (row[key] !== undefined) === value.$exists;
      if ('$type' in value) return value.$type === 'string' && typeof row[key] === 'string';
      if ('$in' in value) return value.$in.includes(row[key]);
      return true;
    }
    return value instanceof Date ? +row[key] === +value : row[key] === value;
  });
  const apply = update => { Object.assign(row, update.$set); for (const key of Object.keys(update.$unset || {})) delete row[key]; };
  return { get row() { return row; }, async create(data) { row = { ...data, _id: 'challenge' }; return { ...row }; },
    async findOneAndUpdate(query, update) { if (!matches(query)) return null; apply(update); return { ...row }; },
    async updateOne(query, update) { if (matches(query)) apply(update); },
  };
}
async function scanned() {
  const a = account(), Model = challengeMock();
  const challenge = await auth.createChallenge({ account: a, purpose: 'login', clientSide: 'staff', origin: process.env.WECHAT_PUBLIC_ORIGIN }, Model);
  Model.row._id = '507f1f77bcf86cd799439011';
  const scanOpenIdHash = require('./src/services/wechatStaffService').openHash(a, 'openid-A');
  await auth.claimScan({ account: a, challengeId: Model.row._id, scanOpenIdHash }, Model);
  const oauth = await auth.beginClaimedOAuth({ account: a, challengeId: Model.row._id }, Model);
  return { a, Model, challenge: { ...challenge, record: { ...challenge.record, _id: Model.row._id } }, oauth, state: new URL(oauth.authorizationUrl).searchParams.get('state') };
}
test('scan is single-use and OAuth binds browser, tenant, config and parent expiry', async () => {
  const { a, Model, challenge, oauth, state } = await scanned();
  assert.equal(new URL(oauth.authorizationUrl).origin, 'https://open.weixin.qq.com');
  assert.ok(!oauth.authorizationUrl.includes(oauth.browserProof));
  await assert.rejects(auth.beginClaimedOAuth({ account: a, challengeId: Model.row._id }, Model), /UNAVAILABLE/);
  let calls = 0; const exchange = async () => { calls++; return { openId: 'openid-A' }; };
  for (const input of [
    { account: a, state, browserProof: 'f'.repeat(64) },
    { account: { ...a, tenantId: 'other' }, state, browserProof: oauth.browserProof },
    { account: { ...a, configVersion: 2 }, state, browserProof: oauth.browserProof },
    { account: a, state: 'f'.repeat(64), browserProof: oauth.browserProof },
  ]) await assert.rejects(auth.completeOAuth({ ...input, code: 'code' }, Model, exchange), /STATE_UNAVAILABLE/);
  assert.equal(calls, 0);
  Model.row.expiresAt = new Date(Date.now() - 1);
  await assert.rejects(auth.completeOAuth({ account: a, state, browserProof: oauth.browserProof, code: 'code' }, Model, exchange), /STATE_UNAVAILABLE/);
  assert.equal(calls, 0);
});
test('official scene claim is purpose-scoped, single-use and binds OAuth OpenID to scanner', async () => {
  const a = account(), Model = challengeMock();
  const challenge = await auth.createChallenge({ account: a, purpose: 'login', clientSide: 'staff', origin: process.env.WECHAT_PUBLIC_ORIGIN }, Model);
  Model.row._id = '507f1f77bcf86cd799439011';
  const scanHash = require('./src/services/wechatStaffService').openHash(a, 'openid-A');
  assert.equal((await auth.claimScan({ account: a, challengeId: Model.row._id, scanOpenIdHash: scanHash }, Model)).purpose, 'login');
  await assert.rejects(auth.claimScan({ account: a, challengeId: Model.row._id, scanOpenIdHash: scanHash }, Model), /UNAVAILABLE/);
  const oauth = await auth.beginClaimedOAuth({ account: a, challengeId: Model.row._id }, Model);
  const state = new URL(oauth.authorizationUrl).searchParams.get('state');
  await assert.rejects(auth.completeOAuth({ account: a, state, browserProof: oauth.browserProof, code: 'code' }, Model,
    async () => ({ openId: 'openid-B' })), /OAUTH_VERIFICATION_FAILED/);
  assert.equal(Model.row.state, 'cancelled');
});
test('direct in-WeChat OAuth requires original browser proof and keeps confirmation state machine', async () => {
  const a = account(), Model = challengeMock();
  const challenge = await auth.createChallenge({
    account: a,
    purpose: 'login',
    clientSide: 'client',
    authMode: 'direct',
    origin: process.env.WECHAT_PUBLIC_ORIGIN,
    channelId: '507f1f77bcf86cd799439012',
  }, Model);
  Model.row._id = '507f1f77bcf86cd799439011';
  await assert.rejects(auth.beginDirectOAuth({
    account: a,
    challengeId: Model.row._id,
    browserProof: 'f'.repeat(64),
  }, Model), /UNAVAILABLE/);
  const oauth = await auth.beginDirectOAuth({
    account: a,
    challengeId: Model.row._id,
    browserProof: challenge.browserProof,
  }, Model);
  assert.equal(Model.row.state, 'scanned');
  assert.equal(Model.row.scanOpenIdHash, undefined);
  assert.equal(new URL(oauth.authorizationUrl).origin, 'https://open.weixin.qq.com');
  const state = new URL(oauth.authorizationUrl).searchParams.get('state');
  const completed = await auth.completeOAuth({
    account: a,
    state,
    browserProof: oauth.browserProof,
    code: 'code',
  }, Model, async () => ({ openId: 'openid-direct' }));
  assert.equal(completed.state, 'oauth_verified');
  assert.ok(!JSON.stringify(Model.row).includes('openid-direct'));
});

test('OAuth callback consumes state before exchange and stores encrypted OpenID only', async () => {
  const { a, Model, oauth, state } = await scanned(); let calls = 0;
  const input = { account: a, state, browserProof: oauth.browserProof, code: 'code' };
  const exchange = async () => { calls++; assert.equal(Model.row.oauthStateHash, undefined); return { openId: 'openid-A' }; };
  const result = await auth.completeOAuth(input, Model, exchange);
  assert.equal(result.state, 'oauth_verified'); assert.equal(result.verifiedOpenId, undefined);
  assert.ok(!JSON.stringify(Model.row).includes('openid-A'));
  await assert.rejects(auth.completeOAuth(input, Model, exchange), /STATE_UNAVAILABLE/);
  assert.equal(calls, 1);
});
test('upstream OAuth failure cancels challenge without leaking error details', async () => {
  const { a, Model, oauth, state } = await scanned();
  await assert.rejects(auth.completeOAuth({ account: a, state, browserProof: oauth.browserProof, code: 'code' }, Model,
    async () => { throw new Error('upstream-secret'); }), error => error.message === 'OAUTH_VERIFICATION_FAILED');
  assert.equal(Model.row.state, 'cancelled'); assert.equal(Model.row.oauthBrowserProofHash, undefined);
});
test('purpose and original browser proof are required for confirmed consumption', async () => {
  const a = account(), Model = challengeMock();
  const challenge = await auth.createChallenge({ account: a, purpose: 'login', clientSide: 'staff', origin: process.env.WECHAT_PUBLIC_ORIGIN }, Model);
  Model.row.state = 'confirmed'; Model.row.confirmedAt = new Date();
  const input = { id: Model.row._id, purpose: 'login', browserProof: challenge.browserProof, origin: process.env.WECHAT_PUBLIC_ORIGIN,
    tenantId: a.tenantId, officialAccountId: a._id, generation: a.generation };
  assert.equal(await auth.consumeConfirmed({ ...input, purpose: 'bind', initiatingSessionId: 'session' }, Model), null);
  assert.equal(await auth.consumeConfirmed({ ...input, browserProof: 'f'.repeat(64) }, Model), null);
  assert.equal((await auth.consumeConfirmed(input, Model)).state, 'consumed');
  assert.equal(await auth.consumeConfirmed(input, Model), null);
});
test('only original browser and origin may cancel a pending challenge', async () => {
  const { a, Model, challenge } = await scanned();
  const input = { id: Model.row._id, account: a, browserProof: challenge.browserProof, origin: process.env.WECHAT_PUBLIC_ORIGIN };
  assert.equal(await auth.cancelChallenge({ ...input, origin: 'https://evil.test' }, Model), null);
  assert.equal((await auth.cancelChallenge(input, Model)).state, 'cancelled');
  assert.equal(await auth.cancelChallenge(input, Model), null);
});
