// 忆梦云团队开发
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const config = require('../config');
const migrationControl = require('./migrationControl');

const TOOL_TIMEOUT_MS = 15000;
const SAFE_DB = /^[A-Za-z0-9_-]{1,63}$/;

function migrationError(code, detail = '') {
  const error = new Error(code);
  error.code = code;
  error.safeDetail = detail;
  return error;
}

function assertSafeDbName(name) {
  if (!SAFE_DB.test(String(name || ''))) throw migrationError('MIGRATION_DB_NAME_UNSAFE');
  return String(name);
}

function mongoDbName(uri = config.mongo.uri) {
  let parsed;
  try { parsed = new URL(uri); } catch { throw migrationError('MONGO_URI_INVALID'); }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0] || '');
  return assertSafeDbName(name);
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function redactArgs(args) {
  return args.map((arg, index) => args[index - 1] === '--uri' ? '[REDACTED]' : String(arg).replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, '[REDACTED_URI]'));
}

class MigrationRuntime {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.env = options.env || process.env;
    this.fs = options.fs || fs;
    this.spawn = options.spawn || spawn;
    this.db = options.db || mongoose.connection.db;
    this.client = options.client || mongoose.connection.client;
    if (options.mongoUri) this.mongoUri = options.mongoUri;
    else {
      try { this.mongoUri = migrationControl.activeMongoUri(); }
      catch (_) { this.mongoUri = config.mongo.uri; }
    }
    this.uploadDir = path.resolve(options.uploadDir || this.env.UPLOAD_DIR || path.resolve(__dirname, '..', '..', 'uploads'));
    this.tempDir = path.resolve(options.tempDir || this.env.MIGRATION_TEMP_DIR || path.resolve(__dirname, '..', '..', '.migration-temp'));
    this.stagingDir = path.resolve(options.stagingDir || this.env.MIGRATION_STAGING_DIR || path.join(path.dirname(this.uploadDir), '.migration-private', 'staging'));
    this.backupDir = path.resolve(options.backupDir || this.env.MIGRATION_BACKUP_DIR || path.resolve(__dirname, '..', '..', '.migration-backup'));
    this.allowReal = options.allowReal ?? (this.platform === 'linux' && this.env.MIGRATION_DATA_PLANE_ENABLED === 'true');
    this.commandLog = options.commandLog || (() => {});
  }

  assertReal() {
    if (!this.allowReal || this.platform !== 'linux') throw migrationError('MIGRATION_RUNTIME_DISABLED');
  }

  async exec(binary, args, options = {}) {
    this.assertReal();
    if (!['mongodump', 'mongorestore'].includes(binary) || !Array.isArray(args) || args.some(value => typeof value !== 'string')) throw migrationError('MIGRATION_COMMAND_UNSAFE');
    this.commandLog({ binary, args: redactArgs(args) });
    return new Promise((resolve, reject) => {
      const child = this.spawn(binary, args, {
        shell: false,
        windowsHide: true,
        env: options.env || { PATH: this.env.PATH, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
        stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
      });
      let stdout = Buffer.alloc(0); let stderr = Buffer.alloc(0); let settled = false;
      const timer = setTimeout(() => child.kill('SIGKILL'), options.timeout || TOOL_TIMEOUT_MS);
      child.stdout?.on('data', chunk => { if (stdout.length < 1024 * 1024) stdout = Buffer.concat([stdout, chunk]); });
      child.stderr?.on('data', chunk => { if (stderr.length < 1024 * 1024) stderr = Buffer.concat([stderr, chunk]); });
      child.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); reject(migrationError('MIGRATION_COMMAND_FAILED', error.code || 'spawn')); } });
      child.on('close', code => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (code !== 0) return reject(migrationError('MIGRATION_COMMAND_FAILED', `${binary}:${code}`));
        resolve({ stdout, stderr });
      });
    });
  }

  async toolVersion(binary) {
    try {
      const result = await this.exec(binary, ['--version']);
      const text = `${result.stdout}\n${result.stderr}`;
      const match = text.match(
        /(?:version:\s*|\bv)(\d+\.\d+(?:\.\d+)?)/i,
      );
      return { available: true, version: match?.[1] || 'unknown', major: match ? Number(match[1].split('.')[0]) : null };
    } catch { return { available: false, version: '', major: null }; }
  }

  async ensurePrivateDir(dir) {
    await this.fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    await this.fs.promises.chmod(dir, 0o700);
  }

  async diskFree(dir) {
    const stat = await this.fs.promises.statfs(dir);
    return Number(stat.bavail) * Number(stat.bsize);
  }

  async probeRename(root) {
    const probe = path.join(root, `.rename-probe-${crypto.randomUUID()}`); const moved = `${probe}.moved`;
    await this.fs.promises.mkdir(probe, { mode: 0o700 });
    try { await this.fs.promises.rename(probe, moved); await this.fsyncDir(root); return true; } finally { await this.fs.promises.rm(probe, { recursive: true, force: true }); await this.fs.promises.rm(moved, { recursive: true, force: true }); }
  }

  async fsyncDir(dir) {
    const handle = await this.fs.promises.open(dir, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  }

  async probe(requiredBytes = 0) {
    const blockers = [];
    if (this.platform !== 'linux') blockers.push('真实迁移数据面仅支持明确启用的 Linux 部署环境');
    if (!this.allowReal) blockers.push('未设置 MIGRATION_DATA_PLANE_ENABLED=true');
    for (const dir of [this.tempDir, this.stagingDir, this.backupDir, this.uploadDir]) await this.ensurePrivateDir(dir).catch(() => blockers.push(`目录不可写：${path.basename(dir)}`));
    const privateUploadRoot = path.join(path.dirname(this.uploadDir), '.migration-private');
    if (!isInside(privateUploadRoot, this.stagingDir)) blockers.push('staging 必须位于 active uploads 同级的 .migration-private 内');
    for (const dir of [this.tempDir, this.backupDir]) {
      if (isInside(this.uploadDir, dir) || isInside(dir, this.uploadDir)) blockers.push('backup/temp 不得与 uploads 目录互相嵌套');
    }
    if (isInside(this.tempDir, this.backupDir) || isInside(this.backupDir, this.tempDir)) blockers.push('backup 与 temp 目录不得互相嵌套');
    let hello = {}; try { hello = await this.db.admin().command({ hello: 1 }); } catch { blockers.push('MongoDB hello 探测失败'); }
    const replicaSet = Boolean(hello.setName);
    if (!replicaSet) blockers.push('MongoDB 未启用副本集一致性快照');
    if (hello.msg === 'isdbgrid') blockers.push('暂不支持分片集群迁移切换');
    const [dump, restore] = await Promise.all([this.toolVersion('mongodump'), this.toolVersion('mongorestore')]);
    if (!dump.available) blockers.push('缺少 mongodump');
    if (!restore.available) blockers.push('缺少 mongorestore');
    if (dump.available && (!dump.major || dump.major < 100)) blockers.push('mongodump 版本无法证明支持当前一致性归档能力（要求 MongoDB Database Tools 100.x）');
    if (restore.available && (!restore.major || restore.major < 100)) blockers.push('mongorestore 版本无法证明兼容（要求 MongoDB Database Tools 100.x）');
    if (dump.version && restore.version && dump.version !== restore.version) blockers.push('mongodump 与 mongorestore 必须使用完全相同版本');
    let rename = false; try { rename = await this.probeRename(path.dirname(this.uploadDir)); } catch { blockers.push('uploads 所在文件系统不支持目录 rename/fsync'); }
    let sameUploadDevice = false;
    let uploadMountRoot = false;
    try {
      const [uploadStat, stagingStat, uploadParentStat] = await Promise.all([
        this.fs.promises.stat(this.uploadDir),
        this.fs.promises.stat(this.stagingDir),
        this.fs.promises.stat(path.dirname(this.uploadDir)),
      ]);
      sameUploadDevice = uploadStat.dev === stagingStat.dev;
      uploadMountRoot = uploadStat.dev !== uploadParentStat.dev;
    } catch { blockers.push('无法验证 staging 与 uploads 文件系统'); }
    if (!sameUploadDevice) blockers.push('staging uploads 与 active uploads 不在同一文件系统');
    const stagingNestedInActive = isInside(this.uploadDir, this.stagingDir);
    if (stagingNestedInActive) blockers.push('staging 位于 active uploads 内部，目录切换会移动 staging，禁止原子切换');
    if (uploadMountRoot) blockers.push('active uploads 是独立挂载点，禁止 rename 挂载根目录');
    let freeBytes = 0; try { freeBytes = Math.min(...await Promise.all([this.tempDir, this.stagingDir, this.backupDir].map(dir => this.diskFree(dir)))); if (freeBytes < requiredBytes) blockers.push('迁移目录可用空间不足'); } catch { blockers.push('无法探测迁移目录可用空间'); }
    const control = await migrationControl.capability().catch(() => ({ ready: false, blockers: ['control database 能力探测失败'], instances: [] }));
    const switchBlockers = [...(control.blockers || [])];
    if (!rename) switchBlockers.push('uploads 所在文件系统不支持目录 rename/fsync');
    if (!sameUploadDevice) switchBlockers.push('staging uploads 与 active uploads 不在同一文件系统');
    if (stagingNestedInActive) switchBlockers.push('staging 位于 active uploads 内部，无法安全交换目录');
    if (uploadMountRoot) switchBlockers.push('active uploads 是挂载根目录，无法安全 rename');
    const atomicDatabaseSwitch = switchBlockers.length === 0;
    const pathsSeparated = !blockers.some(item => /staging 必须|backup\/temp|backup 与 temp/.test(item));
    return { ready: blockers.length === 0, linux: this.platform === 'linux', explicitlyEnabled: this.allowReal, replicaSet, mongoTopology: hello.msg === 'isdbgrid' ? 'sharded' : replicaSet ? 'replicaSet' : 'standalone', mongodump: dump, mongorestore: restore, atomicDirectorySwitch: rename && sameUploadDevice, sameUploadDevice, atomicDatabaseSwitch, switchBlocker: atomicDatabaseSwitch ? '' : switchBlockers.join('；'), switchCapability: control, pathsSeparated, freeBytes, blockers };
  }

  dumpArgs(output, collections, dbName = mongoDbName(this.mongoUri), options = {}) {
    if (!Array.isArray(collections) || !collections.length) throw migrationError('MIGRATION_ALLOWLIST_EMPTY');
    const database = assertSafeDbName(dbName);
    const connectionArg = options.configFile
      ? `--config=${path.resolve(options.configFile)}`
      : '--uri';
    const args = options.configFile
      ? [connectionArg]
      : [connectionArg, this.mongoUri];
    args.push(`--archive=${path.resolve(output)}`, '--gzip', '--readPreference=primary');
    if (options.oplog) {
      // A full database namespace plus explicit exclusions is required: --oplog cannot
      // safely degrade to independent per-collection snapshots.
      args.push('--oplog', '--nsInclude', `${database}.*`);
      const included = new Set(collections.map(assertSafeDbName));
      for (const name of options.excluded || []) args.push('--nsExclude', `${database}.${assertSafeDbName(name)}`);
      if (options.existing?.some(name => !name.startsWith('system.') && !included.has(name) && !(options.excluded || []).includes(name))) throw migrationError('MIGRATION_COLLECTION_POLICY_UNSAFE');
    } else {
      for (const name of collections) args.push('--nsInclude', `${database}.${assertSafeDbName(name)}`);
    }
    return args;
  }

  restoreArgs(archive, targetDb, sourceDb = mongoDbName(this.mongoUri), collections = [], options = {}) {
    assertSafeDbName(targetDb); assertSafeDbName(sourceDb);
    const connectionArg = options.configFile ? `--config=${path.resolve(options.configFile)}` : '--uri';
    const args = options.configFile ? [connectionArg] : [connectionArg, this.mongoUri];
    args.push(`--archive=${path.resolve(archive)}`, '--gzip', '--stopOnError');
    for (const name of collections) args.push('--nsInclude', `${sourceDb}.${assertSafeDbName(name)}`);
    args.push('--nsFrom', `${sourceDb}.*`, '--nsTo', `${targetDb}.*`);
    return args;
  }

  async withMongoConfig(action) {
    const root = path.join(this.tempDir, '.credentials');
    await this.ensurePrivateDir(root);
    const file = path.join(root, `${crypto.randomUUID()}.json`);
    await this.fs.promises.writeFile(
      file,
      JSON.stringify({ uri: this.mongoUri }),
      { mode: 0o600, flag: 'wx' },
    );
    await this.fs.promises.chmod(file, 0o600);
    try {
      return await action(file);
    } finally {
      await this.fs.promises.rm(file, { force: true });
    }
  }

  async dump(output, collections, options = {}) {
    await this.fs.promises.mkdir(path.dirname(output), {
      recursive: true,
      mode: 0o700,
    });
    await this.withMongoConfig(configFile => this.exec(
      'mongodump',
      this.dumpArgs(
        output,
        collections,
        options.dbName || mongoDbName(this.mongoUri),
        { ...options, configFile },
      ),
      { timeout: 60 * 60 * 1000 },
    ));
    await this.fs.promises.chmod(output, 0o600);
  }

  async restore(archive, targetDb, sourceDb, collections) {
    await this.withMongoConfig(configFile => this.exec(
      'mongorestore',
      this.restoreArgs(archive, targetDb, sourceDb, collections, {
        configFile,
      }),
      { timeout: 60 * 60 * 1000 },
    ));
  }

}

module.exports = { MigrationRuntime, migrationError, mongoDbName, assertSafeDbName, isInside, redactArgs };
