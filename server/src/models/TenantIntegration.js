const mongoose = require('mongoose');

const TenantIntegrationSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  },
  provider: {
    type: String,
    required: true,
    enum: ['jingpro'],
    default: 'jingpro',
  },
  platformName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  platformUrl: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500,
  },
  keyId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
  },
  platformSecret: {
    type: String,
    required: true,
    select: false,
  },
  enabled: {
    type: Boolean,
    default: false,
  },
  status: {
    type: String,
    enum: ['unverified', 'active', 'error', 'disabled'],
    default: 'unverified',
  },
  lastVerifiedAt: Date,
  lastUsedAt: Date,
}, {
  timestamps: true,
  versionKey: false,
});

TenantIntegrationSchema.index(
  { tenantId: 1, provider: 1 },
  { unique: true, name: 'idx_tenant_provider' },
);

module.exports = mongoose.model('TenantIntegration', TenantIntegrationSchema, 'tenant_integrations');
