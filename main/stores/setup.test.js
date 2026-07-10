const fs = require('fs')
const os = require('os')
const path = require('path')
const low = require('lowdb')
const {PRIVATE_FILE_MODE} = require('../private-files')
const {createPrivateFileAdapter} = require('./setup')

describe('persistent store file permissions', () => {
  const testOnPosix = process.platform === 'win32' ? it.skip : it

  testOnPosix('repairs permissions after every atomic write', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'idena-store-'))
    const file = path.join(directory, 'settings.json')

    try {
      const store = low(createPrivateFileAdapter(file))
      store.setState({internalApiKey: 'test-only'}).write()
      fs.chmodSync(file, 0o644)

      store.set('lng', 'en').write()

      // eslint-disable-next-line no-bitwise
      expect(fs.statSync(file).mode & 0o777).toBe(PRIVATE_FILE_MODE)
    } finally {
      fs.rmSync(directory, {force: true, recursive: true})
    }
  })
})
