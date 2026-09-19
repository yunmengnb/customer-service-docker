// 忆梦云团队开发 - 客户投诉凭证专属上传
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { authCustomer } = require('../middleware/auth');
const Customer = require('../models/Customer');
const Conversation = require('../models/Conversation');
const config = require('../config');
const { ok, error } = require('../utils');
const { getSystemSettings } = require('../utils/systemSettings');

const router = express.Router();
const UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'uploads');
const IMAGE_MIMES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

function removeFile(filePath) {
  fs.unlink(filePath, () => {});
}

async function hasValidImageSignature(filePath, ext) {
  const handle = await fs.promises.open(filePath, 'r');
  const bytes = Buffer.alloc(12);
  try {
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead < 3) return false;
  } finally {
    await handle.close();
  }
  if (ext === 'jpg' || ext === 'jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (ext === 'png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (ext === 'gif') return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
  if (ext === 'webp') return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

function signImage(customer, url) {
  const { id, accountId, tenantId, channelId, conversationId } = customer;
  return crypto.createHmac('sha256', config.jwt.secret)
    .update(`${id}:${accountId}:${tenantId}:${channelId}:${conversationId}:${url}`)
    .digest('hex');
}

router.post('/', authCustomer, async (req, res) => {
  try {
    const { id, accountId, tenantId, channelId, conversationId } = req.customer;
    const contextIds = [id, accountId, tenantId, channelId, conversationId];
    if (!contextIds.every(value => mongoose.isValidObjectId(value))) {
      return error(res, '当前客户会话无效，请重新登录', 4012, 401);
    }
    const [customer, conversation] = await Promise.all([
      Customer.exists({ _id: id, accountId, tenantId, channelId }),
      Conversation.exists({ _id: conversationId, customerId: id, tenantId, channelId }),
    ]);
    if (!customer || !conversation) return error(res, '当前客户会话无效，请重新登录', 4012, 401);
    const settings = await getSystemSettings();
    const allowed = new Set(settings.upload.allowedTypes);
    const upload = multer({
      storage: multer.diskStorage({
        destination: (uploadReq, file, cb) => {
          const dir = path.join(UPLOAD_DIR, String(uploadReq.customer.tenantId), 'complaints');
          fs.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (uploadReq, file, cb) => {
          const ext = path.extname(file.originalname).toLowerCase();
          cb(null, `${Date.now()}_${crypto.randomBytes(12).toString('hex')}${ext}`);
        },
      }),
      limits: { fileSize: settings.upload.maxFileSizeMB * 1024 * 1024 },
      defParamCharset: 'utf8',
      fileFilter: (uploadReq, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase().slice(1);
        if (allowed.has(ext) && IMAGE_MIMES[ext] === String(file.mimetype).toLowerCase()) return cb(null, true);
        return cb(new Error('投诉凭证仅支持 JPG、PNG、GIF、WEBP 图片'));
      },
    });
    upload.single('file')(req, res, async err => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return error(res, `文件大小不能超过 ${settings.upload.maxFileSizeMB}MB`, 4001, 400);
      }
      if (err) return error(res, err.message, 4001, 400);
      if (!req.file) return error(res, '未上传文件');
      try {
        const ext = path.extname(req.file.originalname).toLowerCase().slice(1);
        if (!await hasValidImageSignature(req.file.path, ext)) {
          removeFile(req.file.path);
          return error(res, '投诉图片内容无效', 4001, 400);
        }
        const url = '/uploads/' + path.relative(UPLOAD_DIR, req.file.path).replace(/\\/g, '/');
        return ok(res, {
          url,
          signature: signImage(req.customer, url),
          name: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
          isImage: true,
        });
      } catch (_) {
        removeFile(req.file.path);
        return error(res, '投诉图片校验失败', 5001, 500);
      }
    });
  } catch (_) {
    return error(res, '上传配置加载失败', 5001, 500);
  }
});

module.exports = router;
