/* eslint-disable no-bitwise */

const {spawn: defaultSpawn} = require('child_process')
const {createECDH, createHash, randomBytes} = require('crypto')
const defaultFs = require('fs')
const os = require('os')
const path = require('path')
const {TextDecoder, isDeepStrictEqual} = require('util')

// The deployment pins are public release data, never supplied by a message.
const CONTRACT = '0xe86d31069194690b1a818f24912bafdacfb29f19'
const CODE_HASH =
  '0x9ee10f3588bd403460ff6149016a3e4544df5c2ef02f6e6123a5cd75588f3319'
const DIRECT_V3_CONTRACT = '0x6bc41502f4611d041a986cda580209d7f5a4e0d4'
const DIRECT_V3_CODE_HASH =
  '0x24221880179c31a21e183221e13d2456b222a71b12e874b288504748aaca38e1'
const DIRECT_V3_BINARY_SHA256 =
  'b79adcdb8fe8ab4ceedf20a4272cff3af37103be8725ca5d437adc2394f6c086'
const DIRECT_V4_CONTRACT = '0x3730be2217b0de1fdfe73098d37f3174dd9748cb'
const DIRECT_V4_CODE_HASH =
  '0x8b9fd14f9c08708db1ab25d90396563d3efe6bed6843c5aae15932d68bdf614c'
const DIRECT_V4_BINARY_SHA256_BY_PLATFORM = Object.freeze({
  'linux-x64': 'c5d5c3607ef2946782dd0955a3cfd3467be88fd0c0a784a593b713d458a83867',
  'darwin-arm64': '8579f67529572f180a521a2978f2b92fbad4f4ed0793d1ca500dc390f1a9bac9',
})
const DIRECT_V4_BUY_BINARY_SHA256_BY_PLATFORM = Object.freeze({
  'linux-x64': '8606243ff2528026cacc9cb6bbe75907657cc99cbe903f2a3d17c87a6888e776',
  'darwin-arm64': '062a96b5f5b91612836d4270e2233bd9b730c32ea53d1bd2c7b7459d7b8b562f',
})
const CODE_HASH_BY_CONTRACT = Object.freeze({
  [CONTRACT.slice(2)]: CODE_HASH,
  [DIRECT_V3_CONTRACT.slice(2)]: DIRECT_V3_CODE_HASH,
  [DIRECT_V4_CONTRACT.slice(2)]: DIRECT_V4_CODE_HASH,
})
const MAX_MESSAGE_BYTES = 2048
const MAX_PURCHASE_BYTES = 16 * 1024 * 1024
const MAX_SESSION_BYTES = 2 * 1024 * 1024
const MAX_DELIVERY_KEY_BYTES = 128
const MAX_RESULT_BYTES = 4096
const MAX_RECEIPT_BYTES = 8192
const MAX_MARKET_BYTES = 4 * 1024 * 1024
const MAX_CHILD_OUTPUT_BYTES = 64 * 1024
const CHILD_TIMEOUT_MS = 180000
const MAX_UINT64 = (1n << 64n) - 1n
const MAX_DIRECT_BUY_FEE_ATOMS = 20n * 10n ** 18n

// This is the compact JSON emitted by FoD's DirectDMEnvelope v2. Matching
// the complete text rejects reordered, missing, repeated, and unknown fields,
// while preserving the full unsigned 64-bit order ID as a decimal string.
const MESSAGE_PATTERN =
  /^\{"format":"fod\.direct-delivery","version":2,"network":"idena","contract":"([0-9a-f]{40})","author":"([0-9a-f]{40})","offerId":"([0-9a-f]{64})","orderId":([1-9][0-9]{0,19}),"orderNonce":([1-9][0-9]{0,19}),"buyer":"([0-9a-f]{40})","deliveryKey":"(04[0-9a-f]{128})","ciphertext":"([0-9a-f]{438})"\}$/

// FoD writes this display-only struct with JSON indentation. A complete
// match keeps orderId lossless and rejects any extra fields or private data.
const RESULT_PATTERN =
  /^\s*\{\s*"format"\s*:\s*"fod\.direct-check"\s*,\s*"version"\s*:\s*1\s*,\s*"contract"\s*:\s*"([0-9a-f]{40})"\s*,\s*"orderId"\s*:\s*([1-9][0-9]{0,19})\s*,\s*"author"\s*:\s*"([0-9a-f]{40})"\s*,\s*"epoch"\s*:\s*(0|[1-9][0-9]{0,4})\s*,\s*"usableFlips"\s*:\s*([1-9][0-9]{0,2})\s*\}\s*$/

// FoD's signed DirectOpenedDelivery is written in this struct order. A full
// match preserves the uint64 order ID and excludes repeated or extra fields.
const RECEIPT_PATTERN = new RegExp(
  [
    '^\\s*\\{\\s*"format"\\s*:\\s*"fod\\.opened-direct-delivery"\\s*,',
    '"version"\\s*:\\s*1\\s*,',
    '"contract"\\s*:\\s*"([0-9a-f]{40})"\\s*,',
    '"offerId"\\s*:\\s*"[0-9a-f]{64}"\\s*,',
    '"orderId"\\s*:\\s*([1-9][0-9]{0,19})\\s*,',
    '"orderNonce"\\s*:\\s*[1-9][0-9]{0,19}\\s*,',
    '"buyer"\\s*:\\s*"([0-9a-f]{40})"\\s*,',
    '"deliveryKey"\\s*:\\s*"04[0-9a-f]{128}"\\s*,',
    '"author"\\s*:\\s*"([0-9a-f]{40})"\\s*,',
    '"epoch"\\s*:\\s*(0|[1-9][0-9]{0,4})\\s*,',
    '"inventoryCommitment"\\s*:\\s*"[0-9a-f]{64}"\\s*,',
    '"keyCommitment"\\s*:\\s*"[0-9a-f]{64}"\\s*,',
    '"ciphertext"\\s*:\\s*"[0-9a-f]{438}"\\s*,',
    '"usableFlips"\\s*:\\s*([1-9][0-9]{0,2})\\s*,',
    '"contentCheckSignature"\\s*:\\s*"[0-9a-f]{130}"\\s*\\}\\s*$',
  ].join('\\s*')
)

class DirectCheckError extends Error {
  constructor(code) {
    super(code)
    this.name = 'DirectCheckError'
  }
}

function refuse(code) {
  throw new DirectCheckError(code)
}

function isUint64(value) {
  return global.BigInt(value) <= MAX_UINT64
}

function parseMessage(payload) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(payload)) ||
    Reflect.ownKeys(payload).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(payload, 'message') ||
    !Object.getOwnPropertyDescriptor(payload, 'message').value ||
    typeof payload.message !== 'string' ||
    Buffer.byteLength(payload.message, 'utf8') > MAX_MESSAGE_BYTES
  ) {
    refuse('fod_direct_check_invalid_message')
  }

  const match = MESSAGE_PATTERN.exec(payload.message)
  if (
    !match ||
    !CODE_HASH_BY_CONTRACT[match[1]] ||
    !isUint64(match[4]) ||
    !isUint64(match[5]) ||
    /^0+$/.test(match[2]) ||
    /^0+$/.test(match[3]) ||
    /^0+$/.test(match[6])
  ) {
    refuse('fod_direct_check_invalid_message')
  }

  return {
    contract: match[1],
    codeHash: CODE_HASH_BY_CONTRACT[match[1]],
    author: match[2],
    orderId: match[4],
    buyer: match[6],
  }
}

function parseReceivePayload(payload) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(payload)) ||
    Reflect.ownKeys(payload).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(payload, 'message') ||
    !Object.prototype.hasOwnProperty.call(payload, 'passphrase')
  ) {
    refuse('fod_direct_receive_invalid_message')
  }
  const messageValue = Object.getOwnPropertyDescriptor(payload, 'message').value
  const passphrase = Object.getOwnPropertyDescriptor(
    payload,
    'passphrase'
  ).value
  let message
  try {
    message = parseMessage({message: messageValue})
  } catch {
    refuse('fod_direct_receive_invalid_message')
  }
  if (
    typeof passphrase !== 'string' ||
    passphrase.includes('\0') ||
    passphrase.trim().length === 0 ||
    Buffer.byteLength(passphrase, 'utf8') > 4096 ||
    [...passphrase].length < 12 ||
    [...passphrase].length > 512
  ) {
    refuse('fod_direct_receive_invalid_passphrase')
  }
  return {message, messageText: messageValue, passphrase}
}

function normalizeCoinbase(value) {
  if (typeof value !== 'string') refuse('fod_direct_check_identity_unavailable')
  const address = value.replace(/^0x/i, '').toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(address) || /^0+$/.test(address)) {
    refuse('fod_direct_check_identity_unavailable')
  }
  return address
}

function normalizeConnection(value) {
  if (!value || typeof value !== 'object') {
    refuse('fod_direct_check_identity_unavailable')
  }
  const {url, key = ''} = value
  if (
    typeof url !== 'string' ||
    !url ||
    url !== url.trim() ||
    url.length > 2048 ||
    typeof key !== 'string' ||
    Buffer.byteLength(key, 'utf8') > 4096 ||
    key.includes('\0')
  ) {
    refuse('fod_direct_check_identity_unavailable')
  }
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    refuse('fod_direct_check_identity_unavailable')
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(
    parsed.hostname
  )
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    (parsed.protocol === 'http:' && !loopback) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    refuse('fod_direct_check_identity_unavailable')
  }
  return {url, key}
}

function sameConnection(left, right) {
  return left.url === right.url && left.key === right.key
}

async function activeIdentity(getNodeRpcConnection, getActiveCoinbase) {
  const connection = normalizeConnection(await getNodeRpcConnection())
  const coinbase = normalizeCoinbase(await getActiveCoinbase())
  const after = normalizeConnection(await getNodeRpcConnection())
  if (!sameConnection(connection, after)) {
    refuse('fod_direct_check_identity_changed')
  }
  return {connection, coinbase}
}

async function pickFile(dialog, title) {
  const selection = await dialog.showOpenDialog({
    title,
    properties: ['openFile'],
  })
  if (selection?.canceled || selection?.filePaths?.length !== 1) {
    refuse('fod_direct_check_cancelled')
  }
  return selection.filePaths[0]
}

