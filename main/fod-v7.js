/* global BigInt */
/* eslint-disable no-bitwise */

const {createHash, randomBytes} = require('crypto')
const {spawn: defaultSpawn} = require('child_process')
const defaultFs = require('fs')
const os = require('os')
const path = require('path')
const {
  checkPinnedBinary,
  readPrivateSelectedFile,
  writePrivateFile,
  runCheck,
} = require('./fod-direct-check')
const {privateKeyToAddress} = require('./utils/idena-crypto')
const {createFetchClient} = require('./utils/fetch-client')
const {createBondedMarket} = require('./fod-v8')

const HEX20 = /^(?:0x)?[0-9a-f]{40}$/
const HEX32 = /^(?:0x)?[0-9a-f]{64}$/
const DECIMAL = /^(0|[1-9][0-9]*)$/
const ACTION_ID = /^v7-[0-9a-f]{32}$/
const RECEIPT_ID = /^v7-receipt-[0-9a-f]{32}$/
const ATTEMPT_GUARD = 'attempt.guard'
const NONCE_JOURNAL = 'nonce-journal.jsonl'
const NONCE_LOCK = 'nonce.lock'
const NONCE_JOURNAL_HEADER = 'fod.v7.nonce-journal/1'
const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_PREPARED_BYTES = 20 * 1024 * 1024
const MAX_SIGNED_BYTES = 2 * MAX_PREPARED_BYTES
const MAX_NONCE_JOURNAL_BYTES = 4 * 1024 * 1024
const MAX_FEE = 100n * 10n ** 18n
const PRICE_CAP = 1000n * 10n ** 18n
const BOND_GAS = 5000000n
const FLIP_CID = /^b[a-z2-7]{58}$/
const PREVIEW_FLIPS = 5
const explorer = createFetchClient({
  baseURL: 'https://api.idena.io/api/',
  timeout: 5000,
  redirect: 'error',
  maxResponseBytes: 2 * 1024 * 1024,
})

const OPERATIONS = Object.freeze({
  qualify: {
    format: 'qualify',
    files: ['session', 'proof', 'registration-host'],
  },
  proveBundle: {
    format: 'prove-bundle',
    files: ['session', 'proof', 'registration-host'],
  },
  seedBundle: {
    format: 'seed-bundle',
    files: ['vault'],
    passphrase: true,
    disclosure: true,
  },
  activate: {format: 'activate', irreversible: true},
  list: {format: 'list', files: ['session', 'vault'], passphrase: true},
  buy: {format: 'buy', files: ['session']},
  buyPublicSeed: {format: 'buy-public-seed'},
  confirm: {format: 'confirm', files: ['delivery']},
  challenge: {format: 'challenge'},
  startFallback: {format: 'start-fallback'},
  proveAndReveal: {
    format: 'prove-and-reveal',
    files: ['vault'],
    passphrase: true,
    disclosure: true,
  },
  refund: {format: 'refund'},
  relist: {format: 'relist'},
  cancel: {format: 'cancel', irreversible: true},
  expireHead: {format: 'expire-head'},
  topUpBond: {format: 'top-up-bond'},
  slashUnproved: {format: 'slash-unproved'},
})
const OPERATION_LABELS = Object.freeze({
  qualify: 'qualify bundle',
  proveBundle: 'prove bundle content',
  seedBundle: 'publish public seed',
  activate: 'activate market',
  list: 'list private flips',
  buy: 'buy private flips',
  buyPublicSeed: 'buy public seed',
  confirm: 'confirm delivery',
  challenge: 'report a delivery problem',
  startFallback: 'start public fallback',
  proveAndReveal: 'prove and publish keys',
  refund: 'request refund',
  relist: 'relist flips',
  cancel: 'cancel listing',
  expireHead: 'expire oldest offer',
  topUpBond: 'top up seller bond',
  slashUnproved: 'slash unproved order',
})
const ORDER_OPERATIONS = new Set([
  'confirm',
  'challenge',
  'startFallback',
  'proveAndReveal',
  'refund',
  'slashUnproved',
])
const OFFER_OPERATIONS = new Set([
  'activate',
  'buy',
  'buyPublicSeed',
  'cancel',
  'expireHead',
  'topUpBond',
  'relist',
])

function fail(code) {
  throw new Error(code)
}

function plainObject(value, keys) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every((key) => keys.includes(key))
  )
}

function hex(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value))
    fail('Invalid v7 pin or ID.')
  return value.replace(/^0x/, '')
}

function positiveDecimal(value, maximum) {
  if (
    typeof value !== 'string' ||
    !DECIMAL.test(value) ||
    BigInt(value) < 1n ||
    BigInt(value) > maximum
  )
    fail('Invalid v7 amount or fee.')
  return value
}

function idnaAtoms(value) {
  const text =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : value
  if (
    typeof text !== 'string' ||
    !/^(0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(text)
  ) {
    fail('The node balance could not be read.')
  }
  const [whole, fraction = ''] = text.split('.')
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0') || '0')
}

function feeRate(value) {
  const text =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : value
  if (
    typeof text !== 'string' ||
    !(/^[1-9][0-9]*$/.test(text) || /^0x[0-9a-f]+$/i.test(text)) ||
    BigInt(text) === 0n
  ) {
    fail('The node fee rate could not be read.')
  }
  return BigInt(text)
}

function formatIdnaAtoms(value) {
  const units = BigInt(value)
  const whole = units / 10n ** 18n
  const fraction = String(units % 10n ** 18n)
    .padStart(18, '0')
    .replace(/0+$/, '')
  return `${whole}${fraction ? `.${fraction}` : ''} iDNA`
}

function nodekeyAddress(raw) {
  let {length} = raw
  if (length && raw[length - 1] === 10) length -= 1
  if (length && raw[length - 1] === 13) length -= 1
  if (length !== 64) fail('The selected nodekey is invalid.')
  const key = Buffer.alloc(32)
  try {
    const digit = (byte) => {
      if (byte >= 48 && byte <= 57) return byte - 48
      if (byte >= 65 && byte <= 70) return byte - 55
      if (byte >= 97 && byte <= 102) return byte - 87
      fail('The selected nodekey is invalid.')
    }
    for (let index = 0; index < 32; index += 1) {
      key[index] = (digit(raw[index * 2]) << 4) | digit(raw[index * 2 + 1])
    }
    return privateKeyToAddress(key, false).toLowerCase()
  } finally {
    key.fill(0)
  }
}

function orderId(value) {
  return positiveDecimal(value, (1n << 64n) - 1n)
}

function loopbackConnection(connection) {
  if (
    !connection ||
    typeof connection.url !== 'string' ||
    typeof connection.key !== 'string'
  )
    fail('Connect a local node RPC first.')
  let url
  try {
    url = new URL(connection.url)
  } catch {
    fail('Connect a local node RPC first.')
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    fail('V7 requires a loopback node RPC.')
  }
  return {url: connection.url, key: connection.key}
}

async function privateDirectory(fs, directory) {
  await fs.promises.mkdir(directory, {recursive: true, mode: 0o700})
  const stat = await fs.promises.lstat(directory)
  const realDirectory = await fs.promises.realpath(directory)
  const expectedDirectory =
    process.platform === 'win32'
      ? path.join(
          await fs.promises.realpath(path.dirname(directory)),
          path.basename(directory)
        )
      : path.resolve(directory)
  const sameDirectory =
    process.platform === 'win32'
      ? path.win32.normalize(realDirectory).toLowerCase() ===
        path.win32.normalize(expectedDirectory).toLowerCase()
      : realDirectory === expectedDirectory
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) ||
    !sameDirectory
  ) {
    fail('Private v7 storage is unavailable.')
  }
  return directory
}

async function privateJSON(fs, file, maxBytes = 16 * 1024) {
  const {data} = await readPrivateSelectedFile(fs, file, maxBytes, true, true)
  try {
    return JSON.parse(data.toString('utf8'))
  } finally {
    data.fill(0)
  }
}

