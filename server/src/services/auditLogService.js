// 忆梦云团队开发
const AuditLog = require('../models/AuditLog');
const { getClientIp } = require('../utils');

function basePayload(req, extra) {
  return {
    ip: getClientIp(req),
    userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 300),
    ...extra,
  };
}

// 日志记录采用 fire-and-forget，失败不影响业务主流程
function write(payload) {
  AuditLog.create(payload).catch(() => {});
}

function recordLogin({ req, tenantId = null, user = null, action = 'login', result = 'success', detail = '' }) {
  write(basePayload(req, {
    type: 'login',
    tenantId,
    userId: user?._id || user?.id || null,
    username: user?.username || '',
    displayName: user?.displayName || '',
    role: user?.role || '',
    action,
    detail,
    result,
  }));
}

function recordOperation({ req, tenantId, user, action, detail = '', result = 'success' }) {
  write(basePayload(req, {
    type: 'operation',
    tenantId,
    userId: user?._id || user?.id || null,
    username: user?.username || '',
    displayName: user?.displayName || '',
    role: user?.role || '',
    action,
    detail,
    result,
  }));
}

module.exports = { recordLogin, recordOperation };
