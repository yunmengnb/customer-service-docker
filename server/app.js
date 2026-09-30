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
const migrationRoutes = require('./src/routes/migration');
const migrationDataRoutes = require('./src/routes/migrationData');
const maintenanceService = require('./src/services/maintenanceService');
const migrationControl = require('./src/services/migrationControl');
const migrationWorker = require('./src/services/migrationWorker');
const attachmentCleanupService = require('./src/services/attachmentCleanupService');
const { ensureDefaultAgreements } = require('./src/utils/systemSettings');

// Socket
const setupSocketIO = require('./src/sockets');
const ChatController = require('./src/controllers/ChatController');

async function start() {
  // 连接数据库；Redis 为可选依赖，失败时自动降级
  await connectDB();
  await require('./src/services/extensionPlatformService').ensurePlatformExtensions();
  await connectRedis();

  const app = express();
  app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
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
  app.use('/api/migration/data', migrationDataRoutes);
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
  const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.resolve(__dirname, 'uploads'));
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  app.use('/uploads/conversations', (req, res) => res.status(404).json({ code: 404, message: '资源不存在' }));
  app.use('/uploads/.migration-private', (req, res) => res.status(404).json({ code: 404, message: '资源不存在' }));
  app.use('/uploads', express.static(UPLOAD_DIR, { dotfiles: 'deny' }));

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
    let mongoStatus = 'down';
    if (mongoose.connection.readyState === 1) {
      try {
        const hello = await mongoose.connection.db.admin().command({ hello: 1 });
        mongoStatus = hello.setName
          ? (hello.isWritablePrimary === true ? 'primary' : 'not-primary')
          : 'standalone';
      } catch (_) {
        mongoStatus = 'down';
      }
    }
    const maintenance = await maintenanceService.isFrozen().catch(() => true);
    const ok = ['primary', 'standalone'].includes(mongoStatus) && redisStatus !== 'down' && !maintenance;
    res.status(ok ? 200 : 503).json({
      ok,
      env: config.nodeEnv,
      services: { mongo: mongoStatus, redis: redisStatus },
      maintenance,
      degraded: redisStatus === 'down',
    });
  });

  // 分布式认证限流必须在业务路由之前挂载
  app.use('/api/admin/auth/login', loginLimiter);
  app.use('/api/tenant/auth/login', loginLimiter);
  app.use('/api/tenant/auth/key-login', loginLimiter);
  app.use('/api/integration/employee-token-login', loginLimiter);
  app.use('/api/tenant/auth/register', loginLimiter);
  app.use('/api/client/auth/login', loginLimiter);
  app.use('/api/client/auth/register-code', loginLimiter);
  app.use('/api/client/auth/register', loginLimiter);
  app.use('/api/client/auth/forgot-password', loginLimiter);
  app.use('/api/client/channels/:token/auth/login', loginLimiter);
  app.use('/api/client/channels/:token/auth/register-code', loginLimiter);
  app.use('/api/client/channels/:token/auth/register', loginLimiter);

  // 路由
  app.use('/api/migration', migrationRoutes);
  app.use(maintenanceService.middleware);
  app.use('/api/files', fileRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/tenant', tenantRoutes);
  app.use('/api/client', clientRoutes);
  app.use('/api/app', appRoutes);
  app.use('/api/upload/complaint', complaintUploadRoutes);
  app.use('/api/upload', uploadRoutes);
  app.use('/api/integration', integrationRoutes);
  app.use('/api/tenant/extensions/wechat-official', require('./src/routes/wechat').management);
  app.use('/api/wechat', require('./src/routes/wechat').publicRouter);

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

  let shuttingDown = false;
  const shutdown = async (reason = 'signal', exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Server] 开始受控退出: ${reason}`);
    migrationControl.stopCoordinator();
    maintenanceService.setProcessFrozen(true);
    attachmentCleanupService.stop();
    migrationWorker.stop();
    await require('./src/services/wechatCallbackService').stop();
    await require('./src/services/wechatNotificationWorker').stop();
    await maintenanceService.waitForDrain(30000).catch(error => {
      console.error('[Server] 等待写入排空失败:', error.message);
    });
    io.emit('maintenance', { message: '服务正在重启，请稍后重新连接' });
    io.disconnectSockets(true);
    await new Promise(resolve => io.close(resolve));
    await new Promise(resolve => {
      const timer = setTimeout(() => {
        server.closeAllConnections?.();
        resolve();
      }, 10000);
      timer.unref?.();
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    await mongoose.disconnect().catch(error => console.error('[MongoDB] 关闭失败:', error.message));
    await migrationControl.close().catch(error => console.error('[MigrationControl] 关闭失败:', error.message));
    process.exit(exitCode);
  };

  migrationControl.startCoordinator({
    io,
    waitForDrain: async () => {
      attachmentCleanupService.stop();
      await require('./src/services/wechatCallbackService').stop();
      await require('./src/services/wechatNotificationWorker').stop();
      await maintenanceService.waitForDrain(30000);
    },
    requestExit: async reason => {
      await new Promise(resolve => setTimeout(resolve, config.migration.exitDelayMs));
      const exitCode = config.migration.restartMode === 'docker'
        ? config.migration.restartExitCode
        : 0;
      return shutdown(reason, exitCode);
    },
  });

  server.listen(config.port, () => {
    attachmentCleanupService.start(io);
    migrationWorker.start();
    require('./src/services/wechatCallbackService').start();
    require('./src/services/wechatNotificationWorker').start();
    ensureDefaultAgreements().catch(err => console.error('[Server] 默认协议初始化失败:', err));
    console.log(`[Server] 运行中: http://localhost:${config.port}`);
    console.log(`[Server] 环境: ${config.nodeEnv}`);
  });

  process.once('SIGINT', () => { void shutdown('SIGINT', 0); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM', 0); });
}

start().catch(err => {
  console.error('[Server] 启动失败:', err);
  process.exit(1);
});
