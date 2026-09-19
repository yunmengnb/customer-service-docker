// 忆梦云团队开发
const mongoose = require('mongoose');
require('dotenv').config();
async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/customer_service');
  const coll = mongoose.connection.collection('messages');
  
  try { await coll.dropIndex({ conversationId: 1, clientMessageId: 1 }); } catch {}
  try { await coll.dropIndex('conv_client_msg_unique_partial'); } catch {}
  
  // partial index: 仅对 clientMessageId 存在（非 undefined/null）的文档做唯一约束
  // 这样没有 clientMessageId 的系统消息/机器人消息不会冲突
  await coll.createIndex(
    { conversationId: 1, clientMessageId: 1 },
    { unique: true, partialFilterExpression: { clientMessageId: { $exists: true } }, name: 'conv_client_msg_partial' }
  );
  
  const indexes = await coll.indexes();
  console.log('Current message indexes:');
  indexes.forEach(i => {
    console.log('  key=' + JSON.stringify(i.key).padEnd(40) + ' unique=' + (i.unique || false) + ' partial=' + (i.partialFilterExpression ? JSON.stringify(i.partialFilterExpression) : '-'));
  });
  
  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
