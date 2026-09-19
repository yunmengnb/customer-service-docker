// 忆梦云团队开发
const { query, body, validationResult } = require('express-validator');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      code: 4001,
      message: '参数校验失败',
      data: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

module.exports = { query, body, validationResult: validate };
