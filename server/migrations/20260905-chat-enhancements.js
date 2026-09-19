// 忆梦云团队开发
require('dotenv').config();
const mongoose = require('mongoose');

const migrationName = '20260905-chat-enhancements';

async function up(db) {
  const results = {};

  results.channels = await db.collection('channels').updateMany(
    { $or: [{ welcomeImageUrl: { $exists: false } }, { welcomeImageName: { $exists: false } }] },
    [
      {
        $set: {
          welcomeImageUrl: { $ifNull: ['$welcomeImageUrl', ''] },
          welcomeImageName: { $ifNull: ['$welcomeImageName', ''] },
        },
      },
    ],
  );

  results.customers = await db.collection('customers').updateMany(
    { $or: [{ messageReceivingDisabled: { $exists: false } }, { blocked: { $exists: false } }] },
    [
      {
        $set: {
          messageReceivingDisabled: { $ifNull: ['$messageReceivingDisabled', false] },
          blocked: { $ifNull: ['$blocked', false] },
        },
      },
    ],
  );

  results.keywordReplies = await db.collection('keyword_replies').updateMany(
    { $or: [{ replyContent: { $exists: false } }, { imageUrl: { $exists: false } }, { imageName: { $exists: false } }] },
    [
      {
        $set: {
          replyContent: { $ifNull: ['$replyContent', ''] },
          imageUrl: { $ifNull: ['$imageUrl', ''] },
          imageName: { $ifNull: ['$imageName', ''] },
        },
      },
    ],
  );

  results.quickReplies = await db.collection('quick_replies').updateMany(
    { $or: [{ content: { $exists: false } }, { imageUrl: { $exists: false } }, { imageName: { $exists: false } }] },
    [
      {
        $set: {
          content: { $ifNull: ['$content', ''] },
          imageUrl: { $ifNull: ['$imageUrl', ''] },
          imageName: { $ifNull: ['$imageName', ''] },
        },
      },
    ],
  );

  results.messages = await db.collection('messages').updateMany(
    { thumbnailUrl: { $exists: false } },
    { $set: { thumbnailUrl: '' } },
  );

  return results;
}

async function down(db) {
  const results = {};
  results.channels = await db.collection('channels').updateMany(
    {},
    { $unset: { welcomeImageUrl: '', welcomeImageName: '' } },
  );
  results.customers = await db.collection('customers').updateMany(
    {},
    { $unset: { messageReceivingDisabled: '', blocked: '' } },
  );
  results.keywordReplies = await db.collection('keyword_replies').updateMany(
    {},
    { $unset: { imageUrl: '', imageName: '' } },
  );
  results.quickReplies = await db.collection('quick_replies').updateMany(
    {},
    { $unset: { imageUrl: '', imageName: '' } },
  );
  results.messages = await db.collection('messages').updateMany(
    {},
    { $unset: { thumbnailUrl: '' } },
  );
  return results;
}

function printResults(direction, results) {
  console.log(`[Migration] ${migrationName} ${direction} 完成`);
  for (const [collection, result] of Object.entries(results)) {
    console.log(`  ${collection}: matched=${result.matchedCount}, modified=${result.modifiedCount}`);
  }
}

async function main() {
  const direction = process.argv[2];
  if (!['up', 'down'].includes(direction)) {
    throw new Error('用法: node migrations/20260905-chat-enhancements.js <up|down>');
  }

  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/customer_service';
  await mongoose.connect(uri, { autoIndex: false });
  try {
    const results = direction === 'up'
      ? await up(mongoose.connection.db)
      : await down(mongoose.connection.db);
    printResults(direction, results);
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
