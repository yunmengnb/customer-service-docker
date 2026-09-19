// 忆梦云团队开发
const mongoose = require('mongoose');

const ChannelSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50,
  },
  publicToken: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  brandName: {
    type: String,
    default: '在线客服',
    maxlength: 50,
  },
  brandColor: {
    type: String,
    default: '#2563eb',
  },
  avatarUrl: {
    type: String,
    default: '',
  },
  welcomeMessage: {
    type: String,
    default: '您好，欢迎咨询，请问有什么可以帮助您？',
    maxlength: 500,
  },
  welcomeImageUrl: {
    type: String,
    default: '',
  },
  welcomeImageName: {
    type: String,
    default: '',
    maxlength: 255,
  },
  offlineMessage: {
    type: String,
    default: '当前客服暂不在线，请稍后再试。',
    maxlength: 500,
  },
  // 分配方式：manual(坐席手动接入)、round_robin(轮询)、least_load(最少负载)
  assignmentMode: {
    type: String,
    enum: ['manual', 'round_robin', 'least_load'],
    default: 'manual',
  },
  agentIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TenantUser',
  }],
  status: {
    type: String,
    enum: ['online', 'offline'],
    default: 'online',
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TenantUser',
  },
}, {
  timestamps: true,
  versionKey: false,
});

module.exports = mongoose.model('Channel', ChannelSchema, 'channels');
