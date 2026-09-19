// 忆梦云团队开发
require('dotenv').config();
const mongoose = require('mongoose');

const migrationName = '20260918-jingpro-binding-connections';
const oldIndexName = 'idx_platform_jingpro_user';
const newIndexName = 'idx_connection_jingpro_user';
const ownerIndexName = 'idx_integration_owner_user';

async function up(db) {
  const bindings = db.collection('integrationbindings');
  const connections = db.collection('tenantintegrations');
  const cursor = bindings.find({
    platformId: 'jingpro',
    $or: [{ connectionId: { $exists: false } }, { connectionId: null }],
  });
  let bindingsUpdated = 0;

  for await (const binding of cursor) {
    const connection = await connections.findOne({ tenantId: binding.tenantId, provider: 'jingpro' });
    if (!connection) {
      throw new Error(`绑定 ${binding._id} 找不到对应的 Jingpro 租户连接`);
    }
    const result = await bindings.updateOne(
      { _id: binding._id, $or: [{ connectionId: { $exists: false } }, { connectionId: null }] },
      { $set: { connectionId: connection._id } },
    );
    bindingsUpdated += result.modifiedCount;
  }

  const duplicateOwners = await bindings.aggregate([
    { $match: { ownerUserId: { $exists: true, $ne: null } } },
    { $group: { _id: '$ownerUserId', count: { $sum: 1 }, bindingIds: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 },
  ]).toArray();
  if (duplicateOwners.length) {
    throw new Error(`客服用户 ${duplicateOwners[0]._id} 被多个 Jingpro 绑定复用，请先拆分账号；绑定: ${duplicateOwners[0].bindingIds.join(', ')}`);
  }

  let indexes = await bindings.indexes();
  if (indexes.some(index => index.name === oldIndexName)) {
    await bindings.dropIndex(oldIndexName);
    indexes = await bindings.indexes();
  }
  if (!indexes.some(index => index.name === newIndexName)) {
    await bindings.createIndex(
      { connectionId: 1, jingproUserId: 1 },
      { unique: true, name: newIndexName },
    );
  }
  if (!indexes.some(index => index.name === ownerIndexName)) {
    await bindings.createIndex(
      { ownerUserId: 1 },
      { unique: true, name: ownerIndexName },
    );
  }
  return { bindingsUpdated };
}

async function down(db) {
  const bindings = db.collection('integrationbindings');
  const indexes = await bindings.indexes();
  if (indexes.some(index => index.name === newIndexName)) await bindings.dropIndex(newIndexName);
  if (indexes.some(index => index.name === ownerIndexName)) await bindings.dropIndex(ownerIndexName);
  if (!indexes.some(index => index.name === oldIndexName)) {
    await bindings.createIndex(
      { platformId: 1, jingproUserId: 1 },
      { unique: true, name: oldIndexName },
    );
  }
  return { bindingsUpdated: 0 };
}

async function main() {
  const direction = process.argv[2];
  if (!['up', 'down'].includes(direction)) {
    throw new Error('用法: node migrations/20260918-jingpro-binding-connections.js <up|down>');
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
