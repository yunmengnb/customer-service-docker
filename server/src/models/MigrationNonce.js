// 忆梦云团队开发
const mongoose = require('mongoose');
const control = require('../services/migrationControl');
const MigrationNonceSchema = new mongoose.Schema({
  taskId: { type: String, required: true },
  nonce: { type: String, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true, versionKey: false });
MigrationNonceSchema.index({ taskId: 1, nonce: 1 }, { unique: true });
MigrationNonceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = control.getConnection().model('MigrationNonce', MigrationNonceSchema, 'migration_nonces');
