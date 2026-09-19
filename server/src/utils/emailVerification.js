// 忆梦云团队开发
const crypto = require('crypto');
const config = require('../config');
const cache = require('./cache');
const { sendMail } = require('./mailer');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function codeKey(scope, email) {
  const digest = crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex');
  return `email-code:${scope}:${digest}`;
}

function codeHash(scope, email, code) {
  return crypto.createHmac('sha256', config.jwt.secret)
    .update(`${scope}:${normalizeEmail(email)}:${code}`)
    .digest('hex');
}

async function sendEmailCode({ scope, email, subject, action }) {
  const normalized = normalizeEmail(email);
  const key = codeKey(scope, normalized);
  const existing = await cache.getJson(key);
  if (existing?.sentAt && Date.now() - existing.sentAt < 60000) {
    return { ok: false, status: 429, code: 4290, message: '验证码发送过于频繁，请稍后再试' };
  }

  const code = String(crypto.randomInt(100000, 1000000));
  try {
    const sent = await sendMail({
      to: normalized,
      subject,
      text: `您的${action}验证码是 ${code}，10分钟内有效。如非本人操作，请忽略本邮件。`,
    });
    if (!sent) return { ok: false, status: 503, code: 5031, message: '邮箱服务暂不可用' };
    await cache.setJson(key, { codeHash: codeHash(scope, normalized, code), sentAt: Date.now() }, 600);
    return { ok: true };
  } catch (_) {
    return { ok: false, status: 500, code: 5001, message: '验证码发送失败，请稍后重试' };
  }
}

async function verifyEmailCode({ scope, email, code, consume = true }) {
  const normalized = normalizeEmail(email);
  const key = codeKey(scope, normalized);
  const verification = await cache.getJson(key);
  const submittedHash = codeHash(scope, normalized, String(code || ''));
  const valid = Boolean(
    verification?.codeHash
    && verification.codeHash.length === submittedHash.length
    && crypto.timingSafeEqual(Buffer.from(verification.codeHash), Buffer.from(submittedHash))
  );
  if (valid && consume) return cache.consumeMatchingJson(key, submittedHash);
  return valid;
}

module.exports = { normalizeEmail, sendEmailCode, verifyEmailCode };
