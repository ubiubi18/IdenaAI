const os = require('os')
const path = require('path')
const fs = require('fs-extra')

const {buildCodebaseContext, shouldIgnoreFile} = require('./codebase-context')

describe('local-ai codebase context', () => {
  let tempDir

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'idena-codebase-'))
    await fs.writeJson(path.join(tempDir, 'package.json'), {
      name: 'sample',
      scripts: {test: 'jest'},
    })
    await fs.ensureDir(path.join(tempDir, 'main', 'local-ai'))
    await fs.writeFile(
      path.join(tempDir, 'main', 'local-ai', 'manager.js'),
      'function auditLocalAi() { return true }\n'
    )
    await fs.writeFile(path.join(tempDir, '.env'), 'SECRET=value\n')
    await fs.ensureDir(path.join(tempDir, 'node_modules', 'left-pad'))
    await fs.writeFile(
      path.join(tempDir, 'node_modules', 'left-pad', 'index.js'),
      'module.exports = () => null\n'
    )
    await fs.ensureDir(path.join(tempDir, 'samples', 'flips'))
    await fs.writeFile(
      path.join(tempDir, 'samples', 'flips', 'large-fixture.json'),
      JSON.stringify({secretFixture: 'skip me'})
    )
  })

  afterEach(async () => {
    await fs.remove(tempDir)
  })

  it('builds bounded read-only context and skips private or heavy folders', async () => {
    const result = await buildCodebaseContext({
      root: tempDir,
      allowedRoots: [tempDir],
      query: 'audit local ai manager',
      maxFiles: 4,
      maxChars: 12000,
    })

    expect(result.ok).toBe(true)
    expect(result.files.map((file) => file.path)).toEqual(
      expect.arrayContaining(['package.json', 'main/local-ai/manager.js'])
    )
    expect(result.context).toContain('Access mode: read-only snippets')
    expect(result.context).toContain('Repository map before snippets')
    expect(result.context).toContain('Skipped heavy/generated/private paths')
    expect(result.context).toContain('samples/flips')
    expect(result.context).toContain(
      'Do not answer that you have no codebase access.'
    )
    expect(result.context).toContain('auditLocalAi')
    expect(result.context).not.toContain('SECRET=value')
    expect(result.context).not.toContain('left-pad')
    expect(result.context).not.toContain('secretFixture')
    expect(result.skippedPaths.map((item) => item.path)).toEqual(
      expect.arrayContaining(['node_modules', 'samples/flips'])
    )
  })

  it('caps individual snippets so large source files do not dominate a pass', async () => {
    await fs.writeFile(
      path.join(tempDir, 'main', 'local-ai', 'large-audit.js'),
      `${'const x = 1\n'.repeat(1200)}tailMarker\n`
    )

    const result = await buildCodebaseContext({
      root: tempDir,
      allowedRoots: [tempDir],
      query: 'large audit local ai',
      maxFiles: 2,
      maxChars: 12000,
      maxFileChars: 2000,
    })
    const largeFile = result.files.find(
      (file) => file.path === 'main/local-ai/large-audit.js'
    )

    expect(largeFile).toBeTruthy()
    expect(largeFile.chars).toBeLessThanOrEqual(2000)
    expect(largeFile.truncated).toBe(true)
    expect(result.context).not.toContain('tailMarker')
  })

  it('rejects roots outside the allowed workspace', async () => {
    await expect(
      buildCodebaseContext({
        root: os.tmpdir(),
        allowedRoots: [tempDir],
      })
    ).rejects.toThrow(/outside the allowed workspace/u)
  })

  it('identifies sensitive files that should not enter model context', () => {
    expect(shouldIgnoreFile('.env.local')).toBe(true)
    expect(shouldIgnoreFile('private-key.pem')).toBe(true)
    expect(shouldIgnoreFile('renderer/pages/ai-chat.js')).toBe(false)
  })

  it('can exclude already inspected files for a later pass', async () => {
    const first = await buildCodebaseContext({
      root: tempDir,
      allowedRoots: [tempDir],
      query: 'audit local ai manager package',
      maxFiles: 1,
      maxChars: 12000,
    })
    const second = await buildCodebaseContext({
      root: tempDir,
      allowedRoots: [tempDir],
      query: 'audit local ai manager package',
      excludePaths: first.files.map((file) => file.path),
      maxFiles: 2,
      maxChars: 12000,
    })

    expect(second.files.map((file) => file.path)).not.toContain(
      first.files[0].path
    )
    expect(second.excludedFileCount).toBe(1)
  })
})
