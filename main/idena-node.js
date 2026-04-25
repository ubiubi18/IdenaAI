/* eslint-disable no-console */
const path = require('path')
const fs = require('fs-extra')
const os = require('os')
const {spawn, execFile} = require('child_process')
const {promisify} = require('util')
const {promises: fsPromises} = require('fs')
const semver = require('semver')
const kill = require('tree-kill')
// eslint-disable-next-line import/no-extraneous-dependencies
const appDataPath = require('./app-data-path')
const logger = require('./logger')
const httpClient = require('./utils/fetch-client')

const idenaBin = 'idena-go'
const pinnedNodeVersion = '1.1.2'
const pinnedNodeTag = `v${pinnedNodeVersion}`
const idenaNodePinnedReleaseUrl = `https://api.github.com/repos/idena-network/idena-go/releases/tags/${pinnedNodeTag}`
const idenaChainDbFolder = 'idenachain.db'
const minNodeBinarySize = 1024 * 1024
const localNodeBuildToolchain = 'go1.19.13'
const defaultNodeVerbosity = 3
const devNodeVerbosity = 4
const peerAssistInitialDelayMs = 12 * 1000
const peerAssistRetryIntervalMs = 30 * 1000
const peerAssistRetryCooldownMs = 2 * 60 * 1000
const peerAssistRpcUnavailableRetryMs = 5 * 1000
const maxPersistedPeerHints = 32
const nodeRpcProbeTimeoutMs = 1500
const peerHintFreshnessMs = 72 * 60 * 60 * 1000
const peerHintFailureBaseBackoffMs = 5 * 60 * 1000
const peerHintFailureMaxBackoffMs = 60 * 60 * 1000
const managedPeerNetwork = 'mainnet'

const execFileAsync = promisify(execFile)

const defaultIpfsBootstrapNodes = [
  '/ip4/135.181.40.10/tcp/40405/ipfs/QmNYWtiwM1UfeCmHfWSdefrMuQdg6nycY5yS64HYqWCUhD',
  '/ip4/157.230.61.115/tcp/40403/ipfs/QmQHYY49pWWFeXXdR9rKd31bHRqRi2E4tk4CXDgYJZq5ry',
  '/ip4/124.71.148.124/tcp/40405/ipfs/QmWH9D4DjSvQyWyRUw76AopCfRS5CPR2gRnRoxP3QFaefx',
  '/ip4/139.59.42.4/tcp/40405/ipfs/QmNagyEFFNMdkFT7W6HivNjJAmYB6zjrr7ussnC8ys9b7f',
]

const getBinarySuffix = () => (process.platform === 'win32' ? '.exe' : '')

function getCurrentUserDataDir() {
  return appDataPath('userData')
}

function resolveNodeStorageBaseDir() {
  return getCurrentUserDataDir()
}

const getNodeDir = () => path.join(resolveNodeStorageBaseDir(), 'node')

const getNodeDataDir = () => path.join(getNodeDir(), 'datadir')

const getNodeFile = () => path.join(getNodeDir(), idenaBin + getBinarySuffix())

const getNodeConfigFile = () => path.join(getNodeDir(), 'config.json')
const getNodePeerHintsFile = () => path.join(getNodeDir(), 'peer-hints.json')
const getNodeRuntimeFile = () => path.join(getNodeDir(), 'runtime.json')

const getTempNodeFile = () =>
  path.join(getNodeDir(), `new-${idenaBin}${getBinarySuffix()}`)

const getNodeChainDbFolder = () =>
  path.join(getNodeDataDir(), idenaChainDbFolder)

const getNodeIpfsDir = () => path.join(getNodeDataDir(), 'ipfs')

const getNodeLogsFile = () => path.join(getNodeDataDir(), 'logs', 'output.log')

const getNodeErrorFile = () => path.join(getNodeDataDir(), 'logs', 'error.log')

function uniqStrings(values) {
  return [...new Set(values.filter(Boolean))]
}

function toArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizePeerAddr(value) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (!text) return ''
  return text.replace('/p2p/', '/ipfs/')
}

function normalizeRpcPeerAddr(value) {
  const rawAddr =
    value &&
    (value.addr ||
      value.RemoteAddr ||
      value.remoteAddr ||
      value.address ||
      value.multiaddr ||
      value)
  const addr = normalizePeerAddr(rawAddr)
  if (!addr || addr.includes('/ipfs/')) return addr

  const peerId = value && (value.id || value.ID || value.peerId || value.peerID)
  if (typeof peerId !== 'string' || !peerId.trim()) return addr

  return `${addr.replace(/\/$/, '')}/ipfs/${peerId.trim()}`
}

