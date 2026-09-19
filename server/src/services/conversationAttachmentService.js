// 忆梦云团队开发 - 会话附件存储、授权与生命周期服务
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const ConversationAttachment = require('../models/ConversationAttachment');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Channel = require('../models/Channel');
const { getSystemSettings } = require('../utils/systemSettings');

const UPLOAD_ROOT = path.resolve(__dirname, '..', '..', 'uploads');
const CONVERSATION_ROOT = path.join(UPLOAD_ROOT, 'conversations');
const CATEGORY_BY_TYPE = { image: 'image', video: 'video', file: 'file' };

function absoluteStoragePath(storageKey) {
  const normalizedKey = String(storageKey || '').replace(/\\/g, '/');
  const segments = normalizedKey.split('/');
  if (segments.length < 2 || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('附件路径无效');
  }
  const target = path.resolve(UPLOAD_ROOT, ...segments);
  const relative = path.relative(UPLOAD_ROOT, target);
  if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('附件路径无效');
  return target;
}

async function fileExists(storageKey) {
  try {
    await fs.promises.access(absoluteStoragePath(storageKey));
    return true;
  } catch (_) {
    return false;
  }
}

async function removeFile(storageKey) {
  if (!storageKey) return;
  try {
    await fs.promises.unlink(absoluteStoragePath(storageKey));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function checksum(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

async function canAccessAttachment(req, attachment) {
  const conv = await Conversation.findOne({
    _id: attachment.conversationId,
    tenantId: attachment.tenantId,
    channelId: attachment.channelId,
  });
  if (!conv) return false;
  if (req.admin) return true;
  if (String(req.tenantId) !== String(attachment.tenantId)) return false;
  if (req.user) {
    if (req.user.role !== 'agent') return true;
    const authorized = await Channel.exists({
      _id: attachment.channelId,
      tenantId: attachment.tenantId,
      agentIds: req.user.id,
    });
    return Boolean(authorized) && (conv.status === 'waiting' || String(conv.assignedAgentId) === String(req.user.id));
  }
  if (req.customer) {
    return String(req.customer.id) === String(conv.customerId)
      && String(req.customer.tenantId) === String(attachment.tenantId)
      && String(req.customer.channelId) === String(attachment.channelId)
      && (!req.customer.conversationId || String(req.customer.conversationId) === String(conv._id));
  }
  return false;
}

async function validatePendingAttachment({ attachmentId, tenantId, channelId, conversationId, uploaderType, uploaderId, messageType }) {
  if (!mongoose.isValidObjectId(attachmentId)) throw new Error('附件 ID 无效');
  const attachment = await ConversationAttachment.findOne({
    _id: attachmentId,
    tenantId,
    channelId,
    conversationId,
    uploaderType,
    uploaderId,
    status: 'pending',
    deleteAfter: { $gt: new Date() },
  });
  if (!attachment) throw new Error('附件不存在、已过期、已使用或无权绑定');
  const categoryMatches = CATEGORY_BY_TYPE[messageType] === attachment.category
    || (messageType === 'file' && attachment.category === 'audio');
  if (!categoryMatches) throw new Error('附件类型与消息类型不匹配');
  const settings = await getSystemSettings();
  const maxFileSizeMB = Math.min(Math.max(Number(settings.upload.maxFileSizeMB) || 10, 1), 1024);
  const allowedTypes = Array.isArray(settings.upload.allowedTypes) ? settings.upload.allowedTypes : [];
  if (attachment.size > maxFileSizeMB * 1024 * 1024) throw new Error('附件超过当前大小限制');
  if (!allowedTypes.includes(attachment.extension)) throw new Error('附件类型已被系统设置禁用');
  if (!await fileExists(attachment.storageKey)) throw new Error('附件文件不存在');
  return attachment;
}

async function createMessageWithAttachment(messageData, attachment) {
  if (!attachment) return Message.create(messageData);
  const settings = await getSystemSettings();
  const retentionDays = settings.storage.conversationAttachmentRetentionDays;
  const activatedAt = new Date(messageData.createdAt || Date.now());
  const attachmentExpiredAt = new Date(activatedAt.getTime() + retentionDays * 86400000);
  const message = await Message.create({
    ...messageData,
    attachmentId: attachment._id,
    attachmentStatus: 'none',
    attachmentName: attachment.originalName,
    attachmentUrl: '',
    thumbnailUrl: '',
  });
  const activated = await ConversationAttachment.findOneAndUpdate(
    {
      _id: attachment._id,
      tenantId: messageData.tenantId,
      channelId: attachment.channelId,
      conversationId: messageData.conversationId,
      uploaderType: attachment.uploaderType,
      uploaderId: attachment.uploaderId,
      status: 'pending',
      messageId: null,
      deleteAfter: { $gt: new Date() },
    },
    {
      $set: {
        status: 'active',
        messageId: message._id,
        activatedAt,
        expiresAt: attachmentExpiredAt,
        deleteAfter: attachmentExpiredAt,
        deleteReason: 'expired',
      },
    },
    { new: true },
  );
  if (!activated) {
    await Message.deleteOne({ _id: message._id, attachmentStatus: 'none' });
    throw new Error('附件已过期或被其他消息使用');
  }
  try {
    message.attachmentStatus = 'active';
    message.attachmentExpiredAt = attachmentExpiredAt;
    await message.save();
    return message;
  } catch (err) {
    await ConversationAttachment.updateOne(
      { _id: attachment._id, status: 'active', messageId: message._id },
      {
        $set: {
          status: 'deleting',
          deleteAfter: new Date(),
          deleteReason: 'orphaned',
          cleanupLeaseUntil: null,
          cleanupLeaseId: '',
        },
      },
    );
    await Message.deleteOne({ _id: message._id, attachmentStatus: { $ne: 'active' } });
    throw err;
  }
}

async function discardUnpublishedMessage(message, attachment) {
  if (!message) return;
  if (attachment) {
    await ConversationAttachment.updateOne(
      { _id: attachment._id, status: 'active', messageId: message._id },
      {
        $set: {
          status: 'deleting',
          deleteAfter: new Date(),
          deleteReason: 'orphaned',
          cleanupLeaseUntil: null,
          cleanupLeaseId: '',
        },
      },
    );
  }
  await Message.deleteOne({ _id: message._id });
}

async function recallAttachment(message, recalledAt = new Date()) {
  if (!message.attachmentId) return;
  await ConversationAttachment.updateOne(
    { _id: message.attachmentId, tenantId: message.tenantId, messageId: message._id },
    { $set: { status: 'deleting', deleteAfter: recalledAt, deleteReason: 'recalled', cleanupLeaseUntil: null, cleanupLeaseId: '' } },
  );
  message.attachmentStatus = 'recalled';
  message.attachmentExpiredAt = recalledAt;
}

function controlledUrls(attachmentId) {
  if (!attachmentId) return {};
  return {
    attachmentUrl: `/api/files/${attachmentId}`,
    thumbnailUrl: `/api/files/${attachmentId}/thumbnail`,
  };
}

module.exports = {
  UPLOAD_ROOT,
  CONVERSATION_ROOT,
  absoluteStoragePath,
  fileExists,
  removeFile,
  checksum,
  canAccessAttachment,
  validatePendingAttachment,
  createMessageWithAttachment,
  discardUnpublishedMessage,
  recallAttachment,
  controlledUrls,
};
