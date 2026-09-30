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

// 默认调用方可忽略返回值；关键操作可 await，确保响应前已尝试持久化审计。
function write(payload) {
  return AuditLog.create(payload).catch(() => null);
}

function recordLogin({ req, tenantId = null, user = null, action = 'login', result = 'success', detail = '' }) {
  return write(basePayload(req, {
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
  return write(basePayload(req, {
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
