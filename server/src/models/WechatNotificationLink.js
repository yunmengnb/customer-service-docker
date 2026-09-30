// 忆梦云团队开发
const mongoose = require('mongoose');

const id = { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true };
const schema = new mongoose.Schema({
  outboxId: { ...id, unique: true },
  referenceHash: { type: String, required: true, immutable: true, unique: true, select: false },
  tenantId: id,
  officialAccountId: id,
  appId: { type: String, required: true, immutable: true },
  generation: { type: Number, required: true, immutable: true },
  configVersion: { type: Number, required: true, immutable: true },
  bindingId: id,
  bindingVersion: { type: Number, required: true, immutable: true },
  subjectType: { type: String, enum: ['staff', 'customer', 'visitor'], required: true, immutable: true },
  subjectId: id,
  channelId: id,
  conversationId: id,
  messageId: id,
  oauthStateHash: { type: String, select: false },
  browserProofHash: { type: String, select: false },
  oauthExpiresAt: Date,
  oauthClaimedAt: Date,
  verifiedAt: Date,
  exchangeProofHash: { type: String, select: false },
  exchangeExpiresAt: Date,
  consumedAt: Date,
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

schema.pre('validate', function validateScope() {
  if (this.subjectType === 'visitor' && !this.conversationId) {
    throw new Error('WECHAT_NOTIFICATION_VISITOR_SCOPE_REQUIRED');
  }
});
schema.index({ oauthStateHash: 1 }, { unique: true, partialFilterExpression: { oauthStateHash: { $type: 'string' } } });
schema.index({ exchangeProofHash: 1 }, { unique: true, partialFilterExpression: { exchangeProofHash: { $type: 'string' } } });
// TTL 只负责异步清理；每次授权均显式比较 expiresAt 和实时业务权限。
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('WechatNotificationLink', schema, 'wechat_notification_links');
