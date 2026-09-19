// 忆梦云团队开发 - 会话附件定时清理、租约与重试服务
const crypto = require('crypto');
const ConversationAttachment = require('../models/ConversationAttachment');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { removeFile } = require('./conversationAttachmentService');
const { getSystemSettings } = require('../utils/systemSettings');

let running = false;
let timer = null;
let lastRun = null;

async function claim(now, leaseId) {
  const leaseUntil = new Date(now.getTime() + 10 * 60 * 1000);
  const attachment = await ConversationAttachment.findOneAndUpdate(
      {
        deleteAfter: { $lte: now },
        status: { $in: ['pending', 'active', 'deleting', 'failed'] },
        $or: [
          { cleanupLeaseUntil: null },
          { cleanupLeaseUntil: { $exists: false } },
          { cleanupLeaseUntil: { $lte: now } },
        ],
      },
      [{
        $set: {
          deleteReason: { $cond: [{ $eq: ['$status', 'pending'] }, 'orphaned', '$deleteReason'] },
          status: 'deleting',
          cleanupLeaseUntil: leaseUntil,
          cleanupLeaseId: leaseId,
        },
      }],
      { new: true, sort: { deleteAfter: 1 }, updatePipeline: true },
    );
  return attachment;
}

async function runCleanup(options = {}) {
  if (running) return { running: true, message: '清理任务正在运行' };
  running = true;
  const startedAt = new Date();
  const taskId = crypto.randomUUID();
  const result = { taskId, startedAt, scanned: 0, deleted: 0, failed: 0, releasedBytes: 0, errors: [] };
  try {
    const settings = await getSystemSettings();
    const limit = Math.min(Math.max(Number(options.limit) || settings.storage.cleanupBatchSize, 1), 100);
    for (let index = 0; index < limit; index += 1) {
      const leaseId = `${taskId}:${index}`;
      const attachment = await claim(new Date(), leaseId);
      if (!attachment) break;
      result.scanned += 1;
      try {
        await removeFile(attachment.thumbnailStorageKey);
        await removeFile(attachment.storageKey);
        const status = attachment.deleteReason === 'recalled' ? 'recalled' : (attachment.deleteReason === 'expired' ? 'expired' : 'deleted');
        if (attachment.messageId) {
          await Message.updateOne(
            { _id: attachment.messageId, tenantId: attachment.tenantId, attachmentId: attachment._id },
            { $set: { attachmentStatus: status } },
          );
        }
        const completed = await ConversationAttachment.findOneAndUpdate(
          { _id: attachment._id, status: 'deleting', cleanupLeaseId: leaseId },
          {
            $set: {
              status: 'deleted',
              deletedAt: new Date(),
              cleanupLeaseUntil: null,
              cleanupLeaseId: '',
              lastCleanupError: '',
            },
          },
          { new: true },
        );
        if (!completed) throw new Error('附件清理租约已失效');
        if (attachment.messageId) {
          const io = options.io;
          if (io) {
            const payload = { conversationId: attachment.conversationId, messageId: attachment.messageId, attachmentId: attachment._id, status, expiredAt: attachment.expiresAt };
            io.to(`tenant-${attachment.tenantId}`).to(`channel-staff-${attachment.channelId}`).emit('attachment.updated', payload);
            const conversation = await Conversation.findOne({
              _id: attachment.conversationId,
              tenantId: attachment.tenantId,
              channelId: attachment.channelId,
            }).select('customerId');
            if (conversation) io.to(`customer-${conversation.customerId}`).emit('attachment.updated', payload);
          }
        }
        result.deleted += 1;
        result.releasedBytes += attachment.size || 0;
      } catch (err) {
        const attempts = (attachment.cleanupAttempts || 0) + 1;
        const lastCleanupError = String(err.message || err).slice(0, 500);
        const failed = await ConversationAttachment.findOneAndUpdate(
          { _id: attachment._id, cleanupLeaseId: leaseId },
          {
            $set: {
              status: 'failed',
              cleanupAttempts: attempts,
              lastCleanupError,
              cleanupLeaseUntil: null,
              cleanupLeaseId: '',
              deleteAfter: new Date(Date.now() + Math.min(2 ** attempts * 60000, 6 * 3600000)),
            },
          },
          { new: true },
        );
        result.failed += 1;
        result.errors.push({ attachmentId: attachment._id, error: failed?.lastCleanupError || lastCleanupError });
      }
    }
  } finally {
    running = false;
    result.finishedAt = new Date();
    lastRun = result;
  }
  return result;
}

async function estimate() {
  const now = new Date();
  const [totals, due] = await Promise.all([
    ConversationAttachment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, bytes: { $sum: '$size' } } }]),
    ConversationAttachment.aggregate([{ $match: { deleteAfter: { $lte: now }, status: { $in: ['pending', 'active', 'deleting', 'failed'] } } }, { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: '$size' } } }]),
  ]);
  return { generatedAt: now, totals, due: due[0] || { count: 0, bytes: 0 } };
}

function getStatus() {
  return { running, isRunning: running, scheduled: Boolean(timer), intervalMs: 3600000, lastRun };
}

function start(io) {
  if (timer) return;
  const execute = () => runCleanup({ io }).catch(err => console.error('[AttachmentCleanup] 清理失败:', err.message));
  timer = setInterval(execute, 3600000);
  timer.unref();
  execute();
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = { runCleanup, estimate, getStatus, start, stop };
