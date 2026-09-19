// 忆梦云团队开发
const express = require('express');
const router = express.Router();
const { authCustomer } = require('../middleware/auth');
const validators = require('../middleware/validators');
const { messageBody, messageHistory } = require('../middleware/messageParameters');

const CustomerAuthController = require('../controllers/CustomerAuthController');
const ChatController = require('../controllers/ChatController');
const CaptchaController = require('../controllers/CaptchaController');
const { verifyCaptcha } = require('../middleware/captcha');
const SystemSettingController = require('../controllers/SystemSettingController');
const ComplaintController = require('../controllers/ComplaintController');
const ConversationAttachmentController = require('../controllers/ConversationAttachmentController');

router.get('/public-settings', SystemSettingController.getPublic);

// 客户投诉
router.get('/complaints/captcha', authCustomer, CaptchaController.create);
router.post('/complaints/email-code', authCustomer, ComplaintController.sendEmailCode);
router.post('/complaints', authCustomer, verifyCaptcha, ComplaintController.create);

// 全局客户中心认证（无需渠道 Token）
router.get('/auth/captcha', CaptchaController.create);
router.post('/auth/login', verifyCaptcha, validators.customerLogin, CustomerAuthController.accountLogin);
router.post('/auth/register-code', validators.customerRegisterCode, CustomerAuthController.sendAccountRegisterCode);
router.post('/auth/register', verifyCaptcha, validators.customerRegister, CustomerAuthController.accountRegister);
router.post('/auth/forgot-password/code', validators.customerResetCode, CustomerAuthController.sendResetCode);
router.post('/auth/forgot-password/reset', validators.customerResetPassword, CustomerAuthController.resetPassword);

// 已登录客户访问过的渠道（必须置于动态 token 路由之前）
router.get('/channels/history', authCustomer, CustomerAuthController.channelHistory);
router.post('/channels/:token/switch', authCustomer, CustomerAuthController.switchChannel);

// 渠道公开信息
router.get('/channels/:token/captcha', CaptchaController.create);
router.get('/channels/:token', CustomerAuthController.getChannelInfo);

// 客户/访客登录与注册
router.post('/channels/:token/auth/guest', validators.customerGuest, CustomerAuthController.guest);
router.post('/channels/:token/auth/login', verifyCaptcha, validators.customerLogin, CustomerAuthController.login);
router.post('/channels/:token/auth/register-code', validators.customerRegisterCode, CustomerAuthController.sendRegisterCode);
router.post('/channels/:token/auth/register', verifyCaptcha, validators.customerRegister, CustomerAuthController.register);

// 客户资料
router.get('/me', authCustomer, CustomerAuthController.me);
router.post('/profile/qq', authCustomer, validators.customerQQ, CustomerAuthController.updateQQ);
router.post('/profile/password-code', authCustomer, CustomerAuthController.sendProfilePasswordCode);
router.post('/profile/password', authCustomer, validators.customerPassword, CustomerAuthController.updatePassword);

// 会话与消息
router.get('/conversation', authCustomer, ChatController.getClientConversation);
router.get('/conversation/messages', authCustomer, messageHistory(['before', 'after']), ChatController.getClientMessages);
router.post('/conversation/attachments', authCustomer, ConversationAttachmentController.uploadCustomer);
router.post('/conversation/messages', authCustomer, messageBody, ChatController.customerSendMessage);
router.post('/conversation/messages/:messageId/recall', authCustomer, ChatController.customerRecallMessage);
router.delete('/conversation/messages/:messageId', authCustomer, ChatController.customerDeleteMessage);

module.exports = router;