async function syncDirectory(fs, directory) {
  const handle = await fs.promises.open(directory, fs.constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncActionDirectories(fs, directory, root) {
  // Windows refuses directory fsync. Its pre-created attempt guard is synced
  // in place before signing; a missing guard makes the action unusable.
  if (process.platform === 'win32') return
  for (
    let current = directory;
    current !== path.dirname(root);
    current = path.dirname(current)
  ) {
    await syncDirectory(fs, current)
  }
  await syncDirectory(fs, path.dirname(root))
}

async function signingAttempted(fs, directory) {
  const marker = fs.existsSync(path.join(directory, 'attempt.json'))
  if (process.platform !== 'win32') return marker
  const guard = await fs.promises.lstat(path.join(directory, ATTEMPT_GUARD))
  if (
    !guard.isFile() ||
    guard.isSymbolicLink() ||
    guard.nlink !== 1 ||
    guard.size > 1
  ) {
    fail('The saved v7 signing guard is invalid.')
  }
  return marker || guard.size === 1
}

async function markWindowsSigningAttempt(fs, directory) {
  const file = path.join(directory, ATTEMPT_GUARD)
  const before = await fs.promises.lstat(file)
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size !== 0
  ) {
    fail('This v7 action has already had a signing attempt.')
  }
  const handle = await fs.promises.open(
    file,
    fs.constants.O_WRONLY | fs.constants.O_APPEND
  )
  try {
    const opened = await handle.stat()
    if (opened.dev !== before.dev || opened.ino !== before.ino)
      fail('The saved v7 signing guard changed.')
    const {bytesWritten} = await handle.write(Buffer.from([1]))
    if (bytesWritten !== 1) fail('The v7 signing attempt could not be saved.')
    await handle.sync()
    const after = await handle.stat()
    const afterPath = await fs.promises.lstat(file)
    if (
      after.size !== 1 ||
      afterPath.size !== 1 ||
      afterPath.dev !== before.dev ||
      afterPath.ino !== before.ino
    ) {
      fail('The saved v7 signing guard changed.')
    }
  } finally {
    await handle.close()
  }
}

function validNonceRecord(record) {
  return (
    plainObject(record, [
      'coinbase',
      'accountNonce',
      'actionId',
      'contract',
      'codeHash',
      'kind',
      'txHash',
    ]) &&
    typeof record.coinbase === 'string' &&
    HEX20.test(record.coinbase) &&
    record.coinbase.length === 40 &&
    Number.isSafeInteger(record.accountNonce) &&
    record.accountNonce > 0 &&
    record.accountNonce < 2 ** 32 &&
    ACTION_ID.test(record.actionId) &&
    typeof record.contract === 'string' &&
    HEX20.test(record.contract) &&
    record.contract.length === 40 &&
    // Native transfers share the identity's nonce space with market calls.
    // Explicitly typed, canonically reconciled imports retain that reservation.
    (record.kind === 'native-transfer'
      ? record.codeHash === '' &&
        typeof record.txHash === 'string' &&
        HEX32.test(record.txHash) &&
        record.txHash.length === 64
      : record.kind === undefined &&
        record.txHash === undefined &&
        typeof record.codeHash === 'string' &&
        HEX32.test(record.codeHash) &&
        record.codeHash.length === 64)
  )
}

async function readNonceJournal(fs, root) {
  const {data} = await readPrivateSelectedFile(
    fs,
    path.join(root, NONCE_JOURNAL),
    MAX_NONCE_JOURNAL_BYTES,
    true,
    true
  )
  try {
    if (data.length && data[data.length - 1] !== 10)
      fail('The v7 nonce journal is incomplete.')
    const lines = data.toString('utf8').split('\n')
    if (lines[0] !== NONCE_JOURNAL_HEADER)
      fail('The v7 nonce journal is invalid.')
    const records = lines.slice(1, -1).map((line) => {
      let record
      try {
        record = JSON.parse(line)
      } catch {
        fail('The v7 nonce journal is invalid.')
      }
      if (!validNonceRecord(record)) fail('The v7 nonce journal is invalid.')
      return record
    })
    const reserved = new Set()
    for (const record of records) {
      const key = `${record.coinbase}:${record.accountNonce}`
      if (reserved.has(key)) fail('The v7 nonce journal is invalid.')
      reserved.add(key)
    }
    return records
  } finally {
    data.fill(0)
  }
}

async function appendNonceJournal(fs, root, record) {
  const file = path.join(root, NONCE_JOURNAL)
  const before = await fs.promises.lstat(file)
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size > MAX_NONCE_JOURNAL_BYTES
  ) {
    fail('The v7 nonce journal is unavailable.')
  }
  const bytes = Buffer.from(`${JSON.stringify(record)}\n`)
  if (before.size + bytes.length > MAX_NONCE_JOURNAL_BYTES)
    fail('The v7 nonce journal is full.')
  const handle = await fs.promises.open(
    file,
    fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW
  )
  try {
    const opened = await handle.stat()
    if (opened.dev !== before.dev || opened.ino !== before.ino)
      fail('The v7 nonce journal changed.')
    await handle.writeFile(bytes)
    await handle.sync()
    const after = await handle.stat()
    const afterPath = await fs.promises.lstat(file)
    if (
      after.size !== before.size + bytes.length ||
      afterPath.size !== after.size ||
      afterPath.dev !== before.dev ||
      afterPath.ino !== before.ino
    ) {
      fail('The v7 nonce journal changed.')
    }
  } finally {
    await handle.close()
    bytes.fill(0)
  }
}

async function withNonceLock(fs, root, callback) {
  const file = path.join(root, NONCE_LOCK)
  try {
    await writePrivateFile(fs, file, '')
  } catch (error) {
    if (error.code === 'EEXIST')
      fail('A v7 nonce check is unfinished. Reconcile it before signing.')
    throw error
  }
  try {
    if (process.platform !== 'win32') await syncDirectory(fs, root)
    return await callback()
  } finally {
    await fs.promises.unlink(file)
    if (process.platform !== 'win32') await syncDirectory(fs, root)
  }
}

async function attemptedActions(fs, root, selectedCoinbase) {
  const actionsRoot = await privateDirectory(fs, path.join(root, 'actions'))
  const identities = await fs.promises.readdir(actionsRoot, {
    withFileTypes: true,
  })
  const records = []
  for (const identity of identities.filter(
    (item) =>
      /^[0-9a-f]{40}$/.test(item.name) &&
      (!selectedCoinbase || item.name === selectedCoinbase)
  )) {
    if (!identity.isDirectory()) fail('A saved v7 identity is invalid.')
    const identityRoot = await privateDirectory(
      fs,
      path.join(actionsRoot, identity.name)
    )
    const entries = await fs.promises.readdir(identityRoot, {
      withFileTypes: true,
    })
    for (const entry of entries.filter((item) => ACTION_ID.test(item.name))) {
      if (!entry.isDirectory()) fail('A saved v7 action is invalid.')
      const directory = await privateDirectory(
        fs,
        path.join(identityRoot, entry.name)
      )
      const metaPath = path.join(directory, 'meta.json')
      const attemptPath = path.join(directory, 'attempt.json')
      if (!fs.existsSync(metaPath)) {
        if (
          fs.existsSync(attemptPath) ||
          fs.existsSync(path.join(directory, ATTEMPT_GUARD))
        ) {
          fail('A saved v7 signing attempt is incomplete.')
        }
      } else if (await signingAttempted(fs, directory)) {
        let meta
        let attempt
        try {
          meta = await privateJSON(fs, metaPath)
          attempt = await privateJSON(fs, attemptPath)
        } catch {
          fail('A saved v7 signing attempt cannot be reconciled.')
        }
        const record = {
          coinbase: identity.name,
          accountNonce: attempt?.accountNonce,
          actionId: entry.name,
          contract: meta?.contract,
          codeHash: meta?.codeHash,
        }
        if (
          !validNonceRecord(record) ||
          meta?.coinbase !== identity.name ||
          meta?.actionId !== entry.name
        ) {
          fail('A saved v7 signing attempt is invalid.')
        }
        records.push(record)
      }
    }
  }
  return records
}

async function ensureNonceJournal(fs, root) {
  try {
    return await readNonceJournal(fs, root)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const records = await attemptedActions(fs, root)
  const seen = new Set()
  for (const record of records) {
    const key = `${record.coinbase}:${record.accountNonce}`
    if (seen.has(key)) fail('Saved v7 attempts reuse a nonce.')
    seen.add(key)
  }
  await writePrivateFile(
    fs,
    path.join(root, NONCE_JOURNAL),
    `${NONCE_JOURNAL_HEADER}\n${records
      .map((record) => `${JSON.stringify(record)}\n`)
      .join('')}`
  )
  if (process.platform !== 'win32') await syncDirectory(fs, root)
  return records
}

async function checkNonceReservations(fs, root, coinbase, nonce) {
  const records = await readNonceJournal(fs, root)
  const byAction = new Map(
    records.map((record) => [`${record.coinbase}:${record.actionId}`, record])
  )
  for (const legacy of await attemptedActions(fs, root, coinbase)) {
    const journaled = byAction.get(`${coinbase}:${legacy.actionId}`)
    if (
      !journaled ||
      journaled.accountNonce !== legacy.accountNonce ||
      journaled.contract !== legacy.contract ||
      journaled.codeHash !== legacy.codeHash
    ) {
      fail('A saved v7 signing attempt is absent from the nonce journal.')
    }
  }
  if (
    records.some(
      (record) => record.coinbase === coinbase && record.accountNonce === nonce
    )
  ) {
    fail('This identity and nonce already have a v7 signing attempt.')
  }
}

async function saveConfig(fs, root, config, marketVersion = 7) {
  const temp = path.join(root, `config-${randomBytes(8).toString('hex')}.json`)
  await writePrivateFile(fs, temp, JSON.stringify(config))
  await fs.promises.rename(
    temp,
    path.join(
      root,
      [8, 9].includes(marketVersion)
        ? `bonded-v${marketVersion}.json`
        : 'config.json'
    )
  )
  if (process.platform !== 'win32') await syncDirectory(fs, root)
}

async function selectedInput(
  fs,
  dialog,
  tempDir,
  name,
  privateOnly,
  verifiedPath
) {
  let selectedPath = verifiedPath
  if (!selectedPath) {
    const result = await dialog.showOpenDialog({
      title: `Choose ${name}`,
      properties: ['openFile'],
    })
    if (result?.canceled || result?.filePaths?.length !== 1)
      fail('File selection cancelled.')
    const [chosenPath] = result.filePaths
    selectedPath = chosenPath
  }
  const {data} = await readPrivateSelectedFile(
    fs,
    selectedPath,
    MAX_FILE_BYTES,
    privateOnly,
    true
  )
  const destination = path.join(tempDir, `input-${name}`)
  try {
    await writePrivateFile(fs, destination, data)
  } finally {
    data.fill(0)
  }
  return destination
}

function safePassphrase(value) {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    value.length < 1 ||
    Buffer.byteLength(value, 'utf8') > 4096
  ) {
    fail('Enter the vault passphrase.')
  }
  return value
}

