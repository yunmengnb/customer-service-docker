// 忆梦云团队开发
const Account = require('../models/WechatOfficialAccount');
const Binding = require('../models/WechatIdentityBinding');
const Tenant = require('../models/Tenant');
const User = require('../models/TenantUser');
const { digest } = require('./wechatAuthService');
const { assertPlatformEnabled } = require('./extensionPlatformService');
function scope(a) { return { tenantId: a.tenantId, officialAccountId: a._id, appId: a.appId, generation: a.generation }; }
async function current(filter, purpose) {
  if (!filter?.tenantId) throw new Error('UNAVAILABLE');
  await assertPlatformEnabled('wechat_official', filter.tenantId);
  const a = await Account.findOne({ ...filter, isCurrent: true, enabled: true, [purpose === 'bind' ? 'bindingEnabled' : 'loginEnabled']: true }).select('+credentialCipher');
  if (!a || !await Tenant.exists({ _id: a.tenantId, status: { $in: ['active', 'trial'] } })) throw new Error('UNAVAILABLE');
  return a;
}
async function activeBinding(id, userId, tenantId) {
  const b = await Binding.findOne({ _id: id, subjectId: userId, tenantId, subjectType: 'staff', status: 'active' });
  if (!b) return null;
  try {
    const a = await current({ _id: b.officialAccountId, tenantId, appId: b.appId, generation: b.generation }, 'login');
    if (!a || !await User.exists({ _id: userId, tenantId, status: 'active' })) return null;
    b.currentConfigVersion = a.configVersion;
    return b;
  } catch { return null; }
}
function openHash(a, openId) { return digest(`${a.tenantId}:${a._id}:${a.appId}:${a.generation}:${openId}`); }
module.exports = { scope, current, activeBinding, openHash };