async function readBounded(handle, maxBytes) {
  const chunks = []
  let total = 0
  try {
    while (total <= maxBytes) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - total))
      const {bytesRead} = await handle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      total += bytesRead
      chunks.push(buffer.subarray(0, bytesRead))
      if (total > maxBytes) refuse('fod_direct_check_invalid_file')
    }
    if (total === 0) refuse('fod_direct_check_invalid_file')
    return Buffer.concat(chunks, total)
  } finally {
    chunks.forEach((chunk) => chunk.fill(0))
  }
}

async function readPrivateSelectedFile(
  fs,
  selectedPath,
  maxBytes,
  requirePrivate = true
) {
  if (typeof selectedPath !== 'string' || !path.isAbsolute(selectedPath)) {
    refuse('fod_direct_check_invalid_file')
  }
  const absolute = path.resolve(selectedPath)
  const resolved = await fs.promises.realpath(selectedPath)
  if (resolved !== absolute || !fs.constants.O_NOFOLLOW) {
    refuse('fod_direct_check_invalid_file')
  }
  const before = await fs.promises.lstat(selectedPath)
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size < 1 ||
    before.size > maxBytes ||
    (requirePrivate &&
      process.platform !== 'win32' &&
      (before.mode & 0o077) !== 0)
  ) {
    refuse('fod_direct_check_invalid_file')
  }
  const flags =
    fs.constants.O_RDONLY |
    fs.constants.O_NOFOLLOW |
    (fs.constants.O_NONBLOCK || 0)
  const handle = await fs.promises.open(selectedPath, flags)
  try {
    const opened = await handle.stat()
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.nlink !== 1 ||
      opened.size !== before.size ||
      (requirePrivate &&
        process.platform !== 'win32' &&
        (opened.mode & 0o077) !== 0)
    ) {
      refuse('fod_direct_check_invalid_file')
    }
    const data = await readBounded(handle, maxBytes)
    const after = await handle.stat()
    if (
      data.length !== opened.size ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs
    ) {
      data.fill(0)
      refuse('fod_direct_check_invalid_file')
    }
    return {data, dev: opened.dev, ino: opened.ino}
  } finally {
    await handle.close()
  }
}

async function writePrivateFile(fs, filePath, data) {
  const flags =
    fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_EXCL |
    fs.constants.O_NOFOLLOW
  const handle = await fs.promises.open(filePath, flags, 0o600)
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncPrivateDirectory(fs, directory) {
  const handle = await fs.promises.open(directory, fs.constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function checkBinary(fs, binaryPath) {
  if (typeof binaryPath !== 'string' || !path.isAbsolute(binaryPath)) {
    refuse('fod_direct_check_unavailable')
  }
  const absolute = path.resolve(binaryPath)
  const resolved = await fs.promises.realpath(binaryPath)
  const metadata = await fs.promises.lstat(binaryPath)
  if (
    resolved !== absolute ||
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (process.platform !== 'win32' && (metadata.mode & 0o111) === 0)
  ) {
    refuse('fod_direct_check_unavailable')
  }
}

function directVersionArgs(contract) {
  return contract === DIRECT_V4_CONTRACT.slice(2) ||
    contract === DIRECT_V4_CONTRACT
    ? ['-direct-version', '4']
    : []
}

function reviewedBinaryHashes(contract, confirmation, expectedBinaryHash) {
  if (expectedBinaryHash !== undefined) return [expectedBinaryHash]
  const v4Hash =
    DIRECT_V4_BINARY_SHA256_BY_PLATFORM[`${process.platform}-${process.arch}`]
  const buyHash =
    DIRECT_V4_BUY_BINARY_SHA256_BY_PLATFORM[`${process.platform}-${process.arch}`]
  if (contract === DIRECT_V3_CONTRACT && confirmation) {
    return [DIRECT_V3_BINARY_SHA256, v4Hash, buyHash].filter(Boolean)
  }
  return [v4Hash, buyHash].filter(Boolean)
}

function reviewedDirectBuyBinaryHashes(expectedBinaryHash) {
  if (expectedBinaryHash !== undefined) return [expectedBinaryHash]
  const buyHash =
    DIRECT_V4_BUY_BINARY_SHA256_BY_PLATFORM[`${process.platform}-${process.arch}`]
  return buyHash ? [buyHash] : []
}

async function checkPinnedBinary(fs, binaryPath, expectedHashes, stageDir) {
  await checkBinary(fs, binaryPath)
  if (!fs.constants.O_NOFOLLOW || expectedHashes.length === 0) {
    refuse('fod_direct_check_unavailable')
  }
  const beforePath = await fs.promises.lstat(binaryPath)
  const handle = await fs.promises.open(
    binaryPath,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
  )
  let staged
  const stagedPath = stageDir && path.join(stageDir, 'fod-verified')
  try {
    const before = await handle.stat()
    if (
      !before.isFile() ||
      before.dev !== beforePath.dev ||
      before.ino !== beforePath.ino ||
      before.size < 1 ||
      before.size > 160 * 1024 * 1024
    ) {
      refuse('fod_direct_check_unavailable')
    }
    const digest = createHash('sha256')
    if (stagedPath) {
      staged = await fs.promises.open(
        stagedPath,
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          fs.constants.O_NOFOLLOW,
        0o700
      )
      await staged.chmod(0o700)
    }
    const chunk = Buffer.alloc(64 * 1024)
    let offset = 0
    while (offset < before.size) {
      const {bytesRead} = await handle.read(
        chunk,
        0,
        Math.min(chunk.length, before.size - offset),
        offset
      )
      if (bytesRead === 0) refuse('fod_direct_check_unavailable')
      digest.update(chunk.subarray(0, bytesRead))
      if (staged) {
        let written = 0
        while (written < bytesRead) {
          const result = await staged.write(
            chunk,
            written,
            bytesRead - written,
            offset + written
          )
          if (result.bytesWritten === 0) refuse('fod_direct_check_unavailable')
          written += result.bytesWritten
        }
      }
      offset += bytesRead
    }
    chunk.fill(0)
    const after = await handle.stat()
    const afterPath = await fs.promises.lstat(binaryPath)
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      afterPath.dev !== before.dev ||
      afterPath.ino !== before.ino ||
      !expectedHashes.includes(digest.digest('hex'))
    ) {
      refuse('fod_direct_check_unavailable')
    }
    if (staged && (await staged.stat()).size !== before.size) {
      refuse('fod_direct_check_unavailable')
    }
    return stagedPath
  } finally {
    if (staged) await staged.close()
    await handle.close()
  }
}

function runCheck(spawn, binaryPath, args, message, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      ...(env ? {env} : {}),
    })
    let failed = false
    let stdoutBytes = 0
    let stderrBytes = 0
    const abort = () => {
      failed = true
      child.kill('SIGKILL')
    }
    const timer = setTimeout(abort, CHILD_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_CHILD_OUTPUT_BYTES) abort()
    })
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length
      if (stderrBytes > MAX_CHILD_OUTPUT_BYTES) abort()
    })
    child.stdin.on('error', abort)
    child.on('error', () => {
      failed = true
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (failed || code !== 0) {
        reject(new DirectCheckError('fod_direct_check_failed'))
      } else {
        resolve()
      }
    })
    child.stdin.end(message)
  })
}

function parseResult(raw, message) {
  if (raw.length > MAX_RESULT_BYTES) refuse('fod_direct_check_failed')
  const match = RESULT_PATTERN.exec(raw.toString('utf8'))
  if (
    !match ||
    !isUint64(match[2]) ||
    match[1] !== message.contract ||
    match[2] !== message.orderId ||
    match[3] !== message.author ||
    Number(match[4]) > 65535 ||
    Number(match[5]) > 32
  ) {
    refuse('fod_direct_check_failed')
  }
  return {
    format: 'fod.direct-check',
    version: 1,
    contract: `0x${match[1]}`,
    orderId: match[2],
    author: `0x${match[3]}`,
    epoch: Number(match[4]),
    usableFlips: Number(match[5]),
  }
}

function parseReceipt(raw, message) {
  if (raw.length > MAX_RECEIPT_BYTES) refuse('fod_direct_receive_failed')
  const match = RECEIPT_PATTERN.exec(raw.toString('utf8'))
  if (
    !match ||
    !isUint64(match[2]) ||
    match[1] !== message.contract ||
    match[2] !== message.orderId ||
    match[3] !== message.buyer ||
    match[4] !== message.author ||
    Number(match[5]) > 65535 ||
    Number(match[6]) > 32
  ) {
    refuse('fod_direct_receive_failed')
  }
  return {
    contract: `0x${match[1]}`,
    orderId: match[2],
    buyer: `0x${match[3]}`,
    author: `0x${match[4]}`,
    epoch: Number(match[5]),
    usableFlips: Number(match[6]),
  }
}

function parseUniqueJson(raw, code) {
  let source
  let value
  try {
    source = new TextDecoder('utf-8', {fatal: true}).decode(raw)
    value = JSON.parse(source)
    const objects = []
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index]
      if (character === '"') {
        let end = index + 1
        while (end < source.length && source[end] !== '"') {
          end += source[end] === '\\' ? 2 : 1
        }
        let next = end + 1
        while (/\s/.test(source[next] || '')) next += 1
        const keys = objects[objects.length - 1]
        if (source[next] === ':' && keys) {
          const key = JSON.parse(source.slice(index, end + 1))
          if (keys.has(key)) refuse(code)
          keys.add(key)
        }
        index = end
      } else if (character === '{') {
        objects.push(new Set())
      } else if (character === '[') {
        objects.push(null)
      } else if (character === '}' || character === ']') {
        objects.pop()
      }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      refuse(code)
    }
    return value
  } catch {
    refuse(code)
  }
}

function parseBuySession(raw) {
  const session = parseUniqueJson(raw, 'fod_direct_buy_invalid_file')
  if (
    session.format !== 'fod.session-bundle' ||
    session.version !== 1 ||
    typeof session.author !== 'string' ||
    !/^[0-9a-f]{40}$/.test(session.author) ||
    !Number.isInteger(session.epoch) ||
    session.epoch < 1 ||
    session.epoch > 65535 ||
    !Array.isArray(session.manifest) ||
    session.manifest.length < 1 ||
    session.manifest.length > 32 ||
    !session.inventory ||
    !session.verdict
  ) {
    refuse('fod_direct_buy_invalid_file')
  }
  return session
}

