// 忆梦云团队开发 - 会话附件存储运维控制器
const { ok, error } = require('../utils');
const cleanupService = require('../services/attachmentCleanupService');

module.exports = {
  async estimate(req, res) {
    return ok(res, await cleanupService.estimate());
  },
  async cleanup(req, res) {
    const limit = req.body?.limit;
    if (limit !== undefined && (!Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 100)) {
      return error(res, '清理数量必须为1到100的整数');
    }
    const result = await cleanupService.runCleanup({ limit: Number(limit) || undefined, io: req.app.get('io') });
    return ok(res, result, result.running ? '清理任务正在运行' : '清理完成');
  },
  async status(req, res) {
    return ok(res, cleanupService.getStatus());
  },
};
