const fs = require('fs')
const path = require('path')

const MANAGED_EXTERNAL_NODE_RESTART_REQUEST =
  'managed-external-node-restart.request'

function isManagedExternalNodeRestartAllowed(settings = {}) {
  if (
    !settings ||
    settings.useExternalNode !== true ||
    settings.externalNodeMode !== 'persistent' ||
    settings.managedExternalNodeKeyImportEnabled !== true
  ) {
    return false
  }

  try {
    const rpcUrl = new URL(String(settings.url || '').trim())
    const hostname = rpcUrl.hostname
      .replace(/^\[/u, '')
      .replace(/\]$/u, '')
      .toLowerCase()

    return Boolean(
      rpcUrl.protocol === 'http:' &&
        ['127.0.0.1', '::1'].includes(hostname) &&
        !rpcUrl.username &&
        !rpcUrl.password &&
        rpcUrl.pathname === '/' &&
        !rpcUrl.search &&
        !rpcUrl.hash
    )
  } catch {
    return false
  }
}

function requestManagedExternalNodeRestart({settings, userDataPath}) {
  if (!isManagedExternalNodeRestartAllowed(settings)) {
    throw new Error('Managed external node restart is not allowed')
  }

  const normalizedUserDataPath = path.resolve(String(userDataPath || ''))

  if (
    !normalizedUserDataPath ||
    normalizedUserDataPath === path.parse(normalizedUserDataPath).root
  ) {
    throw new Error('Invalid user data path')
  }

  fs.mkdirSync(normalizedUserDataPath, {mode: 0o700, recursive: true})

  const requestPath = path.join(
    normalizedUserDataPath,
    MANAGED_EXTERNAL_NODE_RESTART_REQUEST
  )

  fs.writeFileSync(requestPath, 'restart\n', {encoding: 'utf8', mode: 0o600})
  fs.chmodSync(requestPath, 0o600)

  return {requested: true}
}

module.exports = {
  MANAGED_EXTERNAL_NODE_RESTART_REQUEST,
  isManagedExternalNodeRestartAllowed,
  requestManagedExternalNodeRestart,
}
