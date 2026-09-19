// 忆梦云团队开发
const { createAdapter } = require('@socket.io/redis-adapter');
const { verifyToken, passwordVersion } = require('../utils');
const { getRedis, createRedisDuplicate } = require('../config/redis');
const presence = require('../utils/presence');
const Channel = require('../models/Channel');
const Customer = require('../models/Customer');
const CustomerAccount = require('../models/CustomerAccount');
const PlatformAdmin = require('../models/PlatformAdmin');
const Tenant = require('../models/Tenant');
const TenantUser = require('../models/TenantUser');

function broadcastPresence(io, user, online) {
  const room = user.type === 'admin' ? 'admin' : user.tenantId && `presence-tenant-${user.tenantId}`;
  if (!room) return;
  io.to(room).emit('presence:changed', {
    type: user.type,
    userId: user.id,
    online,
  });
}

async function setupSocketIO(io) {
  const pubClient = getRedis();
  if (pubClient) {
    try {
      const subClient = await createRedisDuplicate();
      io.adapter(createAdapter(pubClient, subClient));
      console.log('[Socket.IO] Redis Adapter 已启用');
    } catch (err) {
      console.warn('[Socket.IO] Redis Adapter 启用失败，使用内存 Adapter:', err.message);
    }
  }
  // 认证中间件
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    
    if (!token) {
      // 允许未认证的连接但不加入任何房间
      return next();
    }
    
    const payload = verifyToken(token);
    if (!payload) {
      return next(new Error('Invalid token'));
    }
    
    socket.user = payload;
    socket.userType = payload.type;
    
    // 回查当前身份及所属资源，避免失效或伪造上下文的 token 加入广播房间。
    try {
      if (payload.type === 'tenant_user') {
        const user = await TenantUser.findOne({ _id: payload.id, tenantId: payload.tenantId });
        const tenant = user && await Tenant.findById(user.tenantId).select('status');
        if (!user || user.status !== 'active' || !tenant || tenant.status !== 'active') {
          return next(new Error('User not found or disabled'));
        }
        if (payload.pv && passwordVersion(user.password) !== payload.pv) {
          return next(new Error('Token invalidated'));
        }
        socket.user = {
          ...payload,
          role: user.role,
          tenantId: user.tenantId.toString(),
        };
      } else if (payload.type === 'customer') {
        if ((payload.id || payload.tenantId || payload.channelId) && !(payload.id && payload.tenantId && payload.channelId)) {
          return next(new Error('Customer context is invalid'));
        }
        if (payload.id && payload.tenantId && payload.channelId) {
          const isGuest = payload.identity === 'guest';
          const binding = await Customer.findOne({
            _id: payload.id,
            ...(isGuest ? { accountId: null, identityType: 'guest' } : { accountId: payload.accountId }),
            tenantId: payload.tenantId,
            channelId: payload.channelId,
            status: 'active',
            blocked: false,
          }).select('accountId tenantId channelId identityType');
          const [account, tenant, channel] = binding ? await Promise.all([
            isGuest ? Promise.resolve(true) : CustomerAccount.findOne({ _id: binding.accountId, status: 'active' }).select('_id password'),
            Tenant.findOne({ _id: binding.tenantId, status: { $in: ['active', 'trial'] } }).select('_id'),
            Channel.findOne({ _id: binding.channelId, tenantId: binding.tenantId }).select('_id'),
          ]) : [];
          if (!binding || !account || !tenant || !channel) {
            return next(new Error('Customer context is invalid'));
          }
          if (!isGuest && payload.pv && passwordVersion(account.password) !== payload.pv) {
            return next(new Error('Token invalidated'));
          }
          socket.user = {
            ...payload,
            id: binding._id.toString(),
            accountId: binding.accountId?.toString(),
            tenantId: binding.tenantId.toString(),
            channelId: binding.channelId.toString(),
          };
        } else {
          const account = await CustomerAccount.findOne({ _id: payload.accountId, status: 'active' }).select('_id');
          if (!account) return next(new Error('Customer account is invalid'));
          socket.user = { type: 'customer', accountId: account._id.toString() };
        }
      } else if (payload.type === 'admin') {
        const admin = await PlatformAdmin.findOne({ _id: payload.id, status: 'active' });
        if (!admin) return next(new Error('Admin not found or disabled'));
        if (payload.pv && passwordVersion(admin.password) !== payload.pv) {
          return next(new Error('Token invalidated'));
        }
        socket.user = { ...payload, role: admin.role };
      } else {
        return next(new Error('Invalid user type'));
      }
    } catch (err) {
      return next(new Error('Authentication failed'));
    }
    
    next();
  });
  
  io.on('connection', async (socket) => {
    // 按用户类型加入房间
    if (socket.user) {
      if (socket.user.type === 'tenant_user') {
        if (socket.user.role === 'agent') {
          const channels = await Channel.find({
            tenantId: socket.user.tenantId,
            agentIds: socket.user.id,
          }).select('_id');
          channels.forEach(channel => socket.join(`channel-staff-${channel._id}`));
        } else {
          socket.join(`tenant-${socket.user.tenantId}`);
        }
        socket.join(`agent-${socket.user.id}`);
        socket.join(`presence-tenant-${socket.user.tenantId}`);
      } else if (socket.user.type === 'customer') {
        if (socket.user.id) socket.join(`customer-${socket.user.id}`);
        if (socket.user.accountId) {
          socket.join(`customer-account-${socket.user.accountId}`);
        }
        if (socket.user.tenantId) socket.join(`presence-tenant-${socket.user.tenantId}`);
        if (socket.user.channelId) socket.join(`channel-${socket.user.channelId}`);
      } else if (socket.user.type === 'admin') {
        socket.join('admin');
      }
    }
    
    const presenceUserId = socket.user?.id || socket.user?.accountId;
    if (socket.user && presenceUserId) {
      await presence.connect(socket.user.type, presenceUserId, socket.id);
      broadcastPresence(io, socket.user, true);
    }

    socket.emit('connected', { ok: true });

    const presenceTimer = socket.user && presenceUserId
      ? setInterval(() => presence.touch(socket.user.type, presenceUserId, socket.id), 30000)
      : null;
    presenceTimer?.unref();

    socket.on('presence:query', async ({ type, userId } = {}, cb) => {
      if (socket.user && typeof cb === 'function') {
        cb({ online: await presence.isOnline(type, userId) });
      }
    });
    
    socket.on('disconnect', async () => {
      if (presenceTimer) clearInterval(presenceTimer);
      if (!socket.user || !presenceUserId) return;
      await presence.disconnect(socket.user.type, presenceUserId, socket.id);
      const online = await presence.isOnline(socket.user.type, presenceUserId);
      broadcastPresence(io, socket.user, online);
    });
    
    // 心跳
    socket.on('ping', async (cb) => {
      if (socket.user && presenceUserId) {
        await presence.touch(socket.user.type, presenceUserId, socket.id);
      }
      if (cb) cb({ pong: true });
    });
  });
  
  return io;
}

module.exports = setupSocketIO;
