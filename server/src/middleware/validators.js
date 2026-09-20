// 忆梦云团队开发
const { body } = require('express-validator');

function hasReplyPayload(value, { req }) {
  if (String(value || '').trim() || String(req.body.imageUrl || '').trim()) return true;
  throw new Error('回复内容和图片至少填写一项');
}

const { validationResult: validate } = require('./validate');

// 管理员登录校验
const adminLogin = [
  body('username').trim().notEmpty().withMessage('用户名不能为空'),
  body('password').notEmpty().withMessage('密码不能为空').isLength({ min: 6 }).withMessage('密码至少6位'),
  validate,
];

const createAnnouncement = [
  body('title').trim().notEmpty().withMessage('公告标题不能为空').isLength({ max: 200 }).withMessage('公告标题不能超过200字'),
  body('content').trim().notEmpty().withMessage('公告内容不能为空'),
  body('appType').optional().isIn(['staff', 'customer']).withMessage('APP 类型无效'),
  body('status').optional().isIn(['draft', 'published']).withMessage('公告状态无效'),
  validate,
];

const updateAnnouncement = [
  body('title').trim().notEmpty().withMessage('公告标题不能为空').isLength({ max: 200 }).withMessage('公告标题不能超过200字'),
  body('content').trim().notEmpty().withMessage('公告内容不能为空'),
  body('appType').optional().isIn(['staff', 'customer']).withMessage('APP 类型无效'),
  body('status').optional().isIn(['draft', 'published']).withMessage('公告状态无效'),
  validate,
];

const updateAnnouncementStatus = [
  body('status').isIn(['draft', 'published']).withMessage('公告状态无效'),
  validate,
];

const appVersion = [
  body('appType').optional().isIn(['staff', 'customer']).withMessage('APP 类型无效'),
  body('versionCode').isInt({ min: 1 }).withMessage('版本号必须为正整数').toInt(),
  body('versionName').trim().notEmpty().withMessage('版本名称不能为空').isLength({ max: 50 }).withMessage('版本名称不能超过50字'),
  body('downloadUrl').trim().notEmpty().withMessage('下载地址不能为空').isURL({ protocols: ['http', 'https'], require_protocol: true }).withMessage('下载地址格式无效'),
  body('releaseNotes').optional({ nullable: true }).isString().withMessage('更新说明格式无效'),
  body('forceUpdate').optional().isBoolean().withMessage('强制更新标记无效').toBoolean(),
  body('downloadEnabled').optional().isBoolean().withMessage('下载开关无效').toBoolean(),
  body('minSupportedVersionCode').optional().isInt({ min: 1 }).withMessage('最低支持版本号必须为正整数').toInt(),
  body('status').optional().isIn(['draft', 'published']).withMessage('版本状态无效'),
  validate,
];

// 租户注册
const tenantRegister = [
  body('name').trim().notEmpty().withMessage('企业名称不能为空'),
  body('username').trim().notEmpty().withMessage('用户名不能为空').isLength({ min: 3 }).withMessage('用户名至少3位'),
  body('password').isString().isLength({ min: 6, max: 72 }).withMessage('密码须为6-72位'),
  body('confirmPassword').isString().notEmpty().withMessage('请再次输入密码').custom((value, { req }) => {
    if (value !== req.body.password) throw new Error('两次输入的密码不一致');
    return true;
  }),
  body('email').trim().normalizeEmail().isEmail().withMessage('邮箱格式不正确'),
  body('emailCode').optional({ checkFalsy: true }).trim().matches(/^\d{6}$/).withMessage('请输入6位邮箱验证码'),
  validate,
];

const emailCode = [
  body('email').trim().normalizeEmail().isEmail().withMessage('邮箱格式不正确'),
  validate,
];

const resetPassword = [
  body('email').trim().normalizeEmail().isEmail().withMessage('邮箱格式不正确'),
  body('emailCode').trim().matches(/^\d{6}$/).withMessage('请输入6位邮箱验证码'),
  body('newPassword').isString().isLength({ min: 6, max: 72 }).withMessage('新密码须为6-72位'),
  body('confirmPassword').custom((value, { req }) => value === req.body.newPassword).withMessage('两次输入的新密码不一致'),
  validate,
];

