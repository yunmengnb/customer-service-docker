// 忆梦云团队开发
const mongoose = require('mongoose');

const PlatformAdminSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 50,
  },
  password: {
    type: String,
    required: true,
  },
  avatarUrl: {
    type: String,
    default: '',
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  role: {
    type: String,
    enum: ['super', 'operator'],
    default: 'operator',
  },
  status: {
    type: String,
    enum: ['active', 'disabled'],
    default: 'active',
  },
  lastLoginAt: {
    type: Date,
  },
  loginAttempts: {
    type: Number,
    default: 0,
  },
  lockedUntil: {
    type: Date,
  },
}, {
  timestamps: true,
  versionKey: false,
});

// 隐藏敏感字段
PlatformAdminSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.loginAttempts;
  delete obj.lockedUntil;
  return obj;
};

module.exports = mongoose.model('PlatformAdmin', PlatformAdminSchema, 'platform_admins');