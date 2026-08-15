#!/usr/bin/env node

const path = require('path')
const {verifyBundledNodeArtifact} = require('../main/node-artifact-policy')

const ROOT = path.resolve(__dirname, '..')
const defaultBinary = path.join(
  ROOT,
  'build',
  'node',
  'current',
  process.platform === 'win32' ? 'idena-go.exe' : 'idena-go'
)

async function main(argv = process.argv.slice(2)) {
  if (argv.length > 1) {
    throw new Error('Pass at most one bundled node path')
  }
  await verifyBundledNodeArtifact(path.resolve(argv[0] || defaultBinary))
  console.log('Bundled Idena node matches the approved application release')
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[bundled-node-artifact] ${error.message}`)
    process.exit(1)
  })
}

module.exports = {main}
