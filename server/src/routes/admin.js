// 忆梦云团队开发
const express = require('express');
const router = express.Router();
const { authAdmin, requireSuperAdmin } = require('../middleware/auth');
const validators = require('../middleware/validators');
const { messageHistory } = require('../middleware/messageParameters');

const AdminAuthController = require('../controllers/AdminAuthController');
const AdminCustomerController = require('../controllers/AdminCustomerController');
const AdminConversationController = require('../controllers/AdminConversationController');
const AnnouncementController = require('../controllers/AnnouncementController');
const TenantAdminController = require('../controllers/TenantAdminController');
const SystemSettingController = require('../controllers/SystemSettingController');
const VersionController = require('../controllers/VersionController');
const AppController = require('../controllers/AppController');
const ComplaintController = require('../controllers/ComplaintController');
const StorageController = require('../controllers/StorageController');
const DataManagementController = require('../controllers/DataManagementController');
const AdminTenantAccountController = require('../controllers/AdminTenantAccountController');
// ===== 认证 =====
router.post('/auth/login', validators.adminLogin, AdminAuthController.login);
router.post('/auth/logout', authAdmin, AdminAuthController.logout);
router.get('/auth/me', authAdmin, AdminAuthController.me);
router.patch('/auth/profile', authAdmin, AdminAuthController.updateProfile);

// ===== 只读（所有已登录 admin 都可访问）=====
router.get('/dashboard', authAdmin, TenantAdminController.dashboard);
router.get('/tenants', authAdmin, TenantAdminController.list);
router.get('/tenants/:id/account', authAdmin, AdminTenantAccountController.account);
router.get('/tenants/:id/points/transactions', authAdmin, AdminTenantAccountController.transactions);
router.get('/tenants/:id', authAdmin, TenantAdminController.detail);
router.get('/customers', authAdmin, AdminCustomerController.list);
router.get('/conversations', authAdmin, AdminConversationController.list);
router.get('/conversations/:id/messages/search', authAdmin, AdminConversationController.searchMessages);
router.get('/conversations/:id/messages', authAdmin, messageHistory(['before', 'around']), AdminConversationController.messages);
router.get('/complaints', authAdmin, ComplaintController.adminList);
router.get('/complaints/:id', authAdmin, ComplaintController.adminDetail);
router.get('/announcements', authAdmin, AnnouncementController.adminList);
router.get('/app/announcements', authAdmin, AppController.adminAnnouncementList);
router.get('/app/android/versions', authAdmin, AppController.adminVersionList);
router.get('/app/customer-center/android/versions', authAdmin, AppController.adminCustomerVersionList);
router.get('/version', authAdmin, VersionController.get);
router.get('/data/overview', authAdmin, DataManagementController.overview);

// ===== 敏感写操作（需要超级管理员）=====
router.post('/announcements', authAdmin, requireSuperAdmin, validators.createAnnouncement, AnnouncementController.create);
router.put('/announcements/:id', authAdmin, requireSuperAdmin, validators.updateAnnouncement, AnnouncementController.update);
router.patch('/announcements/:id/status', authAdmin, requireSuperAdmin, validators.updateAnnouncementStatus, AnnouncementController.updateStatus);
router.delete('/announcements/:id', authAdmin, requireSuperAdmin, AnnouncementController.remove);
router.post('/app/announcements', authAdmin, requireSuperAdmin, validators.createAnnouncement, AppController.createAnnouncement);
router.put('/app/announcements/:id', authAdmin, requireSuperAdmin, validators.updateAnnouncement, AppController.updateAnnouncement);
router.patch('/app/announcements/:id/status', authAdmin, requireSuperAdmin, validators.updateAnnouncementStatus, AppController.updateAnnouncementStatus);
router.delete('/app/announcements/:id', authAdmin, requireSuperAdmin, AppController.removeAnnouncement);
router.post('/app/android/versions', authAdmin, requireSuperAdmin, validators.appVersion, AppController.createVersion);
router.put('/app/android/versions/:id', authAdmin, requireSuperAdmin, validators.appVersion, AppController.updateVersion);
router.patch('/app/android/versions/:id/status', authAdmin, requireSuperAdmin, validators.updateAnnouncementStatus, AppController.updateVersionStatus);
router.delete('/app/android/versions/:id', authAdmin, requireSuperAdmin, AppController.removeVersion);
router.post('/app/customer-center/android/versions', authAdmin, requireSuperAdmin, validators.appVersion, AppController.createCustomerVersion);
router.put('/app/customer-center/android/versions/:id', authAdmin, requireSuperAdmin, validators.appVersion, AppController.updateCustomerVersion);
router.patch('/app/customer-center/android/versions/:id/status', authAdmin, requireSuperAdmin, validators.updateAnnouncementStatus, AppController.updateCustomerVersionStatus);
router.delete('/app/customer-center/android/versions/:id', authAdmin, requireSuperAdmin, AppController.removeCustomerVersion);
router.patch('/tenants/:id/membership', authAdmin, requireSuperAdmin, AdminTenantAccountController.updateMembership);
router.post('/tenants/:id/points/adjust', authAdmin, requireSuperAdmin, AdminTenantAccountController.adjustPoints);
router.patch('/tenants/:id', authAdmin, requireSuperAdmin, TenantAdminController.update);
router.patch('/tenants/:id/status', authAdmin, requireSuperAdmin, TenantAdminController.updateStatus);
router.patch('/tenants/:id/plan', authAdmin, requireSuperAdmin, TenantAdminController.updatePlan);
router.patch('/customers/:id', authAdmin, requireSuperAdmin, AdminCustomerController.update);
router.patch('/customers/:id/status', authAdmin, requireSuperAdmin, AdminCustomerController.updateStatus);
router.get('/settings', authAdmin, requireSuperAdmin, SystemSettingController.get);
router.put('/settings', authAdmin, requireSuperAdmin, SystemSettingController.update);
router.post('/settings/test-email', authAdmin, requireSuperAdmin, SystemSettingController.testEmail);
router.post('/storage/conversation-files/estimate', authAdmin, requireSuperAdmin, StorageController.estimate);
router.post('/storage/conversation-files/cleanup', authAdmin, requireSuperAdmin, StorageController.cleanup);
router.get('/storage/conversation-files/status', authAdmin, requireSuperAdmin, StorageController.status);
router.post('/data/cleanup', authAdmin, requireSuperAdmin, DataManagementController.cleanup);
router.get('/data/export', authAdmin, requireSuperAdmin, DataManagementController.exportData);
router.patch('/complaints/:id/status', authAdmin, requireSuperAdmin, ComplaintController.updateStatus);

module.exports = router;