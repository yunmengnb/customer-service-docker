// 忆梦云团队开发
const mongoose = require('mongoose');
const agreementDefaults = require('../utils/agreementDefaults');

const SystemSettingSchema = new mongoose.Schema({
  singletonKey: { type: String, default: 'platform', unique: true, immutable: true },
  registerEnabled: { type: Boolean, default: true },
  tenantRegisterEnabled: { type: Boolean },
  customerRegisterEnabled: { type: Boolean },
  tenantRegisterEmailVerificationEnabled: { type: Boolean, default: false },
  customerRegisterEmailVerificationEnabled: { type: Boolean },
  loginEnabled: { type: Boolean, default: true },
  tenantLoginEnabled: { type: Boolean },
  customerLoginEnabled: { type: Boolean },
  customerServiceDomain: { type: String, default: '', trim: true },
  customerServiceClientDownloadPromptEnabled: { type: Boolean, default: true },
  siteTitle: { type: String, default: '忆梦云客服', trim: true, maxlength: 120 },
  siteKeywords: { type: String, default: '', trim: true, maxlength: 500 },
  siteDescription: { type: String, default: '', trim: true, maxlength: 500 },
  forbiddenWords: {
    type: [String],
    default: [],
  },
  agreements: {
    disclaimer: { type: String, default: agreementDefaults.disclaimer, maxlength: 20000 },
    terms: { type: String, default: agreementDefaults.terms, maxlength: 20000 },
  },
  upload: {
    allowedTypes: {
      type: [String],
      default: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'docx', 'xlsx', 'zip', 'txt', 'mp3', 'wav', 'mp4', 'webm'],
    },
    maxFileSizeMB: { type: Number, default: 10, min: 1, max: 1024 },
  },
  storage: {
    conversationAttachmentRetentionDays: { type: Number, default: 2, min: 1, max: 365 },
    pendingAttachmentHours: { type: Number, default: 24, min: 1, max: 168 },
    cleanupBatchSize: { type: Number, default: 100, min: 1, max: 100 },
  },
  captcha: {
    enabled: { type: Boolean, default: false },
    provider: { type: String, enum: ['image', 'geetest'], default: 'image' },
    imageLength: { type: Number, default: 4, min: 4, max: 8 },
    expireSeconds: { type: Number, default: 300, min: 60, max: 1800 },
    geetestId: { type: String, default: '', trim: true },
    geetestKey: { type: String, default: '', trim: true },
  },
  smtp: {
    enabled: { type: Boolean, default: false },
    host: { type: String, default: '', trim: true },
    port: { type: Number, default: 465, min: 1, max: 65535 },
    secure: { type: Boolean, default: true },
    username: { type: String, default: '', trim: true },
    password: { type: String, default: '' },
    fromName: { type: String, default: '', trim: true },
    fromEmail: { type: String, default: '', trim: true, lowercase: true },
  },
}, { timestamps: true, versionKey: false });

SystemSettingSchema.statics.getSingleton = function() {
  return this.findOneAndUpdate(
    { singletonKey: 'platform' },
    { $setOnInsert: { singletonKey: 'platform' } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
};

module.exports = mongoose.model('SystemSetting', SystemSettingSchema, 'system_settings');
