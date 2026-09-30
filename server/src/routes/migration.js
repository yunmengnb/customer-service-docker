// 忆梦云团队开发
const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/MigrationController');
const { authAdmin, requireSuperAdmin } = require('../middleware/auth');
const { originGuard, requirePassword } = require('../middleware/migrationAdmin');
const {
  requireMigrationExecution,
  requireMigrationSwitch,
} = require('../middleware/migrationFeature');
const router = express.Router();
const strictLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { code: 4290, message: '迁移操作过于频繁' } });

router.post('/handshake', strictLimiter, requireMigrationExecution, controller.handshake.bind(controller));
router.use('/admin', authAdmin, requireSuperAdmin);
router.get('/admin/settings', controller.settings.bind(controller));
router.get('/admin/status', controller.settings.bind(controller));
router.get('/admin/capability', controller.capability.bind(controller));
router.post('/admin/settings/enable', strictLimiter, originGuard, requirePassword, controller.enable.bind(controller));
router.post('/admin/settings/disable', strictLimiter, originGuard, requirePassword, controller.disable.bind(controller));
router.get('/admin/overview', controller.overview.bind(controller));
router.get('/admin/tasks', controller.tasks.bind(controller));
router.get('/admin/tasks/:taskId/report', controller.report.bind(controller));
router.post('/admin/grants', strictLimiter, originGuard, requirePassword, requireMigrationExecution, controller.createGrant.bind(controller));
router.delete('/admin/grants/:id', strictLimiter, originGuard, requirePassword, controller.revokeGrant.bind(controller));
router.post('/admin/preflight', strictLimiter, originGuard, requirePassword, requireMigrationExecution, controller.sourcePreflight.bind(controller));
router.post('/admin/tasks/:taskId/start', strictLimiter, originGuard, requirePassword, requireMigrationExecution, controller.start.bind(controller));
router.post('/admin/tasks/:taskId/switch', strictLimiter, originGuard, requirePassword, requireMigrationSwitch, controller.switchTask.bind(controller));
router.post('/admin/tasks/:taskId/rollback', strictLimiter, originGuard, requirePassword, requireMigrationSwitch, controller.rollbackTask.bind(controller));
router.post('/admin/tasks/:taskId/cancel', strictLimiter, originGuard, requirePassword, controller.cancel.bind(controller));
module.exports = router;
