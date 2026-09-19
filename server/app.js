// 忆梦云团队开发
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const { Server } = require('socket.io');
const path = require('path');

const config = require('./src/config');
const connectDB = require('./src/config/db');
const { connectRedis, getRedis } = require('./src/config/redis');
const { requestId } = require('./src/middleware/auth');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const mongoose = require('mongoose');
const fs = require('fs');

// 路由
const adminRoutes = require('./src/routes/admin');
const tenantRoutes = require('./src/routes/tenant');
const clientRoutes = require('./src/routes/client');
const appRoutes = require('./src/routes/app');
const uploadRoutes = require('./src/routes/upload');
const complaintUploadRoutes = require('./src/routes/complaintUpload');
const fileRoutes = require('./src/routes/files');
const integrationRoutes = require('./src/routes/integration');
const attachmentCleanupService = require('./src/services/attachmentCleanupService');
const { ensureDefaultAgreements } = require('./src/utils/systemSettings');

// Socket
const setupSocketIO = require('./src/sockets');
const ChatController = require('./src/controllers/ChatController');

async function start() {
  // 连接数据库；Redis 为可选依赖，失败时自动降级
  await connectDB();
  await connectRedis();
  
  const app = express();
  const server = http.createServer(app);
  
  // Socket.IO
  const io = new Server(server, {
    cors: {
      origin: config.cors.origin,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });
  
  await setupSocketIO(io);
  ChatController.setIO(io);
  app.set('io', io);
  
  // 中间件
  app.use(helmet({
    contentSecurityPolicy: false, // 开发阶段关闭
  }));
  app.use(cors(config.cors));
  app.use(express.json({
    limit: '5mb',
    verify: (req, res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestId);
  
  // ============ 限流（登录接口）============
  const redis = getRedis();
  const loginLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    store: redis ? new RedisStore({ sendCommand: (...args) => redis.sendCommand(args), prefix: 'rate-limit:auth:' }) : undefined,
    message: { code: 4290, message: '尝试过于频繁，请稍后再试' },
  });

  // 静态资源：上传文件
  const UPLOAD_DIR = path.resolve(__dirname, 'uploads');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  app.use('/uploads/conversations', (req, res) => res.status(404).json({ code: 404, message: '资源不存在' }));
  app.use('/uploads', express.static(UPLOAD_DIR));
  
  // 健康检查
  app.get('/api/health', async (req, res) => {
    const redisClient = getRedis();
    let redisStatus = config.redis.url ? 'down' : 'disabled';
    if (redisClient) {
      try {
        redisStatus = await redisClient.ping() === 'PONG' ? 'up' : 'down';
      } catch (_) {
        redisStatus = 'down';
      }
    }
    const mongoStatus = mongoose.connection.readyState === 1 ? 'up' : 'down';
    const ok = mongoStatus === 'up';
    res.status(ok ? 200 : 503).json({
      ok,
      env: config.nodeEnv,
      services: { mongo: mongoStatus, redis: redisStatus },
      degraded: redisStatus === 'down',
    });
  });

  // 分布式认证限流必须在业务路由之前挂载
  app.use('/api/admin/auth/login', loginLimiter);
  app.use('/api/tenant/auth/login', loginLimiter);
  app.use('/api/tenant/auth/register', loginLimiter);
  app.use('/api/client/auth/login', loginLimiter);
  app.use('/api/client/auth/register-code', loginLimiter);
  app.use('/api/client/auth/register', loginLimiter);
  app.use('/api/client/auth/forgot-password', loginLimiter);
  app.use('/api/client/channels/:token/auth/login', loginLimiter);
  app.use('/api/client/channels/:token/auth/register-code', loginLimiter);
  app.use('/api/client/channels/:token/auth/register', loginLimiter);

  // 路由
  app.use('/api/files', fileRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/tenant', tenantRoutes);
  app.use('/api/client', clientRoutes);
  app.use('/api/app', appRoutes);
  app.use('/api/upload/complaint', complaintUploadRoutes);
  app.use('/api/upload', uploadRoutes);
  app.use('/api/integration', integrationRoutes);
  
  // 404
  app.use((req, res) => {
    res.status(404).json({ code: 404, message: '接口不存在', requestId: res.locals.requestId });
  });
  
  // 全局错误处理
  app.use((err, req, res, next) => {
    console.error('[Error]', err);
    res.status(500).json({
      code: 500,
      message: config.nodeEnv === 'production' ? '服务器错误' : err.message,
      requestId: res.locals.requestId,
    });
  });
  
  server.listen(config.port, () => {
    attachmentCleanupService.start(io);
    ensureDefaultAgreements().catch(err => console.error('[Server] 默认协议初始化失败:', err));
    console.log(`[Server] 运行中: http://localhost:${config.port}`);
    console.log(`[Server] 环境: ${config.nodeEnv}`);
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    attachmentCleanupService.stop();
    io.close();
    server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

start().catch(err => {
  console.error('[Server] 启动失败:', err);
  process.exit(1);
});
