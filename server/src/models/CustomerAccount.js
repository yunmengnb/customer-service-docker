// 忆梦云团队开发
const mongoose = require('mongoose');

const CustomerAccountSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    trim: true,
    unique: true,
    index: true,
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
  avatarUrl: {
    type: String,
    default: '',
  },
  registerIp: String,
  registerUserAgent: String,
  registerFingerprintHash: String,
  lastLoginIp: String,
  lastLoginAt: Date,
  status: {
    type: String,
    enum: ['active', 'disabled'],
    default: 'active',
  },
}, {
  timestamps: true,
  versionKey: false,
});

CustomerAccountSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string', $gt: '' } } },
);

CustomerAccountSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.registerFingerprintHash;
  return obj;
};

module.exports = mongoose.model('CustomerAccount', CustomerAccountSchema, 'customer_accounts');
