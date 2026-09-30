// 忆梦云团队开发
const crypto = require('crypto');
const express = require('express');
const MigrationTask = require('../models/MigrationTask');
const security = require('./migrationSecurity');
const data = require('./migrationData');
const { MigrationRuntime } = require('./migrationRuntime');
const worker = require('./migrationWorker');

const inflight = new Map();

function rawParser() {
  return express.raw({
    type: 'application/octet-stream',
    limit: data.MAX_CHUNK_BYTES + 16,
    verify(req, res, buf) { req.rawBody = buf; },
  });
}

function jsonParser() {
  return express.json({
    limit: '2mb',
    verify(req, res, buf) { req.rawBody = buf; },
  });
}

async function authorizeHeaders(req) {
  const taskId = String(req.headers['x-migration-task'] || '');
  const token = String(req.headers['x-migration-token'] || '');
  const task = await MigrationTask.findOne({ taskId, direction: 'target' })
    .select('+peerTokenDigest +peerTokenExpiresAt +sessionSecretCipher +receivedChunks +backupPath +transferPath +stagingDb +stagingUploads');

  if (!task || !token || !task.peerTokenExpiresAt || task.peerTokenExpiresAt <= new Date() || !security.equal(task.peerTokenDigest, security.hmac(token))) {
    throw new Error('MIGRATION_TOKEN_INVALID');
  }

  const sourceIp = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (!task.sourceIp || task.sourceIp !== sourceIp) throw new Error('MIGRATION_SOURCE_IP_MISMATCH');

  const secret = worker.unsealSecret(task.sessionSecretCipher, task.taskId);
  const verified = security.verifyRequestHeaders(req, secret);
  if (verified.taskId !== task.taskId) throw new Error('MIGRATION_SIGNATURE_INVALID');
  await security.assertRequestFresh(verified);
  return { task, secret, verified };
}

async function authorize(req) {
  const authorized = await authorizeHeaders(req);
  await security.commitRequest(req, authorized.verified);
  return authorized;
}

function responseError(res, error) {
  noStore(res);
  const unauthorized = ['MIGRATION_REPLAY', 'MIGRATION_SIGNATURE_INVALID', 'MIGRATION_SIGNATURE_EXPIRED', 'MIGRATION_TOKEN_INVALID', 'MIGRATION_SOURCE_IP_MISMATCH'].includes(error.message);
  const conflict = ['CHUNK_CONFLICT', 'CHUNK_ORDER_INVALID', 'MANIFEST_CONFLICT'].includes(error.message);
  const status = unauthorized ? 401 : conflict ? 409 : error.message === 'MIGRATION_DISK_FULL' ? 507 : error.message === 'MIGRATION_QUOTA_EXCEEDED' ? 413 : 400;
  return res.status(status).json({ code: status, message: error.message });
}

function noStore(res) {
  res.set('Cache-Control', 'no-store, max-age=0').set('Pragma', 'no-cache');
}

function transferRoot(task) {
  if (!task.transferPath) throw new Error('MANIFEST_NOT_INITIALIZED');
  return task.transferPath;
}

async function init(req, res) {
  noStore(res);
  try {
    const { task, secret } = await authorize(req);
    const manifest = data.validateManifest(data.decryptManifest(req.body?.envelope, task.taskId, secret));
    if (manifest.taskId !== task.taskId || manifest.sourceInstanceId !== task.sourceInstanceId || manifest.targetInstanceId !== task.targetInstanceId || manifest.schemaVersion !== task.schemaVersion || !data.verifyManifest(manifest, req.body.signature, secret)) {
      throw new Error('MANIFEST_SIGNATURE_INVALID');
    }

    if (task.manifest) {
      if (data.canonicalJson(task.manifest) !== data.canonicalJson(manifest)) throw new Error('MANIFEST_CONFLICT');
      const received = await data.verifyReceived(transferRoot(task), manifest);
      return res.json({ code: 0, data: received });
    }

    const runtime = new MigrationRuntime();
    const cap = await runtime.probe(manifest.totalBytes * 3);
    if (!cap.ready) return res.status(412).json({ code: 412, message: 'CAPABILITY_LOST', blockers: cap.blockers });

    const randomDir = `incoming-${task.taskId}-${crypto.randomBytes(12).toString('hex')}`;
    task.transferPath = require('path').join(runtime.stagingDir, randomDir);
    await runtime.ensurePrivateDir(task.transferPath);
    task.manifest = manifest;
    task.bytesTotal = manifest.totalBytes;
    task.state = 'transferring';
    task.logs.push({ stage: 'transferring', message: '目标站已验证签名 manifest 并初始化隔离接收目录' });
    await task.save();
    return res.json({ code: 0, data: await data.verifyReceived(task.transferPath, manifest) });
  } catch (error) {
    return responseError(res, error);
  }
}

