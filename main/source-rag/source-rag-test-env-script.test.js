const os = require('os')
const path = require('path')
const fs = require('fs-extra')

const {decryptJsonPayload} = require('../rag-secure-store')
const {
  DEFAULT_BASE_DIR,
  SAFE_TMP_ROOT,
  normalizeQuery,
  parseArgs,
  resolveSafeBaseDir,
  writeRunSummary,
} = require('../../scripts/source-rag-test-env')

describe('source-rag test environment script helpers', () => {
  let tempDir

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'idena-source-env-'))
  })

  afterEach(async () => {
    await fs.remove(tempDir)
  })

  it('caps query length for sandbox runs', () => {
    expect(normalizeQuery('x'.repeat(1000))).toHaveLength(500)
  })

  it('rejects command-line encryption keys', () => {
    expect(() => parseArgs(['--encryption-key=secret'])).toThrow(
      'Use IDENA_RAG_STORE_KEY instead of --encryption-key'
    )
  })

  it('keeps default and caller-provided base dirs under the repo .tmp root', () => {
    expect(DEFAULT_BASE_DIR.startsWith(`${SAFE_TMP_ROOT}${path.sep}`)).toBe(
      true
    )
    expect(resolveSafeBaseDir(path.join(SAFE_TMP_ROOT, 'custom'))).toBe(
      path.join(SAFE_TMP_ROOT, 'custom')
    )
    expect(() => resolveSafeBaseDir(tempDir)).toThrow(
      'source-rag test env baseDir must be inside'
    )
  })

  it('encrypts run summaries when an encryption key is provided', async () => {
    const summaryPath = path.join(tempDir, 'run-summary.json')
    const summary = {
      query: 'private qwen test query',
      annotationCount: 4,
    }

    await writeRunSummary(summaryPath, summary, {
      encryptionKey: 'test-summary-key',
    })

    const raw = await fs.readFile(summaryPath, 'utf8')
    expect(raw).toContain('idena-rag-encrypted-store')
    expect(raw).not.toContain(summary.query)
    expect(decryptJsonPayload(JSON.parse(raw), 'test-summary-key')).toEqual(
      summary
    )
  })
})
