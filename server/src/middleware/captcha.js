// 忆梦云团队开发
const crypto = require('crypto');
const Geetest = require('geetest');
const { getRedis } = require('../config/redis');
const { getSystemSettings } = require('../utils/systemSettings');
const { error } = require('../utils');

const memoryCodes = new Map();

function captchaKey(id) {
  return `captcha:${id}`;
}

async function saveCode(id, code, seconds) {
  const hash = crypto.createHash('sha256').update(code.toLowerCase()).digest('hex');
  const redis = getRedis();
  if (redis) return redis.set(captchaKey(id), hash, { EX: seconds });
  memoryCodes.set(id, { hash, expiresAt: Date.now() + seconds * 1000 });
}

async function consumeCode(id) {
  const redis = getRedis();
  if (redis) {
    const key = captchaKey(id);
    return redis.sendCommand([
      'EVAL',
      "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value",
      '1',
      key,
    ]);
  }
  const item = memoryCodes.get(id);
  memoryCodes.delete(id);
  return item && item.expiresAt > Date.now() ? item.hash : null;
}

async function verifyCaptcha(req, res, next) {
  const settings = await getSystemSettings();
  if (!settings.captcha.enabled) return next();
  if (settings.captcha.provider === 'geetest') {
    const geetestId = settings.captcha.geetestId;
    const geetestKey = settings.captcha.geetestKey;
    const challenge = String(req.body?.geetest_challenge || '');
    const validate = String(req.body?.geetest_validate || '');
    const seccode = String(req.body?.geetest_seccode || '');
    if (!geetestId || !geetestKey || !challenge || !validate || !seccode
      || challenge.length > 128 || validate.length > 512 || seccode.length > 512) {
      return error(res, '极验验证码参数不完整', 4004, 400);
    }
    const captcha = new Geetest({ geetest_id: geetestId, geetest_key: geetestKey, protocol: 'https://' });
    try {
      const passed = await captcha.validate({ challenge, validate, seccode });
      if (!passed) return error(res, '验证码校验失败', 4004, 400);
      return next();
    } catch (_) {
      return error(res, '验证码服务暂不可用', 5032, 503);
    }
  }
  const id = String(req.body?.captchaId || '');
  const value = String(req.body?.captchaCode || '').toLowerCase();
  const expected = id ? await consumeCode(id) : null;
  const actual = crypto.createHash('sha256').update(value).digest('hex');
  if (!expected || value.length === 0 || expected.length !== actual.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) {
    return error(res, '验证码错误或已过期', 4004, 400);
  }
  next();
}

module.exports = { saveCode, verifyCaptcha };
