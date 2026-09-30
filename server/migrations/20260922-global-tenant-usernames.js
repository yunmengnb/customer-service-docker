// 忆梦云团队开发
require('dotenv').config();
const mongoose = require('mongoose');

const migrationName = '20260922-global-tenant-usernames';
const usersCollectionName = 'tenant_users';
const tenantsCollectionName = 'tenants';
const globalIndexName = 'username_1';

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

async function findConflicts(db) {
  const users = db.collection(usersCollectionName);
  const tenants = db.collection(tenantsCollectionName);
  const [userRows, tenantRows] = await Promise.all([
    users.find({}, { projection: { username: 1, tenantId: 1, role: 1 } }).toArray(),
    tenants.find({}, { projection: { username: 1, name: 1 } }).toArray(),
  ]);

  const invalidUsers = userRows.filter(row => !normalizeUsername(row.username));
  const invalidTenants = tenantRows.filter(row => !normalizeUsername(row.username));
  const groupedUsers = new Map();
  const groupedTenants = new Map();

  for (const tenant of tenantRows) {
    const normalized = normalizeUsername(tenant.username);
    if (!normalized) continue;
    const entries = groupedTenants.get(normalized) || [];
    entries.push({
      id: String(tenant._id),
      name: tenant.name,
      username: tenant.username,
    });
    groupedTenants.set(normalized, entries);
  }

  for (const row of userRows) {
    const normalized = normalizeUsername(row.username);
    if (!normalized) continue;
    const entries = groupedUsers.get(normalized) || [];
    entries.push({
      id: String(row._id),
      tenantId: String(row.tenantId),
      role: row.role,
      username: row.username,
    });
    groupedUsers.set(normalized, entries);
  }

  const duplicateUsers = [...groupedUsers.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([username, entries]) => ({ username, entries }));
  const duplicateTenants = [...groupedTenants.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([username, entries]) => ({ username, entries }));

  const userByTenantAndRole = new Map();
  for (const row of userRows) {
    userByTenantAndRole.set(`${row.tenantId}:${row.role}`, row);
  }

  const ownerMismatches = [];
  const missingOwners = [];
  const tenantUserConflicts = [];
  for (const tenant of tenantRows) {
    const owner = userByTenantAndRole.get(`${tenant._id}:owner`);
    const tenantUsername = normalizeUsername(tenant.username);
    if (!owner) {
      missingOwners.push({
        tenantId: String(tenant._id),
        tenantName: tenant.name,
        tenantUsername: tenant.username,
      });
    }
    const ownerUsername = normalizeUsername(owner?.username);
    if (owner && tenantUsername !== ownerUsername) {
      ownerMismatches.push({
        tenantId: String(tenant._id),
        tenantName: tenant.name,
        tenantUsername: tenant.username,
        ownerId: String(owner._id),
        ownerUsername: owner.username,
      });
    }

    const matchingUsers = groupedUsers.get(tenantUsername) || [];
    const conflictingUsers = matchingUsers.filter(entry => (
      !owner || entry.id !== String(owner._id)
    ));
    if (conflictingUsers.length) {
      tenantUserConflicts.push({
        username: tenantUsername,
        tenantId: String(tenant._id),
        tenantName: tenant.name,
        entries: conflictingUsers,
      });
    }
  }

  return {
    invalidUsers,
    invalidTenants,
    duplicateUsers,
    duplicateTenants,
    ownerMismatches,
    missingOwners,
    tenantUserConflicts,
  };
}

function assertSafe(conflicts) {
  const blocking = conflicts.invalidUsers.length
    + conflicts.invalidTenants.length
    + conflicts.duplicateUsers.length
    + conflicts.duplicateTenants.length
    + conflicts.ownerMismatches.length
    + conflicts.tenantUserConflicts.length;

  if (!blocking) return;

  console.error('[Migration] 检测到用户名冲突或 owner 镜像不一致，未修改任何数据：');
  console.error(JSON.stringify(conflicts, null, 2));
  throw new Error('请先处理用户名冲突和 owner 镜像不一致后再执行迁移');
}

async function up(db) {
  const users = db.collection(usersCollectionName);
  const tenants = db.collection(tenantsCollectionName);
  const conflicts = await findConflicts(db);
  assertSafe(conflicts);

  const [userRows, tenantRows] = await Promise.all([
    users.find({}, { projection: { username: 1 } }).toArray(),
    tenants.find({}, { projection: { username: 1, name: 1, password: 1 } }).toArray(),
  ]);

  let usersUpdated = 0;
  for (const row of userRows) {
    const username = normalizeUsername(row.username);
    if (row.username === username) continue;
    const result = await users.updateOne({ _id: row._id }, { $set: { username } });
    usersUpdated += result.modifiedCount;
  }

  let tenantsUpdated = 0;
  for (const row of tenantRows) {
    const username = normalizeUsername(row.username);
    if (row.username === username) continue;
    const result = await tenants.updateOne({ _id: row._id }, { $set: { username } });
    tenantsUpdated += result.modifiedCount;
  }

  let ownersCreated = 0;
  const missingOwnerIds = new Set(conflicts.missingOwners.map(row => row.tenantId));
  for (const tenant of tenantRows) {
    if (!missingOwnerIds.has(String(tenant._id))) continue;
    const now = new Date();
    await users.insertOne({
      tenantId: tenant._id,
      username: normalizeUsername(tenant.username),
      password: tenant.password,
      displayName: tenant.name,
      role: 'owner',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    ownersCreated += 1;
  }

  let indexes = await users.indexes();
  const usernameIndex = indexes.find(index => (
    Object.keys(index.key || {}).length === 1 && index.key.username === 1
  ));

  if (usernameIndex && !usernameIndex.unique) {
    await users.dropIndex(usernameIndex.name);
  }
  if (!usernameIndex || !usernameIndex.unique) {
    await users.createIndex(
      { username: 1 },
      { unique: true, name: globalIndexName },
    );
  }

  indexes = await users.indexes();
  for (const index of indexes) {
    if (index.unique && index.key?.tenantId === 1 && index.key?.username === 1) {
      await users.dropIndex(index.name);
    }
  }

  return { usersUpdated, tenantsUpdated, ownersCreated };
}

async function audit(db) {
  const conflicts = await findConflicts(db);
  console.log(JSON.stringify(conflicts, null, 2));
  return conflicts;
}

async function main() {
  const direction = process.argv[2];
  if (!['audit', 'up'].includes(direction)) {
    throw new Error(`用法: node migrations/${migrationName}.js <audit|up>`);
  }

  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/customer_service';
  await mongoose.connect(uri, { autoIndex: false });
  try {
    const result = direction === 'audit'
      ? await audit(mongoose.connection.db)
      : await up(mongoose.connection.db);
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

module.exports = { audit, up, findConflicts, normalizeUsername };
