// 忆梦云团队开发
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
process.env.NODE_ENV = 'test';
const security = require('./src/services/migrationSecurity');

test('SSRF validator requires HTTPS 443, public pinned IP and exact DNS membership', async () => {
  const resolver = async () => [{ address: '203.0.113.20' }];
  assert.equal((await security.validateTarget('https://target.example/', '203.0.113.20', resolver)).url.hostname, 'target.example');
  await assert.rejects(security.validateTarget('http://target.example/', '203.0.113.20', resolver), /TARGET_URL_UNSAFE/);
  await assert.rejects(security.validateTarget('https://target.example:8443/', '203.0.113.20', resolver), /TARGET_URL_UNSAFE/);
  await assert.rejects(security.validateTarget('https://target.example/', '127.0.0.1', resolver), /TARGET_IP_UNSAFE/);
  await assert.rejects(security.validateTarget('https://target.example/', '203.0.113.21', resolver), /TARGET_DNS_PIN_MISMATCH/);
  await assert.rejects(security.validateTarget('https://target.example/', '203.0.113.20', async () => [{ address: '203.0.113.20' }, { address: '169.254.169.254' }]), /TARGET_DNS_PIN_MISMATCH/);
});

test('target URL is normalized to the HTTPS origin and rejects credentials or fragments', async () => {
  const resolver = async () => [{ address: '203.0.113.20' }];
  const normalized = await security.validateTarget(
    'https://target.example/some/path?from=admin',
    '203.0.113.20',
    resolver,
  );
  assert.equal(normalized.url.href, 'https://target.example/');
  await assert.rejects(
    security.validateTarget('https://user@target.example/', '203.0.113.20', resolver),
    /TARGET_URL_UNSAFE/,
  );
  await assert.rejects(
    security.validateTarget('https://target.example/#fragment', '203.0.113.20', resolver),
    /TARGET_URL_UNSAFE/,
  );
});

test('signed protocol binds method path timestamp nonce and body hash', () => {
  const secret = 'session-secret'; const timestamp = String(Date.now()); const nonce = 'abcdefghijklmnopqrstuv';
  const hash = security.bodyHash('{"ok":true}'); const signature = security.sign(secret, 'POST', '/chunk', timestamp, nonce, hash);
  assert.equal(signature, security.sign(secret, 'POST', '/chunk', timestamp, nonce, hash));
  assert.notEqual(signature, security.sign(secret, 'POST', '/chunk', timestamp, nonce, security.bodyHash('{"ok":false}')));
  assert.notEqual(signature, security.sign(secret, 'GET', '/chunk', timestamp, nonce, hash));
});

test('private and metadata addresses are rejected', () => {
  for (const ip of ['10.0.0.1', '172.16.0.1', '192.168.1.1', '127.0.0.1', '169.254.169.254', '100.100.100.200', '::1', 'fe80::1', 'fc00::1']) assert.equal(security.isPublicIp(ip), false, ip);
  assert.equal(security.isPublicIp('8.8.8.8'), true);
});

