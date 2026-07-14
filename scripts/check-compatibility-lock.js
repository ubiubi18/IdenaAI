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
const SHA256_PATTERN = /^[0-9a-f]{64}$/u

const EXPECTED_COMPONENTS = {
  'idena-go': ['node', 'https://github.com/ubiubi18/idena-go.git'],
  'idena-wasm-binding': [
    'native-binding',
    'https://github.com/ubiubi18/idena-wasm-binding.git',
  ],
  'idena-wasm': [
    'contract-runtime',
    'https://github.com/ubiubi18/idena-wasm.git',
  ],
  wasmer: ['wasm-engine', 'https://github.com/ubiubi18/wasmer.git'],
  'idena-sdk-js-lite': [
    'transaction-sdk',
    'https://github.com/ubiubi18/idena-sdk-js-lite.git',
  ],
}

const EXPECTED_TOOLCHAINS = {
  go: '1.26.5',
  rust: '1.97.0',
  node: '24.18.0',
  npm: '11.16.0',
}

const EXPECTED_ARTIFACTS = new Set([
  'libidena_wasm_linux_amd64.a',
  'libidena_wasm_linux_aarch64.a',
  'libidena_wasm_darwin_amd64.a',
  'libidena_wasm_darwin_arm64.a',
  'libidena_wasm_windows_amd64.a',
])

const REQUIRED_GATES = [
  'stack-lock-validation',
  'legacy-block-rpc-differential',
  'legacy-state-replay-differential',
  'legacy-modern-p2p-interoperability',
  'wasm-receipt-and-gas-differential',
  'wasm-cross-architecture-determinism',
  'independent-rebuild-digest-match',
  'secret-scan',
  'dependency-policy',
]

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
    lock.legacyBaseline?.repository !==
      'https://github.com/idena-network/idena-go.git' ||
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
    const expected = Object.hasOwn(EXPECTED_COMPONENTS, component.name)
      ? EXPECTED_COMPONENTS[component.name]
      : null
    if (
      !expected ||
      component.role !== expected[0] ||
      component.repository !== expected[1]
    ) {
      throw new Error(`Unexpected compatibility component: ${component.name}`)
    }
    if (
      component.name === 'idena-go' &&
      component.runtimeCodeCommit !== component.commit
    ) {
      throw new Error('idena-go runtime code pin does not match its source pin')
    }
    components.set(component.name, component.commit)
  }
  if (components.size !== Object.keys(EXPECTED_COMPONENTS).length) {
    throw new Error('Compatibility lock has an incomplete component set')
  }

  if (
    !lock.toolchains ||
    Object.keys(lock.toolchains).length !==
      Object.keys(EXPECTED_TOOLCHAINS).length ||
    Object.entries(EXPECTED_TOOLCHAINS).some(
      ([name, version]) => lock.toolchains[name] !== version
    )
  ) {
    throw new Error('Compatibility lock changed the reviewed toolchain set')
  }

  const gates = lock.requiredGates || []
  if (
    gates.length !== REQUIRED_GATES.length ||
    new Set(gates).size !== REQUIRED_GATES.length ||
    REQUIRED_GATES.some((gate) => !gates.includes(gate))
  ) {
    throw new Error('Compatibility lock changed the required promotion gates')
  }

  const artifacts = new Set()
  for (const artifact of lock.artifacts || []) {
    if (
      !artifact?.name ||
      !EXPECTED_ARTIFACTS.has(artifact.name) ||
      artifacts.has(artifact.name) ||
      !SHA256_PATTERN.test(artifact.sha256 || '')
    ) {
      throw new Error('Compatibility lock contains an invalid artifact pin')
    }
    artifacts.add(artifact.name)
  }
  if (artifacts.size !== EXPECTED_ARTIFACTS.size) {
    throw new Error('Compatibility lock has an incomplete artifact set')
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
  for (const consumer of ['idena-web', 'idena-indexer', 'P2poolBTC']) {
    const pins = requirePinSet(lock, consumer, ['idena-go'])
    if (pins['idena-go'] !== components.get('idena-go')) {
      throw new Error(`${consumer} drifted from the reviewed node pin`)
    }
  }

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

function parseArgs(argv) {
  const options = {requirePromoted: false}
  for (const arg of argv) {
    if (arg === '--require-promoted') {
      options.requirePromoted = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

function requirePromoted(lock) {
  if (lock.status !== 'promoted') {
    throw new Error(
      'Compatibility stack is still a candidate; release promotion gates have not been completed'
    )
  }
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const lock = readJson(LOCK_PATH)
  verifyCompatibilityLock(
    lock,
    readJson(SOURCES_PATH),
    readJson(SOCIAL_PACKAGE_PATH),
    readJson(SOCIAL_LOCK_PATH),
    readRegular(CONTRACT_RUNNER_MOD_PATH)
  )
  if (options.requirePromoted) requirePromoted(lock)
  console.log('IdenaAI compatibility lock passed')
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`[compatibility-lock] ${error.message}`)
    process.exit(1)
  }
}

module.exports = {parseArgs, requirePromoted, verifyCompatibilityLock}