const BUY_FIELDS = new Set([
  'format', 'version', 'operation', 'network', 'contract', 'amount',
  'calldata', 'preparedAt', 'submitted', 'price', 'availability',
  'orderNonce', 'buyer', 'deliveryKey', 'author', 'epoch',
  'coveredFlips', 'keyCommitment', 'inventoryCommitment',
  'directOfferId', 'directSession',
])

function toIdna(atoms) {
  const base = 10n ** 18n
  const fraction = (atoms % base).toString().padStart(18, '0').replace(/0+$/, '')
  return `${atoms / base}${fraction ? `.${fraction}` : ''}`
}

function parsePreparedBuy(raw, session, buyer, deliveryPublicKey) {
  const prepared = parseUniqueJson(raw, 'fod_direct_buy_failed')
  const availability = prepared.availability
  const retained = prepared.directSession
  const fields = Object.keys(prepared)
  if (
    fields.length !== BUY_FIELDS.size ||
    fields.some((field) => !BUY_FIELDS.has(field)) ||
    prepared.format !== 'fod.prepared-direct-buy' ||
    prepared.version !== 1 ||
    prepared.operation !== 'buy' ||
    prepared.network !== 'idena' ||
    prepared.contract !== DIRECT_V4_CONTRACT.slice(2) ||
    prepared.buyer !== buyer ||
    prepared.submitted !== false ||
    typeof prepared.preparedAt !== 'string' ||
    !/^[0-9a-f]{64}$/.test(prepared.directOfferId) ||
    !/^[0-9a-f]{64}$/.test(prepared.inventoryCommitment) ||
    !/^[0-9a-f]{64}$/.test(prepared.keyCommitment) ||
    prepared.deliveryKey !== deliveryPublicKey ||
    prepared.calldata !== prepared.directOfferId + deliveryPublicKey ||
    prepared.author !== session.author ||
    prepared.epoch !== session.epoch ||
    prepared.coveredFlips !== session.manifest.length ||
    !Number.isSafeInteger(prepared.orderNonce) ||
    prepared.orderNonce < 1 ||
    !retained ||
    retained.format !== session.format ||
    retained.version !== session.version ||
    retained.author !== session.author ||
    retained.epoch !== session.epoch ||
    !Array.isArray(retained.manifest) ||
    retained.manifest.length !== session.manifest.length ||
    retained.manifest.some((cid, index) => cid !== session.manifest[index]) ||
    !isDeepStrictEqual(retained.inventory, session.inventory) ||
    !isDeepStrictEqual(retained.verdict, session.verdict) ||
    !availability ||
    availability.author !== session.author ||
    availability.epoch !== session.epoch ||
    availability.binding !== 'committed-inventory' ||
    availability.coveredFlips !== session.manifest.length ||
    availability.verifiedFlips !== session.manifest.length ||
    availability.inventoryCommitment !== prepared.inventoryCommitment ||
    !Array.isArray(availability.blobs) ||
    availability.blobs.length !== session.manifest.length ||
    availability.blobs.some((blob, index) => blob?.cid !== session.manifest[index]) ||
    (availability.failures && availability.failures.length !== 0) ||
    typeof prepared.price !== 'string' ||
    !/^[1-9][0-9]{0,38}$/.test(prepared.price) ||
    typeof prepared.amount !== 'string' ||
    !/^[1-9][0-9]{0,38}$/.test(prepared.amount)
  ) {
    refuse('fod_direct_buy_failed')
  }
  const price = BigInt(prepared.price)
  const total = BigInt(prepared.amount)
  if (total <= price || total >= 1n << 128n) {
    refuse('fod_direct_buy_failed')
  }
  return {
    priceIdna: toIdna(price),
    bondIdna: toIdna(total - price),
    totalIdna: toIdna(total),
    author: `0x${prepared.author}`,
    epoch: prepared.epoch,
    usableFlips: prepared.coveredFlips,
  }
}

async function ensurePrivateVaultRoot(fs, vaultRoot) {
  if (typeof vaultRoot !== 'string' || !path.isAbsolute(vaultRoot)) {
    refuse('fod_direct_receive_unavailable')
  }
  const absolute = path.resolve(vaultRoot)
  const parent = path.dirname(absolute)
  if ((await fs.promises.realpath(parent)) !== parent) {
    refuse('fod_direct_receive_unavailable')
  }
  let created = false
  try {
    await fs.promises.mkdir(absolute, {mode: 0o700})
    created = true
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const metadata = await fs.promises.lstat(absolute)
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (process.platform !== 'win32' && (metadata.mode & 0o777) !== 0o700) ||
    (await fs.promises.realpath(absolute)) !== absolute
  ) {
    refuse('fod_direct_receive_unavailable')
  }
  if (created) await syncPrivateDirectory(fs, parent)
  return absolute
}

async function checkPrivateOutputFile(fs, filePath) {
  const absolute = path.resolve(filePath)
  const resolved = await fs.promises.realpath(filePath)
  const before = await fs.promises.lstat(filePath)
  if (
    resolved !== absolute ||
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size < 1 ||
    !fs.constants.O_NOFOLLOW ||
    (process.platform !== 'win32' && (before.mode & 0o777) !== 0o600)
  ) {
    refuse('fod_direct_receive_failed')
  }
  const handle = await fs.promises.open(
    filePath,
    fs.constants.O_RDONLY |
      fs.constants.O_NOFOLLOW |
      (fs.constants.O_NONBLOCK || 0)
  )
  try {
    const opened = await handle.stat()
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.nlink !== 1 ||
      opened.size !== before.size ||
      (process.platform !== 'win32' && (opened.mode & 0o777) !== 0o600)
    ) {
      refuse('fod_direct_receive_failed')
    }
  } finally {
    await handle.close()
  }
}

function createFodDirectCheckService({
  dialog,
  getNodeRpcConnection,
  getActiveCoinbase,
  spawn = defaultSpawn,
  fs = defaultFs,
  binaryPath,
  expectedBinaryHash,
}) {
  let busy = false

  return async function checkDirectDelivery(payload) {
    if (busy) refuse('fod_direct_check_busy')
    busy = true
    let tempDir
    try {
      const message = parseMessage(payload)
      const initial = await activeIdentity(
        getNodeRpcConnection,
        getActiveCoinbase
      )
      if (initial.coinbase !== message.buyer) {
        refuse('fod_direct_check_buyer_mismatch')
      }
      const binaryHashes = reviewedBinaryHashes(
        `0x${message.contract}`,
        false,
        expectedBinaryHash
      )
      await checkPinnedBinary(fs, binaryPath, binaryHashes)

      const purchasePath = await pickFile(
        dialog,
        'Select retained FoD purchase'
      )
      const keyPath = await pickFile(dialog, 'Select FoD delivery key')
      const purchase = await readPrivateSelectedFile(
        fs,
        purchasePath,
        MAX_PURCHASE_BYTES
      )
      let key
      try {
        key = await readPrivateSelectedFile(fs, keyPath, MAX_DELIVERY_KEY_BYTES)
        if (
          !/^(?:0x)?[0-9a-fA-F]{64}$/.test(key.data.toString('utf8').trim())
        ) {
          refuse('fod_direct_check_invalid_file')
        }
        if (purchase.dev === key.dev && purchase.ino === key.ino) {
          refuse('fod_direct_check_invalid_file')
        }

        tempDir = await fs.promises.mkdtemp(
          path.join(os.tmpdir(), 'fod-check-')
        )
        tempDir = await fs.promises.realpath(tempDir)
        await fs.promises.chmod(tempDir, 0o700)
        const stagedBinary = await checkPinnedBinary(
          fs,
          binaryPath,
          binaryHashes,
          tempDir
        )
        const purchaseCopy = path.join(tempDir, 'purchase.json')
        const keyCopy = path.join(tempDir, 'delivery.key')
        const resultPath = path.join(tempDir, 'result.json')
        await writePrivateFile(fs, purchaseCopy, purchase.data)
        await writePrivateFile(fs, keyCopy, key.data)

        const args = [
          'direct-check',
          ...directVersionArgs(message.contract),
          '-network',
          'idena',
          '-contract',
          `0x${message.contract}`,
          '-code-hash',
          message.codeHash,
          '-order',
          message.orderId,
          '-message',
          '-',
          '-purchase',
          purchaseCopy,
          '-delivery-key',
          keyCopy,
          '-out',
          resultPath,
          '-rpc',
          initial.connection.url,
        ]
        if (initial.connection.key) {
          const keyFile = path.join(tempDir, 'rpc.key')
          const keyBytes = Buffer.from(initial.connection.key, 'utf8')
          try {
            await writePrivateFile(fs, keyFile, keyBytes)
          } finally {
            keyBytes.fill(0)
          }
          args.push('-key-file', keyFile)
        }

        const current = await activeIdentity(
          getNodeRpcConnection,
          getActiveCoinbase
        )
        if (
          !sameConnection(initial.connection, current.connection) ||
          initial.coinbase !== current.coinbase
        ) {
          refuse('fod_direct_check_identity_changed')
        }
        await runCheck(spawn, stagedBinary, args, payload.message)

        const finished = await activeIdentity(
          getNodeRpcConnection,
          getActiveCoinbase
        )
        if (
          !sameConnection(initial.connection, finished.connection) ||
          initial.coinbase !== finished.coinbase
        ) {
          refuse('fod_direct_check_identity_changed')
        }

        const result = await readPrivateSelectedFile(
          fs,
          resultPath,
          MAX_RESULT_BYTES
        )
        try {
          return parseResult(result.data, message)
        } finally {
          result.data.fill(0)
        }
      } finally {
        purchase.data.fill(0)
        if (key) key.data.fill(0)
      }
    } catch (error) {
      if (error instanceof DirectCheckError) throw error
      throw new DirectCheckError('fod_direct_check_failed')
    } finally {
      try {
        if (tempDir)
          await fs.promises.rm(tempDir, {recursive: true, force: true})
      } catch {
        refuse('fod_direct_check_failed')
      } finally {
        busy = false
      }
    }
  }
}

