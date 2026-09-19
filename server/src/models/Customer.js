// 忆梦云团队开发
const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomerAccount',
    index: true,
    default: null,
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  },
  channelId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Channel',
    required: true,
    index: true,
  },
  phone: {
    type: String,
    required: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
  },
  qq: {
    type: String,
    trim: true,
    default: '',
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    default: '',
  },
  nickname: {
    type: String,
    default: '访客',
    maxlength: 50,
  },
  identityType: {
    type: String,
    enum: ['customer', 'guest'],
    default: 'customer',
    index: true,
  },
  avatarUrl: {
    type: String,
    default: '',
  },
  registerIp: {
    type: String,
  },
  registerUserAgent: {
    type: String,
  },
  registerFingerprintHash: {
    type: String,
  },
  lastLoginIp: {
    type: String,
  },
  lastLoginAt: {
    type: Date,
  },
  status: {
    type: String,
    enum: ['active', 'disabled'],
    default: 'active',
  },
  messageReceivingDisabled: {
    type: Boolean,
    default: false,
  },
  blocked: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
  versionKey: false,
});

// Customer 保留为渠道绑定实体，确保历史会话和消息中的 Customer 引用继续有效。
CustomerSchema.index({ channelId: 1, phone: 1 }, { unique: true });
CustomerSchema.index(
  { accountId: 1, channelId: 1 },
  { unique: true, partialFilterExpression: { accountId: { $type: 'objectId' } } },
);
CustomerSchema.index(
  { channelId: 1, registerFingerprintHash: 1 },
  { unique: true, partialFilterExpression: { identityType: 'guest', registerFingerprintHash: { $type: 'string' } } },
);

CustomerSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.registerFingerprintHash;
  return obj;
};

module.exports = mongoose.model('Customer', CustomerSchema, 'customers');
