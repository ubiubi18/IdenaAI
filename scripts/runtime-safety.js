const fs = require('fs')
const path = require('path')

const ALLOW_DEV_SESSION_AUTO_ENV = 'IDENA_DESKTOP_ALLOW_DEV_SESSION_AUTO'
const DEFAULT_DEV_USER_DATA_NAME = 'IdenaAIDev'

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(value || '')
      .trim()
      .toLowerCase()
  )
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`Unable to read ${filePath}: ${error.message}`)
  }
}

function isRehearsalNodeSettings(settings = {}) {
  return Boolean(
    settings &&
      settings.useExternalNode &&
      (settings.ephemeralExternalNodeConnected === true ||
        settings.externalNodeLabel === 'Validation rehearsal node')
  )
}

function isRealSessionAutoArmed(settings = {}) {
  const aiSolver = settings && settings.aiSolver
  return Boolean(
    aiSolver &&
      aiSolver.enabled === true &&
      String(aiSolver.mode || '').trim() === 'session-auto' &&
      !isRehearsalNodeSettings(settings)
  )
}

function assertDevRuntimeCanStart(env) {
  if (isTruthyEnv(env[ALLOW_DEV_SESSION_AUTO_ENV])) return

  const settingsPath = path.join(
    env.IDENA_DESKTOP_USER_DATA_DIR,
    'settings.json'
  )
  const settings = readJsonIfExists(settingsPath)

  if (!isRealSessionAutoArmed(settings)) return

  throw new Error(
    [
      `Refusing to start the source dev runtime because real validation session-auto is armed in ${settingsPath}.`,
      `Use the packaged IdenaAI app for real validation, switch to a clean dev profile with IDENA_DESKTOP_APP_USER_DATA_NAME=${DEFAULT_DEV_USER_DATA_NAME}, or disable session-auto in that profile before running npm start.`,
      `For deliberate local testing only, set ${ALLOW_DEV_SESSION_AUTO_ENV}=1.`,
    ].join(' ')
  )
}

module.exports = {
  ALLOW_DEV_SESSION_AUTO_ENV,
  DEFAULT_DEV_USER_DATA_NAME,
  assertDevRuntimeCanStart,
  isRealSessionAutoArmed,
}
