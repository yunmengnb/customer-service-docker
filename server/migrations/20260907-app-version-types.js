// 忆梦云团队开发
require('dotenv').config();
const mongoose = require('mongoose');

const migrationName = '20260907-app-version-types';
const oldIndexName = 'platform_1_versionCode_1';
const newIndexName = 'platform_1_appType_1_versionCode_1';

async function up(db) {
  const versions = db.collection('app_versions');
  const updated = await versions.updateMany(
    { appType: { $exists: false } },
    { $set: { appType: 'staff' } },
  );
  let indexes = await versions.indexes();
  if (indexes.some(index => index.name === oldIndexName)) {
    try {
      await versions.dropIndex(oldIndexName);
    } catch (err) {
      if (err.codeName !== 'IndexNotFound' && err.code !== 27) throw err;
    }
    indexes = await versions.indexes();
  }
  if (!indexes.some(index => index.name === newIndexName)) {
    await versions.createIndex(
      { platform: 1, appType: 1, versionCode: 1 },
      { unique: true, name: newIndexName },
    );
  }
  const statusIndexName = 'platform_1_appType_1_status_1_versionCode_-1';
  indexes = await versions.indexes();
  if (!indexes.some(index => index.name === statusIndexName)) {
    await versions.createIndex(
      { platform: 1, appType: 1, status: 1, versionCode: -1 },
      { name: statusIndexName },
    );
  }
  return { versionsUpdated: updated.modifiedCount };
}

async function down(db) {
  const versions = db.collection('app_versions');
  const customerVersions = await versions.countDocuments({ appType: 'customer' });
  if (customerVersions > 0) {
    throw new Error('存在客户 APP 版本，无法恢复旧的全局版本号唯一索引');
  }
  const indexes = await versions.indexes();
  for (const name of [newIndexName, 'platform_1_appType_1_status_1_versionCode_-1']) {
    if (indexes.some(index => index.name === name)) await versions.dropIndex(name);
  }
  await versions.updateMany({ appType: 'staff' }, { $unset: { appType: '' } });
  await versions.createIndex(
    { platform: 1, versionCode: 1 },
    { unique: true, name: oldIndexName },
  );
  return { versionsUpdated: await versions.countDocuments({ appType: { $exists: false } }) };
}

async function main() {
  const direction = process.argv[2];
  if (!['up', 'down'].includes(direction)) {
    throw new Error('用法: node migrations/20260907-app-version-types.js <up|down>');
  }
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/customer_service';
  await mongoose.connect(uri, { autoIndex: false });
  try {
    const result = direction === 'up' ? await up(mongoose.connection.db) : await down(mongoose.connection.db);
    console.log(`[Migration] ${migrationName} ${direction} 完成`, result);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[Migration] ${migrationName} 执行失败:`, err.message);
    process.exitCode = 1;
  });
}

module.exports = { up, down };