function createFodDirectReceiveService({
  dialog,
  getNodeRpcConnection,
  getActiveCoinbase,
  spawn = defaultSpawn,
  fs = defaultFs,
  binaryPath,
  vaultRoot,
  expectedBinaryHash,
}) {
  let busy = false

  return async function receiveDirectDelivery(payload) {
    if (busy) refuse('fod_direct_receive_busy')
    busy = true
    let tempDir
    let outputDir
    let saved = false
    try {
      const {message, messageText, passphrase} = parseReceivePayload(payload)
      const initial = await activeIdentity(
        getNodeRpcConnection,
        getActiveCoinbase
      )
      if (initial.coinbase !== message.buyer) {
        refuse('fod_direct_receive_buyer_mismatch')
      }
      const binaryHashes = reviewedBinaryHashes(
        `0x${message.contract}`,
        false,
        expectedBinaryHash
      )
      await checkPinnedBinary(fs, binaryPath, binaryHashes)
      const vaultParent = await ensurePrivateVaultRoot(fs, vaultRoot)
      const privateRoot = await ensurePrivateVaultRoot(
        fs,
        path.join(vaultParent, initial.coinbase)
      )

      const purchasePath = await pickFile(
        dialog,
        'Select retained FoD purchase'
      )
      const keyPath = await pickFile(dialog, 'Select FoD delivery key')
      const purchase = await readPrivateSelectedFile(
        fs,
        purchasePath,
        MAX_PURCHASE_BYTES
      )
      let key
      try {
        key = await readPrivateSelectedFile(fs, keyPath, MAX_DELIVERY_KEY_BYTES)
        if (
          !/^(?:0x)?[0-9a-fA-F]{64}$/.test(key.data.toString('utf8').trim())
        ) {
          refuse('fod_direct_receive_invalid_file')
        }
        if (purchase.dev === key.dev && purchase.ino === key.ino) {
          refuse('fod_direct_receive_invalid_file')
        }

        tempDir = await fs.promises.mkdtemp(
          path.join(os.tmpdir(), 'fod-receive-')
        )
        tempDir = await fs.promises.realpath(tempDir)
        await fs.promises.chmod(tempDir, 0o700)
        const stagedBinary = await checkPinnedBinary(
          fs,
          binaryPath,
          binaryHashes,
          tempDir
        )
        const purchaseCopy = path.join(tempDir, 'purchase.json')
        const keyCopy = path.join(tempDir, 'delivery.key')
        await writePrivateFile(fs, purchaseCopy, purchase.data)
        await writePrivateFile(fs, keyCopy, key.data)

        outputDir = await fs.promises.mkdtemp(
          path.join(privateRoot, 'fod-receive-')
        )
        await fs.promises.chmod(outputDir, 0o700)
        const outputBefore = await fs.promises.lstat(outputDir)
        if (
          !outputBefore.isDirectory() ||
          outputBefore.isSymbolicLink() ||
          (process.platform !== 'win32' &&
            (outputBefore.mode & 0o777) !== 0o700) ||
          (await fs.promises.realpath(outputDir)) !== outputDir
        ) {
          refuse('fod_direct_receive_unavailable')
        }
        const vaultPath = path.join(outputDir, 'vault.age')
        const receiptPath = path.join(outputDir, 'receipt.json')
        const args = [
          'direct-receive',
          ...directVersionArgs(message.contract),
          '-network',
          'idena',
          '-contract',
          `0x${message.contract}`,
          '-code-hash',
          message.codeHash,
          '-order',
          message.orderId,
          '-message',
          '-',
          '-purchase',
          purchaseCopy,
          '-delivery-key',
          keyCopy,
          '-vault',
          vaultPath,
          '-out',
          receiptPath,
          '-rpc',
          initial.connection.url,
        ]
        if (initial.connection.key) {
          const keyFile = path.join(tempDir, 'rpc.key')
          const keyBytes = Buffer.from(initial.connection.key, 'utf8')
          try {
            await writePrivateFile(fs, keyFile, keyBytes)
          } finally {
            keyBytes.fill(0)
          }
          args.push('-key-file', keyFile)
        }

        const current = await activeIdentity(
          getNodeRpcConnection,
          getActiveCoinbase
        )
        if (
          !sameConnection(initial.connection, current.connection) ||
          initial.coinbase !== current.coinbase
        ) {
          refuse('fod_direct_receive_identity_changed')
        }
        await ensurePrivateVaultRoot(fs, vaultParent)
        await ensurePrivateVaultRoot(fs, privateRoot)
        await runCheck(spawn, stagedBinary, args, messageText, {
          FOD_PASSPHRASE: passphrase,
        })

        const finished = await activeIdentity(
          getNodeRpcConnection,
          getActiveCoinbase
        )
        if (
          !sameConnection(initial.connection, finished.connection) ||
          initial.coinbase !== finished.coinbase
        ) {
          refuse('fod_direct_receive_identity_changed')
        }
        const outputAfter = await fs.promises.lstat(outputDir)
        if (
          outputAfter.dev !== outputBefore.dev ||
          outputAfter.ino !== outputBefore.ino ||
          !outputAfter.isDirectory() ||
          outputAfter.isSymbolicLink() ||
          (process.platform !== 'win32' && (outputAfter.mode & 0o777) !== 0o700)
        ) {
          refuse('fod_direct_receive_failed')
        }
        await ensurePrivateVaultRoot(fs, vaultParent)
        await ensurePrivateVaultRoot(fs, privateRoot)
        await checkPrivateOutputFile(fs, vaultPath)
        await checkPrivateOutputFile(fs, receiptPath)
        const receipt = await readPrivateSelectedFile(
          fs,
          receiptPath,
          MAX_RECEIPT_BYTES
        )
        try {
          const summary = parseReceipt(receipt.data, message)
          saved = true
          return {...summary, vaultPath, receiptPath}
        } finally {
          receipt.data.fill(0)
        }
      } finally {
        purchase.data.fill(0)
        if (key) key.data.fill(0)
      }
    } catch (error) {
      const code =
        error instanceof DirectCheckError
          ? error.message.replace(/^fod_direct_check_/, 'fod_direct_receive_')
          : 'fod_direct_receive_failed'
      throw new DirectCheckError(code)
    } finally {
      let cleanupFailed = false
      try {
        if (tempDir)
          await fs.promises.rm(tempDir, {recursive: true, force: true})
      } catch {
        cleanupFailed = true
      }
      try {
        if (outputDir && (!saved || cleanupFailed)) {
          await fs.promises.rm(outputDir, {recursive: true, force: true})
        }
      } catch {
        cleanupFailed = true
      } finally {
        busy = false
      }
      if (cleanupFailed) refuse('fod_direct_receive_failed')
    }
  }
}

function createFodDirectBuyPrepareService({
  dialog,
  getNodeRpcConnection,
  getActiveCoinbase,
  spawn = defaultSpawn,
  fs = defaultFs,
  binaryPath,
  vaultRoot,
  expectedBinaryHash,
}) {
  let busy = false

  return async function prepareDirectBuy(payload) {
    if (busy) refuse('fod_direct_buy_busy')
    busy = true
    let tempDir
    let outputDir
    let saved = false
    try {
      if (
        !payload ||
        typeof payload !== 'object' ||
        Array.isArray(payload) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(payload)) ||
        Reflect.ownKeys(payload).length !== 0
      ) {
        refuse('fod_direct_buy_invalid_request')
      }
      const initial = await activeIdentity(
        getNodeRpcConnection,
        getActiveCoinbase
      )
      const binaryHashes = reviewedDirectBuyBinaryHashes(expectedBinaryHash)
      await checkPinnedBinary(fs, binaryPath, binaryHashes)
      const vaultParent = await ensurePrivateVaultRoot(fs, vaultRoot)
      const privateRoot = await ensurePrivateVaultRoot(
        fs,
        path.join(vaultParent, initial.coinbase)
      )
      const sessionPath = await pickFile(
        dialog,
        'Select canonical FoD session bundle'
      )
      const selected = await readPrivateSelectedFile(
        fs,
        sessionPath,
        MAX_SESSION_BYTES,
        false
      )
      try {
        const session = parseBuySession(selected.data)
        tempDir = await fs.promises.mkdtemp(
          path.join(os.tmpdir(), 'fod-buy-')
        )
        tempDir = await fs.promises.realpath(tempDir)
        await fs.promises.chmod(tempDir, 0o700)
        const stagedBinary = await checkPinnedBinary(
          fs,
          binaryPath,
          binaryHashes,
          tempDir
        )
        const sessionCopy = path.join(tempDir, 'session.json')
        const keyPath = path.join(tempDir, 'delivery.key')
        const preparedPath = path.join(tempDir, 'purchase.json')
        await writePrivateFile(fs, sessionCopy, selected.data)
        const args = [
          'direct-buy',
          '-buyer',
          `0x${initial.coinbase}`,
          '-session',
          sessionCopy,
          '-delivery-key',
          keyPath,
          '-prepared',
          preparedPath,
          '-network',
          'idena',
          '-direct-version',
          '4',
          '-contract',
          DIRECT_V4_CONTRACT,
          '-code-hash',
          DIRECT_V4_CODE_HASH,
          '-rpc',
          initial.connection.url,
        ]
        if (initial.connection.key) {
          const keyFile = path.join(tempDir, 'rpc.key')
          const keyBytes = Buffer.from(initial.connection.key, 'utf8')
          try {
            await writePrivateFile(fs, keyFile, keyBytes)
          } finally {
            keyBytes.fill(0)
          }
          args.push('-key-file', keyFile)
        }
        const current = await activeIdentity(
          getNodeRpcConnection,
          getActiveCoinbase
        )
        if (
          !sameConnection(initial.connection, current.connection) ||
          initial.coinbase !== current.coinbase
        ) {
          refuse('fod_direct_buy_identity_changed')
        }
        await ensurePrivateVaultRoot(fs, vaultParent)
        await ensurePrivateVaultRoot(fs, privateRoot)
        await runCheck(spawn, stagedBinary, args, '')

        await checkPrivateOutputFile(fs, keyPath)
        await checkPrivateOutputFile(fs, preparedPath)
        const key = await readPrivateSelectedFile(
          fs,
          keyPath,
          MAX_DELIVERY_KEY_BYTES
        )
        try {
          const keyText = key.data.toString('utf8').trim()
          if (!/^(?:0x)?[0-9a-fA-F]{64}$/.test(keyText)) {
            refuse('fod_direct_buy_failed')
          }
          const deliveryKey = Buffer.from(keyText.replace(/^0x/, ''), 'hex')
          let deliveryPublicKey
          try {
            const curve = createECDH('secp256k1')
            curve.setPrivateKey(deliveryKey)
            deliveryPublicKey = curve.getPublicKey('hex', 'uncompressed')
          } finally {
            deliveryKey.fill(0)
          }
          const prepared = await readPrivateSelectedFile(
            fs,
            preparedPath,
            MAX_PURCHASE_BYTES
          )
          try {
            const summary = parsePreparedBuy(
              prepared.data,
              session,
              initial.coinbase,
              deliveryPublicKey
            )
            const finished = await activeIdentity(
              getNodeRpcConnection,
              getActiveCoinbase
            )
            if (
              !sameConnection(initial.connection, finished.connection) ||
              initial.coinbase !== finished.coinbase
            ) {
              refuse('fod_direct_buy_identity_changed')
            }
            await ensurePrivateVaultRoot(fs, vaultParent)
            await ensurePrivateVaultRoot(fs, privateRoot)
            const purchaseId = `fod-buy-${randomBytes(16).toString('hex')}`
            const destination = path.join(privateRoot, purchaseId)
            await fs.promises.mkdir(destination, {mode: 0o700})
            outputDir = destination
            await fs.promises.chmod(outputDir, 0o700)
            const outputBefore = await fs.promises.lstat(outputDir)
            if (
              !outputBefore.isDirectory() ||
              outputBefore.isSymbolicLink() ||
              (process.platform !== 'win32' &&
                (outputBefore.mode & 0o777) !== 0o700) ||
              (await fs.promises.realpath(outputDir)) !== outputDir
            ) {
              refuse('fod_direct_buy_unavailable')
            }
            await writePrivateFile(
              fs,
              path.join(outputDir, 'delivery.key'),
              key.data
            )
            await writePrivateFile(
              fs,
              path.join(outputDir, 'purchase.json'),
              prepared.data
            )
            await writePrivateFile(
              fs,
              path.join(outputDir, 'session.json'),
              selected.data
            )
            await syncPrivateDirectory(fs, outputDir)
            await syncPrivateDirectory(fs, privateRoot)
            const outputAfter = await fs.promises.lstat(outputDir)
            if (
              outputAfter.dev !== outputBefore.dev ||
              outputAfter.ino !== outputBefore.ino ||
              !outputAfter.isDirectory() ||
              outputAfter.isSymbolicLink() ||
              (process.platform !== 'win32' &&
                (outputAfter.mode & 0o777) !== 0o700)
            ) {
              refuse('fod_direct_buy_failed')
            }
            await ensurePrivateVaultRoot(fs, vaultParent)
            await ensurePrivateVaultRoot(fs, privateRoot)
            const last = await activeIdentity(
              getNodeRpcConnection,
              getActiveCoinbase
            )
            if (
              !sameConnection(initial.connection, last.connection) ||
              initial.coinbase !== last.coinbase
            ) {
              refuse('fod_direct_buy_identity_changed')
            }
            saved = true
            return {purchaseId, ...summary}
          } finally {
            prepared.data.fill(0)
          }
        } finally {
          key.data.fill(0)
        }
      } finally {
        selected.data.fill(0)
      }
    } catch (error) {
      const code =
        error instanceof DirectCheckError
          ? error.message.replace(/^fod_direct_(check|receive)_/, 'fod_direct_buy_')
          : 'fod_direct_buy_failed'
      throw new DirectCheckError(code)
    } finally {
      let cleanupFailed = false
      try {
        if (tempDir)
          await fs.promises.rm(tempDir, {recursive: true, force: true})
      } catch {
        cleanupFailed = true
      }
      try {
        if (outputDir && (!saved || cleanupFailed)) {
          await fs.promises.rm(outputDir, {recursive: true, force: true})
        }
      } catch {
        cleanupFailed = true
      } finally {
        busy = false
      }
      if (cleanupFailed) refuse('fod_direct_buy_failed')
    }
  }
}

