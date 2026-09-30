// 忆梦云团队开发
const mongoose = require('mongoose');

const MigrationSettingSchema = new mongoose.Schema({
  singletonKey: { type: String, default: 'migration-feature', unique: true, immutable: true },
  enabled: { type: Boolean, default: false },
  version: { type: Number, default: 1, min: 1 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformAdmin', default: null },
  updatedByUsername: { type: String, default: '', trim: true, maxlength: 120 },
  updatedFromIp: { type: String, default: '', trim: true, maxlength: 128 },
  updatedUserAgent: { type: String, default: '', trim: true, maxlength: 300 },
  enabledAt: { type: Date, default: null },
  disabledAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

MigrationSettingSchema.statics.getSingleton = function() {
  return this.findOneAndUpdate(
    { singletonKey: 'migration-feature' },
    { $setOnInsert: { singletonKey: 'migration-feature', enabled: false, version: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
};

module.exports = mongoose.model('MigrationSetting', MigrationSettingSchema, 'migration_settings');