function preparedSummary(prepared, config, operation, marketVersion = 8) {
  if (/^fod\.prepared-bonded-v[89]-/.test(prepared?.format || '')) {
    if (
      prepared.format !==
        `fod.prepared-bonded-v${marketVersion}-${operation}` ||
      prepared.operation !== operation ||
      prepared.network !== 'idena' ||
      prepared.version !== 1 ||
      prepared.contract !== config.contract ||
      prepared.codeHash !== config.codeHash ||
      !DECIMAL.test(prepared.amount) ||
      prepared.bondedV8?.operation !== operation ||
      (prepared.bondedV8?.protocolVersion || 8) !== marketVersion
    )
      fail('The prepared bonded action does not match this market.')
    return {
      operation,
      amount: prepared.amount,
      terms: {
        id: prepared.bondedV8.id,
        minimum: prepared.bondedV8.minimum,
        maximum: prepared.bondedV8.maximum,
        capacity: prepared.bondedV8.capacity,
        target: prepared.bondedV8.target,
      },
    }
  }

  const expected = OPERATIONS[operation]
  if (
    !expected ||
    prepared?.format !== `fod.prepared-direct-v7-${expected.format}` ||
    prepared.operation !== operation ||
    prepared.directVersion !== 7 ||
    prepared.network !== 'idena' ||
    prepared.contract !== config.contract ||
    prepared.codeHash !== config.codeHash ||
    !DECIMAL.test(prepared.amount) ||
    !HEX32.test(prepared.directOfferId)
  ) {
    fail('The prepared v7 action does not match the local deployment pin.')
  }
  return {
    operation,
    offerId: prepared.directOfferId,
    amount: prepared.amount,
    ...(typeof prepared.price === 'string' && DECIMAL.test(prepared.price)
      ? {price: prepared.price}
      : {}),
  }
}

function inventoryDigest(author, epoch, cids) {
  const epochBytes = Buffer.alloc(2)
  epochBytes.writeUInt16BE(epoch)
  const digest = createHash('sha256')
    .update('fod.bundle-manifest:v1')
    .update(author)
    .update(epochBytes)
  for (const cid of [...cids].sort()) digest.update('\0').update(cid)
  return digest.digest('hex')
}

function previewSession(prepared) {
  const session = prepared.directSession
  const {author, epoch} = prepared
  const cids = session?.manifest
  if (
    prepared.operation !== 'buy' ||
    typeof author !== 'string' ||
    !/^[0-9a-f]{40}$/.test(author) ||
    !Number.isInteger(epoch) ||
    epoch < 1 ||
    epoch > 65535 ||
    session?.author !== author ||
    session?.epoch !== epoch ||
    !Array.isArray(cids) ||
    cids.length < 1 ||
    cids.length > 32 ||
    cids.length !== prepared.coveredFlips ||
    cids.some((cid) => typeof cid !== 'string' || !FLIP_CID.test(cid)) ||
    new Set(cids).size !== cids.length
  ) {
    fail('The saved purchase has no verified public flip inventory.')
  }
  if (inventoryDigest(author, epoch, cids) !== prepared.inventoryCommitment) {
    fail('The saved purchase inventory differs from its commitment.')
  }
  return {author, epoch, cids}
}

async function readPublicMapValue(rpc, contract, prefix, offerId) {
  let token = null
  const seen = new Set()
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    // The pinned node exposes binary map suffixes through this read-only RPC.
    // eslint-disable-next-line no-await-in-loop
    const page = await rpc('contract_iterateMap', [
      `0x${contract}`,
      prefix,
      token,
      'hex',
      'hex',
      100,
    ])
    if (!Array.isArray(page?.items) || page.items.length > 100)
      fail('The public offer inventory could not be read.')
    for (const item of page.items) {
      if (
        typeof item?.key !== 'string' ||
        !HEX32.test(item.key.toLowerCase()) ||
        typeof item?.value !== 'string' ||
        !/^(?:0x)?(?:[0-9a-f]{2})+$/i.test(item.value)
      ) {
        fail('The public offer inventory is invalid.')
      }
      if (item.key.toLowerCase().replace(/^0x/, '') === offerId) {
        return Buffer.from(item.value.replace(/^0x/i, ''), 'hex')
      }
    }
    const next = page.continuationToken
    if (
      next === null ||
      next === undefined ||
      next === '' ||
      /^0x$/i.test(next)
    )
      return null
    if (typeof next !== 'string' || page.items.length === 0 || seen.has(next)) {
      fail('The public offer inventory pagination is invalid.')
    }
    seen.add(next)
    token = next
  }
  fail('The public offer inventory is too large to preview.')
}

async function readPublicField(rpc, contract, key, size) {
  const value = await rpc('contract_readData', [`0x${contract}`, key, 'hex'])
  if (
    typeof value !== 'string' ||
    !new RegExp(`^(?:0x)?[0-9a-f]{${size * 2}}$`, 'i').test(value)
  ) {
    fail('The public market state could not be read.')
  }
  return Buffer.from(value.replace(/^0x/i, ''), 'hex')
}

async function publicOfferSession(rpc, contract, offerId) {
  const offer = await readPublicMapValue(rpc, contract, 'pool/offer/', offerId)
  if (!offer || offer.length !== 222)
    fail('This offer was not found in the market.')
  const author = offer.subarray(0, 20).toString('hex')
  const epoch = offer.readUInt16BE(20)
  const count = offer.readUInt32BE(22)
  const commitment = offer.subarray(26, 58).toString('hex')
  const derived = createHash('sha256')
    .update('fod:pool-offer:v7')
    .update(offer.subarray(0, 22))
    .digest('hex')
  if (derived !== offerId || count < 1 || count > 32 || epoch < 1)
    fail('The offer code does not match the public market record.')
  const inventory = await readPublicMapValue(
    rpc,
    contract,
    'pool/inventory/',
    offerId
  )
  if (!inventory || inventory[0] !== count)
    fail('The offer has no matching public flip inventory.')
  const cids = []
  let position = 1
  for (let index = 0; index < count; index += 1) {
    const length = inventory[position]
    position += 1
    if (length !== 59 || position + length > inventory.length)
      fail('The public flip inventory is invalid.')
    const cid = inventory
      .subarray(position, position + length)
      .toString('ascii')
    if (!FLIP_CID.test(cid) || (index > 0 && cids[index - 1] >= cid))
      fail('The public flip inventory is invalid.')
    cids.push(cid)
    position += length
  }
  if (
    position !== inventory.length ||
    inventoryDigest(author, epoch, cids) !== commitment
  ) {
    fail('The public flip inventory differs from the offer commitment.')
  }
  return {author, epoch, cids, record: offer}
}

function publicJpegDataUrl(value) {
  if (
    typeof value !== 'string' ||
    !/^0x[0-9a-f]+$/i.test(value) ||
    value.length < 12 ||
    value.length > 512 * 1024 + 2 ||
    value.length % 2 !== 0
  ) {
    return null
  }
  const bytes = Buffer.from(value.slice(2), 'hex')
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  ) {
    return null
  }
  return `data:image/jpeg;base64,${bytes.toString('base64')}`
}

function submittedSummary(submitted, config, action, coinbase) {
  if (
    submitted?.format !== 'fod.submitted-transaction' ||
    submitted.version !== 1 ||
    submitted.network !== 'idena' ||
    submitted.contract !== config.contract ||
    submitted.operation !== action.meta.operation ||
    submitted.amount !== action.summary.amount ||
    submitted.maxFee !== action.meta.maxFee ||
    submitted.sender !== coinbase ||
    submitted.broadcast !== true ||
    !/^0x[0-9a-f]{64}$/.test(submitted.txHash || '')
  ) {
    fail('The saved v7 transaction could not be verified.')
  }
  const receipt = submitted.outcome
  let status = 'uncertain'
  if (receipt?.included)
    status = receipt.success === true ? 'included' : 'failed'
  return {
    txHash: submitted.txHash,
    status,
  }
}

