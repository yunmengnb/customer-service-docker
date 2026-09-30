// 忆梦云团队开发
const mongoose = require('mongoose');

const TenantUserLoginKeySchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'TenantUser', required: true, unique: true, index: true },
  keyId: { type: String, required: true, unique: true, index: true, maxlength: 64 },
  secretDigest: { type: String, required: true, select: false },
  source: { type: String, enum: ['tenant', 'jingpro'], default: 'tenant' },
  expiresAt: { type: Date, required: true, index: true },
  consumedAt: { type: Date, default: null },
  lastUsedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('TenantUserLoginKey', TenantUserLoginKeySchema, 'tenant_user_login_keys');
