/* eslint-disable no-bitwise */

const {spawn: defaultSpawn} = require('child_process')
const defaultFs = require('fs')
const os = require('os')
const path = require('path')

// The deployment pins are public release data, never supplied by a message.
const CONTRACT = '0xe86d31069194690b1a818f24912bafdacfb29f19'
const CODE_HASH =
  '0x9ee10f3588bd403460ff6149016a3e4544df5c2ef02f6e6123a5cd75588f3319'
const MAX_MESSAGE_BYTES = 2048
const MAX_PURCHASE_BYTES = 16 * 1024 * 1024
const MAX_DELIVERY_KEY_BYTES = 128
const MAX_RESULT_BYTES = 4096
const MAX_CHILD_OUTPUT_BYTES = 64 * 1024
const CHILD_TIMEOUT_MS = 180000
const MAX_UINT64 = (1n << 64n) - 1n

// This is the compact JSON emitted by FoD's DirectDMEnvelope v2. Matching
// the complete text rejects reordered, missing, repeated, and unknown fields,
// while preserving the full unsigned 64-bit order ID as a decimal string.
const MESSAGE_PATTERN = /^\{"format":"fod\.direct-delivery","version":2,"network":"idena","contract":"([0-9a-f]{40})","author":"([0-9a-f]{40})","offerId":"([0-9a-f]{64})","orderId":([1-9][0-9]{0,19}),"orderNonce":([1-9][0-9]{0,19}),"buyer":"([0-9a-f]{40})","deliveryKey":"(04[0-9a-f]{128})","ciphertext":"([0-9a-f]{438})"\}$/

// FoD writes this display-only struct with JSON indentation. A complete
// match keeps orderId lossless and rejects any extra fields or private data.
const RESULT_PATTERN = /^\s*\{\s*"format"\s*:\s*"fod\.direct-check"\s*,\s*"version"\s*:\s*1\s*,\s*"contract"\s*:\s*"([0-9a-f]{40})"\s*,\s*"orderId"\s*:\s*([1-9][0-9]{0,19})\s*,\s*"author"\s*:\s*"([0-9a-f]{40})"\s*,\s*"epoch"\s*:\s*(0|[1-9][0-9]{0,4})\s*,\s*"usableFlips"\s*:\s*([1-9][0-9]{0,2})\s*\}\s*$/

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
  return BigInt(value) <= MAX_UINT64
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
    match[1] !== CONTRACT.slice(2) ||
    !isUint64(match[4]) ||
    !isUint64(match[5]) ||
    /^0+$/.test(match[2]) ||
    /^0+$/.test(match[3]) ||
    /^0+$/.test(match[6])
  ) {
    refuse('fod_direct_check_invalid_message')
  }

  return {contract: match[1], author: match[2], orderId: match[4], buyer: match[6]}
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

async function readPrivateSelectedFile(fs, selectedPath, maxBytes) {
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
    (process.platform !== 'win32' && (before.mode & 0o077) !== 0)
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
      (process.platform !== 'win32' && (opened.mode & 0o077) !== 0)
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

function runCheck(spawn, binaryPath, args, message) {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
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

function createFodDirectCheckService({
  dialog,
  getNodeRpcConnection,
  getActiveCoinbase,
  spawn = defaultSpawn,
  fs = defaultFs,
  binaryPath,
}) {
  let busy = false

  async function activeIdentity() {
    const connection = normalizeConnection(await getNodeRpcConnection())
    const coinbase = normalizeCoinbase(await getActiveCoinbase())
    const after = normalizeConnection(await getNodeRpcConnection())
    if (!sameConnection(connection, after)) {
      refuse('fod_direct_check_identity_changed')
    }
    return {connection, coinbase}
  }

  return async function checkDirectDelivery(payload) {
    if (busy) refuse('fod_direct_check_busy')
    busy = true
    let tempDir
    try {
      const message = parseMessage(payload)
      const initial = await activeIdentity()
      if (initial.coinbase !== message.buyer) {
        refuse('fod_direct_check_buyer_mismatch')
      }
      await checkBinary(fs, binaryPath)

      const purchasePath = await pickFile(dialog, 'Select retained FoD purchase')
      const keyPath = await pickFile(dialog, 'Select FoD delivery key')
      const purchase = await readPrivateSelectedFile(
        fs,
        purchasePath,
        MAX_PURCHASE_BYTES
      )
      let key
      try {
        key = await readPrivateSelectedFile(
          fs,
          keyPath,
          MAX_DELIVERY_KEY_BYTES
        )
        if (!/^(?:0x)?[0-9a-fA-F]{64}$/.test(key.data.toString('utf8').trim())) {
          refuse('fod_direct_check_invalid_file')
        }
        if (purchase.dev === key.dev && purchase.ino === key.ino) {
          refuse('fod_direct_check_invalid_file')
        }

        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fod-check-'))
        tempDir = await fs.promises.realpath(tempDir)
        await fs.promises.chmod(tempDir, 0o700)
        const purchaseCopy = path.join(tempDir, 'purchase.json')
        const keyCopy = path.join(tempDir, 'delivery.key')
        const resultPath = path.join(tempDir, 'result.json')
        await writePrivateFile(fs, purchaseCopy, purchase.data)
        await writePrivateFile(fs, keyCopy, key.data)

        const args = [
          'direct-check',
          '-network',
          'idena',
          '-contract',
          CONTRACT,
          '-code-hash',
          CODE_HASH,
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

        const current = await activeIdentity()
        if (
          !sameConnection(initial.connection, current.connection) ||
          initial.coinbase !== current.coinbase
        ) {
          refuse('fod_direct_check_identity_changed')
        }
        await checkBinary(fs, binaryPath)
        await runCheck(spawn, binaryPath, args, payload.message)

        const finished = await activeIdentity()
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
        if (tempDir) await fs.promises.rm(tempDir, {recursive: true, force: true})
      } catch {
        throw new DirectCheckError('fod_direct_check_failed')
      } finally {
        busy = false
      }
    }
  }
}

module.exports = {createFodDirectCheckService}
