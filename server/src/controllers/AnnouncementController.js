// 忆梦云团队开发 - 公告管理与租户公告查询
const mongoose = require('mongoose');
const Announcement = require('../models/Announcement');
const { ok, error } = require('../utils');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validAnnouncementId(req, res) {
  if (mongoose.isValidObjectId(req.params.id)) return true;
  error(res, '公告 ID 无效');
  return false;
}

class AnnouncementController {
  // GET /api/admin/announcements
  async adminList(req, res) {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const where = { audience: { $in: ['tenant', null] } };

    if (['draft', 'published'].includes(req.query.status)) where.status = req.query.status;
    const keyword = String(req.query.keyword || '').trim();
    if (keyword) {
      const pattern = escapeRegExp(keyword);
      where.$or = [
        { title: { $regex: pattern, $options: 'i' } },
        { content: { $regex: pattern, $options: 'i' } },
      ];
    }

    const [items, total] = await Promise.all([
      Announcement.find(where)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Announcement.countDocuments(where),
    ]);

    return ok(res, { items, total, page, limit });
  }

  // POST /api/admin/announcements
  async create(req, res) {
    const status = req.body.status || 'draft';
    const announcement = await Announcement.create({
      title: String(req.body.title).trim(),
      content: String(req.body.content).trim(),
      audience: 'tenant',
      status,
      publishedAt: status === 'published' ? new Date() : null,
    });

    res.status(201);
    return ok(res, announcement.toJSON(), '公告创建成功');
  }

  // PUT /api/admin/announcements/:id
  async update(req, res) {
    if (!validAnnouncementId(req, res)) return undefined;

    const announcement = await Announcement.findOne({ _id: req.params.id, audience: { $in: ['tenant', null] } });
    if (!announcement) return error(res, '公告不存在', 404, 404);

    announcement.title = String(req.body.title).trim();
    announcement.content = String(req.body.content).trim();
    if (req.body.status && req.body.status !== announcement.status) {
      announcement.status = req.body.status;
      announcement.publishedAt = req.body.status === 'published' ? new Date() : null;
    }
    await announcement.save();

    return ok(res, announcement.toJSON(), '公告更新成功');
  }

  // PATCH /api/admin/announcements/:id/status
  async updateStatus(req, res) {
    if (!validAnnouncementId(req, res)) return undefined;

    const announcement = await Announcement.findOne({ _id: req.params.id, audience: { $in: ['tenant', null] } });
    if (!announcement) return error(res, '公告不存在', 404, 404);

    const status = req.body.status;
    announcement.status = status;
    announcement.publishedAt = status === 'published' ? new Date() : null;
    await announcement.save();

    return ok(res, announcement.toJSON(), status === 'published' ? '公告已上架' : '公告已下架');
  }

  // DELETE /api/admin/announcements/:id
  async remove(req, res) {
    if (!validAnnouncementId(req, res)) return undefined;

    const announcement = await Announcement.findOne({ _id: req.params.id, audience: { $in: ['tenant', null] } });
    if (!announcement) return error(res, '公告不存在', 404, 404);
    if (announcement.key) return error(res, '系统内置公告受保护，不能删除', 403, 403);

    await announcement.deleteOne();
    return ok(res, null, '公告删除成功');
  }

  // GET /api/tenant/announcements
  async list(req, res) {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const where = {
      audience: { $in: ['tenant', null] },
      status: 'published',
      publishedAt: { $lte: new Date() },
    };

    const [items, total] = await Promise.all([
      Announcement.find(where)
        .sort({ publishedAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Announcement.countDocuments(where),
    ]);

    return ok(res, { items, total, page, limit });
  }

  // GET /api/tenant/announcements/:id
  async detail(req, res) {
    if (!mongoose.isValidObjectId(req.params.id)) return error(res, '公告 ID 无效');

    const announcement = await Announcement.findOne({
      _id: req.params.id,
      audience: { $in: ['tenant', null] },
      status: 'published',
      publishedAt: { $lte: new Date() },
    }).lean();
    if (!announcement) return error(res, '公告不存在', 404, 404);

    return ok(res, announcement);
  }
}

module.exports = new AnnouncementController();
