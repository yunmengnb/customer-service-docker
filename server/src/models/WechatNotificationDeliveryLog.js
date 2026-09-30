// 忆梦云团队开发
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  outboxId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  attempt: { type: Number, required: true, min: 1, immutable: true },
  startedAt: { type: Date, required: true, immutable: true },
  finishedAt: { type: Date, required: true, immutable: true },
  outcome: {
    type: String,
    enum: ['sent', 'suppressed', 'retry', 'unknown', 'dead'],
    required: true,
    immutable: true,
  },
  resultCode: { type: String, required: true, maxlength: 80, immutable: true },
}, { timestamps: true });

// 日志只保存内部结果码，不保存 OpenID、access token、消息正文或凭据。
schema.index({ outboxId: 1, attempt: 1 }, { unique: true });
schema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model(
  'WechatNotificationDeliveryLog',
  schema,
  'wechat_notification_delivery_logs',
);