async function status(req, res) {
  noStore(res);
  try {
    const { task } = await authorize(req);
    if (!task.manifest) throw new Error('MANIFEST_NOT_INITIALIZED');
    const value = await data.verifyReceived(transferRoot(task), task.manifest);
    return res.json({ code: 0, data: { ...value, state: task.state, percent: task.percent, safeError: task.safeError, backupId: task.backupId } });
  } catch (error) {
    return responseError(res, error);
  }
}

async function receiveChunk(req, task, expected) {
  const runtime = new MigrationRuntime();
  const root = data.taskRoot(transferRoot(task), task.taskId);
  await runtime.ensurePrivateDir(root);
  const temporary = require('path').join(root, `.incoming-${crypto.randomUUID()}.tmp`);
  const hash = crypto.createHash('sha256');
  let size = 0;
  const sink = require('fs').createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
  const meter = new (require('stream').Transform)({
    transform(chunk, encoding, callback) {
      size += chunk.length;
      if (size > expected.size || size > data.MAX_CHUNK_BYTES + 16) return callback(new Error('CHUNK_BOUNDS_INVALID'));
      hash.update(chunk);
      return callback(null, chunk);
    },
  });
  try {
    await require('stream/promises').pipeline(req, meter, sink);
    const digest = hash.digest('hex');
    req.streamBodyHash = digest;
    if (size !== expected.size || digest !== expected.sha256) throw new Error('CHUNK_HASH_INVALID');
    return { runtime, temporary };
  } catch (error) {
    await require('fs').promises.rm(temporary, { force: true });
    throw error;
  }
}

async function putChunk(req, res) {
  noStore(res);
  let release; let temporary;
  try {
    const { task, verified } = await authorizeHeaders(req);
    if (!task.manifest || task.state !== 'transferring') throw new Error('TRANSFER_NOT_READY');
    const id = String(req.params.artifact);
    const index = Number(req.params.index);
    const expected = task.manifest.artifacts.find(item => item.id === id && item.index === index);
    if (!expected) throw new Error('CHUNK_NOT_DECLARED');
    if (Number(req.headers['content-length']) !== expected.size) throw new Error('CONTENT_LENGTH_INVALID');
    if (Number(req.headers['x-migration-offset']) !== expected.offset) throw new Error('CHUNK_OFFSET_INVALID');

    const current = inflight.get(task.taskId) || 0;
    if (current >= 2) return res.status(429).json({ code: 429, message: 'CHUNK_CONCURRENCY_LIMIT' });
    inflight.set(task.taskId, current + 1);
    release = () => inflight.set(task.taskId, Math.max(0, (inflight.get(task.taskId) || 1) - 1));

    const diskState = await data.verifyReceived(transferRoot(task), task.manifest);
    const received = new Set([
      ...(task.receivedChunks || []),
      ...diskState.received,
    ]);
    const chunkKey = `${id}:${index}`;
    const earlier = task.manifest.artifacts.filter(item => item.id === id && item.index < index);
    if (earlier.some(item => !received.has(`${item.id}:${item.index}`))) throw new Error('CHUNK_ORDER_INVALID');
    const declaredBytes = task.manifest.artifacts
      .filter(item => received.has(`${item.id}:${item.index}`))
      .reduce((sum, item) => sum + item.size, 0);
    const incomingBytes = received.has(chunkKey) ? 0 : expected.size;
    if (declaredBytes + incomingBytes > task.bytesTotal || task.bytesTotal > data.MAX_TOTAL_BYTES) throw new Error('MIGRATION_QUOTA_EXCEEDED');

    const runtime = new MigrationRuntime();
    const freeBytes = await runtime.diskFree(transferRoot(task));
    if (freeBytes < expected.size + 64 * 1024 * 1024) throw new Error('MIGRATION_DISK_FULL');

    const incoming = await receiveChunk(req, task, expected);
    temporary = incoming.temporary;
    await security.commitRequest(req, verified);
    const result = await data.storeChunkFile(transferRoot(task), task.taskId, id, index, temporary, expected.sha256, expected.size);
    temporary = null;
    const state = await data.verifyReceived(transferRoot(task), task.manifest);
    const percent = Math.min(65, 15 + Math.floor(state.bytes / task.bytesTotal * 50));
    const update = await MigrationTask.updateOne(
      { _id: task._id, state: 'transferring', manifest: { $ne: null } },
      {
        $addToSet: { receivedChunks: { $each: state.received } },
        $max: { bytesDone: state.bytes, percent },
        $set: { receivedChunkCount: state.received.length },
      },
    );
    if (update.matchedCount !== 1) throw new Error('TRANSFER_NOT_READY');
    return res.json({ code: 0, data: result });
  } catch (error) {
    return responseError(res, error);
  } finally {
    release?.();
    if (temporary) await require('fs').promises.rm(temporary, { force: true }).catch(() => {});
  }
}

