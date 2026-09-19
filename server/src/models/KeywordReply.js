// 忆梦云团队开发
const mongoose = require('mongoose');

const KeywordReplySchema = new mongoose.Schema({
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
  keyword: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  matchType: {
    type: String,
    enum: ['exact', 'contains'],
    default: 'contains',
  },
  replyContent: {
    type: String,
    default: '',
    maxlength: 500,
  },
  imageUrl: {
    type: String,
    default: '',
  },
  imageName: {
    type: String,
    default: '',
    maxlength: 255,
  },
  priority: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['active', 'disabled'],
    default: 'active',
  },
}, {
  timestamps: true,
  versionKey: false,
});

KeywordReplySchema.index({ tenantId: 1, channelId: 1, status: 1 });

module.exports = mongoose.model('KeywordReply', KeywordReplySchema, 'keyword_replies');
