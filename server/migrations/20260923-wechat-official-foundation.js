// 忆梦云团队开发
// 显式传入已连接的隔离/目标数据库；不读取 .env，不自动连接或删除索引。
async function up(connection) {
  const names = ['WechatOfficialAccount', 'WechatFollower', 'WechatCallbackReceipt', 'WechatAuthChallenge', 'WechatIdentityBinding', 'WechatNotificationOutbox', 'WechatNotificationLink', 'WechatNotificationDeliveryLog', 'CustomerSession', 'TenantUserSession', 'TenantUserLoginKey'];
  for (const name of names) {
    const source = require(`../src/models/${name}`);
    const model = connection.models[name] || connection.model(name, source.schema, source.collection.name);
    await model.createCollection();
    await model.createIndexes();
  }
}
module.exports = { up };