async function authorizeOverwrite(req, res) {
  noStore(res);
  try {
    const { task } = await authorize(req);
    if (req.body?.overwriteConfirmed !== true) {
      throw new Error('OVERWRITE_CONFIRMATION_REQUIRED');
    }
    if (task.autoSwitchRequested) {
      return res.json({ code: 0, data: { authorized: true, idempotent: true } });
    }
    if (!['awaiting_confirmation', 'transferring'].includes(task.state)) {
      throw new Error('OVERWRITE_AUTHORIZATION_TOO_LATE');
    }
    task.autoSwitchRequested = true;
    task.logs.push({
      stage: task.state,
      message: '已收到源站签名的一次性覆盖授权，验证完成后将执行安全切换',
    });
    await task.save();
    return res.json({ code: 0, data: { authorized: true, idempotent: false } });
  } catch (error) {
    return responseError(res, error);
  }
}

async function abort(req, res) {
  noStore(res);
  try {
    const { task } = await authorize(req);
    if (['switching', 'rolling_back', 'completed', 'rolled_back'].includes(task.state)) throw new Error('ABORT_TOO_LATE');
    if (task.stagingDb) await require('mongoose').connection.client.db(task.stagingDb).dropDatabase().catch(() => {});
    if (task.transferPath) await data.secureRemove(task.transferPath);
    if (task.stagingUploads) await data.secureRemove(require('path').dirname(task.stagingUploads));
    task.state = 'cancelled'; task.finishedAt = new Date(); task.logs.push({ stage: 'cancelled', message: '源站请求中止，目标 staging 已清理，在线数据未改动' }); await task.save();
    await require('./maintenanceService').setFrozen(false);
    return res.json({ code: 0, data: { aborted: true } });
  } catch (error) { return responseError(res, error); }
}

async function rollback(req, res) {
  noStore(res);
  try {
    const { task } = await authorize(req);
    if (task.state === 'rolled_back') return res.json({ code: 0, data: { rollingBack: false, idempotent: true } });
    if (!['completed', 'switching', 'rolling_back'].includes(task.state)) throw new Error('ROLLBACK_NOT_AVAILABLE');
    task.state = 'rolling_back'; task.logs.push({ stage: 'rolling_back', message: '源站已请求按持久 journal 逆序恢复' }); await task.save(); worker.wake();
    return res.json({ code: 0, data: { rollingBack: true } });
  } catch (error) { return responseError(res, error); }
}

async function complete(req, res) {
  noStore(res);
  try {
    const { task } = await authorize(req);
    if (['target_backup', 'importing_staging', 'verifying', 'switching', 'completed'].includes(task.state)) {
      return res.json({ code: 0, data: { complete: true, idempotent: true } });
    }
    if (task.state !== 'transferring' || !task.manifest) throw new Error('TRANSFER_NOT_READY');
    const state = await data.verifyReceived(transferRoot(task), task.manifest);
    if (!state.complete) throw new Error('TRANSFER_INCOMPLETE');
    task.state = 'target_backup';
    task.percent = 66;
    task.logs.push({ stage: 'target_backup', message: '所有块 hash 已验证，等待 worker 创建目标备份' });
    await task.save();
    worker.wake();
    return res.json({ code: 0, data: { complete: true, idempotent: false } });
  } catch (error) {
    return responseError(res, error);
  }
}

module.exports = { rawParser, jsonParser, authorize, init, status, putChunk, complete, authorizeOverwrite, abort, rollback };
