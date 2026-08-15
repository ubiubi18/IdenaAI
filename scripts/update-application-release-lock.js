#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const {
  canonicalJson,
  protectedFileDigests,
  readCanonicalJson,
} = require('../main/application-release-policy')

const ROOT = path.resolve(__dirname, '..')
const LOCK_PATH = path.join('compatibility', 'application-release-lock.json')

function main() {
  const lock = readCanonicalJson(ROOT, LOCK_PATH)
  if (lock.status !== 'candidate') {
    throw new Error('Only candidate application locks may be regenerated')
  }
  const updated = {...lock, protectedFiles: protectedFileDigests(ROOT)}
  fs.writeFileSync(path.join(ROOT, LOCK_PATH), canonicalJson(updated), {
    encoding: 'utf8',
    mode: 0o644,
  })
  console.log('Updated candidate application release protected-file digests')
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`[application-release-lock] ${error.message}`)
    process.exit(1)
  }
}
