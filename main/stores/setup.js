/* eslint-disable import/no-extraneous-dependencies */
const path = require('path')

let electron = {}
try {
  // eslint-disable-next-line global-require
  electron = require('electron') || {}
} catch {
  electron = {}
}
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const fs = require('fs')
const {APP_PATH_COMMAND} = require('../channels')
const {hardenPrivateDirectory, hardenPrivateFile} = require('../private-files')

const app = electron.app || null
const ipcRenderer = electron.ipcRenderer || null

function getUserDataPath() {
  let userDataPath
  if (app) {
    userDataPath = app.getPath('userData')
  } else {
    if (!ipcRenderer || typeof ipcRenderer.sendSync !== 'function') {
      throw new Error('Electron app path IPC is unavailable')
    }
    userDataPath = ipcRenderer.sendSync(APP_PATH_COMMAND, 'userData')
  }

  if (!userDataPath) throw new Error('Electron user data path is unavailable')
  fs.mkdirSync(userDataPath, {mode: 0o700, recursive: true})
  hardenPrivateDirectory(userDataPath)
  return userDataPath
}

function dbPath(fileDb) {
  return path.join(getUserDataPath(), fileDb)
}

function createPrivateFileAdapter(filePath) {
  const adapter = new FileSync(filePath)
  const write = adapter.write.bind(adapter)
  adapter.write = (data) => {
    write(data)
    hardenPrivateFile(filePath)
  }
  hardenPrivateFile(filePath)
  return adapter
}

module.exports = {
  dbPath,
  createPrivateFileAdapter,
  prepareDb(name) {
    const adapter = createPrivateFileAdapter(dbPath(`${name}.json`))
    return low(adapter)
  },
  checkDbExists(name) {
    return fs.existsSync(dbPath(`${name}.json`))
  },
}
