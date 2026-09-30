// 忆梦云团队开发
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MigrationTask = require('../models/MigrationTask');
const PlatformAdmin = require('../models/PlatformAdmin');
const TenantUserSession = require('../models/TenantUserSession');
const CustomerSession = require('../models/CustomerSession');
const TenantUserLoginKey = require('../models/TenantUserLoginKey');
const WechatAuthChallenge = require('../models/WechatAuthChallenge');
const cache = require('../utils/cache');
const presence = require('../utils/presence');
const maintenance = require('./maintenanceService');
const migration = require('./migrationService');
const data = require('./migrationData');
const { MigrationRuntime, mongoDbName } = require('./migrationRuntime');
const migrationControl = require('./migrationControl');

function step(journal, name, detail = {}) { journal.steps ||= []; let row = journal.steps.find(item => item.name === name); if (!row) { row = { name, status: 'pending', detail }; journal.steps.push(row); } return row; }
async function persist(task, journal) { task.journal = journal; task.markModified?.('journal'); await task.save(); }
async function collectionExists(runtime, dbName, collection) { return (await runtime.client.db(dbName).listCollections({ name: collection }, { nameOnly: true }).toArray()).length > 0; }
async function stepState(runtime, row) {
  if (row.type === 'dirRename') return { from: fs.existsSync(row.from), to: fs.existsSync(row.to) };
  throw new Error('JOURNAL_STEP_INVALID');
}
async function runStep(task, runtime, journal, name, action) {
  const row = step(journal, name);
  if (row.status === 'done') return;
  if (['running', 'failed'].includes(row.status)) {
    const reality = await stepState(runtime, row);
    if (!reality.from && reality.to) { row.status = 'done'; row.recoveredAt = new Date(); await persist(task, journal); return; }
    if (reality.from === reality.to) throw new Error('JOURNAL_STATE_AMBIGUOUS');
  }
  row.status = 'running'; delete row.error; await persist(task, journal);
  try { await action(row); row.status = 'done'; row.doneAt = new Date(); await persist(task, journal); } catch (error) { row.status = 'failed'; row.error = error.code || error.message; await persist(task, journal); throw error; }
}
async function reverseSteps(task, runtime, journal) {
  journal.phase = 'rolling_back'; await persist(task, journal);
  for (const row of [...(journal.steps || [])].reverse()) {
    if (row.undoneAt || !['done', 'running', 'failed'].includes(row.status)) continue;
    const reality = await stepState(runtime, row);
    if (reality.from && !reality.to) { row.undoneAt = new Date(); await persist(task, journal); continue; }
    if (reality.from === reality.to) throw new Error('ROLLBACK_STATE_AMBIGUOUS');
    await fs.promises.rename(row.to, row.from);
    await runtime.fsyncDir(path.dirname(row.from));
    row.undoneAt = new Date(); await persist(task, journal);
  }
  journal.halfSwitched = false; journal.phase = 'rolled_back'; await persist(task, journal);
}
async function resetSensitive(db) {
  const has = async name => (await db.listCollections(
    { name },
    { nameOnly: true },
  ).toArray()).length > 0;
  if (await has('wechat_official_accounts')) {
    await db.collection('wechat_official_accounts').updateMany({}, {
      $set: {
        enabled: false,
        bindingEnabled: false,
        loginEnabled: false,
        notificationEnabled: false,
        status: 'disabled',
        credentialCipher: {},
        lastCredentialResult: 'reconfigure_required',
      },
    });
    if (await db.collection('wechat_official_accounts').findOne({
      $or: [
        { enabled: { $ne: false } },
        { bindingEnabled: { $ne: false } },
        { loginEnabled: { $ne: false } },
        { notificationEnabled: { $ne: false } },
        { status: { $ne: 'disabled' } },
        { credentialCipher: { $ne: {} } },
        { lastCredentialResult: { $ne: 'reconfigure_required' } },
      ],
    })) throw new Error('SENSITIVE_RESET_VERIFY_FAILED');
  }
  if (await has('tenant_integrations')) {
    await db.collection('tenant_integrations').updateMany({}, {
      $set: { enabled: false, status: 'disabled', platformSecret: '' },
    });
    if (await db.collection('tenant_integrations').findOne({
      $or: [
        { enabled: { $ne: false } },
        { status: { $ne: 'disabled' } },
        { platformSecret: { $ne: '' } },
      ],
    })) throw new Error('SENSITIVE_RESET_VERIFY_FAILED');
  }
  if (await has('integrationbindings')) {
    await db.collection('integrationbindings').updateMany({}, {
      $set: {
        publicToken: '',
        link: '',
        meta: { reconfigureRequired: true },
      },
    });
    if (await db.collection('integrationbindings').findOne({
      $or: [
        { publicToken: { $ne: '' } },
        { link: { $ne: '' } },
        { 'meta.reconfigureRequired': { $ne: true } },
      ],
    })) throw new Error('SENSITIVE_RESET_VERIFY_FAILED');
  }
}
function normalizeIndexes(indexes) {
  return indexes.map(index => ({
    name: index.name,
    key: index.key,
    unique: Boolean(index.unique),
    sparse: Boolean(index.sparse),
    ...(index.expireAfterSeconds === undefined
      ? {}
      : { expireAfterSeconds: index.expireAfterSeconds }),
    ...(index.partialFilterExpression
      ? { partialFilterExpression: index.partialFilterExpression }
      : {}),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

async function collectionSnapshot(db, names) {
  const counts = {};
  const indexes = {};
  for (const name of names) {
    counts[name] = await db.collection(name).countDocuments();
    indexes[name] = normalizeIndexes(await db.collection(name).indexes());
  }
  return { counts, indexes };
}

async function verifyDatabaseSnapshot(db, manifest, code) {
  for (const name of manifest.collections) {
    const [count, indexes] = await Promise.all([
      db.collection(name).countDocuments(),
      db.collection(name).indexes(),
    ]);
    if (
      count !== manifest.counts[name]
      || data.canonicalJson(normalizeIndexes(indexes))
        !== data.canonicalJson(manifest.indexes[name])
    ) {
      throw new Error(code);
    }
  }
}

async function assertSafeParentPath(root, relative) {
  const parts = data.safeRelative(relative).split('/');
  let current = path.resolve(root);
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    const stat = await fs.promises.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('BACKUP_UPLOAD_PATH_UNSAFE');
    }
  }
}

async function copyFrozenUpload(sourceRoot, targetRoot, expected) {
  const relative = data.safeRelative(expected.path);
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const resolvedTargetRoot = path.resolve(targetRoot);
  await assertSafeParentPath(resolvedSourceRoot, relative);
  const source = path.resolve(resolvedSourceRoot, relative);
  const target = path.resolve(resolvedTargetRoot, relative);
  if (!source.startsWith(`${resolvedSourceRoot}${path.sep}`)
    || !target.startsWith(`${resolvedTargetRoot}${path.sep}`)) {
    throw new Error('BACKUP_UPLOAD_PATH_UNSAFE');
  }
  await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.promises.chmod(path.dirname(target), 0o700);
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const input = await fs.promises.open(source, fs.constants.O_RDONLY | noFollow);
  let output;
  try {
    const before = await input.stat();
    if (
      !before.isFile()
      || before.nlink !== 1
      || before.size !== expected.size
      || before.mtimeMs !== expected.mtimeMs
    ) {
      throw new Error('BACKUP_UPLOAD_CHANGED');
    }
    output = await fs.promises.open(target, 'wx', 0o600);
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < before.size) {
      const { bytesRead } = await input.read(
        buffer,
        0,
        Math.min(buffer.length, before.size - position),
        position,
      );
      if (!bytesRead) throw new Error('BACKUP_UPLOAD_CHANGED');
      hash.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        const result = await output.write(
          buffer,
          written,
          bytesRead - written,
          position + written,
        );
        if (!result.bytesWritten) throw new Error('BACKUP_UPLOAD_WRITE_FAILED');
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
    await output.sync();
    const after = await input.stat();
    if (
      after.dev !== before.dev
      || after.ino !== before.ino
      || after.nlink !== 1
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || position !== before.size
      || hash.digest('hex') !== expected.sha256
    ) {
      throw new Error('BACKUP_UPLOAD_CHANGED');
    }
  } catch (error) {
    await fs.promises.rm(target, { force: true }).catch(() => {});
    throw error;
  } finally {
    await output?.close().catch(() => {});
    await input.close();
  }
}

async function snapshotUploads(sourceRoot, targetRoot, uploadManifest) {
  await fs.promises.mkdir(targetRoot, { recursive: false, mode: 0o700 });
  await fs.promises.chmod(targetRoot, 0o700);
  for (const file of uploadManifest.files) {
    await copyFrozenUpload(sourceRoot, targetRoot, file);
  }
  const copied = await migration.uploadManifest(targetRoot);
  const compact = value => value.files.map(({ path: filePath, size, sha256 }) => ({
    path: filePath,
    size,
    sha256,
  }));
  if (
    copied.count !== uploadManifest.count
    || copied.bytes !== uploadManifest.bytes
    || data.canonicalJson(compact(copied))
      !== data.canonicalJson(compact(uploadManifest))
  ) {
    throw new Error('BACKUP_UPLOAD_VERIFY_FAILED');
  }
  return copied;
}

function hashPlatformAdmins(rows) {
  if (!rows.some(row => row.role === 'super' && row.status === 'active')) {
    throw new Error('PLATFORM_ADMIN_MISSING');
  }
  return crypto.createHash('sha256').update(data.canonicalJson(rows.map(row => ({
    id: String(row._id),
    password: row.password,
    role: row.role,
    status: row.status,
  })))).digest('hex');
}

async function platformAdminFingerprint() {
  const rows = await PlatformAdmin.find()
    .select('+password')
    .sort({ _id: 1 })
    .lean();
  return hashPlatformAdmins(rows);
}

async function databaseAdminFingerprint(db) {
  const rows = await db.collection('platform_admins')
    .find({}, { projection: { password: 1, role: 1, status: 1 } })
    .sort({ _id: 1 })
    .toArray();
  return hashPlatformAdmins(rows);
}

function validateBackupManifest(manifest) {
  if (
    !manifest
    || !Array.isArray(manifest.collections)
    || !manifest.collections.includes('platform_admins')
    || !manifest.counts
    || !manifest.indexes
    || !manifest.database
    || !manifest.uploads
    || !manifest.platformAdminFingerprint
    || !/^[a-f0-9]{64}$/.test(String(manifest.manifestHash || ''))
    || data.manifestHash(manifest) !== manifest.manifestHash
  ) {
    throw new Error('BACKUP_MANIFEST_INVALID');
  }
  return manifest;
}

async function verifyPlatformAdmins(expected) {
  const actual = await platformAdminFingerprint();
  if (!expected || actual !== expected) {
    throw new Error('PLATFORM_ADMIN_CHANGED');
  }
}
async function revokeSessions(io) {
  const now = new Date();
  await Promise.all([
    TenantUserSession.updateMany({ revokedAt: null }, { $set: { revokedAt: now, revokeReason: 'migration_switch' } }),
    CustomerSession.updateMany({ revokedAt: null }, { $set: { revokedAt: now, revokeReason: 'migration_switch' } }),
    TenantUserLoginKey.updateMany({ revokedAt: null }, { $set: { revokedAt: now } }),
    WechatAuthChallenge.updateMany({ state: { $in: ['pending', 'scanned', 'oauth_verified', 'confirmed'] } }, { $set: { state: 'cancelled', expiresAt: now } }),
  ]);
  await cache.clearNamespaces([
    'captcha:', 'email-code:', 'customer:', 'config:', 'replies:',
    'integration:', 'nonce:', 'jti:',
  ]);
  await presence.clearAll();
  if (io) {
    io.emit('maintenance', { message: '数据迁移切换完成，请重新登录' });
    io.disconnectSockets(true);
  } else maintenance.disconnectAll('数据迁移切换完成，请重新登录');
}
async function backupTarget(task, runtime = new MigrationRuntime()) {
  const capability = await runtime.probe((task.bytesTotal || 0) * 4);
  if (!capability.ready) throw new Error('CAPABILITY_LOST');
  const adminFingerprint = await platformAdminFingerprint();
  const id = `${task.taskId}-${Date.now()}`;
  const root = path.join(runtime.backupDir, id);
  const verifyDb = `migration_verify_${task.taskId.replace(/-/g, '')}`;
  await runtime.ensurePrivateDir(root);
  try {
    const names = [...await migration.collections(runtime.db), 'platform_admins'];
    const existing = await migration.existingCollections(runtime.db);
    const selected = names.filter(name => existing.includes(name));
    const snapshot = await collectionSnapshot(runtime.db, selected);
    const archive = path.join(root, 'database.archive.gz');
    await runtime.dump(archive, selected, {
      oplog: true,
      excluded: existing.filter(name => !selected.includes(name)),
      existing,
    });
    const archiveInfo = await data.hashFile(archive);
    const uploads = await migration.uploadManifest(runtime.uploadDir);
    const uploadSnapshot = path.join(root, 'uploads');
    await snapshotUploads(runtime.uploadDir, uploadSnapshot, uploads);

    await runtime.client.db(verifyDb).dropDatabase().catch(() => {});
    await runtime.restore(archive, verifyDb, mongoDbName(runtime.mongoUri), selected);
    const verify = runtime.client.db(verifyDb);
    await verifyDatabaseSnapshot(verify, {
      collections: selected,
      ...snapshot,
    }, 'BACKUP_DATABASE_VERIFY_FAILED');
    if (await databaseAdminFingerprint(verify) !== adminFingerprint) {
      throw new Error('BACKUP_PLATFORM_ADMIN_VERIFY_FAILED');
    }
    await verifyPlatformAdmins(adminFingerprint);

    const manifest = {
      id,
      createdAt: new Date().toISOString(),
      collections: selected,
      counts: snapshot.counts,
      indexes: snapshot.indexes,
      database: archiveInfo,
      uploads,
      targetInstanceId: task.targetInstanceId,
      platformAdminFingerprint: adminFingerprint,
      verifiedByRestore: true,
    };
    manifest.manifestHash = data.manifestHash(manifest);
    await fs.promises.writeFile(
      path.join(root, 'manifest.json'),
      data.canonicalJson(manifest),
      { mode: 0o600, flag: 'wx' },
    );
    task.backupId = id;
    task.backupPath = root;
    task.markModified?.('backupPath');
    await task.save();
    return manifest;
  } catch (error) {
    await data.secureRemove(root);
    throw error;
  } finally {
    await runtime.client.db(verifyDb).dropDatabase().catch(() => {});
  }
}
async function decryptGroup(root, output, items, secret, taskId) {
  await fs.promises.mkdir(path.dirname(output), {
    recursive: true,
    mode: 0o700,
  });
  const handle = await fs.promises.open(output, 'wx', 0o600);
  let currentPart = null;
  let complete = false;
  let outputPosition = 0;
  try {
    for (const item of [...items].sort((a, b) => a.index - b.index)) {
      currentPart = `${output}.${item.index}.part`;
      await data.decryptChunk(
        path.join(root, 'chunks', item.id, `${item.index}.bin`),
        currentPart,
        { ...item, artifact: item.id, secret, taskId },
      );
      const input = await fs.promises.open(currentPart, 'r');
      try {
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let partPosition = 0;
        while (partPosition < item.plainSize) {
          const { bytesRead } = await input.read(
            buffer,
            0,
            Math.min(buffer.length, item.plainSize - partPosition),
            partPosition,
          );
          if (!bytesRead) throw new Error('DECRYPTED_PART_TRUNCATED');
          let written = 0;
          while (written < bytesRead) {
            const result = await handle.write(
              buffer,
              written,
              bytesRead - written,
              outputPosition + written,
            );
            if (!result.bytesWritten) throw new Error('STAGING_WRITE_FAILED');
            written += result.bytesWritten;
          }
          partPosition += bytesRead;
          outputPosition += bytesRead;
        }
      } finally {
        await input.close();
      }
      await data.secureRemove(currentPart);
      currentPart = null;
    }
    await handle.sync();
    complete = true;
  } finally {
    await handle.close().catch(() => {});
    if (currentPart) await data.secureRemove(currentPart);
    if (!complete) await data.secureRemove(output);
  }
}
async function restoreStaging(task, secret, runtime = new MigrationRuntime()) {
  const manifest = data.validateManifest(task.manifest);
  const unexpected = manifest.collections.filter(name => !migration.BUSINESS_ALLOWLIST.includes(name));
  const missingExclusions = migration.EXCLUDED.filter(name => !manifest.excludedCollections?.includes(name));
  const extraExclusions = (manifest.excludedCollections || []).filter(name => !migration.EXCLUDED.includes(name));
  if (unexpected.length || missingExclusions.length || extraExclusions.length) {
    throw new Error('MANIFEST_COLLECTION_POLICY_INVALID');
  }
  if (!task.transferPath) throw new Error('TRANSFER_PATH_MISSING');
  const root = data.taskRoot(task.transferPath, task.taskId);
  const stagingRoot = path.join(runtime.stagingDir, task.taskId);
  const stagingDb = `migration_stage_${task.taskId.replace(/-/g, '')}`;
  const stage = runtime.client.db(stagingDb);
  await data.secureRemove(stagingRoot);
  await stage.dropDatabase().catch(() => {});
  await runtime.ensurePrivateDir(stagingRoot);
  try {
    const archiveArtifacts = manifest.artifacts.filter(item => item.kind === 'database');
    if (!archiveArtifacts.length) throw new Error('DATABASE_ARTIFACT_MISSING');
    const archive = path.join(stagingRoot, 'database.archive.gz');
    await decryptGroup(root, archive, archiveArtifacts, secret, task.taskId);
    const archiveInfo = await data.hashFile(archive);
    if (
      archiveInfo.sha256 !== manifest.database.sha256
      || archiveInfo.size !== manifest.database.size
    ) throw new Error('DATABASE_ARCHIVE_HASH_INVALID');
    await runtime.restore(archive, stagingDb, manifest.sourceDb, manifest.collections);

    const uploadRoot = path.join(stagingRoot, 'uploads');
    await runtime.ensurePrivateDir(uploadRoot);
    const groups = new Map();
    for (const item of manifest.artifacts.filter(row => row.kind === 'upload')) {
      const relative = data.safeRelative(item.path);
      if (!groups.has(relative)) groups.set(relative, []);
      groups.get(relative).push(item);
    }
    for (const [relative, items] of groups) {
      const output = path.join(uploadRoot, relative);
      if (!output.startsWith(`${uploadRoot}${path.sep}`)) {
        throw new Error('UPLOAD_PATH_UNSAFE');
      }
      await decryptGroup(root, output, items, secret, task.taskId);
    }

    const verifiedUploads = await migration.uploadManifest(uploadRoot);
    const compact = value => value.files.map(({ path: filePath, size, sha256 }) => ({
      path: filePath,
      size,
      sha256,
    }));
    if (
      verifiedUploads.count !== manifest.uploads.count
      || verifiedUploads.bytes !== manifest.uploads.bytes
      || data.canonicalJson(compact(verifiedUploads))
        !== data.canonicalJson(compact(manifest.uploads))
    ) throw new Error('STAGING_UPLOAD_VERIFY_FAILED');

    const stageCollections = await migration.existingCollections(stage);
    if (stageCollections.includes('platform_admins')) {
      throw new Error('STAGING_PLATFORM_ADMIN_FORBIDDEN');
    }
    if (stageCollections.some(name => migration.EXCLUDED.includes(name))) {
      throw new Error('STAGING_EXCLUDED_COLLECTION_PRESENT');
    }
    await resetSensitive(stage);
    await verifyDatabaseSnapshot(stage, manifest, 'STAGING_SCHEMA_MISMATCH');
    if (!task.backupPath) throw new Error('BACKUP_NOT_AVAILABLE');
    const backupManifest = validateBackupManifest(JSON.parse(
      await fs.promises.readFile(
        path.join(task.backupPath, 'manifest.json'),
        'utf8',
      ),
    ));
    await verifyPlatformAdmins(backupManifest.platformAdminFingerprint);
    const adminRows = await runtime.db.collection('platform_admins').find({}).toArray();
    if (!adminRows.length) throw new Error('PLATFORM_ADMIN_MISSING');
    await stage.collection('platform_admins').insertMany(adminRows);
    if (await databaseAdminFingerprint(stage) !== backupManifest.platformAdminFingerprint) {
      throw new Error('STAGING_PLATFORM_ADMIN_VERIFY_FAILED');
    }
    for (const name of [
      'tenant_user_sessions',
      'customer_sessions',
      'tenant_user_login_keys',
      'wechat_auth_challenges',
      'wechat_callback_receipts',
      'wechat_notification_outbox',
      'wechat_notification_delivery_logs',
      'integration_nonces',
      'integrationnonces',
      'integrationbinding_archives',
      'refresh_tokens',
      'merchant_refresh_tokens',
    ]) {
      await stage.collection(name).deleteMany({});
    }

    await data.secureRemove(archive);
    task.stagingDb = stagingDb;
    task.stagingUploads = uploadRoot;
    await task.save();
    return { stagingDb, uploadRoot };
  } catch (error) {
    await stage.dropDatabase().catch(() => {});
    await data.secureRemove(stagingRoot);
    throw error;
  }
}
async function switchToStaging(task, runtime = new MigrationRuntime(), io) {
  const capability = await runtime.probe();
  if (!capability.atomicDatabaseSwitch) throw new Error('DATABASE_SWITCH_NOT_ATOMIC');
  if (!task.stagingDb || !task.stagingUploads) throw new Error('STAGING_NOT_AVAILABLE');
  const pointer = await migrationControl.readPointer();
  if (pointer.activeDbName !== runtime.db.databaseName) {
    throw new Error('ACTIVE_POINTER_RUNTIME_MISMATCH');
  }
  const suffix = task.taskId.replace(/-/g, '').slice(0, 12);
  const uploadBackup = `${runtime.uploadDir}.migration-${suffix}`;
  const journal = {
    id: task.taskId,
    taskId: task.taskId,
    phase: 'prepared',
    halfSwitched: false,
    needsRestart: true,
    pointerCommitted: false,
    rollbackCommitted: false,
    sourceDbName: pointer.activeDbName,
    targetDbName: task.stagingDb,
    backupId: task.backupId,
    manifestHash: task.manifest?.manifestHash || '',
    uploadsManifestHash: data.manifestHash(task.manifest?.uploads || {}),
    sourceGeneration: pointer.generation,
    uploads: {
      active: runtime.uploadDir,
      backup: uploadBackup,
      staging: task.stagingUploads,
    },
    startedAt: new Date().toISOString(),
  };
  await migrationControl.updateJournal(pointer.generation, journal);
  task.journal = journal;
  task.markModified?.('journal');
  await task.save();
  maintenance.setProcessFrozen(true);
  await maintenance.waitForDrain();
  await migrationControl.waitForQuiesced(journal.id);
  await verifyDatabaseSnapshot(runtime.client.db(task.stagingDb), task.manifest, 'STAGING_SCHEMA_MISMATCH');
  journal.phase = 'quiesced';
  await migrationControl.updateJournal(pointer.generation, journal);
  await persist(task, journal);

  if (fs.existsSync(uploadBackup)) throw new Error('UPLOAD_BACKUP_ALREADY_EXISTS');
  const committed = await migrationControl.commitSwitch(
    pointer.generation,
    task.stagingDb,
    journal,
  );
  const switched = {
    ...journal,
    phase: 'db_pointer_switched',
    pointerCommitted: true,
    committedGeneration: committed.generation,
    pointerSwitchedAt: new Date().toISOString(),
  };
  await migrationControl.updateJournal(committed.generation, switched);
  await persist(task, switched);
}

async function switchUploads(task, runtime, pointer, sourceJournal) {
  let journal = { ...sourceJournal, phase: 'db_verified' };
  const uploads = journal.uploads || {};
  const persistBoth = async next => {
    journal = next;
    await migrationControl.updateJournal(pointer.generation, journal);
    await persist(task, journal);
  };

  if (!fs.existsSync(uploads.active) && !fs.existsSync(uploads.backup)) {
    throw new Error('UPLOAD_SWITCH_SOURCE_MISSING');
  }
  if (!fs.existsSync(uploads.staging) && !fs.existsSync(uploads.active)) {
    throw new Error('UPLOAD_SWITCH_STAGING_MISSING');
  }

  if (fs.existsSync(uploads.active) && !fs.existsSync(uploads.backup)) {
    await persistBoth({ ...journal, halfSwitched: true, uploadStep: 'active_to_backup_pending' });
    try {
      await fs.promises.rename(uploads.active, uploads.backup);
    } catch (error) {
      if (error.code === 'EXDEV') throw new Error('UPLOAD_SWITCH_CROSS_DEVICE');
      throw error;
    }
    await runtime.fsyncDir(path.dirname(uploads.active));
    await persistBoth({ ...journal, halfSwitched: true, uploadStep: 'active_to_backup_done' });
  }

  if (!fs.existsSync(uploads.active) && fs.existsSync(uploads.staging)) {
    await persistBoth({ ...journal, halfSwitched: true, uploadStep: 'staging_to_active_pending' });
    try {
      await fs.promises.rename(uploads.staging, uploads.active);
    } catch (error) {
      if (error.code === 'EXDEV') throw new Error('UPLOAD_SWITCH_CROSS_DEVICE');
      throw error;
    }
    await runtime.fsyncDir(path.dirname(uploads.active));
    await persistBoth({ ...journal, halfSwitched: true, uploadStep: 'staging_to_active_done' });
  }

  if (!fs.existsSync(uploads.active) || !fs.existsSync(uploads.backup) || fs.existsSync(uploads.staging)) {
    throw new Error('UPLOAD_SWITCH_INCONSISTENT');
  }
  const completed = {
    ...journal,
    phase: 'uploads_switched',
    halfSwitched: false,
    uploadStep: 'completed',
    uploadsSwitchedAt: new Date().toISOString(),
  };
  await persistBoth(completed);
  return completed;
}
async function rollbackCompleted(task, runtime = new MigrationRuntime()) {
  const pointer = await migrationControl.readPointer();
  const existing = pointer.switchJournal;
  if (!existing || existing.taskId !== task.taskId || !pointer.previousDbName) {
    throw new Error('ROLLBACK_NOT_AVAILABLE');
  }
  if (existing.businessWritesAcceptedAt) {
    throw new Error('ROLLBACK_AFTER_BUSINESS_WRITES_FORBIDDEN');
  }
  let journal = {
    ...existing,
    phase: 'rolling_back',
    halfSwitched: true,
    rollbackCommitted: false,
    rollbackStartedAt: new Date().toISOString(),
  };
  const persistBoth = async (generation, next) => {
    journal = next;
    await migrationControl.updateJournal(generation, journal);
    await persist(task, journal);
  };
  await persistBoth(pointer.generation, journal);
  maintenance.setProcessFrozen(true);
  await maintenance.waitForDrain();
  await migrationControl.waitForQuiesced(journal.id);

  const committed = await migrationControl.commitRollback(
    pointer.generation,
    pointer.previousDbName,
    journal,
  );
  journal = {
    ...journal,
    rollbackCommitted: true,
    committedGeneration: committed.generation,
    rollbackPointerSwitchedAt: new Date().toISOString(),
  };
  await persistBoth(committed.generation, journal);

  const uploads = journal.uploads || {};
  if (fs.existsSync(uploads.active) && !fs.existsSync(uploads.staging)) {
    await persistBoth(committed.generation, {
      ...journal,
      uploadStep: 'rollback_active_to_staging_pending',
    });
    try {
      await fs.promises.rename(uploads.active, uploads.staging);
    } catch (error) {
      if (error.code === 'EXDEV') throw new Error('UPLOAD_ROLLBACK_CROSS_DEVICE');
      throw error;
    }
    await runtime.fsyncDir(path.dirname(uploads.active));
    await persistBoth(committed.generation, {
      ...journal,
      uploadStep: 'rollback_active_to_staging_done',
    });
  }
  if (!fs.existsSync(uploads.active) && fs.existsSync(uploads.backup)) {
    await persistBoth(committed.generation, {
      ...journal,
      uploadStep: 'rollback_backup_to_active_pending',
    });
    try {
      await fs.promises.rename(uploads.backup, uploads.active);
    } catch (error) {
      if (error.code === 'EXDEV') throw new Error('UPLOAD_ROLLBACK_CROSS_DEVICE');
      throw error;
    }
    await runtime.fsyncDir(path.dirname(uploads.active));
    await persistBoth(committed.generation, {
      ...journal,
      uploadStep: 'rollback_backup_to_active_done',
    });
  }
  if (
    !fs.existsSync(uploads.active)
    || fs.existsSync(uploads.backup)
    || !fs.existsSync(uploads.staging)
  ) {
    throw new Error('UPLOAD_RECOVERY_ROLLBACK_INCONSISTENT');
  }
  await persistBoth(committed.generation, {
    ...journal,
    phase: 'rolled_back',
    rollbackCommitted: true,
    halfSwitched: false,
    uploadStep: 'rollback_completed',
    rolledBackAt: new Date().toISOString(),
  });
}
module.exports = {
  step,
  runStep,
  reverseSteps,
  resetSensitive,
  revokeSessions,
  backupTarget,
  restoreStaging,
  switchToStaging,
  switchUploads,
  rollbackCompleted,
  copyFrozenUpload,
  snapshotUploads,
  validateBackupManifest,
  decryptGroup,
};