function parsePeerHintTime(value) {
  if (typeof value !== 'string') return 0
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function normalizePeerHint(value, defaults = {}) {
  const addr = normalizeRpcPeerAddr(value)
  if (!addr.includes('/ipfs/')) return null

  const failures = Number(value && value.failures)
  const network = value && value.network ? value.network : defaults.network

  return {
    addr,
    source: (value && value.source) || defaults.source || 'cache',
    network: network || managedPeerNetwork,
    lastSeenAt: (value && value.lastSeenAt) || defaults.lastSeenAt || undefined,
    lastAttemptAt:
      (value && value.lastAttemptAt) || defaults.lastAttemptAt || undefined,
    lastFailedAt:
      (value && value.lastFailedAt) || defaults.lastFailedAt || undefined,
    lastSucceededAt:
      (value && value.lastSucceededAt) || defaults.lastSucceededAt || undefined,
    failures:
      Number.isFinite(failures) && failures > 0 ? Math.floor(failures) : 0,
  }
}

function mergePeerHints(peers) {
  const byAddr = new Map()

  toArray(peers).forEach((peer) => {
    const hint = normalizePeerHint(peer)
    if (!hint || hint.network !== managedPeerNetwork) return

    const current = byAddr.get(hint.addr)
    if (!current) {
      byAddr.set(hint.addr, hint)
      return
    }

    const currentEventAt = Math.max(
      parsePeerHintTime(current.lastSeenAt),
      parsePeerHintTime(current.lastAttemptAt),
      parsePeerHintTime(current.lastFailedAt),
      parsePeerHintTime(current.lastSucceededAt)
    )
    const hintEventAt = Math.max(
      parsePeerHintTime(hint.lastSeenAt),
      parsePeerHintTime(hint.lastAttemptAt),
      parsePeerHintTime(hint.lastFailedAt),
      parsePeerHintTime(hint.lastSucceededAt)
    )

    byAddr.set(hint.addr, {
      ...current,
      ...hint,
      lastSeenAt:
        parsePeerHintTime(hint.lastSeenAt) >
        parsePeerHintTime(current.lastSeenAt)
          ? hint.lastSeenAt
          : current.lastSeenAt,
      lastAttemptAt:
        parsePeerHintTime(hint.lastAttemptAt) >
        parsePeerHintTime(current.lastAttemptAt)
          ? hint.lastAttemptAt
          : current.lastAttemptAt,
      lastFailedAt:
        parsePeerHintTime(hint.lastFailedAt) >
        parsePeerHintTime(current.lastFailedAt)
          ? hint.lastFailedAt
          : current.lastFailedAt,
      lastSucceededAt:
        parsePeerHintTime(hint.lastSucceededAt) >
        parsePeerHintTime(current.lastSucceededAt)
          ? hint.lastSucceededAt
          : current.lastSucceededAt,
      failures:
        hintEventAt >= currentEventAt
          ? hint.failures || 0
          : current.failures || 0,
      source:
        current.source === 'runtime' || hint.source !== 'runtime'
          ? current.source
          : hint.source,
    })
  })

  return [...byAddr.values()]
}

function getPeerHintSourceRank(source) {
  if (source === 'runtime') return 0
  if (source === 'cache') return 1
  return 3
}

function getPeerHintFailureBackoffMs(hint) {
  const failures = Math.max(0, Number(hint && hint.failures) || 0)
  if (failures < 1) return peerAssistRetryCooldownMs

  return Math.min(
    peerHintFailureMaxBackoffMs,
    peerHintFailureBaseBackoffMs * 2 ** Math.min(failures - 1, 6)
  )
}

function isPeerHintRetryable(hint, now = Date.now()) {
  const lastAttemptAt = Math.max(
    parsePeerHintTime(hint && hint.lastAttemptAt),
    parsePeerHintTime(hint && hint.lastFailedAt)
  )

  return (
    !lastAttemptAt || now - lastAttemptAt >= getPeerHintFailureBackoffMs(hint)
  )
}

function getPeerHintSortScore(hint, now = Date.now()) {
  const lastSeenAt = Math.max(
    parsePeerHintTime(hint && hint.lastSeenAt),
    parsePeerHintTime(hint && hint.lastSucceededAt)
  )
  const stalePenalty =
    lastSeenAt > 0 && now - lastSeenAt > peerHintFreshnessMs ? 4 : 0
  const failurePenalty = Math.min(5, Number(hint && hint.failures) || 0)

  return (
    getPeerHintSourceRank(hint && hint.source) + stalePenalty + failurePenalty
  )
}

function sortPeerHintsForRetry(peers, now = Date.now()) {
  return mergePeerHints(peers).sort((left, right) => {
    const scoreDiff =
      getPeerHintSortScore(left, now) - getPeerHintSortScore(right, now)
    if (scoreDiff !== 0) return scoreDiff

    const leftSeenAt = Math.max(
      parsePeerHintTime(left.lastSeenAt),
      parsePeerHintTime(left.lastSucceededAt)
    )
    const rightSeenAt = Math.max(
      parsePeerHintTime(right.lastSeenAt),
      parsePeerHintTime(right.lastSucceededAt)
    )

    return rightSeenAt - leftSeenAt
  })
}

function toBootstrapPeerHints(bootstrapNodes) {
  return toArray(bootstrapNodes)
    .map((addr) =>
      normalizePeerHint(
        {addr},
        {source: 'bootstrap', network: managedPeerNetwork}
      )
    )
    .filter(Boolean)
}

function parsePeerHintList(value) {
  if (typeof value !== 'string') return []
  return uniqStrings(
    value
      .split(/[\n,]/)
      .map(normalizePeerAddr)
      .filter((item) => item.includes('/ipfs/'))
  )
}

function getConfiguredBootstrapNodes(existingConfig = {}) {
  const existingBootNodes = toArray(existingConfig?.IpfsConf?.BootNodes).map(
    normalizePeerAddr
  )
  const extraBootNodes = parsePeerHintList(
    process.env.IDENA_NODE_EXTRA_IPFS_BOOTNODES
  )

  return uniqStrings([
    ...existingBootNodes,
    ...defaultIpfsBootstrapNodes,
    ...extraBootNodes,
  ])
}

async function getEffectiveBootstrapNodes(existingConfig = {}) {
  const cachedPeerHints = sortPeerHintsForRetry(await readPeerHints())
    .filter((hint) => hint.source === 'runtime' || hint.source === 'cache')
    .filter((hint) => isPeerHintRetryable(hint))
    .map(({addr}) => addr)

  return uniqStrings([
    ...cachedPeerHints,
    ...getConfiguredBootstrapNodes(existingConfig),
  ])
}

async function ensureNodeConfig() {
  await fs.ensureDir(getNodeDir())

  const configFile = getNodeConfigFile()
  let currentConfig = {}

  try {
    if (await fs.pathExists(configFile)) {
      currentConfig = (await fs.readJson(configFile)) || {}
    }
  } catch (error) {
    logger.warn('cannot parse node config, recreating managed config', {
      error: error.toString(),
    })
  }

  const nextConfig = {
    ...currentConfig,
    IpfsConf: {
      ...((currentConfig && currentConfig.IpfsConf) || {}),
      BootNodes: await getEffectiveBootstrapNodes(currentConfig),
    },
  }

  await fs.writeJson(configFile, nextConfig, {spaces: 2})
  return nextConfig
}

async function readPeerHints() {
  const peerHintsFile = getNodePeerHintsFile()

  try {
    if (!(await fs.pathExists(peerHintsFile))) {
      return []
    }

    const data = (await fs.readJson(peerHintsFile)) || {}
    return toArray(data.peers)
      .map((peer) => normalizePeerHint(peer))
      .filter((peer) => peer && peer.network === managedPeerNetwork)
  } catch (error) {
    logger.warn('cannot read node peer hints', {error: error.toString()})
    return []
  }
}

async function writePeerHints(peers) {
  const dedupedPeers = mergePeerHints(peers)
    .slice(0, maxPersistedPeerHints)
    .map((peer) => ({
      addr: peer.addr,
      source: peer.source || 'cache',
      network: peer.network || managedPeerNetwork,
      lastSeenAt: peer.lastSeenAt || new Date().toISOString(),
      ...(peer.lastAttemptAt ? {lastAttemptAt: peer.lastAttemptAt} : {}),
      ...(peer.lastFailedAt ? {lastFailedAt: peer.lastFailedAt} : {}),
      ...(peer.lastSucceededAt ? {lastSucceededAt: peer.lastSucceededAt} : {}),
      failures: Math.max(0, Number(peer.failures) || 0),
    }))

  await fs.ensureDir(getNodeDir())
  await fs.writeJson(
    getNodePeerHintsFile(),
    {
      version: 1,
      peers: dedupedPeers,
      updatedAt: new Date().toISOString(),
    },
    {spaces: 2}
  )
}

async function rememberPeers(peers) {
  const now = new Date().toISOString()
  const persistedPeers = await readPeerHints()
  const nextPeers = [
    ...peers
      .map((peer) => ({
        addr: normalizeRpcPeerAddr(peer),
        lastSeenAt: now,
        lastSucceededAt: now,
        source: 'runtime',
        network: managedPeerNetwork,
        failures: 0,
      }))
      .filter(({addr}) => addr.includes('/ipfs/')),
    ...persistedPeers,
  ]

  if (nextPeers.length > 0) {
    await writePeerHints(nextPeers)
  }
}

function createRpcClient(port) {
  return httpClient.create({
    baseURL: `http://127.0.0.1:${port}`,
    timeout: 10 * 1000,
    validateStatus: (status) => status >= 200 && status < 500,
    headers: {'Content-Type': 'application/json'},
    transformRequest: [(data) => JSON.stringify(data)],
    transformResponse: [(data) => JSON.parse(data)],
  })
}

async function readNodeRuntime() {
  const runtimeFile = getNodeRuntimeFile()

  try {
    if (!(await fs.pathExists(runtimeFile))) {
      return null
    }

    const runtime = (await fs.readJson(runtimeFile)) || {}
    const pid = Number(runtime.pid)
    const port = Number(runtime.port)

    return {
      pid: Number.isInteger(pid) && pid > 0 ? pid : null,
      port: Number.isInteger(port) && port > 0 ? port : null,
      startedAt:
        typeof runtime.startedAt === 'string' ? runtime.startedAt : undefined,
    }
  } catch (error) {
    logger.warn('cannot read node runtime file', {error: error.toString()})
    return null
  }
}

async function writeNodeRuntime({pid, port}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return
  }

  await fs.ensureDir(getNodeDir())
  await fs.writeJson(
    getNodeRuntimeFile(),
    {
      pid,
      port,
      startedAt: new Date().toISOString(),
    },
    {spaces: 2}
  )
}

