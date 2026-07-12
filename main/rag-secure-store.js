const crypto = require('crypto')
const nodeFs = require('fs')
const path = require('path')
const fs = require('fs-extra')

const ENCRYPTED_STORE_VERSION = 1
const ENCRYPTED_STORE_TYPE = 'idena-rag-encrypted-store'
const DEFAULT_LOCK_TIMEOUT_MS = 5000
const DEFAULT_LOCK_RETRY_MS = 25
const DEFAULT_LOCK_STALE_MS = 120000

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function readLockNonce(lockPath) {
  try {
    const rawLock = await fs.readFile(lockPath, 'utf8')
    const lock = JSON.parse(rawLock)
    return lock && lock.nonce ? lock.nonce : ''
  } catch {
    return ''
  }
}

function normalizeEncryptionKey(encryptionKey) {
  if (!encryptionKey) {
    return null
  }

  if (Buffer.isBuffer(encryptionKey)) {
    if (encryptionKey.length !== 32) {
      throw new Error('encryptionKey buffer must be 32 bytes')
    }
    return encryptionKey
  }

  const text = String(encryptionKey)
  if (/^[a-f0-9]{64}$/iu.test(text)) {
    return Buffer.from(text, 'hex')
  }

  throw new Error('Passphrase encryption requires scrypt salt metadata')
}

function legacyNormalizeEncryptionKey(encryptionKey) {
  if (!encryptionKey) {
    return null
  }

  if (
    Buffer.isBuffer(encryptionKey) ||
    /^[a-f0-9]{64}$/iu.test(encryptionKey)
  ) {
    return normalizeEncryptionKey(encryptionKey)
  }

  return crypto
    .createHash('sha256')
    .update(String(encryptionKey), 'utf8')
    .digest()
}

function deriveEncryptionKeyMaterial(encryptionKey) {
  if (!encryptionKey) {
    return null
  }

  if (
    Buffer.isBuffer(encryptionKey) ||
    /^[a-f0-9]{64}$/iu.test(encryptionKey)
  ) {
    return {
      key: normalizeEncryptionKey(encryptionKey),
      kdf: 'raw',
    }
  }

  const salt = crypto.randomBytes(16)
  return {
    key: crypto.scryptSync(String(encryptionKey), salt, 32),
    kdf: 'scrypt',
    salt: salt.toString('base64'),
  }
}

function resolveDecryptionKey(payload, encryptionKey) {
  if (payload.kdf === 'scrypt') {
    if (!payload.salt) {
      throw new Error('Encrypted RAG store is missing scrypt salt')
    }

    return crypto.scryptSync(
      String(encryptionKey || ''),
      Buffer.from(payload.salt, 'base64'),
      32
    )
  }

  if (payload.kdf === 'raw') {
    return normalizeEncryptionKey(encryptionKey)
  }

  return legacyNormalizeEncryptionKey(encryptionKey)
}

function isEncryptedStorePayload(value = {}) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      value.type === ENCRYPTED_STORE_TYPE &&
      value.algorithm === 'aes-256-gcm'
  )
}

function encryptJsonPayload(value, encryptionKey) {
  const keyMaterial = deriveEncryptionKeyMaterial(encryptionKey)
  if (!keyMaterial) {
    return value
  }

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial.key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ])

  return {
    schemaVersion: ENCRYPTED_STORE_VERSION,
    type: ENCRYPTED_STORE_TYPE,
    algorithm: 'aes-256-gcm',
    kdf: keyMaterial.kdf,
    salt: keyMaterial.salt,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

function decryptJsonPayload(payload, encryptionKey) {
  if (!isEncryptedStorePayload(payload)) {
    return payload
  }

  const key = resolveDecryptionKey(payload, encryptionKey)
  if (!key) {
    throw new Error('Encrypted RAG store requires encryptionKey')
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(payload.iv || '', 'base64')
  )
  decipher.setAuthTag(Buffer.from(payload.authTag || '', 'base64'))

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext || '', 'base64')),
    decipher.final(),
  ])

  return JSON.parse(plaintext.toString('utf8'))
}

