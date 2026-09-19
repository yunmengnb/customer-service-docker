// 忆梦云团队开发 - APP 公告与 Android 版本接口
const mongoose = require('mongoose');
const Announcement = require('../models/Announcement');
const AppVersion = require('../models/AppVersion');
const { ok, error } = require('../utils');

function pagination(query, defaultLimit = 10) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), 100);
  return { page, limit };
}

function validId(id) {
  return mongoose.isValidObjectId(id);
}

class AppController {
  constructor() {
    [
      'createVersion',
      'createCustomerVersion',
      'updateVersion',
      'updateCustomerVersion',
      'updateVersionStatus',
      'updateCustomerVersionStatus',
      'removeVersion',
      'removeCustomerVersion',
      'publicAnnouncements',
      'publicCustomerAnnouncements',
      'publicAnnouncementDetail',
      'publicCustomerAnnouncementDetail',
      'checkAndroidUpdate',
      'checkCustomerAndroidUpdate',
    ].forEach(method => {
      this[method] = this[method].bind(this);
    });
  }

  async adminAnnouncementList(req, res) {
    const { page, limit } = pagination(req.query);
    const where = { audience: 'app' };
    if (['staff', 'customer'].includes(req.query.appType)) {
      where.appType = req.query.appType === 'staff' ? { $in: ['staff', null] } : 'customer';
    }
    if (['draft', 'published'].includes(req.query.status)) where.status = req.query.status;

    const [items, total] = await Promise.all([
      Announcement.find(where).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Announcement.countDocuments(where),
    ]);
    return ok(res, { items, total, page, limit });
  }

  async createAnnouncement(req, res) {
    const status = req.body.status || 'draft';
    const announcement = await Announcement.create({
      title: String(req.body.title).trim(),
      content: String(req.body.content).trim(),
      audience: 'app',
      appType: req.body.appType === 'customer' ? 'customer' : 'staff',
      status,
      publishedAt: status === 'published' ? new Date() : null,
    });
    res.status(201);
    return ok(res, announcement.toJSON(), 'APP 公告创建成功');
  }

  async updateAnnouncement(req, res) {
    if (!validId(req.params.id)) return error(res, '公告 ID 无效');
    const announcement = await Announcement.findOne({ _id: req.params.id, audience: 'app' });
    if (!announcement) return error(res, 'APP 公告不存在', 404, 404);

    announcement.title = String(req.body.title).trim();
    announcement.content = String(req.body.content).trim();
    announcement.appType = req.body.appType === 'customer' ? 'customer' : 'staff';
    if (req.body.status && req.body.status !== announcement.status) {
      announcement.status = req.body.status;
      announcement.publishedAt = req.body.status === 'published' ? new Date() : null;
    }
    await announcement.save();
    return ok(res, announcement.toJSON(), 'APP 公告更新成功');
  }

  async updateAnnouncementStatus(req, res) {
    if (!validId(req.params.id)) return error(res, '公告 ID 无效');
    const announcement = await Announcement.findOne({ _id: req.params.id, audience: 'app' });
    if (!announcement) return error(res, 'APP 公告不存在', 404, 404);

    announcement.status = req.body.status;
    announcement.publishedAt = req.body.status === 'published' ? new Date() : null;
    await announcement.save();
    return ok(res, announcement.toJSON(), req.body.status === 'published' ? 'APP 公告已发布' : 'APP 公告已下架');
  }

  async removeAnnouncement(req, res) {
    if (!validId(req.params.id)) return error(res, '公告 ID 无效');
    const announcement = await Announcement.findOne({ _id: req.params.id, audience: 'app' });
    if (!announcement) return error(res, 'APP 公告不存在', 404, 404);

    await announcement.deleteOne();
    return ok(res, null, 'APP 公告删除成功');
  }

  async publicAnnouncements(req, res) {
    return this.publicAnnouncementsFor('staff', req, res);
  }

  async publicCustomerAnnouncements(req, res) {
    return this.publicAnnouncementsFor('customer', req, res);
  }

