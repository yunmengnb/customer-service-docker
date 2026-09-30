// 忆梦云团队开发
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  officialAccountId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  appId: { type: String, required: true, immutable: true },
  generation: { type: Number, required: true, immutable: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  subjectType: { type: String, enum: ['staff', 'customer', 'visitor'], required: true, immutable: true },
  // 客户与访客绑定预留严格业务作用域；客服绑定不得填写这些字段。
  channelId: { type: mongoose.Schema.Types.ObjectId, immutable: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, immutable: true },
  openIdHash: { type: String, required: true, select: false },
  openIdCipher: { type: mongoose.Schema.Types.Mixed, required: true, select: false },
  followerId: { type: mongoose.Schema.Types.ObjectId, ref: 'WechatFollower' },
  subscribeStatus: { type: String, enum: ['unknown', 'subscribed', 'unsubscribed'], default: 'unknown' },
  lastFollowEventAt: Date,
  status: { type: String, enum: ['active', 'revoked'], default: 'active', required: true },
  version: { type: Number, default: 1, min: 1 },
  notificationPreference: { type: String, enum: ['disabled', 'enabled'], default: 'disabled' },
  consentVersion: { type: String, default: 'staff-login-v1' },
  consentedAt: { type: Date, required: true },
  boundAt: { type: Date, required: true },
  verifiedAt: { type: Date, required: true },
  verificationMethod: { type: String, enum: ['wechat_oauth_snsapi_base'], default: 'wechat_oauth_snsapi_base', required: true },
  revokedAt: Date,
  revokedByType: { type: String, enum: ['self', 'tenant_admin', 'system'] },
  revokedById: mongoose.Schema.Types.ObjectId,
  revokeReason: { type: String, maxlength: 120 },
}, { timestamps: true });
schema.pre('validate', function validateSubjectScope() {
  const scoped = this.subjectType === 'customer' || this.subjectType === 'visitor';
  if (
    (scoped && !this.channelId)
    || (this.subjectType === 'visitor' && !this.conversationId)
    || (!scoped && (this.channelId || this.conversationId))
  ) throw new Error('WECHAT_BINDING_SCOPE_INVALID');
});
schema.index({ tenantId: 1, officialAccountId: 1, appId: 1, generation: 1, subjectType: 1, subjectId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
schema.index({ tenantId: 1, officialAccountId: 1, appId: 1, generation: 1, openIdHash: 1, subjectType: 1, status: 1 });
module.exports = mongoose.model('WechatIdentityBinding', schema, 'wechat_identity_bindings');
