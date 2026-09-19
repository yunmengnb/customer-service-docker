// 忆梦云团队开发 - 会话附件上传控制器
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { execFile } = require('child_process');
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const ConversationAttachment = require('../models/ConversationAttachment');
const Channel = require('../models/Channel');
const Customer = require('../models/Customer');
const { getSystemSettings } = require('../utils/systemSettings');
const { ok, error } = require('../utils');
const { UPLOAD_ROOT, checksum } = require('../services/conversationAttachmentService');

const MIME_BY_EXTENSION = {
  jpg: ['image/jpeg'], jpeg: ['image/jpeg'], png: ['image/png'], gif: ['image/gif'], webp: ['image/webp'],
  pdf: ['application/pdf'], docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], zip: ['application/zip', 'application/x-zip-compressed'],
  txt: ['text/plain'], mp3: ['audio/mpeg'], wav: ['audio/wav', 'audio/x-wav'], ogg: ['audio/ogg'],
  mp4: ['video/mp4'], webm: ['video/webm'], mov: ['video/quicktime'],
};

function matchesSignature(buffer, ext) {
  const hex = buffer.subarray(0, 12).toString('hex');
  if (['jpg', 'jpeg'].includes(ext)) return hex.startsWith('ffd8ff');
  if (ext === 'png') return hex.startsWith('89504e470d0a1a0a');
  if (ext === 'gif') return buffer.subarray(0, 6).toString() === 'GIF87a' || buffer.subarray(0, 6).toString() === 'GIF89a';
  if (ext === 'webp') return buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  if (['pdf'].includes(ext)) return buffer.subarray(0, 5).toString() === '%PDF-';
  if (['zip', 'docx', 'xlsx'].includes(ext)) return hex.startsWith('504b');
  if (ext === 'mp3') return buffer.subarray(0, 3).toString() === 'ID3' || buffer[0] === 0xff;
  if (ext === 'wav') return buffer.subarray(0, 4).toString() === 'RIFF';
  if (ext === 'ogg') return buffer.subarray(0, 4).toString() === 'OggS';
  if (ext === 'mp4' || ext === 'mov') return buffer.subarray(4, 8).toString() === 'ftyp';
  if (ext === 'webm') return hex.startsWith('1a45dfa3');
  return ext === 'txt';
}

function categoryFor(mime) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

async function fastStart(input, maxBytes = Infinity) {
  const output = path.join(path.dirname(input), 'faststart-' + require('crypto').randomUUID() + '.mp4');
  try {
    await new Promise((resolve, reject) => execFile(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-n', '-i', input, '-map', '0',
      '-c', 'copy', '-movflags', '+faststart', output,
    ], { windowsHide: true, timeout: 30000 }, err => err ? reject(err) : resolve()));
    const stat = await fs.promises.stat(output);
    if (!stat.size || stat.size > maxBytes) return false;
    await fs.promises.rename(output, input);
    return true;
  } catch (_) { return false; } // Original stays intact when remux fails.
  finally { await fs.promises.rm(output, { force: true }).catch(() => {}); }
}

async function makeThumbnail(input, output) {
  await new Promise((resolve, reject) => execFile(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.2', '-i', input,
    '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '3', output,
  ], { windowsHide: true, timeout: 30000 }, err => err ? reject(err) : resolve()));
}

async function resolveConversation(req, client) {
  if (!client) {
    if (!mongoose.isValidObjectId(req.params?.conversationId)) return null;
    const conv = await Conversation.findOne({ _id: req.params.conversationId, tenantId: req.tenantId });
    if (!conv) return null;
    const channel = await Channel.exists({
      _id: conv.channelId,
      tenantId: req.tenantId,
      ...(req.user.role === 'agent' ? { agentIds: req.user.id } : {}),
    });
    if (!channel) return null;
    if (req.user.role === 'agent' && (conv.status !== 'waiting' && String(conv.assignedAgentId) !== String(req.user.id))) return null;
    return conv;
  }
  const [customer, channel] = await Promise.all([
    Customer.findOne({
      _id: req.customer.id,
      tenantId: req.customer.tenantId,
      channelId: req.customer.channelId,
      status: 'active',
      blocked: false,
    }),
    Channel.findOne({
      _id: req.customer.channelId,
      tenantId: req.customer.tenantId,
    }).select('_id'),
  ]);
  if (!customer || !channel) return null;
  let conv = await Conversation.findOne({
    ...(req.customer.conversationId ? { _id: req.customer.conversationId } : {}),
    tenantId: req.customer.tenantId,
    channelId: req.customer.channelId,
    customerId: req.customer.id,
  }).sort({ lastMessageAt: -1 });
  if (!conv) {
    conv = await Conversation.create({
      tenantId: req.customer.tenantId,
      channelId: req.customer.channelId,
      customerId: req.customer.id,
      status: 'waiting',
    });
  }
  return conv;
}

