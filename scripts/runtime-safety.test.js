const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  ALLOW_DEV_SESSION_AUTO_ENV,
  assertDevRuntimeCanStart,
  isRealSessionAutoArmed,
} = require('./runtime-safety')

describe('source runtime safety guard', () => {
  let userDataDir

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idena-safety-'))
  })

  afterEach(() => {
    fs.rmSync(userDataDir, {recursive: true, force: true})
  })

  function writeSettings(settings) {
    fs.writeFileSync(
      path.join(userDataDir, 'settings.json'),
      JSON.stringify(settings)
    )
  }

  it('allows an unarmed or missing profile', () => {
    expect(() =>
      assertDevRuntimeCanStart({IDENA_DESKTOP_USER_DATA_DIR: userDataDir})
    ).not.toThrow()
  })

  it('refuses an armed real-validation profile', () => {
    writeSettings({aiSolver: {enabled: true, mode: 'session-auto'}})

    expect(() =>
      assertDevRuntimeCanStart({IDENA_DESKTOP_USER_DATA_DIR: userDataDir})
    ).toThrow(/real validation session-auto is armed/)
  })

  it('allows an explicitly marked rehearsal profile', () => {
    const settings = {
      aiSolver: {enabled: true, mode: 'session-auto'},
      ephemeralExternalNodeConnected: true,
      useExternalNode: true,
    }
    writeSettings(settings)

    expect(isRealSessionAutoArmed(settings)).toBe(false)
    expect(() =>
      assertDevRuntimeCanStart({IDENA_DESKTOP_USER_DATA_DIR: userDataDir})
    ).not.toThrow()
  })

  it('allows the existing deliberate local-test override', () => {
    writeSettings({aiSolver: {enabled: true, mode: 'session-auto'}})

    expect(() =>
      assertDevRuntimeCanStart({
        [ALLOW_DEV_SESSION_AUTO_ENV]: '1',
        IDENA_DESKTOP_USER_DATA_DIR: userDataDir,
      })
    ).not.toThrow()
  })

  it('fails closed when settings cannot be parsed', () => {
    fs.writeFileSync(path.join(userDataDir, 'settings.json'), '{')

    expect(() =>
      assertDevRuntimeCanStart({IDENA_DESKTOP_USER_DATA_DIR: userDataDir})
    ).toThrow(/Unable to read/)
  })
})
