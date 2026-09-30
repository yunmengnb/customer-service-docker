// 忆梦云团队开发
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.WECHAT_CREDENTIAL_KEY = '56'.repeat(32);
process.env.WECHAT_NOTIFICATION_LINK_KEY = '57'.repeat(32);
process.env.WECHAT_PUBLIC_ORIGIN = 'https://notify.example.test';

const secrets = require('./src/services/wechatCredentialService');
const outbox = require('./src/services/wechatOutboxService');
const api = require('./src/services/wechatApiService');
const links = require('./src/services/wechatNotificationLinkService');
const Link = require('./src/models/WechatNotificationLink');
const Binding = require('./src/models/WechatIdentityBinding');
const Channel = require('./src/models/Channel');
const Conversation = require('./src/models/Conversation');
const OfficialAccount = require('./src/models/WechatOfficialAccount');
const client = require('./src/services/wechatClientService');
const customerSessions = require('./src/services/customerSessionService');
const worker = require('./src/services/wechatNotificationWorker');
const CustomerSession = require('./src/models/CustomerSession');

const ids = {
  tenant: '507f1f77bcf86cd799439101',
  official: '507f1f77bcf86cd799439102',
  channel: '507f1f77bcf86cd799439103',
  conversation: '507f1f77bcf86cd799439104',
  message: '507f1f77bcf86cd799439105',
  sender: '507f1f77bcf86cd799439106',
  recipient: '507f1f77bcf86cd799439107',
};

function account(overrides = {}) {
  return {
    _id: ids.official,
    tenantId: ids.tenant,
    appId: 'wx1234567890abcdef',
    generation: 1,
    configVersion: 4,
    credentialVersion: 2,
    isCurrent: true,
    enabled: true,
    notificationEnabled: true,
    ...overrides,
  };
}

