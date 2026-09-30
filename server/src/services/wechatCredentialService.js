// 忆梦云团队开发
const crypto = require('crypto');
function key() {
  const value = process.env.WECHAT_CREDENTIAL_KEY || '';
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('WECHAT_KEY_UNAVAILABLE');
  return Buffer.from(value, 'hex');
}
function seal(value, context) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(context));
  return { version: 1, iv: iv.toString('base64'), data: Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
function open(value, context) {
  if (value?.version !== 1) throw new Error('WECHAT_KEY_VERSION');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(value.iv, 'base64'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
}
function context(account, field) { return `${account.tenantId}:${account.appId}:${account.generation}:${field}`; }
function credential(account, field) { return open(account.credentialCipher[field], context(account, field)); }
function publicOrigin() {
  const url = new URL(process.env.WECHAT_PUBLIC_ORIGIN || 'invalid:');
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('WECHAT_ORIGIN_UNAVAILABLE');
  return url.origin;
}
// 独立检测使用 stable_token，不持久化返回 token、不记录微信原始错误/报文。
async function checkCredential(account, fetcher = fetch) {
  const response = await fetcher('https://api.weixin.qq.com/cgi-bin/stable_token', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credential', appid: account.appId, secret: credential(account, 'appSecret'), force_refresh: false }),
  });
  if (!response.ok) return 'upstream_unavailable';
  const data = await response.json();
  return typeof data.access_token === 'string' && data.access_token && Number(data.expires_in) > 0 ? 'passed' : 'credential_or_permission_failed';
}
module.exports = { seal, open, context, credential, publicOrigin, checkCredential };
