// 忆梦云团队开发
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.WECHAT_PUBLIC_ORIGIN = 'https://client.example.test';
process.env.WECHAT_CREDENTIAL_KEY = '34'.repeat(32);

const Binding = require('./src/models/WechatIdentityBinding');
const CustomerSession = require('./src/models/CustomerSession');
const Customer = require('./src/models/Customer');
const CustomerAccount = require('./src/models/CustomerAccount');
const Conversation = require('./src/models/Conversation');
const OfficialAccount = require('./src/models/WechatOfficialAccount');
const Tenant = require('./src/models/Tenant');
const client = require('./src/services/wechatClientService');
const sessions = require('./src/services/customerSessionService');
const { cookie, guard } = require('./src/routes/wechatClient');
const { verifyToken } = require('./src/utils');

const ids = {
  tenant: '507f1f77bcf86cd799439001',
  official: '507f1f77bcf86cd799439002',
  channel: '507f1f77bcf86cd799439003',
  conversation: '507f1f77bcf86cd799439004',
  subject: '507f1f77bcf86cd799439005',
  binding: '507f1f77bcf86cd799439006',
  session: '507f1f77bcf86cd799439007',
};

function query(value) {
  return {
    select: async () => value,
    sort: async () => value,
    lean: async () => value,
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

function official(overrides = {}) {
  return {
    _id: ids.official,
    tenantId: ids.tenant,
    appId: 'wx1234567890abcdef',
    generation: 1,
    configVersion: 7,
    ...overrides,
  };
}

test('client CSRF proof is same-origin, intent-bound and duplicate cookies fail closed', () => {
  const proof = 'a'.repeat(64);
  const req = {
    headers: {
      origin: process.env.WECHAT_PUBLIC_ORIGIN,
      'x-wechat-intent': 'client-v1',
    },
    is: type => type === 'application/json',
  };
  guard(req);
  assert.throws(() => guard({ ...req, headers: { ...req.headers, origin: 'https://evil.test' } }));
  assert.throws(() => guard({ ...req, headers: { origin: req.headers.origin } }));
  assert.equal(cookie({ headers: { cookie: `p=${proof}` } }, 'p'), proof);
  assert.equal(cookie({ headers: { cookie: `p=${proof}; p=${proof}` } }, 'p'), '');
});

test('visitor bindings require channel and conversation while staff scope rejects both', async () => {
  const base = {
    tenantId: ids.tenant,
    officialAccountId: ids.official,
    appId: 'wx1234567890abcdef',
    generation: 1,
    subjectId: ids.subject,
    openIdHash: 'hash',
    openIdCipher: { value: 'cipher' },
    consentedAt: new Date(),
    boundAt: new Date(),
    verifiedAt: new Date(),
  };
  await assert.rejects(new Binding({ ...base, subjectType: 'visitor', channelId: ids.channel }).validate(), /WECHAT_BINDING_SCOPE_INVALID/);
  await new Binding({ ...base, subjectType: 'visitor', channelId: ids.channel, conversationId: ids.conversation }).validate();
  await assert.rejects(new Binding({ ...base, subjectType: 'staff', channelId: ids.channel }).validate(), /WECHAT_BINDING_SCOPE_INVALID/);
});

test('customer and visitor subject validation binds tenant, channel and exact conversation', async t => {
  const seen = {};
  t.mock.method(Customer, 'findOne', filter => {
    seen.customer = filter;
    return Promise.resolve({ _id: ids.subject, accountId: ids.binding });
  });
  t.mock.method(Conversation, 'findOne', filter => {
    seen.conversation = filter;
    return query({ _id: ids.conversation });
  });
  t.mock.method(CustomerAccount, 'findOne', filter => {
    seen.account = filter;
    return Promise.resolve({ _id: ids.binding, status: 'active' });
  });

  const result = await client.validSubject({
    subjectType: 'customer',
    subjectId: ids.subject,
    tenantId: ids.tenant,
    channelId: ids.channel,
    conversationId: ids.conversation,
  });
  assert.ok(result);
  assert.equal(String(seen.customer.tenantId), ids.tenant);
  assert.equal(String(seen.customer.channelId), ids.channel);
  assert.equal(String(seen.conversation._id), ids.conversation);
  assert.equal(String(seen.conversation.customerId), ids.subject);
  assert.deepEqual(seen.customer.accountId, { $ne: null });
});

test('customer JWT has sid and visitor scope cannot be widened across conversations', async t => {
  let stored;
  t.mock.method(CustomerSession, 'create', async values => {
    stored = { ...values, _id: ids.session };
    return stored;
  });
  t.mock.method(CustomerSession, 'findOne', async () => stored);
  const customerBinding = {
    _id: ids.subject,
    accountId: null,
    tenantId: ids.tenant,
    channelId: ids.channel,
    identityType: 'guest',
  };
  const issued = await sessions.createSessionAndToken({
    req: { headers: {} },
    binding: customerBinding,
    conversationId: ids.conversation,
    loginMethod: 'guest',
  });
  const payload = verifyToken(issued.token);
  assert.equal(payload.sid, ids.session);
  assert.equal(payload.identity, 'guest');
  assert.equal(payload.conversationId, ids.conversation);
  assert.ok(await sessions.validateSession(payload, { touch: false }));
  assert.equal(await sessions.validateSession({
    ...payload,
    conversationId: '507f1f77bcf86cd799439099',
  }, { touch: false }), null);
  assert.equal(await sessions.validateSession({
    ...payload,
    channelId: '507f1f77bcf86cd799439098',
  }, { touch: false }), null);
});

test('wechat customer session continuously enforces binding version and config generation', async t => {
  const account = official();
  const binding = {
    _id: ids.binding,
    tenantId: ids.tenant,
    officialAccountId: ids.official,
    appId: account.appId,
    generation: 1,
    subjectType: 'visitor',
    subjectId: ids.subject,
    channelId: ids.channel,
    conversationId: ids.conversation,
    version: 3,
  };
  const session = {
    scopeType: 'channel',
    subjectType: 'visitor',
    subjectId: ids.subject,
    tenantId: ids.tenant,
    channelId: ids.channel,
    conversationId: ids.conversation,
    wechatBindingVersion: 3,
    wechatConfigVersion: 7,
  };
  t.mock.method(Binding, 'findOne', filter => Promise.resolve(filter.version === binding.version ? binding : null));
  t.mock.method(OfficialAccount, 'findOne', filter => query(
    filter.generation === 1 ? account : null,
  ));
  t.mock.method(Tenant, 'exists', async () => true);
  t.mock.method(Customer, 'findOne', async () => ({ _id: ids.subject, accountId: null }));
  t.mock.method(Conversation, 'findOne', () => query({ _id: ids.conversation }));

  assert.ok(await client.activeBinding(ids.binding, session));
  assert.equal(await client.activeBinding(ids.binding, { ...session, wechatBindingVersion: 2 }), null);
  assert.equal(await client.activeBinding(ids.binding, { ...session, wechatConfigVersion: 8 }), null);
});
