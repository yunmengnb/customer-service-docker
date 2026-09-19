// 忆梦云团队开发
const { createClient } = require('redis');
const config = require('./index');

let client = null;
let connectPromise = null;

function buildClient() {
  const redisClient = createClient({
    url: config.redis.url,
    socket: {
      connectTimeout: config.redis.connectTimeoutMs,
      reconnectStrategy: false,
    },
  });
  redisClient.on('error', (err) => {
    console.warn('[Redis] 客户端错误:', err.message);
  });
  return redisClient;
}

async function connectRedis() {
  if (!config.redis.url) {
    console.log('[Redis] 未配置，使用进程内降级实现');
    return null;
  }
  if (client?.isReady) return client;
  if (connectPromise) return connectPromise;

  client = buildClient();
  connectPromise = client.connect()
    .then(() => {
      console.log('[Redis] 连接成功');
      return client;
    })
    .catch(async (err) => {
      console.warn('[Redis] 连接失败，使用进程内降级实现:', err.message);
      if (client?.isOpen) await client.disconnect().catch(() => {});
      client = null;
      return null;
    })
    .finally(() => {
      connectPromise = null;
    });
  return connectPromise;
}

function getRedis() {
  return client?.isReady ? client : null;
}

async function createRedisDuplicate() {
  const current = getRedis();
  if (!current) return null;
  const duplicate = current.duplicate();
  duplicate.on('error', (err) => console.warn('[Redis] Adapter 客户端错误:', err.message));
  await duplicate.connect();
  return duplicate;
}

module.exports = { connectRedis, getRedis, createRedisDuplicate };
