// 忆梦云团队开发
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.WECHAT_PUBLIC_ORIGIN = 'https://staff.example.test';
process.env.WECHAT_CREDENTIAL_KEY = '12'.repeat(32);
const { router, cookie, guard } = require('./src/routes/wechatStaff');
const Challenge = require('./src/models/WechatAuthChallenge');
const Binding = require('./src/models/WechatIdentityBinding');
const User = require('./src/models/TenantUser');
const Tenant = require('./src/models/Tenant');
const Session = require('./src/models/TenantUserSession');
const staff = require('./src/services/wechatStaffService');
const auth = require('./src/services/wechatAuthService');
const sessions = require('./src/services/tenantSessionService');
const secrets = require('./src/services/wechatCredentialService');
const oid = 'openid-mock', proof = 'a'.repeat(64);
const id = '507f1f77bcf86cd799439011';
const account = { _id: '507f1f77bcf86cd799439012', tenantId: '507f1f77bcf86cd799439013', appId: 'wx1234567890abcdef', generation: 1, configVersion: 1, credentialVersion: 1 };
async function http(t) {
  const app = express(); app.use(express.json()); app.use('/api/wechat', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  return async (path, body, cookies = `__Host-wx-scan=${proof}`) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/wechat${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookies, Origin: process.env.WECHAT_PUBLIC_ORIGIN, 'X-Wechat-Intent': 'staff-v1', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text };
  };
}
test('HTTP CSRF guard rejects missing/foreign Origin, missing intent and non-JSON; duplicate cookies fail closed', () => {
  const req = { headers: { origin: process.env.WECHAT_PUBLIC_ORIGIN, 'x-wechat-intent': 'staff-v1' }, is: () => true };
  guard(req);
  for (const origin of [undefined, 'null', 'https://evil.test']) assert.throws(() => guard({ ...req, headers: { ...req.headers, origin } }));
  assert.throws(() => guard({ ...req, headers: { origin: req.headers.origin } }));
  assert.throws(() => guard({ ...req, is: () => false }));
  assert.equal(cookie({ headers: { cookie: `p=${proof}; p=${proof}` } }, 'p'), '');
  assert.equal(cookie({ headers: { cookie: `p=${proof}` } }, 'p'), proof);
});
test('staff openid digest isolates tenant, AppID and generation; client identities remain data-only scoped', () => {
  const hash = staff.openHash(account, oid);
  for (const changed of [{ tenantId: 'other' }, { appId: 'wxother' }, { generation: 2 }]) assert.notEqual(staff.openHash({ ...account, ...changed }, oid), hash);
  assert.deepEqual(Binding.schema.path('subjectType').enumValues, ['staff', 'customer', 'visitor']);
  assert.deepEqual(Binding.schema.path('status').enumValues, ['active', 'revoked']);
  assert.deepEqual(Binding.schema.path('notificationPreference').enumValues, ['disabled', 'enabled']);
  assert.equal(Binding.schema.path('openIdCipher').options.select, false);
  assert.ok(Binding.schema.indexes().some(([keys, options]) => keys.subjectId && options.unique && options.partialFilterExpression?.status === 'active'));
});
test('actual routes reject anonymous binding/unbind and missing original browser', async t => {
  const call = await http(t);
  for (const path of ['/staff/bind', '/staff/unbind', `/staff/finish-bind/${id}`]) assert.equal((await call(path, {})).status, 401);
  assert.equal((await call(`/staff/status/${id}`, undefined, '')).status, 403);
  assert.equal((await call(`/staff/oauth-start/${id}`)).status, 403);
  assert.equal((await call(`/staff/scan/${proof}`)).status, 404);
  assert.equal((await call('/staff/context/arbitrary-tenant-id')).status, 403);
});
test('OAuth verified page lists only matching bindings; explicit choice required; confirmation CAS single use', async t => {
  const record = { _id: id, ...staff.scope(account), configVersion: 1, credentialVersion: 1, purpose: 'login', clientSide: 'staff', state: 'oauth_verified', phrase: 'ABC123' };
  record.verifiedOpenIdCipher = secrets.seal(oid, `wechat-oauth:${record.tenantId}:${record.officialAccountId}:${record.appId}:1:${id}`);
  t.mock.method(require('./src/utils/systemSettings'), 'getSystemSettings', async () => ({ tenantLoginEnabled: true }));
  t.mock.method(staff, 'current', async filter => { assert.equal(filter.tenantId, account.tenantId); return account; });
  t.mock.method(Challenge, 'findOne', filter => ({ select: async () => filter.oauthBrowserProofHash === auth.digest(proof) ? record : null }));
  t.mock.method(Tenant, 'findById', async () => ({ name: 'Mock tenant' }));
  t.mock.method(Binding, 'find', async filter => { assert.equal(filter.openIdHash, staff.openHash(account, oid)); assert.equal(filter.tenantId, account.tenantId); return [{ _id: id, subjectId: id, version: 1 }]; });
  t.mock.method(User, 'findOne', async () => ({ displayName: '客服甲', username: 'agent' }));
  t.mock.method(Challenge, 'findOneAndUpdate', async (filter, update) => { if (record.state !== filter.state) return null; Object.assign(record, update.$set); return record; });
  const call = await http(t);
  const page = await call(`/staff/confirm/${id}`);
  assert.equal(page.status, 200); assert.equal(page.body.data.candidates.length, 1);
  assert.equal(record.state, 'oauth_verified');
  assert.equal((await call(`/staff/confirm/${id}`, { confirm: true, bindingId: 'foreign' })).status, 403);
  assert.equal((await call(`/staff/confirm/${id}`, { bindingId: id })).status, 403);
  assert.equal((await call(`/staff/confirm/${id}`, { confirm: true, bindingId: id })).status, 200);
  assert.equal(record.selectedBindingId, id);
  assert.equal((await call(`/staff/confirm/${id}`, { confirm: true, bindingId: id })).status, 403);
});
test('wechat session has real sid, matching two-hour JWT/session TTL and realtime binding/version revocation', async t => {
  let stored;
  const binding = { _id: id, version: 1, currentConfigVersion: 2 };
  t.mock.method(staff, 'activeBinding', async () => binding);
  t.mock.method(Session, 'create', async values => { stored = { ...values, _id: id }; return stored; });
  t.mock.method(Session, 'findOne', async () => stored);
  const user = { _id: id, tenantId: account.tenantId, username: 'agent', displayName: 'Agent', role: 'agent', password: 'hashed-password' };
  const result = await sessions.createSessionAndToken({ user, req: { headers: {} }, loginMethod: 'wechat', binding });
  const payload = require('./src/utils').verifyToken(result.token);
  assert.equal(payload.sid, id); assert.equal(payload.exp - payload.iat, 7200);
  assert.equal(stored.expiresAt - stored.lastSeenAt, 7200000);
  assert.equal(stored.loginMethod, 'wechat');
  assert.ok(await sessions.validateSession(payload, { touch: false }));
  binding.currentConfigVersion = 3;
  assert.equal(await sessions.validateSession(payload, { touch: false }), null);
  binding.currentConfigVersion = 2; binding.version = 2;
  assert.equal(await sessions.validateSession(payload, { touch: false }), null);
  staff.activeBinding.mock.mockImplementation(async () => null);
  assert.equal(await sessions.validateSession(payload, { touch: false }), null);
});
