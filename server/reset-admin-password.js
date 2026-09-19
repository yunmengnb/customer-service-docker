// 忆梦云团队开发
require('dotenv').config();
const connectDB = require('./src/config/db');
const PlatformAdmin = require('./src/models/PlatformAdmin');
const { hashPassword } = require('./src/utils');

async function resetAdminPassword() {
  const currentUsername = String(process.env.RESET_ADMIN_CURRENT_USERNAME || process.env.RESET_ADMIN_USERNAME || '').trim();
  const username = String(process.env.RESET_ADMIN_USERNAME || '').trim();
  const password = String(process.env.RESET_ADMIN_PASSWORD || '');

  if (!/^[A-Za-z0-9_.-]{3,50}$/.test(currentUsername) || !/^[A-Za-z0-9_.-]{3,50}$/.test(username)) {
    throw new Error('管理员账号格式不正确');
  }
  if (password.length < 8 || !/^[A-Za-z0-9_@%+=:,!.-]+$/.test(password)) {
    throw new Error('新密码至少 8 位，且只能包含字母、数字及 _@%+=:,!.-');
  }

  await connectDB();
  const admin = await PlatformAdmin.findOne({ username: currentUsername });
  if (!admin) {
    throw new Error(`管理员不存在: ${currentUsername}`);
  }
  if (username !== currentUsername && await PlatformAdmin.exists({ username })) {
    throw new Error(`管理员账号已存在: ${username}`);
  }

  admin.username = username;
  admin.password = hashPassword(password);
  admin.loginAttempts = 0;
  admin.lockedUntil = undefined;
  await admin.save();
  console.log(`[管理员密码] 已重置: ${username}`);
  process.exit(0);
}

resetAdminPassword().catch((error) => {
  console.error('[管理员密码] 重置失败:', error.message);
  process.exit(1);
});
