// 忆梦云团队开发
const mongoose = require('mongoose');

const CustomerSessionSchema = new mongoose.Schema({
  subjectType: { type: String, enum: ['customer', 'visitor'], required: true, index: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerAccount', default: null, index: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
  channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', default: null, index: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null, index: true },
  scopeType: { type: String, enum: ['account', 'channel'], required: true },
  loginMethod: { type: String, enum: ['password', 'guest', 'wechat'], required: true },
  fingerprint: { type: String, default: '', maxlength: 512 },
  deviceId: { type: String, default: '', maxlength: 200 },
  deviceType: { type: String, enum: ['app', 'web'], required: true },
  userAgent: { type: String, default: '', maxlength: 500 },
  ip: { type: String, default: '', maxlength: 100 },
  wechatBindingId: { type: mongoose.Schema.Types.ObjectId, ref: 'WechatIdentityBinding', default: null },
  wechatBindingVersion: Number,
  wechatConfigVersion: Number,
  lastSeenAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true, index: true },
  revokedAt: { type: Date, default: null },
  revokeReason: { type: String, default: '', maxlength: 200 },
}, { timestamps: true, versionKey: false });

CustomerSessionSchema.pre('validate', function validateScope() {
  if (this.scopeType === 'account') {
    if (this.subjectType !== 'customer' || !this.accountId || this.tenantId || this.channelId || this.conversationId) {
      throw new Error('CUSTOMER_ACCOUNT_SESSION_SCOPE_INVALID');
    }
    return;
  }
  if (!this.tenantId || !this.channelId) throw new Error('CUSTOMER_CHANNEL_SESSION_SCOPE_INVALID');
  if (this.subjectType === 'visitor' && !this.conversationId) throw new Error('VISITOR_SESSION_CONVERSATION_REQUIRED');
});

CustomerSessionSchema.index({ subjectType: 1, subjectId: 1, revokedAt: 1, expiresAt: -1 });
CustomerSessionSchema.index({ tenantId: 1, channelId: 1, subjectId: 1, revokedAt: 1 });
CustomerSessionSchema.index({ wechatBindingId: 1, revokedAt: 1 }, { partialFilterExpression: { loginMethod: 'wechat' } });

module.exports = mongoose.model('CustomerSession', CustomerSessionSchema, 'customer_sessions');