test('migration routes keep control plane visible and gate mutations with super-admin step-up', () => {
  const source = fs.readFileSync(path.join(__dirname, 'src/routes/migration.js'), 'utf8');
  assert.match(source, /router\.use\('\/admin', authAdmin, requireSuperAdmin\)/);
  assert.match(source, /get\('\/admin\/settings'/);
  assert.match(source, /get\('\/admin\/status'/);
  assert.match(source, /get\('\/admin\/capability'/);
  assert.match(source, /get\('\/admin\/overview'/);
  assert.match(source, /settings\/enable', strictLimiter, originGuard, requirePassword/);
  assert.match(source, /settings\/disable', strictLimiter, originGuard, requirePassword/);
  assert.match(source, /requireMigrationExecution/);
  assert.match(source, /requireMigrationSwitch/);
  assert.doesNotMatch(source, /router\.use\(\(req, res, next\)/);
});

test('migration origin guard strictly validates configured and trusted-proxy HTTPS origins', () => {
  const config = require('./src/config');
  const { originGuard } = require('./src/middleware/migrationAdmin');
  const original = config.admin.publicOrigins;
  config.admin.publicOrigins = ['https://admin.example.com'];
  const run = ({ origin, referer, forwardedHost, forwardedProto, trusted = false }) => {
    let status = 200; let body; let passed = false;
    const headers = { 'content-type': 'application/json' };
    if (origin !== undefined) headers.origin = origin;
    if (referer !== undefined) headers.referer = referer;
    if (forwardedHost !== undefined) headers['x-forwarded-host'] = forwardedHost;
    if (forwardedProto !== undefined) headers['x-forwarded-proto'] = forwardedProto;
    const req = { headers, socket: { remoteAddress: trusted ? '172.20.0.2' : '203.0.113.7' }, app: { get: key => key === 'trust proxy fn' ? (() => trusted) : undefined } };
    const res = { locals: {}, status(value) { status = value; return this; }, json(value) { body = value; return value; } };
    originGuard(req, res, () => { passed = true; });
    return { status, body, passed };
  };
  try {
    assert.equal(run({ origin: 'https://admin.example.com' }).passed, true);
    assert.equal(run({ origin: 'https://admin.example.com/' }).passed, true);
    for (const origin of ['http://admin.example.com', 'https://evil.admin.example.com', 'https://admin.example.com.evil', 'https://user@admin.example.com', 'https://admin.example.com:444', 'https://admin.example.com,https://evil.test']) {
      assert.equal(run({ origin }).body.code, 4038, origin);
    }
    assert.equal(run({ referer: 'https://admin.example.com/data-migration?tab=security' }).passed, true);
    assert.equal(run({ referer: 'https://admin.example.com.evil/data-migration' }).body.code, 4038);
    assert.equal(run({ referer: 'https://user@admin.example.com/data-migration' }).body.code, 4038);
    assert.equal(run({ referer: 'https://admin.example.com:444/data-migration' }).body.code, 4038);
    assert.equal(run({ referer: 'https://admin.example.com/data,https://evil.test' }).body.code, 4038);
    assert.equal(run({}).body.code, 4038);
    assert.equal(run({ origin: 'https://proxy-admin.example', forwardedHost: 'proxy-admin.example', forwardedProto: 'https', trusted: false }).body.code, 4038);
    assert.equal(run({ origin: 'https://proxy-admin.example', forwardedHost: 'proxy-admin.example', forwardedProto: 'https', trusted: true }).passed, true);
    assert.equal(run({ origin: 'https://proxy-admin.example', forwardedHost: 'proxy-admin.example,evil.test', forwardedProto: 'https', trusted: true }).body.code, 4038);
  } finally {
    config.admin.publicOrigins = original;
  }
});

test('migration feature uses a strict business DB singleton and deployment permission ceiling', () => {
  const model = fs.readFileSync(path.join(__dirname, 'src/models/MigrationSetting.js'), 'utf8');
  const feature = fs.readFileSync(path.join(__dirname, 'src/services/migrationFeature.js'), 'utf8');
  const config = fs.readFileSync(path.join(__dirname, 'src/config/index.js'), 'utf8');
  assert.match(model, /singletonKey: \{ type: String, default: 'migration-feature', unique: true/);
  assert.match(model, /updatedFromIp/);
  assert.match(model, /updatedUserAgent/);
  assert.match(config, /MIGRATION_FEATURE_AVAILABLE/);
  assert.match(feature, /MIGRATION_DATA_PLANE_ENABLED=false/);
  assert.match(feature, /MIGRATION_ACTIVE_POINTER_ENABLED=true/);
  assert.match(feature, /UNSAFE_DISABLE_STATES/);
  assert.match(feature, /MIGRATION_DISABLE_UNSAFE/);
});

test('disabled management stays readable while dangerous execution fails closed', async () => {
  const feature = require('./src/services/migrationFeature');
  const settingModel = require('./src/models/MigrationSetting');
  const config = require('./src/config');
  const originalGet = settingModel.getSingleton;
  const originalValues = {
    featureAvailable: config.migration.featureAvailable,
    dataPlaneEnabled: config.migration.dataPlaneEnabled,
    activePointerEnabled: config.migration.activePointerEnabled,
    masterKeyExplicit: config.migration.masterKeyExplicit,
  };
  settingModel.getSingleton = async () => ({ enabled: false, version: 1 });
  Object.assign(config.migration, {
    featureAvailable: true,
    dataPlaneEnabled: false,
    activePointerEnabled: false,
    masterKeyExplicit: false,
  });
  try {
    const status = await feature.status();
    assert.equal(status.enabled, false);
    assert.equal(status.featureAvailable, true);
    assert.ok(status.executionBlockers.some(item => item.includes('MIGRATION_DATA_PLANE_ENABLED=false')));
    await assert.rejects(
      feature.assertExecutionEnabled(),
      error => error.message === 'MIGRATION_MANAGEMENT_DISABLED'
        && error.blockers.some(item => item.includes('管理员尚未')),
    );
  } finally {
    settingModel.getSingleton = originalGet;
    Object.assign(config.migration, originalValues);
  }
});

test('unsafe active task prevents disabling the management feature', async () => {
  const feature = require('./src/services/migrationFeature');
  const settingModel = require('./src/models/MigrationSetting');
  const taskModel = require('./src/models/MigrationTask');
  const control = require('./src/services/migrationControl');
  const config = require('./src/config');
  const originalGet = settingModel.getSingleton;
  const originalFind = taskModel.findOne;
  const originalConnection = control.getConnection;
  const originalDataPlane = config.migration.dataPlaneEnabled;
  settingModel.getSingleton = async () => ({ enabled: true, version: 2 });
  control.getConnection = () => ({ db: {}, readyState: 1 });
  config.migration.dataPlaneEnabled = true;
  taskModel.findOne = () => {
    const query = {
      select() { return query; },
      async lean() { return { taskId: 'unsafe-task', state: 'switching' }; },
    };
    return query;
  };
  try {
    await assert.rejects(
      feature.setEnabled({ admin: {}, headers: {} }, false),
      error => error.message === 'MIGRATION_DISABLE_UNSAFE'
        && error.task.state === 'switching',
    );
  } finally {
    settingModel.getSingleton = originalGet;
    taskModel.findOne = originalFind;
    control.getConnection = originalConnection;
    config.migration.dataPlaneEnabled = originalDataPlane;
  }
});

test('coverage explicitly classifies production business and security collections', () => {
  const service = require('./src/services/migrationService');
  for (const name of ['agents', 'roles', 'service_links', 'merchant_users']) {
    assert.ok(service.BUSINESS_ALLOWLIST.includes(name), name);
  }
  for (const name of [
    'platform_admins', 'tenant_user_sessions', 'customer_sessions',
    'tenant_user_login_keys', 'wechat_auth_challenges',
    'wechat_notification_outbox', 'integration_nonces',
    'integrationnonces', 'integrationbinding_archives', 'refresh_tokens',
    'merchant_refresh_tokens', 'audit_logs',
  ]) {
    assert.ok(service.EXCLUDED.includes(name), name);
  }
  assert.ok(service.ENCRYPTED_RESET.includes('wechat_official_accounts'));
});

test('collection policy remains fail-closed for future unknown collections', async () => {
  const service = require('./src/services/migrationService');
  const db = {
    listCollections() {
      return {
        async toArray() {
          return [
            { name: 'messages' },
            { name: 'refresh_tokens' },
            { name: 'future_unclassified_collection' },
          ];
        },
      };
    },
  };

  await assert.rejects(
    service.assertCollectionPolicy(db),
    error => error.message === 'MIGRATION_UNKNOWN_COLLECTIONS'
      && error.collections.includes('future_unclassified_collection'),
  );
});

test('maintenance middleware blocks writes but keeps reads', async () => {
  const SystemConfig = require('./src/models/SystemConfig'); const original = SystemConfig.get;
  SystemConfig.get = async () => true; delete require.cache[require.resolve('./src/services/maintenanceService')]; const maintenance = require('./src/services/maintenanceService');
  let status; const res = { locals: {}, status(value) { status = value; return this; }, set() { return this; }, json(value) { return value; } }; let next = false;
  await maintenance.middleware({ method: 'POST' }, res, () => { next = true; }); assert.equal(status, 503); assert.equal(next, false);
  await maintenance.middleware({ method: 'GET' }, res, () => { next = true; }); assert.equal(next, true); SystemConfig.get = original;
});

test('worker is fail-closed and never falls back to collection copy', () => {
  const source = fs.readFileSync(path.join(__dirname, 'src/services/migrationWorker.js'), 'utf8');
  assert.match(source, /CAPABILITY_LOST/); assert.doesNotMatch(source, /insertMany|bulkWrite|copyTo/);
  assert.match(source, /setFrozen\(false\)/);
  assert.match(source, /if \(!config\.migration\.dataPlaneEnabled && !config\.migration\.activePointerEnabled\) return;/);
  const routes = fs.readFileSync(path.join(__dirname, 'src/routes/migration.js'), 'utf8');
  assert.doesNotMatch(routes, /router\.use\(\(req, res, next\)/);
  assert.match(routes, /requireMigrationExecution/);
});

test('upload traversal protection rejects symbolic and hard links and keeps paths rooted', () => {
  const source = fs.readFileSync(path.join(__dirname, 'src/services/migrationData.js'), 'utf8');
  assert.match(source, /isSymbolicLink\(\)/);
  assert.match(source, /UPLOAD_HARDLINK_UNSAFE/);
  assert.match(source, /path\.relative\(resolvedRoot, full\)/);
});

test('signed request rejects body tampering and persists nonce before accepting', async () => {
  const MigrationNonce = require('./src/models/MigrationNonce');
  const originalCreate = MigrationNonce.create;
  const seen = new Set();
  MigrationNonce.create = async ({ taskId, nonce }) => {
    const key = `${taskId}:${nonce}`;
    if (seen.has(key)) {
      const error = new Error('duplicate');
      error.code = 11000;
      throw error;
    }
    seen.add(key);
  };

  try {
    const secret = 'short-lived-session-secret';
    const taskId = 'task-1';
    const rawBody = JSON.stringify({ chunk: 1 });
    const headers = security.requestHeaders(
      secret,
      taskId,
      'POST',
      '/api/migration/data/chunk',
      rawBody,
    );
    const request = {
      method: 'POST',
      originalUrl: '/api/migration/data/chunk?part=1',
      headers,
      rawBody,
    };

    await security.verifyRequest(request, secret);
    await assert.rejects(
      security.verifyRequest(request, secret),
      /MIGRATION_REPLAY/,
    );

    const tamperedHeaders = security.requestHeaders(
      secret,
      'task-2',
      'POST',
      '/api/migration/data/chunk',
      rawBody,
    );
    await assert.rejects(
      security.verifyRequest({
        ...request,
        headers: tamperedHeaders,
        rawBody: JSON.stringify({ chunk: 2 }),
      }, secret),
      /MIGRATION_SIGNATURE_INVALID/,
    );
  } finally {
    MigrationNonce.create = originalCreate;
  }
});

test('stream request verifies signed headers before body and commits nonce after matching body hash', async () => {
  const MigrationNonce = require('./src/models/MigrationNonce');
  const originalCreate = MigrationNonce.create;
  let persisted = false;
  MigrationNonce.create = async () => { persisted = true; };
  try {
    const secret = 'stream-session-secret';
    const taskId = 'stream-task';
    const pathName = '/api/migration/data/chunks/database/0';
    const body = Buffer.from('encrypted-stream-body');
    const headers = security.requestHeaders(secret, taskId, 'PUT', pathName, '', security.bodyHash(body));
    const req = { method: 'PUT', originalUrl: pathName, headers };
    const verified = security.verifyRequestHeaders(req, secret);
    assert.equal(persisted, false);
    await assert.rejects(security.commitRequest(req, verified, security.bodyHash('tampered')), /MIGRATION_SIGNATURE_INVALID/);
    assert.equal(persisted, false);
    await security.commitRequest(req, verified, security.bodyHash(body));
    assert.equal(persisted, true);
  } finally {
    MigrationNonce.create = originalCreate;
  }
});

test('stream request rejects a persisted replay before receiving the body', async () => {
  const MigrationNonce = require('./src/models/MigrationNonce');
  const originalExists = MigrationNonce.exists;
  MigrationNonce.exists = async () => ({ _id: 'persisted' });

  try {
    await assert.rejects(
      security.assertRequestFresh({ taskId: 'task-1', nonce: 'abcdefghijklmnopqrstuv' }),
      /MIGRATION_REPLAY/,
    );
  } finally {
    MigrationNonce.exists = originalExists;
  }
});

test('signed request rejects expired timestamps before nonce persistence', async () => {
  const MigrationNonce = require('./src/models/MigrationNonce');
  const originalCreate = MigrationNonce.create;
  let persisted = false;
  MigrationNonce.create = async () => { persisted = true; };

  try {
    const secret = 'short-lived-session-secret';
    const rawBody = '{}';
    const pathName = '/api/migration/data/manifest';
    const timestamp = String(Date.now() - 120000);
    const nonce = 'abcdefghijklmnopqrstuv';
    const hash = security.bodyHash(rawBody);
    const headers = {
      'x-migration-task': 'task-expired',
      'x-migration-timestamp': timestamp,
      'x-migration-nonce': nonce,
      'x-migration-body-sha256': hash,
      'x-migration-signature': security.sign(
        secret,
        'POST',
        pathName,
        timestamp,
        nonce,
        hash,
      ),
    };

    await assert.rejects(
      security.verifyRequest({
        method: 'POST',
        originalUrl: pathName,
        headers,
        rawBody,
      }, secret),
      /MIGRATION_SIGNATURE_EXPIRED/,
    );
    assert.equal(persisted, false);
  } finally {
    MigrationNonce.create = originalCreate;
  }
});

test('session secret derivation is bound to both instances and handshake nonce', () => {
  const base = security.deriveSessionSecret(
    'grant-key',
    'source-a',
    'target-a',
    'nonce-a',
  );
  assert.notEqual(
    base,
    security.deriveSessionSecret(
      'grant-key',
      'source-b',
      'target-a',
      'nonce-a',
    ),
  );
  assert.notEqual(
    base,
    security.deriveSessionSecret(
      'grant-key',
      'source-a',
      'target-b',
      'nonce-a',
    ),
  );
  assert.notEqual(
    base,
    security.deriveSessionSecret(
      'grant-key',
      'source-a',
      'target-a',
      'nonce-b',
    ),
  );
});

test('worker cancellation releases write freeze without entering export', async () => {
  const maintenance = require('./src/services/maintenanceService');
  const originalSetFrozen = maintenance.setFrozen;
  const freezeCalls = [];
  maintenance.setFrozen = async value => { freezeCalls.push(value); };
  const worker = require('./src/services/migrationWorker');
  const task = {
    taskId: require('crypto').randomUUID(),
    state: 'freezing_source',
    cancelRequestedAt: new Date(),
    logs: [],
    async save() { return this; },
  };

  try {
    await worker.processTask(task);
    assert.equal(task.state, 'cancelled');
    assert.deepEqual(freezeCalls, [false]);
    assert.equal(task.logs.at(-1).stage, 'cancelled');
  } finally {
    maintenance.setFrozen = originalSetFrozen;
  }
});

test('docker deployment requires replica PRIMARY, isolated control DB and controlled restart contract', () => {
  const compose = fs.readFileSync(path.join(__dirname, '../docker-compose.yml'), 'utf8');
  const init = fs.readFileSync(path.join(__dirname, '../mongo-init.sh'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  assert.match(compose, /--replSet/);
  assert.match(compose, /--bind_ip_all/);
  assert.match(compose, /service_completed_successfully/);
  assert.match(compose, /restart: "on-failure:5"/);
  assert.match(compose, /MIGRATION_RESTART_EXIT_CODE: "75"/);
  assert.match(compose, /customer_service\?replicaSet=.*authSource=admin.*directConnection=true/);
  assert.match(compose, /customer_service_control\?replicaSet=.*authSource=admin.*directConnection=true/);
  assert.match(compose, /MIGRATION_ACTIVE_POINTER_ENABLED: \$\{MIGRATION_ACTIVE_POINTER_ENABLED:-false\}/);
  assert.match(compose, /MIGRATION_DATA_PLANE_ENABLED: \$\{MIGRATION_DATA_PLANE_ENABLED:-false\}/);
  assert.match(init, /replSetInitiate/);
  assert.match(init, /isWritablePrimary/);
  assert.match(init, /startTransaction/);
  assert.match(init, /writeConcern: \{ w: "majority"/);
  assert.match(init, /commitTransaction/);
  assert.match(app, /restartMode === 'docker'/);
  assert.match(app, /restartExitCode/);
  assert.doesNotMatch(compose, /docker\.sock/);
});

test('migration staging stays hidden on uploads device while backup and temp remain separate', () => {
  const compose = fs.readFileSync(path.join(__dirname, '../docker-compose.yml'), 'utf8');
  const runtime = fs.readFileSync(path.join(__dirname, 'src/services/migrationRuntime.js'), 'utf8');
  const dataSource = fs.readFileSync(path.join(__dirname, 'src/services/migrationData.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  assert.match(compose, /UPLOAD_DIR: \/app\/upload-generations\/active/);
  assert.match(compose, /MIGRATION_STAGING_DIR: \/app\/upload-generations\/\.migration-private\/staging/);
  assert.match(compose, /uploads_data:\/app\/upload-generations/);
  assert.doesNotMatch(compose, /uploads_data:\/app\/upload-generations\/active/);
  assert.match(runtime, /sameUploadDevice/);
  assert.match(runtime, /uploadStat\.dev === stagingStat\.dev/);
  assert.match(runtime, /stagingNestedInActive/);
  assert.match(runtime, /uploadMountRoot/);
  assert.match(runtime, /active uploads 是挂载根目录/);
  assert.match(dataSource, /entry\.name === '\.migration-private'/);
  assert.match(app, /\/uploads\/\.migration-private/);
  assert.match(app, /dotfiles: 'deny'/);
});

test('staging verified requires an independent capability-gated switch', () => {
  const runtime = fs.readFileSync(path.join(__dirname, 'src/services/migrationRuntime.js'), 'utf8');
  const target = fs.readFileSync(path.join(__dirname, 'src/services/migrationTarget.js'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, 'src/services/migrationWorker.js'), 'utf8');
  assert.match(runtime, /atomicDatabaseSwitch\s*=\s*switchBlockers\.length === 0/);
  assert.match(target, /DATABASE_SWITCH_NOT_ATOMIC/);
  assert.match(target, /commitSwitch/);
  assert.doesNotMatch(target, /renameCollection\(/);
  assert.match(worker, /task\.state = 'staging_verified'/);
  assert.doesNotMatch(worker.match(/state: \{ \$in: \[[^\]]+\]/)?.[0] || '', /staging_verified/);
});

test('active pointer checksum rejects tampering and database names stay isolated', () => {
  const control = require('./src/services/migrationControl');
  const pointer = {
    _id: 'active-database',
    version: control.POINTER_VERSION,
    activeDbName: 'customer_service',
    previousDbName: '',
    generation: 1,
    switchJournalId: '',
    state: 'active',
    updatedAt: new Date().toISOString(),
  };
  pointer.checksum = control.checksum(pointer);
  assert.equal(control.verify(pointer), pointer);
  assert.equal(control.uriForDb('mongodb://user:secret@mongo:27017/original?authSource=admin', 'next_db'), 'mongodb://user:secret@mongo:27017/next_db?authSource=admin');
  assert.throws(() => control.verify({ ...pointer, activeDbName: 'tampered' }), /ACTIVE_POINTER_CHECKSUM_INVALID/);
  assert.throws(() => control.uriForDb('mongodb://mongo:27017/original', '../unsafe'), /CONTROL_DB_NAME_INVALID/);
});

test('uploads journal recovery rolls forward after pointer commit', async () => {
  const control = require('./src/services/migrationControl');
  const present = new Set(['backup', 'staging']);
  const renames = [];
  const fsApi = {
    async rename(from, to) { assert.equal(present.has(from), true); assert.equal(present.has(to), false); present.delete(from); present.add(to); renames.push([from, to]); },
    async open() { return { async sync() {}, async close() {} }; },
  };
  let saved;
  const pointer = { generation: 2, switchJournal: { id: 'task', taskId: 'task', phase: 'db_verified', pointerCommitted: true, rollbackCommitted: false, uploads: { active: 'active', backup: 'backup', staging: 'staging' } } };
  const result = await control.recoverUploads(pointer, fsApi, value => present.has(value), async (generation, journal) => { saved = { generation, journal }; return { ...pointer, switchJournal: journal }; });
  assert.deepEqual(renames, [['staging', 'active']]);
  assert.deepEqual([...present].sort(), ['active', 'backup']);
  assert.equal(saved.generation, 2);
  assert.equal(saved.journal.phase, 'uploads_switched');
  assert.equal(result.pointer.switchJournal.halfSwitched, false);
});

test('uploads journal recovery restores old generation after rollback commit', async () => {
  const control = require('./src/services/migrationControl');
  const present = new Set(['active', 'backup']);
  const renames = [];
  const fsApi = {
    async rename(from, to) { assert.equal(present.has(from), true); assert.equal(present.has(to), false); present.delete(from); present.add(to); renames.push([from, to]); },
    async open() { return { async sync() {}, async close() {} }; },
  };
  const pointer = { generation: 3, switchJournal: { id: 'task', taskId: 'task', phase: 'rollback_pointer_committed', pointerCommitted: true, rollbackCommitted: true, uploads: { active: 'active', backup: 'backup', staging: 'staging' } } };
  const result = await control.recoverUploads(pointer, fsApi, value => present.has(value), async (_generation, journal) => ({ ...pointer, switchJournal: journal }));
  assert.deepEqual(renames, [['active', 'staging'], ['backup', 'active']]);
  assert.deepEqual([...present].sort(), ['active', 'staging']);
  assert.equal(result.pointer.switchJournal.phase, 'rolled_back');
});

test('uploads journal recovery persists every rollback rename boundary', async () => {
  const control = require('./src/services/migrationControl');
  const present = new Set(['active', 'backup']);
  const phases = [];
  const fsApi = {
    async rename(from, to) { present.delete(from); present.add(to); },
    async open() { return { async sync() {}, async close() {} }; },
  };
  let pointer = { generation: 3, switchJournal: { id: 'task', taskId: 'task', phase: 'rolling_back', pointerCommitted: true, rollbackCommitted: true, uploads: { active: 'active', backup: 'backup', staging: 'staging' } } };
  const result = await control.recoverUploads(pointer, fsApi, value => present.has(value), async (generation, journal) => {
    assert.equal(generation, 3);
    phases.push(journal.uploadStep);
    pointer = { ...pointer, switchJournal: journal };
    return pointer;
  });
  assert.deepEqual(phases, [
    'rollback_active_to_staging_pending',
    'rollback_active_to_staging_done',
    'rollback_backup_to_active_pending',
    'rollback_backup_to_active_done',
    'rollback_completed',
  ]);
  assert.equal(result.pointer.switchJournal.phase, 'rolled_back');
});

test('uploads journal recovery blocks cross-device rename and leaves a pending crash marker', async () => {
  const control = require('./src/services/migrationControl');
  const persisted = [];
  const fsApi = {
    async rename() { throw Object.assign(new Error('cross device'), { code: 'EXDEV' }); },
    async open() { throw new Error('directory fsync must not run'); },
  };
  let pointer = { generation: 2, switchJournal: { id: 'task', taskId: 'task', phase: 'db_verified', pointerCommitted: true, rollbackCommitted: false, uploads: { active: 'active', backup: 'backup', staging: 'staging' } } };
  await assert.rejects(control.recoverUploads(pointer, fsApi, value => value !== 'active', async (_generation, journal) => {
    persisted.push(journal.uploadStep);
    pointer = { ...pointer, switchJournal: journal };
    return pointer;
  }), /UPLOAD_RECOVERY_CROSS_DEVICE/);
  assert.deepEqual(persisted, ['recovery_staging_to_active_pending']);
});

test('uploads journal recovery fails closed on ambiguous directory state', async () => {
  const control = require('./src/services/migrationControl');
  const fsApi = { async rename() { throw new Error('unexpected rename'); }, async open() { return { async sync() {}, async close() {} }; } };
  const pointer = { generation: 2, switchJournal: { phase: 'db_verified', pointerCommitted: true, rollbackCommitted: false, uploads: { active: 'active', backup: 'backup', staging: 'staging' } } };
  await assert.rejects(control.recoverUploads(pointer, fsApi, () => true, async () => pointer), /UPLOAD_RECOVERY_FORWARD_INCONSISTENT/);
});

test('worker releases write freeze when execution capability disappears', async () => {
  const maintenance = require('./src/services/maintenanceService');
  const originalSetFrozen = maintenance.setFrozen;
  const freezeCalls = [];
  maintenance.setFrozen = async value => { freezeCalls.push(value); };
  const worker = require('./src/services/migrationWorker');
  const task = {
    taskId: 'task-capability-loss',
    state: 'freezing_source',
    logs: [],
    async save() { return this; },
  };

  try {
    await worker.processTask(task);
    assert.equal(task.state, 'failed');
    assert.deepEqual(freezeCalls, [true, false]);
    assert.match(task.safeError, /安全停止/);
  } finally {
    maintenance.setFrozen = originalSetFrozen;
  }
});

test('mongodump uses argument arrays, oplog and explicit source exclusions without logging URI', () => {
  const { MigrationRuntime, redactArgs } = require('./src/services/migrationRuntime');
  const uri = 'mongodb://user:secret@mongo:27017/customer_service?replicaSet=rs0';
  const runtime = new MigrationRuntime({ mongoUri: uri, platform: 'linux', allowReal: true });
  const args = runtime.dumpArgs('safe.archive', ['messages'], 'customer_service', {
    oplog: true,
    excluded: ['platform_admins'],
    existing: ['messages', 'platform_admins'],
  });
  assert.ok(args.includes('--oplog'));
  assert.ok(args.includes('customer_service.*'));
  assert.ok(args.includes('customer_service.platform_admins'));
  assert.equal(redactArgs(args).join(' ').includes('secret'), false);
  assert.equal(args.some(value => /[;&|`]/.test(value)), false);
});

test('AES-GCM chunks and encrypted manifest reject tampering', async () => {
  const os = require('os');
  const crypto = require('crypto');
  const data = require('./src/services/migrationData');
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'migration-gcm-'));
  const input = path.join(root, 'plain.bin');
  const encrypted = path.join(root, 'encrypted.bin');
  const output = path.join(root, 'output.bin');
  const taskId = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString('base64url');
  const content = Buffer.from('migration authenticated payload');
  await fs.promises.writeFile(input, content);
  const plainHash = data.sha256(content);

  try {
    const encryptedInfo = await data.encryptChunk(input, encrypted, { taskId, artifact: 'database', index: 0, secret, plainHash, plainSize: content.length });
    const bytes = await fs.promises.readFile(encrypted);
    bytes[0] ^= 0xff;
    await fs.promises.writeFile(encrypted, bytes);
    await assert.rejects(data.decryptChunk(encrypted, output, { taskId, artifact: 'database', index: 0, secret, nonce: encryptedInfo.nonce, plainHash, plainSize: content.length }), /CHUNK_GCM_INVALID/);

    const manifest = { taskId, protocol: data.PROTOCOL, value: 'signed' };
    const envelope = data.encryptManifest(manifest, secret);
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -2)}AA`;
    assert.throws(() => data.decryptManifest(envelope, taskId, secret), /MANIFEST_GCM_INVALID/);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('artifact chunks use random nonces and reject nonce reuse in manifests', async () => {
  const os = require('os');
  const crypto = require('crypto');
  const data = require('./src/services/migrationData');
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'migration-nonce-'));
  const input = path.join(root, 'plain.bin');
  const taskId = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString('base64url');
  await fs.promises.writeFile(input, Buffer.alloc(data.CHUNK_BYTES + 1, 7));

  try {
    const artifacts = await data.splitEncryptFile(input, root, { taskId, artifact: 'database', kind: 'database', secret });
    assert.equal(artifacts.length, 2);
    assert.notEqual(artifacts[0].nonce, artifacts[1].nonce);
    assert.equal(Buffer.from(artifacts[0].nonce, 'base64').length, 12);
    assert.equal(Buffer.from(artifacts[1].nonce, 'base64').length, 12);

    const manifest = {
      protocol: data.PROTOCOL, version: 1, taskId, sourceInstanceId: 'source', targetInstanceId: 'target',
      schemaVersion: '1.0.0', sourceDb: 'customer_service',
      consistency: { method: 'mongodump-oplog', readPreference: 'primary', replicaSetRequired: true },
      collections: ['messages'], excludedCollections: require('./src/services/migrationService').EXCLUDED,
      counts: { messages: 0 },
      indexes: { messages: [{ name: '_id_', key: { _id: 1 } }] },
      database: { size: data.CHUNK_BYTES + 1, sha256: 'c'.repeat(64) }, uploads: { files: [] },
      artifacts, totalBytes: artifacts.reduce((sum, item) => sum + item.size, 0),
    };
    manifest.manifestHash = data.manifestHash(manifest);
    assert.equal(data.validateManifest(manifest), manifest);

    manifest.artifacts[1].nonce = manifest.artifacts[0].nonce;
    manifest.manifestHash = data.manifestHash(manifest);
    assert.throws(() => data.validateManifest(manifest), /MANIFEST_NONCE_REUSE/);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('chunk store is idempotent and rejects replayed index with different bytes', async () => {
  const os = require('os');
  const crypto = require('crypto');
  const data = require('./src/services/migrationData');
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'migration-chunk-'));
  const taskId = crypto.randomUUID();
  const first = Buffer.from('first encrypted chunk');
  const second = Buffer.from('different replay data');

  try {
    const stored = await data.storeChunk(root, taskId, 'database', 0, first, data.sha256(first), first.length);
    assert.equal(stored.idempotent, false);
    const repeated = await data.storeChunk(root, taskId, 'database', 0, first, data.sha256(first), first.length);
    assert.equal(repeated.idempotent, true);
    await assert.rejects(data.storeChunk(root, taskId, 'database', 0, second, data.sha256(second), second.length), /CHUNK_CONFLICT/);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('split encryption creates authenticated chunks for empty files without plaintext temp files', async () => {
  const os = require('os');
  const crypto = require('crypto');
  const data = require('./src/services/migrationData');
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'migration-empty-'));
  const input = path.join(root, 'empty.bin');
  const taskId = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString('base64url');
  await fs.promises.writeFile(input, Buffer.alloc(0));
  try {
    const artifacts = await data.splitEncryptFile(input, root, { taskId, artifact: 'upload_0', kind: 'upload', path: 'empty.bin', secret });
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].plainSize, 0);
    assert.equal(artifacts[0].size, 16);
    assert.equal(Buffer.from(artifacts[0].nonce, 'base64').length, 12);
    const outgoing = path.join(data.taskRoot(root, taskId), 'outgoing', 'upload_0');
    assert.equal((await fs.promises.readdir(outgoing)).some(name => name.endsWith('.plain')), false);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('upload encryption verifies the opened file against the frozen manifest', async () => {
  const os = require('os');
  const crypto = require('crypto');
  const data = require('./src/services/migrationData');
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'migration-stable-upload-'));
  const input = path.join(root, 'upload.bin');
  const taskId = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString('base64url');
  await fs.promises.writeFile(input, Buffer.from('frozen upload'));
  const stat = await fs.promises.stat(input);
  const expectedFile = { size: stat.size, mtimeMs: stat.mtimeMs, sha256: data.sha256('different upload') };

  try {
    await assert.rejects(
      data.splitEncryptFile(input, root, { taskId, artifact: 'upload_0', kind: 'upload', path: 'upload.bin', expectedFile, secret }),
      /UPLOAD_CHANGED_DURING_FREEZE/,
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('upload encryption refuses a source path replaced by a link', async () => {
  const os = require('os');
  const crypto = require('crypto');
  const data = require('./src/services/migrationData');
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'migration-source-link-'));
  const uploads = path.join(root, 'uploads');
  const outside = path.join(root, 'outside.bin');
  const linked = path.join(uploads, 'linked.bin');
  const taskId = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString('base64url');
  await fs.promises.mkdir(uploads);
  await fs.promises.writeFile(outside, Buffer.from('outside'));

  try {
    try {
      await fs.promises.symlink(outside, linked);
    } catch (error) {
      if (['EPERM', 'EACCES'].includes(error.code)) return;
      throw error;
    }
    await assert.rejects(
      data.splitEncryptFile(linked, root, {
        taskId,
        artifact: 'upload_0',
        kind: 'upload',
        path: 'linked.bin',
        sourceRoot: uploads,
        secret,
      }),
      /UPLOAD_SPECIAL_FILE_UNSAFE|ELOOP/,
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('target backup snapshots frozen uploads without following links', async () => {
  const os = require('os');
  const data = require('./src/services/migrationData');
  const migration = require('./src/services/migrationService');
  const target = require('./src/services/migrationTarget');
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'migration-backup-upload-'));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'snapshot');
  await fs.promises.mkdir(path.join(source, 'nested'), { recursive: true });
  await fs.promises.writeFile(path.join(source, 'nested', 'file.bin'), Buffer.from('stable upload'));

  try {
    const manifest = await migration.uploadManifest(source);
    await target.snapshotUploads(source, destination, manifest);
    const copied = await data.hashFile(path.join(destination, 'nested', 'file.bin'));
    assert.equal(copied.sha256, manifest.files[0].sha256);
    assert.equal(copied.size, manifest.files[0].size);

    const linked = path.join(root, 'linked-source');
    await fs.promises.mkdir(linked);
    const outside = path.join(root, 'outside.bin');
    await fs.promises.writeFile(outside, Buffer.from('outside'));
    try {
      await fs.promises.symlink(outside, path.join(linked, 'link.bin'));
      await assert.rejects(
        migration.uploadManifest(linked),
        /UPLOAD_SPECIAL_FILE_UNSAFE|UPLOAD_REPARSE_UNSAFE/,
      );
    } catch (error) {
      if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
    }
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('backup manifest canonical hash rejects tampering', () => {
  const data = require('./src/services/migrationData');
  const target = require('./src/services/migrationTarget');
  const manifest = {
    id: 'backup-id',
    collections: ['platform_admins'],
    counts: { platform_admins: 1 },
    indexes: { platform_admins: [{ name: '_id_', key: { _id: 1 } }] },
    database: { size: 1, sha256: 'a'.repeat(64) },
    uploads: { files: [], count: 0, bytes: 0 },
    platformAdminFingerprint: 'b'.repeat(64),
  };
  manifest.manifestHash = data.manifestHash(manifest);
  assert.equal(target.validateBackupManifest(manifest), manifest);
  manifest.database.size = 2;
  assert.throws(() => target.validateBackupManifest(manifest), /BACKUP_MANIFEST_INVALID/);
});

test('decrypt group removes partial output when a later chunk fails', async () => {
  const os = require('os');
  const crypto = require('crypto');
  const data = require('./src/services/migrationData');
  const target = require('./src/services/migrationTarget');
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'migration-decrypt-group-'));
  const taskId = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString('base64url');
  const plain = path.join(root, 'plain.bin');
  await fs.promises.writeFile(plain, Buffer.alloc(data.CHUNK_BYTES + 1, 3));

  try {
    const artifacts = await data.splitEncryptFile(plain, root, {
      taskId,
      artifact: 'database',
      kind: 'database',
      secret,
    });
    const transferRoot = data.taskRoot(root, taskId);
    const chunks = path.join(transferRoot, 'chunks', 'database');
    await fs.promises.mkdir(chunks, { recursive: true });
    for (const item of artifacts) {
      await fs.promises.copyFile(
        path.join(transferRoot, 'outgoing', 'database', `${item.index}.bin`),
        path.join(chunks, `${item.index}.bin`),
      );
    }
    const bad = path.join(chunks, '1.bin');
    const bytes = await fs.promises.readFile(bad);
    bytes[0] ^= 0xff;
    await fs.promises.writeFile(bad, bytes);
    const output = path.join(root, 'restored.archive');
    await assert.rejects(
      target.decryptGroup(transferRoot, output, artifacts, secret, taskId),
      /CHUNK_GCM_INVALID/,
    );
    assert.equal(fs.existsSync(output), false);
    assert.equal(fs.existsSync(`${output}.1.part`), false);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('control collections and health probes never enter business migration data', () => {
  const service = require('./src/services/migrationService');
  for (const name of [
    'migration_settings',
    'migration_grants',
    'migration_tasks',
    'migration_nonces',
    'migration_health_probes',
  ]) assert.ok(service.EXCLUDED.includes(name), name);
});

test('cache cleanup is namespace-scoped and never flushes a shared Redis database', () => {
  const cacheSource = fs.readFileSync(path.join(__dirname, 'src/utils/cache.js'), 'utf8');
  const presenceSource = fs.readFileSync(path.join(__dirname, 'src/utils/presence.js'), 'utf8');
  assert.match(cacheSource, /SCAN/);
  assert.match(cacheSource, /\['DEL', \.\.\.keys\]/);
  assert.match(presenceSource, /presence:\*/);
  assert.doesNotMatch(`${cacheSource}\n${presenceSource}`, /flushDb|flushAll|FLUSHDB|FLUSHALL/);
});

test('one-click migration keeps destructive confirmation and signed overwrite authorization', () => {
  const controller = fs.readFileSync(path.join(__dirname, 'src/controllers/MigrationController.js'), 'utf8');
  const transfer = fs.readFileSync(path.join(__dirname, 'src/services/migrationTransfer.js'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, 'src/services/migrationWorker.js'), 'utf8');
  const view = fs.readFileSync(path.join(__dirname, '../admin-web/src/views/DataMigration.vue'), 'utf8');
  assert.match(controller, /目标站原数据将被覆盖/);
  assert.match(controller, /overwriteConfirmed !== true/);
  assert.match(controller, /authorize-overwrite/);
  assert.match(transfer, /async function authorizeOverwrite/);
  assert.match(transfer, /await authorize\(req\)/);
  assert.match(worker, /task\.autoSwitchRequested && cap\.atomicDatabaseSwitch/);
  assert.match(view, /startForm\.overwriteConfirmed/);
  assert.match(view, /目标站原数据将被覆盖/);
  assert.match(view, /\/migration\/admin\/preflight/);
  assert.match(view, /\/start`/);
});

test('admin migration UI exposes the three fields, one-click flow and resumable progress without internal environment details', () => {
  const view = fs.readFileSync(path.join(__dirname, '../admin-web/src/views/DataMigration.vue'), 'utf8');
  for (const text of ['目标站点地址', '迁移密钥', '目标服务器 IP', '开始迁移', '任务进度', '迁移完成']) {
    assert.match(view, new RegExp(text));
  }
  assert.match(view, /setInterval\(\(\) => load\(true\), 4000\)/);
  assert.match(view, /activeTask/);
  assert.match(view, /requestId/);
  for (const text of ['部署许可', 'kill switch', 'MIGRATION_DATA_PLANE_ENABLED', 'control DB', 'generation：', '执行在线切换']) {
    assert.doesNotMatch(view, new RegExp(text, 'i'));
  }
});

test('automatic rollback is forbidden after the new generation accepts business writes', () => {
  const control = fs.readFileSync(path.join(__dirname, 'src/services/migrationControl.js'), 'utf8');
  const target = fs.readFileSync(path.join(__dirname, 'src/services/migrationTarget.js'), 'utf8');
  const maintenance = fs.readFileSync(path.join(__dirname, 'src/services/maintenanceService.js'), 'utf8');
  assert.match(control, /businessWritesAcceptedAt/);
  assert.match(maintenance, /markBusinessWriteAccepted/);
  assert.match(target, /ROLLBACK_AFTER_BUSINESS_WRITES_FORBIDDEN/);
});

test('post-switch failure durably requests rollback before the next worker attempt', async () => {
  const worker = require('./src/services/migrationWorker');
  const control = require('./src/services/migrationControl');
  const originalReadPointer = control.readPointer;
  const originalUpdateJournal = control.updateJournal;
  let savedJournal;
  control.readPointer = async () => ({
    generation: 2,
    activeDbName: 'new_db',
    previousDbName: 'old_db',
    switchJournal: {
      id: 'failure-task',
      taskId: 'failure-task',
      phase: 'uploads_switched',
      pointerCommitted: true,
      rollbackCommitted: false,
    },
  });
  control.updateJournal = async (_generation, journal) => { savedJournal = journal; };
  const task = {
    taskId: 'failure-task',
    direction: 'target',
    state: 'restart_pending',
    journal: {
      id: 'failure-task', taskId: 'failure-task', phase: 'uploads_switched',
      pointerCommitted: true, rollbackCommitted: false,
    },
    logs: [],
    markModified() {},
    async save() { return this; },
  };

  try {
    await worker.processTask(task);
    assert.equal(task.state, 'rolling_back');
    assert.equal(savedJournal.phase, 'rolling_back');
    assert.equal(savedJournal.halfSwitched, true);
    assert.match(savedJournal.rollbackReason, /迁移执行失败/);
    assert.equal(task.finishedAt, null);
  } finally {
    control.readPointer = originalReadPointer;
    control.updateJournal = originalUpdateJournal;
  }
});

test('rollback guard enters non-retryable manual intervention and keeps writes frozen', async () => {
  const worker = require('./src/services/migrationWorker');
  const control = require('./src/services/migrationControl');
  const target = require('./src/services/migrationTarget');
  const maintenance = require('./src/services/maintenanceService');
  const originalReadPointer = control.readPointer;
  const originalUpdateJournal = control.updateJournal;
  const originalRollback = target.rollbackCompleted;
  const originalSetFrozen = maintenance.setFrozen;
  let rollbackCalled = false;
  let savedJournal = null;
  const freezeCalls = [];
  control.readPointer = async () => ({
    generation: 2,
    previousDbName: 'old_db',
    switchJournal: {
      taskId: 'manual-task',
      phase: 'completed',
      pointerCommitted: true,
      rollbackCommitted: false,
      businessWritesAcceptedAt: new Date().toISOString(),
    },
  });
  control.updateJournal = async (generation, journal) => {
    assert.equal(generation, 2);
    savedJournal = journal;
  };
  target.rollbackCompleted = async () => { rollbackCalled = true; };
  maintenance.setFrozen = async (value, taskId) => { freezeCalls.push([value, taskId]); };
  const task = {
    taskId: 'manual-task',
    direction: 'target',
    state: 'rolling_back',
    sessionSecretCipher: worker.sealSecret('session-secret', 'manual-task'),
    journal: { phase: 'rolling_back', pointerCommitted: true },
    logs: [],
    markModified() {},
    async save() { return this; },
  };

  try {
    await worker.processTask(task);
    assert.equal(rollbackCalled, false);
    assert.equal(task.state, 'manual_intervention');
    assert.equal(task.finishedAt, null);
    assert.equal(savedJournal.phase, 'manual_intervention');
    assert.equal(task.journal.phase, 'manual_intervention');
    assert.deepEqual(freezeCalls, [[true, 'manual-task']]);
    assert.match(task.safeError, /人工核对并合并/);
  } finally {
    control.readPointer = originalReadPointer;
    control.updateJournal = originalUpdateJournal;
    target.rollbackCompleted = originalRollback;
    maintenance.setFrozen = originalSetFrozen;
  }
});

test('manual intervention remains active and blocks another migration in the admin UI', () => {
  const service = require('./src/services/migrationService');
  const task = service.publicTask({
    state: 'manual_intervention',
    journal: {
      phase: 'completed',
      pointerCommitted: true,
      businessWritesAcceptedAt: new Date().toISOString(),
    },
  });
  const view = fs.readFileSync(path.join(__dirname, '../admin-web/src/views/DataMigration.vue'), 'utf8');
  assert.ok(service.ACTIVE.includes('manual_intervention'));
  assert.equal(task.journal.businessWritesAccepted, true);
  assert.match(view, /'manual_intervention'/);
  assert.match(view, /!activeTask\.value/);
  assert.match(view, /需要人工处理/);
});

test('manifest rejects out-of-order indexes and invalid encrypted offsets', () => {
  const crypto = require('crypto');
  const data = require('./src/services/migrationData');
  const artifact = {
    id: 'database', index: 1, total: 1, offset: 0, kind: 'database', nonce: crypto.randomBytes(12).toString('base64'), plainHash: 'a'.repeat(64),
    plainSize: 16, sha256: 'b'.repeat(64), size: 32,
  };
  const manifest = {
    protocol: data.PROTOCOL,
    version: 1,
    taskId: crypto.randomUUID(),
    sourceInstanceId: 'source',
    targetInstanceId: 'target',
    schemaVersion: '1.0.0',
    sourceDb: 'customer_service',
    consistency: { method: 'mongodump-oplog', readPreference: 'primary', replicaSetRequired: true },
    collections: ['messages'],
    excludedCollections: require('./src/services/migrationService').EXCLUDED,
    counts: { messages: 0 },
    indexes: { messages: [{ name: '_id_', key: { _id: 1 } }] },
    database: { size: 0, sha256: 'c'.repeat(64) },
    uploads: { files: [] },
    artifacts: [artifact],
    totalBytes: 32,
  };
  manifest.manifestHash = data.manifestHash(manifest);
  assert.throws(() => data.validateManifest(manifest), /MANIFEST_ARTIFACT_INVALID/);
  artifact.index = 0;
  artifact.offset = 10;
  manifest.manifestHash = data.manifestHash(manifest);
  assert.throws(() => data.validateManifest(manifest), /MANIFEST_ARTIFACT_INVALID/);
});
