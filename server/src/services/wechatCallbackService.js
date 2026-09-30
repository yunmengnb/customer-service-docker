// 忆梦云团队开发
const crypto = require('crypto');
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const Receipt = require('../models/WechatCallbackReceipt');
const Follower = require('../models/WechatFollower');
const Challenge = require('../models/WechatAuthChallenge');
const secrets = require('./wechatCredentialService');
const auth = require('./wechatAuthService');
const staff = require('./wechatStaffService');
const maintenance = require('./maintenanceService');
const { isPlatformEnabled } = require('./extensionPlatformService');
function parseXml(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > 65536 || /<!DOCTYPE|<!ENTITY|<\?/i.test(xml)) throw new Error('INVALID_XML');
  if (XMLValidator.validate(xml) !== true) throw new Error('INVALID_XML');
  const tags = xml.match(/<[^>]+>/g) || [];
  let depth = 0;
  if (tags.length > 128) throw new Error('INVALID_XML');
  for (const tag of tags) {
    if (tag.startsWith('</')) depth--;
    else if (!tag.startsWith('<!') && !tag.endsWith('/>')) depth++;
    if (depth > 3 || depth < 0) throw new Error('INVALID_XML');
  }
  const value = new XMLParser({ ignoreAttributes: false, processEntities: false, parseTagValue: false, trimValues: true }).parse(xml)?.xml;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(v => typeof v !== 'string')) throw new Error('INVALID_XML');
  return value;
}
function verifySignature({ token, timestamp, nonce, signature, encrypted }, now = Date.now()) {
  if (!/^\d{10}$/.test(String(timestamp)) || Math.abs(now / 1000 - Number(timestamp)) > 600 || typeof nonce !== 'string' || nonce.length < 1 || nonce.length > 128 || !/^[a-f0-9]{40}$/i.test(String(signature))) throw new Error('INVALID_SIGNATURE');
  const parts = [token, timestamp, nonce];
  if (encrypted !== undefined) parts.push(encrypted);
  const expected = crypto.createHash('sha1').update(parts.sort().join('')).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new Error('INVALID_SIGNATURE');
}
function decrypt(encrypted, aesKey, appId) {
  if (typeof encrypted !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted)) throw new Error('INVALID_CIPHER');
  const key = Buffer.from(`${aesKey}=`, 'base64');
  const bytes = Buffer.from(encrypted, 'base64');
  if (key.length !== 32 || bytes.length < 32 || bytes.length % 16) throw new Error('INVALID_CIPHER');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([decipher.update(bytes), decipher.final()]);
  const n = padded[padded.length - 1];
  if (n < 1 || n > 32 || !padded.subarray(-n).every(v => v === n)) throw new Error('INVALID_PADDING');
  const raw = padded.subarray(0, -n);
  if (raw.length < 20) throw new Error('INVALID_CIPHER');
  const length = raw.readUInt32BE(16);
  if (length > raw.length - 20 || raw.subarray(20 + length).toString('utf8') !== appId) throw new Error('INVALID_APPID');
  return new TextDecoder('utf-8', { fatal: true }).decode(raw.subarray(20, 20 + length));
}
function encryptReply(plain, token, aesKey, appId, timestamp = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomBytes(16).toString('hex')) {
  const key = Buffer.from(`${aesKey}=`, 'base64');
  if (key.length !== 32) throw new Error('INVALID_CIPHER');
  const message = Buffer.from(plain), length = Buffer.alloc(4); length.writeUInt32BE(message.length);
  const raw = Buffer.concat([crypto.randomBytes(16), length, message, Buffer.from(appId)]);
  const padding = 32 - raw.length % 32;
  const cipher = crypto.createCipheriv('aes-256-cbc', key, key.subarray(0, 16)); cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([raw, Buffer.alloc(padding, padding)])), cipher.final()]).toString('base64');
  const signature = crypto.createHash('sha1').update([token, timestamp, nonce, encrypted].sort().join('')).digest('hex');
  return `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt><MsgSignature><![CDATA[${signature}]]></MsgSignature><TimeStamp>${timestamp}</TimeStamp><Nonce><![CDATA[${nonce}]]></Nonce></xml>`;
}
function safeText(value) { return String(value).replace(/]]>/g, ']]]]><![CDATA[>'); }
function textReply(event, content) {
  return `<xml><ToUserName><![CDATA[${safeText(event.FromUserName)}]]></ToUserName><FromUserName><![CDATA[${safeText(event.ToUserName)}]]></FromUserName><CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${safeText(content)}]]></Content></xml>`;
}
async function persist(account, event) {
  if (!event.FromUserName || event.FromUserName.length > 128 || !/^\d{1,12}$/.test(event.CreateTime)) throw new Error('INVALID_EVENT');
  const type = event.MsgType === 'event' ? String(event.Event || '').toLowerCase() : 'ignored';
  const minimal = { openId: event.FromUserName, type, time: event.CreateTime, msgId: event.MsgID || event.MsgId || '', status: event.Status || '', key: event.EventKey || '' };
  const eventKey = crypto.createHash('sha256').update(JSON.stringify(minimal)).digest('hex');
  try {
    await Receipt.updateOne({ officialAccountId: account._id, eventKey }, { $setOnInsert: {
      tenantId: account.tenantId, officialAccountId: account._id, appId: account.appId, generation: account.generation,
      credentialVersion: account.credentialVersion, configVersion: account.configVersion,
      eventKey, eventType: type, eventAt: new Date(Number(event.CreateTime) * 1000), state: 'pending',
      payloadCipher: secrets.seal(JSON.stringify(minimal), `${account._id}:${eventKey}`),
    } }, { upsert: true });
  } catch (error) { if (error.code !== 11000) throw error; }
}
function sceneId(event) {
  if (!['subscribe', 'scan'].includes(event.type)) return '';
  const key = String(event.key || '').replace(/^qrscene_/, '');
  const match = /^wxauth_([a-f0-9]{24})$/.exec(key);
  return match?.[1] || '';
}
function accountContext(receipt) {
  return { _id: receipt.officialAccountId, tenantId: receipt.tenantId, appId: receipt.appId, generation: receipt.generation,
    credentialVersion: receipt.credentialVersion, configVersion: receipt.configVersion };
}
async function claimEvent(account, event) {
  const id = sceneId(event);
  if (!id) return '';
  const openIdHash = staff.openHash(account, event.openId || event.FromUserName);
  await auth.claimScan({ account, challengeId: id, scanOpenIdHash: openIdHash }, Challenge).catch(error => {
    if (error.message !== 'CHALLENGE_UNAVAILABLE') throw error;
  });
  return id;
}
// 幂等、可重放：先更新关注事实和扫码占用，再标记完成；宕机仍保留 pending。
async function processPending() {
  if (!await isPlatformEnabled('wechat_official')) return { skipped: true, reason: 'PLATFORM_DISABLED' };
  if (await maintenance.isFrozen()) return { skipped: true, reason: 'MIGRATION_WRITE_FROZEN' };
  await maintenance.markBusinessWriteAccepted();
  const finish = maintenance.beginWrite();
  try {
    if (await maintenance.isFrozen()) return { skipped: true, reason: 'MIGRATION_WRITE_FROZEN' };
    const receipts = await Receipt.find({ state: 'pending' }).select('+payloadCipher').sort({ createdAt: 1 }).limit(100);
  for (const receipt of receipts) {
    if (!await isPlatformEnabled('wechat_official', receipt.tenantId)) continue;
    const event = JSON.parse(secrets.open(receipt.payloadCipher, `${receipt.officialAccountId}:${receipt.eventKey}`));
    const account = accountContext(receipt);
    const openIdHash = staff.openHash(account, event.openId);
    const identity = { tenantId: receipt.tenantId, officialAccountId: receipt.officialAccountId, appId: receipt.appId,
      generation: receipt.generation, openIdHash };
    if (['subscribe', 'unsubscribe'].includes(event.type)) {
      const openIdCipher = secrets.seal(event.openId, secrets.context(account, `follower:${openIdHash}`));
      try {
        await Follower.findOneAndUpdate(identity, { $setOnInsert: { ...identity, openIdCipher } }, { upsert: true, new: true });
      } catch (error) { if (error.code !== 11000) throw error; }
      // 同秒冲突时取关优先；旧事件永不覆盖新事件。
      const eventOrder = { $or: [{ lastFollowEventAt: { $exists: false } }, { lastFollowEventAt: { [event.type === 'unsubscribe' ? '$lte' : '$lt']: receipt.eventAt } }] };
      const followState = event.type === 'subscribe' ? 'subscribed' : 'unsubscribed';
      await Follower.updateOne({ ...identity, $or: [{ lastEventAt: { $exists: false } }, { lastEventAt: { [event.type === 'unsubscribe' ? '$lte' : '$lt']: receipt.eventAt } }] },
        { $set: { subscribeStatus: followState, lastEventAt: receipt.eventAt } });
      await require('../models/WechatIdentityBinding').updateMany({ ...identity, ...eventOrder },
        { $set: { subscribeStatus: followState, lastFollowEventAt: receipt.eventAt } });
    }
    await claimEvent(account, event);
      await Receipt.updateOne({ _id: receipt._id, state: 'pending' }, { $set: { state: 'done', expiresAt: new Date(Date.now() + 90 * 86400000) } });
    }
    return { processed: receipts.length };
  } finally {
    finish();
  }
}
let timer;
let running = false;
function start() {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await processPending(); } catch (_) { console.error('[Wechat] callback processing deferred'); } finally { running = false; }
  };
  timer = setInterval(tick, 5000); timer.unref(); void tick();
}
async function stop({ timeoutMs = 30000 } = {}) {
  clearInterval(timer);
  timer = null;
  const deadline = Date.now() + timeoutMs;
  while (running && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (running) throw new Error('WECHAT_CALLBACK_DRAIN_TIMEOUT');
}
module.exports = { parseXml, verifySignature, decrypt, encryptReply, textReply, persist, claimEvent, processPending, sceneId, start, stop };
