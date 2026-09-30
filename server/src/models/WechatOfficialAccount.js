// 忆梦云团队开发
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  appId: { type: String, required: true, match: /^wx[a-fA-F0-9]{16}$/ },
  generation: { type: Number, default: 1 },
  isCurrent: { type: Boolean, default: true },
  displayName: { type: String, required: true, maxlength: 80 },
  callbackRouteId: { type: String, required: true },
  publicCode: { type: String, required: true },
  credentialCipher: { type: mongoose.Schema.Types.Mixed, select: false, required: true },
  credentialVersion: { type: Number, default: 1 },
  configVersion: { type: Number, default: 1 },
  enabled: { type: Boolean, default: false },
  bindingEnabled: { type: Boolean, default: false },
  loginEnabled: { type: Boolean, default: false },
  notificationEnabled: { type: Boolean, default: false },
  notificationTemplateId: { type: String, default: '', maxlength: 128 },
  notificationFieldMapping: {
    type: Map,
    of: String,
    default: {},
  },
  status: { type: String, enum: ['draft', 'disabled'], default: 'draft' },
  credentialCheckedAt: Date,
  callbackCheckedAt: Date,
  lastCredentialResult: { type: String, default: 'not_checked' },
}, { timestamps: true });
schema.index({ tenantId: 1, generation: 1 }, { unique: true });
schema.index({ tenantId: 1, isCurrent: 1 }, { unique: true, partialFilterExpression: { isCurrent: true } });
// 本阶段不开放换号：全历史唯一，禁止旧企业停用后被其他企业抢注。
schema.index({ appId: 1 }, { unique: true });
schema.index({ callbackRouteId: 1 }, { unique: true });
schema.index({ publicCode: 1 }, { unique: true });
module.exports = mongoose.model('WechatOfficialAccount', schema, 'wechat_official_accounts');
