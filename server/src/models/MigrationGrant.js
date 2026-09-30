// 忆梦云团队开发
const mongoose = require('mongoose');
const control = require('../services/migrationControl');

const MigrationGrantSchema = new mongoose.Schema({
  digest: { type: String, required: true, unique: true, select: false },
  targetInstanceId: { type: String, required: true, index: true },
  expectedSourceIp: { type: String, default: '' },
  sourceInstanceId: { type: String, default: '' },
  handshakeNonce: { type: String, default: '' },
  taskId: { type: String, default: '', index: true },
  status: { type: String, enum: ['active', 'occupied', 'revoked', 'expired'], default: 'active', index: true },
  expiresAt: { type: Date, required: true, index: true },
  occupiedAt: Date,
  revokedAt: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
}, { timestamps: true, versionKey: false });
MigrationGrantSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
module.exports = control.getConnection().model('MigrationGrant', MigrationGrantSchema, 'migration_grants');
