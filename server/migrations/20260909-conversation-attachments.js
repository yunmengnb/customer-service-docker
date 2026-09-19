// 忆梦云团队开发 - 历史公开 URL 会话附件迁移脚本
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const Message = require('../src/models/Message');
const Conversation = require('../src/models/Conversation');
const ConversationAttachment = require('../src/models/ConversationAttachment');
const Channel = require('../src/models/Channel');
const TenantUser = require('../src/models/TenantUser');
const Customer = require('../src/models/Customer');
const CustomerAccount = require('../src/models/CustomerAccount');
const PlatformAdmin = require('../src/models/PlatformAdmin');
const KeywordReply = require('../src/models/KeywordReply');
const QuickReply = require('../src/models/QuickReply');
const { absoluteStoragePath, checksum } = require('../src/services/conversationAttachmentService');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const limitArg = process.argv.find(value => value.startsWith('--limit='));
const afterArg = process.argv.find(value => value.startsWith('--after='));
const limit = Math.min(Math.max(Number(limitArg?.split('=')[1]) || 100, 1), 1000);
const after = String(afterArg?.slice('--after='.length) || '').trim();
const RETENTION_MS = 2 * 86400000;
const LEGACY_MESSAGE_DIRS = new Set(['tenant', 'customer']);
const MIME_BY_EXTENSION = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip',
  txt: 'text/plain', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
};

function storageKeyFromUrl(value) {
  try {
    const parsed = new URL(String(value), 'http://localhost');
    if (!parsed.pathname.startsWith('/uploads/')) return null;
    const key = decodeURIComponent(parsed.pathname.slice('/uploads/'.length)).replace(/\\/g, '/');
    const segments = key.split('/');
    if (segments.length !== 3 || !mongoose.isValidObjectId(segments[0]) || !LEGACY_MESSAGE_DIRS.has(segments[1])) return null;
    return { key, full: absoluteStoragePath(key) };
  } catch (_) {
    return null;
  }
}

function attachmentState(message, expiresAt, now) {
  if (message.recalledAt) {
    return { status: 'deleting', messageStatus: 'recalled', deleteAfter: message.recalledAt, deleteReason: 'recalled' };
  }
  if (expiresAt <= now) {
    return { status: 'deleting', messageStatus: 'expired', deleteAfter: now, deleteReason: 'expired' };
  }
  return { status: 'active', messageStatus: 'active', deleteAfter: expiresAt, deleteReason: 'expired' };
}

function resourceUrlPattern(storageKey) {
  const pathname = `/uploads/${storageKey}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^(?:https?://[^/]+)?${pathname}(?:[?#].*)?$`, 'i');
}

async function usedByNonConversationResource(storageKey) {
  const url = resourceUrlPattern(storageKey);
  const queries = [
    Channel.exists({ $or: [{ avatarUrl: url }, { welcomeImageUrl: url }] }),
    TenantUser.exists({ avatarUrl: url }),
    Customer.exists({ avatarUrl: url }),
    CustomerAccount.exists({ avatarUrl: url }),
    PlatformAdmin.exists({ avatarUrl: url }),
    KeywordReply.exists({ imageUrl: url }),
    QuickReply.exists({ imageUrl: url }),
  ];
  return (await Promise.all(queries)).some(Boolean);
}

function protectedStorageKey(tenantId, attachmentId, ext) {
  return path.posix.join('conversations', String(tenantId), String(attachmentId), `original.${ext}`);
}

function protectedThumbnailKey(tenantId, attachmentId) {
  return path.posix.join('conversations', String(tenantId), String(attachmentId), 'thumbnail.jpg');
}