async function clearNodeRuntime(expectedPid) {
  const runtimeFile = getNodeRuntimeFile()

  try {
    if (!(await fs.pathExists(runtimeFile))) {
      return
    }

    if (Number.isInteger(expectedPid) && expectedPid > 0) {
      const runtime = await readNodeRuntime()
      if (runtime && runtime.pid && runtime.pid !== expectedPid) {
        return
      }
    }

    await fs.remove(runtimeFile)
  } catch (error) {
    logger.warn('cannot clear node runtime file', {error: error.toString()})
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function findListeningProcessPid(port) {
  if (!Number.isInteger(port) || port <= 0) {
    return null
  }

  try {
    if (process.platform === 'win32') {
      const {stdout: netstatOutput} = await execFileAsync(
        'netstat',
        ['-ano', '-p', 'tcp'],
        {windowsHide: true}
      )

      const lines = String(netstatOutput || '').split(/\r?\n/)
      for (const line of lines) {
        const match = line.match(
          /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/
        )

        if (match) {
          const matchedPort = Number.parseInt(match[1], 10)
          const matchedPid = Number.parseInt(match[2], 10)

          if (
            matchedPort === port &&
            Number.isInteger(matchedPid) &&
            matchedPid > 0
          ) {
            return matchedPid
          }
        }
      }

      return null
    }

    const {stdout: lsofOutput} = await execFileAsync(
      'lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
      {windowsHide: true}
    )

    const pid = Number.parseInt(
      String(lsofOutput || '')
        .trim()
        .split(/\s+/)[0],
      10
    )
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

async function isManagedNodeRpcReady(port, apiKey) {
  try {
    const rpcClient = httpClient.create({
      baseURL: `http://127.0.0.1:${port}`,
      timeout: nodeRpcProbeTimeoutMs,
      validateStatus: (status) => status >= 200 && status < 500,
      headers: {'Content-Type': 'application/json'},
    })

    await callNodeRpc(rpcClient, apiKey, 'bcn_syncing')
    return true
  } catch {
    return false
  }
}

function createManagedNodeHandle({
  pid,
  port,
  apiKey,
  onLog,
  bootstrapNodes = [],
  recovered = false,
}) {
  return {
    pid,
    port,
    recovered,
    exitCode: null,
    peerAssist: startPeerAssist({
      port,
      apiKey,
      onLog,
      bootstrapNodes,
    }),
  }
}

async function recoverManagedNode({port, apiKey, onLog, bootstrapNodes = []}) {
  const runtime = await readNodeRuntime()

  if (runtime && runtime.pid && !isProcessAlive(runtime.pid)) {
    await clearNodeRuntime(runtime.pid)
  }

  const rpcReady = await isManagedNodeRpcReady(port, apiKey)
  if (!rpcReady) {
    return null
  }

  const recoveredPid =
    runtime &&
    runtime.port === port &&
    runtime.pid &&
    isProcessAlive(runtime.pid)
      ? runtime.pid
      : await findListeningProcessPid(port)

  const recoveredNode = createManagedNodeHandle({
    pid: recoveredPid,
    port,
    apiKey,
    onLog,
    bootstrapNodes,
    recovered: true,
  })

  if (recoveredPid) {
    await writeNodeRuntime({pid: recoveredPid, port})
  }

  if (onLog) {
    const sourceText = recoveredPid
      ? `process ${recoveredPid}`
      : `RPC endpoint ${port}`
    onLog([`[node] Reusing existing built-in node ${sourceText}`])
  }

  return recoveredNode
}

async function callNodeRpc(rpcClient, apiKey, method, params = []) {
  const {data} = await rpcClient.post('/', {
    jsonrpc: '2.0',
    method,
    params,
    id: Date.now(),
    key: apiKey,
  })

  if (data && data.error) {
    throw new Error(data.error.message || `rpc error for ${method}`)
  }

  return data ? data.result : undefined
}

function isRpcMethodUnavailableError(error) {
  const message = (error && error.message ? error.message : '').toLowerCase()
  return (
    message.includes('method') &&
    (message.includes('does not exist') ||
      message.includes('not available') ||
      message.includes('not found'))
  )
}

async function readNodePeers(rpcClient, apiKey) {
  try {
    return {
      ready: true,
      peers: toArray(await callNodeRpc(rpcClient, apiKey, 'net_peers')),
    }
  } catch (error) {
    if (isRpcMethodUnavailableError(error)) {
      return {ready: false, peers: []}
    }
    throw error
  }
}

function getNodeVerbosity() {
  const explicitVerbosity = Number.parseInt(
    process.env.IDENA_NODE_VERBOSITY,
    10
  )

  if (Number.isInteger(explicitVerbosity) && explicitVerbosity >= 0) {
    return explicitVerbosity
  }

  return process.env.NODE_ENV === 'development'
    ? devNodeVerbosity
    : defaultNodeVerbosity
}

function startPeerAssist({port, apiKey, onLog, bootstrapNodes = []}) {
  const rpcClient = createRpcClient(port)
  const attemptTimestamps = new Map()
  let timer = null
  let stopped = false
  let running = false
  let peerRpcWaitLogged = false

  const emitLog = (message) => {
    logger.info(message)
    if (onLog) {
      onLog([`[peer-assist] ${message}`])
    }
  }

  const run = async () => {
    if (stopped || running) {
      return
    }
    running = true

    try {
      const syncStatus = await callNodeRpc(rpcClient, apiKey, 'bcn_syncing')
      const {ready: peerRpcReady, peers} = await readNodePeers(
        rpcClient,
        apiKey
      )

      if (!peerRpcReady) {
        if (!peerRpcWaitLogged) {
          logger.info('peer assist waiting for full RPC peer namespace')
          peerRpcWaitLogged = true
        }
        schedule(peerAssistRpcUnavailableRetryMs)
        return
      }

      peerRpcWaitLogged = false

      if (syncStatus && syncStatus.syncing && peers.length > 0) {
        await rememberPeers(peers)
        schedule(Math.min(peerAssistRetryIntervalMs, 5000))
        return
      }

      if (peers.length > 0) {
        await rememberPeers(peers)
        schedule()
        return
      }

      if (syncStatus && syncStatus.syncing) {
        emitLog('syncing without peers, retrying bootstrap hints')
      }

      const persistedPeerHints = await readPeerHints()
      const candidateHints = sortPeerHintsForRetry([
        ...persistedPeerHints,
        ...toBootstrapPeerHints(bootstrapNodes),
      ])

      const retryCandidates = candidateHints.filter((hint) => {
        const lastAttemptAt = attemptTimestamps.get(hint.addr)
        return (
          isPeerHintRetryable(hint) &&
          (!lastAttemptAt ||
            Date.now() - lastAttemptAt >= peerAssistRetryCooldownMs)
        )
      })

      if (retryCandidates.length === 0) {
        schedule()
        return
      }

      const attemptedHints = retryCandidates.slice(0, 8)
      const attemptedAt = new Date().toISOString()
      emitLog(
        `retrying ${attemptedHints.length}/${candidateHints.length} peer hint(s)`
      )

      const updatedHints = await Promise.all(
        attemptedHints.map(async (hint) => {
          attemptTimestamps.set(hint.addr, Date.now())
          try {
            await callNodeRpc(rpcClient, apiKey, 'net_addPeer', [hint.addr])
            return {
              ...hint,
              lastAttemptAt: attemptedAt,
              lastSucceededAt: attemptedAt,
              failures: 0,
            }
          } catch (error) {
            emitLog(`peer hint failed: ${hint.addr} (${error.message})`)
            return {
              ...hint,
              lastAttemptAt: attemptedAt,
              lastFailedAt: attemptedAt,
              failures: (Number(hint.failures) || 0) + 1,
            }
          }
        })
      )

      await writePeerHints([
        ...updatedHints,
        ...persistedPeerHints,
        ...toBootstrapPeerHints(bootstrapNodes),
      ])
    } catch (error) {
      emitLog(`peer assist rpc probe failed (${error.message})`)
    } finally {
      running = false
      schedule()
    }
  }

  function schedule(delay = peerAssistRetryIntervalMs) {
    if (stopped) return
    clearTimeout(timer)
    timer = setTimeout(run, delay)
  }

  schedule(peerAssistInitialDelayMs)

  return {
    stop() {
      stopped = true
      clearTimeout(timer)
    },
  }
}

function isCompatibleAssetName(assetName) {
  if (!assetName) return false
  if (process.platform === 'win32') {
    return assetName.startsWith('idena-node-win')
  }
  if (process.platform === 'darwin') {
    if (process.arch === 'arm64') {
      return (
        assetName.startsWith('idena-node-mac-arm64') ||
        assetName.startsWith('idena-node-mac-aarch64')
      )
    }
    return assetName.startsWith('idena-node-mac')
  }
  if (process.platform === 'linux') {
    if (process.arch === 'arm64') {
      return assetName.startsWith('idena-node-linux-aarch64')
    }
    return (
      assetName.startsWith('idena-node-linux') && !assetName.includes('aarch64')
    )
  }
  return false
}

async function getPinnedRelease() {
  const {data: release} = await httpClient.get(idenaNodePinnedReleaseUrl, {
    timeout: 15000,
  })
  return release
}

function getLocalNodeRepoCandidates() {
  return [
    path.resolve(__dirname, '..', '..', 'idena-go'),
    path.resolve(process.cwd(), '..', 'idena-go'),
    process.env.IDENA_BENCHMARK_NODE_SOURCE_DIR,
  ].filter(Boolean)
}

function findLocalNodeRepo() {
  const candidates = getLocalNodeRepoCandidates()
  for (const repoDir of candidates) {
    const goMod = path.join(repoDir, 'go.mod')
    if (fs.existsSync(goMod)) {
      return repoDir
    }
  }
  return null
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options)
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve({stdout, stderr})
        return
      }
      reject(
        new Error(
          `command failed (${command} ${args.join(' ')}): ${stderr || stdout}`
        )
      )
    })
  })
}

