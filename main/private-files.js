const fs = require('fs')

const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const PRIVATE_UMASK = 0o077

function applyPrivateFileCreationMask({
  platform = process.platform,
  setUmask = process.umask,
} = {}) {
  if (platform === 'win32') return null
  return setUmask(PRIVATE_UMASK)
}

function hardenPrivatePath(
  filePath,
  mode,
  {platform = process.platform, chmodSync = fs.chmodSync} = {}
) {
  if (platform === 'win32') return false

  try {
    chmodSync(filePath, mode)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function hardenPrivateDirectory(directoryPath, options) {
  return hardenPrivatePath(directoryPath, PRIVATE_DIRECTORY_MODE, options)
}

function hardenPrivateFile(filePath, options) {
  return hardenPrivatePath(filePath, PRIVATE_FILE_MODE, options)
}

module.exports = {
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
  PRIVATE_UMASK,
  applyPrivateFileCreationMask,
  hardenPrivateDirectory,
  hardenPrivateFile,
}