function parseConfirmRequest(payload) {
  const orderDescriptor =
    payload && Object.getOwnPropertyDescriptor(payload, 'orderId')
  const contractDescriptor =
    payload && Object.getOwnPropertyDescriptor(payload, 'contract')
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(payload)) ||
    Reflect.ownKeys(payload).length !== 2 ||
    !orderDescriptor ||
    !contractDescriptor ||
    typeof orderDescriptor.value !== 'string' ||
    !/^[1-9][0-9]{0,19}$/.test(orderDescriptor.value) ||
    !isUint64(orderDescriptor.value) ||
    ![DIRECT_V3_CONTRACT, DIRECT_V4_CONTRACT].includes(contractDescriptor.value)
  ) {
    refuse('fod_direct_confirm_invalid_request')
  }
  return {orderId: orderDescriptor.value, contract: contractDescriptor.value}
}

function decimalAtoms(value) {
  if (typeof value !== 'string' || !/^[0-9]+(?:\.[0-9]{1,18})?$/.test(value)) {
    refuse('fod_direct_confirm_node_unavailable')
  }
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'))
}

async function findSavedReceipt(fs, privateRoot, {coinbase, contract, orderId}) {
  let found
  try {
    const entries = await fs.promises.readdir(privateRoot, {withFileTypes: true})
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^fod-receive-[A-Za-z0-9]{6}$/.test(entry.name)) {
        continue
      }
      const directory = path.join(privateRoot, entry.name)
      await ensurePrivateVaultRoot(fs, directory)
      let file
      try {
        file = await readPrivateSelectedFile(
          fs,
          path.join(directory, 'receipt.json'),
          MAX_RECEIPT_BYTES
        )
      } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
      const match = RECEIPT_PATTERN.exec(file.data.toString('utf8'))
      if (
        !match ||
        !isUint64(match[2]) ||
        match[1] !== contract.slice(2) ||
        match[2] !== orderId ||
        match[3] !== coinbase
      ) {
        file.data.fill(0)
        continue
      }
      if (found) {
        const same = found.data.equals(file.data)
        file.data.fill(0)
        if (!same) refuse('fod_direct_confirm_duplicate_receipt')
        continue
      }
      found = {data: file.data, opened: JSON.parse(file.data.toString('utf8'))}
    }
  } catch (error) {
    if (found) found.data.fill(0)
    throw error
  }
  if (!found) refuse('fod_direct_confirm_no_saved_receipt')
  return found
}

function attemptPath(privateRoot, contract, orderId) {
  return path.join(privateRoot, `confirm-${contract.slice(2)}-${orderId}.json`)
}

async function readConfirmAttempt(fs, filePath, expected) {
  let file
  try {
    file = await readPrivateSelectedFile(fs, filePath, 512)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  try {
    const marker = JSON.parse(file.data.toString('utf8'))
    if (
      Object.keys(marker).join(',') !==
        'format,version,buyer,contract,orderId,receiptSha256,txHash' ||
      marker.format !== 'fod.direct-confirm-attempt' ||
      marker.version !== 1 ||
      marker.buyer !== expected.buyer ||
      marker.contract !== expected.contract ||
      marker.orderId !== expected.orderId ||
      marker.receiptSha256 !== expected.receiptSha256 ||
      (marker.txHash !== null &&
        !/^0x[0-9a-f]{64}$/.test(marker.txHash))
    ) {
      refuse('fod_direct_confirm_invalid_attempt')
    }
    return marker
  } finally {
    file.data.fill(0)
  }
}

async function saveConfirmAttempt(fs, filePath, marker, replace = false) {
  const output = replace
    ? `${filePath}.${randomBytes(8).toString('hex')}`
    : filePath
  const handle = await fs.promises.open(
    output,
    fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      fs.constants.O_NOFOLLOW,
    0o600
  )
  try {
    await handle.writeFile(JSON.stringify(marker))
    await handle.sync()
  } finally {
    await handle.close()
  }
  if (replace) {
    try {
      await fs.promises.rename(output, filePath)
    } finally {
      await fs.promises.rm(output, {force: true})
    }
  }
  const directory = await fs.promises.open(path.dirname(filePath), fs.constants.O_RDONLY)
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

function parseBuyCommitRequest(payload) {
  const descriptor = payload && Object.getOwnPropertyDescriptor(payload, 'purchaseId')
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(payload)) ||
    Reflect.ownKeys(payload).length !== 1 ||
    !descriptor ||
    typeof descriptor.value !== 'string' ||
    !/^fod-buy-[0-9a-f]{32}$/.test(descriptor.value)
  ) {
    refuse('fod_direct_buy_invalid_request')
  }
  return descriptor.value
}

function createFodDirectBuyResumeService({
  getNodeRpcConnection,
  getActiveCoinbase,
  fs = defaultFs,
  vaultRoot,
}) {
  return async function resumeDirectBuy(payload) {
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(payload)) ||
      Reflect.ownKeys(payload).length !== 0
    ) {
      refuse('fod_direct_buy_invalid_request')
    }
    const initial = await activeIdentity(getNodeRpcConnection, getActiveCoinbase)
    let metadata
    try {
      metadata = await fs.promises.lstat(vaultRoot)
    } catch (error) {
      if (error.code === 'ENOENT') return {purchaseId: null}
      throw error
    }
    if (!metadata.isDirectory()) refuse('fod_direct_buy_unavailable')
    const parent = await ensurePrivateVaultRoot(fs, vaultRoot)
    const identityRoot = path.join(parent, initial.coinbase)
    try {
      metadata = await fs.promises.lstat(identityRoot)
    } catch (error) {
      if (error.code === 'ENOENT') return {purchaseId: null}
      throw error
    }
    if (!metadata.isDirectory()) refuse('fod_direct_buy_unavailable')
    await ensurePrivateVaultRoot(fs, identityRoot)
    const names = await fs.promises.readdir(identityRoot)
    if (names.length > 1000) refuse('fod_direct_buy_unavailable')
    const candidates = []
    for (const name of names) {
      if (!/^fod-buy-[0-9a-f]{32}$/.test(name)) continue
      const dir = path.join(identityRoot, name)
      const stat = await fs.promises.lstat(dir)
      if (
        stat.isDirectory() &&
        !stat.isSymbolicLink() &&
        (process.platform === 'win32' || (stat.mode & 0o777) === 0o700) &&
        (await fs.promises.realpath(dir)) === dir
      ) {
        candidates.push({name, modified: stat.mtimeMs})
      }
    }
    const current = await activeIdentity(getNodeRpcConnection, getActiveCoinbase)
    if (
      !sameConnection(initial.connection, current.connection) ||
      initial.coinbase !== current.coinbase
    ) {
      refuse('fod_direct_buy_identity_changed')
    }
    candidates.sort((a, b) => b.modified - a.modified || b.name.localeCompare(a.name))
    return {purchaseId: candidates[0]?.name || null}
  }
}

