// 忆梦云团队开发
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  officialAccountId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  appId: { type: String, required: true, immutable: true },
  generation: { type: Number, required: true, immutable: true },
  credentialVersion: { type: Number, immutable: true },
  configVersion: { type: Number, immutable: true },
  purpose: { type: String, enum: ['bind', 'login'], required: true, immutable: true },
  clientSide: { type: String, enum: ['staff', 'client'], required: true, immutable: true },
  authMode: { type: String, enum: ['qr', 'direct'], default: 'qr', required: true, immutable: true },
  initiatingSessionId: { type: mongoose.Schema.Types.ObjectId, immutable: true },
  initiatingSubject: { type: mongoose.Schema.Types.ObjectId, immutable: true },
  initiatingSubjectType: { type: String, enum: ['customer', 'visitor'], immutable: true },
  channelId: { type: mongoose.Schema.Types.ObjectId, immutable: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, immutable: true },
  scanTicketHash: { type: String, required: true, select: false },
  qrTicketHash: { type: String, select: false },
  qrExpiresAt: Date,
  browserProofHash: { type: String, required: true, select: false },
  oauthStateHash: { type: String, select: false },
  oauthBrowserProofHash: { type: String, select: false },
  scanOpenIdHash: { type: String, select: false },
  oauthExpiresAt: Date,
  oauthClaimedAt: Date,
  verifiedOpenId: { type: String, select: false },
  verifiedOpenIdCipher: { type: mongoose.Schema.Types.Mixed, select: false },
  selectedBindingId: mongoose.Schema.Types.ObjectId,
  selectedBindingVersion: Number,
  phrase: { type: String, required: true },
  state: { type: String, enum: ['pending', 'scanned', 'oauth_verified', 'confirmed', 'consumed', 'cancelled'], default: 'pending' },
  origin: { type: String, required: true, immutable: true },
  expiresAt: { type: Date, required: true },
  confirmedAt: Date,
  consumedAt: Date,
}, { timestamps: true });
schema.pre('validate', function validateClientScope() {
  if (this.clientSide !== 'client') return;
  if (!this.channelId) throw new Error('WECHAT_CLIENT_CHALLENGE_CHANNEL_REQUIRED');
  if (this.purpose === 'bind' && (!this.initiatingSubjectType || !this.conversationId)) {
    throw new Error('WECHAT_CLIENT_BIND_SCOPE_REQUIRED');
  }
});
schema.index({ scanTicketHash: 1 }, { unique: true });
schema.index({ oauthStateHash: 1 }, { unique: true, partialFilterExpression: { oauthStateHash: { $type: 'string' } } });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('WechatAuthChallenge', schema, 'wechat_auth_challenges');
