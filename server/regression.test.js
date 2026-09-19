// 忆梦云团队开发
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

function reportDebugEvent(hypothesisId, location, msg, data = {}) {}

assert.equal(reportDebugEvent('test', 'regression.test.js', 'fixture no-op', { phase: 'fixture' }), undefined, 'debug reporter fixture remains behavior-neutral');

test('multipart upload parsers preserve UTF-8 file names', async () => {
  const sources = [
    'src/controllers/ConversationAttachmentController.js',
    'src/routes/upload.js',
    'src/routes/complaintUpload.js',
  ].map(file => fs.readFileSync(path.join(__dirname, file), 'utf8'));
  for (const source of sources) assert.match(source, /defParamCharset:\s*'utf8'/);

  const multer = require('multer');
  const express = require('express');
  const app = express();
  app.post('/upload', (req, res) => multer({ storage: multer.memoryStorage(), defParamCharset: 'utf8' }).single('file')(req, res, error => {
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ name: req.file?.originalname });
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const form = new FormData();
    form.append('file', new Blob(['content'], { type: 'text/plain' }), '中文 文件.txt');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/upload`, { method: 'POST', body: form });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { name: '中文 文件.txt' });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

for (const device of ['desktop', 'mobile']) test(device + ' merge preserves timestamp order with ID tie breaker', () => {
  const source = fs.readFileSync(path.join(__dirname, '../user-web/src/views', device, 'ChatPanel.vue'), 'utf8');
  const props = { conversationId: 'conversation-1' };
  const context = vm.createContext({ messages: { value: [] }, props, persistMessages() {}, URL: { revokeObjectURL() {} } });
  const start = source.indexOf('function mergeMessage(');
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  for (const message of [{ _id: '01', createdAt: 3000 }, { _id: '03', createdAt: 1000 }, { _id: '02', createdAt: 1000 }]) context.mergeMessage({ ...message, conversationId: props.conversationId });
  assert.equal(context.messages.value.map(m => m._id).join(','), '02,03,01');
});

test('attachment action modules sanitize names, isolate download records and report progress', async () => {
  for (const project of ['client-web', 'user-web']) {
    const actions = await import(pathToFileURL(path.join(__dirname, `../${project}/src/attachmentActions.js`)).href);
    const values = new Map();
    const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
    const keyA = actions.downloadRecordKey('staff:tenant:user:all', 'attachment/1');
    const keyB = actions.downloadRecordKey('client:identity:channel', 'attachment/1');
    assert.notEqual(keyA, keyB, `${project} scopes must remain isolated`);
    assert.equal(actions.safeFileName('../bad:name?.pdf'), '_bad_name_.pdf');
    assert.equal(actions.markAttachmentDownloaded(storage, 'staff:tenant:user:all', 'attachment/1', 123), true);
    assert.equal(actions.wasAttachmentDownloaded(storage, 'staff:tenant:user:all', 'attachment/1'), true);
    assert.equal(actions.wasAttachmentDownloaded(storage, 'client:identity:channel', 'attachment/1'), false);
    assert.equal(values.get(keyA), '{"downloadedAt":123}');
    const progress = actions.downloadProgressState({ loaded: 5, total: 8 });
    assert.equal(progress.status, 'downloading');
    assert.equal(progress.loaded, 5);
    assert.equal(progress.total, 8);
    assert.equal(progress.percent, 63);
    if (project === 'client-web') {
      assert.equal(progress.computable, true);
      assert.deepEqual(actions.downloadProgressState({ loaded: 1024, total: 0 }), { status: 'downloading', loaded: 1024, total: 0, computable: false, percent: null });
    }
    assert.equal(actions.formatBytes(1536), '1.5 KB');
    assert.match(actions.createClientMessageId('upload'), /^upload_.+/);
  }
});

test('attachment native bridge detection, saved state and open routing stay compatible', async () => {
  for (const project of ['client-web', 'user-web']) {
    const actions = await import(pathToFileURL(path.join(__dirname, `../${project}/src/attachmentActions.js`)).href);
    const calls = [];
    const bridge = {
      getSavedAttachmentState: id => JSON.stringify({ status: id === 'a'.repeat(24) ? 'saved' : 'missing' }),
      saveAttachment() {},
      openSavedAttachment: id => { calls.push(id); return JSON.stringify({ status: 'opened' }); },
    };
    assert.equal(actions.getNativeAttachmentBridge({ YiMengAndroid: bridge }), bridge);
    assert.equal(actions.getNativeAttachmentBridge({ YiMengAndroid: { saveAttachment() {} } }), null);
    assert.equal(actions.getNativeAttachmentState(bridge, 'identity-scope', 'a'.repeat(24)).status, 'saved');
    assert.equal(actions.openNativeAttachment(bridge, 'identity-scope', 'a'.repeat(24)).status, 'opened');
    assert.deepEqual(calls, ['a'.repeat(24)]);
  }
  const mobile = fs.readFileSync(path.join(__dirname, '../user-web/src/views/mobile/ChatPanel.vue'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '../client-web/src/views/ChatPage.vue'), 'utf8');
  for (const source of [mobile, client]) {
    assert.match(source, /getNativeAttachmentBridge\(\).*openNativeAttachment/s);
    assert.match(source, /getNativeAttachmentBridge\(\).*saveNativeAttachment/s);
    assert.match(source, /'已保存'/);
    assert.match(source, /window\.addEventListener\('yimeng-native-attachment', handleNativeAttachment\)/);
    assert.match(source, /window\.removeEventListener\('yimeng-native-attachment', handleNativeAttachment\)/);
  }
});

test('attachment save behavior clicks a sanitized native download and revokes its URL', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const actions = await import(pathToFileURL(path.join(__dirname, '../client-web/src/attachmentActions.js')).href);
  const calls = [];
  const link = { style: {}, click: () => calls.push('click'), remove: () => calls.push('remove') };
  const documentObject = { createElement: tag => { assert.equal(tag, 'a'); return link; }, body: { appendChild: node => assert.equal(node, link) } };
  const urlObject = { createObjectURL: () => 'blob:test', revokeObjectURL: value => calls.push(`revoke:${value}`) };
  actions.saveBlob(new Blob(['data']), 'unsafe:name.txt', documentObject, urlObject);
  assert.equal(link.href, 'blob:test');
  assert.equal(link.download, 'unsafe_name.txt');
  assert.deepEqual(calls, ['click', 'remove']);
  t.mock.timers.tick(1000);
  assert.deepEqual(calls, ['click', 'remove', 'revoke:blob:test']);
});

// 忆梦云团队开发：使用项目真实 Vue ref 执行预览及 blob 加载方法。
for (const component of ['client-web/src/views/ChatPage.vue', 'user-web/src/views/desktop/ChatPanel.vue', 'user-web/src/views/mobile/ChatPanel.vue']) {
  const project = component.split('/')[0];
  const { ref, isReactive } = require(path.join(__dirname, '..', project, 'node_modules/vue'));
  function previewHarness(directFailure = false) {
    const source = fs.readFileSync(path.join(__dirname, '..', component), 'utf8');
    const pending = [];
    const created = [];
    const revoked = [];
    const preview = ref(null);
    const context = vm.createContext({
      preview, previewVideo: ref(null), AbortController, Date, setTimeout: () => 1, clearTimeout() {}, mediaUrls: ref({}), mediaRequests: new Map(),
      cacheScope: project === 'client-web' ? ref('scope') : 'scope',
      attachmentExpired: msg => Boolean(msg.recalledAt),
      attachmentUrl: msg => `/api/files/${msg.attachmentId}`,
      thumbnailUrl: msg => `/api/files/${msg.attachmentId}/thumbnail`,
      mediaKey: (msg, thumbnail) => `${msg._id}:${Boolean(thumbnail)}`,
      privateMediaScope: () => 'scope',
      mediaCacheKey: (scope, msg, thumbnail) => `${scope}:${msg._id}:${Boolean(thumbnail)}`,
      loadCachedMedia: (scope, msg, thumbnail, loader) => loader(),
      acquireObjectUrl: () => { const url = `blob:test-${created.length}`; created.push(url); return url; },
      subscribePrivateMedia: () => () => {}, mediaSubscriptions: new Map(), persistMessages() {},
      markAttachmentExpired: () => { context.closePreview(); },
      downloadProgressState: event => ({ loaded: event.loaded, total: event.total || 0, percent: event.total ? Math.round(event.loaded * 100 / event.total) : 0 }),
      URL: { createObjectURL: () => { const url = `blob:test-${created.length}`; created.push(url); return url; }, revokeObjectURL: url => revoked.push(url) },
      api: { post: (url, body, options) => new Promise((resolve, reject) => pending.push({ url, options, resolve, reject })), get: (url, options) => new Promise((resolve, reject) => pending.push({ url, options, resolve, reject })) },
    });
    for (const name of ['loadMedia', 'openPreview', 'closePreview', 'stopPreviewVideo', 'previewMediaEvent']) {
      const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
      assert.ok(start >= 0, name);
      vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
    }
    if (directFailure) context.api.post = async () => { throw new Error('unexpected failure'); };
    const message = id => ref({ _id: id, attachmentId: id, messageType: 'video', attachmentStatus: 'active' }).value;
    return { context, preview, pending, created, revoked, message };
  }
  test(component + ' real media stop, expiry, late events and image compatibility', async () => {
    const h = previewHarness();
    let stops = 0;
    const video = { pause() { stops++; }, removeAttribute(name) { assert.equal(name, 'src'); stops++; }, load() { stops++; } };
    h.context.previewVideo.value = video;
    const task = h.context.openPreview(h.message('a'));
    h.pending[0].resolve({ data: { url: '/api/files/a/playback/' + 'a'.repeat(32), expiresAt: Date.now() + 300000 } });
    await task;
    h.context.previewMediaEvent({ target: h.context.previewVideo.value, type: 'playing' });
    assert.equal(h.preview.value.buffering, false);
    h.context.previewMediaEvent({ target: h.context.previewVideo.value, type: 'waiting' });
    assert.equal(h.preview.value.buffering, true);
    h.context.previewMediaEvent({ target: {}, type: 'error' });
    assert.equal(h.preview.value.error, false);
    h.preview.value.expiresAt = 0;
    h.context.previewMediaEvent({ target: h.context.previewVideo.value, type: 'playing' });
    assert.equal(h.preview.value.error, true);
    assert.equal(h.preview.value.url, '');
    h.context.closePreview();
    assert.equal(h.pending[0].options.signal.aborted, true);
    assert.ok(stops >= 6);
    const old = h.message('legacy'); delete old.attachmentId;
    await h.context.openPreview(old);
    assert.equal(h.preview.value.error, true);
    assert.equal(h.pending.length, 1);
    const image = h.message('image'); image.messageType = 'image';
    const imageTask = h.context.openPreview(image);
    await Promise.resolve();
    assert.equal(h.pending[1].options.responseType, 'blob');
    h.pending[1].resolve(new Blob(['image'], { type: 'image/png' }));
    await imageTask;
    assert.match(h.preview.value.url, /^blob:/);
    assert.equal(h.preview.value.error, false);
    h.context.closePreview();
  });
  test(component + ' real Vue proxy identity evidence', () => {
    const raw = { loading: true };
    const state = ref(raw);
    assert.notEqual(state.value, raw);
    assert.ok(isReactive(state.value));
    const snapshot = state.value;
    assert.equal(state.value, snapshot);
  });
  for (const outcome of ['success', 'reject', 'timeout', 'cancel', 'unexpected', 'switch', 'close', 'same-video', 'session', 'expired', 'gone']) {
    test(component + ' real Vue preview: ' + outcome, async () => {
      const h = previewHarness(outcome === 'unexpected');
      const a = h.message('a');
      const first = h.context.openPreview(a);
      assert.ok(isReactive(h.preview.value));
      if (outcome === 'unexpected') {
        await first;
        assert.equal(h.preview.value.loading, false);
        assert.equal(h.preview.value.error, true);
        return;
      }
      if (['reject', 'timeout', 'cancel'].includes(outcome)) {
        h.pending[0].reject(Object.assign(new Error(outcome), { code: outcome === 'timeout' ? 'ECONNABORTED' : 'ERR_CANCELED' }));
        await first;
        assert.equal(h.preview.value.loading, false);
        assert.equal(h.preview.value.error, true);
        assert.equal(h.context.mediaRequests.size, 0);
        return;
      }
      assert.equal(h.pending[0].options.responseType, undefined);
      assert.equal(h.pending[0].url, '/files/a/playback');
      assert.ok(h.pending[0].options.signal);
      assert.equal(h.created.length, 0);
      if (outcome === 'gone') {
        h.pending[0].reject({ httpStatus: 410 });
        await first;
        assert.equal(h.preview.value, null);
        assert.equal(h.context.mediaRequests.size, 0);
        return;
      }
      if (outcome === 'session') { h.context.closePreview(); h.context.mediaRequests.clear(); }
      if (outcome === 'expired') a.recalledAt = 'now';
      let second;
      if (outcome === 'switch' || outcome === 'same-video') second = h.context.openPreview(outcome === 'switch' ? h.message('b') : a);
      if (outcome === 'close') h.context.closePreview();
      if (outcome === 'switch' || (outcome === 'same-video' && h.pending.length > 1)) {
        h.pending[1].resolve({ data: { url: '/api/files/' + (outcome === 'switch' ? 'b' : 'a') + '/playback/' + 'b'.repeat(32), expiresAt: Date.now() + 300000 } });
        await second;
      }
      h.pending[0].resolve({ data: { url: '/api/files/a/playback/' + 'a'.repeat(32), expiresAt: Date.now() + 300000 } });
      await first;
      if (second) await second;
      if (outcome === 'close' || outcome === 'session') assert.equal(h.preview.value, null);
      else if (outcome === 'expired') {
        assert.equal(h.preview.value.loading, false);
        assert.equal(h.preview.value.error, true);
      } else {
        assert.equal(h.preview.value.loading, false);
        assert.equal(h.preview.value.error, false);
        assert.ok(h.preview.value.url);
        assert.ok(!h.revoked.includes(h.preview.value.url), 'active video URL must not have been revoked');
        if (outcome === 'switch') assert.equal(h.preview.value.msg._id, 'b');
      }
      assert.equal(h.context.mediaRequests.size, 0);
      h.context.closePreview();
      assert.deepEqual([...new Set(h.revoked)].sort(), [...h.created].sort(), 'all created URLs released');
    });
  }
}

// 忆梦云团队开发：三端媒体模板保持裸媒体、外置状态和独立文件卡片契约。
for (const component of ['client-web/src/views/ChatPage.vue', 'user-web/src/views/desktop/ChatPanel.vue', 'user-web/src/views/mobile/ChatPanel.vue']) {
  test(component + ' media template keeps text/file branches and accessible preview behavior', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', component), 'utf8');
    assert.match(source, /'bare-media': \['image', 'video'\]\.includes\(msg\.messageType\)/);
    assert.match(source, /v-else-if="msg\.messageType === 'file'[^>]+class="(?:message-file|cp-bubble-file)"/);
    assert.match(source, /<template v-else>\s*<template v-for="\(part, index\) in parseMessageContent\(msg\.content\)"/);
    assert.match(source, /class="chat-media message-video-wrap"[^>]+aria-label=/);
    assert.match(source, /class="chat-media-play"/);
    assert.match(source, /(?:message-transfer-status|cp-transfer-status)"[^>]+role="status"/);
    const imageBranch = source.indexOf(`msg.messageType === 'image'`, source.indexOf('<template'));
    const fileBranch = source.indexOf(`msg.messageType === 'file'`, imageBranch);
    const textFallback = source.indexOf('parseMessageContent(msg.content)', fileBranch);
    assert.ok(imageBranch >= 0 && imageBranch < fileBranch && fileBranch < textFallback, 'media content must not fall through to the text path');
  });
}

// 忆梦云团队开发：真实媒体事件保持比例、占位切换与专用容器定位。
for (const component of ['client-web/src/views/ChatPage.vue', 'user-web/src/views/desktop/ChatPanel.vue', 'user-web/src/views/mobile/ChatPanel.vue']) {
  test(component + ' bare media load and error preserve natural ratio', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', component), 'utf8');
    const classes = new Set(); const properties = {};
    const label = { textContent: '' };
    let video = false;
    const wrap = { style: { setProperty: (k, v) => properties[k] = v }, classList: { add: k => classes.add(k), remove: k => classes.delete(k), contains: k => k === 'message-video-wrap' ? video : classes.has(k) }, querySelector: () => label };
    const el = { naturalWidth: 300, naturalHeight: 600, hidden: true, closest: selector => { assert.equal(selector, '.chat-media'); return wrap; } };
    const context = vm.createContext({ scheduleScroll() {} });
    for (const name of ['handleChatMediaLoad', 'handleChatMediaError']) {
      const start = source.indexOf('function ' + name + '(');
      vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
    }
    context.handleChatMediaLoad({ currentTarget: el });
    assert.equal(properties['--media-width'], '110px');
    assert.equal(properties['--media-mobile-width'], '90px');
    assert.equal(properties['--media-ratio'], '0.5');
    assert.equal(el.hidden, false); assert.ok(classes.has('has-media'));
    context.handleChatMediaError({ currentTarget: el });
    assert.equal(el.hidden, true); assert.ok(!classes.has('has-media'));
    assert.equal(label.textContent, '图片加载失败，点击重试');
    video = true;
    context.handleChatMediaLoad({ currentTarget: el });
    assert.equal(properties['--media-width'], '240px');
    assert.equal(properties['--media-mobile-width'], '210px');
    assert.equal(properties['--media-ratio'], '16 / 10');
    assert.ok(!classes.has('media-error'));
    assert.match(source, /observer.observe\(el.closest\('\.chat-media'\) \|\| el\)/);
  });
}

// Execute component declarations and functions, rather than supplying missing state in mocks.
function attachmentComponentHarness(relativePath, names, mocks) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  const declarations = source.split('\n').filter(line => /^(const (downloadedVersion|downloadProgress|uploading|contextMenu)|let activeUploadId) =/.test(line)).join('\n');
  const functions = names.map(name => {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(start >= 0, name);
    return source.slice(start, source.indexOf('\n}', start) + 2);
  }).join('\n');
  const context = vm.createContext({ ref: value => ({ value }), ...mocks });
  vm.runInContext(declarations + '\n' + functions, context);
  return context;
}

for (const component of ['client-web/src/views/ChatPage.vue', 'user-web/src/views/desktop/ChatPanel.vue', 'user-web/src/views/mobile/ChatPanel.vue']) {
  test(component + ' download executes and updates the real reactive record', async () => {
    const actions = await import(pathToFileURL(path.join(__dirname, '../client-web/src/attachmentActions.js')).href);
    const values = new Map();
    let saves = 0;
    const context = attachmentComponentHarness(component, ['isDownloaded', 'downloadFile'], {
      cacheScope: component.startsWith('client') ? { value: 'scope' } : 'scope',
      localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) },
      ...actions, saveBlob() { saves++; }, navigator: {}, setTimeout() {}, showToast() {},
      attachmentExpired: () => false, attachmentUrl: () => '/attachment',
      api: { get: async () => new Blob(['data']) },
    });
    const msg = { attachmentId: 'attachment-1', attachmentName: 'file.txt' };
    assert.equal(context.isDownloaded(msg), false);
    await context.downloadFile(msg);
    assert.equal(saves, 1);
    assert.equal(context.isDownloaded(msg), true);
    assert.equal(vm.runInContext('downloadedVersion.value', context), 1);
    assert.equal(vm.runInContext('downloadProgress.value.status', context), 'success');
  });
}

for (const device of ['desktop', 'mobile']) {
  for (const outcome of ['success', 'failure', 'overlap']) test(device + ' upload resets owning state: ' + outcome, async () => {
    let sequence = 0;
    const pending = [];
    const rows = new Map();
    const context = attachmentComponentHarness(`user-web/src/views/${device}/ChatPanel.vue`, ['prepareSendWindow', 'handleUpload'], {
      conversationEpoch: 0, positionMode: { value: 'latest' }, loadMessages: async () => true,
      accepted: { value: true }, props: { conversationId: 'conversation-1' }, messageGeneration: 0,
      showMore: { value: false }, createClientMessageId: () => `upload-${++sequence}`,
      FormData: class { append() {} }, showToast() {}, scrollToLatest: async () => {},
      mergeMessage: msg => rows.set(msg.clientMessageId, msg),
      updatePendingMessage: (id, patch) => Object.assign(rows.get(id), patch),
      api: { post: (url, body) => url.endsWith('/attachments')
        ? new Promise((resolve, reject) => pending.push({ resolve, reject }))
        : Promise.resolve({ code: 0, data: { ...body, _id: 'saved' } }) },
    });
    const event = () => ({ target: { files: [{ type: 'text/plain', name: 'file.txt' }], value: 'selected' } });
    const first = context.handleUpload(event());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(vm.runInContext('uploading.value', context), true);
    assert.equal(vm.runInContext('activeUploadId', context), 'upload-1');
    let second;
    if (outcome === 'overlap') { second = context.handleUpload(event()); await new Promise(resolve => setImmediate(resolve)); }
    if (outcome === 'failure') pending[0].reject(new Error('upload failed'));
    else pending[0].resolve({ code: 0, data: { attachmentId: 'a1', category: 'file' } });
    await first;
    if (second) {
      assert.equal(vm.runInContext('uploading.value', context), true, 'older completion must not reset newer upload');
      assert.equal(vm.runInContext('activeUploadId', context), 'upload-2');
      pending[1].resolve({ code: 0, data: { attachmentId: 'a2', category: 'file' } });
      await second;
    }
    assert.equal(vm.runInContext('uploading.value', context), false);
    assert.equal(vm.runInContext('activeUploadId', context), null);
    if (outcome === 'failure') assert.equal(rows.get('upload-1').uploadPhase, 'failed');
  });
}

for (const side of ['tenant', 'client', 'admin']) test(side + ' real pagination handles reversed IDs, ties and foreign cursors', async () => {
  const id = n => String(n).padStart(24, '0');
  const conv = { _id: id(99), tenantId: 't' };
  const rows = [[4, 1000], [2, 2000], [3, 2000], [1, 3000]].map(([n, time]) => ({
    _id: id(n), createdAt: new Date(time), conversationId: conv._id, tenantId: 't',
    toJSON() { return { _id: this._id, createdAt: this.createdAt }; }, async populate() { return this; },
  }));
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some(f => matches(row, f));
    if (value == null) return row[key] == null;
    if (value instanceof Date || Object.prototype.toString.call(value) === '[object Date]') return +row[key] === +value;
    if (typeof value === 'object') return Object.entries(value).every(([op, bound]) => op === '$lt' ? row[key] < bound : row[key] > bound);
    return row[key] === value;
  });
  const chain = value => ({ select() { return this; }, populate() { return this; }, sort(order) {
    if (Array.isArray(value)) value.sort((a,b) => { for (const [key, direction] of Object.entries(order)) { if (a[key] < b[key]) return -direction; if (a[key] > b[key]) return direction; } return 0; });
    return this;
  }, limit(n) { assert.ok(n > 0, 'never issue unbounded limit(0)'); value = value.slice(0,n); return this; }, lean() { return this; }, then(resolve,reject) { return Promise.resolve(value).then(resolve,reject); } });
  const mocks = {
    '../models/Conversation': { findOne: () => chain(conv), findById: () => chain(conv) },
    '../models/Message': { findOne: filter => chain(rows.find(r => matches(r,filter)) || null), find: filter => chain(rows.filter(r => matches(r,filter))), updateMany: async () => ({ modifiedCount: 0 }) },
  };
  const controller = loadModule('src/controllers/' + (side === 'admin' ? 'AdminConversationController.js' : 'ChatController.js'), mocks).module.exports;
  const invoke = async query => {
    const res = { locals: {}, status(n) { this.http = n; return this; }, json(body) { this.body = body; return this; } };
    await controller[side === 'admin' ? 'messages' : side === 'client' ? 'getClientMessages' : 'getMessages']({ params: { id: conv._id }, query, tenantId: 't', user: { role: 'owner' }, customer: { tenantId: 't' } },res);
    return res;
  };
  const ids = res => Array.from(res.body.data, m => m._id);
  assert.deepEqual(ids(await invoke({ limit: 2 })), [id(3), id(1)]);
  assert.deepEqual(ids(await invoke({ before: id(3), limit: 2 })), [id(4), id(2)]);
  assert.notEqual((await invoke({ before: id(88) })).body.code, 0);
  if (side !== 'admin') assert.deepEqual(ids(await invoke({ after: id(2), limit: 2 })), [id(3), id(1)]);
  if (side !== 'client') {
    assert.deepEqual(ids(await invoke({ around: id(2), limit: 1 })), [id(2)]);
    assert.deepEqual(ids(await invoke({ around: id(2), limit: 3 })), [id(4), id(2), id(3)]);
  }
});

test('chat events reject foreign/uninitialized/stale identity before merge, sound and cursor', () => {
  const source = fs.readFileSync(path.join(__dirname, '../client-web/src/views/ChatPage.vue'), 'utf8');
  const context = vm.createContext({ deletedMessageIds: new Set(), sessionActive: true, mountedToken: 'a', token: { value: 'a' }, conversation: { value: null }, customer: { value: { tenantId: 't' } }, messages: { value: [] }, sounds: 0, playNotificationSound() { context.sounds++; }, scheduleScroll() {} });
  for (const name of ['isCurrentSession', 'belongsToConversation', 'mergeMessage', 'handleNewMessage']) {
    const start = source.indexOf('function ' + name + '(');
    const end = name === 'isCurrentSession' ? source.indexOf('\n', start) : source.indexOf('\n}', start) + 2;
    vm.runInContext(source.slice(start, end), context);
  }
  const msg = { _id: 'm1', conversationId: 'c', tenantId: 't', senderType: 'agent' };
  context.handleNewMessage(msg);
  assert.equal(context.messages.value.length, 0);
  context.conversation.value = { _id: 'c' };
  context.handleNewMessage(msg);
  context.handleNewMessage(msg);
  const cursor = () => context.messages.value.at(-1)?._id;
  for (const foreign of [{ ...msg, _id: 'foreign', conversationId: 'other' }, { ...msg, _id: 'foreign', channelToken: 'b' }, { ...msg, _id: 'foreign', tenantId: 'other' }]) context.handleNewMessage(foreign);
  assert.equal(cursor(), 'm1');
  assert.equal(context.sounds, 1);
  context.token.value = 'b';
  context.handleNewMessage({ ...msg, _id: 'stale' });
  assert.equal(cursor(), 'm1');
  context.token.value = 'a'; context.sessionActive = false;
  context.handleNewMessage({ ...msg, _id: 'unmounted' });
  assert.equal(cursor(), 'm1');
});

test('read and summary interleavings never overwrite message-derived unread facts', async () => {
  let rows = [{ tenantId: 't', conversationId: 'c', senderType: 'customer', readByAgent: false }];
  let afterRead = () => {}, afterAggregate = () => {};
  const model = {
    find: filter => ({ cast: () => filter }),
    aggregate: async pipeline => {
      const scope = pipeline[0].$match;
      const evaluate = (expr, row) => {
        if (typeof expr === 'string' && expr.startsWith('$')) return row[expr.slice(1)];
        if (Array.isArray(expr)) return expr.map(x => evaluate(x, row));
        if (!expr || typeof expr !== 'object') return expr;
        const [op, args] = Object.entries(expr)[0]; const values = evaluate(args, row);
        if (op === '$eq') return values[0] === values[1];
        if (op === '$in') return values[1].includes(values[0]);
        if (op === '$and') return values.every(Boolean);
        if (op === '$ifNull') return values[0] ?? values[1];
        if (op === '$cond') return values[0] ? values[1] : values[2];
        throw Error(op);
      };
      const counts = {};
      for (const key of ['agentUnreadCount', 'customerUnreadCount']) counts[key] = rows.filter(r => Object.entries(scope).every(([k,v]) => r[k] === v)).reduce((n,r) => n + evaluate(pipeline[1].$group[key].$sum, r), 0);
      await afterAggregate(); return [counts];
    },
    findOne: () => ({ sort: async () => null }),
    updateMany: async filter => { rows.filter(r => Object.entries(filter).every(([k,v]) => r[k] === v)).forEach(r => { r.readByAgent = true; }); await afterRead(); },
  };
  const service = loadModule('src/services/conversationUnreadService.js', { '../models/Message': model }).module.exports;
  const controller = loadModule('src/controllers/ChatController.js', { '../models/Message': model, '../services/conversationUnreadService': service });
  const conv = { _id: 'c', tenantId: 't', save: () => { throw Error('snapshot write'); } };
  const incoming = () => rows.push({ tenantId: 't', conversationId: 'c', senderType: 'customer', readByAgent: false });
  afterRead = async () => { incoming(); afterRead = () => {}; };
  await controller.markAgentConversationRead({ user: { role: 'owner' }, tenantId: 't' }, conv);
  assert.equal((await service.conversationUnread(conv)).agentUnreadCount, 1);
  afterAggregate = async () => { incoming(); afterAggregate = () => {}; };
  await controller.refreshConversationSummary(conv);
  assert.equal((await service.conversationUnread(conv)).agentUnreadCount, 2);
  for (let i = 0; i < 2; i++) await controller.markAgentConversationRead({ user: { role: 'owner' }, tenantId: 't' }, conv);
  assert.equal((await service.conversationUnread(conv)).agentUnreadCount, 0);
  rows.push({ tenantId: 'other', conversationId: 'c', senderType: 'customer', readByAgent: false });
  rows.push({ tenantId: 't', conversationId: 'c', senderType: 'customer', readByAgent: false, deletedForAgentAt: new Date() });
  rows.push({ tenantId: 't', conversationId: 'c', senderType: 'bot', readByCustomer: false, recalledAt: new Date(), attachmentStatus: 'expired' });
  assert.equal((await service.conversationUnread(conv)).agentUnreadCount, 0);
  assert.equal((await service.conversationUnread(conv)).customerUnreadCount, 1);
});
const Message = require('./src/models/Message');
const Tenant = require('./src/models/Tenant');
const cache = require('./src/utils/cache');
const { error } = require('./src/utils');
const validators = require('./src/middleware/validators');
const { validationResult } = require('express-validator');

test('all backend JavaScript parses', () => {
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
  for (const file of [path.join(__dirname, 'app.js'), ...walk(path.join(__dirname, 'src'))]) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
  }
});

test('attachment URLs work on aggregation objects and model JSON', () => {
  for (const type of ['image', 'video', 'file']) {
    const result = Message.applyAttachmentUrls({ attachmentId: 'abc', attachmentStatus: 'active', messageType: type });
    assert.equal(result.attachmentUrl, '/api/files/abc');
    assert.equal(result.thumbnailUrl, type === 'file' ? '' : '/api/files/abc/thumbnail');
  }
  const expired = Message.applyAttachmentUrls({ attachmentId: 'abc', attachmentStatus: 'active', attachmentExpiredAt: new Date(0) });
  assert.equal(expired.attachmentStatus, 'expired');
  assert.equal(expired.attachmentUrl, '');
  assert.equal(new Message({ attachmentId: '000000000000000000000001', attachmentStatus: 'recalled' }).toJSON().attachmentUrl, '');
});

test('HTTP status defaults preserve business codes and explicit overrides', () => {
  for (const [code, override, expected] of [[404, undefined, 404], [403, undefined, 403], [401, undefined, 401], [4004, undefined, 400], [1, undefined, 400], [403, 409, 409]]) {
    const res = { locals: {}, status(value) { this.http = value; return this; }, json(value) { this.body = value; return this; } };
    error(res, 'test', code, override);
    assert.equal(res.http, expected);
    assert.equal(res.body.code, code);
  }
});

test('matching consumption is single-use and wrong/expired hashes do not succeed', async () => {
  await cache.setJson('test:single', { codeHash: 'right' }, 10);
  assert.equal(await cache.consumeMatchingJson('test:single', 'wrong'), false);
  const results = await Promise.all(Array.from({ length: 30 }, () => cache.consumeMatchingJson('test:single', 'right')));
  assert.equal(results.filter(Boolean).length, 1);
  await cache.setJson('test:expired', { codeHash: 'right' }, -1);
  assert.equal(await cache.consumeMatchingJson('test:expired', 'right'), false);
});

test('plan model rejects fractions, negative and unsafe values while accepting zero', () => {
  for (const field of ['agentLimit', 'channelLimit', 'messageRetentionDays', 'attachmentLimitMB']) {
    for (const value of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const tenant = new Tenant({ plan: { [field]: value } });
      assert.ok(tenant.validateSync()?.errors['plan.' + field]);
    }
    assert.equal(new Tenant({ plan: { [field]: 0 } }).validateSync()?.errors['plan.' + field], undefined);
  }
});

async function valid(name, body) {
  const req = { body };
  for (const chain of validators[name].slice(0, -1)) await chain.run(req);
  return validationResult(req).isEmpty();
}
test('employee and reply PATCH validation rejects coerced types and invalid bounds', async () => {
  assert.equal(await valid('updateAgent', {}), true);
  for (const body of [{ username: [] }, { username: 'ab' }, { displayName: ' ' }, { role: 'owner' }, { status: 'trial' }]) assert.equal(await valid('updateAgent', body), false);
  assert.equal(await valid('createAgent', { username: 'agent', displayName: 'Agent', password: '123456' }), true);
  assert.equal(await valid('updateKeywordReply', { status: 'disabled' }), true);
  assert.equal(await valid('updateKeywordReply', { matchType: 'regex' }), false);
  assert.equal(await valid('updateQuickReply', { content: 'a'.repeat(501) }), false);
  assert.equal(await valid('updateQuickReply', { sortOrder: '1' }), false);
});

test('tenant cache tolerates malformed JSON and never falls back while isolated', () => {
  const source = fs.readFileSync(path.join(__dirname, '../user-web/src/api.js'), 'utf8');
  const helper = source.slice(source.indexOf('export function readTenantCache'), source.indexOf('export function clearTenantSession')).replace('export function', 'function');
  const session = new Map();
  const local = new Map([['tenant_user', JSON.stringify({ role: 'owner' })]]);
  const context = vm.createContext({ sessionStorage: { getItem: key => session.get(key) }, localStorage: { getItem: key => local.get(key) } });
  vm.runInContext(helper, context);
  assert.equal(context.readTenantCache('tenant_user').role, 'owner');
  session.set('tenant_user', '{broken');
  assert.equal(context.readTenantCache('tenant_user'), null);
  session.delete('tenant_user');
  session.set('tenant_impersonation', '1');
  assert.equal(context.readTenantCache('tenant_user'), null);
});

// 执行实际模块，仅替换数据库、网络等边界；内部函数只在测试 VM 中暴露。
function loadModule(relative, mocks, expose = '') {
  const filename = path.join(__dirname, relative);
  const nativeRequire = require('node:module').createRequire(filename);
  const context = vm.createContext({
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : nativeRequire(name),
    module: { exports: {} }, console, Buffer, setTimeout, clearTimeout,
  });
  vm.runInContext(fs.readFileSync(filename, 'utf8') + '\n' + expose, context, { filename });
  return context;
}

test('geetest 3.0.1 real SDK Promise handles success false rejection and online/offline initialization', async () => {
  assert.equal(require('geetest/package.json').version, '3.0.1');
  const md5 = value => require('crypto').createHash('md5').update(value).digest('hex');
  let mode = 'success';
  const SDK = loadModule('node_modules/geetest/gt-sdk.js', { request: {
    post(url, options, cb) { setImmediate(() => mode === 'reject' ? cb(new Error('network')) : cb(null, {}, mode === 'success' ? md5('code') : 'bad')); },
    get(url, options, cb) { setImmediate(() => mode === 'offline' ? cb(new Error('network')) : cb(null, {}, 'a'.repeat(32))); },
  } }).module.exports;
  const settings = { getSystemSettings: async () => ({ captcha: { enabled: true, provider: 'geetest', geetestId: 'id', geetestKey: 'key' } }) };
  const mocks = { geetest: SDK, '../utils/systemSettings': settings };
  const verify = loadModule('src/middleware/captcha.js', mocks).module.exports.verifyCaptcha;
  const create = loadModule('src/controllers/CaptchaController.js', mocks).module.exports.create;
  for (mode of ['success', 'false', 'reject']) {
    const res = response(); let passed = 0;
    await verify({ body: { geetest_challenge: 'challenge', geetest_validate: md5('keygeetestchallenge'), geetest_seccode: 'code' } }, res, () => passed++);
    await new Promise(setImmediate);
    assert.equal(passed, mode === 'success' ? 1 : 0);
    if (!passed) assert.equal(res.http, mode === 'reject' ? 503 : 400);
  }
  for (mode of ['success', 'offline']) {
    const res = response(); await create({}, res);
    assert.equal(res.body.data.success, mode === 'success' ? 1 : 0);
    assert.ok(res.body.data.challenge);
    assert.equal(res.body.data.gt, 'id');
  }
});

function response() {
  return { locals: {}, status(code) { this.http = code; return this; }, json(body) { this.body = body; return this; } };
}

test('deleted channel denies HTTP guest/customer context and both send paths before writes', async () => {
  for (const identity of ['guest', 'customer']) {
    const payload = { type: 'customer', identity, id: 'b', tenantId: 't', channelId: 'c' };
    const mocks = { '../utils': { ...require('./src/utils'), verifyToken: () => payload },
      '../models/Channel': { findOne: filter => { assert.equal(filter.tenantId, 't'); return query(null); } },
      '../models/Tenant': { findOne: () => query({ _id: 't' }) } };
    const res = response();
    await loadModule('src/middleware/auth.js', mocks).authCustomer({ headers: { authorization: 'Bearer test' } }, res, () => assert.fail('authorized'));
    assert.equal(res.http, 403);
    const chat = loadModule('src/controllers/ChatController.js', { ...mocks, '../models/Conversation': { findOne: () => query({ _id: 'v', channelId: 'c' }) } }).module.exports;
    for (const method of ['agentSendMessage', 'customerSendMessage']) {
      const result = response();
      await chat[method]({ params: { id: 'v' }, tenantId: 't', customer: payload }, result);
      assert.equal(result.http, 404);
    }
  }
});

test('channel deletion scopes cleanup and evicts only related subscriptions', async () => {
  const calls = [];
  const scoped = filter => { assert.equal(filter.tenantId, 't'); calls.push(filter); };
  const controller = loadModule('src/controllers/ChannelController.js', {
    '../models/Channel': { findOne: () => query({ _id: 'c', publicToken: 'p' }), deleteOne: scoped },
    '../models/KeywordReply': { deleteMany: scoped }, '../models/QuickReply': { deleteMany: scoped },
    '../utils/cache': { remove: async () => {} }, '../services/auditLogService': { recordOperation() {} },
  }).module.exports;
  const rooms = [];
  await controller.delete({ params: { id: 'c' }, tenantId: 't', app: { get: () => ({ in: room => ({ disconnectSockets: close => rooms.push([room, close]), socketsLeave: target => rooms.push([room, target]) }) }) } }, response());
  assert.equal(calls.length, 3);
  assert.deepEqual(rooms, [['channel-c', true], ['channel-staff-c', 'channel-staff-c']]);
});

test('socket handshake rejects deleted and partial customer channel contexts', async () => {
  for (const partial of [false, true]) {
    let auth;
    const payload = { type: 'customer', id: 'b', tenantId: 't', ...(partial ? {} : { channelId: 'c' }) };
    const setup = loadModule('src/sockets/index.js', {
      '../utils': { verifyToken: () => payload }, '../config/redis': { getRedis: () => null },
      '../models/Customer': { findOne: () => query({ accountId: 'a', tenantId: 't', channelId: 'c' }) },
      '../models/CustomerAccount': { findOne: () => query({ _id: 'a' }) },
      '../models/Tenant': { findOne: () => query({ _id: 't' }) },
      '../models/Channel': { findOne: filter => { assert.equal(filter.tenantId, 't'); return query(null); } },
    }).module.exports;
    await setup({ use(fn) { auth = fn; }, on() {} });
    let rejected;
    await auth({ handshake: { auth: { token: 'test' } } }, err => { rejected = err; });
    assert.ok(rejected);
  }
});

test('legacy binding claims preserve identity and reject foreign account guest and credential mismatch', async () => {
  for (const mode of ['match', 'different-hash', 'mismatch', 'foreign', 'guest', 'race']) {
    const utils = require('./src/utils');
    const hash = utils.hashPassword('verified-password');
    const account = { _id: 'a', phone: '123', password: hash };
    const legacy = { _id: 'b', password: mode === 'different-hash' ? utils.hashPassword('verified-password') : mode === 'mismatch' ? utils.hashPassword('other') : hash, identityType: mode === 'guest' ? 'guest' : 'customer', accountId: mode === 'foreign' ? 'foreign' : null, blocked: true };
    let claims = 0;
    const context = loadModule('src/controllers/CustomerAuthController.js', { '../models/Customer': {
      findOne: filter => { assert.equal(filter.tenantId, 't'); assert.equal(filter.channelId, 'c'); assert.equal(filter.email, undefined); return query(filter.phone ? legacy : null); },
      findOneAndUpdate: (filter, update) => { claims++; assert.equal(filter.accountId, null); assert.equal(update.$set.accountId, 'a'); return query(mode === 'race' ? null : { ...legacy, accountId: 'a' }); },
    } });
    const action = () => context.findSessionBinding({ _id: 'c', tenantId: 't' }, account, 'verified-password');
    if (['match', 'different-hash'].includes(mode)) { const linked = await action(); assert.equal(linked._id, 'b'); assert.equal(linked.blocked, true); }
    else await assert.rejects(action, err => err.status === 409);
    assert.equal(claims, ['match', 'different-hash', 'race'].includes(mode) ? 1 : 0);
  }
});

for (const device of ['desktop', 'mobile']) test(`${device} real handlers clear other window media and fill historical gaps despite live messages`, async () => {
  const source = fs.readFileSync(path.join(__dirname, `../user-web/src/views/${device}/ChatPanel.vue`), 'utf8');
  const revoked = [], requests = [];
  const context = vm.createContext({
    incomingDuringLoad: null, positionMode: { value: 'latest' }, position: { receive() {} },
    props: { conversationId: 'c' }, messages: { value: [{ _id: '01', conversationId: 'c' }] }, historyCursor: '01', messageGeneration: 0, messageSyncInFlight: false,
    mediaUrls: { value: { '01:original': 'blob:x' } }, avatarUrls: { value: {} }, mediaRequests: new Map(), avatarRequests: new Map(), preview: { value: null },
    hasMoreMessages: { value: true }, contextMenu: { value: {} }, cacheScope: 'scope', URL: { revokeObjectURL: url => revoked.push(url) },
    mediaKey: (msg, thumbnail = false) => `${msg._id}:${thumbnail ? 'thumbnail' : 'original'}`,
    privateMediaScope: () => 'scope', mediaCacheKey: () => 'cache-key', releaseObjectUrl: () => revoked.push('blob:x'),
    closePreview() {}, clearCachedConversation() {}, persistMessages() {}, emit() {},
    api: { get: async (_, { params }) => { requests.push(params.after); return { code: 0, data: [{ _id: '02', conversationId: 'c' }, { _id: '03', conversationId: 'c' }] }; } },
  });
  for (const name of ['mergeMessage', 'syncLatestMessages', 'releaseMediaUrls', 'applyDelete']) {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
    assert.ok(match, name); vm.runInContext(match[0], context);
  }
  context.mergeMessage({ _id: '03', conversationId: 'c' });
  await context.syncLatestMessages();
  assert.deepEqual(requests, ['01']);
  assert.equal(context.messages.value.map(m => m._id).join(','), '01,02,03');
  context.applyDelete({ conversationId: 'other', clearAll: true, side: 'agent' });
  assert.equal(context.messages.value.length, 3);
  context.applyDelete({ conversationId: 'c', clearAll: true, side: 'agent' });
  assert.equal(context.messages.value.length, 0); assert.equal(context.historyCursor, null);
  assert.deepEqual(revoked, ['blob:x']); assert.equal(context.mediaRequests.size, 0);
});

// 忆梦云团队开发：使用真实 Vue ref 验证客服聊天初始定位、历史锚点和会话隔离。
for (const device of ['desktop', 'mobile']) test(`${device} chat scrolling keeps initial, search, history and live-message invariants`, async () => {
  const { ref } = require(path.join(__dirname, '../user-web/node_modules/vue'));
  const source = fs.readFileSync(path.join(__dirname, `../user-web/src/views/${device}/ChatPanel.vue`), 'utf8');
  const observers = [];
  class TestResizeObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const children = [{}, {}];
  const container = {
    scrollHeight: 900, clientHeight: 300, scrollTop: 0, children,
    scrollTo({ top }) { this.scrollTop = top; },
    querySelector(selector) { return selector.includes('target') ? targetElement : null; },
  };
  const targetElement = { centered: false, classList: { add() {}, remove() {} }, scrollIntoView(options) { this.centered = options.block === 'center'; } };
  const context = vm.createContext({
    props: { conversationId: 'c1', targetMessageId: null }, msgContainer: ref(container), messageGeneration: 1,
    initialBottomSession: null, incomingDuringLoad: null, positionMode: ref('latest'), following: ref(true), pendingMessages: ref(false), loadingHistory: ref(false), hasMoreMessages: ref(true),
    messages: ref([{ _id: 'm2' }]), api: { get: async () => { container.scrollHeight += 300; return { code: 0, data: [{ _id: 'm1' }] }; } },
    persistMessages() {}, cancelLongPress() {}, emit() {}, setTimeout() {}, mergeMessage() {},
    nextTick: async callback => { if (callback) callback(); }, ResizeObserver: TestResizeObserver,
    requestAnimationFrame(callback) { callback(); }, reportDebugEvent,
  });
  let anchorTop = 0, anchorHeight = 0;
  context.position = {
    following: context.following,
    capture() { anchorTop = container.scrollTop; anchorHeight = container.scrollHeight; },
    restore() { container.scrollTop = context.following.value ? container.scrollHeight : anchorTop + container.scrollHeight - anchorHeight; },
    schedule() { if (context.following.value) container.scrollTop = container.scrollHeight; },
    scroll() { return true; },
    receive() { this.schedule(); },
  };
  const loadFunction = name => {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
    assert.ok(match, `${device} ${name}`);
    vm.runInContext(match[0], context);
  };
  for (const name of ['isNearBottom', 'scrollToBottom', 'cancelInitialBottomCorrection', 'correctInitialBottom', 'scrollToLatest', 'locateMessage', 'loadPreviousMessages', 'handleMessageScroll', 'handleSocketMessage']) loadFunction(name);
  const initial = context.scrollToLatest(true);
  await initial;
  assert.equal(container.scrollTop, 900, 'ordinary entry reaches the last message');
  assert.equal(observers.length, 1, 'ordinary entry watches initial layout reflow');
  container.scrollHeight = 1100;
  observers[0].callback();
  assert.equal(container.scrollTop, 1100, 'initial media/layout reflow stays pinned');

  container.scrollTop = 500;
  context.following.value = false; // Explicit input is tested with real wheel events in Playwright.
  context.handleMessageScroll({ currentTarget: container });
  assert.notEqual(context.initialBottomSession, null, 'scroll alone does not disconnect the layout lifecycle');
  container.scrollHeight = 1300;
  observers[0].callback();
  assert.equal(container.scrollTop, 500, 'late media reflow does not pull a user back down');

  context.props.targetMessageId = 'target';
  context.positionMode.value = 'target';
  container.scrollTop = 0;
  await context.locateMessage('target');
  assert.equal(targetElement.centered, true, 'search result centers its target');
  const targeted = context.scrollToLatest(true);
  await targeted;
  assert.equal(container.scrollTop, 0, 'target navigation is not forced to bottom');

  context.props.targetMessageId = null;
  context.positionMode.value = 'latest';
  container.scrollTop = 36; container.scrollHeight = 600;
  await context.loadPreviousMessages();
  assert.equal(container.scrollTop, 336, 'prepending history preserves the exact visual anchor');

  container.scrollHeight = 800; container.scrollTop = 200;
  context.handleSocketMessage({ conversationId: 'c1' });
  assert.equal(container.scrollTop, 200, 'live messages do not interrupt history viewing');
  container.scrollTop = 490;
  context.following.value = true;
  context.handleSocketMessage({ conversationId: 'c1' });
  assert.equal(container.scrollTop, 800, 'live messages keep a near-bottom user pinned');

  container.scrollHeight = 800; container.scrollTop = 500;
  const staleGeneration = context.messageGeneration;
  const staleSession = { generation: staleGeneration, conversationId: 'c1', container, corrections: 1, observer: null };
  context.initialBottomSession = staleSession;
  context.messageGeneration = 2; context.props.conversationId = 'c2';
  context.correctInitialBottom(staleSession);
  assert.equal(container.scrollTop, 500, 'late callbacks from the old conversation cannot scroll the new one');
});

test('mobile ordinary conversation navigation removes stale message location query', () => {
  const source = fs.readFileSync(path.join(__dirname, '../user-web/src/views/mobile/Messages.vue'), 'utf8');
  const match = source.match(/function openConversation\([^]*?\n\}/);
  assert.ok(match);
  let pushed;
  const context = vm.createContext({ search: { value: '' }, route: { query: { channelId: 'channel', message: 'old', around: 'old' } }, router: { push: value => { pushed = value; } }, reportDebugEvent });
  vm.runInContext(match[0], context);
  context.openConversation({ _id: 'conversation' });
  assert.deepEqual(JSON.parse(JSON.stringify(pushed)), { path: '/m/messages/conversation', query: { channelId: 'channel' } });
});

function query(value) {
  return { select() { return this; }, lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
}

 test('summary refresh only emits message.new for explicitly new agent/bot messages', async () => {
  const events = [];
  const context = loadModule('src/controllers/ChatController.js', {
    '../services/conversationUnreadService': { conversationUnread: async () => ({ customerUnreadCount: 0 }) },
    '../models/Customer': { findOne: () => query({ accountId: 'account' }) },
    '../models/Channel': { findOne: () => query({ _id: 'channel', publicToken: 'public' }) },
  });
  context.setIO({ to: room => ({ emit: (event, data) => events.push({ room, event, data }) }) });
  const conv = { _id: 'conv', customerId: 'binding', channelId: 'channel', tenantId: 'tenant' };
  for (const senderType of ['agent', 'bot', 'customer', 'system']) {
    for (const notify of [undefined, false, true]) {
      events.length = 0;
      await context.broadcastCustomerChannelSummary(conv, { lastMessage: { _id: 'message', senderType } }, notify);
      assert.equal(events.filter(e => e.event === 'channel-history.updated').length, 1);
      assert.equal(events.filter(e => e.event === 'message.new').length, notify === true && ['agent', 'bot'].includes(senderType) ? 1 : 0);
      assert.ok(events.every(e => e.room === 'customer-account-account'));
    }
  }
  events.length = 0;
  await context.broadcastCustomerChannelSummary(conv, {}, true);
  assert.equal(events.filter(e => e.event === 'message.new').length, 0);
});

 test('impersonation 401 then each real logout preserves isolation and administrator storage', async () => {
  for (const [file, fn] of [['Layout.vue', 'logout'], ['MobileLayout.vue', 'logout'], ['mobile/Profile.vue', 'doLogout']]) {
    const local = new Map([['tenant_token', 'original-admin'], ['tenant_user', '{"role":"owner"}'], ['tenant_info', '{"id":"tenant"}']]);
    const before = [...local];
    const session = new Map([['tenant_impersonation', '1'], ['tenant_token', 'impersonated'], ['tenant_user', '{"role":"agent"}']]);
    const storage = map => ({ getItem: key => map.get(key) ?? null, removeItem: key => map.delete(key), setItem: (key, value) => map.set(key, value) });
    let request, rejectResponse;
    const context = vm.createContext({
      sessionStorage: storage(session), localStorage: storage(local), URL,
      window: { location: { origin: 'https://example.test' } },
      axios: { create: () => ({ interceptors: { request: { use: fn => { request = fn; } }, response: { use: (_, fn) => { rejectResponse = fn; } } } }) },
      showLogoutConfirm: { value: true }, tenantIdentityScope: () => 'isolated', clearIdentityCache: async () => {},
      router: { push() {}, replace() {} }, reportDebugEvent,
    });
    const source = fs.readFileSync(path.join(__dirname, '../user-web/src/api.js'), 'utf8')
      .replace(/^import .*$/gm, '').replaceAll('export function ', 'function ').replace('export default api', '');
    vm.runInContext(source, context);
    assert.equal(request({ url: '/tenant/auth/me', baseURL: '/api', headers: {} }).headers.Authorization, 'Bearer impersonated');
    await assert.rejects(rejectResponse({ response: { status: 401, data: { message: 'expired' } } }));
    const view = fs.readFileSync(path.join(__dirname, '../user-web/src/views', file), 'utf8');
    const logout = view.match(new RegExp('async function ' + fn + '\\(\\) \\{[\\s\\S]*?\\n\\}'));
    assert.ok(logout, file);
    vm.runInContext(logout[0], context);
    await context[fn]();
    await context[fn]();
    assert.equal(context.readTenantCache('tenant_user'), null);
    assert.equal(context.readTenantCache('tenant_info'), null);
    assert.equal(request({ url: '/tenant/auth/me', baseURL: '/api', headers: {} }).headers.Authorization, undefined);
    assert.equal(session.get('tenant_impersonation'), '1');
    assert.deepEqual([...local], before);
  }
});

 test('legacy JWT and resolver reject guest and mismatched global credentials including duplicate-key races', async () => {
  for (const mode of ['guest', 'guest-binding', 'mismatch', 'race', 'match', 'create']) {
    for (const target of ['middleware', 'resolver']) {
      let saves = 0, creates = 0, lookups = 0, nextCalls = 0;
      const payload = { type: 'customer', id: 'binding', tenantId: 'tenant', channelId: 'channel', ...(mode === 'guest' ? { identity: 'guest' } : {}) };
      const binding = { _id: 'binding', tenantId: 'tenant', channelId: 'channel', identityType: mode === 'guest-binding' || mode === 'guest' ? 'guest' : 'customer', status: 'active', blocked: false, phone: 'test-phone', password: 'old-hash', save: async () => { saves++; } };
      const account = { _id: 'account', status: 'active', password: ['match', 'create'].includes(mode) ? 'old-hash' : 'other-hash' };
      const customerModel = {
        findById: async () => binding,
        findOne: filter => query(Object.entries(filter).every(([key, value]) => value === null ? binding[key] == null : binding[key] === value) ? binding : null),
      };
      const accountModel = {
        findOne: filter => {
          lookups++;
          if (filter.phone && (mode === 'create' || mode === 'race') && lookups === 1) return query(null);
          return query(account);
        },
        create: async data => { creates++; if (mode === 'race') throw Object.assign(new Error('duplicate'), { code: 11000 }); return { ...data, _id: 'account' }; },
      };
      const mocks = { '../models/Customer': customerModel, '../models/CustomerAccount': accountModel,
        '../models/Channel': { findOne: () => query({ _id: 'channel' }) },
        '../models/Tenant': { findOne: () => query({ _id: 'tenant' }) },
      };
      if (target === 'middleware') mocks['../utils'] = { ...require('./src/utils'), verifyToken: () => payload };
      const context = loadModule(target === 'middleware' ? 'src/middleware/auth.js' : 'src/controllers/CustomerAuthController.js', mocks);
      if (target === 'middleware') {
        const res = { locals: {}, status(code) { this.http = code; return this; }, json(body) { this.body = body; return this; } };
        await context.authCustomer({ headers: { authorization: 'Bearer test' } }, res, () => { nextCalls++; });
        assert.equal(nextCalls, ['guest', 'match', 'create'].includes(mode) ? 1 : 0, `${target}/${mode}`);
        if (['mismatch', 'race'].includes(mode)) assert.equal(res.http, 401);
      } else {
        const result = await context.resolveAccount(payload);
        assert.equal(Boolean(result), ['match', 'create'].includes(mode), `${target}/${mode}`);
      }
      assert.equal(saves, ['match', 'create'].includes(mode) ? 1 : 0, `${target}/${mode} saves`);
      if (['guest', 'guest-binding'].includes(mode)) {
        assert.equal(lookups, target === 'middleware' && mode === 'guest-binding' ? 1 : 0);
        assert.equal(creates, 0);
      }
    }
  }
});

test('accept and close advance system-message timestamps without stale snapshot saves', () => {
  const source = fs.readFileSync(path.join(__dirname, 'src/controllers/ChatController.js'), 'utf8');
  const accept = source.slice(source.indexOf('  async acceptConversation('), source.indexOf('  // GET /api/tenant/conversations/:id/messages/search'));
  const close = source.slice(source.indexOf('  async closeConversation('), source.indexOf('  // ============ 客户端 ============'));

  assert.doesNotMatch(accept, /updated\.save\s*\(/);
  assert.match(accept, /status: 'active',[\s\S]*assignedAgentId: req\.user\.id,[\s\S]*acceptedAt,[\s\S]*lastMessageAt: acceptedLastMessageAt/);
  assert.match(accept, /const current = advanced \|\| await Conversation\.findOne/);
  assert.match(accept, /const summaries = await refreshConversationSummary\(current\)/);
  assert.doesNotMatch(close, /closed\.save\s*\(/);
  assert.match(close, /status: 'closed',[\s\S]*closedAt,[\s\S]*lastMessageAt: conv\.lastMessageAt/);
  assert.match(close, /if \(advanced\) \{[\s\S]*emit\('conversation\.closed'/);
  assert.match(close, /const summaries = await refreshConversationSummary\(current\)/);
});
