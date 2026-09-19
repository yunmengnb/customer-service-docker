// 忆梦云团队开发
const express = require('express');
const router = express.Router();
const { authTenantUser, requireTenantAdmin, requireTenantOwner } = require('../middleware/auth');
const validators = require('../middleware/validators');
const { messageBody, messageHistory } = require('../middleware/messageParameters');

const TenantAuthController = require('../controllers/TenantAuthController');
const AgentController = require('../controllers/AgentController');
const ChannelController = require('../controllers/ChannelController');
const ChatController = require('../controllers/ChatController');
const AnnouncementController = require('../controllers/AnnouncementController');
const ConversationAttachmentController = require('../controllers/ConversationAttachmentController');
const CaptchaController = require('../controllers/CaptchaController');
const LogController = require('../controllers/LogController');
const SystemSettingController = require('../controllers/SystemSettingController');
const TenantAccountController = require('../controllers/TenantAccountController');
const IntegrationController = require('../controllers/IntegrationController');
const { verifyCaptcha } = require('../middleware/captcha');

// ===== 公开设置（注册页读取协议等）=====
router.get('/public-settings', SystemSettingController.getPublic);

// ===== 认证 =====
router.get('/auth/captcha', CaptchaController.create);
router.post('/auth/register-code', validators.emailCode, TenantAuthController.sendRegisterCode);
router.post('/auth/register', verifyCaptcha, validators.tenantRegister, TenantAuthController.register);
router.post('/auth/login', verifyCaptcha, validators.tenantLogin, TenantAuthController.login);
router.post('/auth/forgot-password/code', validators.emailCode, TenantAuthController.sendResetCode);
router.post('/auth/forgot-password/reset', validators.resetPassword, TenantAuthController.resetPassword);
router.get('/auth/me', authTenantUser, TenantAuthController.me);
router.post('/auth/logout', authTenantUser, TenantAuthController.logout);
router.patch('/auth/profile', authTenantUser, TenantAuthController.updateProfile);
router.post('/auth/profile/email-code', authTenantUser, validators.tenantProfileCode, TenantAuthController.sendProfileEmailCode);
router.patch('/auth/profile/email', authTenantUser, validators.tenantEmail, TenantAuthController.updateEmail);
router.patch('/auth/profile/password', authTenantUser, validators.tenantPassword, TenantAuthController.updatePassword);

// ===== 扩展应用（租户管理员）=====
router.get('/extensions', authTenantUser, requireTenantAdmin, IntegrationController.listTenantExtensions);
router.get('/extensions/jingpro', authTenantUser, requireTenantAdmin, IntegrationController.getTenantJingpro);
router.post('/extensions/jingpro', authTenantUser, requireTenantAdmin, IntegrationController.saveTenantJingpro);

// ===== 租户账户（仅所有者）=====
router.get('/account/overview', authTenantUser, requireTenantOwner, TenantAccountController.overview);
router.get('/account/points/transactions', authTenantUser, requireTenantOwner, TenantAccountController.transactions);

// ===== 日志 =====
router.get('/logs/login', authTenantUser, LogController.listLogin);
router.get('/logs/operation', authTenantUser, LogController.listOperation);

// ===== 公告（只读）=====
router.get('/announcements', authTenantUser, AnnouncementController.list);
router.get('/announcements/:id', authTenantUser, AnnouncementController.detail);

// ===== 员工管理 =====
router.get('/employees', authTenantUser, requireTenantAdmin, AgentController.list);
router.post('/employees', authTenantUser, requireTenantAdmin, validators.createAgent, AgentController.create);
router.patch('/employees/:id', authTenantUser, requireTenantAdmin, validators.updateAgent, AgentController.update);
router.delete('/employees/:id', authTenantUser, requireTenantAdmin, AgentController.delete);
router.post('/employees/:id/reset-password', authTenantUser, requireTenantAdmin, AgentController.resetPassword);
router.post('/employees/:id/login', authTenantUser, requireTenantAdmin, AgentController.loginAsEmployee);

// ===== 渠道管理 =====
router.get('/channels', authTenantUser, ChannelController.list);
router.post('/channels', authTenantUser, requireTenantAdmin, validators.createChannel, ChannelController.create);
router.get('/channels/:id', authTenantUser, ChannelController.detail);
router.patch('/channels/:id', authTenantUser, ChannelController.update);
router.delete('/channels/:id', authTenantUser, requireTenantAdmin, ChannelController.delete);
router.post('/channels/:id/rotate-token', authTenantUser, requireTenantAdmin, ChannelController.rotateToken);
router.put('/channels/:id/employees', authTenantUser, requireTenantAdmin, ChannelController.setAgents);

// 关键词回复
router.get('/channels/:channelId/keywords', authTenantUser, ChannelController.listKeywordReplies);
router.post('/channels/:channelId/keywords', authTenantUser, validators.keywordReply, ChannelController.createKeywordReply);
router.patch('/channels/:channelId/keywords/:krId', authTenantUser, validators.updateKeywordReply, ChannelController.updateKeywordReply);
router.delete('/channels/:channelId/keywords/:krId', authTenantUser, ChannelController.deleteKeywordReply);

// 快捷回复
router.get('/channels/:channelId/quick-replies', authTenantUser, ChannelController.listQuickReplies);
router.post('/channels/:channelId/quick-replies', authTenantUser, validators.quickReply, ChannelController.createQuickReply);
router.patch('/channels/:channelId/quick-replies/:qrId', authTenantUser, validators.updateQuickReply, ChannelController.updateQuickReply);
router.delete('/channels/:channelId/quick-replies/:qrId', authTenantUser, ChannelController.deleteQuickReply);

// ===== 会话与消息 =====
router.get('/conversations', authTenantUser, ChatController.listConversations);
router.get('/conversations/:id', authTenantUser, ChatController.conversationDetail);
router.post('/conversations/:id/accept', authTenantUser, ChatController.acceptConversation);
router.get('/conversations/:id/messages/search', authTenantUser, ChatController.searchConversationMessages);
router.get('/conversations/:id/messages', authTenantUser, messageHistory(['before', 'after', 'around']), ChatController.getMessages);
router.post('/conversations/:conversationId/attachments', authTenantUser, ConversationAttachmentController.uploadTenant);
router.post('/conversations/:id/messages', authTenantUser, messageBody, ChatController.agentSendMessage);
router.patch('/conversations/:id/customer-settings', authTenantUser, ChatController.updateCustomerSettings);
router.delete('/conversations/:id/messages', authTenantUser, ChatController.clearAgentMessages);
router.post('/conversations/:id/messages/:messageId/recall', authTenantUser, ChatController.recallMessage);
router.delete('/conversations/:id/messages/:messageId', authTenantUser, ChatController.deleteMessage);
router.post('/conversations/:id/close', authTenantUser, ChatController.closeConversation);

module.exports = router;
