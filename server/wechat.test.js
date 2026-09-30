// 忆梦云团队开发
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
process.env.WECHAT_CREDENTIAL_KEY = '12'.repeat(32);
process.env.WECHAT_PUBLIC_ORIGIN = 'https://staff.example.test';
const secrets = require('./src/services/wechatCredentialService');
const callback = require('./src/services/wechatCallbackService');
const auth = require('./src/services/wechatAuthService');
const Account = require('./src/models/WechatOfficialAccount');
const Receipt = require('./src/models/WechatCallbackReceipt');
const Follower = require('./src/models/WechatFollower');
const Binding = require('./src/models/WechatIdentityBinding');
const controller = require('./src/controllers/WechatOfficialController');
const account = { _id: '507f1f77bcf86cd799439011', tenantId: '507f1f77bcf86cd799439012', appId: 'wx1234567890abcdef', generation: 1, configVersion: 1, callbackRouteId: 'a'.repeat(64) };
const aesKey = Buffer.alloc(32, 7).toString('base64').slice(0, -1);
function encrypt(text, appId = account.appId) {
  const message = Buffer.from(text), size = Buffer.alloc(4); size.writeUInt32BE(message.length);
  const raw = Buffer.concat([Buffer.alloc(16, 3), size, message, Buffer.from(appId)]);
  const n = 32 - raw.length % 32;
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(aesKey + '=', 'base64'), Buffer.alloc(16, 7)); cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(Buffer.concat([raw, Buffer.alloc(n, n)])), cipher.final()]).toString('base64');
}
test('credentials use independent authenticated nonces and tenant/AppID AAD; no plaintext response', () => {
  const one = secrets.seal('test-secret', 'tenant:A'), two = secrets.seal('test-secret', 'tenant:A');
  assert.notEqual(one.iv, two.iv); assert.equal(secrets.open(one, 'tenant:A'), 'test-secret');
  assert.throws(() => secrets.open(one, 'tenant:B'));
  assert.throws(() => secrets.open({ ...one, tag: Buffer.alloc(16).toString('base64') }, 'tenant:A'));
  const response = JSON.stringify(controller.safe({ ...account, credentialCipher: { appSecret: one }, secret: 'test-secret' }));
  assert.ok(!response.includes('test-secret')); assert.ok(!response.includes(one.data));
  assert.equal(JSON.parse(response).loginEnabled, false);
});
test('credential detection uses fixed host POST and never returns access token', async () => {
  const configured = { ...account, credentialCipher: { appSecret: secrets.seal('mock-app-secret', secrets.context(account, 'appSecret')) } };
  const result = await secrets.checkCredential(configured, async (url, options) => {
    assert.equal(url, 'https://api.weixin.qq.com/cgi-bin/stable_token'); assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ access_token: 'private-token', expires_in: 7200 }) };
  });
  assert.equal(result, 'passed');
});
test('safe mode validates signatures, freshness, AppID and padding', () => {
  const encrypted = encrypt('<xml><Event>subscribe</Event></xml>');
  assert.equal(callback.decrypt(encrypted, aesKey, account.appId), '<xml><Event>subscribe</Event></xml>');
  assert.throws(() => callback.decrypt(encrypted, aesKey, 'wxforeign'));
  assert.throws(() => callback.decrypt(encrypted.slice(0, -4) + 'AAAA', aesKey, account.appId));
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = 'test';
  const signature = crypto.createHash('sha1').update(['token', timestamp, nonce, encrypted].sort().join('')).digest('hex');
  callback.verifySignature({ token: 'token', timestamp, nonce, encrypted, signature });
  assert.throws(() => callback.verifySignature({ token: 'bad', timestamp, nonce, encrypted, signature }));
  assert.throws(() => callback.verifySignature({ token: 'token', timestamp, nonce, encrypted, signature }, Date.now() + 700000));
});
test('XML parser rejects DTD, entities, nesting, duplicates and oversize', () => {
  assert.equal(callback.parseXml('<xml><Event><![CDATA[subscribe]]></Event></xml>').Event, 'subscribe');
  for (const xml of ['<!DOCTYPE xml [<!ENTITY x SYSTEM "file:///secret">]><xml>&x;</xml>', '<xml><Event>a</Event><Event>b</Event></xml>', '<xml><a><b><c>x</c></b></a></xml>', '<xml>' + 'a'.repeat(65536) + '</xml>', '<xml><a></xml>']) assert.throws(() => callback.parseXml(xml));
});
test('receipt persistence scopes tenant/app and contains encrypted minimal payload; failure propagates', async t => {
  let captured;
  t.mock.method(Receipt, 'updateOne', async (filter, update) => { captured = { filter, update }; });
  const event = { FromUserName: 'openid-A', CreateTime: '1790101000', MsgType: 'event', Event: 'subscribe' };
  await callback.persist(account, event);
  assert.equal(captured.filter.officialAccountId, account._id);
  assert.equal(captured.update.$setOnInsert.tenantId, account.tenantId);
  assert.ok(!JSON.stringify(captured).includes('openid-A'));
  Receipt.updateOne.mock.mockImplementation(async () => { throw new Error('database down'); });
  await assert.rejects(callback.persist(account, event), /database down/);
});
test('pending receipt recovery updates only newer follower facts, preserves personal opt-out', async t => {
  const eventKey = 'key'; const eventAt = new Date(); const updates = [];
  const receipt = { ...account, _id: 'receipt', officialAccountId: account._id, eventKey, eventAt, payloadCipher: secrets.seal(JSON.stringify({ openId: 'openid', type: 'unsubscribe' }), `${account._id}:${eventKey}`) };
  t.mock.method(Receipt, 'find', () => ({ select: () => ({ sort: () => ({ limit: async () => [receipt] }) }) }));
  t.mock.method(Follower, 'findOneAndUpdate', async (...args) => { updates.push(args); return { _id: 'follower' }; });
  t.mock.method(Follower, 'updateOne', async (...args) => { updates.push(args); });
  t.mock.method(Binding, 'updateMany', async (...args) => { updates.push(args); });
  t.mock.method(Receipt, 'updateOne', async () => {});
  await callback.processPending();
  assert.equal(updates[1][0].tenantId, account.tenantId);
  assert.equal(updates[1][0].$or[1].lastEventAt.$lte, eventAt);
  assert.equal(updates[1][1].$set.subscribeStatus, 'unsubscribed');
  assert.ok(!('allNotificationsOptOut' in updates[1][1].$set));
  assert.equal(updates[2][0].tenantId, account.tenantId);
  assert.equal(updates[2][1].$set.subscribeStatus, 'unsubscribed');
});
test('challenge stores only hashes with purpose/session binding and two-minute TTL', async () => {
  let row;
  const created = await auth.createChallenge({ account, purpose: 'bind', clientSide: 'staff', origin: 'https://staff.example.test', sessionId: 'session', subjectId: 'user' }, { create: async value => { row = value; return value; } });
  assert.equal(created.scanTicket.length, 64); assert.notEqual(created.scanTicket, created.browserProof);
  assert.equal(row.browserProofHash, auth.digest(created.browserProof)); assert.equal(row.initiatingSessionId, 'session');
  assert.ok(row.expiresAt - Date.now() <= 120000);
  assert.ok(!JSON.stringify(row).includes(created.scanTicket));
  await assert.rejects(auth.createChallenge({ account, purpose: 'bind', clientSide: 'staff', origin: 'https://staff.example.test' }), /SESSION/);
});
test('CAS consumption rejects wrong browser, purpose, expired confirmation and duplicate exchange', async () => {
  const proof = 'a'.repeat(64); let state = 'confirmed';
  const Model = { findOneAndUpdate: async (filter) => {
    assert.equal(filter.tenantId, account.tenantId); assert.equal(filter.officialAccountId, account._id);
    assert.ok(filter.expiresAt.$gt instanceof Date); assert.ok(filter.confirmedAt.$gte instanceof Date);
    if (filter.browserProofHash !== auth.digest(proof) || filter.purpose !== 'login' || state !== 'confirmed') return null;
    state = 'consumed'; return { state };
  } };
  const input = { id: 'challenge', purpose: 'login', browserProof: proof, origin: 'https://staff.example.test', tenantId: account.tenantId, officialAccountId: account._id, generation: 1 };
  assert.equal(await auth.consumeConfirmed({ ...input, browserProof: 'b'.repeat(64) }, Model), null);
  assert.equal(await auth.consumeConfirmed({ ...input, purpose: 'bind' }, Model), null);
  assert.equal((await auth.consumeConfirmed(input, Model)).state, 'consumed');
  assert.equal(await auth.consumeConfirmed(input, Model), null);
});
test('management rejects anonymous/agent, scopes reads and rejects cross-origin writes', async t => {
  const express = require('express');
  const app = express(); app.use(express.json());
  const { requireTenantAdmin } = require('./src/middleware/auth');
  app.use((req, res, next) => { res.locals.requestId = 'mock'; next(); });
  app.get('/agent', (req, res, next) => { req.user = { role: 'agent' }; next(); }, requireTenantAdmin, controller.get);
  app.get('/anonymous', requireTenantAdmin, controller.get);
  app.get('/config', (req, res, next) => { req.tenantId = account.tenantId; next(); }, controller.get);
  app.put('/config', controller.save);
  t.mock.method(Account, 'findOne', async filter => { assert.deepEqual(filter, { tenantId: account.tenantId, isCurrent: true }); return account; });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(url + '/agent')).status, 403);
    assert.equal((await fetch(url + '/anonymous')).status, 401);
    assert.equal((await fetch(url + '/config')).status, 200);
    assert.equal((await fetch(url + '/config', { method: 'PUT', headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('real callback route ACKs only after persistence and rejects invalid requests', async t => {
  const express = require('express');
  const Tenant = require('./src/models/Tenant');
  const configured = { ...account, credentialCipher: {} };
  for (const [name, value] of Object.entries({ token: 'mocktoken', encodingAESKey: aesKey })) configured.credentialCipher[name] = secrets.seal(value, secrets.context(account, name));
  t.mock.method(Account, 'findOne', () => ({ select: async () => configured }));
  t.mock.method(Tenant, 'exists', async () => true);
  const persisted = t.mock.method(Receipt, 'updateOne', async () => {});
  const app = express(); app.use('/api/wechat', require('./src/routes/wechat').publicRouter);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const encrypted = encrypt('<xml><FromUserName>openid</FromUserName><CreateTime>1790101000</CreateTime><MsgType>event</MsgType><Event>subscribe</Event></xml>');
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = 'nonce';
  const signature = crypto.createHash('sha1').update(['mocktoken', timestamp, nonce, encrypted].sort().join('')).digest('hex');
  const url = `http://127.0.0.1:${server.address().port}/api/wechat/callback/${account.callbackRouteId}?timestamp=${timestamp}&nonce=${nonce}&msg_signature=${signature}`;
  const options = { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>` };
  try {
    assert.equal(await (await fetch(url, options)).text(), 'success'); assert.equal(persisted.mock.callCount(), 1);
    Receipt.updateOne.mock.mockImplementation(async () => { throw new Error('offline'); });
    assert.equal((await fetch(url, options)).status, 503);
    assert.equal((await fetch(url + 'bad', options)).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('configuration schema enforces historical AppID uniqueness and hidden secrets', () => {
  assert.equal(Account.schema.path('credentialCipher').options.select, false);
  assert.ok(Account.schema.indexes().some(([keys, options]) => keys.appId && options.unique && !options.partialFilterExpression));
});
