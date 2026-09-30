// 忆梦云团队开发
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const config = require('../config');
const MigrationNonce = require('../models/MigrationNonce');
const PROTOCOL_VERSION = 1;
const WINDOW_MS = 60 * 1000;
function hmac(value) { return crypto.createHmac('sha256', config.jwt.secret).update(String(value)).digest('hex'); }
function equal(a, b) { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function bodyHash(raw) { return crypto.createHash('sha256').update(raw || '').digest('hex'); }
function canonical(method, path, timestamp, nonce, hash) { return [method.toUpperCase(), path, timestamp, nonce, hash].join('\n'); }
function sign(secret, method, path, timestamp, nonce, hash) { return crypto.createHmac('sha256', secret).update(canonical(method, path, timestamp, nonce, hash)).digest('hex'); }
function isPublicIp(ip) {
  if (!net.isIP(ip)) return false;
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    return !(p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] === 169 && p[1] === 254 || p[0] === 172 && p[1] >= 16 && p[1] <= 31 || p[0] === 192 && p[1] === 168 || p[0] >= 224 || ip === '100.100.100.200');
  }
  const normalized = ip.toLowerCase();
  return !(normalized === '::' || normalized === '::1' || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('ff'));
}
async function validateTarget(rawUrl, pinnedIp, resolver = dns.lookup) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('TARGET_URL_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw new Error('TARGET_URL_UNSAFE');
  if (!net.isIP(pinnedIp) || !isPublicIp(pinnedIp)) throw new Error('TARGET_IP_UNSAFE');
  url.pathname = '/';
  url.search = '';
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const records = await resolver(hostname, { all: true, verbatim: true });
  const addresses = records.map(row => row.address);
  if (!addresses.length || addresses.some(ip => !isPublicIp(ip)) || !addresses.includes(pinnedIp)) throw new Error('TARGET_DNS_PIN_MISMATCH');
  return { url, addresses };
}
function requestHeaders(secret, taskId, method, path, rawBody = '', precomputedHash = '') {
  const timestamp = String(Date.now()); const nonce = crypto.randomBytes(18).toString('base64url'); const hash = precomputedHash || bodyHash(rawBody);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('MIGRATION_BODY_HASH_INVALID');
  return { 'x-migration-task': taskId, 'x-migration-timestamp': timestamp, 'x-migration-nonce': nonce, 'x-migration-body-sha256': hash, 'x-migration-signature': sign(secret, method, path, timestamp, nonce, hash) };
}
function verifyRequestHeaders(req, secret) {
  const timestamp = String(req.headers['x-migration-timestamp'] || '');
  const nonce = String(req.headers['x-migration-nonce'] || '');
  const suppliedHash = String(req.headers['x-migration-body-sha256'] || '');
  const signature = String(req.headers['x-migration-signature'] || '');
  const taskId = String(req.headers['x-migration-task'] || '');
  const path = String(req.originalUrl || req.url).split('?')[0];
  if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > WINDOW_MS || !/^[A-Za-z0-9_-]{20,80}$/.test(nonce)) throw new Error('MIGRATION_SIGNATURE_EXPIRED');
  if (!/^[a-f0-9]{64}$/.test(suppliedHash) || !/^[a-f0-9]{64}$/.test(signature) || !equal(signature, sign(secret, req.method, path, timestamp, nonce, suppliedHash))) throw new Error('MIGRATION_SIGNATURE_INVALID');
  return { taskId, timestamp, nonce, suppliedHash };
}
async function assertRequestFresh(verified) {
  if (await MigrationNonce.exists({ taskId: verified.taskId, nonce: verified.nonce })) throw new Error('MIGRATION_REPLAY');
}
async function commitRequest(req, verified, actualHash = req.streamBodyHash || bodyHash(req.rawBody || '')) {
  if (!/^[a-f0-9]{64}$/.test(actualHash) || !equal(verified.suppliedHash, actualHash)) throw new Error('MIGRATION_SIGNATURE_INVALID');
  try { await MigrationNonce.create({ taskId: verified.taskId, nonce: verified.nonce, expiresAt: new Date(Date.now() + WINDOW_MS * 2) }); } catch (e) { if (e?.code === 11000) throw new Error('MIGRATION_REPLAY'); throw e; }
}
async function verifyRequest(req, secret) {
  const verified = verifyRequestHeaders(req, secret);
  await commitRequest(req, verified);
}
function deriveSessionSecret(key, sourceId, targetId, nonce) { return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(key), Buffer.from(nonce), Buffer.from(`migration:${sourceId}:${targetId}`), 32)).toString('base64url'); }
module.exports = { PROTOCOL_VERSION, hmac, equal, bodyHash, sign, isPublicIp, validateTarget, requestHeaders, verifyRequestHeaders, assertRequestFresh, commitRequest, verifyRequest, deriveSessionSecret };
