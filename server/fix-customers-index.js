// 忆梦云团队开发 - 清理 customers 旧索引
const mongoose = require('mongoose');
require('dotenv').config();
async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/customer_service');
  const coll = mongoose.connection.collection('customers');
  const indexes = await coll.indexes();
  console.log('Current customers indexes:');
  indexes.forEach(i => console.log('  key=' + JSON.stringify(i.key).padEnd(60) + ' unique=' + (i.unique || false)));
  
  // drop 掉所有非 _id 索引，然后重建
  for (const i of indexes) {
    if (i.name === '_id_') continue;
    try {
      await coll.dropIndex(i.name);
      console.log('  ✓ dropped:', i.name);
    } catch (e) {
      console.log('  ! skip:', i.name, e.message);
    }
  }
  
  // 重建我们需要的唯一索引
  await coll.createIndex(
    { channelId: 1, phone: 1 },
    { unique: true, name: 'channel_phone_unique' }
  );
  // 查询辅助索引
  await coll.createIndex({ tenantId: 1 });
  await coll.createIndex({ status: 1 });
  
  console.log('\nFinal indexes:');
  (await coll.indexes()).forEach(i =>
    console.log('  key=' + JSON.stringify(i.key).padEnd(40) + ' unique=' + (i.unique || false)));
  
  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