const customerResetCode = [
  body('phone').trim().matches(/^[\d\s+-]{6,20}$/).withMessage('手机号格式不正确'),
  body('email').trim().normalizeEmail().isEmail().withMessage('邮箱格式不正确'),
  validate,
];

const customerResetPassword = [
  body('phone').trim().matches(/^[\d\s+-]{6,20}$/).withMessage('手机号格式不正确'),
  ...resetPassword.slice(0, -1),
  validate,
];

const tenantProfileCode = [
  body('purpose').isIn(['change-email', 'change-password']).withMessage('验证码用途无效'),
  body('email').if(body('purpose').equals('change-email')).trim().normalizeEmail().isEmail().withMessage('邮箱格式不正确'),
  validate,
];

const tenantEmail = [
  body('email').trim().normalizeEmail().isEmail().withMessage('邮箱格式不正确'),
  body('emailCode').trim().matches(/^\d{6}$/).withMessage('请输入6位邮箱验证码'),
  validate,
];

const tenantPassword = [
  body('currentPassword').isString().notEmpty().withMessage('请输入当前密码'),
  body('emailCode').trim().matches(/^\d{6}$/).withMessage('请输入6位邮箱验证码'),
  body('newPassword').isString().isLength({ min: 6, max: 72 }).withMessage('新密码须为6-72位'),
  body('confirmPassword').custom((value, { req }) => value === req.body.newPassword).withMessage('两次输入的新密码不一致'),
  validate,
];

// 租户用户登录
const tenantLogin = [
  body('username').trim().notEmpty().withMessage('用户名或邮箱不能为空'),
  body('password').notEmpty().withMessage('密码不能为空'),
  body('tenant').optional({ checkFalsy: true }).trim().isLength({ max: 100 }).withMessage('租户标识格式不正确'),
  validate,
];

// 字符串类型必须在 trim 之前验证，避免数组/数字被隐式转换。
function employeeFields(partial = false) {
  return [
    ...[['username', 3, 50], ['displayName', 1, 50]].map(([field, min, max]) => {
      const chain = body(field);
      if (partial) chain.optional();
      return chain.isString().bail().trim().isLength({ min, max });
    }),
    body('email').optional({ values: 'falsy' }).isString().bail().trim().normalizeEmail().isEmail().withMessage('邮箱格式不正确'),
    body('role').optional().isString().bail().isIn(['admin', 'agent']),
    body('status').optional().isString().bail().isIn(['active', 'disabled']),
    body('avatarUrl').optional().isString(),
  ];
}
const createAgent = [
  ...employeeFields(),
  body('password').isString().bail().isLength({ min: 6, max: 72 }),
  validate,
];
const updateAgent = [...employeeFields(true), validate];

// 访客进入/恢复
const customerGuest = [
  body('fingerprint').isString().trim().isLength({ min: 8, max: 2048 }).withMessage('访客指纹无效'),
  validate,
];

// 客户登录
const customerLogin = [
  body('identifier').trim().notEmpty().withMessage('请输入手机号或邮箱').custom(value => {
    if (/^\S+@\S+\.\S+$/.test(value) || /^[\d\s+-]{6,20}$/.test(value)) return true;
    throw new Error('手机号或邮箱格式不正确');
  }),
  body('password').notEmpty().withMessage('密码不能为空'),
  body('fingerprint').optional().isString(),
  validate,
];

// 客户注册验证码
const customerRegisterCode = [
  body('email').trim().normalizeEmail().isEmail().withMessage('邮箱格式不正确'),
  validate,
];

