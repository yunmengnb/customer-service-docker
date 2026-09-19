const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const IntegrationNonceSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
    },
    type: {
      type: String,
      enum: ['nonce', 'jti'],
      default: 'nonce',
      index: true,
    },
    expireAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  { versionKey: false }
);

IntegrationNonceSchema.index(
  { expireAt: 1 },
  { expireAfterSeconds: 0, name: 'idx_nonce_expire_ttl' }
);

module.exports = mongoose.model('IntegrationNonce', IntegrationNonceSchema);
