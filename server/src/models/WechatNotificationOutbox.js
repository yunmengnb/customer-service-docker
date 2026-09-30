// 忆梦云团队开发
const mongoose = require('mongoose');
const id = { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true };
const schema = new mongoose.Schema({
  tenantId: id,
  officialAccountId: id,
  appId: { type: String, required: true, immutable: true },
  generation: { type: Number, required: true, immutable: true },
  configVersion: { type: Number, required: true, immutable: true },
  channelId: id,
  conversationId: id,
  messageId: id,
  recipientType: { type: String, enum: ['staff', 'customer'], required: true, immutable: true },
  recipientId: id,
  state: { type: String, enum: ['pending', 'leased', 'sent', 'suppressed', 'unknown', 'dead'], default: 'pending' },
  availableAt: { type: Date, required: true },
  leaseId: { type: String, default: '' },
  leaseUntil: Date,
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 8, min: 1, max: 20 },
  resultCode: { type: String, default: '', maxlength: 80 },
  sentAt: Date,
  lastAttemptAt: Date,
}, { timestamps: true });
// No message text, OpenID, credential, or login token belongs in the outbox.
schema.index({ tenantId: 1, officialAccountId: 1, generation: 1, messageId: 1, recipientType: 1, recipientId: 1 }, { unique: true });
schema.index({ state: 1, availableAt: 1, leaseUntil: 1 });
module.exports = mongoose.model('WechatNotificationOutbox', schema, 'wechat_notification_outbox');
