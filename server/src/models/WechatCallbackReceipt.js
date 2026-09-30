// 忆梦云团队开发
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  officialAccountId: { type: mongoose.Schema.Types.ObjectId, required: true },
  appId: { type: String, required: true },
  generation: { type: Number, required: true },
  credentialVersion: { type: Number, required: true },
  configVersion: { type: Number, required: true },
  eventKey: { type: String, required: true },
  eventType: { type: String, required: true },
  eventAt: { type: Date, required: true },
  payloadCipher: { type: mongoose.Schema.Types.Mixed, required: true, select: false },
  state: { type: String, enum: ['pending', 'done'], default: 'pending' },
  expiresAt: Date,
}, { timestamps: true });
schema.index({ officialAccountId: 1, eventKey: 1 }, { unique: true });
schema.index({ state: 1, createdAt: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('WechatCallbackReceipt', schema, 'wechat_callback_receipts');
