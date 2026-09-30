// 忆梦云团队开发
const test = require('node:test');
const assert = require('node:assert/strict');

const SystemConfig = require('./src/models/SystemConfig');
const platform = require('./src/services/extensionPlatformService');
const { requireSuperAdmin, requireTenantAdmin } = require('./src/middleware/auth');

const tenantA = '507f1f77bcf86cd799439201';
const tenantB = '507f1f77bcf86cd799439202';

function response() {
  return {
    locals: {},
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('extension catalog exposes Jingpro and WeChat with backward-compatible defaults', async t => {
  t.mock.method(SystemConfig, 'get', async (_key, fallback) => fallback);
  const items = await platform.listPlatformExtensions();
  assert.deepEqual(items.map(item => item.provider), ['jingpro', 'wechat_official']);
  for (const item of items) {
    assert.equal(item.enabled, true);
    assert.equal(item.scopeMode, 'all');
    assert.deepEqual(item.tenantIds, []);
  }
});

test('selected tenant scope is persisted, normalized and enforced fail-closed', async t => {
  let stored;
  t.mock.method(SystemConfig, 'get', async (_key, fallback) => stored || fallback);
  t.mock.method(SystemConfig, 'set', async (_key, value) => { stored = value; return value; });

  const setting = await platform.setPlatformControl('wechat_official', {
    enabled: true,
    scopeMode: 'selected',
    tenantIds: [tenantA, tenantA, 'invalid'],
  });
  assert.deepEqual(setting.tenantIds, [tenantA]);
  assert.equal(platform.tenantAllowed(setting, tenantA), true);
  assert.equal(platform.tenantAllowed(setting, tenantB), false);
  await assert.rejects(
    platform.assertPlatformEnabled('wechat_official', tenantB),
    error => error.code === 'TENANT_NOT_AUTHORIZED' && error.status === 403,
  );

  stored = { ...stored, enabled: false };
  await assert.rejects(
    platform.assertPlatformEnabled('wechat_official', tenantA),
    error => error.code === 'PLATFORM_DISABLED' && error.status === 403,
  );
});

test('platform controls require super admin and tenant configuration requires owner/admin', () => {
  for (const admin of [null, { role: 'ops' }]) {
    const res = response();
    let nextCalled = false;
    requireSuperAdmin({ admin }, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, admin ? 403 : 401);
  }
  let nextCalled = false;
  requireSuperAdmin({ admin: { role: 'super' } }, response(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  for (const role of ['owner', 'admin']) {
    nextCalled = false;
    requireTenantAdmin({ user: { role } }, response(), () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  }
  const denied = response();
  requireTenantAdmin({ user: { role: 'agent' } }, denied, () => assert.fail('agent must not configure extensions'));
  assert.equal(denied.statusCode, 403);
});
