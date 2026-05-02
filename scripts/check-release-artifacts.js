#!/usr/bin/env node

const fs = require('fs')
const {execFileSync} = require('child_process')

const githubWarningLimitBytes = 50 * 1024 * 1024
const githubHardLimitGuardBytes = 95 * 1024 * 1024

const allowedLargeArtifacts = new Map()

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function listTrackedFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }
  )

  return output.split('\0').filter(Boolean)
}

const failures = []
const warnings = []

for (const filePath of listTrackedFiles()) {
  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath)
    if (stat.isFile()) {
      const allowedLargeArtifactReason = allowedLargeArtifacts.get(filePath)
      const isAllowedLargeArtifact = Boolean(allowedLargeArtifactReason)

      if (stat.size >= githubHardLimitGuardBytes) {
        failures.push(
          `${filePath} is ${formatMb(
            stat.size
          )}; move it to Git LFS or release artifacts before publishing`
        )
      } else if (
        stat.size >= githubWarningLimitBytes &&
        !isAllowedLargeArtifact
      ) {
        failures.push(
          `${filePath} is ${formatMb(
            stat.size
          )}; new large tracked files must use Git LFS or release artifacts`
        )
      } else if (
        stat.size >= githubWarningLimitBytes &&
        isAllowedLargeArtifact
      ) {
        warnings.push(
          `${filePath} is ${formatMb(
            stat.size
          )}; allowed ${allowedLargeArtifactReason}, but consider Git LFS/artifacts for formal releases`
        )
      }
    }
  }
}

const notices = fs.existsSync('THIRD_PARTY_NOTICES.md')
  ? fs.readFileSync('THIRD_PARTY_NOTICES.md', 'utf8')
  : ''
if (!notices.includes('generated `idena-wasm-binding/lib/`')) {
  failures.push(
    'THIRD_PARTY_NOTICES.md must mention generated idena-wasm-binding static libraries'
  )
}

const readme = fs.existsSync('README.md')
  ? fs.readFileSync('README.md', 'utf8')
  : ''
if (!readme.includes('Source Mirrors and Smaller Checkouts')) {
  failures.push(
    'README.md must document source mirror and checkout-size handling'
  )
}

if (failures.length > 0) {
  console.error('Release artifact check failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

for (const warning of warnings) {
  console.warn(`[release-artifacts] ${warning}`)
}

console.log('Release artifact check passed.')