async function buildLocalArm64PinnedNode(tempNodeFile, onProgress) {
  const repoDir = findLocalNodeRepo()
  if (!repoDir) {
    throw new Error(
      'cannot find local idena-go repo for darwin/arm64 pinned build'
    )
  }

  const cargoBinDir = path.join(os.homedir(), '.cargo', 'bin')
  const env = {
    ...process.env,
    GOTOOLCHAIN: localNodeBuildToolchain,
    PATH: [process.env.PATH || '', cargoBinDir].join(path.delimiter),
  }
  const buildScript = path.join(repoDir, 'scripts', 'build-node-macos-arm64.sh')

  if (onProgress) {
    onProgress({
      version: pinnedNodeVersion,
      percentage: 5,
      transferred: 0,
      length: 1,
      eta: 0,
      runtime: 0,
      speed: 0,
      stage: 'build-start',
    })
  }

  if (fs.existsSync(buildScript)) {
    await runCommand(
      '/usr/bin/arch',
      ['-arm64', '/bin/bash', buildScript, tempNodeFile],
      {
        cwd: repoDir,
        env,
      }
    )
  } else {
    const wasmBindingDir = path.resolve(repoDir, '..', 'idena-wasm-binding')
    const wasmBindingGoMod = path.join(wasmBindingDir, 'go.mod')
    const wasmBindingArm64Lib = path.join(
      wasmBindingDir,
      'lib',
      'libidena_wasm_darwin_arm64.a'
    )
    if (
      !fs.existsSync(wasmBindingGoMod) ||
      !fs.existsSync(wasmBindingArm64Lib)
    ) {
      throw new Error(
        'missing local idena-wasm-binding arm64 artifacts. Expected ../idena-wasm-binding with lib/libidena_wasm_darwin_arm64.a'
      )
    }

    await runCommand(
      'go',
      [
        'build',
        '-ldflags',
        `-X main.version=${pinnedNodeVersion}`,
        '-o',
        tempNodeFile,
        '.',
      ],
      {
        cwd: repoDir,
        env,
      }
    )
  }

  const stats = await fs.stat(tempNodeFile)
  if (!stats || stats.size < minNodeBinarySize) {
    throw new Error(
      `locally built node binary is too small (${stats ? stats.size : 0} bytes)`
    )
  }

  if (process.platform !== 'win32') {
    await fs.chmod(tempNodeFile, '755')
  }

  if (onProgress) {
    onProgress({
      version: pinnedNodeVersion,
      percentage: 100,
      transferred: stats.size,
      length: stats.size,
      eta: 0,
      runtime: 0,
      speed: 0,
      stage: 'build-complete',
    })
  }
}

