// 忆梦云团队开发 - 私有会话附件路由
const express = require('express');
const { authAny } = require('../middleware/auth');
const FileController = require('../controllers/FileController');

const router = express.Router();
router.post('/:id/playback', authAny, FileController.issuePlayback);
router.head('/:id/playback/:nonce', FileController.playback);
router.get('/:id/playback/:nonce', FileController.playback);
router.get('/:id/status', authAny, FileController.status);
router.get('/:id/thumbnail', authAny, FileController.thumbnail);
router.get('/:id', authAny, FileController.original);

module.exports = router;
