// 忆梦云团队开发 - 系统版本信息
const versionConfig = require('../config/version');
const { ok } = require('../utils');

class VersionController {
  async get(req, res) {
    return ok(res, {
      ...versionConfig,
      edition: process.env.APP_EDITION || versionConfig.edition,
      version: process.env.APP_VERSION || versionConfig.version,
    });
  }
}

module.exports = new VersionController();