async function getCompatibleReleaseInfo() {
  const release = await getPinnedRelease()
  if (release && !release.draft) {
    const assets = Array.isArray(release.assets) ? release.assets : []
    const asset = assets.find(({name}) => isCompatibleAssetName(name))
    const version = semver.clean(release.tag_name)

    if (asset && asset.browser_download_url && version) {
      return {
        version,
        url: asset.browser_download_url,
        assetName: asset.name,
        assetSize: Number(asset.size) || 0,
        tag: release.tag_name,
      }
    }
  }

  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return {
      version: pinnedNodeVersion,
      url: '',
      assetName: '',
      assetSize: 0,
      tag: pinnedNodeTag,
      localBuild: true,
    }
  }

  throw new Error(
    `cannot find ${pinnedNodeTag} compatible idena-node release for ${process.platform}/${process.arch}`
  )
}

const getRemoteVersion = async () => pinnedNodeVersion

function emitDownloadProgress({
  onProgress,
  version,
  transferred,
  length,
  startedAt,
}) {
  if (!onProgress) return

  const runtime = Math.max((Date.now() - startedAt) / 1000, 0.001)
  const speed = transferred / runtime
  const remaining = Math.max(length - transferred, 0)

  onProgress({
    percentage: Math.max(0, Math.min(100, (transferred / length) * 100)),
    transferred,
    length,
    runtime,
    speed,
    eta: speed > 0 ? remaining / speed : 0,
    version,
  })
}

