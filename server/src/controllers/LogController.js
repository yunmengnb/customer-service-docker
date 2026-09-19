// 忆梦云团队开发
const AuditLog = require('../models/AuditLog');
const { ok, error } = require('../utils');

function parsePaging(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

class LogController {
  async listLogin(req, res) {
    const { tenantId, user } = req;
    const { page, limit, skip } = parsePaging(req.query);
    const where = { tenantId, type: 'login' };
    if (user.role === 'agent') where.userId = user.id;
    const [items, total] = await Promise.all([
      AuditLog.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(where),
    ]);
    return ok(res, { items, total, page, limit });
  }

  async listOperation(req, res) {
    const { tenantId, user } = req;
    const { page, limit, skip } = parsePaging(req.query);
    const where = { tenantId, type: 'operation' };
    if (user.role === 'agent') where.userId = user.id;
    const [items, total] = await Promise.all([
      AuditLog.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(where),
    ]);
    return ok(res, { items, total, page, limit });
  }
}

module.exports = new LogController();
