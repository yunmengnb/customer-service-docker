// 忆梦云团队开发
const mongoose = require('mongoose');

const ConversationSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  },
  channelId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Channel',
    required: true,
    index: true,
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    index: true,
  },
  assignedAgentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TenantUser',
    default: null,
  },
  // 注意：这里用字符串而不是 enum，便于后续扩展
  status: {
    type: String,
    required: true,
    enum: ['waiting', 'active', 'closed'],
    default: 'waiting',
    index: true,
  },
  customerUnreadCount: {
    type: Number,
    default: 0,
  },
  agentUnreadCount: {
    type: Number,
    default: 0,
  },
  acceptedAt: {
    type: Date,
  },
  closedAt: {
    type: Date,
  },
  lastMessageAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, {
  timestamps: true,
  versionKey: false,
});

// 复合索引优化会话列表查询
ConversationSchema.index({ tenantId: 1, status: 1, lastMessageAt: -1 });
ConversationSchema.index({ channelId: 1, customerId: 1, status: 1 });
ConversationSchema.index({ assignedAgentId: 1, status: 1 });

module.exports = mongoose.model('Conversation', ConversationSchema, 'conversations');