async function readBuyAttempt(fs, filePath, expected) {
  let file
  try {
    file = await readPrivateSelectedFile(fs, filePath, 512)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  try {
    const marker = parseUniqueJson(file.data, 'fod_direct_buy_invalid_attempt')
    if (
      Object.keys(marker).join(',') !==
        'format,version,buyer,contract,purchaseSha256,offerId,amount,price,txHash' ||
      marker.format !== 'fod.direct-buy-attempt' ||
      marker.version !== 1 ||
      marker.buyer !== expected.buyer ||
      marker.contract !== expected.contract ||
      marker.purchaseSha256 !== expected.purchaseSha256 ||
      marker.offerId !== expected.offerId ||
      marker.amount !== expected.amount ||
      marker.price !== expected.price ||
      (marker.txHash !== null && !/^0x[0-9a-f]{64}$/.test(marker.txHash))
    ) {
      refuse('fod_direct_buy_invalid_attempt')
    }
    return marker
  } finally {
    file.data.fill(0)
  }
}

async function readDirectBuyMarket({fs, spawn, binary, tempDir, rpcFlags}) {
  const marketPath = path.join(tempDir, `market-${randomBytes(8).toString('hex')}.json`)
  await runCheck(
    spawn,
    binary,
    [
      'direct-market', '-direct-version', '4', '-network', 'idena',
      '-contract', DIRECT_V4_CONTRACT, '-code-hash', DIRECT_V4_CODE_HASH,
      '-out', marketPath, ...rpcFlags,
    ],
    ''
  )
  // The CLI writes this public snapshot as 0644 inside our private 0700 temp directory.
  const marketFile = await readPrivateSelectedFile(
    fs, marketPath, MAX_MARKET_BYTES, false
  )
  try {
    const market = parseUniqueJson(marketFile.data, 'fod_direct_buy_failed')
    if (
      market.format !== 'fod.direct-market-state' ||
      market.version !== 3 ||
      market.network !== 'idena' ||
      market.source !== 'node' ||
      market.contract !== DIRECT_V4_CONTRACT.slice(2) ||
      market.codeHash !== DIRECT_V4_CODE_HASH.slice(2) ||
      !Array.isArray(market.offers) ||
      !Array.isArray(market.orders)
    ) {
      refuse('fod_direct_buy_failed')
    }
    return market
  } finally {
    marketFile.data.fill(0)
  }
}

function includedBuyOrder(market, prepared, fundedAtBlock) {
  const offer = market.offers.filter(
    (item) => item.offerId === prepared.directOfferId
  )
  if (offer.length !== 1) return null
  const matching = market.orders.filter(
    (item) =>
      item.offerId === prepared.directOfferId &&
      item.buyer === prepared.buyer &&
      item.paid === prepared.price &&
      item.bond === (BigInt(prepared.amount) - BigInt(prepared.price)).toString() &&
      item.fundedAtBlock === fundedAtBlock &&
      (item.state === 'settled' ||
        (item.state === 'funded' && item.orderId === offer[0].openOrderId))
  )
  return matching.length === 1
    ? {orderId: matching[0].orderId, status: matching[0].state}
    : null
}

function parseNodeFeePerGas(value) {
  const text = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : value
  if (
    typeof text !== 'string' ||
    !(/^[1-9][0-9]*$/.test(text) || /^0x[0-9a-fA-F]+$/.test(text))
  ) {
    refuse('fod_direct_buy_node_unavailable')
  }
  const rate = BigInt(text)
  if (rate <= 0n) refuse('fod_direct_buy_node_unavailable')
  return rate
}

function buyEstimateFitsFee(estimate, rate, maxFeeAtoms) {
  const gasUsed = estimate?.gasUsed
  const minGasLimit = estimate?.minGasLimit ?? gasUsed
  if (
    estimate?.success !== true ||
    !Number.isSafeInteger(gasUsed) || gasUsed < 1 ||
    !Number.isSafeInteger(minGasLimit) || minGasLimit < gasUsed
  ) {
    return false
  }
  // Include a 10% execution margin and 1,000 signed-tx bytes at 10 gas/byte.
  const gasBudget = BigInt(minGasLimit) * 11n / 10n + 11000n
  return gasBudget * rate <= maxFeeAtoms
}

function createFodDirectBuyCommitService({
  dialog,
  getNodeRpcConnection,
  getActiveCoinbase,
  rpcCall,
  spawn = defaultSpawn,
  fs = defaultFs,
  binaryPath,
  vaultRoot,
  expectedBinaryHash,
}) {
  let busy = false

  return async function commitDirectBuy(payload) {
    if (busy) refuse('fod_direct_buy_busy')
    busy = true
    let tempDir
    const privateData = []
    try {
      const purchaseId = parseBuyCommitRequest(payload)
      const initial = await activeIdentity(getNodeRpcConnection, getActiveCoinbase)
      const binaryHashes = reviewedDirectBuyBinaryHashes(expectedBinaryHash)
      await checkPinnedBinary(fs, binaryPath, binaryHashes)
      const vaultParent = await ensurePrivateVaultRoot(fs, vaultRoot)
      const privateRoot = await ensurePrivateVaultRoot(
        fs, path.join(vaultParent, initial.coinbase)
      )
      const purchaseRoot = path.join(privateRoot, purchaseId)
      const purchaseMetadata = await fs.promises.lstat(purchaseRoot)
      if (
        !purchaseMetadata.isDirectory() ||
        purchaseMetadata.isSymbolicLink() ||
        (process.platform !== 'win32' &&
          (purchaseMetadata.mode & 0o777) !== 0o700) ||
        (await fs.promises.realpath(purchaseRoot)) !== purchaseRoot
      ) {
        refuse('fod_direct_buy_invalid_file')
      }
      const readSaved = async (name, maxBytes) => {
        const file = await readPrivateSelectedFile(
          fs, path.join(purchaseRoot, name), maxBytes
        )
        privateData.push(file.data)
        return file.data
      }
      const sessionData = await readSaved('session.json', MAX_SESSION_BYTES)
      const keyData = await readSaved('delivery.key', MAX_DELIVERY_KEY_BYTES)
      const purchaseData = await readSaved('purchase.json', MAX_PURCHASE_BYTES)
      const session = parseBuySession(sessionData)
      const keyText = keyData.toString('utf8').trim()
      if (!/^(?:0x)?[0-9a-fA-F]{64}$/.test(keyText)) {
        refuse('fod_direct_buy_invalid_file')
      }
      const deliveryKey = Buffer.from(keyText.replace(/^0x/i, ''), 'hex')
      let deliveryPublicKey
      try {
        const curve = createECDH('secp256k1')
        curve.setPrivateKey(deliveryKey)
        deliveryPublicKey = curve.getPublicKey('hex', 'uncompressed')
      } finally {
        deliveryKey.fill(0)
      }
      const summary = parsePreparedBuy(
        purchaseData, session, initial.coinbase, deliveryPublicKey
      )
      const saved = parseUniqueJson(purchaseData, 'fod_direct_buy_invalid_file')
      const markerPath = path.join(purchaseRoot, 'buy-attempt.json')
      const marker = {
        format: 'fod.direct-buy-attempt',
        version: 1,
        buyer: initial.coinbase,
        contract: DIRECT_V4_CONTRACT,
        purchaseSha256: createHash('sha256').update(purchaseData).digest('hex'),
        offerId: saved.directOfferId,
        amount: saved.amount,
        price: saved.price,
        txHash: null,
      }
      const previousAttempt = await readBuyAttempt(fs, markerPath, marker)
      tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fod-buy-commit-'))
      tempDir = await fs.promises.realpath(tempDir)
      await fs.promises.chmod(tempDir, 0o700)
      const stagedBinary = await checkPinnedBinary(
        fs, binaryPath, binaryHashes, tempDir
      )
      const rpcFlags = ['-rpc', initial.connection.url]
      if (initial.connection.key) {
        const rpcKeyFile = path.join(tempDir, 'rpc.key')
        const rpcKeyBytes = Buffer.from(initial.connection.key, 'utf8')
        try {
          await writePrivateFile(fs, rpcKeyFile, rpcKeyBytes)
        } finally {
          rpcKeyBytes.fill(0)
        }
        rpcFlags.push('-key-file', rpcKeyFile)
      }
      const rpc = async (method, params) => {
        const response = await rpcCall(initial.connection, {method, params})
        if (response?.error || response?.result === undefined) {
          refuse('fod_direct_buy_node_unavailable')
        }
        return response.result
      }
      const reconcile = async (attempt) => {
        if (!attempt.txHash) {
          const pending = await rpc('bcn_pendingTransactions', [
            {address: `0x${initial.coinbase}`, count: 100},
          ]).catch(() => null)
          const expectedPayload =
            `0x0a036275791261${saved.calldata}`.toLowerCase()
          const matching = Array.isArray(pending?.transactions)
            ? pending.transactions.filter((tx) =>
              tx?.type === 'callContract' &&
              typeof tx.hash === 'string' &&
              /^0x[0-9a-fA-F]{64}$/.test(tx.hash) &&
              tx.from?.toLowerCase() === `0x${initial.coinbase}` &&
              tx.to?.toLowerCase() === DIRECT_V4_CONTRACT &&
              tx.amount === toIdna(BigInt(saved.amount)) &&
              tx.payload?.toLowerCase() === expectedPayload
            )
            : []
          if (matching.length !== 1) return {purchaseId, status: 'uncertain'}
          attempt.txHash = matching[0].hash.toLowerCase()
          await saveConfirmAttempt(fs, markerPath, attempt, true)
        }
        const receipt = await rpc('bcn_txReceipt', [attempt.txHash]).catch(() => null)
        if (!receipt) return {purchaseId, status: 'pending'}
        if (receipt.success !== true) refuse('fod_direct_buy_failed')
        const market = await readDirectBuyMarket({
          fs, spawn, binary: stagedBinary, tempDir, rpcFlags,
        })
        const included = {purchaseId, status: 'included'}
        const tx = await rpc('bcn_transaction', [attempt.txHash]).catch(() => null)
        const blockHash = tx?.blockHash
        if (
          tx?.type !== 'callContract' ||
          typeof tx.hash !== 'string' ||
          tx.hash.toLowerCase() !== attempt.txHash ||
          typeof tx.from !== 'string' ||
          tx.from.toLowerCase() !== `0x${initial.coinbase}` ||
          typeof tx.to !== 'string' ||
          tx.to.toLowerCase() !== DIRECT_V4_CONTRACT ||
          tx.amount !== toIdna(BigInt(saved.amount)) ||
          typeof tx.payload !== 'string' ||
          tx.payload.toLowerCase() !==
            `0x0a036275791261${saved.calldata}`.toLowerCase() ||
          typeof blockHash !== 'string' ||
          !/^0x[0-9a-fA-F]{64}$/.test(blockHash)
        ) return included
        const block = await rpc('bcn_block', [blockHash]).catch(() => null)
        if (
          !Number.isSafeInteger(block?.height) || block.height < 1 ||
          typeof block.hash !== 'string' ||
          block.hash.toLowerCase() !== blockHash.toLowerCase()
        ) return included
        const canonical = await rpc('bcn_blockAt', [block.height]).catch(() => null)
        if (
          typeof canonical?.hash !== 'string' ||
          canonical.hash.toLowerCase() !== blockHash.toLowerCase()
        ) {
          return included
        }
        const order = includedBuyOrder(market, saved, String(block.height))
        return order ? {purchaseId, ...order} : included
      }
      if (previousAttempt) return reconcile(previousAttempt)

      const sessionCopy = path.join(tempDir, 'session.json')
      const keyCopy = path.join(tempDir, 'delivery.key')
      const freshPath = path.join(tempDir, 'fresh-purchase.json')
      await writePrivateFile(fs, sessionCopy, sessionData)
      await writePrivateFile(fs, keyCopy, keyData)
      await runCheck(
        spawn,
        stagedBinary,
        [
          'direct-buy', '-buyer', `0x${initial.coinbase}`,
          '-session', sessionCopy, '-delivery-key', keyCopy,
          '-prepared', freshPath, '-network', 'idena',
          '-direct-version', '4', '-contract', DIRECT_V4_CONTRACT,
          '-code-hash', DIRECT_V4_CODE_HASH, ...rpcFlags,
        ],
        ''
      )
      const freshFile = await readPrivateSelectedFile(fs, freshPath, MAX_PURCHASE_BYTES)
      privateData.push(freshFile.data)
      parsePreparedBuy(freshFile.data, session, initial.coinbase, deliveryPublicKey)
      const fresh = parseUniqueJson(freshFile.data, 'fod_direct_buy_failed')
      for (const field of [
        'contract', 'amount', 'price', 'calldata', 'author', 'epoch',
        'coveredFlips', 'buyer', 'deliveryKey', 'orderNonce',
        'keyCommitment', 'inventoryCommitment', 'directOfferId',
      ]) {
        if (fresh[field] !== saved[field]) refuse('fod_direct_buy_changed')
      }
      if (!isDeepStrictEqual(fresh.directSession, saved.directSession)) {
        refuse('fod_direct_buy_changed')
      }
      const current = await activeIdentity(getNodeRpcConnection, getActiveCoinbase)
      if (
        !sameConnection(initial.connection, current.connection) ||
        initial.coinbase !== current.coinbase
      ) {
        refuse('fod_direct_buy_identity_changed')
      }
      const sync = await rpc('bcn_syncing', [])
      const coinbase = normalizeCoinbase(await rpc('dna_getCoinbaseAddr', []))
      const account = await rpc('dna_getBalance', [`0x${coinbase}`])
      const stake = await rpc('contract_getStake', [DIRECT_V4_CONTRACT])
      const feePerGas = await rpc('bcn_feePerGas', [])
      const rate = parseNodeFeePerGas(feePerGas)
      const maxFeeAtoms = rate * 5120000n < MAX_DIRECT_BUY_FEE_ATOMS
        ? rate * 5120000n
        : MAX_DIRECT_BUY_FEE_ATOMS
      if (
        sync?.syncing !== false ||
        sync.wrongTime !== false ||
        sync.currentBlock !== sync.highestBlock ||
        coinbase !== initial.coinbase ||
        !account ||
        account.nonce !== account.mempoolNonce ||
        decimalAtoms(account.balance) < BigInt(saved.amount) + maxFeeAtoms ||
        stake?.Hash?.toLowerCase() !== DIRECT_V4_CODE_HASH
      ) {
        refuse('fod_direct_buy_node_unavailable')
      }
      const call = {
        from: `0x${initial.coinbase}`,
        contract: DIRECT_V4_CONTRACT,
        method: 'buy',
        amount: toIdna(BigInt(saved.amount)),
        maxFee: toIdna(maxFeeAtoms),
        args: [{index: 0, format: 'hex', value: `0x${saved.calldata}`}],
      }
      const estimate = await rpc('contract_estimateCall', [call])
      if (!buyEstimateFitsFee(estimate, rate, maxFeeAtoms)) {
        refuse('fod_direct_buy_fee_unavailable')
      }
      const confirmation = await dialog.showMessageBox({
        type: 'warning',
        title: 'Buy flip keys',
        message: `Lock ${summary.totalIdna} iDNA for these flip keys?`,
        detail:
          `Price: ${summary.priceIdna} iDNA. Refundable buyer bond: ` +
          `${summary.bondIdna} iDNA. Network fee: up to ` +
          `${toIdna(maxFeeAtoms)} iDNA. The bond is at risk in a valid seller dispute.`,
        buttons: ['Cancel', 'Lock funds'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      if (confirmation?.response !== 1) {
        return {purchaseId, status: 'cancelled'}
      }
      const finalSync = await rpc('bcn_syncing', [])
      const finalAccount = await rpc('dna_getBalance', [`0x${coinbase}`])
      const finalStake = await rpc('contract_getStake', [DIRECT_V4_CONTRACT])
      const finalRate = await rpc('bcn_feePerGas', [])
      if (
        finalSync?.syncing !== false ||
        finalSync.wrongTime !== false ||
        finalSync.currentBlock !== finalSync.highestBlock ||
        !finalAccount ||
        finalAccount.nonce !== finalAccount.mempoolNonce ||
        finalAccount.nonce !== account.nonce ||
        decimalAtoms(finalAccount.balance) < BigInt(saved.amount) + maxFeeAtoms ||
        finalStake?.Hash?.toLowerCase() !== DIRECT_V4_CODE_HASH ||
        parseNodeFeePerGas(finalRate) !== rate
      ) {
        refuse('fod_direct_buy_node_unavailable')
      }
      const finalEstimate = await rpc('contract_estimateCall', [call])
      if (!buyEstimateFitsFee(finalEstimate, rate, maxFeeAtoms)) {
        refuse('fod_direct_buy_fee_unavailable')
      }
      const last = await activeIdentity(getNodeRpcConnection, getActiveCoinbase)
      if (
        !sameConnection(initial.connection, last.connection) ||
        initial.coinbase !== last.coinbase
      ) {
        refuse('fod_direct_buy_identity_changed')
      }
      await ensurePrivateVaultRoot(fs, vaultParent)
      await ensurePrivateVaultRoot(fs, privateRoot)
      await ensurePrivateVaultRoot(fs, purchaseRoot)
      try {
        await saveConfirmAttempt(fs, markerPath, marker)
      } catch (error) {
        if (error.code === 'EEXIST') return {purchaseId, status: 'uncertain'}
        throw error
      }
      let submitted
      try {
        submitted = await rpcCall(initial.connection, {
          method: 'contract_call', params: [call],
        })
      } catch {
        return {purchaseId, status: 'uncertain'}
      }
      const hash = submitted?.result
      if (
        submitted?.error ||
        typeof hash !== 'string' ||
        !/^0x[0-9a-fA-F]{64}$/.test(hash)
      ) {
        return {purchaseId, status: 'uncertain'}
      }
      marker.txHash = hash.toLowerCase()
      await saveConfirmAttempt(fs, markerPath, marker, true)
      for (let tries = 0; tries < 2; tries += 1) {
        const result = await reconcile(marker)
        if (result.status !== 'pending') return result
        if (tries === 0) await new Promise((resolve) => setTimeout(resolve, 3000))
      }
      return {purchaseId, status: 'pending'}
    } catch (error) {
      if (error instanceof DirectCheckError) throw error
      throw new DirectCheckError('fod_direct_buy_failed')
    } finally {
      privateData.forEach((data) => data.fill(0))
      try {
        if (tempDir) await fs.promises.rm(tempDir, {recursive: true, force: true})
      } finally {
        busy = false
      }
    }
  }
}

function createFodDirectConfirmService({
  getNodeRpcConnection,
  getActiveCoinbase,
  rpcCall,
  spawn = defaultSpawn,
  fs = defaultFs,
  binaryPath,
  vaultRoot,
  expectedBinaryHash,
}) {
  let busy = false

  return async function confirmSavedDirectDelivery(payload) {
    if (busy) refuse('fod_direct_confirm_busy')
    busy = true
    let tempDir
    let savedReceipt
    try {
      const {orderId, contract} = parseConfirmRequest(payload)
      const initial = await activeIdentity(
        getNodeRpcConnection,
        getActiveCoinbase
      )
      const codeHash = CODE_HASH_BY_CONTRACT[contract.slice(2)]
      const binaryHashes = reviewedBinaryHashes(
        contract,
        true,
        expectedBinaryHash
      )
      await checkPinnedBinary(fs, binaryPath, binaryHashes)
      const rpc = async (method, params) => {
        const response = await rpcCall(initial.connection, {method, params})
        if (response?.error) refuse('fod_direct_confirm_node_unavailable')
        return response?.result
      }

      const privateRoot = await ensurePrivateVaultRoot(
        fs,
        path.join(await ensurePrivateVaultRoot(fs, vaultRoot), initial.coinbase)
      )
      savedReceipt = await findSavedReceipt(fs, privateRoot, {
        coinbase: initial.coinbase,
        contract,
        orderId,
      })
      const opened = savedReceipt.opened
      const receiptSha256 = createHash('sha256')
        .update(savedReceipt.data)
        .digest('hex')
      const orderBytes = Buffer.alloc(8)
      orderBytes.writeBigUInt64BE(BigInt(orderId))
      const ciphertextDigest = createHash('sha256')
        .update(Buffer.from(opened.ciphertext, 'hex'))
        .digest()
      const calldata = Buffer.concat([orderBytes, ciphertextDigest]).toString('hex')
      // Protobuf CallContractAttachment: method "confirm", one 40-byte argument.
      const confirmPayload = `0x0a07636f6e6669726d1228${calldata}`
      const marker = {
        format: 'fod.direct-confirm-attempt',
        version: 1,
        buyer: initial.coinbase,
        contract,
        orderId,
        receiptSha256,
        txHash: null,
      }
      const markerPath = attemptPath(privateRoot, contract, orderId)
      const previousAttempt = await readConfirmAttempt(fs, markerPath, marker)

      tempDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'fod-confirm-')
      )
      tempDir = await fs.promises.realpath(tempDir)
      await fs.promises.chmod(tempDir, 0o700)
      const stagedBinary = await checkPinnedBinary(
        fs,
        binaryPath,
        binaryHashes,
        tempDir
      )
      const receiptPath = path.join(tempDir, 'receipt.json')
      await writePrivateFile(fs, receiptPath, savedReceipt.data)
      savedReceipt.data.fill(0)
      const keyFile = path.join(tempDir, 'rpc.key')
      if (initial.connection.key) {
        const keyBytes = Buffer.from(initial.connection.key, 'utf8')
        try {
          await writePrivateFile(fs, keyFile, keyBytes)
        } finally {
          keyBytes.fill(0)
        }
      }
      const rpcFlags = ['-rpc', initial.connection.url]
      if (initial.connection.key) rpcFlags.push('-key-file', keyFile)
      const marketPath = path.join(tempDir, 'market.json')
      await runCheck(
        spawn,
        stagedBinary,
        [
          'direct-market',
          ...directVersionArgs(contract),
          '-network',
          'idena',
          '-contract',
          contract,
          '-code-hash',
          codeHash,
          '-out',
          marketPath,
          ...rpcFlags,
        ],
        ''
      )
      const marketInfo = await fs.promises.stat(marketPath)
      if (marketInfo.size < 1 || marketInfo.size > MAX_MARKET_BYTES) {
        refuse('fod_direct_confirm_failed')
      }
      const market = JSON.parse(await fs.promises.readFile(marketPath, 'utf8'))
      if (
        market.format !== 'fod.direct-market-state' ||
        market.version !== (contract === DIRECT_V4_CONTRACT ? 3 : 2) ||
        market.network !== 'idena' ||
        market.source !== 'node' ||
        market.contract !== contract.slice(2) ||
        market.codeHash !== codeHash.slice(2) ||
        !Array.isArray(market.orders)
      ) {
        refuse('fod_direct_confirm_failed')
      }
      const matchingOrders = market.orders.filter((item) => item.orderId === orderId)
      const order = matchingOrders[0]
      if (
        matchingOrders.length !== 1 ||
        order.buyer !== initial.coinbase
      ) {
        refuse('fod_direct_confirm_failed')
      }
      if (order.state === 'settled') {
        return {orderId, status: 'settled'}
      }
      if (order.state !== 'funded') refuse('fod_direct_confirm_failed')
      const reconcileUnknown = async () => {
        let pending
        try {
          pending = await rpc('bcn_pendingTransactions', [
            {address: `0x${initial.coinbase}`, count: 100},
          ])
        } catch {
          return {orderId, status: 'uncertain'}
        }
        if (!Array.isArray(pending?.transactions)) {
          return {orderId, status: 'uncertain'}
        }
        const matches = pending.transactions.filter((tx) =>
          tx?.type === 'callContract' &&
          typeof tx.hash === 'string' &&
          /^0x[0-9a-fA-F]{64}$/.test(tx.hash) &&
          typeof tx.from === 'string' &&
          tx.from.toLowerCase() === `0x${initial.coinbase}` &&
          typeof tx.to === 'string' &&
          tx.to.toLowerCase() === contract.toLowerCase() &&
          tx.amount === '0' &&
          typeof tx.payload === 'string' &&
          tx.payload.toLowerCase() === confirmPayload
        )
        if (matches.length !== 1) return {orderId, status: 'uncertain'}
        const hash = matches[0].hash.toLowerCase()
        marker.txHash = hash
        await saveConfirmAttempt(fs, markerPath, marker, true)
        const receipt = await rpc('bcn_txReceipt', [hash]).catch(() => null)
        if (receipt) {
          if (receipt.success !== true) refuse('fod_direct_confirm_failed')
          return {orderId, status: 'settled'}
        }
        return {orderId, status: 'pending'}
      }
      if (previousAttempt) {
        if (previousAttempt.txHash) {
          const receipt = await rpc('bcn_txReceipt', [previousAttempt.txHash])
            .catch(() => null)
          if (receipt) {
            if (receipt.success !== true) refuse('fod_direct_confirm_failed')
            return {orderId, status: 'settled'}
          }
          return {orderId, status: 'pending'}
        }
        return reconcileUnknown()
      }

      const preparedPath = path.join(tempDir, 'confirm.json')
      await runCheck(
        spawn,
        stagedBinary,
        [
          'direct-confirm',
          ...directVersionArgs(contract),
          '-network',
          'idena',
          '-contract',
          contract,
          '-code-hash',
          codeHash,
          '-delivery',
          receiptPath,
          '-prepared',
          preparedPath,
          ...rpcFlags,
        ],
        ''
      )
      const preparedFile = await readPrivateSelectedFile(
        fs,
        preparedPath,
        MAX_RECEIPT_BYTES * 2
      )
      let prepared
      let preparedText
      try {
        preparedText = preparedFile.data.toString('utf8')
        prepared = JSON.parse(preparedText)
      } finally {
        preparedFile.data.fill(0)
      }
      const orderMatch = preparedText.match(/"directOrderId"\s*:\s*([0-9]+)/g)
      if (
        prepared.format !== 'fod.prepared-direct-confirm' ||
        prepared.version !== 1 ||
        prepared.operation !== 'confirm' ||
        prepared.network !== 'idena' ||
        prepared.contract !== contract.slice(2) ||
        prepared.buyer !== initial.coinbase ||
        prepared.amount !== '0' ||
        prepared.calldata !== calldata ||
        prepared.ciphertextSha256 !== ciphertextDigest.toString('hex') ||
        !orderMatch ||
        orderMatch.length !== 1 ||
        orderMatch[0].replace(/.*:\s*/, '') !== orderId
      ) {
        refuse('fod_direct_confirm_failed')
      }

      const current = await activeIdentity(
        getNodeRpcConnection,
        getActiveCoinbase
      )
      if (
        !sameConnection(initial.connection, current.connection) ||
        initial.coinbase !== current.coinbase
      ) {
        refuse('fod_direct_confirm_identity_changed')
      }
      const sync = await rpc('bcn_syncing', [])
      const coinbase = normalizeCoinbase(await rpc('dna_getCoinbaseAddr', []))
      const account = await rpc('dna_getBalance', [`0x${coinbase}`])
      const stake = await rpc('contract_getStake', [contract])
      const feePerGas = await rpc('bcn_feePerGas', [])
      if (
        sync?.syncing !== false ||
        sync.wrongTime !== false ||
        sync.currentBlock !== sync.highestBlock ||
        coinbase !== initial.coinbase ||
        !account ||
        account.nonce !== account.mempoolNonce ||
        decimalAtoms(account.balance) < 3n * 10n ** 18n ||
        stake?.Hash?.toLowerCase() !== codeHash ||
        !/^[1-9][0-9]*$/.test(String(feePerGas))
      ) {
        refuse('fod_direct_confirm_node_unavailable')
      }
      const call = {
        from: `0x${initial.coinbase}`,
        contract,
        method: 'confirm',
        amount: '0',
        maxFee: '3',
        args: [{index: 0, format: 'hex', value: `0x${calldata}`}],
      }
      const estimate = await rpc('contract_estimateCall', [call])
      if (
        estimate?.success !== true ||
        decimalAtoms(estimate.gasCost) + decimalAtoms(estimate.txFee) >
          3n * 10n ** 18n
      ) {
        refuse('fod_direct_confirm_fee_unavailable')
      }
      const last = await activeIdentity(
        getNodeRpcConnection,
        getActiveCoinbase
      )
      if (
        !sameConnection(initial.connection, last.connection) ||
        initial.coinbase !== last.coinbase
      ) {
        refuse('fod_direct_confirm_identity_changed')
      }

      // Persist the no-retry boundary before asking the node to broadcast.
      try {
        await saveConfirmAttempt(fs, markerPath, marker)
      } catch (error) {
        if (error.code === 'EEXIST') return {orderId, status: 'pending'}
        throw error
      }
      let submitted
      try {
        submitted = await rpcCall(initial.connection, {
          method: 'contract_call',
          params: [call],
        })
      } catch {
        return reconcileUnknown()
      }
      const hash = submitted?.result
      if (
        submitted?.error ||
        typeof hash !== 'string' ||
        !/^0x[0-9a-fA-F]{64}$/.test(hash)
      ) {
        return reconcileUnknown()
      }
      marker.txHash = hash.toLowerCase()
      await saveConfirmAttempt(fs, markerPath, marker, true)
      for (let tries = 0; tries < 2; tries += 1) {
        const receipt = await rpc('bcn_txReceipt', [hash]).catch(() => null)
        if (receipt) {
          if (receipt.success !== true) refuse('fod_direct_confirm_failed')
          return {orderId, status: 'settled'}
        }
        if (tries === 0) await new Promise((resolve) => setTimeout(resolve, 3000))
      }
      return {orderId, status: 'pending'}
    } catch (error) {
      if (error instanceof DirectCheckError) throw error
      throw new DirectCheckError('fod_direct_confirm_failed')
    } finally {
      try {
        if (savedReceipt) savedReceipt.data.fill(0)
        if (tempDir)
          await fs.promises.rm(tempDir, {recursive: true, force: true})
      } finally {
        busy = false
      }
    }
  }
}

module.exports = {
  createFodDirectCheckService,
  createFodDirectReceiveService,
  createFodDirectBuyPrepareService,
  createFodDirectBuyResumeService,
  createFodDirectBuyCommitService,
  createFodDirectConfirmService,
  DIRECT_V3_CONTRACT,
  DIRECT_V4_CONTRACT,
}
