// 忆梦云团队开发
const nodemailer = require('nodemailer');
const { getSystemSettings } = require('./systemSettings');

// #region debug-point A-D:mailer-network-stages
const reportMailerDebug = (msg, data) => fetch('http://email-debug:7777/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'email-verification', runId: 'pre-fix', hypothesisId: 'A-D', location: 'server/src/utils/mailer.js:sendMail', msg: `[DEBUG] ${msg}`, data, ts: Date.now() }) }).catch(() => {});
// #endregion

async function sendMail({ to, subject, text, html }) {
  const settings = await getSystemSettings();
  const smtp = settings.smtp;
  // #region debug-point A:settings-loaded
  const hostCategory = !smtp.host ? 'unconfigured' : /aliyun/i.test(smtp.host) ? 'aliyun' : /qq\.com$/i.test(smtp.host) ? 'qq' : /163\.com$/i.test(smtp.host) ? '163' : /gmail/i.test(smtp.host) ? 'gmail' : /outlook|office365/i.test(smtp.host) ? 'microsoft' : 'custom';
  reportMailerDebug('settings-loaded', { hostCategory, port: smtp.port, secure: smtp.secure, enabled: smtp.enabled, authConfigured: Boolean(smtp.username && smtp.password), fromConfigured: Boolean(smtp.fromEmail) });
  // #endregion
  if (!smtp.enabled || !smtp.host || !smtp.fromEmail) {
    // #region debug-point A:config-incomplete
    reportMailerDebug('config-incomplete', { hostCategory, port: smtp.port, secure: smtp.secure, enabled: smtp.enabled, authConfigured: Boolean(smtp.username && smtp.password), fromConfigured: Boolean(smtp.fromEmail) });
    // #endregion
    return false;
  }

  // #region debug-point B:create-transport
  reportMailerDebug('create-transport', { hostCategory, port: smtp.port, secure: smtp.secure, enabled: smtp.enabled, authConfigured: Boolean(smtp.username && smtp.password), fromConfigured: Boolean(smtp.fromEmail) });
  // #endregion
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
  });
  try {
    // #region debug-point B-D:send-start
    reportMailerDebug('send-start', { hostCategory, port: smtp.port, secure: smtp.secure, enabled: smtp.enabled, authConfigured: Boolean(smtp.username && smtp.password), fromConfigured: Boolean(smtp.fromEmail) });
    // #endregion
    await transporter.sendMail({
      from: smtp.fromName ? `"${smtp.fromName.replace(/["\r\n]/g, '')}" <${smtp.fromEmail}>` : smtp.fromEmail,
      to,
      subject,
      text,
      html,
    });
    // #region debug-point D:send-success
    reportMailerDebug('send-success', { hostCategory, port: smtp.port, secure: smtp.secure, enabled: smtp.enabled, authConfigured: Boolean(smtp.username && smtp.password), fromConfigured: Boolean(smtp.fromEmail) });
    // #endregion
  } catch (err) {
    // #region debug-point B-C:send-failed
    reportMailerDebug('send-failed', { hostCategory, port: smtp.port, secure: smtp.secure, enabled: smtp.enabled, authConfigured: Boolean(smtp.username && smtp.password), fromConfigured: Boolean(smtp.fromEmail), error: { name: err?.name, code: err?.code, command: err?.command, responseCode: err?.responseCode, message: err?.message } });
    // #endregion
    throw err;
  }
  return true;
}

module.exports = { sendMail };
