// 忆梦云团队开发 - APP 公开接口
const express = require('express');
const AppController = require('../controllers/AppController');

const router = express.Router();

router.get('/announcements', AppController.publicAnnouncements);
router.get('/announcements/:id', AppController.publicAnnouncementDetail);
router.get('/android/check-update', AppController.checkAndroidUpdate);
router.get('/android/version', AppController.getAndroidVersion);
router.get('/android/download', AppController.downloadAndroid);
router.get('/customer-center/announcements', AppController.publicCustomerAnnouncements);
router.get('/customer-center/announcements/:id', AppController.publicCustomerAnnouncementDetail);
router.get('/customer-center/android/check-update', AppController.checkCustomerAndroidUpdate);
router.get('/customer-center/android/version', AppController.getCustomerAndroidVersion);
router.get('/customer-center/android/download', AppController.downloadCustomerAndroid);

module.exports = router;