async function upload(req, res, client) {
  const settings = await getSystemSettings();
  const maxFileSizeMB = Math.min(Math.max(Number(settings.upload.maxFileSizeMB) || 10, 1), 1024);
  const parser = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSizeMB * 1024 * 1024 },
    defParamCharset: 'utf8',
  }).single('file');
  parser(req, res, async parseError => {
    if (parseError) return error(res, parseError.code === 'LIMIT_FILE_SIZE' ? `文件大小不能超过 ${maxFileSizeMB}MB` : '文件上传失败', 4001, 400);
    if (!req.file) return error(res, '未上传文件');
    const ext = path.extname(req.file.originalname).toLowerCase().slice(1);
    const allowedMimes = MIME_BY_EXTENSION[ext] || [];
    if (!settings.upload.allowedTypes.includes(ext) || !allowedMimes.includes(String(req.file.mimetype).toLowerCase()) || !matchesSignature(req.file.buffer, ext)) {
      return error(res, '文件类型或文件内容无效', 4001, 400);
    }
    let conv;
    try {
      conv = await resolveConversation(req, client);
    } catch (_) {
      return error(res, '会话校验失败', 5001, 500);
    }
    if (!conv) return error(res, '会话不存在或无权访问', 4031, 403);
    const attachmentId = new mongoose.Types.ObjectId();
    const relativeDir = path.posix.join('conversations', String(conv.tenantId), String(attachmentId));
    const diskDir = path.join(UPLOAD_ROOT, ...relativeDir.split('/'));
    const storageKey = path.posix.join(relativeDir, `original.${ext}`);
    const thumbnailStorageKey = req.file.mimetype.startsWith('video/') ? path.posix.join(relativeDir, 'thumbnail.jpg') : '';
    try {
      await fs.promises.mkdir(diskDir, { recursive: true });
      const diskPath = path.join(UPLOAD_ROOT, ...storageKey.split('/'));
      await fs.promises.writeFile(diskPath, req.file.buffer, { flag: 'wx' });
      if (ext === 'mp4') await fastStart(diskPath, maxFileSizeMB * 1024 * 1024);
      const storedSize = (await fs.promises.stat(diskPath)).size;
      if (thumbnailStorageKey) await makeThumbnail(diskPath, path.join(UPLOAD_ROOT, ...thumbnailStorageKey.split('/')));
      const uploadedAt = new Date();
      const attachment = await ConversationAttachment.create({
        _id: attachmentId,
        tenantId: conv.tenantId,
        channelId: conv.channelId,
        conversationId: conv._id,
        uploaderType: client ? 'customer' : 'agent',
        uploaderId: client ? req.customer.id : req.user.id,
        category: categoryFor(req.file.mimetype),
        storageKey,
        thumbnailStorageKey,
        originalName: path.basename(req.file.originalname).replace(/[\r\n"]/g, '').slice(0, 255),
        extension: ext,
        mimeType: req.file.mimetype,
        size: storedSize,
        checksum: await checksum(diskPath),
        uploadedAt,
        deleteAfter: new Date(uploadedAt.getTime() + settings.storage.pendingAttachmentHours * 3600000),
      });
      return ok(res, {
        attachmentId: attachment._id,
        category: attachment.category,
        name: attachment.originalName,
        size: attachment.size,
        mimeType: attachment.mimeType,
        status: attachment.status,
      });
    } catch (err) {
      await fs.promises.rm(diskDir, { recursive: true, force: true });
      return error(res, thumbnailStorageKey ? '无法解析视频或生成缩略图失败' : '附件保存失败', 5001, 500);
    }
  });
}

module.exports = {
  fastStart,
  uploadTenant(req, res) { return upload(req, res, false); },
  uploadCustomer(req, res) { return upload(req, res, true); },
};
