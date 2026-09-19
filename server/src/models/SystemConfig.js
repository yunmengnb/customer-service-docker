// 忆梦云团队开发
const mongoose = require('mongoose');

const SystemConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, trim: true, maxlength: 200 },
  value: { type: mongoose.Schema.Types.Mixed, default: '' },
  description: { type: String, default: '', trim: true, maxlength: 500 },
}, { timestamps: true, versionKey: false });

SystemConfigSchema.index({ key: 1 }, { unique: true, name: 'idx_sys_config_key' });

SystemConfigSchema.statics.get = async function(key, defaultValue = '') {
  try {
    const doc = await this.findOne({ key }).exec();
    return doc ? doc.value : defaultValue;
  } catch (e) {
    return defaultValue;
  }
};

SystemConfigSchema.statics.set = async function(key, value, description = '') {
  return this.findOneAndUpdate(
    { key },
    { $set: { key, value, description } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).exec();
};

module.exports = mongoose.model('SystemConfig', SystemConfigSchema, 'system_configs');
