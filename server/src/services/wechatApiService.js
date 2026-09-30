// 忆梦云团队开发
const crypto = require('crypto');
const { getRedis } = require('../config/redis');
const secrets = require('./wechatCredentialService');

const RELEASE = "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";
const PUBLISH = "if redis.call('get',KEYS[1]) == ARGV[1] then redis.call('set',KEYS[2],ARGV[2],'PX',ARGV[3]); return 1 else return 0 end";
function cacheContext(account) {
  if (!account?.tenantId || !account?._id || !/^wx[a-fA-F0-9]{16}$/.test(account.appId)
      || !Number.isSafeInteger(account.generation) || account.generation < 1
      || !Number.isSafeInteger(account.credentialVersion) || account.credentialVersion < 1) {
    throw new Error('WECHAT_INVALID_CONTEXT');
  }
  return `${account.tenantId}:${account._id}:${account.appId}:${account.generation}:${account.credentialVersion}`;
}
async function jsonRequest(url, options, fetcher) {
  // Never accept arbitrary upstream URLs or follow redirects. Do not propagate fetch errors containing secrets.
  let response;
  try {
    response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch {
    throw new Error('WECHAT_UPSTREAM_UNAVAILABLE');
  }
}
async function getAccessToken(account, { redis = getRedis(), fetcher = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const context = cacheContext(account);
  if (!redis) throw new Error('WECHAT_TOKEN_CACHE_UNAVAILABLE');
  // Hash tag keeps both keys in the same Redis Cluster slot. Credentials never appear in keys.
  const slot = crypto.createHash('sha256').update(context).digest('hex');
  const tokenKey = `wechat:token:{${slot}}`, lockKey = `wechat:token-lock:{${slot}}`;
  const aad = `wechat-access-token:${context}`;
  const cached = async () => {
    const value = await redis.get(tokenKey);
    if (!value) return null;
    try { return secrets.open(JSON.parse(value), aad); }
    catch { throw new Error('WECHAT_TOKEN_CACHE_INVALID'); }
  };
  const previous = await cached();
  if (previous) return previous;
  const owner = crypto.randomBytes(32).toString('hex');
  const acquired = await redis.set(lockKey, owner, { NX: true, PX: 15000 });
  if (!acquired) {
    for (let i = 0; i < 20; i++) {
      await wait(100);
      const value = await cached();
      if (value) return value;
    }
    throw new Error('WECHAT_TOKEN_BUSY');
  }
  try {
    const value = await cached();
    if (value) return value;
    const data = await jsonRequest('https://api.weixin.qq.com/cgi-bin/stable_token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credential', appid: account.appId,
        secret: secrets.credential(account, 'appSecret'), force_refresh: false }),
    }, fetcher);
    const seconds = Number(data.expires_in);
    if (data.errcode || typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 4096
        || !Number.isFinite(seconds) || seconds <= 120) throw new Error('WECHAT_TOKEN_REJECTED');
    const ttl = Math.floor((Math.min(seconds, 7200) - 120) * 1000);
    const encrypted = JSON.stringify(secrets.seal(data.access_token, aad));
    // A slow/paused owner may not overwrite a newer owner's token after its lease expires.
    const published = await redis.eval(PUBLISH, { keys: [lockKey, tokenKey], arguments: [owner, encrypted, String(ttl)] });
    if (Number(published) !== 1) throw new Error('WECHAT_TOKEN_LEASE_LOST');
    return data.access_token;
  } finally {
    await redis.eval(RELEASE, { keys: [lockKey], arguments: [owner] }).catch(() => {});
  }
}
async function createTemporaryQr(account, scene, { fetcher = fetch, redis = getRedis() } = {}) {
  if (typeof scene !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(scene)) throw new Error('WECHAT_QR_SCENE_INVALID');
  const token = await getAccessToken(account, { redis, fetcher });
  const data = await jsonRequest(`https://api.weixin.qq.com/cgi-bin/qrcode/create?access_token=${encodeURIComponent(token)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expire_seconds: 120, action_name: 'QR_STR_SCENE', action_info: { scene: { scene_str: scene } } }),
  }, fetcher);
  if (data.errcode || typeof data.ticket !== 'string' || !data.ticket || data.ticket.length > 512) throw new Error('WECHAT_QR_REJECTED');
  const seconds = Math.min(120, Math.max(1, Number(data.expire_seconds) || 120));
  return { ticket: data.ticket, url: `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(data.ticket)}`, expiresIn: seconds };
}
async function sendTemplateMessage(account, payload, { fetcher = fetch, redis = getRedis() } = {}) {
  cacheContext(account);
  if (!payload || !/^[\w-]{1,128}$/.test(payload.toUser || '')
      || !/^[\w-]{1,128}$/.test(payload.templateId || '')
      || !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    throw new Error('WECHAT_SEND_INVALID');
  }
  let landing;
  try {
    landing = new URL(payload.url);
    if (landing.origin !== secrets.publicOrigin() || landing.protocol !== 'https:' || landing.username || landing.password
        || !/^\/api\/wechat\/notification\/open\/[a-f0-9]{64}$/.test(landing.pathname) || landing.search || landing.hash) throw new Error();
  } catch {
    throw new Error('WECHAT_SEND_INVALID');
  }
  const token = await getAccessToken(account, { redis, fetcher });
  let response;
  try {
    response = await fetcher(`https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=${encodeURIComponent(token)}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ touser: payload.toUser, template_id: payload.templateId, url: landing.toString(), data: payload.data }),
    });
  } catch {
    // 请求可能已到达微信但响应丢失，禁止自动重发造成重复通知。
    throw new Error('WECHAT_SEND_UNKNOWN');
  }
  if (!response.ok) throw new Error(response.status >= 500 ? 'WECHAT_UPSTREAM_UNAVAILABLE' : 'WECHAT_SEND_REJECTED');
  let data;
  try { data = await response.json(); } catch { throw new Error('WECHAT_SEND_UNKNOWN'); }
  if (Number(data.errcode) !== 0 || !data.msgid) throw new Error('WECHAT_SEND_REJECTED');
  return { messageId: String(data.msgid).slice(0, 80) };
}

async function exchangeOAuthCode(account, code, { fetcher = fetch } = {}) {
  cacheContext(account);
  if (typeof code !== 'string' || !/^[\w-]{1,512}$/.test(code)) throw new Error('WECHAT_OAUTH_CODE_INVALID');
  const url = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
  url.search = new URLSearchParams({ appid: account.appId, secret: secrets.credential(account, 'appSecret'), code, grant_type: 'authorization_code' }).toString();
  const data = await jsonRequest(url.toString(), { method: 'GET' }, fetcher);
  if (data.errcode || (data.appid !== undefined && data.appid !== account.appId)
      || typeof data.openid !== 'string' || !/^[\w-]{1,128}$/.test(data.openid)
      || typeof data.access_token !== 'string' || !data.access_token) throw new Error('WECHAT_OAUTH_REJECTED');
  // OAuth tokens and unionid are deliberately discarded; OpenID belongs only to this account context.
  return { openId: data.openid };
}
module.exports = { getAccessToken, createTemporaryQr, sendTemplateMessage, exchangeOAuthCode, cacheContext };