function createFodV7Service({
  fs = defaultFs,
  dialog,
  spawn = defaultSpawn,
  root,
  getNodeRpcConnection,
  getActiveCoinbase,
  rpcCall,
  openFolder,
  marketVersion = 7,
  getExplorer = async (route) => (await explorer.get(route)).data,
}) {
  let busy = false
  let verifiedReceipt = null

  async function openSavedFolder(directory) {
    if (typeof openFolder !== 'function') return false
    try {
      return (await openFolder(directory)) === true
    } catch {
      return false
    }
  }

  async function configOrNull() {
    await privateDirectory(fs, root)
    let config
    try {
      config = await privateJSON(
        fs,
        path.join(
          root,
          [8, 9].includes(marketVersion)
            ? `bonded-v${marketVersion}.json`
            : 'config.json'
        )
      )
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
    if (
      !plainObject(config, [
        'contract',
        'codeHash',
        'binaryPath',
        'binarySha256',
        'nonceGuardVersion',
      ]) ||
      hex(config.contract, HEX20) !== config.contract ||
      hex(config.codeHash, HEX32) !== config.codeHash ||
      hex(config.binarySha256, HEX32) !== config.binarySha256 ||
      typeof config.binaryPath !== 'string' ||
      !path.isAbsolute(config.binaryPath)
    )
      fail('Invalid local v7 configuration.')
    if (config.nonceGuardVersion === undefined) {
      await ensureNonceJournal(fs, root)
      config.nonceGuardVersion = 1
      await saveConfig(fs, root, config, marketVersion)
    } else if (config.nonceGuardVersion === 1) {
      await readNonceJournal(fs, root)
    } else {
      fail('Invalid local v7 signing guard.')
    }
    return config
  }

  async function context(config, requireFreeNonce = false) {
    const connection = loopbackConnection(await getNodeRpcConnection())
    const coinbase = hex((await getActiveCoinbase()).toLowerCase(), HEX20)
    const rpc = async (method, params) => {
      const response = await rpcCall(connection, {method, params})
      if (response?.error || response?.result === undefined) {
        fail('The local node could not verify v7 state.')
      }
      return response.result
    }
    const sync = await rpc('bcn_syncing', [])
    const stake = await rpc('contract_getStake', [`0x${config.contract}`])
    const current = hex(
      (await rpc('dna_getCoinbaseAddr', [])).toLowerCase(),
      HEX20
    )
    if (
      sync?.syncing !== false ||
      sync.wrongTime !== false ||
      sync.currentBlock !== sync.highestBlock ||
      current !== coinbase ||
      stake?.Hash?.toLowerCase() !== `0x${config.codeHash}`
    ) {
      fail('The node, active identity, or deployed v7 code is not ready.')
    }
    let account
    let epoch
    if (requireFreeNonce) {
      account = await rpc('dna_getBalance', [`0x${coinbase}`])
      epoch = await rpc('dna_epoch', [])
      if (
        !Number.isSafeInteger(account?.nonce) ||
        account.nonce < 0 ||
        account.nonce >= 2 ** 32 - 1 ||
        account.nonce !== account.mempoolNonce ||
        !Number.isSafeInteger(epoch?.epoch) ||
        epoch.epoch < 0 ||
        epoch.epoch > 65535
      ) {
        fail('Resolve the node account nonce and epoch before signing.')
      }
    }
    return {
      connection,
      coinbase,
      rpc,
      account,
      epoch,
      blockHeight: sync.currentBlock,
    }
  }

  async function withCLI(config, initial, passphrase, command) {
    const tempDir = await fs.promises.realpath(
      await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fod-v7-'))
    )
    await fs.promises.chmod(tempDir, 0o700)
    try {
      const binary = await checkPinnedBinary(
        fs,
        config.binaryPath,
        [config.binarySha256],
        tempDir,
        true
      )
      const rpcFlags = ['-rpc', initial.connection.url]
      if (initial.connection.key) {
        const keyFile = path.join(tempDir, 'rpc.key')
        const bytes = Buffer.from(initial.connection.key, 'utf8')
        try {
          await writePrivateFile(fs, keyFile, bytes)
        } finally {
          bytes.fill(0)
        }
        rpcFlags.push('-key-file', keyFile)
      }
      const args = await command({tempDir, rpcFlags})
      const fresh = await context(config)
      if (
        fresh.coinbase !== initial.coinbase ||
        fresh.connection.url !== initial.connection.url ||
        fresh.connection.key !== initial.connection.key
      ) {
        fail('The active node or identity changed.')
      }
      const env = passphrase
        ? {...process.env, FOD_PASSPHRASE: safePassphrase(passphrase)}
        : process.env
      await runCheck(spawn, binary, args, '', env)
    } finally {
      await fs.promises.rm(tempDir, {recursive: true, force: true})
    }
  }

  async function actionDirectory(coinbase) {
    await privateDirectory(fs, path.join(root, 'actions'))
    return privateDirectory(fs, path.join(root, 'actions', coinbase))
  }

  async function readAction(config, coinbase, actionId, historical = false) {
    if (typeof actionId !== 'string' || !ACTION_ID.test(actionId))
      fail('Invalid saved v7 action.')
    const directory = path.join(await actionDirectory(coinbase), actionId)
    await privateDirectory(fs, directory)
    const meta = await privateJSON(fs, path.join(directory, 'meta.json'))
    const prepared = await privateJSON(
      fs,
      path.join(directory, 'prepared.json'),
      MAX_PREPARED_BYTES
    )
    if (
      meta?.actionId !== actionId ||
      meta?.coinbase !== coinbase ||
      (historical
        ? typeof meta.contract !== 'string' ||
          !HEX20.test(meta.contract) ||
          meta.contract.length !== 40 ||
          typeof meta.codeHash !== 'string' ||
          !HEX32.test(meta.codeHash) ||
          meta.codeHash.length !== 64
        : meta?.contract !== config.contract ||
          meta?.codeHash !== config.codeHash) ||
      !DECIMAL.test(meta?.maxFee || '')
    )
      fail('Invalid saved v7 action.')
    const savedConfig = historical
      ? {contract: meta.contract, codeHash: meta.codeHash}
      : config
    const summary = preparedSummary(
      prepared,
      savedConfig,
      meta.operation,
      marketVersion
    )
    const attempted = await signingAttempted(fs, directory)
    return {
      directory,
      meta,
      prepared,
      summary,
      attempted,
      savedConfig,
      pinChanged:
        meta.contract !== config.contract || meta.codeHash !== config.codeHash,
    }
  }

  async function confirmedSubmission(summary, rpc, contract) {
    try {
      const receipt = await rpc('bcn_txReceipt', [summary.txHash])
      if (
        receipt?.txHash?.toLowerCase() !== summary.txHash ||
        receipt?.contract?.toLowerCase().replace(/^0x/, '') !== contract ||
        typeof receipt?.success !== 'boolean'
      )
        return {...summary, status: 'uncertain'}
      return {...summary, status: receipt.success ? 'included' : 'failed'}
    } catch {
      return {...summary, status: 'uncertain'}
    }
  }

  async function listActions(config, coinbase, rpc) {
    const directory = await actionDirectory(coinbase)
    const entries = await fs.promises.readdir(directory, {withFileTypes: true})
    const actions = []
    for (const entry of entries.filter(
      (item) => item.isDirectory() && ACTION_ID.test(item.name)
    )) {
      try {
        const saved = await readAction(config, coinbase, entry.name, true)
        const signedPath = path.join(saved.directory, 'signed.json')
        let submission = null
        try {
          submission = submittedSummary(
            await privateJSON(fs, signedPath, MAX_SIGNED_BYTES),
            saved.savedConfig,
            saved,
            coinbase
          )
          if (submission.status === 'uncertain') {
            let readRpc = rpc
            if (!readRpc) {
              const current = await context(config)
              if (current.coinbase !== coinbase)
                fail('The active identity changed.')
              readRpc = current.rpc
            }
            submission = await confirmedSubmission(
              submission,
              readRpc,
              saved.savedConfig.contract
            )
          }
        } catch (error) {
          if (error.code !== 'ENOENT') submission = {status: 'uncertain'}
        }
        actions.push({
          actionId: entry.name,
          ...saved.summary,
          maxFee: saved.meta.maxFee,
          submitted: submission,
          attempted: saved.attempted,
          pinChanged: saved.pinChanged,
        })
      } catch {
        // An incomplete local preparation is never offered for signing.
      }
    }
    return actions.reverse()
  }

  async function status() {
    const config = await configOrNull()
    if (!config) return {configured: false, actions: []}
    const coinbase = hex((await getActiveCoinbase()).toLowerCase(), HEX20)
    return {
      configured: true,
      contract: config.contract,
      codeHash: config.codeHash,
      actions: await listActions(config, coinbase),
    }
  }

  async function nextOffer() {
    const config = await configOrNull()
    if (!config) fail('Set the local market deployment pin first.')
    const initial = await context(config)
    const primary = await readPublicField(
      initial.rpc,
      config.contract,
      'pool/primary-head',
      32
    )
    const secondary = await readPublicField(
      initial.rpc,
      config.contract,
      'pool/secondary-head',
      32
    )
    const head = primary.some(Boolean) ? primary : secondary
    if (!head.some(Boolean)) return {available: false}
    const offerId = head.toString('hex')
    const session = await publicOfferSession(
      initial.rpc,
      config.contract,
      offerId
    )
    const offer = session.record
    const publicSeed = offer[221] === 1
    const expectedStatus = primary.some(Boolean) ? 1 : 2
    const sellerBond = BigInt(`0x${offer.subarray(90, 106).toString('hex')}`)
    const openOrder = offer.readBigUInt64BE(114)
    const contentProven = offer[204] === 1
    const everSold = offer[123] === 1
    if (
      offer[122] !== expectedStatus ||
      openOrder !== 0n ||
      offer.readBigUInt64BE(106) === 0n ||
      (publicSeed &&
        (expectedStatus !== 2 ||
          !contentProven ||
          sellerBond !== 0n ||
          offer.subarray(205, 221).some(Boolean))) ||
      (!publicSeed &&
        (sellerBond === 0n ||
          (expectedStatus === 1 && everSold) ||
          (expectedStatus === 2 && (!everSold || !contentProven))))
    ) {
      fail('The next offer does not match the public queue.')
    }
    const [primaryUnits, secondaryUnits, reserve, insurance] =
      await Promise.all([
        readPublicField(initial.rpc, config.contract, 'pool/primary-units', 8),
        readPublicField(
          initial.rpc,
          config.contract,
          'pool/secondary-units',
          8
        ),
        readPublicField(initial.rpc, config.contract, 'pool/reserve', 16),
        readPublicField(initial.rpc, config.contract, 'pool/insurance', 16),
      ])
    const primaryCount = primaryUnits.readBigUInt64BE()
    const secondaryCount = secondaryUnits.readBigUInt64BE()
    const units = primaryCount + secondaryCount
    if (
      (expectedStatus === 1 && primaryCount === 0n) ||
      (expectedStatus === 2 && secondaryCount === 0n)
    ) {
      fail('The next offer does not match the public queue.')
    }
    const pricingReserve =
      BigInt(`0x${reserve.toString('hex')}`) -
      BigInt(`0x${insurance.toString('hex')}`)
    if (units < 1n || units > (1n << 64n) - 11n || pricingReserve < 1n) {
      fail('The market has no valid current quote.')
    }
    const rawPrice = (pricingReserve + units + 8n) / (units + 9n)
    const price = rawPrice > PRICE_CAP ? PRICE_CAP : rawPrice
    if (price < 1n) fail('The market has no valid current quote.')
    const rate = feeRate(await initial.rpc('bcn_feePerGas', []))
    const buyerBond = publicSeed ? 0n : rate * BOND_GAS
    if (buyerBond > (1n << 128n) - 1n) {
      fail('The current fee bond exceeds the contract limit.')
    }
    const bondTopUp =
      !publicSeed && sellerBond < buyerBond ? buyerBond - sellerBond : 0n
    const sync = await initial.rpc('bcn_syncing', [])
    if (
      sync?.syncing !== false ||
      sync.wrongTime !== false ||
      sync.currentBlock !== initial.blockHeight ||
      sync.highestBlock !== sync.currentBlock
    ) {
      fail('The market changed while the next offer was read. Refresh it.')
    }
    return {
      available: true,
      offerId,
      epoch: session.epoch,
      count: session.cids.length,
      publicSeed,
      saleType: expectedStatus === 1 ? 'first-sale' : 'resale',
      price: price.toString(),
      buyerBond: buyerBond.toString(),
      total: (price + buyerBond).toString(),
      bondTopUp: bondTopUp.toString(),
      blockHeight: initial.blockHeight,
    }
  }

  async function sellerQuote() {
    const config = await configOrNull()
    if (!config) fail('Set the local market deployment pin first.')
    const initial = await context(config)
    const [primary, secondary, reserve, insurance] = await Promise.all([
      readPublicField(initial.rpc, config.contract, 'pool/primary-units', 8),
      readPublicField(initial.rpc, config.contract, 'pool/secondary-units', 8),
      readPublicField(initial.rpc, config.contract, 'pool/reserve', 16),
      readPublicField(initial.rpc, config.contract, 'pool/insurance', 16),
    ])
    const queued = primary.readBigUInt64BE() + secondary.readBigUInt64BE()
    const pricingReserve =
      BigInt(`0x${reserve.toString('hex')}`) -
      BigInt(`0x${insurance.toString('hex')}`)
    if (queued > (1n << 64n) - 11n || pricingReserve < 1n)
      fail('The market has no valid current quote.')
    const unitsAfterListing = queued + 1n
    const currentRawPrice = (pricingReserve + queued + 8n) / (queued + 9n)
    const currentPrice =
      currentRawPrice > PRICE_CAP ? PRICE_CAP : currentRawPrice
    const rawPrice =
      (pricingReserve + unitsAfterListing + 8n) / (unitsAfterListing + 9n)
    const price = rawPrice > PRICE_CAP ? PRICE_CAP : rawPrice
    const rate = feeRate(await initial.rpc('bcn_feePerGas', []))
    const sellerBond = rate * BOND_GAS
    const sync = await initial.rpc('bcn_syncing', [])
    if (
      sync?.syncing !== false ||
      sync.wrongTime !== false ||
      sync.currentBlock !== initial.blockHeight ||
      sync.highestBlock !== sync.currentBlock
    )
      fail('The market changed while the seller quote was read. Refresh it.')
    return {
      blockHeight: initial.blockHeight,
      queuedBundles: queued.toString(),
      listedFirstSalePayout: currentPrice.toString(),
      listedResalePayout: (currentPrice / 2n).toString(),
      firstSalePayout: price.toString(),
      resalePayout: (price / 2n).toString(),
      sellerBond: sellerBond.toString(),
    }
  }

  async function myOffers() {
    const config = await configOrNull()
    if (!config) fail('Set the local market deployment pin first.')
    const initial = await context(config)
    const currentEpoch = await initial.rpc('dna_epoch', [])
    if (
      !Number.isSafeInteger(currentEpoch?.epoch) ||
      currentEpoch.epoch < 1 ||
      currentEpoch.epoch > 65535
    )
      fail('The current epoch could not be verified.')
    const {epoch: latestEpoch} = currentEpoch
    const offers = []
    const firstEpoch = Math.max(1, latestEpoch - 7)
    for (let epoch = latestEpoch; epoch >= firstEpoch; epoch -= 1) {
      const epochBytes = Buffer.alloc(2)
      epochBytes.writeUInt16BE(epoch)
      const offerId = createHash('sha256')
        .update('fod:pool-offer:v7')
        .update(Buffer.from(initial.coinbase, 'hex'))
        .update(epochBytes)
        .digest('hex')
      // The contract records one bundle per author and epoch.
      // eslint-disable-next-line no-await-in-loop
      const record = await readPublicMapValue(
        initial.rpc,
        config.contract,
        'pool/offer/',
        offerId
      )
      if (record) {
        if (
          record.length !== 222 ||
          record.subarray(0, 20).toString('hex') !== initial.coinbase ||
          record.readUInt16BE(20) !== epoch ||
          record[122] > 6 ||
          record[204] > 1 ||
          record[221] > 1
        )
          fail('Your public bundle record is invalid.')
        // eslint-disable-next-line no-await-in-loop
        const session = await publicOfferSession(
          initial.rpc,
          config.contract,
          offerId
        )
        offers.push({
          offerId,
          epoch,
          count: session.cids.length,
          status: record[122],
          contentProven: record[204] === 1,
          publicSeed: record[221] === 1,
        })
      }
    }
    const sync = await initial.rpc('bcn_syncing', [])
    if (
      sync?.syncing !== false ||
      sync.wrongTime !== false ||
      sync.currentBlock !== initial.blockHeight ||
      sync.highestBlock !== sync.currentBlock
    )
      fail('The market changed while your bundles were read. Refresh it.')
    return {offers, blockHeight: initial.blockHeight}
  }

  async function purchaseOrder(payload) {
    if (!plainObject(payload, ['actionId']))
      fail('Choose a saved private purchase.')
    const config = await configOrNull()
    if (!config) fail('Set the local market deployment pin first.')
    const initial = await context(config)
    const action = await readAction(config, initial.coinbase, payload.actionId)
    if (action.meta.operation !== 'buy')
      fail('Choose a saved private purchase.')
    const {prepared} = action
    if (
      prepared.buyer !== initial.coinbase ||
      typeof prepared.deliveryKey !== 'string' ||
      !/^[0-9a-f]{130}$/.test(prepared.deliveryKey) ||
      !Number.isSafeInteger(prepared.orderNonce) ||
      prepared.orderNonce < 1
    ) {
      fail('The saved purchase has no valid delivery identity.')
    }
    const {offerId} = action.summary
    const session = await publicOfferSession(
      initial.rpc,
      config.contract,
      offerId
    )
    const {record: offer} = session
    const id = offer.readBigUInt64BE(114)
    if (offer[122] !== 3 || id === 0n)
      fail('This purchase has no active private order.')
    const order = await readPublicField(
      initial.rpc,
      config.contract,
      `pool/order/${id}`,
      215
    )
    const state = order[181]
    if (
      ![1, 4].includes(state) ||
      order.subarray(0, 32).toString('hex') !== offerId ||
      order.subarray(32, 52).toString('hex') !== initial.coinbase ||
      order.subarray(52, 117).toString('hex') !== prepared.deliveryKey ||
      order.readBigUInt64BE(173) !== BigInt(prepared.orderNonce)
    ) {
      fail('The active order does not match this saved purchase.')
    }
    const sync = await initial.rpc('bcn_syncing', [])
    if (
      sync?.syncing !== false ||
      sync.wrongTime !== false ||
      sync.currentBlock !== initial.blockHeight ||
      sync.highestBlock !== sync.currentBlock
    ) {
      fail('The order changed while it was read. Refresh it.')
    }
    return {orderId: id.toString(), state: state === 1 ? 'funded' : 'fallback'}
  }

  async function sellerOrder(payload) {
    if (
      !plainObject(payload, ['offerId']) ||
      typeof payload.offerId !== 'string'
    )
      fail('Enter a seller offer code.')
    const offerId = hex(payload.offerId.toLowerCase(), HEX32)
    const config = await configOrNull()
    if (!config) fail('Set the local market deployment pin first.')
    const initial = await context(config)
    const session = await publicOfferSession(
      initial.rpc,
      config.contract,
      offerId
    )
    if (session.author !== initial.coinbase)
      fail('This offer does not belong to the active identity.')
    const {record: offer} = session
    const id = offer.readBigUInt64BE(114)
    if (offer[122] !== 3 || id === 0n)
      fail('This offer has no funded private order.')
    const order = await readPublicField(
      initial.rpc,
      config.contract,
      `pool/order/${id}`,
      215
    )
    if (order[181] !== 1 || order.subarray(0, 32).toString('hex') !== offerId) {
      fail('The funded order does not match this offer.')
    }
    const sync = await initial.rpc('bcn_syncing', [])
    if (
      sync?.syncing !== false ||
      sync.wrongTime !== false ||
      sync.currentBlock !== initial.blockHeight ||
      sync.highestBlock !== sync.currentBlock
    ) {
      fail('The order changed while it was read. Refresh it.')
    }
    return {orderId: id.toString(), state: 'funded'}
  }

  async function preview(payload) {
    if (
      !plainObject(payload, ['actionId', 'offerId', 'includeImages']) ||
      Boolean(payload.actionId) === Boolean(payload.offerId) ||
      (payload.includeImages !== undefined &&
        typeof payload.includeImages !== 'boolean')
    )
      fail('Invalid market preview request.')
    const config = await configOrNull()
    if (!config) fail('Set the local market deployment pin first.')
    let session
    if (payload.actionId) {
      const coinbase = hex((await getActiveCoinbase()).toLowerCase(), HEX20)
      const action = await readAction(config, coinbase, payload.actionId)
      if (action.pinChanged)
        fail('This purchase belongs to a previous deployment.')
      session = previewSession(action.prepared)
    } else {
      const offerId = hex(payload.offerId.toLowerCase(), HEX32)
      const initial = await context(config)
      session = await publicOfferSession(initial.rpc, config.contract, offerId)
    }
    const {author, epoch, cids} = session
    const selected = cids.slice(0, PREVIEW_FLIPS)
    if (payload.includeImages !== true) {
      return {
        count: cids.length,
        flips: selected.map((cid) => ({cid, images: []})),
      }
    }
    let records
    try {
      const page = await getExplorer(
        `Epoch/${epoch}/Identity/0x${author}/Flips?limit=100`
      )
      records = Array.isArray(page?.result) ? page.result : []
    } catch {
      records = []
    }
    const listed = new Set(
      records
        .filter(
          (record) =>
            record &&
            record.epoch === epoch &&
            String(record.author || '')
              .replace(/^0x/i, '')
              .toLowerCase() === author &&
            selected.includes(record.cid)
        )
        .map((record) => record.cid)
    )
    const flips = await Promise.all(
      selected.map(async (cid) => {
        if (!listed.has(cid)) return {cid, images: []}
        try {
          const content = await getExplorer(`Flip/${cid}/Content`)
          const pictures = content?.result?.pics
          const images =
            Array.isArray(pictures) && pictures.length === 2
              ? pictures.map(publicJpegDataUrl)
              : []
          return {cid, images: images.every(Boolean) ? images : []}
        } catch {
          return {cid, images: []}
        }
      })
    )
    return {count: cids.length, flips}
  }

  async function chooseBinary() {
    const choice = await dialog.showOpenDialog({
      title: 'Choose the separately built Flips on Demand tool',
      properties: ['openFile'],
    })
    if (choice?.canceled) return {path: ''}
    if (
      choice?.filePaths?.length !== 1 ||
      !path.isAbsolute(choice.filePaths[0])
    ) {
      fail('Choose one local Flips on Demand tool file.')
    }
    return {path: choice.filePaths[0]}
  }

  async function configure(payload) {
    if (
      !plainObject(payload, [
        'contract',
        'codeHash',
        'binaryPath',
        'binarySha256',
      ])
    ) {
      fail('Invalid v7 configuration.')
    }
    const config = {
      contract: hex(payload.contract?.toLowerCase(), HEX20),
      codeHash: hex(payload.codeHash?.toLowerCase(), HEX32),
      binaryPath: payload.binaryPath,
      binarySha256: hex(payload.binarySha256?.toLowerCase(), HEX32),
    }
    if (
      typeof config.binaryPath !== 'string' ||
      !path.isAbsolute(config.binaryPath)
    ) {
      fail('Choose an absolute path to the locally built v7 CLI.')
    }
    await checkPinnedBinary(
      fs,
      config.binaryPath,
      [config.binarySha256],
      undefined,
      true
    )
    await context(config)
    await privateDirectory(fs, root)
    await configOrNull()
    await ensureNonceJournal(fs, root)
    config.nonceGuardVersion = 1
    await saveConfig(fs, root, config, marketVersion)
    return status()
  }

  async function prepare(payload) {
    if (
      !plainObject(payload, [
        'operation',
        'offerId',
        'orderId',
        'maxFee',
        'minimumPayout',
        'amount',
        'sealedFallback',
        'passphrase',
        'receiptId',
      ])
    )
      fail('Invalid v7 preparation request.')
    const spec = OPERATIONS[payload.operation]
    if (!spec) fail('Unsupported v7 operation.')
    const maxFee = positiveDecimal(payload.maxFee, MAX_FEE)
    const offer = OFFER_OPERATIONS.has(payload.operation)
      ? hex(payload.offerId, HEX32)
      : ''
    const order = ORDER_OPERATIONS.has(payload.operation)
      ? orderId(payload.orderId)
      : ''
    if (
      payload.receiptId !== undefined &&
      (payload.operation !== 'confirm' ||
        typeof payload.receiptId !== 'string' ||
        !RECEIPT_ID.test(payload.receiptId))
    ) {
      fail('Invalid verified receipt reference.')
    }
    const minimumPayout =
      payload.minimumPayout === undefined || payload.minimumPayout === ''
        ? '0'
        : positiveDecimal(payload.minimumPayout, (1n << 128n) - 1n)
    const amount =
      payload.operation === 'topUpBond'
        ? positiveDecimal(payload.amount, (1n << 128n) - 1n)
        : '0'
    if (spec.passphrase) safePassphrase(payload.passphrase)
    if (
      payload.sealedFallback !== undefined &&
      (payload.operation !== 'startFallback' ||
        typeof payload.sealedFallback !== 'boolean')
    ) {
      fail('Invalid v7 fallback selection.')
    }
    const config = await configOrNull()
    if (!config) fail('Set the local v7 deployment pin first.')
    const initial = await context(config)
    if (
      payload.receiptId &&
      (!verifiedReceipt ||
        verifiedReceipt.id !== payload.receiptId ||
        verifiedReceipt.coinbase !== initial.coinbase ||
        verifiedReceipt.contract !== config.contract ||
        verifiedReceipt.codeHash !== config.codeHash ||
        verifiedReceipt.orderId !== order)
    ) {
      fail('The verified receipt does not match this order and identity.')
    }
    const actionId = `v7-${randomBytes(16).toString('hex')}`
    const directory = path.join(
      await actionDirectory(initial.coinbase),
      actionId
    )
    await fs.promises.mkdir(directory, {mode: 0o700})
    if (process.platform === 'win32') {
      await writePrivateFile(fs, path.join(directory, ATTEMPT_GUARD), '')
    }
    const preparedPath = path.join(directory, 'prepared.json')
    await withCLI(
      config,
      initial,
      payload.passphrase,
      async ({tempDir, rpcFlags}) => {
        const args = [
          'direct-v7-prepare',
          '-direct-version',
          '7',
          '-network',
          'idena',
          ...rpcFlags,
          '-contract',
          config.contract,
          '-code-hash',
          config.codeHash,
          '-max-fee',
          maxFee,
          '-operation',
          payload.operation,
          '-prepared',
          preparedPath,
        ]
        if (offer) args.push('-v7-offer-id', offer)
        if (order) args.push('-order', order)
        if (payload.operation === 'list' || payload.operation === 'relist') {
          args.push('-minimum-payout', minimumPayout)
        }
        if (payload.operation === 'topUpBond') args.push('-amount', amount)
        const files = [...(spec.files || [])]
        if (payload.operation === 'startFallback' && payload.sealedFallback) {
          files.push('session', 'proof', 'registration-host')
        }
        for (const name of files) {
          const input = await selectedInput(
            fs,
            dialog,
            tempDir,
            name,
            ['vault', 'delivery'].includes(name),
            name === 'delivery' && payload.receiptId
              ? verifiedReceipt.path
              : undefined
          )
          args.push(`-${name}`, input)
        }
        if (payload.operation === 'buy') {
          args.push('-delivery-key', path.join(directory, 'delivery.key'))
        }
        return args
      }
    )
    const prepared = await privateJSON(fs, preparedPath, MAX_PREPARED_BYTES)
    const summary = preparedSummary(
      prepared,
      config,
      payload.operation,
      marketVersion
    )
    await writePrivateFile(
      fs,
      path.join(directory, 'meta.json'),
      JSON.stringify({
        actionId,
        coinbase: initial.coinbase,
        contract: config.contract,
        codeHash: config.codeHash,
        operation: payload.operation,
        maxFee,
      })
    )
    await syncActionDirectories(fs, directory, root)
    return {actionId, ...summary, maxFee}
  }

  async function submit(payload, automatic = null) {
    if (
      !plainObject(
        payload,
        marketVersion === 9 ? ['actionId', 'passphrase'] : ['actionId']
      )
    )
      fail('Invalid v7 submission request.')
    const config = await configOrNull()
    if (!config) fail('Set the local v7 deployment pin first.')
    const initial = await context(config, true)
    const action = await readAction(config, initial.coinbase, payload.actionId)
    if (action.attempted) {
      fail(
        'This v7 action has already had a signing attempt. Check its transaction before preparing a new action.'
      )
    }
    const signingPassphrase =
      marketVersion === 9 && action.meta.operation === 'queueSell'
        ? safePassphrase(automatic?.passphrase || payload.passphrase)
        : ''
    const attached = action.summary.amount
    const isOrder =
      [8, 9].includes(marketVersion) &&
      ['queueBuy', 'queueSell'].includes(action.meta.operation)
    const checkOrderPermission = () => {
      if (!automatic || !isOrder) return
      const limits = automatic.orderLimits
      const value =
        action.meta.operation === 'queueBuy'
          ? action.summary.terms.maximum
          : action.summary.terms.capacity
      if (
        !limits ||
        automatic.requestedOrderId !== payload.actionId ||
        !/^[1-9][0-9]*$/.test(value || '') ||
        BigInt(value) > limits.perTrade ||
        (action.meta.operation === 'queueBuy' &&
          (attached !== value || BigInt(value) > limits.purchaseRemaining))
      )
        fail('This order exceeds the approved one-click trading limits.')
    }
    checkOrderPermission()
    if (
      BigInt(attached) + BigInt(action.meta.maxFee) >
      idnaAtoms(initial.account.balance)
    ) {
      fail('The active identity has insufficient spendable balance.')
    }
    let effect = 'Check the current state before confirming.'
    if ([8, 9].includes(marketVersion)) {
      effect =
        action.meta.operation === 'addReserve'
          ? 'This adds a permanent reserve contribution without a withdrawal share.'
          : 'Both stakes cover the full trade volume. Seller proceeds stay pending until verified delivery. A failed dispute can reduce stake and pause new trades.'
    } else if (OPERATIONS[action.meta.operation].disclosure) {
      effect = 'This action publishes the bundle keys on-chain.'
    } else if (action.meta.operation === 'activate') {
      effect =
        'Activation permanently locks 10,000 iDNA without a redeemable share.'
    } else if (action.meta.operation === 'cancel') {
      effect = 'Cancellation can forfeit fraud collateral.'
    } else if (action.meta.operation === 'buyPublicSeed') {
      effect =
        'These keys are already public. Buying settles immediately, with no private delivery or dispute.'
    } else if (action.meta.operation === 'buy') {
      effect =
        'This funds a private order. Verify the delivered ciphertext before confirming.'
    } else if (OPERATIONS[action.meta.operation].irreversible) {
      effect = 'This action has an irreversible contract effect.'
    }
    const details = []
    if (action.meta.operation === 'buy' && action.summary.price) {
      const buyerBond = BigInt(attached) - BigInt(action.summary.price)
      if (buyerBond >= 0n) {
        details.push(`Price: ${formatIdnaAtoms(action.summary.price)}`)
        details.push(`Buyer bond: ${formatIdnaAtoms(buyerBond.toString())}`)
      }
    }
    details.push(`Total attached: ${formatIdnaAtoms(attached)}`)
    details.push('App fee: 0 iDNA')
    details.push(`Maximum network fee: ${formatIdnaAtoms(action.meta.maxFee)}`)
    details.push(
      `Maximum funds needed: ${formatIdnaAtoms(
        BigInt(attached) + BigInt(action.meta.maxFee)
      )}`
    )
    details.push(
      `Exact base units: attached ${attached}; fee cap ${action.meta.maxFee}`
    )
    details.push(effect)
    if (
      automatic &&
      (![8, 9].includes(marketVersion) ||
        automatic.coinbase !== initial.coinbase ||
        automatic.contract !== config.contract ||
        automatic.codeHash !== config.codeHash ||
        automatic.expires < Date.now() ||
        !automatic.operations.has(action.meta.operation) ||
        BigInt(action.meta.maxFee) > automatic.remainingFee)
    )
      fail(
        'Automatic trading permission expired or does not cover this action.'
      )
    const confirmation = automatic
      ? {response: 1}
      : await dialog.showMessageBox({
          type: 'warning',
          title: 'Flips on Demand · Review transaction',
          message: `Sign and broadcast ${
            OPERATION_LABELS[action.meta.operation] || action.meta.operation
          }?`,
          detail: details.join('\n'),
          buttons: ['Cancel', 'Sign and broadcast'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        })
    if (confirmation.response !== 1) return {status: 'cancelled'}
    const nodeKey = automatic
      ? {filePaths: [automatic.keyPath]}
      : await dialog.showOpenDialog({
          title: 'Choose the active Idena nodekey',
          properties: ['openFile'],
        })
    if (nodeKey?.canceled || nodeKey?.filePaths?.length !== 1)
      return {status: 'cancelled'}
    const keyPath = nodeKey.filePaths[0]
    const selectedKey = await readPrivateSelectedFile(
      fs,
      keyPath,
      1024,
      true,
      true
    )
    let selectedSender
    try {
      selectedSender = nodekeyAddress(selectedKey.data)
    } finally {
      selectedKey.data.fill(0)
    }
    if (selectedSender !== initial.coinbase) {
      fail('The selected nodekey does not control the active identity.')
    }
    let fresh
    await withNonceLock(fs, root, async () => {
      fresh = await context(config, true)
      if (
        fresh.coinbase !== initial.coinbase ||
        fresh.connection.url !== initial.connection.url ||
        fresh.connection.key !== initial.connection.key
      ) {
        fail('The active node or identity changed.')
      }
      if (
        BigInt(attached) + BigInt(action.meta.maxFee) >
        idnaAtoms(fresh.account.balance)
      ) {
        fail('The active identity has insufficient spendable balance.')
      }
      if (automatic) {
        if (
          automatic.expires < Date.now() ||
          BigInt(action.meta.maxFee) > automatic.remainingFee
        )
          fail('Automatic trading budget exhausted.')
        checkOrderPermission()
        if (isOrder && action.meta.operation === 'queueBuy')
          automatic.orderLimits.purchaseRemaining -= BigInt(attached)
        automatic.remainingFee -= BigInt(action.meta.maxFee)
      }
      const accountNonce = fresh.account.nonce + 1
      await checkNonceReservations(fs, root, fresh.coinbase, accountNonce)
      await appendNonceJournal(fs, root, {
        coinbase: fresh.coinbase,
        accountNonce,
        actionId: payload.actionId,
        contract: config.contract,
        codeHash: config.codeHash,
      })
      await writePrivateFile(
        fs,
        path.join(action.directory, 'attempt.json'),
        JSON.stringify({at: new Date().toISOString(), accountNonce})
      )
      if (process.platform === 'win32') {
        await markWindowsSigningAttempt(fs, action.directory)
      } else {
        await syncDirectory(fs, action.directory)
      }
    })
    let error
    try {
      await withCLI(
        config,
        fresh,
        signingPassphrase,
        async ({tempDir, rpcFlags}) => {
          const {data} = await readPrivateSelectedFile(
            fs,
            keyPath,
            1024,
            true,
            true
          )
          const copiedKey = path.join(tempDir, 'nodekey')
          try {
            if (nodekeyAddress(data) !== fresh.coinbase) {
              fail('The selected nodekey changed before signing.')
            }
            await writePrivateFile(fs, copiedKey, data)
          } finally {
            data.fill(0)
          }
          return [
            'submit',
            '-prepared',
            path.join(action.directory, 'prepared.json'),
            '-nodekey',
            copiedKey,
            '-nonce',
            String(fresh.account.nonce + 1),
            '-tx-epoch',
            String(fresh.epoch.epoch),
            '-max-fee',
            action.meta.maxFee,
            '-contract',
            config.contract,
            '-code-hash',
            config.codeHash,
            ...rpcFlags,
            '-signed',
            path.join(action.directory, 'signed.json'),
            '-broadcast',
          ]
        }
      )
    } catch (cause) {
      error = cause
    }
    try {
      const signed = await privateJSON(
        fs,
        path.join(action.directory, 'signed.json'),
        MAX_SIGNED_BYTES
      )
      return {
        actionId: payload.actionId,
        ...submittedSummary(signed, config, action, fresh.coinbase),
      }
    } catch (cause) {
      if (error)
        fail(
          'Signing stopped. Inspect the active node and saved action before preparing another call.'
        )
      throw cause
    }
  }

  async function check(payload) {
    if (!plainObject(payload, ['actionId'])) fail('Invalid v7 status request.')
    const config = await configOrNull()
    if (!config) fail('Set the local v7 deployment pin first.')
    const initial = await context(config)
    const action = await readAction(
      config,
      initial.coinbase,
      payload.actionId,
      true
    )
    const signed = await privateJSON(
      fs,
      path.join(action.directory, 'signed.json'),
      MAX_SIGNED_BYTES
    )
    const summary = submittedSummary(
      signed,
      action.savedConfig,
      action,
      initial.coinbase
    )
    return confirmedSubmission(
      summary,
      initial.rpc,
      action.savedConfig.contract
    )
  }

  async function privateMessage(payload) {
    if (!plainObject(payload, ['orderId', 'passphrase']))
      fail('Invalid private delivery request.')
    const order = orderId(payload.orderId)
    safePassphrase(payload.passphrase)
    const config = await configOrNull()
    if (!config) fail('Set the local v7 deployment pin first.')
    const initial = await context(config)
    const directory = path.join(
      await actionDirectory(initial.coinbase),
      `v7-${randomBytes(16).toString('hex')}`
    )
    await fs.promises.mkdir(directory, {mode: 0o700})
    await withCLI(
      config,
      initial,
      payload.passphrase,
      async ({tempDir, rpcFlags}) => {
        const vault = await selectedInput(fs, dialog, tempDir, 'vault', true)
        return [
          'direct-v7-dm',
          '-direct-version',
          '7',
          '-network',
          'idena',
          ...rpcFlags,
          '-contract',
          config.contract,
          '-code-hash',
          config.codeHash,
          '-order',
          order,
          '-vault',
          vault,
          '-out',
          path.join(directory, 'ciphertext.json'),
        ]
      }
    )
    return {
      status: 'saved',
      fileName: 'ciphertext.json',
      folderOpened: await openSavedFolder(directory),
    }
  }

  async function receive(payload) {
    if (!plainObject(payload, ['actionId', 'orderId', 'passphrase'])) {
      fail('Invalid v7 receipt request.')
    }
    const order = orderId(payload.orderId)
    safePassphrase(payload.passphrase)
    const config = await configOrNull()
    if (!config) fail('Set the local v7 deployment pin first.')
    const initial = await context(config)
    const action = await readAction(config, initial.coinbase, payload.actionId)
    if (action.meta.operation !== 'buy')
      fail('Choose a saved private v7 purchase.')
    const directory = path.join(
      await actionDirectory(initial.coinbase),
      `v7-${randomBytes(16).toString('hex')}`
    )
    await fs.promises.mkdir(directory, {mode: 0o700})
    await withCLI(
      config,
      initial,
      payload.passphrase,
      async ({tempDir, rpcFlags}) => {
        const message = await selectedInput(
          fs,
          dialog,
          tempDir,
          'message',
          true
        )
        return [
          'direct-v7-receive',
          '-direct-version',
          '7',
          '-network',
          'idena',
          ...rpcFlags,
          '-contract',
          config.contract,
          '-code-hash',
          config.codeHash,
          '-order',
          order,
          '-message',
          message,
          '-purchase',
          path.join(action.directory, 'prepared.json'),
          '-delivery-key',
          path.join(action.directory, 'delivery.key'),
          '-vault',
          path.join(directory, 'buyer-vault.age'),
          '-out',
          path.join(directory, 'receipt.json'),
        ]
      }
    )
    const receipt = await privateJSON(fs, path.join(directory, 'receipt.json'))
    if (
      receipt?.format !== 'fod.opened-direct-delivery' ||
      receipt.version !== 1 ||
      receipt.contract !== config.contract ||
      receipt.offerId !== action.summary.offerId ||
      !Number.isSafeInteger(receipt.orderId) ||
      String(receipt.orderId) !== order ||
      receipt.buyer !== initial.coinbase ||
      receipt.deliveryKey !== action.prepared.deliveryKey ||
      receipt.orderNonce !== action.prepared.orderNonce ||
      !Number.isInteger(receipt.usableFlips) ||
      receipt.usableFlips < 1 ||
      receipt.usableFlips > 32
    )
      fail('The verified v7 receipt could not be read.')
    const receiptId = `v7-receipt-${randomBytes(16).toString('hex')}`
    verifiedReceipt = {
      id: receiptId,
      path: path.join(directory, 'receipt.json'),
      coinbase: initial.coinbase,
      contract: config.contract,
      codeHash: config.codeHash,
      orderId: order,
    }
    return {
      status: 'verified',
      usableFlips: receipt.usableFlips,
      receiptId,
      folderOpened: await openSavedFolder(directory),
    }
  }

  const bonded = [8, 9].includes(marketVersion)
    ? createBondedMarket({
        marketVersion,
        fs,
        root,
        dialog,
        configOrNull,
        configure,
        context,
        withCLI,
        actionDirectory,
        privateDirectory,
        privateJSON,
        writePrivateFile,
        syncActionDirectories,
        preparedSummary: (p, c, op) => preparedSummary(p, c, op, marketVersion),
        submit,
        check,
        listActions,
        nodekeyAddress,
        readPrivateSelectedFile,
        readAction,
      })
    : null

  async function perform(method, payload) {
    if (method === 'preview') return preview(payload)
    if (!bonded && method === 'status') return status()
    if (!bonded && method === 'nextOffer') return nextOffer()
    if (!bonded && method === 'sellerQuote') return sellerQuote()
    if (!bonded && method === 'myOffers') return myOffers()
    if (busy) fail('A v7 action is already in progress.')
    busy = true
    try {
      if (bonded) return await bonded(method, payload)
      switch (method) {
        case 'chooseBinary':
          return await chooseBinary()
        case 'status':
          return await status()
        case 'nextOffer':
          return await nextOffer()
        case 'purchaseOrder':
          return await purchaseOrder(payload)
        case 'sellerOrder':
          return await sellerOrder(payload)
        case 'configure':
          return await configure(payload)
        case 'prepare':
          return await prepare(payload)
        case 'submit':
          return await submit(payload)
        case 'check':
          return await check(payload)
        case 'privateMessage':
          return await privateMessage(payload)
        case 'receive':
          return await receive(payload)
        default:
          fail('Unsupported v7 action.')
      }
    } finally {
      busy = false
    }
  }

  // Keep an explicitly enabled grant running when the user leaves the market
  // page. The same busy guard serializes background and interactive actions.
  if (bonded) {
    const timer = setInterval(() => {
      if (!busy) perform('tick').catch(() => {})
    }, 30000)
    timer.unref?.()
  }
  return perform
}

module.exports = {createFodV7Service}
