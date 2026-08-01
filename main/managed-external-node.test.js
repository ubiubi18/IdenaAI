const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  MANAGED_EXTERNAL_NODE_RESTART_REQUEST,
  isManagedExternalNodeRestartAllowed,
  requestManagedExternalNodeRestart,
} = require('./managed-external-node')

const managedSettings = {
  useExternalNode: true,
  externalNodeMode: 'persistent',
  managedExternalNodeKeyImportEnabled: true,
  url: 'http://127.0.0.1:9129',
}

describe('managed external node restart', () => {
  let userDataPath

  beforeEach(() => {
    userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'idena-managed-node-'))
  })

  afterEach(() => {
    fs.rmSync(userDataPath, {recursive: true, force: true})
  })

  it('allows only an explicitly managed persistent loopback node', () => {
    expect(isManagedExternalNodeRestartAllowed(managedSettings)).toBe(true)
    expect(
      isManagedExternalNodeRestartAllowed({
        ...managedSettings,
        url: 'https://node.example.org',
      })
    ).toBe(false)
    expect(
      isManagedExternalNodeRestartAllowed({
        ...managedSettings,
        externalNodeMode: 'ephemeral',
      })
    ).toBe(false)
    expect(
      isManagedExternalNodeRestartAllowed({
        ...managedSettings,
        managedExternalNodeKeyImportEnabled: false,
      })
    ).toBe(false)
  })

  it('writes a private restart request without returning its path', () => {
    expect(
      requestManagedExternalNodeRestart({
        settings: managedSettings,
        userDataPath,
      })
    ).toEqual({requested: true})

    const requestPath = path.join(
      userDataPath,
      MANAGED_EXTERNAL_NODE_RESTART_REQUEST
    )
    const mode = fs.statSync(requestPath).mode.toString(8).slice(-3)

    expect(fs.readFileSync(requestPath, 'utf8')).toBe('restart\n')
    expect(mode).toBe('600')
  })

  it('does not write a request when the node is not allowed', () => {
    expect(() =>
      requestManagedExternalNodeRestart({
        settings: {...managedSettings, url: 'http://127.0.0.1:9129/rpc'},
        userDataPath,
      })
    ).toThrow('Managed external node restart is not allowed')

    expect(
      fs.existsSync(
        path.join(userDataPath, MANAGED_EXTERNAL_NODE_RESTART_REQUEST)
      )
    ).toBe(false)
  })
})
