#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const LOCK_PATH = path.join(ROOT, 'compatibility', 'stack-lock.json')
const SOURCES_PATH = path.join(ROOT, 'scripts', 'source-manifest.json')
const SOCIAL_PACKAGE_PATH = path.join(
  ROOT,
  'vendor',
  'idena.social-ui',
  'package.json'
)
const SOCIAL_LOCK_PATH = path.join(
  ROOT,
  'vendor',
  'idena.social-ui',
  'package-lock.json'
)
const CONTRACT_RUNNER_MOD_PATH = path.join(
  ROOT,
  'vendor',
  'idena.social-contract',
  'test-contract-runner',
  'go.mod'
)
const SHA1_PATTERN = /^[0-9a-f]{40}$/u

const LEGACY_INVARIANTS = {
  baselineCommit: '938be81dbdeff85f888f4337060a8ebabb12e5b5',
  gossipProtocol: '/idena/gossip/1.1.0',
  identitySnapshotSha256:
    'f136ec8939e3f78587a38de517128c7071501e283bac7d12c24ce4be830ff8aa',
  intermediateGenesisHeaderSha256:
    '27e696414b955714ba7ed4defe063794c8dcadef28a7e61dd9249b8623571b3c',
  stateSnapshotSha256:
    '7cf6f8c334d76a3617cbd5ac3aa5a104a8d337cb6ceb8d6906c62bf7fab8d131',
}

function readRegular(filePath, encoding = 'utf8') {
  const metadata = fs.lstatSync(filePath)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${path.basename(filePath)} must be a regular file`)
  }
  return fs.readFileSync(filePath, encoding)
}

function readJson(filePath) {
  return JSON.parse(readRegular(filePath))
}

function requirePinSet(lock, name, expectedNames) {
  const pins = lock.consumerPins?.[name]
  if (
    !pins ||
    Object.keys(pins).sort().join(',') !==
      expectedNames.slice().sort().join(',')
  ) {
    throw new Error(`Compatibility lock is missing ${name} pins`)
  }
  return pins
}

function verifyLockIdentity(lock) {
  if (
    lock.schema !== 1 ||
    lock.releaseId !== 'idena-mainnet-legacy-compat-2026.07.12-rc3' ||
    lock.status !== 'candidate'
  ) {
    throw new Error('Unexpected compatibility lock identity')
  }
  if (
    lock.legacyBaseline?.nodeVersion !== '1.1.2' ||
    lock.legacyBaseline?.commit !== LEGACY_INVARIANTS.baselineCommit
  ) {
    throw new Error('Compatibility lock changed the legacy baseline')
  }

  const invariants = lock.chainInvariants || {}
  if (
    invariants.mainnetNetworkId !== 1 ||
    invariants.gossipProtocol !== LEGACY_INVARIANTS.gossipProtocol ||
    invariants.intermediateGenesisHeaderSha256 !==
      LEGACY_INVARIANTS.intermediateGenesisHeaderSha256 ||
    invariants.stateSnapshotSha256 !== LEGACY_INVARIANTS.stateSnapshotSha256 ||
    invariants.identitySnapshotSha256 !==
      LEGACY_INVARIANTS.identitySnapshotSha256 ||
    invariants.consensusChangesAllowed !== false
  ) {
    throw new Error('Compatibility lock changed a legacy-chain invariant')
  }
}

function verifyCompatibilityLock(
  lock,
  sources,
  socialPackage,
  socialLock,
  contractRunnerGoMod
) {
  verifyLockIdentity(lock)

  const components = new Map()
  for (const component of lock.components || []) {
    if (!component?.name || !SHA1_PATTERN.test(component.commit || '')) {
      throw new Error('Compatibility lock contains an invalid component')
    }
    if (components.has(component.name)) {
      throw new Error(`Duplicate compatibility component: ${component.name}`)
    }
    components.set(component.name, component.commit)
  }

  const desktopPins = requirePinSet(lock, 'idena-desktop', [
    'idena-go',
    'idena-wasm-binding',
  ])
  const runnerPins = requirePinSet(lock, 'idena-social-contract-runner', [
    'idena-go',
    'idena-wasm-binding',
  ])
  const socialUiPins = requirePinSet(lock, 'idena-social-ui', [
    'idena-sdk-js-lite',
  ])

  for (const name of ['idena-go', 'idena-wasm-binding']) {
    if (
      desktopPins[name] !== runnerPins[name] ||
      desktopPins[name] !== components.get(name)
    ) {
      throw new Error(`${name} compatibility profiles disagree`)
    }
  }

  if (sources.version !== 1 || !Array.isArray(sources.sources)) {
    throw new Error('Invalid source manifest')
  }
  const manifestSources = new Map(
    sources.sources.map((source) => [source.name, source])
  )
  if (manifestSources.size !== 2 || sources.sources.length !== 2) {
    throw new Error('Source manifest contains an unreviewed component')
  }
  for (const [name, commit] of Object.entries(desktopPins)) {
    const source = manifestSources.get(name)
    if (
      !source ||
      source.path !== name ||
      source.url !== `https://github.com/ubiubi18/${name}.git` ||
      source.ref !== 'master' ||
      source.commit !== commit
    ) {
      throw new Error(`${name} does not match the desktop compatibility pin`)
    }
  }

  const sdkCommit = socialUiPins['idena-sdk-js-lite']
  if (
    !SHA1_PATTERN.test(sdkCommit || '') ||
    components.get('idena-sdk-js-lite') !== sdkCommit
  ) {
    throw new Error('Invalid social UI SDK compatibility pin')
  }
  const sdkUrl = `https://github.com/ubiubi18/idena-sdk-js-lite/archive/${sdkCommit}.tar.gz`
  if (
    socialPackage.dependencies?.['idena-sdk-js-lite'] !== sdkUrl ||
    socialLock.packages?.['']?.dependencies?.['idena-sdk-js-lite'] !== sdkUrl ||
    socialLock.packages?.['node_modules/idena-sdk-js-lite']?.resolved !== sdkUrl
  ) {
    throw new Error(
      'Embedded social UI SDK drifted from the compatibility lock'
    )
  }

  const bindingCommit = desktopPins['idena-wasm-binding']
  if (
    !new RegExp(
      `github\\.com/idena-network/idena-wasm-binding v0\\.0\\.0-[0-9]{14}-${bindingCommit.slice(
        0,
        12
      )}`,
      'u'
    ).test(contractRunnerGoMod)
  ) {
    throw new Error(
      'Embedded contract runner does not require the locked binding'
    )
  }
  for (const replacement of [
    'replace github.com/idena-network/idena-go => ../../../idena-go',
    'replace github.com/idena-network/idena-wasm-binding => ../../../idena-wasm-binding',
  ]) {
    if (!contractRunnerGoMod.includes(replacement)) {
      throw new Error('Embedded contract runner lost its local source boundary')
    }
  }
}

function main() {
  verifyCompatibilityLock(
    readJson(LOCK_PATH),
    readJson(SOURCES_PATH),
    readJson(SOCIAL_PACKAGE_PATH),
    readJson(SOCIAL_LOCK_PATH),
    readRegular(CONTRACT_RUNNER_MOD_PATH)
  )
  console.log('IdenaAI compatibility lock passed')
}

if (require.main === module) main()

module.exports = {verifyCompatibilityLock}
