// 忆梦云团队开发 - 修复旧索引脚本
const mongoose = require('mongoose');
require('dotenv').config();

async function fix() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/customer_service';
  await mongoose.connect(uri);
  console.log('Connected');
  
  // 查看现有索引
  const coll = mongoose.connection.collection('messages');
  const indexes = await coll.indexes();
  console.log('Current indexes:');
  indexes.forEach(i => console.log('  ', JSON.stringify(i.key), i.name, 'unique=' + (i.unique || false), 'partial=' + JSON.stringify(i.partialFilterExpression)));
  
  // drop 旧的 unique+sparse 索引
  try {
    await coll.dropIndex({ conversationId: 1, clientMessageId: 1 });
    console.log('✓ Dropped old index');
  } catch (e) {
    console.log('  No old index to drop:', e.message);
  }
  
  await mongoose.disconnect();
  console.log('Done. Now restart the server to rebuild indexes.');
}

fix().catch(e => { console.error(e); process.exit(1); });
