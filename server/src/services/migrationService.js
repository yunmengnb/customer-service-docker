// 忆梦云团队开发
const crypto = require('crypto');
const mongoose = require('mongoose');
const SystemConfig = require('../models/SystemConfig');
const MigrationTask = require('../models/MigrationTask');
const version = require('../config/version');
const { PROTOCOL_VERSION } = require('./migrationSecurity');
const { MigrationRuntime } = require('./migrationRuntime');
const migrationControl = require('./migrationControl');
const data = require('./migrationData');

const UPLOAD_DIR = require('path').resolve(process.env.UPLOAD_DIR || require('path').resolve(__dirname, '..', '..', 'uploads'));
const BUSINESS_ALLOWLIST = Object.freeze([
  'agents', 'announcements', 'app_versions', 'channels', 'complaints', 'conversation_attachments', 'conversations',
  'customer_accounts', 'customers', 'integrationbindings', 'keyword_replies', 'messages', 'quick_replies',
  'merchant_users', 'roles', 'service_links', 'system_settings', 'tenant_integrations', 'tenant_point_transactions', 'tenant_users', 'tenants',
  'wechat_followers', 'wechat_identity_bindings', 'wechat_notification_links', 'wechat_official_accounts',
]);
const EXCLUDED = Object.freeze([
  'platform_admins', 'system_configs', 'migration_settings', 'migration_grants', 'migration_tasks', 'migration_nonces',
  'tenant_user_sessions', 'customer_sessions', 'tenant_user_login_keys', 'wechat_auth_challenges',
  'wechat_callback_receipts', 'wechat_notification_outbox', 'wechat_notification_delivery_logs',
  'integration_nonces', 'integrationnonces', 'integrationbinding_archives', 'refresh_tokens',
  'merchant_refresh_tokens', 'audit_logs', 'migration_health_probes',
]);
const ENCRYPTED_RESET = Object.freeze(['wechat_official_accounts', 'tenant_integrations', 'integrationbindings']);
const RESET_PLAN = Object.freeze([
  { collection: 'wechat_official_accounts', fields: ['credentialCipher'], action: 'disable-and-reconfigure' },
  { collection: 'tenant_integrations', fields: ['platformSecret'], action: 'disable-and-reconfigure' },
  { collection: 'integrationbindings', fields: ['publicToken'], action: 'disable-and-reconfigure' },
]);
const ACTIVE = ['preflight', 'awaiting_confirmation', 'freezing_source', 'exporting', 'transferring', 'target_backup', 'importing_staging', 'verifying', 'staging_verified', 'quiescing', 'switching', 'restart_pending', 'rolling_back', 'manual_intervention'];
async function instanceId() {
  const db = migrationControl.getConnection().db;
  if (!db) throw new Error('CONTROL_DB_NOT_CONNECTED');
  const collection = db.collection('migration_identity');
  const existing = await collection.findOne({ _id: 'deployment' });
  if (existing?.instanceId) return String(existing.instanceId);
  const value = crypto.randomUUID();
  await collection.updateOne(
    { _id: 'deployment' },
    { $setOnInsert: { instanceId: value, createdAt: new Date() } },
    { upsert: true, writeConcern: { w: 'majority' } },
  );
  return String((await collection.findOne({ _id: 'deployment' })).instanceId);
}
async function instanceName() { return String(await SystemConfig.get('site_name', '忆梦云客服')); }
async function existingCollections(db = mongoose.connection.db) { const rows = await db.listCollections({}, { nameOnly: true }).toArray(); return rows.map(row => row.name).sort(); }
async function collections(db = mongoose.connection.db) { const existing = new Set(await existingCollections(db)); return BUSINESS_ALLOWLIST.filter(name => existing.has(name)); }
async function assertCollectionPolicy(db = mongoose.connection.db) { const existing = await existingCollections(db); const unknown = existing.filter(name => !name.startsWith('system.') && !BUSINESS_ALLOWLIST.includes(name) && !EXCLUDED.includes(name)); if (unknown.length) { const error = new Error('MIGRATION_UNKNOWN_COLLECTIONS'); error.collections = unknown; throw error; } return collections(db); }
async function uploadManifest(root = UPLOAD_DIR) { const files = await data.walkUploads(root); return { files, count: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0) }; }
async function uploadSummary(root = UPLOAD_DIR) {
  const manifest = await uploadManifest(root);
  return { files: manifest.count, bytes: manifest.bytes };
}
async function databaseSummary(runtime, names) {
  const counts = {};
  let bytes = 0;
  for (const name of names) {
    counts[name] = await runtime.db.collection(name).estimatedDocumentCount();
    const stats = await runtime.db.command({ collStats: name, scale: 1 })
      .catch(() => null);
    bytes += Number(stats?.storageSize || stats?.size || 0);
    bytes += Number(stats?.totalIndexSize || 0);
  }
  return { counts, bytes };
}
async function capabilities(options = {}) {
  const runtime = options.runtime || new MigrationRuntime();
  const uploads = options.uploads || await uploadSummary(runtime.uploadDir)
    .catch(() => ({
      files: 0,
      bytes: 0,
      error: '上传目录包含特殊文件、发生变化或无法读取',
    }));
  let policyError = null;
  let databaseBytes = Number(options.databaseBytes) || 0;
  try {
    const names = await assertCollectionPolicy(runtime.db);
    if (!options.databaseBytes) {
      databaseBytes = (await databaseSummary(runtime, names)).bytes;
    }
  } catch (error) {
    policyError = error;
  }
  const estimatedBytes = databaseBytes + (uploads.bytes || 0);
  const requiredFreeBytes = estimatedBytes * 4 + 256 * 1024 * 1024;
  const probe = await runtime.probe(requiredFreeBytes)
    .catch(() => ({
      ready: false,
      blockers: ['迁移运行时探测失败'],
    }));
  const blockers = [...(probe.blockers || [])];
  if (uploads.error) blockers.push(uploads.error);
  if (policyError) {
    blockers.push(
      `存在未纳入明确 allowlist 的集合：${
        (policyError.collections || []).join('、')
      }`,
    );
  }
  return {
    ...probe,
    ready: probe.ready && !uploads.error && !policyError,
    uploads,
    estimatedBytes,
    requiredFreeBytes,
    blockers,
  };
}
async function preflightSummary(options = {}) {
  const runtime = options.runtime || new MigrationRuntime();
  const names = await collections(runtime.db);
  const database = await databaseSummary(runtime, names);
  const uploads = await uploadSummary(runtime.uploadDir);
  const estimatedTransferBytes = database.bytes + uploads.bytes;
  const requiredFreeBytes = estimatedTransferBytes * 4
    + 256 * 1024 * 1024;
  const capability = await capabilities({
    runtime,
    uploads,
    databaseBytes: database.bytes,
  });
  return {
    protocolVersion: PROTOCOL_VERSION,
    dataProtocol: data.PROTOCOL,
    schemaVersion: version.version,
    instanceId: await instanceId(),
    instanceName: await instanceName(),
    includedCollections: names,
    allowlistPolicy: true,
    excludedCollections: EXCLUDED,
    encryptedCollectionsReset: ENCRYPTED_RESET,
    configResetPlan: RESET_PLAN,
    counts: database.counts,
    dataSize: {
      databaseBytes: database.bytes,
      uploadBytes: uploads.bytes,
      totalBytes: estimatedTransferBytes,
      requiredFreeBytes,
    },
    uploads,
    capability,
    consistency: {
      maintenanceDrain: true,
      method: 'mongodump-oplog',
      mongoReadPreference: 'primary',
      replicaSetRequired: true,
    },
    preserveTargetPlatformAdmins: true,
    deploymentConfigPreserved: true,
  };
}
async function activeForTarget(targetInstanceId) { return MigrationTask.findOne({ targetInstanceId, state: { $in: ACTIVE } }).lean(); }
function publicTask(task) { const row = task?.toObject ? task.toObject() : { ...task }; const receivedChunkCount = Array.isArray(row.receivedChunks) ? row.receivedChunks.length : Number(row.receivedChunkCount) || 0; delete row.sessionSecretCipher; delete row.peerTokenCipher; delete row.peerTokenDigest; delete row.backupPath; delete row.transferPath; delete row.stagingDb; delete row.stagingUploads; delete row.receivedChunks; delete row.autoSwitchRequested; row.receivedChunkCount = receivedChunkCount; if (row.journal) row.journal = { id: row.journal.id, phase: row.journal.phase, completedSteps: row.journal.steps?.filter(step => step.status === 'done').map(step => step.name) || [], needsRestart: Boolean(row.journal.needsRestart), halfSwitched: Boolean(row.journal.halfSwitched), pointerCommitted: Boolean(row.journal.pointerCommitted), rollbackCommitted: Boolean(row.journal.rollbackCommitted), businessWritesAccepted: Boolean(row.journal.businessWritesAcceptedAt), backupId: row.journal.backupId, committedGeneration: row.journal.committedGeneration }; return row; }
module.exports = { BUSINESS_ALLOWLIST, EXCLUDED, ENCRYPTED_RESET, RESET_PLAN, ACTIVE, instanceId, instanceName, existingCollections, collections, assertCollectionPolicy, uploadManifest, uploadSummary, capabilities, preflightSummary, activeForTarget, publicTask, UPLOAD_DIR };
