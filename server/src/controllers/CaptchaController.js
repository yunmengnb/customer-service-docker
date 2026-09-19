// 忆梦云团队开发
const crypto = require('crypto');
const Geetest = require('geetest');
const { ok, error } = require('../utils');
const { getSystemSettings } = require('../utils/systemSettings');
const { saveCode } = require('../middleware/captcha');

class CaptchaController {
  async create(req, res) {
    const settings = await getSystemSettings();
    if (!settings.captcha.enabled) return ok(res, { enabled: false });
    if (settings.captcha.provider === 'geetest') {
      const geetestId = settings.captcha.geetestId;
      const geetestKey = settings.captcha.geetestKey;
      if (!geetestId || !geetestKey) return error(res, '极验验证码配置不完整', 5031, 503);
      const captcha = new Geetest({ geetest_id: geetestId, geetest_key: geetestKey, protocol: 'https://' });
      try {
        const result = await captcha.register();
        const payload = {
          gt: result.geetest_id || result.gt || geetestId,
          challenge: result.challenge,
          success: Number(result.success) === 1 ? 1 : 0,
          new_captcha: result.new_captcha !== false,
        };
        return ok(res, {
          enabled: true,
          provider: 'geetest',
          version: 3,
          ...payload,
          captchaId: payload.gt,
        });
      } catch (_) {
        return error(res, '极验验证码服务暂不可用', 5032, 503);
      }
    }

    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    const code = Array.from({ length: settings.captcha.imageLength }, () => chars[crypto.randomInt(chars.length)]).join('');
    const id = crypto.randomUUID();
    await saveCode(id, code, settings.captcha.expireSeconds);
    const noise = Array.from({ length: 6 }, () => `<line x1="${crypto.randomInt(120)}" y1="${crypto.randomInt(40)}" x2="${crypto.randomInt(120)}" y2="${crypto.randomInt(40)}" stroke="#94a3b8" opacity=".5"/>`).join('');
    const escaped = code.split('').map((c, i) => `<text x="${12 + i * (96 / code.length)}" y="29" transform="rotate(${crypto.randomInt(-12, 13)} ${12 + i * (96 / code.length)} 29)">${c}</text>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#f1f5f9"/>${noise}<g font-family="Arial" font-size="24" font-weight="700" fill="#1e293b">${escaped}</g></svg>`;
    return ok(res, { enabled: true, provider: 'image', captchaId: id, image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` });
  }
}

module.exports = new CaptchaController();
