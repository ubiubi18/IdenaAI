const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  candidateRelativePaths,
  defaultUserDataDir,
  resolveStaticFile,
} = require('./start-electron-static')

describe('static Electron runtime launcher', () => {
  let rendererRoot

  beforeEach(() => {
    rendererRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'idena-static-'))
    fs.mkdirSync(path.join(rendererRoot, '_next'), {recursive: true})
    fs.writeFileSync(path.join(rendererRoot, 'home.html'), 'home')
    fs.writeFileSync(path.join(rendererRoot, '_next', 'app.js'), 'app')
  })

  afterEach(() => {
    fs.rmSync(rendererRoot, {recursive: true, force: true})
  })

  it('maps routes and assets inside the static export', () => {
    expect(resolveStaticFile('/', rendererRoot)).toBe(
      fs.realpathSync(path.join(rendererRoot, 'home.html'))
    )
    expect(resolveStaticFile('/home', rendererRoot)).toBe(
      fs.realpathSync(path.join(rendererRoot, 'home.html'))
    )
    expect(resolveStaticFile('/_next/app.js', rendererRoot)).toBe(
      fs.realpathSync(path.join(rendererRoot, '_next', 'app.js'))
    )
  })

  it('rejects traversal, malformed escapes, missing files, and backslashes', () => {
    expect(candidateRelativePaths('/../outside')).toEqual([])
    expect(candidateRelativePaths('/%2e%2e/outside')).toEqual([])
    expect(candidateRelativePaths('/%zz')).toEqual([])
    expect(candidateRelativePaths('/a%5cb')).toEqual([])
    expect(resolveStaticFile('/missing', rendererRoot)).toBeNull()
  })

  it('uses the normal Linux IdenaAI profile unless explicitly overridden', () => {
    expect(defaultUserDataDir({XDG_CONFIG_HOME: '/tmp/config'})).toBe(
      '/tmp/config/IdenaAI'
    )
  })
})
