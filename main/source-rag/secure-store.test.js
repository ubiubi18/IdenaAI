const os = require('os')
const path = require('path')
const fs = require('fs-extra')

const {
  acquireFileLock,
  decryptJsonPayload,
  encryptJsonPayload,
  isEncryptedStorePayload,
  withFileLock,
} = require('../rag-secure-store')

describe('rag secure store helpers', () => {
  let tempDir

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'idena-secure-rag-'))
  })

  afterEach(async () => {
    await fs.remove(tempDir)
  })

  it('encrypts and decrypts JSON payloads without plaintext leakage', () => {
    const payload = {
      text: 'Private source-backed RAG content.',
    }
    const encrypted = encryptJsonPayload(payload, 'test-passphrase')

    expect(isEncryptedStorePayload(encrypted)).toBe(true)
    expect(encrypted).toEqual(
      expect.objectContaining({
        kdf: 'scrypt',
        salt: expect.any(String),
      })
    )
    expect(JSON.stringify(encrypted)).not.toContain(payload.text)
    expect(decryptJsonPayload(encrypted, 'test-passphrase')).toEqual(payload)
  })

  it('enforces lock timeout while another writer holds the lock', async () => {
    const lockPath = path.join(tempDir, 'store.json.lock')

    await withFileLock(lockPath, async () => {
      await expect(
        withFileLock(lockPath, async () => true, {
          retryMs: 1,
          staleMs: 10000,
          timeoutMs: 5,
        })
      ).rejects.toThrow('Timed out waiting for RAG store lock')
    })
  })

  it('does not let an old stale-lock holder remove a replacement lock', async () => {
    const lockPath = path.join(tempDir, 'store.json.lock')
    const releaseOld = await withManualLock(lockPath)
    const oldDate = new Date(Date.now() - 100000)

    await fs.utimes(lockPath, oldDate, oldDate)
    const releaseNew = await withManualLock(lockPath, {
      retryMs: 1,
      staleMs: 1,
      timeoutMs: 100,
    })

    await releaseOld()
    await expect(fs.pathExists(lockPath)).resolves.toBe(true)
    await releaseNew()
    await expect(fs.pathExists(lockPath)).resolves.toBe(false)
  })
})

async function withManualLock(lockPath, options) {
  return acquireFileLock(lockPath, options)
}
