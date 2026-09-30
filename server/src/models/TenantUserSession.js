// 忆梦云团队开发
const mongoose = require('mongoose');

const TenantUserSessionSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'TenantUser', required: true, index: true },
  fingerprint: { type: String, default: '', maxlength: 512 },
  deviceId: { type: String, default: '', maxlength: 200 },
  deviceType: { type: String, enum: ['app', 'web'], required: true },
  deviceName: { type: String, default: '', maxlength: 100 },
  browser: { type: String, default: '', maxlength: 100 },
  os: { type: String, default: '', maxlength: 100 },
  userAgent: { type: String, default: '', maxlength: 500 },
  ip: { type: String, default: '', maxlength: 100 },
  loginMethod: { type: String, enum: ['password', 'key', 'wechat'], required: true },
  wechatBindingId: mongoose.Schema.Types.ObjectId,
  wechatBindingVersion: Number,
  wechatConfigVersion: Number,
  lastSeenAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'TenantUser', default: null },
  revokeReason: { type: String, default: '', maxlength: 200 },
}, { timestamps: true, versionKey: false });

TenantUserSessionSchema.index({ userId: 1, revokedAt: 1, lastSeenAt: -1 });
TenantUserSessionSchema.index({ tenantId: 1, userId: 1, expiresAt: -1 });
TenantUserSessionSchema.index({ wechatBindingId: 1, revokedAt: 1 }, { partialFilterExpression: { loginMethod: 'wechat' } });

module.exports = mongoose.model('TenantUserSession', TenantUserSessionSchema, 'tenant_user_sessions');