function writeDownloadStream(
  stream,
  targetFile,
  {length, version, onProgress}
) {
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(targetFile)
    const startedAt = Date.now()
    let transferred = 0
    let lastProgressAt = 0

    function emitProgress(force = false) {
      const now = Date.now()
      if (!force && now - lastProgressAt < 1000) return
      lastProgressAt = now
      emitDownloadProgress({
        onProgress,
        version,
        transferred,
        length,
        startedAt,
      })
    }

    writer.on('error', reject)
    stream.on('error', reject)
    stream.on('data', (chunk) => {
      transferred += Buffer.byteLength(chunk)
      emitProgress()
    })
    writer.on('finish', () => {
      emitProgress(true)
      writer.close(resolve)
    })
    stream.pipe(writer)
  })
}

async function downloadNode(onProgress) {
  const tempNodeFile = getTempNodeFile()

  try {
    const release = await getCompatibleReleaseInfo()
    const {url, version, localBuild} = release

    await fs.ensureDir(getNodeDir())
    await fs.remove(tempNodeFile)

    if (localBuild) {
      await buildLocalArm64PinnedNode(tempNodeFile, onProgress)
    } else {
      if (!url) {
        throw new Error(
          `cannot resolve node download URL for release ${
            release.tag || version
          }`
        )
      }

      const response = await httpClient.request({
        method: 'get',
        url,
        responseType: 'stream',
        timeout: 30000,
        validateStatus: (status) => status >= 200 && status < 300,
      })

      const headerLength = Number.parseInt(
        response.headers['content-length'],
        10
      )
      const expectedLength =
        Number.isFinite(headerLength) && headerLength > 0
          ? headerLength
          : release.assetSize
      const streamLength = expectedLength > 0 ? expectedLength : 1

      await writeDownloadStream(response.data, tempNodeFile, {
        length: streamLength,
        version,
        onProgress,
      })
    }

    const stats = await fs.stat(tempNodeFile)
    if (!stats || stats.size < minNodeBinarySize) {
      throw new Error(
        `downloaded node binary is too small (${stats ? stats.size : 0} bytes)`
      )
    }

    return version
  } catch (error) {
    await fs.remove(tempNodeFile).catch(() => {})
    throw error
  }
}

