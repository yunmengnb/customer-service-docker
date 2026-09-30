// 忆梦云团队开发
const config = require('../config');
const MigrationSetting = require('../models/MigrationSetting');
const MigrationTask = require('../models/MigrationTask');
const migrationControl = require('./migrationControl');
const { getClientIp } = require('../utils');

const UNSAFE_DISABLE_STATES = Object.freeze([
  'quiescing',
  'switching',
  'restart_pending',
  'rolling_back',
  'manual_intervention',
]);
const ACTIVE_STATES = Object.freeze([
  'preflight',
  'awaiting_confirmation',
  'freezing_source',
  'exporting',
  'transferring',
  'target_backup',
  'importing_staging',
  'verifying',
  'staging_verified',
  ...UNSAFE_DISABLE_STATES,
]);

async function getSetting() {
  return MigrationSetting.getSingleton();
}

function controlStoreAvailable() {
  const connection = migrationControl.getConnection();
  return Boolean(connection?.db && connection.readyState === 1);
}

function environmentBlockers() {
  const blockers = [];
  if (!config.migration.featureAvailable) {
    blockers.push(
      '部署未设置 MIGRATION_FEATURE_AVAILABLE=true，管理员不能在界面启用管理功能',
    );
  }
  return blockers;
}

function executionBlockers() {
  const blockers = [];
  if (!config.migration.dataPlaneEnabled) {
    blockers.push('部署 kill switch MIGRATION_DATA_PLANE_ENABLED=false');
  }
  if (!config.migration.masterKeyExplicit) {
    blockers.push(
      '未显式配置独立的 MIGRATION_MASTER_KEY，不能安全生成迁移密钥或执行迁移',
    );
  }
  if (config.migration.dataPlaneEnabled && !controlStoreAvailable()) {
    blockers.push('迁移控制库当前不可用');
  }
  return blockers;
}

function switchBlockers() {
  const blockers = [];
  if (!config.migration.activePointerEnabled) {
    blockers.push(
      '部署未设置 MIGRATION_ACTIVE_POINTER_ENABLED=true，不能安全切换活动数据指针',
    );
  }
  return blockers;
}

function publicSetting(setting) {
  return {
    enabled: Boolean(setting?.enabled),
    version: Number(setting?.version) || 1,
    updatedAt: setting?.updatedAt || null,
    updatedBy: setting?.updatedByUsername || '',
    featureAvailable: config.migration.featureAvailable,
    dataPlaneEnabled: config.migration.dataPlaneEnabled,
    activePointerEnabled: config.migration.activePointerEnabled,
    controlStoreAvailable: controlStoreAvailable(),
    environmentBlockers: environmentBlockers(),
    executionBlockers: executionBlockers(),
    switchBlockers: switchBlockers(),
  };
}

async function status() {
  return publicSetting(await getSetting());
}

function blockedError(name, blockers) {
  const error = new Error(name);
  error.blockers = blockers;
  return error;
}

async function assertManagementEnabled() {
  const current = await status();
  const blockers = [...current.environmentBlockers];
  if (!current.enabled) {
    blockers.push('管理员尚未在界面启用数据迁移管理功能');
  }
  if (blockers.length) {
    throw blockedError('MIGRATION_MANAGEMENT_DISABLED', blockers);
  }
  return current;
}

async function assertExecutionEnabled() {
  const current = await assertManagementEnabled();
  if (current.executionBlockers.length) {
    throw blockedError(
      'MIGRATION_EXECUTION_DISABLED',
      current.executionBlockers,
    );
  }
  return current;
}

async function assertSwitchEnabled() {
  const current = await assertExecutionEnabled();
  if (current.switchBlockers.length) {
    throw blockedError('MIGRATION_SWITCH_DISABLED', current.switchBlockers);
  }
  return current;
}

async function activeTask() {
  if (!controlStoreAvailable()) {
    if (!migrationControl.controlEnabled()) return null;
    throw blockedError(
      'MIGRATION_TASK_STATE_UNAVAILABLE',
      ['迁移控制库不可用，无法确认是否存在活动任务，已拒绝停用'],
    );
  }
  const unsafe = await MigrationTask.findOne({
    state: { $in: UNSAFE_DISABLE_STATES },
  }).select('taskId state').lean();
  if (unsafe) return { unsafe: true, task: unsafe };
  const active = await MigrationTask.findOne({
    state: { $in: ACTIVE_STATES },
  }).select('taskId state').lean();
  return active ? { unsafe: false, task: active } : null;
}

async function setEnabled(req, enabled) {
  const current = await getSetting();
  if (Boolean(current.enabled) === enabled) return current;
  if (enabled) {
    const blockers = environmentBlockers();
    if (blockers.length) {
      throw blockedError('MIGRATION_FEATURE_UNAVAILABLE', blockers);
    }
  } else {
    const found = await activeTask();
    if (found) {
      const error = new Error(
        found.unsafe ? 'MIGRATION_DISABLE_UNSAFE' : 'MIGRATION_ACTIVE_TASK',
      );
      error.task = found.task;
      throw error;
    }
  }
  const now = new Date();
  return MigrationSetting.findOneAndUpdate(
    { singletonKey: 'migration-feature' },
    {
      $set: {
        enabled,
        updatedBy: req.admin.id,
        updatedByUsername: String(req.admin.username || ''),
        updatedFromIp: getClientIp(req),
        updatedUserAgent: String(req.headers['user-agent'] || '').slice(0, 300),
        ...(enabled ? { enabledAt: now } : { disabledAt: now }),
      },
      $inc: { version: 1 },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

module.exports = {
  UNSAFE_DISABLE_STATES,
  ACTIVE_STATES,
  status,
  setEnabled,
  assertManagementEnabled,
  assertExecutionEnabled,
  assertSwitchEnabled,
  controlStoreAvailable,
};