  async publicAnnouncementsFor(appType, req, res) {
    const { page, limit } = pagination(req.query, 20);
    const appTypeQuery = appType === 'staff' ? { $in: ['staff', null] } : 'customer';
    const where = {
      audience: 'app',
      appType: appTypeQuery,
      status: 'published',
      publishedAt: { $lte: new Date() },
    };
    const [items, total] = await Promise.all([
      Announcement.find(where).sort({ publishedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Announcement.countDocuments(where),
    ]);
    return ok(res, { items, total, page, limit });
  }

  async publicAnnouncementDetail(req, res) {
    return this.publicAnnouncementDetailFor('staff', req, res);
  }

  async publicCustomerAnnouncementDetail(req, res) {
    return this.publicAnnouncementDetailFor('customer', req, res);
  }

  async publicAnnouncementDetailFor(appType, req, res) {
    if (!validId(req.params.id)) return error(res, '公告 ID 无效');
    const appTypeQuery = appType === 'staff' ? { $in: ['staff', null] } : 'customer';
    const announcement = await Announcement.findOne({
      _id: req.params.id,
      audience: 'app',
      appType: appTypeQuery,
      status: 'published',
      publishedAt: { $lte: new Date() },
    }).lean();
    if (!announcement) return error(res, 'APP 公告不存在', 404, 404);
    return ok(res, announcement);
  }

  async adminVersionList(req, res) {
    const { page, limit } = pagination(req.query);
    const where = { platform: 'android', appType: { $in: ['staff', null] } };
    if (['draft', 'published'].includes(req.query.status)) where.status = req.query.status;

    const [items, total] = await Promise.all([
      AppVersion.find(where).sort({ versionCode: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AppVersion.countDocuments(where),
    ]);
    return ok(res, { items, total, page, limit });
  }

  async createVersion(req, res) {
    return this.createVersionFor('staff', req, res);
  }

  async createCustomerVersion(req, res) {
    return this.createVersionFor('customer', req, res);
  }

  async createVersionFor(appType, req, res) {
    const status = req.body.status || 'draft';
    const version = await AppVersion.create({
      platform: 'android',
      appType,
      versionCode: req.body.versionCode,
      versionName: String(req.body.versionName).trim(),
      downloadUrl: String(req.body.downloadUrl).trim(),
      releaseNotes: String(req.body.releaseNotes || '').trim(),
      forceUpdate: req.body.forceUpdate === true,
      downloadEnabled: req.body.downloadEnabled !== false,
      minSupportedVersionCode: req.body.minSupportedVersionCode || 1,
      status,
      publishedAt: status === 'published' ? new Date() : null,
    });
    res.status(201);
    return ok(res, version.toJSON(), `${appType === 'customer' ? '客户中心' : '坐席'} Android 版本创建成功`);
  }

  async updateVersion(req, res) {
    return this.updateVersionFor('staff', req, res);
  }

  async updateCustomerVersion(req, res) {
    return this.updateVersionFor('customer', req, res);
  }

  async updateVersionFor(appType, req, res) {
    if (!validId(req.params.id)) return error(res, '版本 ID 无效');
    const appTypeQuery = appType === 'staff' ? { $in: ['staff', null] } : 'customer';
    const version = await AppVersion.findOne({ _id: req.params.id, platform: 'android', appType: appTypeQuery });
    if (!version) return error(res, 'Android 版本不存在', 404, 404);

    version.appType = appType;
    version.versionCode = req.body.versionCode;
    version.versionName = String(req.body.versionName).trim();
    version.downloadUrl = String(req.body.downloadUrl).trim();
    version.releaseNotes = String(req.body.releaseNotes || '').trim();
    version.forceUpdate = req.body.forceUpdate === true;
    version.downloadEnabled = req.body.downloadEnabled !== false;
    version.minSupportedVersionCode = req.body.minSupportedVersionCode || 1;
    if (req.body.status && req.body.status !== version.status) {
      version.status = req.body.status;
      version.publishedAt = req.body.status === 'published' ? new Date() : null;
    }
    await version.save();
    return ok(res, version.toJSON(), 'Android 版本更新成功');
  }

  async adminCustomerVersionList(req, res) {
    const { page, limit } = pagination(req.query);
    const where = { platform: 'android', appType: 'customer' };
    if (['draft', 'published'].includes(req.query.status)) where.status = req.query.status;
    const [items, total] = await Promise.all([
      AppVersion.find(where).sort({ versionCode: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AppVersion.countDocuments(where),
    ]);
    return ok(res, { items, total, page, limit });
  }

  async updateVersionStatus(req, res) {
    return this.updateVersionStatusFor('staff', req, res);
  }

  async updateCustomerVersionStatus(req, res) {
    return this.updateVersionStatusFor('customer', req, res);
  }

  async updateVersionStatusFor(appType, req, res) {
    if (!validId(req.params.id)) return error(res, '版本 ID 无效');
    const appTypeQuery = appType === 'staff' ? { $in: ['staff', null] } : 'customer';
    const version = await AppVersion.findOne({ _id: req.params.id, platform: 'android', appType: appTypeQuery });
    if (!version) return error(res, 'Android 版本不存在', 404, 404);

    version.appType = appType;
    version.status = req.body.status;
    version.publishedAt = req.body.status === 'published' ? new Date() : null;
    await version.save();
    return ok(res, version.toJSON(), req.body.status === 'published' ? 'Android 版本已发布' : 'Android 版本已下架');
  }

  async removeVersion(req, res) {
    return this.removeVersionFor('staff', req, res);
  }

  async removeCustomerVersion(req, res) {
    return this.removeVersionFor('customer', req, res);
  }

  async removeVersionFor(appType, req, res) {
    if (!validId(req.params.id)) return error(res, '版本 ID 无效');
    const appTypeQuery = appType === 'staff' ? { $in: ['staff', null] } : 'customer';
    const version = await AppVersion.findOneAndDelete({ _id: req.params.id, platform: 'android', appType: appTypeQuery });
    if (!version) return error(res, 'Android 版本不存在', 404, 404);
    return ok(res, null, 'Android 版本删除成功');
  }

  async checkAndroidUpdate(req, res) {
    return this.checkAndroidUpdateFor('staff', req, res);
  }

  async checkCustomerAndroidUpdate(req, res) {
    return this.checkAndroidUpdateFor('customer', req, res);
  }

  async checkAndroidUpdateFor(appType, req, res) {
    const currentVersionCode = Number.parseInt(req.query.versionCode, 10);
    if (!Number.isInteger(currentVersionCode) || currentVersionCode < 1) {
      return error(res, 'versionCode 必须为正整数');
    }

    const appTypeQuery = appType === 'staff' ? { $in: ['staff', null] } : 'customer';
    const version = await AppVersion.findOne({
      platform: 'android',
      appType: appTypeQuery,
      status: 'published',
      publishedAt: { $lte: new Date() },
    }).sort({ versionCode: -1 }).lean();
    const hasUpdate = Boolean(version && version.versionCode > currentVersionCode);
    const result = version && hasUpdate ? {
      ...version,
      forceUpdate: Boolean(version.forceUpdate || currentVersionCode < (version.minSupportedVersionCode || 1)),
      downloadUrl: version.downloadEnabled === false ? '' : version.downloadUrl,
    } : null;

    return ok(res, { hasUpdate, version: result });
  }

  async getCustomerAndroidVersion(req, res) {
    const version = await AppVersion.findOne({
      platform: 'android',
      appType: 'customer',
      status: 'published',
      publishedAt: { $lte: new Date() },
    }).sort({ versionCode: -1 }).lean();
    if (!version) return error(res, '客户 Android 版本暂未发布', 404, 404);
    return ok(res, {
      ...version,
      downloadUrl: version.downloadEnabled === false ? '' : version.downloadUrl,
    });
  }

  async downloadCustomerAndroid(req, res) {
    const version = await AppVersion.findOne({
      platform: 'android',
      appType: 'customer',
      status: 'published',
      publishedAt: { $lte: new Date() },
    }).sort({ versionCode: -1 }).lean();
    if (!version) return error(res, '客户 Android 版本暂未发布', 404, 404);
    if (version.downloadEnabled === false) return error(res, '客户 Android APP 暂停下载', 403, 403);
    return res.redirect(302, version.downloadUrl);
  }
}

module.exports = new AppController();