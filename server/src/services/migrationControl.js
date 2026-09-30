// 忆梦云团队开发
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const config = require('../config');

const POINTER_ID = 'active-database';
const POINTER_VERSION = 2;
const SAFE_DB = /^[A-Za-z0-9_-]{1,63}$/;
const SAFE_JOURNAL = /^[A-Za-z0-9_-]{1,128}$/;
const HEARTBEAT_TTL_MS = 15000;
const TERMINAL_STATES = new Set(['active', 'completed', 'rolled_back']);
const FROZEN_PHASES = new Set(['prepared', 'quiesced', 'db_pointer_switched', 'db_verified', 'uploads_switched', 'sessions_revoked', 'rolling_back', 'manual_intervention']);
const controlConnection = mongoose.createConnection();
let opened = false;
let heartbeatTimer = null;
let watchTimer = null;
let runtime = null;
let localPointer = null;
let localFrozen = false;
let exitRequested = false;
let observedJournalId = '';
let businessWriteMarkedGeneration = 0;
let ioRef = null;
let drainHandler = async () => {};

function enabled() { return config.migration.activePointerEnabled === true; }
function controlEnabled() { return enabled() || config.migration.dataPlaneEnabled === true; }
function safeDbName(value) {
  const name = String(value || '');
  if (!SAFE_DB.test(name)) throw new Error('CONTROL_DB_NAME_INVALID');
  return name;
}
function safeJournalId(value) {
  const id = String(value || '');
  if (!SAFE_JOURNAL.test(id)) throw new Error('SWITCH_JOURNAL_ID_INVALID');
  return id;
}
function validOptionalDbName(value) { return value === '' || SAFE_DB.test(String(value || '')); }
function configuredDbName() {
  const parsed = new URL(config.mongo.uri);
  return safeDbName(decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0] || ''));
}
function uriForDb(uri, dbName) {
  const parsed = new URL(uri);
  parsed.pathname = `/${safeDbName(dbName)}`;
  return parsed.toString();
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(key => !['checksum', 'switchJournal'].includes(key)).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function checksum(pointer) {
  return crypto.createHmac('sha256', config.migration.masterKey).update(canonical(pointer)).digest('hex');
}
function signed(pointer) { return { ...pointer, checksum: checksum(pointer) }; }
function verify(pointer) {
  if (!pointer || pointer.version !== POINTER_VERSION || !SAFE_DB.test(pointer.activeDbName || '') || !validOptionalDbName(pointer.previousDbName) || !Number.isSafeInteger(pointer.generation) || pointer.generation < 1 || typeof pointer.state !== 'string' || !/^[a-f0-9]{64}$/.test(pointer.checksum || '')) throw new Error('ACTIVE_POINTER_INVALID');
  const expected = checksum(pointer);
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(pointer.checksum))) throw new Error('ACTIVE_POINTER_CHECKSUM_INVALID');
  if (pointer.activeDbName === config.migration.controlDbName || pointer.previousDbName === config.migration.controlDbName) throw new Error('ACTIVE_POINTER_CONTROL_DB_COLLISION');
  if (pointer.switchJournalId && !SAFE_JOURNAL.test(pointer.switchJournalId)) throw new Error('ACTIVE_POINTER_INVALID');
  return pointer;
}
function collection(name) {
  if (!opened || !controlConnection.db) throw new Error('CONTROL_DB_NOT_CONNECTED');
  return controlConnection.db.collection(name);
}
async function open() {
  if (opened) return controlConnection;
  if (!controlEnabled()) throw new Error('MIGRATION_CONTROL_DISABLED');
  if (!config.migration.masterKey || config.migration.masterKey.length < 32) throw new Error('MIGRATION_MASTER_KEY_TOO_SHORT');
  const initial = configuredDbName();
  safeDbName(config.migration.controlDbName);
  if (config.migration.controlDbName === initial) throw new Error('CONTROL_DB_MUST_BE_SEPARATE');
  await controlConnection.openUri(config.migration.controlUri, { dbName: config.migration.controlDbName, maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  opened = true;
  await controlConnection.db.command({ ping: 1 });
  const probeId = `majority-${crypto.randomUUID()}`;
  await collection('migration_control_probes').insertOne({ _id: probeId, checkedAt: new Date() }, { writeConcern: { w: 'majority', wtimeout: 10000 } });
  await collection('migration_control_probes').deleteOne({ _id: probeId }, { writeConcern: { w: 'majority', wtimeout: 10000 } });
  const existing = await collection('migration_active_pointer').findOne({ _id: POINTER_ID });
  if (!existing) {
    const bootstrap = signed({ _id: POINTER_ID, version: POINTER_VERSION, activeDbName: initial, previousDbName: '', generation: 1, switchJournalId: '', state: 'active', updatedAt: new Date().toISOString() });
    try { await collection('migration_active_pointer').insertOne(bootstrap, { writeConcern: { w: 'majority', wtimeout: 10000 } }); } catch (error) { if (error.code !== 11000) throw error; }
  } else if (existing.version !== POINTER_VERSION) {
    throw new Error('ACTIVE_POINTER_VERSION_UNSUPPORTED');
  }
  localPointer = await readPointer();
  return controlConnection;
}
function getConnection() { return controlConnection; }
async function readJournal(id) {
  if (!id) return null;
  return collection('migration_switch_journals').findOne({ _id: safeJournalId(id) });
}
async function readPointer() {
  if (!enabled()) return { activeDbName: configuredDbName(), previousDbName: '', generation: 1, switchJournalId: '', switchJournal: null, state: 'active', compatibilityMode: true };
  const pointer = verify(await collection('migration_active_pointer').findOne({ _id: POINTER_ID }));
  const journal = pointer.switchJournalId ? await readJournal(pointer.switchJournalId) : null;
  if (pointer.switchJournalId && !journal) throw new Error('SWITCH_JOURNAL_MISSING');
  return { ...pointer, switchJournal: journal };
}
async function replacePointer(expectedGeneration, mutate) {
  const current = await readPointer();
  if (current.compatibilityMode) throw new Error('MIGRATION_ACTIVE_POINTER_DISABLED');
  if (current.generation !== expectedGeneration) throw new Error('ACTIVE_POINTER_CAS_CONFLICT');
  const mutated = mutate({ ...current });
  delete mutated.switchJournal;
  const next = signed({ ...mutated, _id: POINTER_ID, version: POINTER_VERSION, updatedAt: new Date().toISOString() });
  verify(next);
  const { _id, ...storedFields } = next;
  const result = await collection('migration_active_pointer').findOneAndUpdate(
    { _id: POINTER_ID, generation: expectedGeneration, checksum: current.checksum },
    { $set: storedFields },
    { returnDocument: 'after', writeConcern: { w: 'majority', wtimeout: 10000 } },
  );
  const stored = result?.value || result;
  if (!stored || stored.generation !== next.generation || stored.checksum !== next.checksum) throw new Error('ACTIVE_POINTER_CAS_CONFLICT');
  const verified = verify(stored);
  observedJournalId = verified.switchJournalId || '';
  if (!localPointer || verified.generation === localPointer.generation) localPointer = { ...verified, switchJournal: await readJournal(verified.switchJournalId) };
  return { ...verified, switchJournal: await readJournal(verified.switchJournalId) };
}
function sanitizeJournal(journal) {
  const value = { ...journal };
  value.id = safeJournalId(value.id || value.taskId);
  value._id = value.id;
  delete value.secret;
  delete value.taskSecret;
  return value;
}
async function writeJournal(journal) {
  const value = sanitizeJournal(journal);
  value.updatedAt = new Date().toISOString();
  const { _id, ...stored } = value;
  await collection('migration_switch_journals').updateOne(
    { _id },
    { $set: stored, $setOnInsert: { createdAt: value.startedAt || value.updatedAt } },
    { upsert: true, writeConcern: { w: 'majority', wtimeout: 10000 } },
  );
  return value;
}
async function updateJournal(expectedGeneration, journal) {
  const value = await writeJournal(journal);
  return replacePointer(expectedGeneration, pointer => ({ ...pointer, switchJournalId: value.id, state: value.phase }));
}
async function markBusinessWriteAccepted() {
  if (!enabled() || !localPointer?.switchJournalId) return false;
  const generation = localPointer.generation;
  if (businessWriteMarkedGeneration === generation) return true;
  const journal = await readJournal(localPointer.switchJournalId);
  if (!journal || !['uploads_switched', 'sessions_revoked', 'completed'].includes(journal.phase)) return false;
  if (!journal.businessWritesAcceptedAt) {
    await writeJournal({
      ...journal,
      businessWritesAcceptedAt: new Date().toISOString(),
      businessWritesGeneration: generation,
    });
  }
  businessWriteMarkedGeneration = generation;
  return true;
}
async function commitSwitch(expectedGeneration, targetDbName, journal) {
  safeDbName(targetDbName);
  if (targetDbName === config.migration.controlDbName) throw new Error('CONTROL_DB_MUST_BE_SEPARATE');
  const value = await writeJournal({ ...journal, pointerCommitted: true, phase: 'db_pointer_switched' });
  return replacePointer(expectedGeneration, pointer => ({ ...pointer, activeDbName: targetDbName, previousDbName: pointer.activeDbName, generation: pointer.generation + 1, switchJournalId: value.id, state: value.phase }));
}
async function commitRollback(expectedGeneration, previousDbName, journal) {
  safeDbName(previousDbName);
  if (previousDbName === config.migration.controlDbName) throw new Error('CONTROL_DB_MUST_BE_SEPARATE');
  const value = await writeJournal({ ...journal, pointerCommitted: true, rollbackCommitted: true, phase: 'rolling_back' });
  return replacePointer(expectedGeneration, pointer => ({ ...pointer, activeDbName: previousDbName, previousDbName: pointer.activeDbName, generation: pointer.generation + 1, switchJournalId: value.id, state: value.phase }));
}
async function recoverUploads(pointer, fsApi = fs.promises, existsSync = fs.existsSync, persistJournal = updateJournal) {
  let journal = pointer.switchJournal;
  if (!journal?.uploads || ['completed', 'rolled_back', 'uploads_switched', 'sessions_revoked'].includes(journal.phase)) return { recovered: false, pointer };
  if (!journal.rollbackCommitted && journal.phase !== 'db_verified') return { recovered: false, pointer };
  const { active, backup, staging } = journal.uploads;
  const exists = value => Boolean(value && existsSync(value));
  const state = () => ({ active: exists(active), backup: exists(backup), staging: exists(staging) });
  const persist = async next => {
    journal = next;
    pointer = await persistJournal(pointer.generation, journal) || {
      ...pointer,
      state: journal.phase,
      switchJournal: journal,
    };
  };
  const rename = async (from, to, pendingStep, doneStep) => {
    await persist({ ...journal, halfSwitched: true, uploadStep: pendingStep });
    try {
      await fsApi.rename(from, to);
    } catch (error) {
      if (error.code === 'EXDEV') throw new Error('UPLOAD_RECOVERY_CROSS_DEVICE');
      throw error;
    }
    const handle = await fsApi.open(path.dirname(to), 'r');
    try { await handle.sync(); } finally { await handle.close(); }
    await persist({ ...journal, halfSwitched: true, uploadStep: doneStep });
  };
  if (!journal.pointerCommitted) {
    const current = state();
    if (!current.active && current.backup && current.staging) {
      await rename(backup, active, 'recovery_backup_to_active_pending', 'recovery_backup_to_active_done');
    }
    const final = state();
    if (!final.active || final.backup || !final.staging) throw new Error('UPLOAD_RECOVERY_PRECOMMIT_INCONSISTENT');
    await persist({ ...journal, phase: 'rolled_back', halfSwitched: false, uploadStep: 'recovery_completed', recoveredAt: new Date().toISOString() });
    return { recovered: true, pointer };
  }
  if (!journal.rollbackCommitted) {
    const current = state();
    if (!current.active && current.backup && current.staging) {
      await rename(staging, active, 'recovery_staging_to_active_pending', 'recovery_staging_to_active_done');
    }
    const final = state();
    if (!final.active || !final.backup || final.staging) throw new Error('UPLOAD_RECOVERY_FORWARD_INCONSISTENT');
    await persist({ ...journal, phase: 'uploads_switched', halfSwitched: false, uploadStep: 'recovery_completed', recoveredAt: new Date().toISOString() });
    return { recovered: true, pointer };
  }
  let current = state();
  if (current.active && current.backup && !current.staging) {
    await rename(active, staging, 'rollback_active_to_staging_pending', 'rollback_active_to_staging_done');
    current = state();
  }
  if (!current.active && current.backup && current.staging) {
    await rename(backup, active, 'rollback_backup_to_active_pending', 'rollback_backup_to_active_done');
  }
  const final = state();
  if (!final.active || final.backup || !final.staging) throw new Error('UPLOAD_RECOVERY_ROLLBACK_INCONSISTENT');
  await persist({ ...journal, phase: 'rolled_back', halfSwitched: false, uploadStep: 'rollback_completed', recoveredAt: new Date().toISOString() });
  return { recovered: true, pointer };
}
async function reconcileTask(pointer) {
  const journal = pointer.switchJournal;
  if (!journal?.taskId) return;
  let update = null;
  if (journal.phase === 'rolled_back') update = { state: 'rolled_back', percent: 100, restartRequired: false };
  else if (['db_pointer_switched', 'db_verified', 'uploads_switched', 'sessions_revoked'].includes(journal.phase)) update = { state: 'restart_pending', percent: 95, restartRequired: true };
  else if (journal.phase === 'rolling_back') update = { state: 'rolling_back', restartRequired: false };
  else if (journal.phase === 'manual_intervention') update = { state: 'manual_intervention', restartRequired: false, safeError: '新数据库已接受业务写入，自动回滚已阻断，需要人工核对并合并新旧数据库数据' };
  if (update) await collection('migration_tasks').updateOne({ taskId: journal.taskId, direction: 'target' }, { $set: { leaseOwner: '', leaseUntil: null, journal, safeError: '', ...update } }, { writeConcern: { w: 'majority', wtimeout: 10000 } });
}
async function bootstrapAndRecover() {
  await open();
  let pointer = await readPointer();
  const recovered = await recoverUploads(pointer);
  pointer = recovered.pointer;
  await reconcileTask(pointer);
  localPointer = pointer;
  localFrozen = Boolean(pointer.switchJournal && FROZEN_PHASES.has(pointer.switchJournal.phase));
  return pointer;
}
function activeMongoUri(pointer = localPointer) {
  if (!enabled()) return config.mongo.uri;
  return uriForDb(config.mongo.uri, verify(pointer).activeDbName);
}
function currentGeneration() { return localPointer?.generation || 1; }
function instanceId() { return config.migration.instanceId; }
async function heartbeat() {
  if (!enabled() || !opened || !localPointer) return;
  const now = new Date();
  await collection('migration_instances').updateOne({ _id: instanceId() }, { $set: { generation: localPointer.generation, activeDbName: localPointer.activeDbName, state: localFrozen ? 'quiesced' : 'active', journalId: observedJournalId || localPointer.switchJournalId || '', pid: process.pid, heartbeatAt: now, expiresAt: new Date(now.getTime() + HEARTBEAT_TTL_MS), restartMode: config.migration.restartMode } }, { upsert: true, writeConcern: { w: 'majority', wtimeout: 10000 } });
}
async function observe() {
  const pointer = await readPointer();
  const changed = localPointer && pointer.generation !== localPointer.generation;
  const journal = pointer.switchJournal;
  observedJournalId = pointer.switchJournalId || '';
  if (!changed) localPointer = pointer;
  if (journal && FROZEN_PHASES.has(journal.phase)) {
    localFrozen = true;
    ioRef?.emit('maintenance', { message: '系统正在执行数据库代际切换，请稍后重试' });
    ioRef?.disconnectSockets(true);
    await drainHandler();
    await heartbeat();
  }
  if (changed && !exitRequested) {
    localFrozen = true;
    await heartbeat().catch(() => {});
    exitRequested = true;
    await runtime?.requestExit?.('database-generation-changed');
  }
}
function startCoordinator(options = {}) {
  if (!enabled()) { localFrozen = false; return; }
  runtime = options;
  ioRef = options.io || null;
  drainHandler = options.waitForDrain || drainHandler;
  if (!heartbeatTimer) heartbeatTimer = setInterval(() => heartbeat().catch(error => console.error('[MigrationControl] heartbeat:', error.message)), 3000);
  if (!watchTimer) watchTimer = setInterval(() => observe().catch(error => { localFrozen = true; console.error('[MigrationControl] pointer watch:', error.message); }), 1000);
  heartbeatTimer.unref?.(); watchTimer.unref?.();
  heartbeat().catch(() => {});
}
function stopCoordinator() { clearInterval(heartbeatTimer); clearInterval(watchTimer); heartbeatTimer = null; watchTimer = null; }
async function close() { stopCoordinator(); if (!opened) return; await controlConnection.close(); opened = false; }
function setLocalFrozen(value) { localFrozen = Boolean(value); }
function isLocalFrozen() { return localFrozen; }
async function activeInstances() { return collection('migration_instances').find({ expiresAt: { $gt: new Date() } }).sort({ _id: 1 }).toArray(); }
async function waitForQuiesced(journalId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await activeInstances();
    if (rows.length === 1 && rows.every(row => row.state === 'quiesced' && row.journalId === journalId && row.generation === localPointer.generation)) return rows;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('MIGRATION_INSTANCES_NOT_QUIESCED');
}
async function capability() {
  const blockers = [];
  if (!enabled()) blockers.push('未设置 MIGRATION_ACTIVE_POINTER_ENABLED=true');
  if (!config.migration.replicaCountExplicit || config.migration.replicaCount !== 1) blockers.push('必须显式设置 INSTANCE_REPLICA_COUNT=1，当前安全切换不支持多副本');
  if (enabled()) { try { await open(); await readPointer(); } catch { blockers.push('control database 指针不可用或校验失败'); } }
  if (!['docker', 'systemd', 'orchestrator'].includes(config.migration.restartMode)) blockers.push('未配置受支持的 MIGRATION_RESTART_MODE');
  const instances = opened ? await activeInstances().catch(() => []) : [];
  if (enabled() && instances.length !== 1) blockers.push('必须且只能有一个健康的业务实例 heartbeat');
  if (!config.migration.masterKeyExplicit) blockers.push('未显式配置 MIGRATION_MASTER_KEY');
  return { ready: blockers.length === 0, enabled: enabled(), controlDbName: config.migration.controlDbName, restartMode: config.migration.restartMode, replicaCount: config.migration.replicaCount, instances: instances.map(row => ({ instanceId: row._id, generation: row.generation, state: row.state, heartbeatAt: row.heartbeatAt })), blockers };
}
module.exports = { POINTER_VERSION, enabled, controlEnabled, getConnection, open, close, readPointer, readJournal, writeJournal, replacePointer, updateJournal, markBusinessWriteAccepted, commitSwitch, commitRollback, recoverUploads, bootstrapAndRecover, activeMongoUri, currentGeneration, startCoordinator, stopCoordinator, setLocalFrozen, isLocalFrozen, activeInstances, waitForQuiesced, capability, configuredDbName, uriForDb, checksum, verify, TERMINAL_STATES };
