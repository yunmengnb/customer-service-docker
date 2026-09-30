// 忆梦云团队开发
const express = require('express');
const rateLimit = require('express-rate-limit');
const transfer = require('../services/migrationTransfer');
const { requireMigrationExecution } = require('../middleware/migrationFeature');

const router = express.Router();
const transferLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 4290, message: '迁移数据请求过于频繁' },
});

router.use(requireMigrationExecution);
router.post('/manifest', transferLimiter, transfer.jsonParser(), transfer.init);
router.get('/status', transferLimiter, transfer.status);
router.put('/chunks/:artifact/:index', transferLimiter, transfer.putChunk);
router.post('/finalize', transferLimiter, transfer.jsonParser(), transfer.complete);
router.post('/authorize-overwrite', transferLimiter, transfer.jsonParser(), transfer.authorizeOverwrite);
router.post('/abort', transferLimiter, transfer.jsonParser(), transfer.abort);
router.post('/rollback', transferLimiter, transfer.jsonParser(), transfer.rollback);

module.exports = router;
