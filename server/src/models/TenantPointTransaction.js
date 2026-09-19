// 忆梦云团队开发
const mongoose = require('mongoose');

const TenantPointTransactionSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  delta: { type: Number, required: true, validate: Number.isSafeInteger },
  balanceAfter: { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER, validate: Number.isSafeInteger },
  type: { type: String, enum: ['grant', 'consume', 'refund', 'adjust', 'expire'], required: true },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  operatorType: { type: String, enum: ['platform_admin', 'system'], required: true },
  operatorId: { type: mongoose.Schema.Types.ObjectId, default: null },
  idempotencyKey: { type: String, trim: true, maxlength: 200 },
}, { timestamps: true, versionKey: false });

TenantPointTransactionSchema.index({ tenantId: 1, createdAt: -1 });
TenantPointTransactionSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('TenantPointTransaction', TenantPointTransactionSchema, 'tenant_point_transactions');
