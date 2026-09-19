// 忆梦云团队开发
require('dotenv').config();
const mongoose = require('mongoose');

const migrationName = '20260905-global-customer-accounts';

function accountDocument(customer) {
  return {
    phone: customer.phone,
    password: customer.password,
    qq: customer.qq || '',
    email: customer.email || '',
    nickname: customer.nickname || '访客',
    avatarUrl: customer.avatarUrl || '',
    registerIp: customer.registerIp,
    registerUserAgent: customer.registerUserAgent,
    registerFingerprintHash: customer.registerFingerprintHash,
    lastLoginIp: customer.lastLoginIp,
    lastLoginAt: customer.lastLoginAt,
    status: customer.status || 'active',
    createdAt: customer.createdAt || new Date(),
    updatedAt: customer.updatedAt || new Date(),
  };
}

async function up(db) {
  const customers = db.collection('customers');
  const accounts = db.collection('customer_accounts');
  const cursor = customers.find({ phone: { $type: 'string', $ne: '' } }).sort({ createdAt: 1, _id: 1 });
  let accountsCreated = 0;
  let bindingsUpdated = 0;

  for await (const customer of cursor) {
    const normalizedPhone = String(customer.phone).replace(/\s+/g, '').replace(/^\+86/, '');
    if (!normalizedPhone) continue;
    let account = await accounts.findOne({ phone: normalizedPhone });
    if (!account) {
      const result = await accounts.insertOne({ ...accountDocument(customer), phone: normalizedPhone });
      account = { _id: result.insertedId };
      accountsCreated += 1;
    }
    const result = await customers.updateOne(
      { _id: customer._id },
      { $set: { accountId: account._id, phone: normalizedPhone } },
    );
    bindingsUpdated += result.modifiedCount;
  }

  await accounts.createIndex({ phone: 1 }, { unique: true, name: 'phone_1' });
  await customers.createIndex({ accountId: 1 }, { name: 'accountId_1' });
  await customers.createIndex(
    { accountId: 1, channelId: 1 },
    { unique: true, partialFilterExpression: { accountId: { $type: 'objectId' } }, name: 'accountId_1_channelId_1' },
  );
  return { accountsCreated, bindingsUpdated };
}

async function down(db) {
  const customers = db.collection('customers');
  const indexes = await customers.indexes();
  for (const name of ['accountId_1', 'accountId_1_channelId_1']) {
    if (indexes.some(index => index.name === name)) await customers.dropIndex(name);
  }
  const bindings = await customers.updateMany({}, { $unset: { accountId: '' } });
  const droppedAccounts = (await db.listCollections({ name: 'customer_accounts' }).hasNext())
    ? await db.collection('customer_accounts').drop()
    : false;
  return { bindingsUpdated: bindings.modifiedCount, droppedAccounts };
}

async function main() {
  const direction = process.argv[2];
  if (!['up', 'down'].includes(direction)) {
    throw new Error('用法: node migrations/20260905-global-customer-accounts.js <up|down>');
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
