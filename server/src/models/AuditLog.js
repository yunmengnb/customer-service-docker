// 忆梦云团队开发
const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  // login=登录日志, operation=操作日志
  type: { type: String, enum: ['login', 'operation'], required: true, index: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'TenantUser', default: null },
  username: { type: String, default: '', trim: true },
  displayName: { type: String, default: '', trim: true },
  role: { type: String, default: '' },
  // login / update_profile / update_email / update_password /
  // employee_create / employee_update / employee_delete / employee_reset_password /
  // channel_create / channel_update / channel_delete / channel_rotate_token / channel_set_agents
  action: { type: String, default: '', trim: true },
  detail: { type: String, default: '', trim: true },
  ip: { type: String, default: '', trim: true },
  userAgent: { type: String, default: '', trim: true },
  result: { type: String, enum: ['success', 'failure'], default: 'success', index: true },
}, { timestamps: true, versionKey: false });

AuditLogSchema.index({ tenantId: 1, createdAt: -1 });
AuditLogSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema, 'audit_logs');