function query(value) {
  return {
    select: async () => value,
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

function notificationRecord(overrides = {}) {
  return {
    _id: '507f1f77bcf86cd799439108',
    outboxId: '507f1f77bcf86cd799439109',
    tenantId: ids.tenant,
    officialAccountId: ids.official,
    appId: 'wx1234567890abcdef',
    generation: 1,
    configVersion: 4,
    bindingId: '507f1f77bcf86cd799439110',
    bindingVersion: 3,
    subjectType: 'customer',
    subjectId: ids.sender,
    channelId: ids.channel,
    conversationId: ids.conversation,
    messageId: ids.message,
    expiresAt: new Date(Date.now() + 3600000),
    ...overrides,
  };
}

function context() {
  return {
    account: account(),
    message: {
      _id: ids.message,
      tenantId: ids.tenant,
      conversationId: ids.conversation,
      senderType: 'customer',
      senderId: ids.sender,
    },
    conversation: {
      _id: ids.conversation,
      tenantId: ids.tenant,
      channelId: ids.channel,
      customerId: ids.sender,
      assignedAgentId: ids.recipient,
      status: 'active',
    },
  };
}

test('notification event selects only the actual assigned staff and rejects cross-scope sender', () => {
  const event = outbox.eventFor(context());
  assert.equal(event.recipientType, 'staff');
  assert.equal(String(event.recipientId), ids.recipient);
  assert.equal(String(event.channelId), ids.channel);
  assert.throws(() => outbox.eventFor({
    ...context(),
    message: { ...context().message, senderId: '507f1f77bcf86cd799439199' },
  }), /SENDER_MISMATCH/);
});

test('outbox append requires transaction and uses stable idempotency key', async () => {
  const calls = [];
  const Model = { updateOne: async (...args) => { calls.push(args); return { upsertedCount: 1 }; } };
  await assert.rejects(outbox.appendEvent(context(), null, Model), /REQUIRES_TRANSACTION/);
  const session = { inTransaction: () => true };
  await outbox.appendEvent(context(), session, Model);
  await outbox.appendEvent(context(), session, Model);
  assert.deepEqual(calls[0][0], calls[1][0]);
  assert.equal(calls[0][2].upsert, true);
  assert.equal(calls[0][2].session, session);
});

test('notification publishing rolls back by propagating outbox failure from one transaction', async () => {
  let ended = false;
  const session = {
    inTransaction: () => true,
    withTransaction: async callback => callback(),
    endSession: async () => { ended = true; },
  };
  const connection = {
    readyState: 1,
    db: { admin: () => ({ command: async () => ({ setName: 'rs0', maxWireVersion: 17, logicalSessionTimeoutMinutes: 30 }) }) },
    startSession: async () => session,
  };
  const Model = { updateOne: async () => { throw new Error('outbox unavailable'); } };
  await assert.rejects(outbox.publishWithOutbox({
    connection,
    account: account(),
    publish: async received => {
      assert.equal(received, session);
      return { message: context().message, conversation: context().conversation };
    },
  }, Model), /outbox unavailable/);
  assert.equal(ended, true);
});

test('non replica-set topology is explicitly rejected', async () => {
  const result = await outbox.transactionCapability({
    readyState: 1,
    db: { admin: () => ({ command: async () => ({ maxWireVersion: 17, logicalSessionTimeoutMinutes: 30 }) }) },
  });
  assert.deepEqual(result, { available: false, reason: 'replica_set_required' });
});

test('atomic claim supports expired lease recovery and increments attempt', async () => {
  let captured;
  const Model = { findOneAndUpdate: async (...args) => { captured = args; return { leaseId: args[1].$set.leaseId }; } };
  const now = new Date('2026-09-23T00:00:00Z');
  await outbox.claim({ now, leaseMs: 5000, Model });
  assert.equal(captured[0].$or[1].state, 'leased');
  assert.equal(captured[0].$or[1].leaseUntil.$lte, now);
  assert.equal(captured[1].$inc.attempts, 1);
  assert.equal(captured[1].$set.leaseUntil.getTime(), now.getTime() + 5000);
  assert.equal(captured[2].new, true);
});

test('settle distinguishes retry, unknown and exhausted dead states', async () => {
  const updates = [];
  const Model = { updateOne: async (...args) => { updates.push(args); return { modifiedCount: 1 }; } };
  const base = { _id: ids.message, leaseId: 'lease', attempts: 1, maxAttempts: 2 };
  await outbox.settle(base, { state: 'retry', code: 'temporary' }, { Model, now: new Date(0) });
  await outbox.settle(base, { state: 'unknown', code: 'transport_unknown' }, { Model });
  await outbox.settle({ ...base, attempts: 2 }, { state: 'retry', code: 'temporary' }, { Model });
  assert.equal(updates[0][1].$set.state, 'pending');
  assert.equal(updates[1][1].$set.state, 'unknown');
  assert.equal(updates[2][1].$set.state, 'dead');
});

test('opaque notification reference is stable per outbox, contains no identity, and duplicate insert races reuse it', async () => {
  const item = {
    _id: '507f1f77bcf86cd799439109',
    tenantId: ids.tenant,
    officialAccountId: ids.official,
    appId: 'wx1234567890abcdef',
    generation: 1,
    configVersion: 4,
    channelId: ids.channel,
    conversationId: ids.conversation,
    messageId: ids.message,
  };
  const binding = {
    _id: '507f1f77bcf86cd799439110',
    version: 3,
    subjectType: 'customer',
    subjectId: ids.sender,
  };
  let stored = null;
  let creates = 0;
  const Model = {
    findOne: () => query(stored),
    create: async values => {
      creates++;
      if (creates === 1) {
        stored = { ...values, _id: 'link' };
        const error = new Error('duplicate');
        error.code = 11000;
        throw error;
      }
      return values;
    },
  };
  const result = await links.ensure(item, account(), binding, { Model });
  assert.equal(result.reference.length, 64);
  assert.equal(stored.referenceHash, links.digest(result.reference));
  const url = links.publicUrl(result.reference);
  assert.equal(new URL(url).search, '');
  for (const secret of [ids.tenant, ids.sender, ids.conversation, 'openid', 'jwt']) {
    assert.equal(url.includes(secret), false);
  }
  assert.equal((await links.ensure(item, account(), binding, { Model })).reference, result.reference);
  await assert.rejects(links.ensure(item, account({ configVersion: 5 }), binding, { Model }), /ACCOUNT_SCOPE_INVALID/);
});

test('unknown, guessed and expired notification references fail closed without relying on TTL cleanup', async () => {
  const valid = links.referenceFor('507f1f77bcf86cd799439109');
  const Model = {
    findOne: filter => Promise.resolve(
      filter.referenceHash === links.digest(valid)
        ? notificationRecord({ expiresAt: new Date(Date.now() - 1) })
        : null
    ),
  };
  assert.equal(await links.resolveReference('z'.repeat(64), { Model }), null);
  assert.equal(await links.resolveReference('f'.repeat(64), { Model }), null);
  const expired = await links.resolveReference(valid, {
    Model: {
      findOne: filter => Promise.resolve(
        filter.referenceHash === links.digest(valid)
        && notificationRecord({ expiresAt: new Date(Date.now() - 1) }).expiresAt > filter.expiresAt.$gt
          ? notificationRecord()
          : null
      ),
    },
  });
  assert.equal(expired, null);
  const filter = [];
  const checking = {
    findOne: received => {
      filter.push(received);
      return Promise.resolve(null);
    },
  };
  await links.resolveReference(valid, { Model: checking });
  assert.ok(filter[0].expiresAt.$gt instanceof Date);
  assert.deepEqual(filter[0].consumedAt, { $exists: false });
});

test('notification OAuth state is browser-bound, claimed before upstream exchange, and cannot replay or transfer OpenID', async t => {
  const reference = links.referenceFor('507f1f77bcf86cd799439109');
  let row = notificationRecord({
    referenceHash: links.digest(reference),
  });
  const apply = update => {
    Object.assign(row, update.$set || {});
    for (const key of Object.keys(update.$unset || {})) delete row[key];
  };
  const Model = {
    findOne: filter => Promise.resolve(
      filter.referenceHash === row.referenceHash
      && !row.consumedAt
      && row.expiresAt > new Date()
        ? { ...row }
        : null
    ),
    findOneAndUpdate: async (filter, update) => {
      let matches = false;
      if (filter._id === row._id && filter.$or) {
        matches = !row.oauthStateHash || row.oauthExpiresAt <= new Date();
      } else if (filter.oauthStateHash) {
        matches = filter.oauthStateHash === row.oauthStateHash
          && filter.browserProofHash === row.browserProofHash
          && !row.oauthClaimedAt
          && row.oauthExpiresAt > new Date();
      } else if (filter._id === row._id && filter.oauthClaimedAt) {
        matches = +filter.oauthClaimedAt === +row.oauthClaimedAt && !row.consumedAt;
      }
      if (!matches) return null;
      apply(update);
      return { ...row };
    },
  };
  t.mock.method(OfficialAccount, 'findOne', () => query({
    ...account(),
    loginEnabled: true,
    credentialCipher: {},
  }));
  t.mock.method(Binding, 'findOne', filter => Promise.resolve(
    filter.openIdHash === client.openHash(account(), 'openid-A')
      ? { _id: row.bindingId }
      : null
  ));
  t.mock.method(Channel, 'findOne', async () => ({ _id: ids.channel, publicToken: 'channel_public_token_1234' }));
  t.mock.method(Conversation, 'findOne', async () => ({
    _id: ids.conversation,
    customerId: ids.sender,
    status: 'active',
  }));
  t.mock.method(client, 'validSubject', async () => ({
    binding: { _id: ids.sender, identityType: 'customer' },
    account: { _id: 'customer-account', status: 'active' },
  }));

  assert.equal(await links.validateTarget(row, account(), 'openid-B'), null);

  const started = await links.authorize(reference, undefined, { Model });
  const state = new URL(started.authorizationUrl).searchParams.get('state');
  let upstreamCalls = 0;
  await assert.rejects(links.complete({
    state,
    code: 'mock-code',
    browserProof: 'f'.repeat(64),
    Model,
    fetcher: async () => { upstreamCalls++; },
  }), /STATE_INVALID/);
  assert.equal(upstreamCalls, 0);

  t.mock.method(api, 'exchangeOAuthCode', async () => {
    upstreamCalls++;
    assert.equal(row.oauthStateHash, undefined);
    return { openId: 'openid-A' };
  });
  const completed = await links.complete({
    state,
    code: 'mock-code',
    browserProof: started.browserProof,
    Model,
  });
  assert.equal(completed.exchangeProof.length, 64);
  assert.equal(upstreamCalls, 1);
  await assert.rejects(links.complete({
    state,
    code: 'mock-code',
    browserProof: started.browserProof,
    Model,
  }), /STATE_INVALID/);
  assert.equal(upstreamCalls, 1);
});

test('notification link failures retry transient storage errors but stop on permanent configuration errors', () => {
  assert.deepEqual(
    worker.notificationLinkFailure(new Error('temporary database timeout')),
    { state: 'retry', code: 'notification_link_unavailable' }
  );
  assert.deepEqual(
    worker.notificationLinkFailure(new Error('WECHAT_NOTIFICATION_LINK_KEY_UNAVAILABLE')),
    { state: 'dead', permanent: true, code: 'notification_link_invalid' }
  );
  assert.deepEqual(
    worker.notificationLinkFailure(new Error('WECHAT_NOTIFICATION_ACCOUNT_SCOPE_INVALID')),
    { state: 'dead', permanent: true, code: 'notification_link_invalid' }
  );
});

test('notification target rejects binding, channel, conversation and visitor scope changes', async t => {
  const record = notificationRecord();
  const configured = account();
  let bindingAvailable = true;
  let channelAvailable = true;
  let conversation = {
    _id: ids.conversation,
    customerId: ids.sender,
    status: 'active',
  };
  let subjectAvailable = true;

  t.mock.method(Binding, 'findOne', filter => Promise.resolve(
    bindingAvailable
    && filter.version === record.bindingVersion
    && filter.tenantId === record.tenantId
      ? { _id: record.bindingId }
      : null
  ));
  t.mock.method(Channel, 'findOne', async () => channelAvailable
    ? { _id: ids.channel, publicToken: 'channel_public_token_1234' }
    : null);
  t.mock.method(Conversation, 'findOne', async () => conversation);
  t.mock.method(client, 'validSubject', async scope => subjectAvailable
    && scope.conversationId === record.conversationId
      ? {
          binding: { _id: ids.sender, identityType: 'customer' },
          account: { _id: 'customer-account', status: 'active' },
        }
      : null);

  assert.ok(await links.validateTarget(record, configured, 'openid-A'));
  bindingAvailable = false;
  assert.equal(await links.validateTarget(record, configured, 'openid-A'), null);
  bindingAvailable = true;
  channelAvailable = false;
  assert.equal(await links.validateTarget(record, configured, 'openid-A'), null);
  channelAvailable = true;
  conversation = null;
  assert.equal(await links.validateTarget(record, configured, 'openid-A'), null);
  conversation = { _id: ids.conversation, customerId: ids.recipient, status: 'active' };
  assert.equal(await links.validateTarget(record, configured, 'openid-A'), null);
  conversation = { _id: ids.conversation, customerId: ids.sender, status: 'active' };
  subjectAvailable = false;
  assert.equal(await links.validateTarget(record, configured, 'openid-A'), null);

  const visitor = notificationRecord({ subjectType: 'visitor' });
  subjectAvailable = true;
  t.mock.restoreAll();
  t.mock.method(Binding, 'findOne', () => Promise.resolve({ _id: visitor.bindingId }));
  t.mock.method(Channel, 'findOne', async () => ({ _id: ids.channel }));
  t.mock.method(Conversation, 'findOne', async () => ({
    _id: ids.conversation,
    customerId: ids.sender,
    status: 'active',
  }));
  t.mock.method(client, 'validSubject', async scope =>
    scope.conversationId === ids.conversation
      ? { binding: { _id: ids.sender, identityType: 'guest' }, account: null }
      : null);
  assert.equal(
    await links.validateTarget(
      { ...visitor, conversationId: '507f1f77bcf86cd799439199' },
      configured,
      'openid-A'
    ),
    null
  );
});

test('notification exchange is single-use and revokes a raced session', async t => {
  const proof = 'c'.repeat(64);
  const configured = account();
  const binding = {
    _id: '507f1f77bcf86cd799439110',
    tenantId: ids.tenant,
    officialAccountId: ids.official,
    appId: configured.appId,
    generation: configured.generation,
    subjectType: 'customer',
    subjectId: ids.sender,
    channelId: ids.channel,
    conversationId: ids.conversation,
    version: 3,
    status: 'active',
    openIdCipher: {},
  };
  let record = notificationRecord({
    exchangeProofHash: links.digest(proof),
    exchangeExpiresAt: new Date(Date.now() + 60000),
    verifiedAt: new Date(),
  });
  let consumeWins = true;
  let revoked = null;
  const Model = {
    findOne: async filter => !record.consumedAt
      && filter.exchangeProofHash === record.exchangeProofHash
        ? { ...record }
        : null,
    findOneAndUpdate: async (filter, update) => {
      if (!consumeWins || record.consumedAt || filter.exchangeProofHash !== record.exchangeProofHash) return null;
      record = { ...record, ...update.$set };
      return { ...record };
    },
  };
  t.mock.method(OfficialAccount, 'findOne', () => query({ ...configured, credentialCipher: {} }));
  t.mock.method(Binding, 'findOne', () => query(binding));
  t.mock.method(Channel, 'findOne', async () => ({ _id: ids.channel, publicToken: 'channel_public_token_1234' }));
  t.mock.method(Conversation, 'findOne', async () => ({
    _id: ids.conversation,
    customerId: ids.sender,
    status: 'active',
  }));
  t.mock.method(client, 'validSubject', async () => ({
    binding: { _id: ids.sender, identityType: 'customer' },
    account: { _id: 'customer-account', status: 'active' },
  }));
  t.mock.method(secrets, 'open', () => 'openid-A');
  t.mock.method(customerSessions, 'createSessionAndToken', async () => ({
    session: { _id: '507f1f77bcf86cd799439188' },
    token: 'persistent-sid-token',
  }));
  t.mock.method(CustomerSession, 'updateOne', async (...args) => {
    revoked = args;
    return { modifiedCount: 1 };
  });

  const result = await links.exchange({ proof, req: {}, Model });
  assert.equal(result.token, 'persistent-sid-token');
  assert.equal(result.channelPublicToken, 'channel_public_token_1234');
  await assert.rejects(links.exchange({ proof, req: {}, Model }), /EXCHANGE_INVALID/);

  record = notificationRecord({
    exchangeProofHash: links.digest(proof),
    exchangeExpiresAt: new Date(Date.now() + 60000),
    verifiedAt: new Date(),
  });
  consumeWins = false;
  await assert.rejects(links.exchange({ proof, req: {}, Model }), /REPLAY/);
  assert.equal(revoked[0]._id, '507f1f77bcf86cd799439188');
  assert.equal(revoked[1].$set.revokeReason, '微信通知链接兑换冲突');
});

test('template API uses fixed host, cached token and sanitized unknown outcome', async () => {
  const configured = account();
  const contextKey = api.cacheContext(configured);
  const slot = require('crypto').createHash('sha256').update(contextKey).digest('hex');
  const tokenKey = `wechat:token:{${slot}}`;
  const encrypted = JSON.stringify(secrets.seal('private-access-token', `wechat-access-token:${contextKey}`));
  const redis = { get: async key => key === tokenKey ? encrypted : null };
  let request;
  const result = await api.sendTemplateMessage(configured, {
    toUser: 'openid_mock',
    templateId: 'template_mock',
    url: 'https://notify.example.test/api/wechat/notification/open/' + 'a'.repeat(64),
    data: { first: { value: '新消息' } },
  }, {
    redis,
    fetcher: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ errcode: 0, msgid: 12345 }) };
    },
  });
  assert.match(request.url, /^https:\/\/api\.weixin\.qq\.com\/cgi-bin\/message\/template\/send\?/);
  assert.equal(request.options.redirect, 'error');
  assert.equal(result.messageId, '12345');
  await assert.rejects(api.sendTemplateMessage(configured, {
    toUser: 'openid_mock', templateId: 'template_mock', url: 'https://notify.example.test/api/wechat/notification/open/' + 'b'.repeat(64), data: { first: { value: 'x' } },
  }, { redis, fetcher: async () => { throw new Error('leaked private-access-token'); } }), error => error.message === 'WECHAT_SEND_UNKNOWN');
});
