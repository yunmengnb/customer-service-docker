// 忆梦云团队开发
const SystemSetting = require('../models/SystemSetting');
const Announcement = require('../models/Announcement');
const { ok, error } = require('../utils');
const {
  clearSystemSettingsCache,
  publicSettings,
  publicWebsiteSettings,
  getSystemSettings,
} = require('../utils/systemSettings');
const { sendMail } = require('../utils/mailer');

const ALLOWED_TYPES = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'docx', 'xlsx', 'zip', 'txt', 'mp3', 'wav', 'ogg', 'mp4', 'webm', 'mov']);

function normalizeDomain(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch (_) {
    return null;
  }
}

class SystemSettingController {
  async get(req, res) {
    const setting = await SystemSetting.getSingleton();
    return ok(res, publicSettings(setting));
  }

  async getPublic(req, res) {
    const setting = await getSystemSettings();
    return ok(res, publicWebsiteSettings(setting));
  }

  async update(req, res) {
    const setting = await SystemSetting.getSingleton();
    const body = req.body || {};
    if (typeof body.registerEnabled === 'boolean') setting.registerEnabled = body.registerEnabled;
    for (const key of [
      'tenantRegisterEnabled',
      'customerRegisterEnabled',
      'tenantLoginEnabled',
      'customerLoginEnabled',
      'tenantRegisterEmailVerificationEnabled',
      'customerRegisterEmailVerificationEnabled',
    ]) {
      if (typeof body[key] === 'boolean') setting[key] = body[key];
    }
    if (typeof body.loginEnabled === 'boolean') setting.loginEnabled = body.loginEnabled;
    if (typeof body.customerServiceClientDownloadPromptEnabled === 'boolean') {
      setting.customerServiceClientDownloadPromptEnabled = body.customerServiceClientDownloadPromptEnabled;
    }
    if (body.customerServiceDomain !== undefined) {
      const domain = normalizeDomain(body.customerServiceDomain);
      if (domain === null) return error(res, '客服专属域名格式不正确，请仅填写域名和协议');
      setting.customerServiceDomain = domain;
    }
    for (const key of ['siteTitle', 'siteKeywords', 'siteDescription']) {
      if (body[key] !== undefined) setting[key] = String(body[key]).trim();
    }
    if (!setting.siteTitle) return error(res, '网站标题不能为空');
    if (body.forbiddenWords !== undefined) {
      if (!Array.isArray(body.forbiddenWords)) return error(res, '违禁词必须为数组');
      const seen = new Set();
      setting.forbiddenWords = body.forbiddenWords
        .map(value => String(value).trim())
        .filter(word => {
          const normalized = word.toLowerCase();
          if (!normalized || seen.has(normalized)) return false;
          seen.add(normalized);
          return true;
        });
    }

    if (body.agreements) {
      for (const key of ['disclaimer', 'terms']) {
        if (body.agreements[key] !== undefined) {
          const value = String(body.agreements[key] || '');
          if (value.length > 20000) return error(res, '协议内容过长');
          setting.agreements[key] = value;
        }
      }
    }

    if (body.upload) {
      if (body.upload.allowedTypes !== undefined) {
        if (!Array.isArray(body.upload.allowedTypes)) return error(res, '上传类型必须为数组');
        const types = [...new Set(body.upload.allowedTypes.map(v => String(v).trim().toLowerCase().replace(/^\./, '')).filter(Boolean))];
        if (!types.length || types.some(type => !ALLOWED_TYPES.has(type))) return error(res, '包含不支持的上传类型');
        setting.upload.allowedTypes = types;
      }
      if (body.upload.maxFileSizeMB !== undefined) setting.upload.maxFileSizeMB = Number(body.upload.maxFileSizeMB);
    }

    if (body.storage) {
      const retentionDays = Number(body.storage.conversationAttachmentRetentionDays);
      const pendingHours = Number(body.storage.pendingAttachmentHours);
      const batchSize = Number(body.storage.cleanupBatchSize);
      if (body.storage.conversationAttachmentRetentionDays !== undefined) {
        if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) return error(res, '会话附件有效期必须为1到365天的整数');
        setting.storage.conversationAttachmentRetentionDays = retentionDays;
      }
      if (body.storage.pendingAttachmentHours !== undefined) {
        if (!Number.isInteger(pendingHours) || pendingHours < 1 || pendingHours > 168) return error(res, '待绑定附件保留时间必须为1到168小时的整数');
        setting.storage.pendingAttachmentHours = pendingHours;
      }
      if (body.storage.cleanupBatchSize !== undefined) {
        if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) return error(res, '清理批次必须为1到100的整数');
        setting.storage.cleanupBatchSize = batchSize;
      }
    }

    if (body.captcha) {
      for (const key of ['enabled', 'provider', 'imageLength', 'expireSeconds', 'geetestId']) {
        if (body.captcha[key] !== undefined) setting.captcha[key] = body.captcha[key];
      }
      if (body.captcha.geetestKey) setting.captcha.geetestKey = body.captcha.geetestKey;
    }

    if (body.smtp) {
      for (const key of ['enabled', 'host', 'port', 'secure', 'username', 'fromName', 'fromEmail']) {
        if (body.smtp[key] !== undefined) setting.smtp[key] = body.smtp[key];
      }
      if (body.smtp.password) setting.smtp.password = body.smtp.password;
    }

    try {
      await setting.save();
    } catch (err) {
      if (err.name === 'ValidationError') return error(res, Object.values(err.errors)[0].message);
      throw err;
    }

    if (body.forbiddenWords !== undefined) {
      const now = new Date();
      const content = setting.forbiddenWords.length
        ? `当前客服违禁词列表：\n${setting.forbiddenWords.map((word, index) => `${index + 1}. ${word}`).join('\n')}`
        : '当前客服违禁词列表为空。';
      await Announcement.findOneAndUpdate(
        { key: 'customer-service-forbidden-words' },
        {
          $set: {
            title: '客服违禁词公告',
            content,
            audience: 'tenant',
            status: 'published',
            publishedAt: now,
          },
          $setOnInsert: { key: 'customer-service-forbidden-words' },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
    }

    clearSystemSettingsCache();
    return ok(res, publicSettings(setting), '系统设置已更新');
  }

  async testEmail(req, res) {
    const to = String(req.body?.to || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(to)) return error(res, '收件邮箱格式不正确');
    try {
      const sent = await sendMail({ to, subject: '平台 SMTP 测试邮件', text: 'SMTP 配置可正常发送邮件。' });
      if (!sent) return error(res, 'SMTP 未启用或配置不完整');
      return ok(res, null, '测试邮件已发送');
    } catch (_) {
      return error(res, '邮件发送失败，请检查 SMTP 配置', 5001, 500);
    }
  }
}

module.exports = new SystemSettingController();
