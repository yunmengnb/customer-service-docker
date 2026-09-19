// 忆梦云团队开发
const { error } = require('../utils');

const objectId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const invalid = (res, message) => error(res, message, 4001, 400);

// 仅用于消息入口，不改变其他接口的兼容类型转换或未知字段策略。
function messageBody(req, res, next) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid(res, '消息参数须为对象');
  for (const field of ['content', 'messageType', 'attachmentUrl', 'attachmentName', 'thumbnailUrl']) {
    if (body[field] !== undefined && typeof body[field] !== 'string') return invalid(res, `${field}须为字符串`);
  }
  if (typeof body.clientMessageId !== 'string' || !body.clientMessageId.trim() || body.clientMessageId.trim().length > 128) {
    return invalid(res, 'clientMessageId须为1-128位非空字符串');
  }
  if (body.attachmentId !== undefined && !objectId(body.attachmentId)) return invalid(res, '附件 ID 无效');
  // 未识别的字符串 messageType 仍由原控制器兼容回落为 text。
  next();
}

function messageHistory(modes) {
  return (req, res, next) => {
    const query = req.query || {};
    const supplied = ['before', 'after', 'around'].filter(key => query[key] !== undefined);
    if (supplied.length > 1) return invalid(res, 'before、after、around不能同时使用');
    for (const key of supplied) {
      if (!modes.includes(key)) return invalid(res, `${key}不受此接口支持`);
      if (!objectId(query[key])) return invalid(res, '无效的分页游标');
    }
    if (query.limit !== undefined) {
      const value = query.limit;
      if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
        return invalid(res, 'limit须为正安全整数');
      }
      // 保留各控制器原有的默认条数及最大条数截断。
    }
    next();
  };
}

module.exports = { messageBody, messageHistory };
