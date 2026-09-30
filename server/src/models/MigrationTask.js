// 忆梦云团队开发
const mongoose = require('mongoose');
const control = require('../services/migrationControl');
const STATES = ['preflight', 'awaiting_confirmation', 'freezing_source', 'exporting', 'transferring', 'target_backup', 'importing_staging', 'verifying', 'staging_verified', 'quiescing', 'switching', 'restart_pending', 'completed', 'failed', 'cancelled', 'rolling_back', 'rolled_back', 'manual_intervention'];
const MigrationTaskSchema = new mongoose.Schema({
  taskId: { type: String, required: true, unique: true, index: true },
  direction: { type: String, enum: ['source', 'target'], required: true },
  state: { type: String, enum: STATES, default: 'preflight', index: true },
  targetOrigin: { type: String, default: '' }, targetIp: { type: String, default: '' }, sourceIp: { type: String, default: '' },
  sourceInstanceId: { type: String, required: true }, targetInstanceId: { type: String, required: true }, targetInstanceName: { type: String, default: '' },
  protocolVersion: { type: Number, required: true }, schemaVersion: { type: String, required: true },
  sessionSecretCipher: { type: mongoose.Schema.Types.Mixed, select: false }, peerTokenCipher: { type: mongoose.Schema.Types.Mixed, select: false }, peerTokenDigest: { type: String, default: '', select: false }, peerTokenExpiresAt: { type: Date, select: false },
  percent: { type: Number, min: 0, max: 100, default: 0 }, bytesDone: { type: Number, default: 0 }, bytesTotal: { type: Number, default: 0 },
  autoSwitchRequested: { type: Boolean, default: false }, requestId: { type: String, default: '' },
  startedAt: Date, finishedAt: Date, leaseOwner: { type: String, default: '' }, leaseUntil: Date, cancelRequestedAt: Date, rollbackRequestedAt: Date,
  capability: { type: mongoose.Schema.Types.Mixed, default: {} }, manifest: { type: mongoose.Schema.Types.Mixed, default: null }, journal: { type: mongoose.Schema.Types.Mixed, default: {} },
  logs: [{ at: { type: Date, default: Date.now }, stage: String, message: String }], safeError: { type: String, default: '' }, backupId: { type: String, default: '' },
  backupPath: { type: String, default: '', select: false }, transferPath: { type: String, default: '', select: false }, stagingDb: { type: String, default: '', select: false }, stagingUploads: { type: String, default: '', select: false },
  receivedChunks: { type: [String], default: [], select: false }, receivedChunkCount: { type: Number, default: 0 }, restartRequired: { type: Boolean, default: false }, createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
}, { timestamps: true, versionKey: false });
MigrationTaskSchema.index({ targetInstanceId: 1, state: 1 });
module.exports = control.getConnection().model('MigrationTask', MigrationTaskSchema, 'migration_tasks');
module.exports.STATES = STATES;
