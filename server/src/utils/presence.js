// 忆梦云团队开发
const { getRedis } = require('../config/redis');

const localCounts = new Map();
const PRESENCE_TTL_SECONDS = 90;

function presenceKey(type, id) {
  return `presence:${type}:${id}`;
}

async function connect(type, id, socketId) {
  if (!type || !id) return;
  const key = presenceKey(type, id);
  const redis = getRedis();
  if (redis) {
    try {
      await redis.hSet(key, socketId, String(Date.now()));
      await redis.expire(key, PRESENCE_TTL_SECONDS);
      return;
    } catch (err) {
      console.warn('[Presence] Redis 写入失败，使用进程内状态:', err.message);
    }
  }
  localCounts.set(key, (localCounts.get(key) || 0) + 1);
}

async function touch(type, id, socketId) {
  if (!type || !id) return;
  const redis = getRedis();
  if (!redis) return;
  const key = presenceKey(type, id);
  try {
    await redis.hSet(key, socketId, String(Date.now()));
    await redis.expire(key, PRESENCE_TTL_SECONDS);
  } catch (err) {
    console.warn('[Presence] Redis 心跳更新失败:', err.message);
  }
}

async function disconnect(type, id, socketId) {
  if (!type || !id) return;
  const key = presenceKey(type, id);
  const redis = getRedis();
  if (redis) {
    try {
      await redis.hDel(key, socketId);
      if (await redis.hLen(key) === 0) await redis.del(key);
      return;
    } catch (err) {
      console.warn('[Presence] Redis 删除失败，使用进程内状态:', err.message);
    }
  }
  const count = localCounts.get(key) || 0;
  if (count <= 1) localCounts.delete(key);
  else localCounts.set(key, count - 1);
}

async function isOnline(type, id) {
  const key = presenceKey(type, id);
  const redis = getRedis();
  if (redis) {
    try {
      return (await redis.hLen(key)) > 0;
    } catch (err) {
      console.warn('[Presence] Redis 读取失败，使用进程内状态:', err.message);
    }
  }
  return (localCounts.get(key) || 0) > 0;
}

module.exports = { connect, touch, disconnect, isOnline };
