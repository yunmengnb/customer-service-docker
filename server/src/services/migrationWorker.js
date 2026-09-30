// 忆梦云团队开发
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MigrationTask = require('../models/MigrationTask');
const maintenance = require('./maintenanceService');
const config = require('../config');
const data = require('./migrationData');
const migration = require('./migrationService');
const target = require('./migrationTarget');
const security = require('./migrationSecurity');
const http = require('./migrationHttp');
const { MigrationRuntime, mongoDbName } = require('./migrationRuntime');
let timer = null; let running = false;
function key() { return crypto.createHash('sha256').update(`${config.jwt.secret}:migration-session`).digest(); }
function sealSecret(value, taskId) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv); cipher.setAAD(Buffer.from(taskId)); return { iv: iv.toString('base64'), data: Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64'), tag: cipher.getAuthTag().toString('base64') }; }
function unsealSecret(value, taskId) { const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(value.iv, 'base64')); decipher.setAAD(Buffer.from(taskId)); decipher.setAuthTag(Buffer.from(value.tag, 'base64')); return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8'); }
function safeFailure(err) { return ['CAPABILITY_LOST', 'WORKER_INTERRUPTED'].includes(err.code || err.message) ? '迁移运行能力已丢失，操作已安全停止' : `迁移执行失败：${String(err.code || err.message).replace(/[^A-Z0-9_:-]/gi, '').slice(0, 80)}`; }
async function claim() {
  const now = new Date(); const owner = `${process.pid}-${crypto.randomUUID()}`;
  return MigrationTask.findOneAndUpdate(
    {
      state: { $in: ['freezing_source', 'exporting', 'transferring', 'target_backup', 'importing_staging', 'verifying', 'quiescing', 'switching', 'restart_pending', 'rolling_back'] },
      $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }],
    },
    { $set: { leaseOwner: owner, leaseUntil: new Date(Date.now() + 30000) } },
    { new: true, sort: { updatedAt: 1 } },
  ).select('+sessionSecretCipher +peerTokenCipher +peerTokenDigest +backupPath +stagingDb +stagingUploads +receivedChunks +transferPath');
}
function endpoint(task, suffix) { return { url: new URL(task.targetOrigin), path: `/api/migration/data${suffix}` }; }
async function send(task, secret, token, method, suffix, body, extraHeaders = {}, bodyHash = '') {
  const ep = endpoint(task, suffix); const isStream = body && typeof body.pipe === 'function'; const raw = body === undefined ? Buffer.alloc(0) : Buffer.isBuffer(body) || isStream ? body : Buffer.from(JSON.stringify(body));
  const headers = { ...security.requestHeaders(secret, task.taskId, method, ep.path, isStream ? '' : raw, bodyHash), 'x-migration-token': token, ...extraHeaders };
  const response = await http.request(ep.url, task.targetIp, method, ep.path, raw, headers); if (response.status < 200 || response.status >= 300 || response.data.code !== 0) { const error = new Error(response.data.message || 'TARGET_REQUEST_FAILED'); error.code = response.data.message || 'TARGET_REQUEST_FAILED'; throw error; } return response.data.data;
}
async function buildPackage(task, runtime, secret) {
  const root = data.taskRoot(runtime.tempDir, task.taskId); await data.secureRemove(root); await runtime.ensurePrivateDir(root);
  try {
    const names = await migration.assertCollectionPolicy(runtime.db); const existing = await migration.existingCollections(runtime.db); const sourceDb = mongoDbName(runtime.mongoUri); const archive = path.join(root, 'source.archive.gz');
    let archiveHash; const artifacts = [];
    try {
      await runtime.dump(archive, names, { oplog: true, excluded: migration.EXCLUDED, existing });
      archiveHash = await data.hashFile(archive);
      artifacts.push(...await data.splitEncryptFile(archive, runtime.tempDir, { taskId: task.taskId, artifact: 'database', kind: 'database', secret }));
    } finally {
      await data.secureRemove(archive);
    }
    const uploads = await migration.uploadManifest(runtime.uploadDir); let uploadIndex = 0;
    for (const file of uploads.files) {
      artifacts.push(...await data.splitEncryptFile(path.join(runtime.uploadDir, file.path), runtime.tempDir, { taskId: task.taskId, artifact: `upload_${uploadIndex}`, kind: 'upload', path: file.path, expectedFile: file, sourceRoot: runtime.uploadDir, secret })); uploadIndex += 1;
    }
    const counts = {};
    const indexes = {};
    for (const name of names) {
      counts[name] = await runtime.db.collection(name).countDocuments();
      indexes[name] = (await runtime.db.collection(name).indexes())
        .map(index => ({
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
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    const manifest = {
      protocol: data.PROTOCOL,
      version: 1,
      taskId: task.taskId,
      schemaVersion: task.schemaVersion,
      sourceInstanceId: task.sourceInstanceId,
      targetInstanceId: task.targetInstanceId,
      sourceDb,
      consistency: {
        method: 'mongodump-oplog',
        readPreference: 'primary',
        replicaSetRequired: true,
      },
      collections: names,
      excludedCollections: migration.EXCLUDED,
      resetPlan: migration.RESET_PLAN,
      counts,
      indexes,
      database: archiveHash,
      uploads,
      artifacts,
      totalBytes: artifacts.reduce((sum, item) => sum + item.size, 0),
    };
    manifest.manifestHash = data.manifestHash(manifest);
    data.validateManifest(manifest); return { manifest, payload: { envelope: data.encryptManifest(manifest, secret), signature: data.signManifest(manifest, secret) } };
  } catch (error) {
    await data.secureRemove(root);
    throw error;
  }
}
async function processSource(task) {
  const runtime = new MigrationRuntime();
  if (task.cancelRequestedAt && !['switching', 'rolling_back'].includes(task.state)) {
    try { const secret = unsealSecret(task.sessionSecretCipher, task.taskId); const token = unsealSecret(task.peerTokenCipher, `${task.taskId}:token`); await send(task, secret, token, 'POST', '/abort', {}); } catch (_) {}
    await data.secureRemove(data.taskRoot(runtime.tempDir, task.taskId)); await maintenance.setFrozen(false); task.state = 'cancelled'; task.finishedAt = new Date(); task.logs.push({ stage: 'cancelled', message: '双方 staging 已请求清理，在线数据未覆盖' }); return task.save();
  }
  if (task.rollbackRequestedAt && ['switching', 'completed', 'rolling_back'].includes(task.state)) { const secret = unsealSecret(task.sessionSecretCipher, task.taskId); const token = unsealSecret(task.peerTokenCipher, `${task.taskId}:token`); await send(task, secret, token, 'POST', '/rollback', {}); task.state = 'rolling_back'; task.logs.push({ stage: 'rolling_back', message: '目标站已接受 journal 回滚请求' }); return task.save(); }
  if (task.state === 'freezing_source') { const cap = await runtime.probe(); await maintenance.setFrozen(true, task.taskId); if (!cap.ready) throw Object.assign(new Error('CAPABILITY_LOST'), { code: 'CAPABILITY_LOST' }); await maintenance.waitForDrain(); task.percent = 5; task.state = 'exporting'; task.logs.push({ stage: 'freezing_source', message: '源站 HTTP、Socket 与后台写入已冻结并完成排空' }); await task.save(); }
  const secret = unsealSecret(task.sessionSecretCipher, task.taskId); const token = unsealSecret(task.peerTokenCipher, `${task.taskId}:token`);
  if (task.state === 'exporting') { const packaged = await buildPackage(task, runtime, secret); task.manifest = packaged.manifest; task.bytesTotal = packaged.manifest.totalBytes; task.percent = 15; task.state = 'transferring'; await task.save(); await send(task, secret, token, 'POST', '/manifest', packaged.payload); }
  if (task.state === 'transferring') {
    const manifest = data.validateManifest(task.manifest);
    await send(task, secret, token, 'POST', '/manifest', {
      envelope: data.encryptManifest(manifest, secret),
      signature: data.signManifest(manifest, secret),
    });
    const remote = await send(task, secret, token, 'GET', '/status'); const received = new Set(remote.received || []);
    task.receivedChunkCount = received.size;
    task.bytesDone = manifest.artifacts.filter(item => received.has(`${item.id}:${item.index}`)).reduce((sum, item) => sum + item.size, 0);
    for (const item of manifest.artifacts) { if (received.has(`${item.id}:${item.index}`)) continue; const file = path.join(data.taskRoot(runtime.tempDir, task.taskId), 'outgoing', item.id, `${item.index}.bin`); await send(task, secret, token, 'PUT', `/chunks/${item.id}/${item.index}`, fs.createReadStream(file), { 'Content-Length': String(item.size), 'x-migration-offset': String(item.offset) }, item.sha256); received.add(`${item.id}:${item.index}`); task.receivedChunkCount = received.size; task.bytesDone += item.size; task.percent = Math.min(65, 15 + Math.floor(task.bytesDone / task.bytesTotal * 50)); await task.save(); }
    await send(task, secret, token, 'POST', '/finalize', {});
    const state = await send(task, secret, token, 'GET', '/status');
    task.percent = Math.max(task.percent, Number(state.percent) || 0);
    const stage = `target:${state.state}`;
    if (task.logs.at(-1)?.stage !== stage) task.logs.push({ stage, message: `目标阶段 ${state.state}（${state.percent || 0}%）` });
    if (state.state === 'completed') { task.state = 'completed'; task.percent = 100; task.finishedAt = new Date(); task.backupId = state.backupId || task.backupId; await maintenance.setFrozen(false); await data.secureRemove(data.taskRoot(runtime.tempDir, task.taskId)); return task.save(); }
    if (state.state === 'staging_verified') {
      task.state = 'failed';
      task.percent = 90;
      task.safeError = state.safeError || '目标站未能安全执行覆盖，原数据未改动';
      task.backupId = state.backupId || task.backupId;
      task.finishedAt = new Date();
      task.logs.push({ stage: 'failed', message: task.safeError });
      await maintenance.setFrozen(false);
      await data.secureRemove(data.taskRoot(runtime.tempDir, task.taskId));
      return task.save();
    }
    if (['failed', 'rolled_back', 'cancelled'].includes(state.state)) throw new Error(state.safeError || 'TARGET_MIGRATION_FAILED');
    await task.save();
  }
}
async function processTarget(task) {
  const runtime = new MigrationRuntime(); const secret = unsealSecret(task.sessionSecretCipher, task.taskId);
  if (task.state === 'rolling_back') {
    const control = require('./migrationControl');
    const controlPointer = await control.readPointer();
    const controlJournal = controlPointer.switchJournal?.taskId === task.taskId
      ? controlPointer.switchJournal
      : null;
    if (controlJournal) {
      task.journal = controlJournal;
      task.markModified?.('journal');
    }
    if (task.journal?.phase === 'rollback_uploads_committed' || task.journal?.rollbackCommitted) {
      task.state = 'restart_pending';
      task.percent = 95;
      task.restartRequired = true;
      await task.save();
      return;
    }
    if (task.journal?.pointerCommitted || task.journal?.phase === 'completed' || task.backupPath) {
      if (controlJournal?.businessWritesAcceptedAt) {
        throw new Error('ROLLBACK_AFTER_BUSINESS_WRITES_FORBIDDEN');
      }
      await target.rollbackCompleted(task, runtime);
      task.state = 'restart_pending';
      task.percent = 95;
      task.restartRequired = true;
      task.logs.push({ stage: 'restart_pending', message: '回滚指针已提交，等待所有业务实例重启并验证旧数据库代际' });
      await task.save();
      return;
    }
    await target.reverseSteps(task, runtime, task.journal || {});
    task.state = 'rolled_back';
    task.finishedAt = new Date();
    await task.save();
    await maintenance.setFrozen(false);
    return;
  }
  if (task.state === 'target_backup') { await maintenance.setFrozen(true, task.taskId); await maintenance.waitForDrain(); await target.backupTarget(task, runtime); task.state = 'importing_staging'; task.percent = 75; await task.save(); }
  if (task.state === 'importing_staging') { await target.restoreStaging(task, secret, runtime); task.state = 'verifying'; task.percent = 85; await task.save(); }
  if (task.state === 'verifying') {
    const cap = await runtime.probe();
    task.percent = 90;
    if (task.autoSwitchRequested && cap.atomicDatabaseSwitch) {
      task.state = 'quiescing';
      task.safeError = '';
      task.logs.push({
        stage: 'quiescing',
        message: '数据验证完成，覆盖授权有效，正在执行安全切换',
      });
      await task.save();
    } else {
      task.state = 'staging_verified';
      task.safeError = cap.atomicDatabaseSwitch
        ? '未收到有效的覆盖授权，在线数据未改动'
        : '当前环境暂不具备安全切换条件，在线数据未改动';
      task.logs.push({ stage: 'staging_verified', message: task.safeError });
      await task.save();
      await maintenance.setFrozen(false);
      return;
    }
  }
  if (task.state === 'quiescing' || task.state === 'switching') { await target.switchToStaging(task, runtime); task.state = 'restart_pending'; task.percent = 95; task.restartRequired = true; task.logs.push({ stage: 'restart_pending', message: `指针已提交，等待所有业务实例重启并连接新代际；备份标识 ${task.backupId}` }); await task.save(); }
  if (task.state === 'restart_pending') {
    const control = require('./migrationControl');
    const pointer = await control.readPointer();
    const journal = pointer.switchJournal;
    if (!journal || journal.taskId !== task.taskId) throw new Error('SWITCH_JOURNAL_MISMATCH');
    if (!(await require('../models/PlatformAdmin').exists({ role: 'super', status: 'active' }))) throw new Error('PLATFORM_ADMIN_MISSING');

    if (['db_pointer_switched', 'db_verified', 'uploads_switched', 'sessions_revoked'].includes(journal.phase)) {
      if (pointer.activeDbName !== journal.targetDbName || runtime.db.databaseName !== pointer.activeDbName) return;
      let current = journal;

      if (current.phase === 'db_pointer_switched') {
        current = { ...current, dbVerifyStep: 'pending', dbVerifyStartedAt: new Date().toISOString() };
        await control.updateJournal(pointer.generation, current);
        task.journal = current; task.markModified?.('journal'); await task.save();
        await runtime.db.command({ ping: 1 });
        const probeCollection = runtime.db.collection('migration_health_probes');
        const probe = await probeCollection.insertOne({ taskId: task.taskId, generation: pointer.generation, createdAt: new Date() });
        await probeCollection.deleteOne({ _id: probe.insertedId });
        await probeCollection.drop().catch(error => {
          if (error.codeName !== 'NamespaceNotFound' && error.code !== 26) throw error;
        });
        current = { ...current, phase: 'db_verified', dbVerifyStep: 'done', dbVerifiedAt: new Date().toISOString() };
        await control.updateJournal(pointer.generation, current);
        task.journal = current; task.markModified?.('journal'); await task.save();
      }

      if (current.phase === 'db_verified') {
        current = await target.switchUploads(task, runtime, pointer, current);
      }

      if (current.phase === 'uploads_switched') {
        current = { ...current, sessionRevokeStep: 'pending', sessionRevokeStartedAt: new Date().toISOString() };
        await control.updateJournal(pointer.generation, current);
        task.journal = current; task.markModified?.('journal'); await task.save();
        await target.revokeSessions();
        current = { ...current, phase: 'sessions_revoked', sessionRevokeStep: 'done', sessionsRevokedAt: new Date().toISOString() };
        await control.updateJournal(pointer.generation, current);
        task.journal = current; task.markModified?.('journal'); await task.save();
      }

      if (current.phase === 'sessions_revoked') {
        const completing = { ...current, completionStep: 'pending', completionStartedAt: new Date().toISOString() };
        await control.updateJournal(pointer.generation, completing);
        task.journal = completing; task.markModified?.('journal'); await task.save();
        const completed = { ...completing, phase: 'completed', completionStep: 'done', completedAt: new Date().toISOString(), needsRestart: false };
        await control.updateJournal(pointer.generation, completed);
        task.journal = completed; task.markModified?.('journal'); task.state = 'completed'; task.percent = 100; task.finishedAt = new Date(); task.restartRequired = false;
        task.logs.push({ stage: 'completed', message: `新数据库代际、uploads、会话撤销及健康读写验证完成；备份标识 ${task.backupId}` });
        await task.save();
        maintenance.setProcessFrozen(false);
        await maintenance.setFrozen(false);
      }
      return;
    }

    if (journal.phase === 'rolled_back') {
      if (pointer.activeDbName !== journal.sourceDbName || runtime.db.databaseName !== pointer.activeDbName) return;
      const rolledBack = { ...journal, phase: 'rolled_back', rolledBackAt: new Date().toISOString(), needsRestart: false };
      await control.updateJournal(pointer.generation, rolledBack);
      task.journal = rolledBack; task.markModified?.('journal'); task.state = 'rolled_back'; task.percent = 100; task.finishedAt = new Date(); task.restartRequired = false;
      task.logs.push({ stage: 'rolled_back', message: `旧数据库代际已重新启动并验证 PlatformAdmin；备份标识 ${task.backupId}` });
      await task.save();
      maintenance.setProcessFrozen(false);
      await maintenance.setFrozen(false);
    }
  }
}
async function processTask(task) {
  const isSource = !task.direction || task.direction === 'source';
  const heartbeat = task._id && task.leaseOwner ? setInterval(() => {
    MigrationTask.updateOne({ _id: task._id, leaseOwner: task.leaseOwner }, { $set: { leaseUntil: new Date(Date.now() + 30000) } }).catch(() => {});
  }, 10000) : null;
  heartbeat?.unref?.();
  try {
    if (isSource) await processSource(task); else await processTarget(task);
    if (!['completed', 'failed', 'cancelled', 'rolled_back', 'staging_verified'].includes(task.state)) { task.leaseOwner = ''; task.leaseUntil = null; await task.save(); }
  } catch (err) {
    if ((err.code || err.message) === 'ROLLBACK_AFTER_BUSINESS_WRITES_FORBIDDEN') {
      const control = require('./migrationControl');
      const pointer = await control.readPointer();
      const journal = pointer.switchJournal?.taskId === task.taskId
        ? pointer.switchJournal
        : task.journal;
      const manualJournal = {
        ...journal,
        phase: 'manual_intervention',
        businessWritesAcceptedAt: journal.businessWritesAcceptedAt,
        manualInterventionAt: new Date().toISOString(),
        manualInterventionReason: 'ROLLBACK_AFTER_BUSINESS_WRITES_FORBIDDEN',
      };
      await control.updateJournal(pointer.generation, manualJournal);
      await maintenance.setFrozen(true, task.taskId);
      task.journal = manualJournal;
      task.markModified?.('journal');
      task.state = 'manual_intervention';
      task.safeError = '新数据库已接受业务写入，自动回滚已阻断，需要人工核对并合并新旧数据库数据';
      task.finishedAt = null;
      task.logs.push({ stage: task.state, message: `${task.safeError}；写冻结保持，worker 不再自动重试回滚` });
      task.leaseOwner = '';
      task.leaseUntil = null;
      await task.save();
      return;
    }
    let authoritativeJournal = task.journal || {};
    if (task.direction === 'target' && authoritativeJournal.pointerCommitted && !authoritativeJournal.rollbackCommitted) {
      const control = require('./migrationControl');
      try {
        const pointer = await control.readPointer();
        if (pointer.switchJournal?.taskId === task.taskId) authoritativeJournal = pointer.switchJournal;
        if (authoritativeJournal.businessWritesAcceptedAt) throw new Error('ROLLBACK_AFTER_BUSINESS_WRITES_FORBIDDEN');
        authoritativeJournal = {
          ...authoritativeJournal,
          phase: 'rolling_back',
          halfSwitched: true,
          rollbackCommitted: false,
          rollbackReason: safeFailure(err),
          rollbackRequestedAt: new Date().toISOString(),
        };
        await control.updateJournal(pointer.generation, authoritativeJournal);
        task.journal = authoritativeJournal;
        task.markModified?.('journal');
      } catch (journalError) {
        if ((journalError.code || journalError.message) === 'ROLLBACK_AFTER_BUSINESS_WRITES_FORBIDDEN') {
          const manualJournal = {
            ...authoritativeJournal,
            phase: 'manual_intervention',
            manualInterventionAt: new Date().toISOString(),
            manualInterventionReason: 'ROLLBACK_AFTER_BUSINESS_WRITES_FORBIDDEN',
          };
          await control.updateJournal((await control.readPointer()).generation, manualJournal);
          await maintenance.setFrozen(true, task.taskId);
          task.journal = manualJournal;
          task.markModified?.('journal');
          task.state = 'manual_intervention';
          task.safeError = '新数据库已接受业务写入，自动回滚已阻断，需要人工核对并合并新旧数据库数据';
          task.finishedAt = null;
          task.logs.push({ stage: task.state, message: `${task.safeError}；写冻结保持，worker 不再自动重试回滚` });
          task.leaseOwner = '';
          task.leaseUntil = null;
          await task.save();
          return;
        }
        authoritativeJournal = {
          ...authoritativeJournal,
          recoveryJournalError: safeFailure(journalError),
        };
        task.journal = authoritativeJournal;
        task.markModified?.('journal');
      }
    }
    const committedOnlineState = Boolean(authoritativeJournal.pointerCommitted) && !authoritativeJournal.rollbackCommitted;
    const unsafeOnlineState = task.direction === 'target' && (authoritativeJournal.halfSwitched || authoritativeJournal.phase === 'rolling_back' || committedOnlineState);
    if (!unsafeOnlineState) await maintenance.setFrozen(false);
    task.state = authoritativeJournal.phase === 'rolled_back' ? 'rolled_back' : unsafeOnlineState ? 'rolling_back' : 'failed'; task.safeError = safeFailure(err); task.finishedAt = unsafeOnlineState ? null : new Date(); task.logs.push({ stage: task.state, message: unsafeOnlineState ? `${task.safeError}；写冻结保持，worker 将依据 control journal 执行回滚` : task.safeError }); task.leaseOwner = ''; task.leaseUntil = null; await task.save();
  } finally { if (heartbeat) clearInterval(heartbeat); }
}
async function tick() { if (running) return; running = true; try { const task = await claim(); if (task) await processTask(task); } finally { running = false; } }
function start() {
  if (!config.migration.dataPlaneEnabled && !config.migration.activePointerEnabled) return;
  if (!timer) { timer = setInterval(tick, 3000); timer.unref?.(); tick(); }
}
function stop() { if (timer) clearInterval(timer); timer = null; }
function wake() { setImmediate(tick); }
module.exports = { sealSecret, unsealSecret, buildPackage, send, start, stop, wake, processTask };
