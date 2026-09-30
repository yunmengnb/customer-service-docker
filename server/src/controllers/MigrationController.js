// 忆梦云团队开发
const crypto = require('crypto');
const MigrationGrant = require('../models/MigrationGrant');
const MigrationTask = require('../models/MigrationTask');
const { ok, error } = require('../utils');
const { recordOperation } = require('../services/auditLogService');
const migration = require('../services/migrationService');
const security = require('../services/migrationSecurity');
const { requestJson } = require('../services/migrationHttp');
const worker = require('../services/migrationWorker');
const { MigrationRuntime } = require('../services/migrationRuntime');
const migrationControl = require('../services/migrationControl');
const migrationFeature = require('../services/migrationFeature');
function noStore(res) { res.set('Cache-Control', 'no-store, max-age=0').set('Pragma', 'no-cache'); }
function audit(req, action, detail = '', result = 'success') { recordOperation({ req, tenantId: null, user: req.admin, action, detail, result }); }
function safeError(err) {
  const code = String(err?.code || err?.message || '');
  const known = {
    TARGET_URL_INVALID: '目标站地址无效',
    TARGET_URL_UNSAFE: '目标站地址必须使用 HTTPS，且不能包含账号、片段或非标准端口',
    TARGET_IP_UNSAFE: '目标服务器 IP 必须是合法公网 IP',
    TARGET_DNS_PIN_MISMATCH: '服务器 IP 与目标站解析结果不匹配',
    TARGET_TIMEOUT: '目标站连接超时，请检查地址、IP 和网络',
    TARGET_RESPONSE_INVALID: '目标站返回异常，请确认双方版本一致',
    ECONNREFUSED: '目标站连接失败，请检查地址、IP 和服务状态',
    ENOTFOUND: '目标站连接失败，请检查站点地址',
    CERT_HAS_EXPIRED: '目标站 HTTPS 证书已过期',
  };
  return known[code] || (code.startsWith('CERT_') ? '目标站 HTTPS 证书校验失败' : '目标站连接或安全检查失败');
}
class MigrationController {
  async settings(req, res) {
    noStore(res);
    return ok(res, await migrationFeature.status());
  }
  async capability(req, res) {
    noStore(res);
    return ok(res, {
      setting: await migrationFeature.status(),
      capability: await migration.capabilities(),
    });
  }
  async enable(req, res) {
    noStore(res);
    if (req.body.confirmPhrase !== '启用数据迁移功能') return error(res, '确认短语不正确');
    try {
      const setting = await migrationFeature.setEnabled(req, true);
      audit(req, 'migration.feature.enable', `version=${setting.version}`);
      return ok(res, await migrationFeature.status(), '已开启数据迁移管理功能；危险操作仍受部署能力检查限制');
    } catch (err) {
      audit(req, 'migration.feature.enable', err.message, 'failure');
      if (err.message !== 'MIGRATION_FEATURE_UNAVAILABLE') throw err;
      return error(res, '部署环境不允许启用数据迁移管理功能', 4120, 412, { blockers: err.blockers || [] });
    }
  }
  async disable(req, res) {
    noStore(res);
    if (req.body.confirmPhrase !== '停用数据迁移功能') return error(res, '确认短语不正确');
    try {
      const setting = await migrationFeature.setEnabled(req, false);
      audit(req, 'migration.feature.disable', `version=${setting.version}`);
      return ok(res, await migrationFeature.status(), '已停用数据迁移管理功能');
    } catch (err) {
      audit(req, 'migration.feature.disable', `${err.message}; task=${err.task?.taskId || ''}; state=${err.task?.state || ''}`, 'failure');
      if (err.message === 'MIGRATION_TASK_STATE_UNAVAILABLE') {
        return error(res, '无法确认活动任务状态，已拒绝停用', 5032, 503, { blockers: err.blockers || [] });
      }
      if (!['MIGRATION_DISABLE_UNSAFE', 'MIGRATION_ACTIVE_TASK'].includes(err.message)) throw err;
      const message = err.message === 'MIGRATION_DISABLE_UNSAFE' ? '任务正处于切换、回滚或人工处置阶段，禁止停用' : '存在活动迁移任务，请先安全取消并等待结束';
      return error(res, message, 4095, 409, { task: err.task ? { taskId: err.task.taskId, state: err.task.state } : null });
    }
  }
  async overview(req, res) {
    noStore(res);
    const setting = await migrationFeature.status();
    let summary = null; let grants = []; let tasks = []; let overviewError = '';
    try {
      const capability = await migration.capabilities();
      summary = { capability };
      setting.executionBlockers = [...new Set([...setting.executionBlockers, ...(capability.blockers || [])])];
    } catch (_) { overviewError = '迁移能力探测暂不可用'; }
    if (setting.dataPlaneEnabled) {
      try {
        [tasks, grants] = await Promise.all([MigrationTask.find().sort({ createdAt: -1 }).limit(20).lean(), MigrationGrant.find({ status: { $in: ['active', 'occupied'] } }).sort({ createdAt: -1 }).limit(10).lean()]);
        if (setting.enabled && setting.executionBlockers.length === 0) summary = await migration.preflightSummary();
      } catch (_) { overviewError = '迁移控制库或能力探测暂不可用'; }
    }
    return ok(res, { setting, local: summary, overviewError, grants: grants.map(g => ({ ...g, digest: undefined })), tasks: tasks.map(migration.publicTask) });
  }
  async createGrant(req, res) {
    noStore(res); const expectedSourceIp = String(req.body.expectedSourceIp || '').trim();
    if (expectedSourceIp && !security.isPublicIp(expectedSourceIp)) return error(res, '预期源站 IP 必须是公网 IP');
    await MigrationGrant.updateMany({ status: 'active' }, { $set: { status: 'revoked', revokedAt: new Date() } });
    const secret = crypto.randomBytes(32).toString('base64url'); const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const grant = await MigrationGrant.create({ digest: security.hmac(secret), targetInstanceId: await migration.instanceId(), expectedSourceIp, expiresAt, createdBy: req.admin.id });
    audit(req, 'migration.grant.create', `grant=${grant._id}; expires=${expiresAt.toISOString()}`); return ok(res, { id: grant._id, key: secret, expiresAt, expectedSourceIp }, '迁移密钥只显示本次，请立即安全复制');
  }
  async revokeGrant(req, res) {
    noStore(res); const grant = await MigrationGrant.findOneAndUpdate({ _id: req.params.id, status: 'active' }, { $set: { status: 'revoked', revokedAt: new Date() } }, { new: true });
    if (!grant) return error(res, '密钥不存在或已不可撤销', 404, 404); audit(req, 'migration.grant.revoke', `grant=${grant._id}`); return ok(res, null, '迁移密钥已撤销');
  }
  async handshake(req, res) {
    noStore(res); const key = String(req.body.key || ''); const sourceInstanceId = String(req.body.sourceInstanceId || ''); const nonce = String(req.body.nonce || '');
    if (!key || !sourceInstanceId || !/^[A-Za-z0-9_-]{20,100}$/.test(nonce)) return error(res, '握手参数无效');
    const digest = security.hmac(key); const now = new Date(); const targetId = await migration.instanceId(); if (sourceInstanceId === targetId) return error(res, '源站与目标站实例相同', 4091, 409);
    const grant = await MigrationGrant.findOne({ digest, status: 'active', expiresAt: { $gt: now }, targetInstanceId: targetId }).select('+digest');
    if (!grant || !security.equal(grant.digest, digest)) return error(res, '迁移密钥无效、过期或已占用', 4013, 401);
    const actualIp = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, ''); if (grant.expectedSourceIp && actualIp !== grant.expectedSourceIp) return error(res, '源站 IP 与密钥授权不符', 403, 403);
    const taskId = crypto.randomUUID(); const occupied = await MigrationGrant.findOneAndUpdate({ _id: grant._id, status: 'active', handshakeNonce: '' }, { $set: { status: 'occupied', occupiedAt: now, sourceInstanceId, handshakeNonce: nonce, taskId } }, { new: true });
    if (!occupied) return error(res, '迁移密钥已被占用', 409, 409);
    const sessionSecret = security.deriveSessionSecret(key, sourceInstanceId, targetId, nonce); const token = crypto.randomBytes(32).toString('base64url'); const summary = await migration.preflightSummary();
    await MigrationTask.create({ taskId, direction: 'target', state: 'awaiting_confirmation', sourceIp: actualIp, sourceInstanceId, targetInstanceId: targetId, targetInstanceName: summary.instanceName, protocolVersion: security.PROTOCOL_VERSION, schemaVersion: summary.schemaVersion, peerTokenDigest: security.hmac(token), peerTokenExpiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000), sessionSecretCipher: worker.sealSecret(sessionSecret, taskId), capability: summary.capability, createdBy: grant.createdBy });
    return ok(res, { taskId, taskToken: token, sessionSecret, target: summary });
  }
  async sourcePreflight(req, res) {
    noStore(res); const targetUrl = String(req.body.targetUrl || ''); const targetIp = String(req.body.targetIp || ''); const key = String(req.body.migrationKey || '');
    let pendingHandshake = null;
    const abortPending = async () => {
      if (!pendingHandshake) return;
      const { task, secret, token } = pendingHandshake;
      pendingHandshake = null;
      await worker.send(task, secret, token, 'POST', '/abort', {}).catch(() => {});
    };
    try {
      const { url } = await security.validateTarget(targetUrl, targetIp); const source = await migration.preflightSummary(); const nonce = crypto.randomBytes(24).toString('base64url');
      const response = await requestJson(url, targetIp, 'POST', '/api/migration/handshake', { key, sourceInstanceId: source.instanceId, nonce });
      if (response.status !== 200 || response.data.code !== 0) return error(res, response.data.message || '目标站拒绝连接', response.status, response.status);
      pendingHandshake = {
        task: { taskId: response.data.data.taskId, targetOrigin: url.origin, targetIp },
        secret: response.data.data.sessionSecret,
        token: response.data.data.taskToken,
      };
      const target = response.data.data.target;
      if (target.protocolVersion !== security.PROTOCOL_VERSION || target.schemaVersion !== source.schemaVersion) {
        await abortPending();
        return error(res, '源站与目标站协议或 Schema 版本不兼容', 4092, 409);
      }
      if (!source.capability?.ready || !target.capability?.ready || !target.capability?.atomicDatabaseSwitch) {
        await abortPending();
        return error(res, '当前环境暂不具备安全迁移条件，请联系运维检查', 4120, 412);
      }
      if (await migration.activeForTarget(target.instanceId)) {
        await abortPending();
        return error(res, '该目标站已有活动迁移任务', 4093, 409);
      }
      const task = await MigrationTask.create({ taskId: response.data.data.taskId, direction: 'source', state: 'awaiting_confirmation', targetOrigin: url.origin, targetIp, sourceInstanceId: source.instanceId, targetInstanceId: target.instanceId, targetInstanceName: target.instanceName, protocolVersion: security.PROTOCOL_VERSION, schemaVersion: source.schemaVersion, sessionSecretCipher: worker.sealSecret(response.data.data.sessionSecret, response.data.data.taskId), peerTokenCipher: worker.sealSecret(response.data.data.taskToken, `${response.data.data.taskId}:token`), peerTokenDigest: security.hmac(response.data.data.taskToken), capability: { source: source.capability, target: target.capability }, manifest: { source, target }, createdBy: req.admin.id });
      pendingHandshake = null;
      audit(req, 'migration.preflight', `task=${task.taskId}; target=${target.instanceId}`); return ok(res, migration.publicTask(task));
    } catch (err) {
      await abortPending();
      audit(req, 'migration.preflight', safeError(err), 'failure');
      return error(res, safeError(err), 4001, 400);
    }
  }
  async start(req, res) {
    noStore(res);
    const task = await MigrationTask.findOne({
      taskId: req.params.taskId,
      direction: 'source',
      state: 'awaiting_confirmation',
    }).select('+sessionSecretCipher +peerTokenCipher');
    if (!task) return error(res, '任务不存在或状态不允许启动', 409, 409);
    if (
      String(req.body.instanceName || '') !== task.targetInstanceName
      || req.body.confirmPhrase !== '目标站原数据将被覆盖'
      || req.body.overwriteConfirmed !== true
    ) {
      return error(res, '请确认目标站原数据将被覆盖');
    }
    const caps = task.capability || {};
    if (!caps.source?.ready || !caps.target?.ready || !caps.target?.atomicDatabaseSwitch) {
      return error(res, '当前环境暂不具备安全迁移条件，请联系运维检查', 4120, 412);
    }
    try {
      const secret = worker.unsealSecret(task.sessionSecretCipher, task.taskId);
      const token = worker.unsealSecret(task.peerTokenCipher, `${task.taskId}:token`);
      await worker.send(task, secret, token, 'POST', '/authorize-overwrite', {
        overwriteConfirmed: true,
      });
    } catch (err) {
      audit(req, 'migration.start', `task=${task.taskId}; target authorization failed`, 'failure');
      return error(res, '目标站未能确认覆盖授权，请重新检查连接后再试', 4096, 409);
    }
    task.autoSwitchRequested = true;
    task.requestId = String(res.locals.requestId || '');
    task.state = 'freezing_source';
    task.startedAt = new Date();
    task.logs.push({ stage: task.state, message: '覆盖授权已确认，等待开始迁移' });
    try {
      await task.save();
    } catch (err) {
      const secret = worker.unsealSecret(task.sessionSecretCipher, task.taskId);
      const token = worker.unsealSecret(task.peerTokenCipher, `${task.taskId}:token`);
      await worker.send(task, secret, token, 'POST', '/abort', {}).catch(() => {});
      audit(req, 'migration.start', `task=${task.taskId}; source state save failed`, 'failure');
      return error(res, '迁移任务启动失败，目标站原数据未改动', 5001, 500);
    }
    worker.wake();
    audit(req, 'migration.start', `task=${task.taskId}`);
    return ok(res, migration.publicTask(task));
  }
  async switchTask(req, res) {
    noStore(res);
    const task = await MigrationTask.findOne({ taskId: req.params.taskId, direction: 'target', state: 'staging_verified' });
    if (!task) return error(res, '任务不存在或尚未完成 staging 验证', 409, 409);
    if (String(req.body.instanceName || '') !== task.targetInstanceName || req.body.confirmPhrase !== '覆盖目标站在线数据') {
      return error(res, '目标实例名称或确认短语不正确');
    }
    const capability = await new MigrationRuntime().probe();
    if (!capability.atomicDatabaseSwitch) {
      return error(res, '当前环境不具备安全切换能力', 4121, 412, { blockers: capability.switchCapability?.blockers || [capability.switchBlocker] });
    }
    task.state = 'quiescing';
    task.safeError = '';
    task.logs.push({ stage: 'quiescing', message: '管理员已二次确认高风险切换，等待所有实例进入维护并确认排空' });
    await task.save();
    worker.wake();
    audit(req, 'migration.switch', `task=${task.taskId}`);
    return ok(res, migration.publicTask(task));
  }
  async rollbackTask(req, res) {
    noStore(res);
    const task = await MigrationTask.findOne({
      taskId: req.params.taskId,
      direction: 'target',
      state: { $in: ['restart_pending', 'completed'] },
    });
    if (!task) return error(res, '任务不存在或当前阶段不可回滚', 409, 409);
    const pointer = await migrationControl.readPointer();
    const journal = pointer.switchJournal?.taskId === task.taskId
      ? pointer.switchJournal
      : task.journal;
    if (journal?.businessWritesAcceptedAt) {
      return error(res, '新数据库已接受业务写入，禁止自动回滚；请保持维护并执行人工数据合并处置', 4094, 409);
    }
    if (String(req.body.instanceName || '') !== task.targetInstanceName || req.body.confirmPhrase !== '回滚目标站数据') {
      return error(res, '目标实例名称或回滚确认短语不正确');
    }
    task.rollbackRequestedAt = new Date();
    task.state = 'rolling_back';
    task.safeError = '';
    task.logs.push({ stage: 'rolling_back', message: '管理员已独立确认高风险回滚，等待实例排空并恢复旧数据库代际' });
    await task.save();
    worker.wake();
    audit(req, 'migration.rollback', `task=${task.taskId}`);
    return ok(res, migration.publicTask(task));
  }
  async cancel(req, res) {
    noStore(res); const task = await MigrationTask.findOne({ taskId: req.params.taskId }); if (!task) return error(res, '任务不存在', 404, 404);
    if (['quiescing', 'switching', 'restart_pending', 'completed', 'rolling_back', 'manual_intervention'].includes(task.state)) return error(res, '在线切换后请使用独立的高风险回滚操作；人工介入状态不可取消', 409, 409);
    if (!['failed', 'cancelled', 'rolled_back'].includes(task.state)) task.cancelRequestedAt = new Date(); else return error(res, '当前阶段不可取消', 409, 409);
    task.logs.push({ stage: task.state, message: '已请求取消' }); await task.save(); worker.wake(); audit(req, 'migration.cancel', `task=${task.taskId}`); return ok(res, migration.publicTask(task));
  }
  async tasks(req, res) { noStore(res); const tasks = await MigrationTask.find().sort({ createdAt: -1 }).limit(50).lean(); return ok(res, tasks.map(migration.publicTask)); }
  async report(req, res) { noStore(res); const task = await MigrationTask.findOne({ taskId: req.params.taskId }).lean(); if (!task) return error(res, '任务不存在', 404, 404); res.set('Content-Disposition', `attachment; filename="migration-${task.taskId}.json"`); return res.json(migration.publicTask(task)); }
}
module.exports = new MigrationController();
