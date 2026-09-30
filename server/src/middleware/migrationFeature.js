// 忆梦云团队开发
const { error } = require('../utils');
const feature = require('../services/migrationFeature');

function guard(assertion, message, knownErrors) {
  return async (req, res, next) => {
    try {
      await assertion();
      return next();
    } catch (err) {
      if (!knownErrors.includes(err.message)) return next(err);
      return error(res, message, 5031, 503, { blockers: err.blockers || [] });
    }
  };
}

const requireMigrationManagement = guard(
  feature.assertManagementEnabled,
  '数据迁移管理功能当前未启用',
  ['MIGRATION_MANAGEMENT_DISABLED'],
);
const requireMigrationExecution = guard(
  feature.assertExecutionEnabled,
  '当前环境不允许执行数据迁移',
  ['MIGRATION_MANAGEMENT_DISABLED', 'MIGRATION_EXECUTION_DISABLED'],
);
const requireMigrationSwitch = guard(
  feature.assertSwitchEnabled,
  '当前环境不允许切换或回滚在线数据',
  ['MIGRATION_MANAGEMENT_DISABLED', 'MIGRATION_EXECUTION_DISABLED', 'MIGRATION_SWITCH_DISABLED'],
);

module.exports = {
  requireMigrationManagement,
  requireMigrationExecution,
  requireMigrationSwitch,
};
