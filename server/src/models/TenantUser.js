// 忆梦云团队开发
const mongoose = require('mongoose');

const TenantUserSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  },
  username: {
    type: String,
    required: true,
    trim: true,
    minlength: 3,
    maxlength: 50,
  },
  password: {
    type: String,
    required: true,
  },
  displayName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50,
  },
  role: {
    type: String,
    enum: ['owner', 'admin', 'agent'],
    default: 'agent',
  },
  avatarUrl: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ['active', 'disabled'],
    default: 'active',
  },
  lastLoginAt: {
    type: Date,
  },
}, {
  timestamps: true,
  versionKey: false,
});

// 同一租户内 username 唯一
TenantUserSchema.index({ tenantId: 1, username: 1 }, { unique: true });

TenantUserSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('TenantUser', TenantUserSchema, 'tenant_users');
