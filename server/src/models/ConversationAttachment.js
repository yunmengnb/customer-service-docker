// 忆梦云团队开发 - 会话附件生命周期模型
const mongoose = require('mongoose');

const ConversationAttachmentSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  uploaderType: { type: String, enum: ['agent', 'customer', 'bot'], required: true },
  uploaderId: { type: mongoose.Schema.Types.ObjectId, required: true },
  category: { type: String, enum: ['image', 'video', 'audio', 'file'], required: true },
  storageProvider: { type: String, enum: ['local', 's3'], default: 'local' },
  storageKey: { type: String, required: true, unique: true },
  thumbnailStorageKey: { type: String, default: '' },
  originalName: { type: String, default: '', maxlength: 255 },
  extension: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true, min: 0 },
  checksum: { type: String, required: true },
  status: { type: String, enum: ['pending', 'active', 'deleting', 'deleted', 'failed'], default: 'pending' },
  uploadedAt: { type: Date, default: Date.now },
  activatedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
  deleteAfter: { type: Date, required: true },
  deletedAt: { type: Date, default: null },
  deleteReason: { type: String, enum: ['expired', 'recalled', 'orphaned', ''], default: '' },
  cleanupAttempts: { type: Number, default: 0 },
  lastCleanupError: { type: String, default: '' },
  cleanupLeaseUntil: { type: Date, default: null },
  cleanupLeaseId: { type: String, default: '' },
}, { timestamps: true, versionKey: false });

ConversationAttachmentSchema.index({ status: 1, deleteAfter: 1, cleanupLeaseUntil: 1 });
ConversationAttachmentSchema.index({ tenantId: 1, conversationId: 1, uploadedAt: -1 });
ConversationAttachmentSchema.index({ messageId: 1 }, { unique: true, partialFilterExpression: { messageId: { $type: 'objectId' } } });
ConversationAttachmentSchema.index({ uploaderType: 1, uploaderId: 1, status: 1, deleteAfter: 1 });

module.exports = mongoose.model('ConversationAttachment', ConversationAttachmentSchema, 'conversation_attachments');
