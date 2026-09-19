// 忆梦云团队开发
const Message = require('../models/Message');

// Message 是唯一事实源；绝不把查询快照写回 Conversation。
// 撤回保留占位及未读语义，单侧删除只影响该侧。附件落库/补偿也无需双写计数。
function unreadGroup() {
  return { $group: {
    _id: null,
    agentUnreadCount: { $sum: { $cond: [{ $and: [
      { $eq: ['$senderType', 'customer'] }, { $eq: ['$readByAgent', false] },
      { $eq: [{ $ifNull: ['$deletedForAgentAt', null] }, null] },
    ] }, 1, 0] } },
    customerUnreadCount: { $sum: { $cond: [{ $and: [
      { $in: ['$senderType', ['agent', 'bot']] }, { $eq: ['$readByCustomer', false] },
      { $eq: [{ $ifNull: ['$deletedForCustomerAt', null] }, null] },
    ] }, 1, 0] } },
  } };
}

async function conversationUnread(conv) {
  const [counts] = await Message.aggregate([
    { $match: { tenantId: conv.tenantId, conversationId: conv._id } },
    unreadGroup(),
  ]);
  return { agentUnreadCount: counts?.agentUnreadCount || 0, customerUnreadCount: counts?.customerUnreadCount || 0 };
}

// 在排序/分页之前覆盖旧数据库遗留字段，不依赖后台迁移或副本集事务。
function unreadLookup() {
  return [
    { $lookup: {
      from: Message.collection.name,
      let: { conversationId: '$_id', tenantId: '$tenantId' },
      pipeline: [
        { $match: { $expr: { $and: [
          { $eq: ['$conversationId', '$$conversationId'] }, { $eq: ['$tenantId', '$$tenantId'] },
        ] } } },
        unreadGroup(),
      ],
      as: 'unreadSummary',
    } },
    { $set: {
      agentUnreadCount: { $ifNull: [{ $arrayElemAt: ['$unreadSummary.agentUnreadCount', 0] }, 0] },
      customerUnreadCount: { $ifNull: [{ $arrayElemAt: ['$unreadSummary.customerUnreadCount', 0] }, 0] },
    } },
    { $unset: 'unreadSummary' },
  ];
}

module.exports = { conversationUnread, unreadLookup };
