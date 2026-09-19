// 忆梦云团队开发
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { authAdmin, requireSuperAdmin } = require('../middleware/auth');

const integrationImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype)
    ? cb(null, true)
    : cb(new Error('仅支持 JPG、PNG、GIF、WEBP 图片')),
});
const { integrationAuth } = require('../middleware/integrationAuth');
const IntegrationController = require('../controllers/IntegrationController');

// ===== Jingpro 联动对外 API（带签名校验）=====
router.get('/ping', integrationAuth, IntegrationController.ping);
router.post('/ensure-tenant-and-channel', integrationAuth, IntegrationController.ensureTenantAndChannel);
router.patch('/channels/:id', integrationAuth, IntegrationController.patchChannel);
router.post('/channels/:channelId/images', integrationAuth, (req, res) => {
  integrationImageUpload.single('file')(req, res, err => {
    if (err) return res.status(400).json({ code: 400001, msg: err.code === 'LIMIT_FILE_SIZE' ? '图片大小不能超过 5MB' : err.message, data: null });
    return IntegrationController.uploadImage(req, res);
  });
});
router.get('/channels/:channelId/keywords', integrationAuth, IntegrationController.listKeywordReplies);
router.post('/channels/:channelId/keywords', integrationAuth, IntegrationController.createKeywordReply);
router.patch('/channels/:channelId/keywords/:itemId', integrationAuth, IntegrationController.updateKeywordReply);
router.delete('/channels/:channelId/keywords/:itemId', integrationAuth, IntegrationController.deleteKeywordReply);
router.get('/channels/:channelId/quick-replies', integrationAuth, IntegrationController.listQuickReplies);
router.post('/channels/:channelId/quick-replies', integrationAuth, IntegrationController.createQuickReply);
router.patch('/channels/:channelId/quick-replies/:itemId', integrationAuth, IntegrationController.updateQuickReply);
router.delete('/channels/:channelId/quick-replies/:itemId', integrationAuth, IntegrationController.deleteQuickReply);

// 浏览器使用 JWT 登录，不要求浏览器持有平台 HMAC 密钥。
router.post('/employee-token-login', IntegrationController.employeeTokenLogin);
router.post('/sso-login', IntegrationController.ssoLogin);

// ===== 平台管理员设置（需要超级管理员）=====
router.get('/admin/setting', authAdmin, requireSuperAdmin, IntegrationController.getAdminSetting);
router.post('/admin/setting', authAdmin, requireSuperAdmin, IntegrationController.setAdminSetting);

module.exports = router;
