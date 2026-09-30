// 忆梦云团队开发
const SystemConfig = require('../models/SystemConfig');

const PROVIDERS = Object.freeze({
  jingpro: Object.freeze({
    provider: 'jingpro',
    key: 'jingpro.setting',
    defaultEnabled: true,
    name: 'JingPro 联动扩展',
    description: '提供企业账号联动、渠道绑定、快捷登录与客服配置同步能力。',
    version: '1.0.0',
    scope: '企业管理员配置，企业客服使用',
    deploymentChecks: ['serverBaseUrl', 'widgetBaseUrl'],
  }),
  wechat_official: Object.freeze({
    provider: 'wechat_official',
    key: 'wechat_official.setting',
    defaultEnabled: true,
    name: '微信公众号',
    description: '提供企业独立公众号配置、安全回调、微信身份绑定登录与模板通知能力。',
    version: '1.0.0',
    scope: '企业管理员配置，客服、客户与访客使用',
    deploymentChecks: ['publicOrigin', 'credentialKey', 'notificationLinkKey'],
  }),
});

function definition(provider) {
  const item = PROVIDERS[String(provider || '')];
  if (!item) throw Object.assign(new Error('EXTENSION_PROVIDER_INVALID'), { status: 404 });
  return item;
}

function normalizedTenantIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter(id => /^[a-f0-9]{24}$/i.test(id)))];
}

function deployment(provider, stored) {
  if (provider === 'jingpro') {
    return {
      serverBaseUrl: !!String(stored.serverBaseUrl || process.env.SERVER_BASE_URL || process.env.API_BASE_URL || ''),
      widgetBaseUrl: !!String(stored.widgetBaseUrl || process.env.WEB_BASE_URL || ''),
    };
  }
  return {
    publicOrigin: !!String(process.env.WECHAT_PUBLIC_ORIGIN || ''),
    credentialKey: !!String(process.env.WECHAT_CREDENTIAL_KEY || ''),
    notificationLinkKey: !!String(process.env.WECHAT_NOTIFICATION_LINK_KEY || ''),
  };
}

async function ensurePlatformExtensions() {
  return Object.values(PROVIDERS);
}

async function getPlatformExtension(provider) {
  const item = definition(provider);
  const value = await SystemConfig.get(item.key, {});
  const stored = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const scopeMode = stored.scopeMode === 'selected' ? 'selected' : 'all';
  const tenantIds = normalizedTenantIds(stored.tenantIds);
  const deploymentStatus = deployment(provider, stored);
  return {
    provider: item.provider,
    name: String(stored.name || item.name),
    description: String(stored.description || item.description),
    version: String(stored.version || item.version),
    scope: String(stored.scope || item.scope),
    defaultEnabled: item.defaultEnabled === true,
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : item.defaultEnabled === true,
    scopeMode,
    tenantIds,
    deploymentStatus,
    deploymentReady: Object.values(deploymentStatus).every(Boolean),
    ...(provider === 'jingpro' ? {
      serverBaseUrl: String(stored.serverBaseUrl || process.env.SERVER_BASE_URL || process.env.API_BASE_URL || ''),
      widgetBaseUrl: String(stored.widgetBaseUrl || process.env.WEB_BASE_URL || ''),
    } : {}),
  };
}

async function listPlatformExtensions() {
  return Promise.all(Object.keys(PROVIDERS).map(getPlatformExtension));
}

function tenantAllowed(setting, tenantId) {
  return setting.enabled === true && (setting.scopeMode !== 'selected' || setting.tenantIds.includes(String(tenantId || '')));
}

async function setPlatformControl(provider, { enabled, scopeMode, tenantIds, serverBaseUrl, widgetBaseUrl }) {
  const item = definition(provider);
  const current = await SystemConfig.get(item.key, {});
  const value = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const next = {
    ...value,
    enabled: enabled === true,
    scopeMode: scopeMode === 'selected' ? 'selected' : 'all',
    tenantIds: scopeMode === 'selected' ? normalizedTenantIds(tenantIds) : [],
  };
  if (provider === 'jingpro') {
    if (serverBaseUrl != null) next.serverBaseUrl = String(serverBaseUrl).trim().replace(/\/+$/, '');
    if (widgetBaseUrl != null) next.widgetBaseUrl = String(widgetBaseUrl).trim().replace(/\/+$/, '');
  }
  await SystemConfig.set(item.key, next, `${item.name}平台扩展设置`);
  return getPlatformExtension(provider);
}

async function setPlatformEnabled(provider, enabled) {
  const current = await getPlatformExtension(provider);
  return setPlatformControl(provider, { enabled, scopeMode: current.scopeMode, tenantIds: current.tenantIds });
}

async function isPlatformEnabled(provider, tenantId = null) {
  const setting = await getPlatformExtension(provider);
  return tenantId == null ? setting.enabled : tenantAllowed(setting, tenantId);
}

async function assertPlatformEnabled(provider, tenantId = null) {
  const setting = await getPlatformExtension(provider);
  if (!setting.enabled || (tenantId != null && !tenantAllowed(setting, tenantId))) {
    throw Object.assign(new Error(setting.enabled ? 'TENANT_NOT_AUTHORIZED' : 'PLATFORM_DISABLED'), {
      code: setting.enabled ? 'TENANT_NOT_AUTHORIZED' : 'PLATFORM_DISABLED',
      status: 403,
      publicMessage: setting.enabled ? '当前企业未获平台授权使用该扩展应用' : '平台已停用该扩展应用',
    });
  }
  return setting;
}

module.exports = {
  PROVIDERS,
  ensurePlatformExtensions,
  getPlatformExtension,
  listPlatformExtensions,
  setPlatformEnabled,
  setPlatformControl,
  tenantAllowed,
  isPlatformEnabled,
  assertPlatformEnabled,
};