function writeError(err) {
  try {
    fs.appendFileSync(
      getNodeErrorFile(),
      `-- node error, time: ${new Date().toUTCString()} --\n${err}\n -- end of error -- \n`
    )
  } catch (e) {
    console.log(`cannot write error to file: ${e.toString()}`)
  }
}

async function startNode(
  port,
  tcpPort,
  ipfsPort,
  apiKey,
  autoActivateMining,
  // eslint-disable-next-line default-param-last
  useLogging = true,
  onLog,
  onExit
) {
  const managedNodeConfig = await ensureNodeConfig()
  const bootstrapNodes = getConfiguredBootstrapNodes(managedNodeConfig)
  const recoveredNode = await recoverManagedNode({
    port,
    apiKey,
    onLog,
    bootstrapNodes,
  })

  if (recoveredNode) {
    return recoveredNode
  }

  const parameters = [
    '--datadir',
    getNodeDataDir(),
    '--rpcport',
    port,
    '--port',
    tcpPort,
    '--ipfsport',
    ipfsPort,
    '--apikey',
    apiKey,
    '--verbosity',
    String(getNodeVerbosity()),
  ]

  const version = await getCurrentVersion(false)

  if (autoActivateMining && semver.gt(version, '0.28.3')) {
    parameters.push('--autoonline')
  }

  parameters.push('--config')
  parameters.push(getNodeConfigFile())

  const idenaNode = spawn(getNodeFile(), parameters)
  await writeNodeRuntime({pid: idenaNode.pid, port})
  idenaNode.peerAssist = startPeerAssist({
    port,
    apiKey,
    onLog,
    bootstrapNodes,
  })

  idenaNode.stdout.on('data', (data) => {
    const str = data.toString()
    if (onLog) onLog(str.split('\n').filter((x) => x))
    if (useLogging) {
      console.log(str)
    }
  })

  idenaNode.stderr.on('data', (err) => {
    const str = err.toString()
    writeError(str)
    if (onLog) onLog(str.split('\n').filter((x) => x))
    if (useLogging) {
      console.error(str)
    }
  })

  idenaNode.on('error', async (error) => {
    await clearNodeRuntime(idenaNode.pid)
    if (idenaNode.peerAssist) {
      idenaNode.peerAssist.stop()
    }
    if (onExit) {
      onExit(`node failed to start: ${error.message}`, 1)
    }
  })

  idenaNode.on('exit', (code) => {
    clearNodeRuntime(idenaNode.pid)
    if (idenaNode.peerAssist) {
      idenaNode.peerAssist.stop()
    }
    if (useLogging) {
      console.info(`child process exited with code ${code}`)
    }
    if (onExit) {
      onExit(`node stopped with code ${code}`, code)
    }
  })

  return idenaNode
}

