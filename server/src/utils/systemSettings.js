// 忆梦云团队开发
const SystemSetting = require('../models/SystemSetting');
const agreementDefaults = require('./agreementDefaults');

let cached = null;
let expiresAt = 0;

async function getSystemSettings() {
  if (cached && expiresAt > Date.now()) return cached;
  cached = await SystemSetting.getSingleton();
  expiresAt = Date.now() + 5000;
  return cached;
}

function clearSystemSettingsCache() {
  cached = null;
  expiresAt = 0;
}

function publicSettings(setting) {
  const data = setting.toObject ? setting.toObject() : { ...setting };
  if (data.captcha) {
    data.captcha.geetestKeyConfigured = Boolean(data.captcha.geetestKey);
    delete data.captcha.geetestKey;
  }
  if (data.smtp) {
    data.smtp.passwordConfigured = Boolean(data.smtp.password);
    delete data.smtp.password;
  }
  delete data.singletonKey;
  return data;
}

function publicWebsiteSettings(setting) {
  return {
    siteTitle: setting.siteTitle || '忆梦云客服',
    siteKeywords: setting.siteKeywords || '',
    siteDescription: setting.siteDescription || '',
    registerEnabled: setting.registerEnabled !== false,
    tenantRegisterEmailVerificationEnabled: Boolean(setting.tenantRegisterEmailVerificationEnabled),
    agreements: {
      disclaimer: setting.agreements?.disclaimer || '',
      terms: setting.agreements?.terms || '',
    },
  };
}

function buildCustomerServiceLink(setting, publicToken) {
  const path = `/c/${publicToken}`;
  return setting.customerServiceDomain ? `${setting.customerServiceDomain}${path}` : path;
}

// 存量数据补齐：协议内容为空时写入默认协议，不覆盖管理员已配置的内容
async function ensureDefaultAgreements() {
  const setting = await SystemSetting.getSingleton();
  if (!setting.agreements) setting.agreements = {};
  let changed = false;
  for (const key of ['disclaimer', 'terms']) {
    if (!String(setting.agreements[key] || '').trim()) {
      setting.agreements[key] = agreementDefaults[key];
      changed = true;
    }
  }
  if (!changed) return false;
  await setting.save();
  clearSystemSettingsCache();
  return true;
}

module.exports = {
  getSystemSettings,
  clearSystemSettingsCache,
  ensureDefaultAgreements,
  publicSettings,
  publicWebsiteSettings,
  buildCustomerServiceLink,
};
