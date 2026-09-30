// 忆梦云团队开发
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  officialAccountId: { type: mongoose.Schema.Types.ObjectId, required: true },
  appId: { type: String, required: true },
  generation: { type: Number, required: true },
  openIdHash: { type: String, required: true, select: false },
  openIdCipher: { type: mongoose.Schema.Types.Mixed, required: true, select: false },
  subscribeStatus: { type: String, enum: ['unknown', 'subscribed', 'unsubscribed'], default: 'unknown' },
  lastEventAt: Date,
  allNotificationsOptOut: { type: Boolean, default: false },
}, { timestamps: true });
schema.index({ tenantId: 1, officialAccountId: 1, appId: 1, generation: 1, openIdHash: 1 }, { unique: true });
module.exports = mongoose.model('WechatFollower', schema, 'wechat_followers');
