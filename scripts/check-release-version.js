#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const TAG_PATTERN = /^v?[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/u

function verifyReleaseVersion(tag, packageJson, packageLock, applicationLock) {
  if (typeof tag !== 'string' || !TAG_PATTERN.test(tag)) {
    throw new Error('Invalid release tag')
  }
  const version = tag.startsWith('v') ? tag.slice(1) : tag
  if (
    packageJson?.version !== version ||
    packageLock?.version !== version ||
    packageLock?.packages?.['']?.version !== version ||
    applicationLock?.releaseId !== `idena-ai-${version}`
  ) {
    throw new Error(
      `Release tag ${tag} does not match checked-in release versions`
    )
  }
  return version
}

function main(tag = process.env.RELEASE_TAG) {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'package.json'))
  )
  const packageLock = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'package-lock.json'))
  )
  const applicationLock = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, 'compatibility/application-release-lock.json')
    )
  )
  const version = verifyReleaseVersion(
    tag,
    packageJson,
    packageLock,
    applicationLock
  )
  console.log(`Release tag matches checked-in package version ${version}`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`[release-version] ${error.message}`)
    process.exit(1)
  }
}

module.exports = {verifyReleaseVersion}