async function stopNode(node) {
  let targetNode = node

  if (!targetNode) {
    const runtime = await readNodeRuntime()

    if (runtime && runtime.pid && isProcessAlive(runtime.pid)) {
      targetNode = {
        pid: runtime.pid,
        exitCode: null,
      }
    } else if (runtime && runtime.pid) {
      await clearNodeRuntime(runtime.pid)
    }
  }

  return new Promise((resolve, reject) => {
    try {
      if (!targetNode) {
        resolve('node process not found')
        return
      }
      if (targetNode && targetNode.peerAssist) {
        targetNode.peerAssist.stop()
      }
      if (!Number.isInteger(targetNode.pid) || targetNode.pid <= 0) {
        resolve('node pid is not available')
        return
      }
      if (targetNode.exitCode != null) {
        clearNodeRuntime(targetNode.pid)
        resolve(`node already exited with code ${targetNode.exitCode}`)
        return
      }
      kill(
        targetNode.pid,
        process.platform === 'win32' ? 'SIGTERM' : 'SIGINT',
        (err) => {
          if (err) {
            return reject(err)
          }
          clearNodeRuntime(targetNode.pid)
          return resolve(`node ${targetNode.pid} stopped successfully`)
        }
      )
    } catch (e) {
      reject(e)
    }
  })
}

function getCurrentVersion(tempNode) {
  const node = tempNode ? getTempNodeFile() : getNodeFile()
  return getBinaryVersion(node)
}

function getBinaryVersion(nodePath) {
  return new Promise((resolve, reject) => {
    try {
      const nodeVersion = spawn(nodePath, ['--version'])
      nodeVersion.stdout.on('data', (data) => {
        const output = data.toString()
        const coerced = semver.coerce(output)
        const parsed = coerced && semver.valid(coerced.version)
        return parsed
          ? resolve(parsed)
          : reject(new Error(`cannot resolve node version, stdout: ${output}`))
      })

      nodeVersion.stderr.on('data', (data) =>
        reject(
          new Error(`cannot resolve node version, stderr: ${data.toString()}`)
        )
      )

      nodeVersion.on('exit', (code) => {
        if (code) {
          return reject(
            new Error(`cannot resolve node version, exit code ${code}`)
          )
        }
      })

      nodeVersion.on('error', (err) => reject(err))
    } catch (e) {
      reject(e)
    }
  })
}

function updateNode() {
  return new Promise((resolve, reject) => {
    try {
      const currentNode = getNodeFile()
      const tempNode = getTempNodeFile()

      if (!fs.existsSync(tempNode)) {
        reject(new Error('cannot update idena-go: temp binary does not exist'))
        return
      }

      const tempStats = fs.statSync(tempNode)
      if (!tempStats || tempStats.size < minNodeBinarySize) {
        fs.removeSync(tempNode)
        reject(
          new Error(
            `cannot update idena-go: downloaded binary too small (${
              tempStats ? tempStats.size : 0
            } bytes)`
          )
        )
        return
      }

      fs.moveSync(tempNode, currentNode, {overwrite: true})
      if (process.platform !== 'win32') {
        fs.chmodSync(currentNode, '755')
      }
      resolve()
    } catch (e) {
      reject(e)
    }
  })
}

function nodeExists() {
  return fs.existsSync(getNodeFile())
}

function cleanNodeState() {
  const chainDbDirectory = getNodeChainDbFolder()
  if (fs.existsSync(chainDbDirectory)) {
    fs.removeSync(chainDbDirectory)
  }
}

async function readLastLines(filePath, number) {
  if (!fs.existsSync(filePath)) return []

  const chunkSize = 64 * 1024
  const handle = await fsPromises.open(filePath, 'r')

  try {
    const stats = await handle.stat()
    let position = stats.size
    let buffer = ''
    let lines = []

    while (position > 0 && lines.length <= number) {
      const readSize = Math.min(chunkSize, position)
      position -= readSize
      const chunk = Buffer.alloc(readSize)
      await handle.read(chunk, 0, readSize, position)
      buffer = `${chunk.toString('utf8')}${buffer}`
      lines = buffer.split(/\r?\n/)
    }

    return lines.filter(Boolean).slice(-number)
  } finally {
    await handle.close()
  }
}

function getLastLogs() {
  return readLastLines(getNodeLogsFile(), 100)
}

async function tryStopNode(node, {onSuccess, onFail}) {
  try {
    if (node) {
      const log = await stopNode(node)
      logger.info(log)
      if (onSuccess) {
        onSuccess()
      }
    }
  } catch (e) {
    logger.error('error while stopping node', e.toString())
    if (onFail) {
      onFail()
    }
  }
}

module.exports = {
  downloadNode,
  getCurrentVersion,
  getRemoteVersion,
  startNode,
  stopNode,
  updateNode,
  nodeExists,
  cleanNodeState,
  getLastLogs,
  getNodeFile,
  getNodeChainDbFolder,
  getNodeIpfsDir,
  tryStopNode,
  __test__: {
    getPeerHintFailureBackoffMs,
    isRpcMethodUnavailableError,
    isPeerHintRetryable,
    mergePeerHints,
    normalizePeerHint,
    sortPeerHintsForRetry,
    toBootstrapPeerHints,
  },
}
