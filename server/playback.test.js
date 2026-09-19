// 忆梦云团队开发 - real HTTP streams with database-only mocks
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const express = require('express');
const { signToken, passwordVersion, verifyToken } = require('./src/utils');
const config = require('./src/config');
const Attachment = require('./src/models/ConversationAttachment');
const Message = require('./src/models/Message');
const Conversation = require('./src/models/Conversation');
const User = require('./src/models/TenantUser');
const Tenant = require('./src/models/Tenant');
const Channel = require('./src/models/Channel');
const { UPLOAD_ROOT } = require('./src/services/conversationAttachmentService');
const id = '0123456789abcdef01234567';
const other = '1123456789abcdef01234567';
function request(server, url, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: url, method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject); req.end();
  });
}
test('real Express playback authorization and Range matrix', async t => {
  const dir = await fs.mkdtemp(path.join(UPLOAD_ROOT, 'playback-test-'));
  const file = path.join(dir, 'video.mp4');
  await fs.writeFile(file, Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz'));
  const attachment = { _id: id, tenantId: 'tenant', channelId: 'channel', conversationId: 'conv', messageId: 'message',
    category: 'video', status: 'active', mimeType: 'video/mp4', originalName: 'video.mp4',
    storageKey: path.relative(UPLOAD_ROOT, file).split(path.sep).join('/') };
  const message = { attachmentId: id, attachmentStatus: 'active' };
  const user = { tenantId: 'tenant', status: 'active', role: 'agent', password: 'test-password-hash' };
  let tenantStatus = 'active', channelAllowed = true;
  t.mock.method(Attachment, 'findById', async key => key === id ? attachment : { ...attachment, _id: other, tenantId: 'other' });
  t.mock.method(Message, 'findOne', async () => message);
  t.mock.method(Conversation, 'findOne', async () => ({ status: 'active', assignedAgentId: 'user' }));
  t.mock.method(User, 'findOne', async () => user);
  t.mock.method(Tenant, 'findById', async () => ({ status: tenantStatus }));
  t.mock.method(Channel, 'exists', async () => channelAllowed);
  const app = express(); app.use(express.json()); app.use('/api/files', require('./src/routes/files'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); });
  const token = signToken({ type: 'tenant_user', id: 'user', tenantId: 'tenant', pv: passwordVersion(user.password) });
  const base = '/api/files/' + id;
  const issued = await request(server, base + '/playback', 'POST', { Authorization: 'Bearer ' + token });
  assert.equal(issued.status, 200);
  const data = JSON.parse(issued.body).data;
  const cookie = issued.headers['set-cookie'][0].split(';')[0];
  const credential = decodeURIComponent(cookie.slice(9));
  const headers = { Cookie: cookie };
  assert.match(issued.headers['set-cookie'][0], /HttpOnly/);
  assert.match(issued.headers['set-cookie'][0], /SameSite=Strict/);
  assert.match(issued.headers['set-cookie'][0], new RegExp('Path=' + data.url));
  assert.equal(verifyToken(credential), null);
  assert.equal(issued.headers['referrer-policy'], 'no-referrer');
  assert.ok(!JSON.stringify(data).includes(credential));
  for (const [range, status, body, contentRange] of [
    [undefined, 200, '0123456789abcdefghijklmnopqrstuvwxyz', undefined],
    ['bytes=2-5', 206, '2345', 'bytes 2-5/36'],
    ['bytes=32-', 206, 'wxyz', 'bytes 32-35/36'],
    ['bytes=-4', 206, 'wxyz', 'bytes 32-35/36'],
    ['bytes=100-', 416, '', 'bytes */36'],
  ]) await t.test('GET ' + range, async () => {
    const res = await request(server, data.url, 'GET', { ...headers, ...(range ? { Range: range } : {}) });
    assert.equal(res.status, status); assert.equal(res.body.toString(), body);
    assert.equal(res.headers['content-range'], contentRange);
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.match(res.headers['cache-control'], /no-store/);
    if (status !== 416) assert.equal(Number(res.headers['content-length']), body.length);
  });
  await t.test('HEAD no body, including partial and unsatisfiable ranges', async () => {
    for (const [range, status, length] of [[undefined, 200, 36], ['bytes=2-5', 206, 4], ['bytes=100-', 416, 0]]) {
      const res = await request(server, data.url, 'HEAD', { ...headers, ...(range ? { Range: range } : {}) });
      assert.equal(res.status, status); assert.equal(res.body.length, 0);
      if (length) assert.equal(Number(res.headers['content-length']), length);
    }
  });
  await t.test('missing, cross attachment, cross preview, login JWT and ordinary auth isolation', async () => {
    assert.equal((await request(server, data.url)).status, 401);
    assert.equal((await request(server, data.url.replace(id, other), 'GET', headers)).status, 401);
    assert.equal((await request(server, data.url.replace(/[^/]+$/, 'a'.repeat(32)), 'GET', headers)).status, 401);
    assert.equal((await request(server, data.url, 'GET', { Cookie: 'ym_video=' + token })).status, 401);
    assert.equal((await request(server, base, 'GET', { Authorization: 'Bearer ' + credential })).status, 401);
    assert.equal((await request(server, '/api/files/' + other + '/playback', 'POST', { Authorization: 'Bearer ' + token })).status, 403);
  });
  await t.test('expired, wrong purpose and wrong audience signed credentials', async () => {
    const key = crypto.createHmac('sha256', config.jwt.secret).update('attachment-video-playback-v1').digest();
    const payload = jwt.decode(credential);
    for (const patch of [{ exp: Math.floor(Date.now() / 1000) - 1 }, { purpose: 'download' }, { aud: 'login' }]) {
      const bad = jwt.sign({ ...payload, ...patch }, key);
      assert.equal((await request(server, data.url, 'GET', { Cookie: 'ym_video=' + bad })).status, 401);
    }
  });
  for (const [name, mutate, restore, status] of [
    ['recalled', () => message.recalledAt = new Date(), () => delete message.recalledAt, 410],
    ['hidden', () => message.deletedForAgentAt = new Date(), () => delete message.deletedForAgentAt, 410],
    ['deleted', () => attachment.status = 'deleted', () => attachment.status = 'active', 410],
    ['expired attachment', () => attachment.expiresAt = new Date(0), () => delete attachment.expiresAt, 410],
    ['user disabled', () => user.status = 'disabled', () => user.status = 'active', 403],
    ['password changed', () => user.password = 'different-hash', () => user.password = 'test-password-hash', 401],
    ['tenant disabled', () => tenantStatus = 'disabled', () => tenantStatus = 'active', 403],
    ['channel access removed', () => channelAllowed = false, () => channelAllowed = true, 403],
  ]) await t.test(name + ' rechecked on GET and HEAD', async () => {
    mutate();
    for (const method of ['GET', 'HEAD']) assert.equal((await request(server, data.url, method, headers)).status, status);
    restore();
  });
  await t.test('physical file removed', async () => {
    await fs.unlink(file);
    assert.equal((await request(server, data.url, 'GET', headers)).status, 410);
  });
});
test('FFmpeg Fast Start moves moov before mdat, returns actual size and preserves failure input', async t => {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  try {
    await new Promise((resolve, reject) => require('node:child_process').execFile(ffmpeg, ['-version'], err => err ? reject(err) : resolve()));
  } catch (_) { t.skip('FFmpeg binary unavailable'); return; }
  const { promisify } = require('node:util');
  const exec = promisify(require('node:child_process').execFile);
  const { fastStart } = require('./src/controllers/ConversationAttachmentController');
  const dir = await fs.mkdtemp(path.join(UPLOAD_ROOT, 'faststart-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'original.mp4');
  await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file], { timeout: 30000 });
  assert.equal(await fastStart(file), true);
  const result = await fs.readFile(file);
  assert.ok(result.indexOf(Buffer.from('moov')) < result.indexOf(Buffer.from('mdat')));
  assert.equal((await fs.stat(file)).size, result.length);
  const before = await fs.readFile(file);
  assert.equal(await fastStart(file, 1), false);
  assert.deepEqual(await fs.readFile(file), before);
  await fs.writeFile(file, 'invalid mp4');
  assert.equal(await fastStart(file), false);
  assert.equal(await fs.readFile(file, 'utf8'), 'invalid mp4');
  assert.deepEqual(await fs.readdir(dir), ['original.mp4']);
});
