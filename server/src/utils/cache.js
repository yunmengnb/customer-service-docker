// 忆梦云团队开发
const { getRedis } = require('../config/redis');

const memoryCache = new Map();

function readMemory(key) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

async function getJson(key) {
  const redis = getRedis();
  if (redis) {
    try {
      const value = await redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (err) {
      console.warn('[Cache] Redis 读取失败，使用内存缓存:', err.message);
    }
  }
  return readMemory(key);
}

async function setJson(key, value, ttlSeconds) {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
      return;
    } catch (err) {
      console.warn('[Cache] Redis 写入失败，使用内存缓存:', err.message);
    }
  }
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

async function consumeJson(key) {
  const redis = getRedis();
  if (redis) {
    try {
      const value = await redis.sendCommand([
        'EVAL',
        "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value",
        '1',
        key,
      ]);
      return value ? JSON.parse(value) : null;
    } catch (err) {
      console.warn('[Cache] Redis 消费失败，使用内存缓存:', err.message);
    }
  }
  const value = readMemory(key);
  memoryCache.delete(key);
  return value;
}

// 原子比较后删除：错误验证码不消费，Redis 异常不回退已失去一致性的缓存。
async function consumeMatchingJson(key, expected) {
  const redis = getRedis();
  if (redis) {
    const value = await redis.sendCommand([
      'EVAL',
      "local v = redis.call('GET', KEYS[1]); if not v then return 0 end; local ok, obj = pcall(cjson.decode, v); if not ok or type(obj) ~= 'table' or obj.codeHash ~= ARGV[1] then return 0 end; redis.call('DEL', KEYS[1]); return 1",
      '1', key, expected,
    ]);
    return Number(value) === 1;
  }
  const value = readMemory(key);
  if (!value || value.codeHash !== expected) return false;
  memoryCache.delete(key);
  return true;
}

async function remove(...keys) {
  const filtered = keys.filter(Boolean);
  if (!filtered.length) return;
  filtered.forEach(key => memoryCache.delete(key));
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(filtered);
    } catch (err) {
      console.warn('[Cache] Redis 失效失败:', err.message);
    }
  }
}

async function clearNamespaces(prefixes) {
  const safePrefixes = [...new Set(prefixes.map(value => String(value || '')).filter(value => /^[a-z][a-z0-9_-]*:$/i.test(value)))];
  if (!safePrefixes.length) throw new Error('CACHE_NAMESPACE_REQUIRED');
  for (const key of memoryCache.keys()) {
    if (safePrefixes.some(prefix => key.startsWith(prefix))) memoryCache.delete(key);
  }
  const redis = getRedis();
  if (!redis) return 0;
  let deleted = 0;
  for (const prefix of safePrefixes) {
    let cursor = '0';
    do {
      const reply = await redis.sendCommand(['SCAN', cursor, 'MATCH', `${prefix}*`, 'COUNT', '200']);
      cursor = String(reply[0]);
      const keys = reply[1] || [];
      if (keys.length) {
        deleted += Number(await redis.sendCommand(['DEL', ...keys]));
      }
    } while (cursor !== '0');
  }
  return deleted;
}

module.exports = { getJson, setJson, consumeJson, consumeMatchingJson, remove, clearNamespaces };
