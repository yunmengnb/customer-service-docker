// 忆梦云团队开发
const mongoose = require('mongoose');
const config = require('./index');

async function connectDB() {
  try {
    await mongoose.connect(config.mongo.uri);
    console.log('[MongoDB] 连接成功:', config.mongo.uri);
    return mongoose;
  } catch (err) {
    console.error('[MongoDB] 连接失败:', err.message);
    throw err;
  }
}

module.exports = connectDB;
