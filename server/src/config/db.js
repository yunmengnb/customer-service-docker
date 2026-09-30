// 忆梦云团队开发
const mongoose = require('mongoose');
const config = require('./index');
const migrationControl = require('../services/migrationControl');

function redactedUri(uri) {
  try {
    const parsed = new URL(uri);
    if (parsed.username) parsed.username = '[redacted]';
    if (parsed.password) parsed.password = '[redacted]';
    return parsed.toString();
  } catch (_) { return '[invalid MongoDB URI]'; }
}

async function connectDB() {
  try {
    if (!config.migration.activePointerEnabled) {
      if (config.migration.dataPlaneEnabled) await migrationControl.open();
      await mongoose.connect(config.mongo.uri);
      console.log(`[MongoDB] 连接成功: ${redactedUri(config.mongo.uri)} active-pointer=disabled`);
      return mongoose;
    }
    const pointer = await migrationControl.bootstrapAndRecover();
    const activeUri = migrationControl.activeMongoUri(pointer);
    await mongoose.connect(activeUri);
    console.log(`[MongoDB] 连接成功: ${redactedUri(activeUri)} generation=${pointer.generation}`);
    return mongoose;
  } catch (err) {
    console.error('[MongoDB] 连接失败:', err.message);
    throw err;
  }
}

module.exports = connectDB;
