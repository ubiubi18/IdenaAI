#!/usr/bin/env node

const path = require('path')
const {
  readCanonicalJson,
  verifyApplicationReleaseLock,
} = require('../main/application-release-policy')

const ROOT = path.resolve(__dirname, '..')
const LOCK_PATH = path.join('compatibility', 'application-release-lock.json')

function parseArgs(argv) {
  if (argv.length === 0) return {requireApproved: false}
  if (argv.length === 1 && argv[0] === '--require-approved') {
    return {requireApproved: true}
  }
  throw new Error(`Unknown application release argument: ${argv.join(' ')}`)
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const lock = readCanonicalJson(ROOT, LOCK_PATH)
  verifyApplicationReleaseLock(lock, ROOT, options)
  console.log(`IdenaAI application release lock passed (${lock.status})`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`[application-release-lock] ${error.message}`)
    process.exit(1)
  }
}

module.exports = {main, parseArgs}
