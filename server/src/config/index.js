// 忆梦云团队开发
require('dotenv').config();

const nodeEnv = process.env.NODE_ENV || 'development';
const developmentJwtSecret = 'dev_secret_change_me_in_production_abc123';
const jwtSecret = process.env.JWT_SECRET || developmentJwtSecret;
const migrationMasterKey = process.env.MIGRATION_MASTER_KEY || jwtSecret;
function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function httpsOrigins(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean).map(item => {
    if (/[\u0000-\u001f\u007f,]/.test(item)) throw new Error('ADMIN_PUBLIC_ORIGIN 格式无效');
    const url = new URL(item);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.port && url.port !== '443')) {
      throw new Error('ADMIN_PUBLIC_ORIGIN 必须是无路径、无凭据且使用标准端口的 HTTPS origin');
    }
    return `https://${url.hostname.toLowerCase()}`;
  });
}
const unsafeProductionJwtSecrets = new Set([
  developmentJwtSecret,
  'change_me_to_a_long_random_string_for_production',
  'replace_with_a_random_secret',
]);

if (nodeEnv === 'production' && (!process.env.JWT_SECRET || unsafeProductionJwtSecrets.has(jwtSecret))) {
  throw new Error('生产环境必须配置安全的 JWT_SECRET，且不能使用已知开发默认值');
}

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv,

  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/customer_service',
  },

  migration: {
    featureAvailable: process.env.MIGRATION_FEATURE_AVAILABLE === 'true',
    dataPlaneEnabled: process.env.MIGRATION_DATA_PLANE_ENABLED === 'true',
    activePointerEnabled: process.env.MIGRATION_ACTIVE_POINTER_ENABLED === 'true',
    controlUri: process.env.MIGRATION_CONTROL_URI || 'mongodb://localhost:27017/customer_service_control?replicaSet=kf-rs0&authSource=admin&directConnection=true',
    controlDbName: process.env.MIGRATION_CONTROL_DB || 'customer_service_control',
    masterKey: migrationMasterKey,
    masterKeyExplicit: Boolean(process.env.MIGRATION_MASTER_KEY),
    restartMode: String(process.env.MIGRATION_RESTART_MODE || 'none').toLowerCase(),
    instanceId: process.env.MIGRATION_INSTANCE_ID || `${require('os').hostname()}-${process.pid}`,
    replicaCount: positiveInteger(process.env.INSTANCE_REPLICA_COUNT, 1),
    replicaCountExplicit: /^\d+$/.test(String(process.env.INSTANCE_REPLICA_COUNT || '')),
    exitDelayMs: positiveInteger(process.env.MIGRATION_EXIT_DELAY_MS, 1000),
    restartExitCode: positiveInteger(process.env.MIGRATION_RESTART_EXIT_CODE, 75),
  },

  redis: {
    url: process.env.REDIS_URL || '',
    connectTimeoutMs: parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS, 10) || 2000,
    cacheTtlSeconds: parseInt(process.env.REDIS_CACHE_TTL_SECONDS, 10) || 300,
  },

  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    customerExpiresIn: process.env.CUSTOMER_JWT_EXPIRES_IN || '3650d',
  },

  cors: {
    origin: (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim()),
    credentials: true,
  },

  admin: {
    publicOrigins: httpsOrigins(process.env.ADMIN_PUBLIC_ORIGIN),
  },

  defaults: {
    admin: {
      username: process.env.DEFAULT_ADMIN_USERNAME || 'admin',
      password: process.env.DEFAULT_ADMIN_PASSWORD || '',
      email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com',
    },
    tenant: {
      name: process.env.DEFAULT_TENANT_NAME || '示例企业',
      username: process.env.DEFAULT_TENANT_USERNAME || 'demo',
      password: process.env.DEFAULT_TENANT_PASSWORD || '',
    },
  },
};