// 将旧公开目录文件移动/复制到受保护目录；目标已存在时视为已就位，仅清理残留旧源。
async function relocateFile(from, to) {
  try {
    await fs.promises.access(to);
    if (from !== to) {
      try { await fs.promises.unlink(from); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    }
    return;
  } catch (_) { /* 目标不存在，继续移动 */ }
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.promises.rename(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fs.promises.copyFile(from, to);
    try { await fs.promises.unlink(from); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}

async function main() {
  if (after && !mongoose.isValidObjectId(after)) throw new Error('--after 必须是有效的消息 ObjectId');
  await connectDB();
  const query = {
    _id: after ? { $gt: after } : { $exists: true },
    messageType: { $in: ['image', 'video', 'file'] },
    senderType: { $in: ['agent', 'customer'] },
    senderId: { $ne: null },
    autoReplyType: null,
    // 同时覆盖曾由旧版脚本写入 attachmentId、但文件仍在公开目录的记录
    attachmentUrl: { $type: 'string', $ne: '' },
  };
  const messages = await Message.find(query).sort({ _id: 1 }).limit(limit).lean();
  const report = {
    dryRun,
    limit,
    after: after || null,
    nextAfter: messages.length ? String(messages[messages.length - 1]._id) : null,
    scanned: messages.length,
    migratable: 0,
    migrated: 0,
    alreadyMigrated: 0,
    missing: 0,
    invalid: 0,
    expired: 0,
    errors: [],
  };
  const now = new Date();

  for (const message of messages) {
    try {
      const parsed = storageKeyFromUrl(message.attachmentUrl);
      if (!parsed || await usedByNonConversationResource(parsed.key)) {
        report.invalid += 1;
        continue;
      }
      let stat;
      try {
        stat = await fs.promises.stat(parsed.full);
        if (!stat.isFile()) throw new Error('not-file');
      } catch (_) {
        report.missing += 1;
        continue;
      }
      const conv = await Conversation.findOne({
        _id: message.conversationId,
        tenantId: message.tenantId,
        customerId: message.senderType === 'customer' ? message.senderId : { $exists: true },
      }).select('_id tenantId channelId customerId');
      if (!conv || String(parsed.key.split('/')[0]) !== String(message.tenantId)) {
        report.invalid += 1;
        continue;
      }
      const thumbnail = message.messageType === 'video' ? storageKeyFromUrl(message.thumbnailUrl) : null;
      let thumbnailStat = null;
      if (thumbnail) {
        try {
          thumbnailStat = await fs.promises.stat(thumbnail.full);
          if (!thumbnailStat.isFile() || path.dirname(thumbnail.key) !== path.dirname(parsed.key)) thumbnailStat = null;
        } catch (_) {
          thumbnailStat = null;
        }
      }
      const expiresAt = new Date(new Date(message.createdAt).getTime() + RETENTION_MS);
      if (Number.isNaN(expiresAt.getTime())) {
        report.invalid += 1;
        continue;
      }
      const state = attachmentState(message, expiresAt, now);
      report.migratable += 1;
      if (state.messageStatus === 'expired') report.expired += 1;
      if (dryRun) continue;

      // 文件从旧公开目录迁移到受保护目录，杜绝经 /uploads 静态暴露绕过鉴权
      const ext = path.extname(parsed.key).slice(1).toLowerCase() || 'bin';
      let attachment = await ConversationAttachment.findOne({ messageId: message._id });
      if (!attachment && await ConversationAttachment.exists({ storageKey: parsed.key })) {
        report.invalid += 1;
        continue;
      }
      const attachmentId = attachment ? attachment._id : new mongoose.Types.ObjectId();
      const newStorageKey = protectedStorageKey(message.tenantId, attachmentId, ext);
      const newThumbnailKey = thumbnailStat ? protectedThumbnailKey(message.tenantId, attachmentId) : '';
      try {
        await relocateFile(parsed.full, absoluteStoragePath(newStorageKey));
        if (newThumbnailKey) await relocateFile(thumbnail.full, absoluteStoragePath(newThumbnailKey));
      } catch (err) {
        report.errors.push({ messageId: String(message._id), error: `移动文件失败: ${err.message}` });
        continue;
      }
      const existedBefore = Boolean(attachment);
      if (!attachment) {
        try {
          attachment = await ConversationAttachment.create({
            _id: attachmentId,
            tenantId: message.tenantId,
            channelId: conv.channelId,
            conversationId: conv._id,
            messageId: message._id,
            uploaderType: message.senderType,
            uploaderId: message.senderId,
            category: message.messageType,
            storageKey: newStorageKey,
            thumbnailStorageKey: newThumbnailKey,
            originalName: message.attachmentName || path.basename(parsed.key),
            extension: ext,
            mimeType: MIME_BY_EXTENSION[ext] || 'application/octet-stream',
            size: stat.size,
            checksum: await checksum(absoluteStoragePath(newStorageKey)),
            status: state.status,
            uploadedAt: message.createdAt,
            activatedAt: message.createdAt,
            expiresAt,
            deleteAfter: state.deleteAfter,
            deleteReason: state.deleteReason,
          });
        } catch (err) {
          if (err?.code !== 11000) throw err;
          attachment = await ConversationAttachment.findOne({ messageId: message._id });
          if (!attachment) throw err;
        }
      } else if (attachment.storageKey !== newStorageKey || attachment.thumbnailStorageKey !== newThumbnailKey) {
        await ConversationAttachment.updateOne(
          { _id: attachment._id },
          { $set: { storageKey: newStorageKey, thumbnailStorageKey: newThumbnailKey } },
        );
      }

      const updated = await Message.updateOne(
        { _id: message._id, tenantId: message.tenantId },
        { $set: { attachmentId: attachment._id, attachmentStatus: state.messageStatus, attachmentExpiredAt: expiresAt, attachmentUrl: '', thumbnailUrl: '' } },
      );
      if (updated.modifiedCount) {
        report.migrated += 1;
        if (existedBefore) report.alreadyMigrated += 1;
      } else {
        report.alreadyMigrated += 1;
      }
    } catch (err) {
      report.errors.push({ messageId: String(message._id), error: err.message });
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch(err => {
    console.error('[Migration] 迁移失败:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
