// 忆梦云团队开发 - 查看索引
const mongoose = require('mongoose');
require('dotenv').config();
async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/customer_service');
  const coll = mongoose.connection.collection('messages');
  const indexes = await coll.indexes();
  indexes.forEach(i => {
    if (i.partialFilterExpression) {
      console.log('PARTIAL INDEX:');
    }
    console.log('  key:', JSON.stringify(i.key), 'unique=' + (i.unique || false), 'partial=' + JSON.stringify(i.partialFilterExpression || 'none'));
  });
  await mongoose.disconnect();
}
main();
