// 忆梦云团队开发 - 私有会话附件读取控制器
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { authAdmin, authTenantUser, authCustomer } = require('../middleware/auth');
const playbackKey = crypto.createHmac('sha256', config.jwt.secret).update('attachment-video-playback-v1').digest();
const PLAYBACK_SECONDS = 300;
const ConversationAttachment = require('../models/ConversationAttachment');
const Message = require('../models/Message');
const { error, ok } = require('../utils');
const { absoluteStoragePath, canAccessAttachment } = require('../services/conversationAttachmentService');

function disposition(name) {
  const safe = path.basename(String(name || 'file')).replace(/[\r\n"]/g, '');
  return `inline; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function setPrivateHeaders(res) {
  res.set({
    'Cache-Control': 'private, no-store, max-age=0',
    'Referrer-Policy': 'no-referrer',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Content-Type-Options': 'nosniff',
  });
}

function pipeFile(res, filePath, options) {
  const stream = fs.createReadStream(filePath, options);
  stream.on('error', () => {
    if (!res.headersSent) error(res, '附件文件读取失败', 5001, 500);
    else res.destroy();
  });
  stream.pipe(res);
  return stream;
}

async function resolve(req, res) {
  setPrivateHeaders(res);
  if (!mongoose.isValidObjectId(req.params.id)) {
    error(res, '附件不存在', 4041, 404);
    return null;
  }
  const attachment = await ConversationAttachment.findById(req.params.id);
  if (!attachment) {
    error(res, '附件不存在', 4041, 404);
    return null;
  }
  if (!await canAccessAttachment(req, attachment)) {
    error(res, '无权访问附件', 4031, 403);
    return null;
  }
  const expired = attachment.expiresAt && attachment.expiresAt <= new Date();
  if (attachment.status !== 'active' || expired) {
    error(res, '附件已失效', 4101, 410);
    return null;
  }
  const message = await Message.findOne({ _id: attachment.messageId, tenantId: attachment.tenantId });
  const hidden = message && ((req.customer && message.deletedForCustomerAt) || (req.user && message.deletedForAgentAt));
  if (!message || message.recalledAt || hidden) {
    error(res, '附件已失效', 4101, 410);
    return null;
  }
  if (String(message.attachmentId) !== String(attachment._id) || message.attachmentStatus !== 'active') {
    error(res, '附件已失效', 4101, 410);
    return null;
  }
  return attachment;
}

async function sendFile(req, res, thumbnail) {
  const attachment = await resolve(req, res);
  if (!attachment) return;
  const storageKey = thumbnail
    ? (attachment.thumbnailStorageKey || (attachment.category === 'image' ? attachment.storageKey : ''))
    : attachment.storageKey;
  if (!storageKey) return error(res, '缩略图不存在', 4041, 404);
  let filePath;
  let stat;
  try {
    filePath = absoluteStoragePath(storageKey);
    stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return error(res, '附件已失效', 4101, 410);
  } catch (_) {
    return error(res, '附件已失效', 4101, 410);
  }
  const mime = thumbnail && attachment.thumbnailStorageKey ? 'image/jpeg' : (attachment.mimeType || 'application/octet-stream');
  res.set({
    'Content-Type': mime,
    'Content-Disposition': disposition(thumbnail ? 'thumbnail.jpg' : attachment.originalName),
  });
  if (!thumbnail) res.set('Accept-Ranges', 'bytes');
  const range = !thumbnail ? req.headers.range : null;
  if (!range) {
    res.set('Content-Length', stat.size);
    return pipeFile(res, filePath);
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : stat.size - 1;
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
    }
    start = Math.max(stat.size - suffixLength, 0);
    end = stat.size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= stat.size) {
    return res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
  }
  end = Math.min(end, stat.size - 1);
  res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
  return pipeFile(res, filePath, { start, end });
}

// Cookie value never appears in URLs or JSON. Each preview has its own path.
async function issuePlayback(req, res) {
  const attachment = await resolve(req, res);
  if (!attachment) return;
  if (attachment.category !== 'video') return error(res, '仅视频支持播放授权', 4001, 400);
  const subject = req.admin || req.user || req.customer;
  if (subject.identity !== 'guest' && !subject.pv) return error(res, '请重新登录后播放', 4031, 403);
  const nonce = crypto.randomBytes(16).toString('hex');
  const url = '/api/files/' + attachment._id + '/playback/' + nonce;
  const expiresAt = Math.min(Date.now() + PLAYBACK_SECONDS * 1000, subject.exp * 1000 || Infinity);
  if (expiresAt <= Date.now()) return error(res, '登录已过期', 4012, 401);
  const identity = {};
  for (const key of ['type', 'id', 'accountId', 'tenantId', 'channelId', 'conversationId', 'identity', 'pv']) {
    if (subject[key] !== undefined) identity[key] = subject[key];
  }
  const credential = jwt.sign({ purpose: 'video', attachmentId: String(attachment._id), nonce, identity,
    exp: Math.floor(expiresAt / 1000) }, playbackKey, { algorithm: 'HS256', audience: 'attachment-playback' });
  // Same-origin browser Origin covers HTTPS termination without trusting forwarded headers.
  const secure = req.secure || (req.get('origin') === 'https://' + req.get('host'));
  res.cookie('ym_video', credential, { httpOnly: true, sameSite: 'strict', secure,
    path: url, maxAge: expiresAt - Date.now() });
  return ok(res, { url, expiresAt: Math.floor(expiresAt / 1000) * 1000 });
}

async function playback(req, res) {
  setPrivateHeaders(res);
  let payload;
  try {
    const cookies = String(req.headers.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith('ym_video='));
    if (cookies.length !== 1) throw new Error('cookie');
    payload = jwt.verify(decodeURIComponent(cookies[0].slice(9)), playbackKey, { algorithms: ['HS256'], audience: 'attachment-playback' });
    if (payload.purpose !== 'video' || payload.attachmentId !== req.params.id || payload.nonce !== req.params.nonce
      || !Number.isFinite(payload.exp) || !payload.identity
      || (payload.identity.identity !== 'guest' && !payload.identity.pv)) throw new Error('scope');
  } catch (_) { return error(res, '播放授权已失效，请重新打开视频', 4012, 401); }
  const authenticate = { admin: authAdmin, tenant_user: authTenantUser, customer: authCustomer }[payload.identity.type];
  if (!authenticate) return error(res, '播放授权无效', 4012, 401);
  return authenticate(req, res, () => {
    void (async () => {
    const attachment = await resolve(req, res);
    if (!attachment) return;
    if (attachment.category !== 'video') return error(res, '仅视频支持播放', 4031, 403);
    let filePath;
    try {
      filePath = absoluteStoragePath(attachment.storageKey);
      if (!(await fs.promises.stat(filePath)).isFile()) throw new Error('file');
    } catch (_) { return error(res, '附件已失效', 4101, 410); }
    res.set({ 'Content-Type': attachment.mimeType || 'application/octet-stream',
      'Content-Disposition': disposition(attachment.originalName), 'Accept-Ranges': 'bytes' });
    // Stop an already-open response at expiry as well as rejecting subsequent ranges.
    const timer = setTimeout(() => res.destroy(), Math.max(1, payload.exp * 1000 - Date.now()));
    res.once('close', () => clearTimeout(timer));
    res.sendFile(filePath, { cacheControl: false, lastModified: false, acceptRanges: true }, err => {
      clearTimeout(timer);
      if (!err) return;
      if (res.headersSent) return res.destroy();
      if (err.status === 416) return res.status(416).set(err.headers || {}).end();
      return error(res, '附件读取失败或已失效', 4101, 410);
    });
    })().catch(() => {
      if (res.headersSent) res.destroy();
      else error(res, '播放服务暂不可用', 5001, 500);
    });
  }, payload.identity);
}

module.exports = {
  issuePlayback,
  playback,
  original(req, res) { return sendFile(req, res, false); },
  thumbnail(req, res) { return sendFile(req, res, true); },
  async status(req, res) {
    const attachment = await resolve(req, res);
    if (!attachment) return;
    return ok(res, { attachmentId: attachment._id, status: attachment.status, expiresAt: attachment.expiresAt });
  },
};
