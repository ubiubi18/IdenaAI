const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
  PRIVATE_UMASK,
  applyPrivateFileCreationMask,
  hardenPrivateDirectory,
  hardenPrivateFile,
} = require('./private-files')

describe('private app file permissions', () => {
  it('sets a restrictive process mask on POSIX', () => {
    const setUmask = jest.fn(() => 0o022)

    expect(applyPrivateFileCreationMask({platform: 'darwin', setUmask})).toBe(
      0o022
    )
    expect(setUmask).toHaveBeenCalledWith(PRIVATE_UMASK)
  })

  it('does not emulate POSIX modes on Windows', () => {
    const setUmask = jest.fn()
    const chmodSync = jest.fn()

    expect(
      applyPrivateFileCreationMask({platform: 'win32', setUmask})
    ).toBeNull()
    expect(
      hardenPrivateFile('settings.json', {platform: 'win32', chmodSync})
    ).toBe(false)
    expect(setUmask).not.toHaveBeenCalled()
    expect(chmodSync).not.toHaveBeenCalled()
  })

  const testOnPosix = process.platform === 'win32' ? it.skip : it
  testOnPosix('repairs existing directory and file modes', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'idena-private-'))
    const file = path.join(directory, 'settings.json')
    fs.writeFileSync(file, '{}', {mode: 0o644})
    fs.chmodSync(directory, 0o755)

    try {
      expect(hardenPrivateDirectory(directory)).toBe(true)
      expect(hardenPrivateFile(file)).toBe(true)
      // eslint-disable-next-line no-bitwise
      expect(fs.statSync(directory).mode & 0o777).toBe(PRIVATE_DIRECTORY_MODE)
      // eslint-disable-next-line no-bitwise
      expect(fs.statSync(file).mode & 0o777).toBe(PRIVATE_FILE_MODE)
    } finally {
      fs.rmSync(directory, {force: true, recursive: true})
    }
  })
})