async function readJsonStoreState(filePath, normalizeState, options = {}) {
  try {
    const payload = await fs.readJson(filePath)
    return normalizeState(decryptJsonPayload(payload, options.encryptionKey))
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return normalizeState()
    }
    throw error
  }
}

async function writeFileWithFsync(filePath, contents, {mode} = {}) {
  const handle =
    mode == null
      ? await nodeFs.promises.open(filePath, 'wx')
      : await nodeFs.promises.open(filePath, 'wx', mode)

  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function fsyncDirectory(dirPath) {
  if (process.platform === 'win32') {
    return
  }

  let handle
  try {
    handle = await nodeFs.promises.open(dirPath, nodeFs.constants.O_RDONLY)
    await handle.sync()
  } catch {
    // Some filesystems do not support directory fsync. The file fsync still
    // protects the written payload before rename.
  } finally {
    if (handle) {
      await handle.close().catch(() => {})
    }
  }
}

async function writeJsonStoreStateAtomic(filePath, state, options = {}) {
  const dirPath = path.dirname(filePath)
  await fs.ensureDir(dirPath)
  if (options.secureDirectoryPermissions) {
    await fs.chmod(dirPath, 0o700).catch(() => {})
  }

  const tempPath = path.join(
    dirPath,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${crypto
      .randomBytes(6)
      .toString('hex')}.tmp`
  )
  const payload = encryptJsonPayload(state, options.encryptionKey)
  const mode = options.secureFilePermissions === false ? undefined : 0o600

  try {
    await writeFileWithFsync(
      tempPath,
      `${JSON.stringify(payload, null, 2)}\n`,
      {
        mode,
      }
    )
    await nodeFs.promises.rename(tempPath, filePath)
    if (options.secureFilePermissions !== false) {
      await fs.chmod(filePath, 0o600).catch(() => {})
    }
    await fsyncDirectory(dirPath)
  } catch (error) {
    await fs.remove(tempPath).catch(() => {})
    throw error
  }
}

async function acquireFileLock(lockPath, options = {}) {
  const timeoutMs = Math.max(
    1,
    Number.parseInt(options.timeoutMs || DEFAULT_LOCK_TIMEOUT_MS, 10) ||
      DEFAULT_LOCK_TIMEOUT_MS
  )
  const retryMs = Math.max(
    1,
    Number.parseInt(options.retryMs || DEFAULT_LOCK_RETRY_MS, 10) ||
      DEFAULT_LOCK_RETRY_MS
  )
  const staleMs = Math.max(
    1,
    Number.parseInt(options.staleMs || DEFAULT_LOCK_STALE_MS, 10) ||
      DEFAULT_LOCK_STALE_MS
  )
  const startedAt = Date.now()

  for (;;) {
    try {
      await fs.ensureDir(path.dirname(lockPath))
      const handle = await nodeFs.promises.open(lockPath, 'wx', 0o600)
      const nonce = crypto.randomBytes(16).toString('hex')
      await handle.writeFile(
        `${JSON.stringify({
          pid: process.pid,
          nonce,
          createdAt: new Date().toISOString(),
        })}\n`,
        'utf8'
      )
      await handle.sync().catch(() => {})

      return async () => {
        await handle.close().catch(() => {})
        if ((await readLockNonce(lockPath)) === nonce) {
          await fs.remove(lockPath).catch(() => {})
        }
      }
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        throw error
      }

      const stats = await fs.stat(lockPath).catch(() => null)
      if (stats && Date.now() - stats.mtimeMs > staleMs) {
        await fs.remove(lockPath).catch(() => {})
      } else if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for RAG store lock: ${lockPath}`)
      } else {
        await delay(retryMs)
      }
    }
  }
}

async function withFileLock(lockPath, operation, options = {}) {
  const release = await acquireFileLock(lockPath, options)
  try {
    return await operation()
  } finally {
    await release()
  }
}

module.exports = {
  ENCRYPTED_STORE_TYPE,
  ENCRYPTED_STORE_VERSION,
  acquireFileLock,
  decryptJsonPayload,
  encryptJsonPayload,
  isEncryptedStorePayload,
  normalizeEncryptionKey,
  readJsonStoreState,
  withFileLock,
  writeJsonStoreStateAtomic,
}
