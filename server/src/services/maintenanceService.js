// 忆梦云团队开发
const SystemConfig = require('../models/SystemConfig');
const migrationControl = require('./migrationControl');
let cached = { value: false, until: 0 };
let activeWrites = 0;
let ioRef = null;
const waiters = new Set();
async function isFrozen() {
  if (migrationControl.isLocalFrozen()) return true;
  if (Date.now() < cached.until) return cached.value;
  cached = { value: Boolean(await SystemConfig.get('migration_write_freeze', false)), until: Date.now() + 1000 };
  return cached.value;
}
async function setFrozen(value, taskId = '') {
  migrationControl.setLocalFrozen(value);
  await SystemConfig.set('migration_write_freeze', Boolean(value), '整站数据迁移写冻结');
  await SystemConfig.set('migration_write_freeze_task', value ? taskId : '', '整站数据迁移写冻结任务');
  cached = { value: Boolean(value), until: Date.now() + 1000 };
  if (value && ioRef) {
    ioRef.emit('maintenance', { message: '系统正在迁移，所有实时写入已冻结' });
    ioRef.disconnectSockets(true);
  }
}
function beginWrite() { activeWrites += 1; let done = false; return () => { if (done) return; done = true; activeWrites = Math.max(0, activeWrites - 1); if (!activeWrites) { for (const resolve of waiters) resolve(); waiters.clear(); } }; }
async function waitForDrain(timeoutMs = 30000) {
  if (!activeWrites) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(onDrain); reject(new Error('ACTIVE_WRITES_TIMEOUT')); }, timeoutMs);
    const onDrain = () => { clearTimeout(timer); resolve(); };
    waiters.add(onDrain);
  });
}
function attachIO(io) { ioRef = io; }
function disconnectAll(message = '系统状态已更新，请重新登录') {
  if (!ioRef) return false;
  ioRef.emit('maintenance', { message });
  ioRef.disconnectSockets(true);
  return true;
}
async function runBackgroundWrite(action) {
  if (await isFrozen()) return { skipped: true, reason: 'MIGRATION_WRITE_FROZEN' };
  await migrationControl.markBusinessWriteAccepted();
  const finish = beginWrite();
  try {
    if (await isFrozen()) return { skipped: true, reason: 'MIGRATION_WRITE_FROZEN' };
    return await action();
  } finally {
    finish();
  }
}
async function middleware(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (await isFrozen()) return res.status(503).set('Retry-After', '30').json({ code: 5038, message: '系统正在迁移，写操作暂时冻结', requestId: res.locals.requestId });
  await migrationControl.markBusinessWriteAccepted();
  const finish = beginWrite(); res.once('finish', finish); res.once('close', finish); next();
}
async function socketGuard(socket, event, next) {
  if (await isFrozen()) { socket.emit('maintenance', { message: '系统正在迁移，实时写入暂时冻结' }); return next(new Error('MIGRATION_WRITE_FROZEN')); }
  await migrationControl.markBusinessWriteAccepted();
  next();
}
function getActiveWrites() { return activeWrites; }
function setProcessFrozen(value) { migrationControl.setLocalFrozen(value); }
async function markBusinessWriteAccepted() { return migrationControl.markBusinessWriteAccepted(); }
module.exports = { isFrozen, setFrozen, setProcessFrozen, markBusinessWriteAccepted, middleware, beginWrite, waitForDrain, socketGuard, attachIO, disconnectAll, runBackgroundWrite, getActiveWrites };
