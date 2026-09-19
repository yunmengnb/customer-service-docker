// 忆梦云团队开发
require('dotenv').config();

const nodeEnv = process.env.NODE_ENV || 'development';
const developmentJwtSecret = 'dev_secret_change_me_in_production_abc123';
const jwtSecret = process.env.JWT_SECRET || developmentJwtSecret;
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
