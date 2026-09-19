// 忆梦云团队开发
// 数据库初始化脚本：创建默认管理员 + 默认租户（仅首次运行）
require('dotenv').config();
const connectDB = require('./src/config/db');
const config = require('./src/config');
const { hashPassword } = require('./src/utils');
const PlatformAdmin = require('./src/models/PlatformAdmin');
const Tenant = require('./src/models/Tenant');
const TenantUser = require('./src/models/TenantUser');
const Channel = require('./src/models/Channel');

async function seed() {
  await connectDB();

  // 生产环境初始化禁止使用空密码或弱口令，避免创建公开默认凭据的账号
  const weakPasswords = new Set(['admin123', 'demo123', 'admin', 'demo', 'password', '123456', '12345678']);
  if (config.nodeEnv === 'production') {
    for (const [label, value] of [
      ['管理员', config.defaults.admin.password],
      ['租户', config.defaults.tenant.password],
    ]) {
      if (!value || String(value).length < 8 || weakPasswords.has(String(value).toLowerCase())) {
        throw new Error(`生产环境初始化必须配置强${label}密码，长度至少 8 位且不能使用弱口令`);
      }
    }
  }
  
  // ===== 默认管理员 =====
  let admin = await PlatformAdmin.findOne({ username: config.defaults.admin.username });
  if (!admin) {
    admin = await PlatformAdmin.create({
      username: config.defaults.admin.username,
      password: hashPassword(config.defaults.admin.password),
      email: config.defaults.admin.email,
      role: 'super',
      status: 'active',
    });
    console.log(`[Seed] 创建默认管理员: ${config.defaults.admin.username}`);
  } else {
    console.log(`[Seed] 管理员已存在: ${admin.username}`);
  }
  
  // ===== 默认租户 =====
  let tenant = await Tenant.findOne({ username: config.defaults.tenant.username });
  if (!tenant) {
    tenant = await Tenant.create({
      name: config.defaults.tenant.name,
      username: config.defaults.tenant.username,
      password: hashPassword(config.defaults.tenant.password),
      email: `${config.defaults.tenant.username}@example.com`,
      status: 'active',
    });
    console.log(`[Seed] 创建默认租户: ${config.defaults.tenant.username}`);
  } else {
    console.log(`[Seed] 租户已存在: ${tenant.username}`);
  }
  
  // ===== 默认租户所有者 =====
  let owner = await TenantUser.findOne({ tenantId: tenant._id, role: 'owner' });
  if (!owner) {
    owner = await TenantUser.create({
      tenantId: tenant._id,
      username: tenant.username,
      password: tenant.password, // 已是 hash
      displayName: tenant.name,
      role: 'owner',
      status: 'active',
    });
    console.log(`[Seed] 创建租户所有者: ${owner.username}`);
  } else {
    console.log(`[Seed] 租户所有者已存在: ${owner.username}`);
  }
  
  // ===== 默认渠道 =====
  const defaultChannelName = '官方客服';
  let channel = await Channel.findOne({ tenantId: tenant._id, name: defaultChannelName });
  if (!channel) {
    const { generateToken } = require('./src/utils');
    channel = await Channel.create({
      tenantId: tenant._id,
      name: defaultChannelName,
      publicToken: generateToken(24),
      brandName: tenant.name,
      brandColor: '#2563eb',
      welcomeMessage: '您好，欢迎咨询，请问有什么可以帮助您？',
      agentIds: [owner._id],
      createdBy: owner._id,
    });
    const clientPublicUrl = (process.env.CLIENT_PUBLIC_URL || 'http://localhost:5176').replace(/\/$/, '');
    console.log(`[Seed] 创建默认渠道: ${channel.name}`);
    console.log(`[Seed] 客服链接: ${clientPublicUrl}/c/${channel.publicToken}`);
  } else {
    console.log(`[Seed] 默认渠道已存在: ${channel.name}`);
  }
  
  console.log('\n[Seed] 完成');
  process.exit(0);
}

seed().catch(err => {
  console.error('[Seed] 失败:', err);
  process.exit(1);
});
