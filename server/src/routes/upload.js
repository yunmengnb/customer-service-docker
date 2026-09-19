// 忆梦云团队开发 - 文件上传
const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const multer = require('multer');
const { authAdmin, requireSuperAdmin, authTenantUser, authCustomer } = require('../middleware/auth');
const { ok, error } = require('../utils');
const { getSystemSettings } = require('../utils/systemSettings');
const ConversationAttachmentController = require('../controllers/ConversationAttachmentController');

const router = express.Router();
const UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'uploads');
const APP_PUBLIC_ORIGIN = 'https://user.ymfk.top';
const MIME_BY_EXTENSION = {
  jpg: ['image/jpeg'], jpeg: ['image/jpeg'], png: ['image/png'], gif: ['image/gif'], webp: ['image/webp'],
  pdf: ['application/pdf'], docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], zip: ['application/zip', 'application/x-zip-compressed'],
  txt: ['text/plain'], mp3: ['audio/mpeg'], wav: ['audio/wav', 'audio/x-wav'], ogg: ['audio/ogg'],
  mp4: ['video/mp4'], webm: ['video/webm'], mov: ['video/quicktime'],
};

function buildStorage(subDir) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const tenantId = req.tenantId || req.customer?.tenantId || req.admin?.id || 'public';
      const dir = path.join(UPLOAD_DIR, String(tenantId), subDir);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, Date.now() + '_' + Math.random().toString(36).slice(2, 10) + ext);
    },
  });
}

function removeFile(filePath) {
  fs.unlink(filePath, () => {});
}

function createVideoThumbnail(videoPath) {
  const parsed = path.parse(videoPath);
  const thumbnailPath = path.join(parsed.dir, `${parsed.name}.thumbnail.jpg`);
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.2', '-i', videoPath,
      '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '3', thumbnailPath,
    ], { windowsHide: true, timeout: 30000 }, (err) => {
      if (err) {
        removeFile(thumbnailPath);
        return reject(err);
      }
      resolve(thumbnailPath);
    });
  });
}

async function handleUpload(req, res, publicOrigin = '') {
  if (!req.file) return error(res, '未上传文件');
  const isImage = req.file.mimetype.startsWith('image/');
  const isVideo = req.file.mimetype.startsWith('video/');
  let thumbnailUrl = '';
  if (isVideo) {
    try {
      const thumbnailPath = await createVideoThumbnail(req.file.path);
      thumbnailUrl = publicOrigin + '/uploads/' + path.relative(UPLOAD_DIR, thumbnailPath).replace(/\\/g, '/');
    } catch (err) {
      removeFile(req.file.path);
      console.error('[Upload] 视频缩略图生成失败:', err.message);
      return error(res, '无法解析视频或生成缩略图失败', 4001, 400);
    }
  }
  const url = publicOrigin + '/uploads/' + path.relative(UPLOAD_DIR, req.file.path).replace(/\\/g, '/');
  return ok(res, {
    url, thumbnailUrl, name: req.file.originalname, size: req.file.size,
    mimetype: req.file.mimetype, isImage, isVideo,
  });
}

function configuredUpload(subDir) {
  return async (req, res) => {
    try {
      const settings = await getSystemSettings();
      const allowed = new Set(settings.upload.allowedTypes);
      const upload = multer({
        storage: buildStorage(subDir),
        limits: { fileSize: settings.upload.maxFileSizeMB * 1024 * 1024 },
        fileFilter: (uploadReq, file, cb) => {
          const ext = path.extname(file.originalname).toLowerCase().slice(1);
          const validMimes = MIME_BY_EXTENSION[ext] || [];
          if (allowed.has(ext) && validMimes.includes(file.mimetype.toLowerCase())) return cb(null, true);
          cb(new Error('不支持的文件类型'));
        },
      });
      upload.single('file')(req, res, (err) => {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return error(res, `文件大小不能超过 ${settings.upload.maxFileSizeMB}MB`, 4001, 400);
        }
        if (err instanceof multer.MulterError) return error(res, '文件错误：' + err.message, 4001, 400);
        if (err) return error(res, err.message, 4001, 400);
        return handleUpload(req, res);
      });
    } catch (err) {
      return error(res, '上传配置加载失败', 5001, 500);
    }
  };
}

async function handleApkUpload(req, res) {
  if (!req.file) return error(res, '未上传文件');
  try {
    const handle = await fs.promises.open(req.file.path, 'r');
    const signature = Buffer.alloc(4);
    try {
      await handle.read(signature, 0, 4, 0);
    } finally {
      await handle.close();
    }
    if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
      removeFile(req.file.path);
      return error(res, 'APK 文件内容无效', 4001, 400);
    }
    return handleUpload(req, res, APP_PUBLIC_ORIGIN);
  } catch (err) {
    removeFile(req.file.path);
    return error(res, 'APK 文件校验失败', 5001, 500);
  }
}

function apkUpload(subDir) {
  return (req, res) => {
    const upload = multer({
      storage: buildStorage(subDir),
      limits: { fileSize: 200 * 1024 * 1024 },
      defParamCharset: 'utf8',
      fileFilter: (uploadReq, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const mime = String(file.mimetype || '').toLowerCase();
        if (ext === '.apk' && ['application/vnd.android.package-archive', 'application/octet-stream'].includes(mime)) {
          return cb(null, true);
        }
        cb(new Error('仅支持 APK 安装包'));
      },
    });
    upload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return error(res, 'APK 大小不能超过 200MB', 4001, 400);
      }
      if (err instanceof multer.MulterError) return error(res, '文件错误：' + err.message, 4001, 400);
      if (err) return error(res, err.message, 4001, 400);
      return handleApkUpload(req, res);
    });
  };
}

router.post('/admin/app-apk', authAdmin, requireSuperAdmin, apkUpload('app/staff'));
router.post('/admin/customer-app-apk', authAdmin, requireSuperAdmin, apkUpload('app/customer'));
router.post('/tenant/conversation/:conversationId', authTenantUser, ConversationAttachmentController.uploadTenant);
router.post('/admin', authAdmin, configuredUpload('admin'));
router.post('/tenant', authTenantUser, configuredUpload('tenant'));
router.post('/client', authCustomer, configuredUpload('customer'));

module.exports = router;