/* global BigInt */
/* eslint-disable no-bitwise */

const {randomBytes} = require('crypto')
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

const HEX20 = /^(?:0x)?[0-9a-f]{40}$/
const HEX32 = /^(?:0x)?[0-9a-f]{64}$/
const DECIMAL = /^(0|[1-9][0-9]*)$/
const ACTION_ID = /^v7-[0-9a-f]{32}$/
const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_PREPARED_BYTES = 20 * 1024 * 1024
const MAX_SIGNED_BYTES = 2 * MAX_PREPARED_BYTES
const MAX_FEE = 100n * 10n ** 18n

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
  for (
    let current = directory;
    current !== path.dirname(root);
    current = path.dirname(current)
  ) {
    await syncDirectory(fs, current)
  }
  await syncDirectory(fs, path.dirname(root))
}

async function saveConfig(fs, root, config) {
  const temp = path.join(root, `config-${randomBytes(8).toString('hex')}.json`)
  await writePrivateFile(fs, temp, JSON.stringify(config))
  await fs.promises.rename(temp, path.join(root, 'config.json'))
}

async function selectedInput(fs, dialog, tempDir, name, privateOnly) {
  const result = await dialog.showOpenDialog({
    title: `Choose v7 ${name}`,
    properties: ['openFile'],
  })
  if (result?.canceled || result?.filePaths?.length !== 1)
    fail('File selection cancelled.')
  const {data} = await readPrivateSelectedFile(
    fs,
    result.filePaths[0],
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

function preparedSummary(prepared, config, operation) {
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
}) {
  let busy = false

  async function configOrNull() {
    await privateDirectory(fs, root)
    try {
      const config = await privateJSON(fs, path.join(root, 'config.json'))
      if (
        !plainObject(config, [
          'contract',
          'codeHash',
          'binaryPath',
          'binarySha256',
        ]) ||
        hex(config.contract, HEX20) !== config.contract ||
        hex(config.codeHash, HEX32) !== config.codeHash ||
        hex(config.binarySha256, HEX32) !== config.binarySha256 ||
        typeof config.binaryPath !== 'string' ||
        !path.isAbsolute(config.binaryPath)
      )
        fail('Invalid local v7 configuration.')
      return config
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
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
    return {connection, coinbase, rpc, account, epoch}
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

  async function readAction(config, coinbase, actionId) {
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
      meta?.contract !== config.contract ||
      meta?.codeHash !== config.codeHash ||
      !DECIMAL.test(meta?.maxFee || '')
    )
      fail('Invalid saved v7 action.')
    const summary = preparedSummary(prepared, config, meta.operation)
    return {directory, meta, prepared, summary}
  }

  async function listActions(config, coinbase) {
    const directory = await actionDirectory(coinbase)
    const entries = await fs.promises.readdir(directory, {withFileTypes: true})
    const actions = []
    for (const entry of entries
      .filter((item) => item.isDirectory() && ACTION_ID.test(item.name))
      .slice(-100)) {
      try {
        const saved = await readAction(config, coinbase, entry.name)
        const signedPath = path.join(saved.directory, 'signed.json')
        let submission = null
        try {
          submission = submittedSummary(
            await privateJSON(fs, signedPath, MAX_SIGNED_BYTES),
            config,
            saved,
            coinbase
          )
        } catch (error) {
          if (error.code !== 'ENOENT') submission = {status: 'uncertain'}
        }
        actions.push({
          actionId: entry.name,
          ...saved.summary,
          maxFee: saved.meta.maxFee,
          submitted: submission,
          attempted: fs.existsSync(path.join(saved.directory, 'attempt.json')),
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
    await saveConfig(fs, root, config)
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
    const actionId = `v7-${randomBytes(16).toString('hex')}`
    const directory = path.join(
      await actionDirectory(initial.coinbase),
      actionId
    )
    await fs.promises.mkdir(directory, {mode: 0o700})
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
            ['vault', 'delivery'].includes(name)
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
    const summary = preparedSummary(prepared, config, payload.operation)
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
    return {actionId, ...summary}
  }

  async function submit(payload) {
    if (!plainObject(payload, ['actionId']))
      fail('Invalid v7 submission request.')
    const config = await configOrNull()
    if (!config) fail('Set the local v7 deployment pin first.')
    const initial = await context(config, true)
    const action = await readAction(config, initial.coinbase, payload.actionId)
    if (fs.existsSync(path.join(action.directory, 'attempt.json'))) {
      fail(
        'This v7 action has already had a signing attempt. Check its transaction before preparing a new action.'
      )
    }
    const attached = action.summary.amount
    if (
      BigInt(attached) + BigInt(action.meta.maxFee) >
      idnaAtoms(initial.account.balance)
    ) {
      fail('The active identity has insufficient spendable balance.')
    }
    let effect = 'Check the current state before confirming.'
    if (OPERATIONS[action.meta.operation].disclosure) {
      effect = 'This action publishes the bundle keys on-chain.'
    } else if (action.meta.operation === 'activate') {
      effect =
        'Activation permanently locks 10,000 iDNA without a redeemable share.'
    } else if (action.meta.operation === 'cancel') {
      effect = 'Cancellation can forfeit fraud collateral.'
    } else if (OPERATIONS[action.meta.operation].irreversible) {
      effect = 'This action has an irreversible contract effect.'
    }
    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      title: `Send v7 ${action.meta.operation}`,
      message: `Sign and broadcast ${action.meta.operation}?`,
      detail: `Attached: ${attached} base units. Maximum fee: ${action.meta.maxFee} base units. ${effect}`,
      buttons: ['Cancel', 'Sign and broadcast'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (confirmation.response !== 1) return {status: 'cancelled'}
    const nodeKey = await dialog.showOpenDialog({
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
    selectedKey.data.fill(0)
    const fresh = await context(config, true)
    if (
      fresh.coinbase !== initial.coinbase ||
      fresh.connection.url !== initial.connection.url ||
      fresh.connection.key !== initial.connection.key
    ) {
      fail('The active node or identity changed.')
    }
    await writePrivateFile(
      fs,
      path.join(action.directory, 'attempt.json'),
      JSON.stringify({
        at: new Date().toISOString(),
        accountNonce: fresh.account.nonce + 1,
      })
    )
    await syncDirectory(fs, action.directory)
    let error
    try {
      await withCLI(config, fresh, '', async ({tempDir, rpcFlags}) => {
        const {data} = await readPrivateSelectedFile(
          fs,
          keyPath,
          1024,
          true,
          true
        )
        const copiedKey = path.join(tempDir, 'nodekey')
        try {
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
      })
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
    const action = await readAction(config, initial.coinbase, payload.actionId)
    const signed = await privateJSON(
      fs,
      path.join(action.directory, 'signed.json'),
      MAX_SIGNED_BYTES
    )
    const summary = submittedSummary(signed, config, action, initial.coinbase)
    let receipt
    try {
      receipt = await initial.rpc('bcn_txReceipt', [summary.txHash])
    } catch {
      return {...summary, status: 'uncertain'}
    }
    if (typeof receipt?.success !== 'boolean')
      return {...summary, status: 'uncertain'}
    return {
      ...summary,
      status: receipt.success === true ? 'included' : 'failed',
    }
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
    return {status: 'saved', fileName: 'ciphertext.json', folder: directory}
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
      !Number.isInteger(receipt.usableFlips) ||
      receipt.usableFlips < 1 ||
      receipt.usableFlips > 32
    )
      fail('The verified v7 receipt could not be read.')
    return {
      status: 'verified',
      usableFlips: receipt.usableFlips,
      folder: directory,
    }
  }

  async function perform(method, payload) {
    if (busy) fail('A v7 action is already in progress.')
    busy = true
    try {
      switch (method) {
        case 'status':
          return await status()
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

  return perform
}

module.exports = {createFodV7Service}
