// 忆梦云团队开发
const mongoose = require('mongoose');

const ComplaintSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  tenantSnapshot: {
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
  },
  agentSnapshot: {
    id: { type: mongoose.Schema.Types.ObjectId, default: null },
    displayName: { type: String, default: '', trim: true, maxlength: 50 },
    username: { type: String, default: '', trim: true, maxlength: 50 },
  },
  channelSnapshot: {
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true, maxlength: 50 },
    brandName: { type: String, default: '', trim: true, maxlength: 50 },
  },
  customerSnapshot: {
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, required: true },
    phone: { type: String, required: true, trim: true, maxlength: 30 },
    email: { type: String, default: '', trim: true, lowercase: true, maxlength: 200 },
    qq: { type: String, default: '', trim: true, maxlength: 20 },
    nickname: { type: String, default: '', trim: true, maxlength: 50 },
  },
  category: {
    type: String,
    enum: ['platform', 'agent'],
    required: true,
    index: true,
  },
  subject: { type: String, required: true, trim: true, maxlength: 100 },
  content: { type: String, required: true, trim: true, maxlength: 5000 },
  images: [{ type: String, trim: true }],
  status: {
    type: String,
    enum: ['pending', 'processing', 'resolved'],
    default: 'pending',
    index: true,
  },
  submittedIp: { type: String, default: '' },
  userAgent: { type: String, default: '', maxlength: 500 },
}, {
  timestamps: true,
  versionKey: false,
});

ComplaintSchema.index({ createdAt: -1 });
ComplaintSchema.index({ status: 1, createdAt: -1 });
ComplaintSchema.index({ 'customerSnapshot.accountId': 1, createdAt: -1 });

module.exports = mongoose.model('Complaint', ComplaintSchema, 'complaints');
