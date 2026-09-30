// 忆梦云团队开发
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');

const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024 * 1024;
const PROTOCOL = 'kf-migration-data-v1';

function fail(code) { const error = new Error(code); error.code = code; return error; }
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function manifestHash(manifest) {
  const unsigned = { ...manifest };
  delete unsigned.manifestHash;
  return sha256(canonicalJson(unsigned));
}
function purposeKey(secret, taskId, purpose) {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'base64url'), Buffer.from(taskId), Buffer.from(`${PROTOCOL}:${purpose}`), 32));
}
function signManifest(manifest, secret) { return crypto.createHmac('sha256', purposeKey(secret, String(manifest.taskId), 'manifest-mac')).update(canonicalJson(manifest)).digest('base64url'); }
function verifyManifest(manifest, signature, secret) { const expected = signManifest(manifest, secret); const a = Buffer.from(expected); const b = Buffer.from(String(signature)); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function encryptManifest(manifest, secret) {
  const taskId = String(manifest.taskId); const { key } = derive(secret, taskId, 'manifest', 0); const nonce = crypto.randomBytes(12); const plain = Buffer.from(canonicalJson(manifest));
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(Buffer.from(`${PROTOCOL}:${taskId}:manifest`));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { algorithm: 'aes-256-gcm', nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
function decryptManifest(envelope, taskId, secret) {
  if (!envelope || envelope.algorithm !== 'aes-256-gcm') throw fail('MANIFEST_ENVELOPE_INVALID');
  try {
    const { key } = derive(secret, taskId, 'manifest', 0); const nonce = Buffer.from(String(envelope.nonce), 'base64'); if (nonce.length !== 12) throw new Error('nonce'); const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(Buffer.from(`${PROTOCOL}:${taskId}:manifest`)); decipher.setAuthTag(Buffer.from(String(envelope.tag), 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(String(envelope.ciphertext), 'base64')), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch { throw fail('MANIFEST_GCM_INVALID'); }
}
function artifactId(value) { if (!/^[a-z][a-z0-9_-]{0,63}$/.test(String(value))) throw fail('ARTIFACT_ID_INVALID'); return String(value); }
function safeRelative(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0') || normalized.split('/').some(part => !part || part === '.' || part === '..')) throw fail('UPLOAD_PATH_UNSAFE');
  return normalized;
}
function taskRoot(root, taskId) { if (!/^[0-9a-f-]{36}$/i.test(String(taskId))) throw fail('TASK_ID_INVALID'); return path.join(path.resolve(root), taskId); }
function derive(secret, taskId, artifact, index) {
  const encKey = purposeKey(secret, taskId, 'artifact-encryption');
  const context = `${PROTOCOL}:${taskId}:${artifact}:${index}`;
  return { key: Buffer.from(crypto.hkdfSync('sha256', encKey, Buffer.from(taskId), Buffer.from(context), 32)) };
}
function decodeNonce(value) {
  const encoded = String(value || '');
  const nonce = Buffer.from(encoded, 'base64');
  if (nonce.length !== 12 || nonce.toString('base64') !== encoded) throw fail('CHUNK_NONCE_INVALID');
  return nonce;
}
function aad(taskId, artifact, index, total, plainHash, plainSize) { return Buffer.from(canonicalJson({ protocol: PROTOCOL, taskId, artifact, index, total, plainHash, plainSize })); }
async function hashFile(file) { const hash = crypto.createHash('sha256'); let size = 0; await pipeline(fs.createReadStream(file), new Transform({ transform(chunk, enc, cb) { size += chunk.length; hash.update(chunk); cb(); } })); return { sha256: hash.digest('hex'), size }; }
async function encryptChunk(input, output, options) {
  const { taskId, artifact, index, total = 1, secret, plainHash, plainSize } = options; const { key } = derive(secret, taskId, artifact, index); const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(aad(taskId, artifact, index, total, plainHash, plainSize), { plaintextLength: plainSize });
  await fs.promises.mkdir(path.dirname(output), { recursive: true, mode: 0o700 }); await pipeline(fs.createReadStream(input), cipher, fs.createWriteStream(output, { mode: 0o600, flags: 'wx' }));
  const tag = cipher.getAuthTag(); await fs.promises.appendFile(output, tag); return { ...(await hashFile(output)), tagBytes: tag.length, nonce: nonce.toString('base64') };
}
async function encryptBuffer(plain, output, options) {
  const { taskId, artifact, index, total = 1, secret } = options; const plainHash = sha256(plain); const plainSize = plain.length; const { key } = derive(secret, taskId, artifact, index); const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(aad(taskId, artifact, index, total, plainHash, plainSize), { plaintextLength: plainSize });
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  await fs.promises.mkdir(path.dirname(output), { recursive: true, mode: 0o700 }); await fs.promises.writeFile(output, encrypted, { mode: 0o600, flag: 'wx' });
  return { sha256: sha256(encrypted), size: encrypted.length, plainHash, plainSize, nonce: nonce.toString('base64') };
}
async function decryptChunk(input, output, options) {
  const stat = await fs.promises.stat(input); if (stat.size < 16) throw fail('CHUNK_GCM_INVALID');
  const handle = await fs.promises.open(input, 'r'); const tag = Buffer.alloc(16); await handle.read(tag, 0, 16, stat.size - 16); await handle.close();
  const { taskId, artifact, index, total = 1, secret, plainHash, plainSize } = options; const { key } = derive(secret, taskId, artifact, index); const nonce = decodeNonce(options.nonce);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce); decipher.setAAD(aad(taskId, artifact, index, total, plainHash, plainSize), { plaintextLength: plainSize }); decipher.setAuthTag(tag);
  await fs.promises.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  try { await pipeline(fs.createReadStream(input, { end: stat.size - 17 }), decipher, fs.createWriteStream(output, { mode: 0o600, flags: 'wx' })); } catch { await fs.promises.rm(output, { force: true }); throw fail('CHUNK_GCM_INVALID'); }
  const actual = await hashFile(output); if (actual.size !== plainSize || actual.sha256 !== plainHash) { await fs.promises.rm(output, { force: true }); throw fail('CHUNK_HASH_INVALID'); } return actual;
}
async function walkUploads(root, dir = root, list = [], seenInodes = new Set()) {
  const resolvedRoot = path.resolve(root);
  const resolvedDir = path.resolve(dir);
  if (resolvedDir !== resolvedRoot && !resolvedDir.startsWith(`${resolvedRoot}${path.sep}`)) throw fail('UPLOAD_PATH_UNSAFE');
  const entries = await fs.promises.readdir(resolvedDir, { withFileTypes: true });
  for (const entry of entries) {
    if (resolvedDir === resolvedRoot && entry.name === '.migration-private') continue;
    const full = path.join(resolvedDir, entry.name); const stat = await fs.promises.lstat(full);
    if (stat.isSymbolicLink() || stat.isCharacterDevice() || stat.isBlockDevice() || stat.isFIFO() || stat.isSocket()) throw fail('UPLOAD_SPECIAL_FILE_UNSAFE');
    if (process.platform === 'win32' && stat.isSymbolicLink()) throw fail('UPLOAD_REPARSE_UNSAFE');
    if (stat.isDirectory()) await walkUploads(resolvedRoot, full, list, seenInodes);
    else if (stat.isFile()) {
      if (stat.nlink !== 1) throw fail('UPLOAD_HARDLINK_UNSAFE');
      const inode = `${stat.dev}:${stat.ino}`; if (seenInodes.has(inode)) throw fail('UPLOAD_HARDLINK_UNSAFE'); seenInodes.add(inode);
      const relative = safeRelative(path.relative(resolvedRoot, full)); const digest = await hashFile(full); const after = await fs.promises.lstat(full);
      if (!after.isFile() || after.nlink !== 1 || after.dev !== stat.dev || after.ino !== stat.ino || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw fail('UPLOAD_CHANGED_DURING_FREEZE');
      list.push({ path: relative, size: digest.size, sha256: digest.sha256, mtimeMs: stat.mtimeMs });
    } else throw fail('UPLOAD_SPECIAL_FILE_UNSAFE');
  }
  return list.sort((a, b) => a.path.localeCompare(b.path));
}
function validateManifest(manifest) {
  if (!manifest || manifest.protocol !== PROTOCOL || manifest.version !== 1 || !/^[0-9a-f-]{36}$/i.test(manifest.taskId)) throw fail('MANIFEST_INVALID');
  if (!/^[a-f0-9]{64}$/.test(String(manifest.manifestHash || '')) || manifestHash(manifest) !== manifest.manifestHash) throw fail('MANIFEST_HASH_INVALID');
  if (!manifest.sourceInstanceId || !manifest.targetInstanceId || !manifest.schemaVersion || !/^[A-Za-z0-9_-]{1,63}$/.test(String(manifest.sourceDb || ''))) throw fail('MANIFEST_BINDING_INVALID');
  if (manifest.consistency?.method !== 'mongodump-oplog' || manifest.consistency?.readPreference !== 'primary' || manifest.consistency?.replicaSetRequired !== true) throw fail('MANIFEST_CONSISTENCY_INVALID');
  if (!Array.isArray(manifest.collections) || !manifest.collections.length || new Set(manifest.collections).size !== manifest.collections.length || manifest.collections.some(name => !/^[A-Za-z0-9_-]{1,63}$/.test(String(name)))) throw fail('MANIFEST_COLLECTIONS_INVALID');
  if (!Array.isArray(manifest.excludedCollections) || new Set(manifest.excludedCollections).size !== manifest.excludedCollections.length || manifest.excludedCollections.some(name => !/^[A-Za-z0-9_-]{1,63}$/.test(String(name)) || manifest.collections.includes(name))) throw fail('MANIFEST_COLLECTION_POLICY_INVALID');
  if (!manifest.counts || !manifest.indexes || manifest.collections.some(name => !Number.isSafeInteger(manifest.counts[name]) || manifest.counts[name] < 0 || !Array.isArray(manifest.indexes[name]) || !manifest.indexes[name].some(index => index?.name === '_id_' && index?.key?._id === 1))) throw fail('MANIFEST_SCHEMA_INVALID');
  if (!manifest.database || !Number.isSafeInteger(manifest.database.size) || manifest.database.size < 0 || !/^[a-f0-9]{64}$/.test(String(manifest.database.sha256 || ''))) throw fail('MANIFEST_DATABASE_INVALID');
  if (!Array.isArray(manifest.artifacts) || !manifest.artifacts.length) throw fail('MANIFEST_ARTIFACTS_INVALID');
  let total = 0; const nonces = new Set(); const nextByArtifact = new Map(); const offsetByArtifact = new Map();
  for (const item of manifest.artifacts) {
    artifactId(item.id);
    const next = nextByArtifact.get(item.id) || 0; const offset = offsetByArtifact.get(item.id) || 0;
    if (!Number.isSafeInteger(item.index) || item.index !== next || !Number.isSafeInteger(item.total) || item.total < 1 || item.index >= item.total || !Number.isSafeInteger(item.offset) || item.offset !== offset || !Number.isSafeInteger(item.plainSize) || item.plainSize < 0 || !Number.isSafeInteger(item.size) || item.size < 16 || item.size > MAX_CHUNK_BYTES + 16 || !/^[a-f0-9]{64}$/.test(item.sha256) || !/^[a-f0-9]{64}$/.test(item.plainHash)) throw fail('MANIFEST_ARTIFACT_INVALID');
    if (item.kind === 'upload') safeRelative(item.path); else if (item.kind !== 'database') throw fail('MANIFEST_ARTIFACT_INVALID');
    const nonce = decodeNonce(item.nonce).toString('base64'); if (nonces.has(nonce)) throw fail('MANIFEST_NONCE_REUSE'); nonces.add(nonce);
    nextByArtifact.set(item.id, next + 1); offsetByArtifact.set(item.id, offset + item.size); total += item.size;
  }
  for (const [id, count] of nextByArtifact) {
    const items = manifest.artifacts.filter(item => item.id === id);
    if (items.some(item => item.total !== count)) throw fail('MANIFEST_ARTIFACT_TOTAL_INVALID');
  }
  const databaseIds = new Set(manifest.artifacts.filter(item => item.kind === 'database').map(item => item.id));
  if (databaseIds.size !== 1) throw fail('MANIFEST_DATABASE_ARTIFACT_INVALID');
  const uploadFiles = Array.isArray(manifest.uploads?.files) ? manifest.uploads.files : [];
  const declaredUploads = new Map();
  for (const file of uploadFiles) { const relative = safeRelative(file.path); if (declaredUploads.has(relative) || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw fail('MANIFEST_UPLOADS_INVALID'); declaredUploads.set(relative, file); }
  const uploadGroups = new Map();
  for (const item of manifest.artifacts.filter(row => row.kind === 'upload')) { const relative = safeRelative(item.path); if (!declaredUploads.has(relative)) throw fail('MANIFEST_UPLOAD_ARTIFACT_INVALID'); if (!uploadGroups.has(relative)) uploadGroups.set(relative, []); uploadGroups.get(relative).push(item); }
  if (uploadGroups.size !== declaredUploads.size || [...declaredUploads.keys()].some(relative => !uploadGroups.has(relative))) throw fail('MANIFEST_UPLOAD_ARTIFACT_INVALID');
  for (const [relative, items] of uploadGroups) if (items.reduce((sum, item) => sum + item.plainSize, 0) !== declaredUploads.get(relative).size) throw fail('MANIFEST_UPLOAD_ARTIFACT_INVALID');
  if (total !== manifest.totalBytes || total > MAX_TOTAL_BYTES) throw fail('MANIFEST_QUOTA_INVALID'); return manifest;
}
async function storeChunk(root, taskId, artifact, index, buffer, expectedHash, expectedSize) {
  artifactId(artifact); if (!Number.isSafeInteger(index) || index < 0 || index > 1000000 || !Buffer.isBuffer(buffer) || buffer.length > MAX_CHUNK_BYTES + 16 || buffer.length !== expectedSize) throw fail('CHUNK_BOUNDS_INVALID');
  const temporary = path.join(taskRoot(root, taskId), `.buffer-${crypto.randomUUID()}.tmp`); await fs.promises.mkdir(path.dirname(temporary), { recursive: true, mode: 0o700 }); await fs.promises.writeFile(temporary, buffer, { mode: 0o600, flag: 'wx' });
  try { return await storeChunkFile(root, taskId, artifact, index, temporary, expectedHash, expectedSize); } finally { await fs.promises.rm(temporary, { force: true }); }
}
async function storeChunkFile(root, taskId, artifact, index, temporary, expectedHash, expectedSize) {
  artifactId(artifact); if (!Number.isSafeInteger(index) || index < 0 || index > 1000000 || !Number.isSafeInteger(expectedSize) || expectedSize < 16 || expectedSize > MAX_CHUNK_BYTES + 16 || !/^[a-f0-9]{64}$/.test(String(expectedHash))) throw fail('CHUNK_BOUNDS_INVALID');
  const value = await hashFile(temporary); if (value.size !== expectedSize || value.sha256 !== expectedHash) throw fail('CHUNK_HASH_INVALID');
  const dir = path.join(taskRoot(root, taskId), 'chunks', artifact); await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 }); const target = path.join(dir, `${index}.bin`);
  const existing = await hashFile(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing) { if (existing.sha256 === expectedHash && existing.size === expectedSize) return { idempotent: true, hash: expectedHash, size: expectedSize }; throw fail('CHUNK_CONFLICT'); }
  await fs.promises.chmod(temporary, 0o600); await fs.promises.rename(temporary, target); return { idempotent: false, hash: expectedHash, size: expectedSize };
}
function bitmap(manifest, received = []) { const set = new Set(received); return manifest.artifacts.map(item => set.has(`${item.id}:${item.index}`)); }
async function verifyReceived(root, manifest) { const received = []; let bytes = 0; for (const item of manifest.artifacts) { const file = path.join(taskRoot(root, manifest.taskId), 'chunks', artifactId(item.id), `${item.index}.bin`); const value = await hashFile(file).catch(() => null); if (value?.sha256 === item.sha256 && value.size === item.size) { received.push(`${item.id}:${item.index}`); bytes += item.size; } } return { received, bytes, complete: received.length === manifest.artifacts.length, bitmap: bitmap(manifest, received) }; }
async function assertSafeSourcePath(sourceRoot, input) {
  if (!sourceRoot) return;
  const root = path.resolve(sourceRoot);
  const target = path.resolve(input);
  if (!target.startsWith(`${root}${path.sep}`)) throw fail('UPLOAD_PATH_UNSAFE');
  const relative = safeRelative(path.relative(root, target));
  let current = root;
  for (const part of relative.split('/').slice(0, -1)) {
    current = path.join(current, part);
    const stat = await fs.promises.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('UPLOAD_PATH_UNSAFE');
  }
  const finalStat = await fs.promises.lstat(target);
  if (!finalStat.isFile() || finalStat.isSymbolicLink()) throw fail('UPLOAD_SPECIAL_FILE_UNSAFE');
}
async function splitEncryptFile(input, root, options) {
  const { taskId, artifact, secret, kind, path: relativePath, expectedFile, sourceRoot } = options; artifactId(artifact);
  const dir = path.join(taskRoot(root, taskId), 'outgoing', artifact); await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  await assertSafeSourcePath(sourceRoot, input);
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const handle = await fs.promises.open(input, fs.constants.O_RDONLY | noFollow); const artifacts = []; let index = 0; let position = 0; let encryptedOffset = 0;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) throw fail('UPLOAD_SPECIAL_FILE_UNSAFE');
    if (expectedFile && (stat.size !== expectedFile.size || stat.mtimeMs !== expectedFile.mtimeMs)) throw fail('UPLOAD_CHANGED_DURING_FREEZE');
    const total = Math.max(1, Math.ceil(stat.size / CHUNK_BYTES)); const sourceHash = crypto.createHash('sha256');
    do {
      const length = Math.min(CHUNK_BYTES, Math.max(0, stat.size - position)); const plain = Buffer.allocUnsafe(length); const read = length ? await handle.read(plain, 0, length, position) : { bytesRead: 0 }; if (length && !read.bytesRead) break;
      const bytes = plain.subarray(0, read.bytesRead); sourceHash.update(bytes); const encrypted = path.join(dir, `${index}.bin`);
      const encryptedInfo = await encryptBuffer(bytes, encrypted, { taskId, artifact, index, total, secret });
      artifacts.push({ id: artifact, index, total, offset: encryptedOffset, kind, ...(relativePath ? { path: relativePath } : {}), nonce: encryptedInfo.nonce, plainHash: encryptedInfo.plainHash, plainSize: encryptedInfo.plainSize, sha256: encryptedInfo.sha256, size: encryptedInfo.size }); position += read.bytesRead; encryptedOffset += encryptedInfo.size; index += 1;
    } while (position < stat.size);
    const after = await handle.stat(); const digest = sourceHash.digest('hex');
    if (after.dev !== stat.dev || after.ino !== stat.ino || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.nlink !== 1 || position !== stat.size || (expectedFile && digest !== expectedFile.sha256)) throw fail('UPLOAD_CHANGED_DURING_FREEZE');
  } finally { await handle.close(); }
  return artifacts;
}
async function secureRemove(target) { await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 3 }).catch(() => {}); }
module.exports = { CHUNK_BYTES, MAX_CHUNK_BYTES, MAX_TOTAL_BYTES, PROTOCOL, canonicalJson, sha256, manifestHash, signManifest, verifyManifest, encryptManifest, decryptManifest, safeRelative, taskRoot, derive, aad, hashFile, encryptChunk, encryptBuffer, decryptChunk, splitEncryptFile, walkUploads, validateManifest, storeChunk, storeChunkFile, bitmap, verifyReceived, secureRemove, fail };
