// 忆梦云团队开发
const https = require('https');
const { isPublicIp } = require('./migrationSecurity');
function request(url, pinnedIp, method, pathname, body, headers = {}, maxResponse = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const isStream = body && typeof body.pipe === 'function';
    const raw = body === undefined ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : isStream ? body : Buffer.from(JSON.stringify(body));
    const contentLength = Number(headers['Content-Length'] ?? headers['content-length'] ?? (isStream ? NaN : raw.length));
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) return reject(new Error('REQUEST_LENGTH_REQUIRED'));
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const req = https.request({ protocol: 'https:', hostname, servername: require('net').isIP(hostname) ? undefined : hostname, port: 443, path: pathname, method, rejectUnauthorized: true, timeout: 15000,
      lookup(hostname, options, callback) { if (!isPublicIp(pinnedIp)) return callback(new Error('TARGET_IP_UNSAFE')); callback(null, pinnedIp, pinnedIp.includes(':') ? 6 : 4); },
      headers: { Accept: 'application/json', 'Content-Type': Buffer.isBuffer(body) || isStream ? 'application/octet-stream' : 'application/json', 'Content-Length': contentLength, ...headers },
    }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > maxResponse) req.destroy(new Error('RESPONSE_TOO_LARGE')); else chunks.push(chunk); });
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }); } catch { reject(new Error('TARGET_RESPONSE_INVALID')); } });
    });
    req.on('timeout', () => req.destroy(new Error('TARGET_TIMEOUT'))); req.on('error', reject);
    if (isStream) { raw.on('error', error => req.destroy(error)); raw.pipe(req); }
    else { if (raw.length) req.write(raw); req.end(); }
  });
}
function requestJson(url, pinnedIp, method, pathname, body, headers = {}) { return request(url, pinnedIp, method, pathname, body, headers); }
module.exports = { request, requestJson };
