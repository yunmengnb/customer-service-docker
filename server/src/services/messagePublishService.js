// 忆梦云团队开发
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Account = require('../models/WechatOfficialAccount');
const { createMessageWithAttachment } = require('./conversationAttachmentService');
const { publishWithOutbox } = require('./wechatOutboxService');

async function currentAccount(tenantId) {
  return Account.findOne({ tenantId, isCurrent: true });
}

async function publish({ account, messageData, attachment, updateConversation }) {
  const officialAccount = account === undefined
    ? await currentAccount(messageData.tenantId)
    : account;

  return publishWithOutbox({
    connection: mongoose.connection,
    account: officialAccount,
    publish: async session => {
      const message = await createMessageWithAttachment(messageData, attachment, { session });
      const conversation = await updateConversation(message, session);
      if (!conversation) throw new Error('CONVERSATION_STATE_CHANGED');
      return { message, conversation };
    },
  });
}

function agentConversationUpdate(scope) {
  return (message, session) => Conversation.findOneAndUpdate(scope, {
    $set: { lastMessageAt: message.createdAt },
  }, { new: true, session });
}

function customerConversationUpdate(scope) {
  return (message, session) => Conversation.findOneAndUpdate(scope, [{
    $set: {
      status: { $cond: [{ $eq: ['$status', 'closed'] }, 'waiting', '$status'] },
      assignedAgentId: { $cond: [{ $eq: ['$status', 'closed'] }, null, '$assignedAgentId'] },
      acceptedAt: { $cond: [{ $eq: ['$status', 'closed'] }, '$$REMOVE', '$acceptedAt'] },
      closedAt: { $cond: [{ $eq: ['$status', 'closed'] }, '$$REMOVE', '$closedAt'] },
      lastMessageAt: message.createdAt,
    },
  }], { new: true, updatePipeline: true, session });
}

module.exports = { publish, agentConversationUpdate, customerConversationUpdate };