// 客户注册
const customerRegister = [
  body('phone').trim().matches(/^[\d\s+-]{6,20}$/).withMessage('手机号格式不正确'),
  body('qq').trim().matches(/^[1-9]\d{4,11}$/).withMessage('QQ号格式不正确'),
  body('email').trim().normalizeEmail().isEmail().withMessage('邮箱格式不正确'),
  body('password').isString().isLength({ min: 6, max: 72 }).withMessage('密码须为6-72位'),
  body('confirmPassword').isString().custom((value, { req }) => {
    if (value !== req.body.password) throw new Error('两次输入的密码不一致');
    return true;
  }),
  body('emailCode').optional({ checkFalsy: true }).trim().matches(/^\d{6}$/).withMessage('请输入6位邮箱验证码'),
  body('fingerprint').optional().isString(),
  body('agreementAccepted').custom(value => value === true).withMessage('请先阅读并同意免责协议和使用协议'),
  validate,
];

// 客户完善 QQ
const customerQQ = [
  body('qq').trim().matches(/^[1-9]\d{4,11}$/).withMessage('QQ号格式不正确'),
  validate,
];

// 客户修改密码
const customerPassword = [
  body('currentPassword').isString().notEmpty().withMessage('请输入当前密码'),
  body('emailCode').trim().matches(/^\d{6}$/).withMessage('请输入6位邮箱验证码'),
  body('newPassword').isString().isLength({ min: 6, max: 72 }).withMessage('新密码须为6-72位'),
  body('confirmPassword').isString().notEmpty().withMessage('请再次输入新密码').custom((value, { req }) => {
    if (value !== req.body.newPassword) throw new Error('两次输入的新密码不一致');
    return true;
  }),
  validate,
];

// 创建渠道
const createChannel = [
  body('name').trim().notEmpty().withMessage('渠道名称不能为空').isLength({ max: 50 }),
  body('brandName').optional().isString().isLength({ max: 50 }),
  body('brandColor').optional().isString(),
  body('welcomeMessage').optional().isString().isLength({ max: 500 }),
  validate,
];

// PATCH 只校验提交字段；合并后的正文/图片非空由控制器校验。
function replyFields(keyword, partial = false) {
  const title = body(keyword ? 'keyword' : 'title');
  if (partial) title.optional();
  return [
    title.isString().bail().trim().isLength({ min: 1, max: keyword ? 100 : 50 }),
    body(keyword ? 'replyContent' : 'content').optional().isString().bail().isLength({ max: 500 }),
    body('imageUrl').optional().isString(),
    body('imageName').optional().isString().bail().isLength({ max: 255 }),
    body('status').optional().isString().bail().isIn(['active', 'disabled']),
    body(keyword ? 'priority' : 'sortOrder').optional().custom(Number.isSafeInteger),
    ...(keyword ? [body('matchType').optional().isString().bail().isIn(['exact', 'contains'])] : []),
  ];
}
const updateKeywordReply = [...replyFields(true, true), validate];
const updateQuickReply = [...replyFields(false, true), validate];

// 关键词回复
const keywordReply = [
  body('keyword').trim().notEmpty().withMessage('关键词不能为空').isLength({ max: 100 }),
  body('matchType').optional().isIn(['exact', 'contains']),
  body('replyContent').optional({ nullable: true }).isString().isLength({ max: 500 }).custom(hasReplyPayload),
  body('imageUrl').optional({ checkFalsy: true }).isString(),
  body('imageName').optional({ nullable: true }).isString().isLength({ max: 255 }),
  validate,
];

// 快捷回复
const quickReply = [
  body('title').trim().notEmpty().withMessage('标题不能为空').isLength({ max: 50 }),
  body('content').optional({ nullable: true }).isString().isLength({ max: 500 }).custom(hasReplyPayload),
  body('imageUrl').optional({ checkFalsy: true }).isString(),
  body('imageName').optional({ nullable: true }).isString().isLength({ max: 255 }),
  validate,
];

module.exports = {
  adminLogin,
  createAnnouncement,
  updateAnnouncement,
  updateAnnouncementStatus,
  appVersion,
  tenantRegister,
  tenantLogin,
  emailCode,
  resetPassword,
  customerResetCode,
  customerResetPassword,
  tenantProfileCode,
  tenantEmail,
  tenantPassword,
  createAgent,
  updateAgent,
  customerGuest,
  customerLogin,
  customerRegisterCode,
  customerRegister,
  customerQQ,
  customerPassword,
  createChannel,
  keywordReply,
  quickReply,
  updateKeywordReply,
  updateQuickReply,
};