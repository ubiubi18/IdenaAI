/** @jest-environment node */

const {EventEmitter} = require('events')
const {createECDH, createHash} = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {PassThrough} = require('stream')
const {
  createFodDirectCheckService,
  createFodDirectReceiveService,
  createFodDirectBuyPrepareService,
  createFodDirectListService,
  createFodDirectMarketService,
  createFodDirectBuyResumeService,
  createFodDirectBuyCommitService,
  createFodDirectConfirmService,
  createFodDirectRecoverService,
  createFodDirectRefundService,
} = require('./fod-direct-check')

const CONTRACT = 'e86d31069194690b1a818f24912bafdacfb29f19'
const CODE_HASH =
  '0x9ee10f3588bd403460ff6149016a3e4544df5c2ef02f6e6123a5cd75588f3319'
const V4_CONTRACT = '3730be2217b0de1fdfe73098d37f3174dd9748cb'
const V4_CODE_HASH =
  '0x8b9fd14f9c08708db1ab25d90396563d3efe6bed6843c5aae15932d68bdf614c'
const TEST_BINARY_HASH = createHash('sha256')
  .update(fs.readFileSync(process.execPath))
  .digest('hex')
const AUTHOR = 'a'.repeat(40)
const BUYER = 'b'.repeat(40)
const CIPHERTEXT = 'c'.repeat(438)
const ORDER_ID = '18446744073709551615'
const CONFIRM_ORDER_ID = '17'

function messageText(orderId = ORDER_ID, contract = CONTRACT) {
  const text = JSON.stringify({
    format: 'fod.direct-delivery',
    version: 2,
    network: 'idena',
    contract,
    author: AUTHOR,
    offerId: 'd'.repeat(64),
    orderId: 1,
    orderNonce: 1,
    buyer: BUYER,
    deliveryKey: `04${'e'.repeat(128)}`,
    ciphertext: CIPHERTEXT,
  })
  return text.replace('"orderId":1', `"orderId":${orderId}`)
}

function resultText(orderId = ORDER_ID, author = AUTHOR, contract = CONTRACT) {
  return `{"format":"fod.direct-check","version":1,"contract":"${contract}","orderId":${orderId},"author":"${author}","epoch":230,"usableFlips":3}`
}

function receiptText(orderId = ORDER_ID, author = AUTHOR, contract = CONTRACT) {
  const text = JSON.stringify({
    format: 'fod.opened-direct-delivery',
    version: 1,
    contract,
    offerId: 'd'.repeat(64),
    orderId: 1,
    orderNonce: 1,
    buyer: BUYER,
    deliveryKey: `04${'e'.repeat(128)}`,
    author,
    epoch: 230,
    inventoryCommitment: '1'.repeat(64),
    keyCommitment: '2'.repeat(64),
    ciphertext: CIPHERTEXT,
    usableFlips: 3,
    contentCheckSignature: '3'.repeat(130),
  })
  return text.replace('"orderId":1', `"orderId":${orderId}`)
}

function fakeSpawn({
  result = resultText(),
  exitCode = 0,
  stderr = '',
  vaultMode = 0o600,
  resultMode = 0o600,
  marketMode = 0o644,
  keyMode = 0o600,
} = {}) {
  const calls = []
  const spawn = jest.fn((binary, args, options) => {
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = jest.fn(() => {
      setImmediate(() => child.emit('close', null, 'SIGKILL'))
      return true
    })
    const body = []
    const call = {binary, args, options, body, child}
    calls.push(call)
    child.stdin.on('data', (chunk) => body.push(chunk))
    child.stdin.on('finish', () => {
      if (stderr) child.stderr.write(stderr)
      if (exitCode === 0) {
        const outputFlag =
          args[0] === 'direct-confirm' || args[0] === 'direct-buy' ||
          args[0] === 'direct-list' || args[0] === 'direct-refund'
            ? '-prepared'
            : '-out'
        const outPath = args[args.indexOf(outputFlag) + 1]
        if (args[0] === 'direct-receive' || args[0] === 'direct-recover') {
          fs.writeFileSync(args[args.indexOf('-vault') + 1], 'age-encrypted', {
            mode: vaultMode,
          })
        }
        if (args[0] === 'direct-buy') {
          const deliveryKey = args[args.indexOf('-delivery-key') + 1]
          if (!fs.existsSync(deliveryKey)) {
            fs.writeFileSync(deliveryKey, '1'.repeat(64), {mode: keyMode})
          }
        }
        fs.writeFileSync(
          outPath,
          typeof result === 'function' ? result(args) : result,
          {mode: args[0] === 'direct-market' ? marketMode : resultMode}
        )
      }
      setImmediate(() => child.emit('close', exitCode))
    })
    return child
  })
  return {spawn, calls}
}

describe('trusted FoD direct check', () => {
  let root
  let purchasePath
  let keyPath
  let dialog

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'idena-fod-test-'))
    )
    purchasePath = path.join(root, 'purchase.json')
    keyPath = path.join(root, 'delivery.key')
    fs.writeFileSync(purchasePath, '{"retained":"secret"}', {mode: 0o600})
    fs.writeFileSync(keyPath, '1'.repeat(64), {mode: 0o600})
    dialog = {
      showOpenDialog: jest
        .fn()
        .mockResolvedValueOnce({canceled: false, filePaths: [purchasePath]})
        .mockResolvedValueOnce({canceled: false, filePaths: [keyPath]}),
    }
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  function service({
    spawn = fakeSpawn().spawn,
    rpc = () => ({url: 'http://127.0.0.1:9009', key: 'RPC_SECRET'}),
    coinbase = async () => `0x${BUYER}`,
    selectedDialog = dialog,
  } = {}) {
    return createFodDirectCheckService({
      dialog: selectedDialog,
      getNodeRpcConnection: rpc,
      getActiveCoinbase: coinbase,
      spawn,
      fs,
      binaryPath: process.execPath,
      expectedBinaryHash: TEST_BINARY_HASH,
    })
  }

  it('uses fixed flags, private copies, stdin, and returns only a public summary', async () => {
    const child = fakeSpawn()
    let stagedBinary
    const check = service({
      spawn: (binary, args, options) => {
        stagedBinary = {
          directoryMode: fs.statSync(path.dirname(binary)).mode & 0o777,
          binaryMode: fs.statSync(binary).mode & 0o777,
          hash: createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),
        }
        return child.spawn(binary, args, options)
      },
    })
    const summary = await check({message: messageText()})
    const [{binary, args, options, body}] = child.calls
    const purchaseCopy = args[args.indexOf('-purchase') + 1]
    const keyCopy = args[args.indexOf('-delivery-key') + 1]
    const rpcKeyFile = args[args.indexOf('-key-file') + 1]
    const outPath = args[args.indexOf('-out') + 1]

    expect(binary).not.toBe(process.execPath)
    expect(stagedBinary).toEqual({
      directoryMode: 0o700,
      binaryMode: 0o700,
      hash: TEST_BINARY_HASH,
    })
    expect(options).toEqual(
      expect.objectContaining({shell: false, stdio: ['pipe', 'pipe', 'pipe']})
    )
    expect(args).toEqual([
      'direct-check',
      '-network',
      'idena',
      '-contract',
      `0x${CONTRACT}`,
      '-code-hash',
      CODE_HASH,
      '-order',
      ORDER_ID,
      '-message',
      '-',
      '-purchase',
      purchaseCopy,
      '-delivery-key',
      keyCopy,
      '-out',
      outPath,
      '-rpc',
      'http://127.0.0.1:9009',
      '-key-file',
      rpcKeyFile,
    ])
    expect(Buffer.concat(body).toString('utf8')).toBe(messageText())
    expect(args.join(' ')).not.toContain('RPC_SECRET')
    expect(args.join(' ')).not.toContain(CIPHERTEXT)
    expect(purchaseCopy).not.toBe(purchasePath)
    expect(keyCopy).not.toBe(keyPath)
    expect(summary).toEqual({
      format: 'fod.direct-check',
      version: 1,
      contract: `0x${CONTRACT}`,
      orderId: ORDER_ID,
      author: `0x${AUTHOR}`,
      epoch: 230,
      usableFlips: 3,
    })
    expect(JSON.stringify(summary)).not.toContain('SECRET')
    expect(JSON.stringify(summary)).not.toContain(CIPHERTEXT)
    expect(JSON.stringify(summary)).not.toContain(root)
    expect(fs.existsSync(path.dirname(outPath))).toBe(false)
  })

  it('checks v4 with the pinned hash and explicit CLI version', async () => {
    const child = fakeSpawn({result: resultText(ORDER_ID, AUTHOR, V4_CONTRACT)})
    const summary = await service({spawn: child.spawn})({
      message: messageText(ORDER_ID, V4_CONTRACT),
    })
    const {args} = child.calls[0]
    expect(args.slice(0, 3)).toEqual(['direct-check', '-direct-version', '4'])
    expect(args[args.indexOf('-code-hash') + 1]).toBe(V4_CODE_HASH)
    expect(summary.contract).toBe(`0x${V4_CONTRACT}`)
  })

  it('rejects payload fields and malformed messages before opening files', async () => {
    const child = fakeSpawn()
    const check = service({spawn: child.spawn})
    await expect(
      check({message: messageText(), orderId: '2', rpc: 'https://attacker'})
    ).rejects.toThrow('fod_direct_check_invalid_message')
    await expect(
      check({message: messageText().replace('"version":2', '"version":1')})
    ).rejects.toThrow('fod_direct_check_invalid_message')
    await expect(
      check({message: `${messageText().slice(0, -1)},"broadcast":true}`})
    ).rejects.toThrow('fod_direct_check_invalid_message')
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(child.spawn).not.toHaveBeenCalled()
  })

  it('rejects a message for another buyer before file selection', async () => {
    const child = fakeSpawn()
    const check = service({
      spawn: child.spawn,
      coinbase: async () => `0x${'f'.repeat(40)}`,
    })
    await expect(check({message: messageText()})).rejects.toThrow(
      'fod_direct_check_buyer_mismatch'
    )
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(child.spawn).not.toHaveBeenCalled()
  })

  it('rejects aliases, symlinks, and group-readable selected files', async () => {
    const variants = [
      () => purchasePath,
      () => {
        const link = path.join(root, 'alias.key')
        fs.symlinkSync(keyPath, link)
        return link
      },
      () => {
        fs.writeFileSync(keyPath, '{"encrypted":"archive"}')
        return keyPath
      },
      () => {
        fs.writeFileSync(keyPath, '1'.repeat(64))
        fs.chmodSync(keyPath, 0o640)
        return keyPath
      },
    ]
    for (const selected of variants) {
      const picked = {
        showOpenDialog: jest
          .fn()
          .mockResolvedValueOnce({canceled: false, filePaths: [purchasePath]})
          .mockResolvedValueOnce({canceled: false, filePaths: [selected()]}),
      }
      const child = fakeSpawn()
      await expect(
        service({spawn: child.spawn, selectedDialog: picked})({
          message: messageText(),
        })
      ).rejects.toThrow('fod_direct_check_invalid_file')
      expect(child.spawn).not.toHaveBeenCalled()
    }
  })

  it('refuses changed node identity, unsafe RPC URLs, and duplicate requests', async () => {
    const child = fakeSpawn()
    let reads = 0
    const rpc = () => ({
      url: ++reads > 2 ? 'https://other.example/rpc' : 'http://127.0.0.1:9009',
      key: 'RPC_SECRET',
    })
    await expect(
      service({spawn: child.spawn, rpc})({message: messageText()})
    ).rejects.toThrow('fod_direct_check_identity_changed')
    expect(child.spawn).not.toHaveBeenCalled()

    let readsAfterSpawn = 0
    const changedAfterSpawn = service({
      spawn: child.spawn,
      selectedDialog: {
        showOpenDialog: jest
          .fn()
          .mockResolvedValueOnce({canceled: false, filePaths: [purchasePath]})
          .mockResolvedValueOnce({canceled: false, filePaths: [keyPath]}),
      },
      rpc: () => ({
        url:
          ++readsAfterSpawn > 4
            ? 'https://other.example/rpc'
            : 'http://127.0.0.1:9009',
        key: 'RPC_SECRET',
      }),
    })
    await expect(changedAfterSpawn({message: messageText()})).rejects.toThrow(
      'fod_direct_check_identity_changed'
    )
    expect(child.spawn).toHaveBeenCalledTimes(1)

    const unsafe = service({
      spawn: child.spawn,
      rpc: () => ({url: 'http://user:password@127.0.0.1:9009', key: ''}),
    })
    await expect(unsafe({message: messageText()})).rejects.toThrow(
      'fod_direct_check_identity_unavailable'
    )
    expect(child.spawn).toHaveBeenCalledTimes(1)

    let releasePicker
    let pickerStarted
    const pickerReady = new Promise((resolve) => {
      pickerStarted = resolve
    })
    const heldDialog = {
      showOpenDialog: () =>
        new Promise((resolve) => {
          releasePicker = resolve
          pickerStarted()
        }),
    }
    const check = service({selectedDialog: heldDialog, spawn: child.spawn})
    const first = check({message: messageText()})
    await pickerReady
    await expect(check({message: messageText()})).rejects.toThrow(
      'fod_direct_check_busy'
    )
    releasePicker({canceled: true, filePaths: []})
    await expect(first).rejects.toThrow('fod_direct_check_cancelled')
  })

  it('omits the RPC key file for an empty key and cleans up after child failure', async () => {
    const child = fakeSpawn({exitCode: 1, stderr: 'RPC_SECRET private path'})
    const check = service({
      spawn: child.spawn,
      rpc: () => ({url: 'http://127.0.0.1:9009', key: ''}),
    })
    await expect(check({message: messageText()})).rejects.toThrow(
      'fod_direct_check_failed'
    )
    const args = child.calls[0].args
    expect(args).not.toContain('-key-file')
    expect(args).not.toContain('-key')
    expect(fs.existsSync(path.dirname(args[args.indexOf('-out') + 1]))).toBe(
      false
    )
  })

  it('refuses unexpected result fields or a different author', async () => {
    for (const result of [
      resultText(ORDER_ID, 'f'.repeat(40)),
      resultText().replace(/}$/, ',"ciphertext":"SECRET"}'),
    ]) {
      const child = fakeSpawn({result})
      const check = service({spawn: child.spawn})
      await expect(check({message: messageText()})).rejects.toThrow(
        'fod_direct_check_failed'
      )
      const args = child.calls[0].args
      expect(fs.existsSync(path.dirname(args[args.indexOf('-out') + 1]))).toBe(
        false
      )
      dialog.showOpenDialog
        .mockResolvedValueOnce({canceled: false, filePaths: [purchasePath]})
        .mockResolvedValueOnce({canceled: false, filePaths: [keyPath]})
    }
  })
})

describe('trusted FoD direct buyer refund', () => {
  let root
  let vaultRoot
  const orderId = CONFIRM_ORDER_ID
  const offerId = 'd'.repeat(64)
  const blockHash = `0x${'c'.repeat(64)}`
  const txHash = `0x${'a'.repeat(64)}`
  const calldata = '0000000000000011'
  const payload = `0x0a06726566756e641208${calldata}`

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'idena-fod-refund-test-')))
    vaultRoot = path.join(root, 'vaults')
  })

  afterEach(() => fs.rmSync(root, {recursive: true, force: true}))

  function market(state = 'funded', height = 9000) {
    return JSON.stringify({
      format: 'fod.direct-market-state', version: 3, network: 'idena',
      source: 'node', contract: V4_CONTRACT, codeHash: V4_CODE_HASH.slice(2),
      blockHeight: height, observedAt: '2026-10-13T00:00:00Z',
      offers: [{
        offerId, author: AUTHOR, epoch: 230, coveredFlips: 1,
        inventoryCommitment: 'e'.repeat(64), price: '1000000000000000000',
        openOrderId: state === 'refunded' ? '0' : orderId,
        retired: state === 'refunded',
      }],
      orders: [{
        orderId, offerId, buyer: BUYER, paid: '1000000000000000000',
        bond: '500000000000000000000', fundedAtBlock: '1',
        refundAtBlock: '8641', state, keysPublic: false,
      }],
    })
  }

  function prepared() {
    return JSON.stringify({
      format: 'fod.prepared-direct-refund', version: 1,
      operation: 'refund', network: 'idena', contract: V4_CONTRACT,
      amount: '0', calldata, preparedAt: '2026-10-13T00:00:00Z',
      submitted: false, directOfferId: offerId,
      directOrderId: Number(orderId), directVersion: 4,
    })
  }

  function service({spawn, rpcCall, dialog} = {}) {
    return createFodDirectRefundService({
      dialog: dialog || {showMessageBox: jest.fn().mockResolvedValue({response: 1})},
      getNodeRpcConnection: () => ({url: 'http://127.0.0.1:9009', key: 'RPC_SECRET'}),
      getActiveCoinbase: async () => `0x${BUYER}`,
      rpcCall: rpcCall || jest.fn(), spawn, fs,
      binaryPath: process.execPath, expectedBinaryHash: TEST_BINARY_HASH,
      vaultRoot,
    })
  }

  function nodeRpc(submit) {
    return jest.fn(async (_connection, {method, params}) => {
      switch (method) {
        case 'bcn_syncing':
          return {result: {syncing: false, wrongTime: false,
            currentBlock: 9000, highestBlock: 9000}}
        case 'dna_getCoinbaseAddr':
          return {result: `0x${BUYER}`}
        case 'dna_getBalance':
          return {result: {balance: '3', nonce: 1, mempoolNonce: 1}}
        case 'contract_getStake':
          return {result: {Hash: V4_CODE_HASH}}
        case 'bcn_feePerGas':
          return {result: '1'}
        case 'contract_estimateCall':
          expect(params[0].method).toBe('refund')
          expect(params[0].args[0].value).toBe(`0x${calldata}`)
          return {result: {success: true, gasUsed: 100000}}
        case 'contract_call':
          return submit(params[0])
        case 'bcn_pendingTransactions':
          return {result: {transactions: []}}
        case 'bcn_txReceipt':
          return {result: {success: true}}
        case 'bcn_transaction':
          return {result: {type: 'callContract', hash: txHash,
            from: `0x${BUYER}`, to: `0x${V4_CONTRACT}`,
            amount: '0', payload, blockHash}}
        case 'bcn_block':
          return {result: {hash: blockHash, height: 9000}}
        case 'bcn_blockAt':
          return {result: {hash: blockHash, height: 9000}}
        default:
          throw new Error(`unexpected RPC method: ${method}`)
      }
    })
  }

  it('prepares and reconciles the exact refundable order', async () => {
    let snapshots = 0
    const child = fakeSpawn({result: (args) =>
      args[0] === 'direct-market'
        ? market(++snapshots >= 3 ? 'refunded' : 'funded')
        : prepared()})
    const rpcCall = nodeRpc((call) => {
      expect(call).toMatchObject({
        from: `0x${BUYER}`, contract: `0x${V4_CONTRACT}`,
        method: 'refund', amount: '0', maxFee: '3',
      })
      return {result: txHash}
    })
    await expect(service({spawn: child.spawn, rpcCall})({orderId}))
      .resolves.toEqual({orderId, status: 'refunded'})
    expect(child.calls.map(({args}) => args[0])).toEqual([
      'direct-market', 'direct-refund', 'direct-market', 'direct-market',
    ])
    expect(child.calls[1].args).not.toContain('-broadcast')
    expect(child.calls[1].args.join(' ')).not.toContain('RPC_SECRET')
    expect(fs.statSync(path.join(vaultRoot, BUYER,
      `refund-${V4_CONTRACT}-${orderId}.json`)).mode & 0o777).toBe(0o600)
    expect(rpcCall.mock.calls.filter(([, call]) => call.method === 'contract_call'))
      .toHaveLength(1)
  })

  it('blocks an early refund and never retries an unknown broadcast', async () => {
    const early = fakeSpawn({result: market('funded', 8640)})
    const earlyRpc = jest.fn()
    await expect(service({spawn: early.spawn, rpcCall: earlyRpc})({orderId}))
      .rejects.toThrow('fod_direct_refund_not_ready')
    expect(earlyRpc).not.toHaveBeenCalled()

    const child = fakeSpawn({result: (args) =>
      args[0] === 'direct-market' ? market() : prepared()})
    const rpcCall = nodeRpc(() => { throw new Error('lost response') })
    const refund = service({spawn: child.spawn, rpcCall})
    await expect(refund({orderId})).resolves.toEqual({orderId, status: 'uncertain'})
    await expect(refund({orderId})).resolves.toEqual({orderId, status: 'uncertain'})
    expect(rpcCall.mock.calls.filter(([, call]) => call.method === 'contract_call'))
      .toHaveLength(1)
    expect(child.calls.map(({args}) => args[0])).toEqual([
      'direct-market', 'direct-refund', 'direct-market', 'direct-market',
    ])
  })

  it('refuses a refund for an order belonging to another buyer', async () => {
    const other = JSON.parse(market())
    other.orders[0].buyer = AUTHOR
    const child = fakeSpawn({result: JSON.stringify(other)})
    const rpcCall = jest.fn()
    const dialog = {showMessageBox: jest.fn()}
    await expect(service({spawn: child.spawn, rpcCall, dialog})({orderId}))
      .rejects.toThrow('fod_direct_refund_order_mismatch')
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(rpcCall).not.toHaveBeenCalled()
    expect(child.calls.map(({args}) => args[0])).toEqual(['direct-market'])
  })
})

describe('public direct market', () => {
  const snapshot = {
    format: 'fod.direct-market-state',
    version: 3,
    network: 'idena',
    contract: V4_CONTRACT,
    codeHash: V4_CODE_HASH.slice(2),
    blockHeight: 7,
    observedAt: '2026-10-13T09:00:00Z',
    source: 'node',
    offers: [{
      offerId: 'd'.repeat(64), author: AUTHOR, epoch: 230,
      coveredFlips: 3, inventoryCommitment: 'e'.repeat(64),
      price: '1000000000000000000', openOrderId: '0', retired: false,
    }],
    orders: [],
  }

  function service(spawn, coinbase = async () => `0x${BUYER}`) {
    return createFodDirectMarketService({
      getNodeRpcConnection: () => ({url: 'http://127.0.0.1:9009', key: 'RPC_SECRET'}),
      getActiveCoinbase: coinbase,
      spawn,
      fs,
      binaryPath: process.execPath,
      expectedBinaryHash: TEST_BINARY_HASH,
    })
  }

  it('returns only bounded public node records through the pinned CLI', async () => {
    const child = fakeSpawn({result: JSON.stringify({...snapshot, privateKey: 'never-forward'})})
    const market = await service(child.spawn)({directVersion: 4})
    expect(market).toEqual(snapshot)
    expect(child.calls).toHaveLength(1)
    const {args} = child.calls[0]
    expect(args[0]).toBe('direct-market')
    expect(args).toContain(V4_CODE_HASH)
    expect(args).not.toContain('-broadcast')
    expect(args.join(' ')).not.toContain('RPC_SECRET')
    expect(fs.existsSync(args[args.indexOf('-out') + 1])).toBe(false)
  })

  it('rejects unpinned versions, malformed records, and identity changes', async () => {
    const child = fakeSpawn({result: JSON.stringify(snapshot)})
    await expect(service(child.spawn)({directVersion: 5})).rejects.toThrow(
      'fod_direct_market_invalid_request'
    )
    expect(child.spawn).not.toHaveBeenCalled()

    const malformed = fakeSpawn({
      result: JSON.stringify({...snapshot, offers: [{...snapshot.offers[0], price: '-1'}]}),
    })
    await expect(service(malformed.spawn)({directVersion: 4})).rejects.toThrow(
      'fod_direct_market_failed'
    )
    let reads = 0
    await expect(service(child.spawn, async () =>
      `0x${++reads > 1 ? AUTHOR : BUYER}`
    )({directVersion: 4})).rejects.toThrow(
      'fod_direct_market_identity_changed'
    )
  })
})

describe('trusted FoD direct seller listing', () => {
  let root
  let vaultRoot
  let sessionPath
  let vaultPath
  let nodeKeyPath
  let session
  let dialog
  let rpcCall

  const price = 10n ** 18n
  const epochBytes = Buffer.from([0, 230])
  const offerId = createHash('sha256')
    .update('fod:direct-offer:v2')
    .update(Buffer.from(AUTHOR, 'hex'))
    .update(epochBytes)
    .digest('hex')
  const inventoryCommitment = createHash('sha256')
    .update('fod.bundle-manifest:v1')
    .update(AUTHOR)
    .update(epochBytes)
    .update(Buffer.from([0]))
    .update('cid-one')
    .digest('hex')
  const keyCommitment = 'f'.repeat(64)
  const calldata = Buffer.alloc(86)
  calldata.writeUInt16BE(230, 0)
  calldata.writeUInt32BE(1, 2)
  Buffer.from(inventoryCommitment, 'hex').copy(calldata, 6)
  Buffer.from(keyCommitment, 'hex').copy(calldata, 38)
  Buffer.from(price.toString(16).padStart(32, '0'), 'hex').copy(calldata, 70)

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'fod-list-test-'))
    )
    vaultRoot = path.join(root, 'vaults')
    sessionPath = path.join(root, 'session.json')
    vaultPath = path.join(root, 'vault.age')
    nodeKeyPath = path.join(root, 'nodekey')
    session = {
      format: 'fod.session-bundle',
      version: 1,
      author: AUTHOR,
      epoch: 230,
      manifest: ['cid-one'],
      inventory: {},
      verdict: {},
    }
    fs.writeFileSync(sessionPath, JSON.stringify(session), {mode: 0o644})
    fs.writeFileSync(vaultPath, 'encrypted-vault', {mode: 0o600})
    fs.writeFileSync(nodeKeyPath, '1'.repeat(64), {mode: 0o600})
    dialog = {
      showOpenDialog: jest
        .fn()
        .mockResolvedValueOnce({canceled: false, filePaths: [sessionPath]})
        .mockResolvedValueOnce({canceled: false, filePaths: [vaultPath]})
        .mockResolvedValueOnce({canceled: false, filePaths: [nodeKeyPath]}),
      showMessageBox: jest.fn().mockResolvedValue({response: 0}),
    }
    rpcCall = jest.fn(async (_connection, {method}) => {
      switch (method) {
        case 'bcn_syncing':
          return {
            result: {
              syncing: false,
              wrongTime: false,
              currentBlock: 100,
              highestBlock: 100,
            },
          }
        case 'dna_getCoinbaseAddr':
          return {result: `0x${AUTHOR}`}
        case 'dna_getBalance':
          return {result: {nonce: 0, mempoolNonce: 0, balance: '100'}}
        case 'contract_getStake':
          return {result: {Hash: V4_CODE_HASH}}
        case 'bcn_feePerGas':
          return {result: '1'}
        case 'contract_estimateCall':
          return {result: {success: true, gasUsed: 1000, minGasLimit: 1000}}
        case 'bcn_pendingTransactions':
          return {result: {transactions: []}}
        default:
          throw new Error(`unexpected ${method}`)
      }
    })
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  function preparedList(overrides = {}) {
    return {
      format: 'fod.prepared-direct-list',
      version: 1,
      operation: 'list',
      network: 'idena',
      contract: V4_CONTRACT,
      amount: '0',
      calldata: calldata.toString('hex'),
      preparedAt: '2026-10-13T08:00:00Z',
      submitted: false,
      price: price.toString(),
      author: AUTHOR,
      epoch: 230,
      coveredFlips: 1,
      keyCommitment,
      inventoryCommitment,
      directOfferId: offerId,
      directSession: session,
      ...overrides,
    }
  }

  function market() {
    return {
      format: 'fod.direct-market-state',
      version: 3,
      network: 'idena',
      contract: V4_CONTRACT,
      codeHash: V4_CODE_HASH.slice(2),
      blockHeight: 100,
      observedAt: '2026-10-13T08:00:00Z',
      source: 'node',
      offers: [],
      orders: [],
    }
  }

  function service(child) {
    return createFodDirectListService({
      dialog,
      fs,
      spawn: child.spawn,
      binaryPath: process.execPath,
      expectedBinaryHash: TEST_BINARY_HASH,
      vaultRoot,
      getNodeRpcConnection: async () => ({
        url: 'http://127.0.0.1:9009',
        key: 'RPC_SECRET',
      }),
      getActiveCoinbase: async () => `0x${AUTHOR}`,
      rpcCall,
    })
  }

  function childForListing(overrides = {}) {
    return fakeSpawn({
      result: (args) =>
        JSON.stringify(
          args[0] === 'direct-market' ? market() : preparedList(overrides)
        ),
    })
  }

  it('prepares with owner-only files and a native confirmation before publishing', async () => {
    const child = childForListing()
    const result = await service(child)({
      priceIdna: '1',
      passphrase: 'vault secret',
    })
    expect(result).toEqual({status: 'cancelled', offerId, priceIdna: '1'})
    expect(rpcCall).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({method: 'contract_call'})
    )
    const list = child.calls.find(({args}) => args[0] === 'direct-list')
    expect(list.options.env).toEqual({FOD_PASSPHRASE: 'vault secret'})
    expect(list.args.join(' ')).not.toContain('vault secret')
    expect(list.args).toContain('-nodekey')
    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({buttons: ['Cancel', 'Publish offer']})
    )
    expect(fs.readdirSync(path.join(vaultRoot, AUTHOR))).toEqual([])
  })

  it('records an uncertain broadcast and never submits it again blindly', async () => {
    const child = childForListing()
    dialog.showMessageBox.mockResolvedValue({response: 1})
    rpcCall.mockImplementation(async (_connection, {method}) => {
      if (method === 'contract_call') throw new Error('transport lost')
      switch (method) {
        case 'bcn_syncing':
          return {
            result: {
              syncing: false,
              wrongTime: false,
              currentBlock: 100,
              highestBlock: 100,
            },
          }
        case 'dna_getCoinbaseAddr':
          return {result: `0x${AUTHOR}`}
        case 'dna_getBalance':
          return {result: {nonce: 0, mempoolNonce: 0, balance: '100'}}
        case 'contract_getStake':
          return {result: {Hash: V4_CODE_HASH}}
        case 'bcn_feePerGas':
          return {result: '1'}
        case 'contract_estimateCall':
          return {result: {success: true, gasUsed: 1000, minGasLimit: 1000}}
        case 'bcn_pendingTransactions':
          return {result: {transactions: []}}
        default:
          throw new Error(`unexpected ${method}`)
      }
    })
    const list = service(child)
    await expect(
      list({priceIdna: '1', passphrase: 'vault secret'})
    ).resolves.toEqual({status: 'uncertain', offerId, priceIdna: '1'})
    expect(
      fs.existsSync(path.join(vaultRoot, AUTHOR, `list-${offerId}.json`))
    ).toBe(true)
    dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [sessionPath],
    })
    await expect(list({priceIdna: '1', passphrase: ''})).resolves.toEqual({
      status: 'uncertain',
      offerId,
      priceIdna: '1',
    })
    expect(
      rpcCall.mock.calls.filter(
        ([, payload]) => payload.method === 'contract_call'
      )
    ).toHaveLength(1)
    expect(dialog.showOpenDialog).toHaveBeenCalledTimes(4)
  })

  it.each([
    ['matching transaction', null, 'included', true],
    ['different listing calldata', '0x0a046c6973741256deadbeef', 'uncertain', true],
    ['failed transaction beside an existing offer', null, 'conflict', false],
  ])(
    'reconciles a %s without attributing another listing',
    async (_scenario, otherPayload, expectedStatus, receiptSuccess) => {
      const txHash = `0x${'1'.repeat(64)}`
      const blockHash = `0x${'2'.repeat(64)}`
      let submitted = false
      const child = fakeSpawn({
        result: (args) => {
          if (args[0] !== 'direct-market') return JSON.stringify(preparedList())
          const state = market()
          if (submitted)
            state.offers.push({
              offerId,
              author: AUTHOR,
              epoch: 230,
              coveredFlips: 1,
              inventoryCommitment,
              price: price.toString(),
              openOrderId: '0',
              retired: false,
            })
          return JSON.stringify(state)
        },
      })
      const baseRpc = rpcCall.getMockImplementation()
      rpcCall.mockImplementation(async (connection, {method, params}) => {
        switch (method) {
          case 'contract_call':
            submitted = true
            return {result: txHash}
          case 'bcn_txReceipt':
            return {result: {success: receiptSuccess}}
          case 'bcn_transaction':
            return {
              result: {
                type: 'callContract',
                hash: params[0],
                from: `0x${AUTHOR}`,
                to: `0x${V4_CONTRACT}`,
                amount: '0',
                payload:
                  otherPayload ||
                  `0x0a046c6973741256${calldata.toString('hex')}`,
                blockHash,
              },
            }
          case 'bcn_block':
            return {result: {hash: blockHash, height: 100}}
          case 'bcn_blockAt':
            return {result: {hash: blockHash, height: 100}}
          default:
            return baseRpc(connection, {method, params})
        }
      })
      dialog.showMessageBox.mockResolvedValue({response: 1})
      const list = service(child)

      await expect(
        list({priceIdna: '1', passphrase: 'vault secret'})
      ).resolves.toEqual({
        status: expectedStatus,
        offerId,
        priceIdna: '1',
        txHash,
      })
      if (!receiptSuccess) {
        dialog.showOpenDialog.mockResolvedValueOnce({
          canceled: false,
          filePaths: [sessionPath],
        })
        await expect(list({priceIdna: '1', passphrase: ''})).resolves.toEqual({
          status: 'conflict',
          offerId,
          priceIdna: '1',
          txHash,
        })
      }
      expect(
        rpcCall.mock.calls.filter(
          ([, payload]) => payload.method === 'contract_call'
        )
      ).toHaveLength(1)
    }
  )

  it('clears a canonically failed attempt so the seller can retry', async () => {
    const txHash = `0x${'1'.repeat(64)}`
    const blockHash = `0x${'2'.repeat(64)}`
    const child = childForListing()
    const baseRpc = rpcCall.getMockImplementation()
    rpcCall.mockImplementation(async (connection, {method, params}) => {
      switch (method) {
        case 'contract_call':
          return {result: txHash}
        case 'bcn_txReceipt':
          return {result: {success: false}}
        case 'bcn_transaction':
          return {
            result: {
              type: 'callContract',
              hash: params[0],
              from: `0x${AUTHOR}`,
              to: `0x${V4_CONTRACT}`,
              amount: '0',
              payload: `0x0a046c6973741256${calldata.toString('hex')}`,
              blockHash,
            },
          }
        case 'bcn_block':
          return {result: {hash: blockHash, height: 100}}
        case 'bcn_blockAt':
          return {result: {hash: blockHash, height: 100}}
        default:
          return baseRpc(connection, {method, params})
      }
    })
    dialog.showMessageBox.mockResolvedValue({response: 1})
    const list = service(child)
    await expect(
      list({priceIdna: '1', passphrase: 'vault secret'})
    ).resolves.toEqual({status: 'failed', offerId, priceIdna: '1', txHash})
    expect(
      fs.existsSync(path.join(vaultRoot, AUTHOR, `list-${offerId}.json`))
    ).toBe(false)

    dialog.showOpenDialog
      .mockResolvedValueOnce({canceled: false, filePaths: [sessionPath]})
      .mockResolvedValueOnce({canceled: false, filePaths: [vaultPath]})
      .mockResolvedValueOnce({canceled: false, filePaths: [nodeKeyPath]})
    await expect(
      list({priceIdna: '1', passphrase: 'vault secret'})
    ).resolves.toEqual({status: 'failed', offerId, priceIdna: '1', txHash})
    expect(
      rpcCall.mock.calls.filter(
        ([, payload]) => payload.method === 'contract_call'
      )
    ).toHaveLength(2)
  })

  it('rejects a different active author or changed listing before a transaction', async () => {
    const child = childForListing()
    session.author = BUYER
    fs.writeFileSync(sessionPath, JSON.stringify(session))
    await expect(
      service(child)({priceIdna: '1', passphrase: 'vault secret'})
    ).rejects.toThrow('fod_direct_list_identity_changed')
    expect(child.spawn).not.toHaveBeenCalled()
    expect(dialog.showOpenDialog).toHaveBeenCalledTimes(1)

    session.author = AUTHOR
    fs.writeFileSync(sessionPath, JSON.stringify(session))
    dialog.showOpenDialog.mockReset()
    dialog.showOpenDialog
      .mockResolvedValueOnce({canceled: false, filePaths: [sessionPath]})
      .mockResolvedValueOnce({canceled: false, filePaths: [vaultPath]})
      .mockResolvedValueOnce({canceled: false, filePaths: [nodeKeyPath]})
    const changed = childForListing({price: '2'})
    await expect(
      service(changed)({priceIdna: '1', passphrase: 'vault secret'})
    ).rejects.toThrow('fod_direct_list_failed')
    expect(rpcCall).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({method: 'contract_call'})
    )
  })
})

describe('trusted FoD direct confirmation', () => {
  let root
  let vaultRoot
  let markerPath

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'idena-fod-confirm-test-'))
    )
    vaultRoot = path.join(root, 'vaults')
    const receiptDir = path.join(vaultRoot, BUYER, 'fod-receive-ABC123')
    fs.mkdirSync(receiptDir, {recursive: true, mode: 0o700})
    fs.writeFileSync(
      path.join(receiptDir, 'receipt.json'),
      receiptText(CONFIRM_ORDER_ID, AUTHOR, V4_CONTRACT),
      {mode: 0o600}
    )
    markerPath = path.join(
      vaultRoot,
      BUYER,
      `confirm-${V4_CONTRACT}-${CONFIRM_ORDER_ID}.json`
    )
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  const request = {contract: `0x${V4_CONTRACT}`, orderId: CONFIRM_ORDER_ID}

  function marketText(state) {
    return JSON.stringify({
      format: 'fod.direct-market-state',
      version: 3,
      network: 'idena',
      source: 'node',
      contract: V4_CONTRACT,
      codeHash: V4_CODE_HASH.slice(2),
      orders: [{orderId: CONFIRM_ORDER_ID, buyer: BUYER, state}],
    })
  }

  function preparedText() {
    const orderBytes = Buffer.alloc(8)
    orderBytes.writeBigUInt64BE(BigInt(CONFIRM_ORDER_ID))
    const ciphertextSha256 = createHash('sha256')
      .update(Buffer.from(CIPHERTEXT, 'hex'))
      .digest('hex')
    return JSON.stringify({
      format: 'fod.prepared-direct-confirm',
      version: 1,
      operation: 'confirm',
      network: 'idena',
      contract: V4_CONTRACT,
      buyer: BUYER,
      amount: '0',
      calldata: `${orderBytes.toString('hex')}${ciphertextSha256}`,
      ciphertextSha256,
      directOrderId: Number(CONFIRM_ORDER_ID),
    })
  }

  function service({spawn, rpcCall}) {
    return createFodDirectConfirmService({
      getNodeRpcConnection: () => ({url: 'http://127.0.0.1:9009', key: ''}),
      getActiveCoinbase: async () => `0x${BUYER}`,
      rpcCall,
      spawn,
      fs,
      binaryPath: process.execPath,
      expectedBinaryHash: TEST_BINARY_HASH,
      vaultRoot,
    })
  }

  it('does not prepare or broadcast a previously settled order', async () => {
    const child = fakeSpawn({result: marketText('settled')})
    const rpcCall = jest.fn()

    await expect(
      service({spawn: child.spawn, rpcCall})(request)
    ).resolves.toEqual({orderId: CONFIRM_ORDER_ID, status: 'settled'})
    expect(child.calls.map(({args}) => args[0])).toEqual(['direct-market'])
    expect(rpcCall).not.toHaveBeenCalled()
    expect(fs.existsSync(markerPath)).toBe(false)
  })

  it('persists a no-retry marker before an unknown broadcast response', async () => {
    const child = fakeSpawn({
      result: (args) =>
        args[0] === 'direct-market' ? marketText('funded') : preparedText(),
    })
    const rpcCall = jest.fn(async (connection, {method}) => {
      expect(connection.url).toBe('http://127.0.0.1:9009')
      switch (method) {
        case 'bcn_syncing':
          return {
            result: {
              syncing: false,
              wrongTime: false,
              currentBlock: 7,
              highestBlock: 7,
            },
          }
        case 'dna_getCoinbaseAddr':
          return {result: `0x${BUYER}`}
        case 'dna_getBalance':
          return {result: {balance: '3', nonce: 1, mempoolNonce: 1}}
        case 'contract_getStake':
          return {result: {Hash: V4_CODE_HASH}}
        case 'bcn_feePerGas':
          return {result: '1'}
        case 'contract_estimateCall':
          return {result: {success: true, gasCost: '0.1', txFee: '0.1'}}
        case 'bcn_pendingTransactions':
          return {result: {transactions: []}}
        case 'contract_call':
          expect(JSON.parse(fs.readFileSync(markerPath, 'utf8'))).toMatchObject({
            format: 'fod.direct-confirm-attempt',
            contract: request.contract,
            orderId: CONFIRM_ORDER_ID,
            txHash: null,
          })
          return {result: 'unknown'}
        default:
          throw new Error(`unexpected RPC method: ${method}`)
      }
    })
    const confirm = service({spawn: child.spawn, rpcCall})

    await expect(confirm(request)).resolves.toEqual({
      orderId: CONFIRM_ORDER_ID,
      status: 'uncertain',
    })
    expect(fs.statSync(markerPath).mode & 0o777).toBe(0o600)
    await expect(confirm(request)).resolves.toEqual({
      orderId: CONFIRM_ORDER_ID,
      status: 'uncertain',
    })
    expect(rpcCall.mock.calls.filter(([, call]) => call.method === 'contract_call'))
      .toHaveLength(1)
    expect(child.calls.map(({args}) => args[0])).toEqual([
      'direct-market',
      'direct-confirm',
      'direct-market',
    ])
  })

  it('recovers only the exact pending confirmation after a lost response', async () => {
    const child = fakeSpawn({
      result: (args) =>
        args[0] === 'direct-market' ? marketText('funded') : preparedText(),
    })
    const orderBytes = Buffer.alloc(8)
    orderBytes.writeBigUInt64BE(BigInt(CONFIRM_ORDER_ID))
    const digest = createHash('sha256')
      .update(Buffer.from(CIPHERTEXT, 'hex'))
      .digest('hex')
    const payload = `0x0a07636f6e6669726d1228${orderBytes.toString('hex')}${digest}`
    const hash = `0x${'a'.repeat(64)}`
    const pending = {
      hash,
      type: 'callContract',
      from: `0x${BUYER}`,
      to: request.contract,
      amount: '0',
      payload,
    }
    const rpcCall = jest.fn(async (connection, {method, params}) => {
      expect(connection.url).toBe('http://127.0.0.1:9009')
      switch (method) {
        case 'bcn_syncing':
          return {
            result: {
              syncing: false,
              wrongTime: false,
              currentBlock: 7,
              highestBlock: 7,
            },
          }
        case 'dna_getCoinbaseAddr':
          return {result: `0x${BUYER}`}
        case 'dna_getBalance':
          return {result: {balance: '3', nonce: 1, mempoolNonce: 1}}
        case 'contract_getStake':
          return {result: {Hash: V4_CODE_HASH}}
        case 'bcn_feePerGas':
          return {result: '1'}
        case 'contract_estimateCall':
          return {result: {success: true, gasCost: '0.1', txFee: '0.1'}}
        case 'contract_call':
          return {result: 'unknown'}
        case 'bcn_pendingTransactions':
          expect(params).toEqual([{address: `0x${BUYER}`, count: 100}])
          return {result: {transactions: [{...pending, payload: `0x${'0'.repeat(102)}`}, pending]}}
        case 'bcn_txReceipt':
          expect(params).toEqual([hash])
          return {result: null}
        default:
          throw new Error(`unexpected RPC method: ${method}`)
      }
    })
    const confirm = service({spawn: child.spawn, rpcCall})

    await expect(confirm(request)).resolves.toEqual({
      orderId: CONFIRM_ORDER_ID,
      status: 'pending',
    })
    expect(JSON.parse(fs.readFileSync(markerPath, 'utf8')).txHash).toBe(hash)
    await expect(confirm(request)).resolves.toEqual({
      orderId: CONFIRM_ORDER_ID,
      status: 'pending',
    })
    expect(rpcCall.mock.calls.filter(([, call]) => call.method === 'contract_call'))
      .toHaveLength(1)
  })
})

describe('trusted FoD direct receive', () => {
  let root
  let vaultRoot
  let purchasePath
  let keyPath
  let dialog

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'idena-fod-receive-test-'))
    )
    vaultRoot = path.join(root, 'vaults')
    purchasePath = path.join(root, 'purchase.json')
    keyPath = path.join(root, 'delivery.key')
    fs.writeFileSync(purchasePath, '{"retained":"secret"}', {mode: 0o600})
    fs.writeFileSync(keyPath, '1'.repeat(64), {mode: 0o600})
    dialog = {
      showOpenDialog: jest
        .fn()
        .mockResolvedValueOnce({canceled: false, filePaths: [purchasePath]})
        .mockResolvedValueOnce({canceled: false, filePaths: [keyPath]}),
    }
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  function service({
    spawn = fakeSpawn({result: receiptText()}).spawn,
    rpc = () => ({url: 'http://127.0.0.1:9009', key: 'RPC_SECRET'}),
    coinbase = async () => `0x${BUYER}`,
    selectedDialog = dialog,
    selectedVaultRoot = vaultRoot,
  } = {}) {
    return createFodDirectReceiveService({
      dialog: selectedDialog,
      getNodeRpcConnection: rpc,
      getActiveCoinbase: coinbase,
      spawn,
      fs,
      binaryPath: process.execPath,
      expectedBinaryHash: TEST_BINARY_HASH,
      vaultRoot: selectedVaultRoot,
    })
  }

  const passphrase = 'correct horse battery staple'

  it('saves owner-only outputs in a unique private directory with safe child args', async () => {
    const child = fakeSpawn({result: receiptText()})
    const receive = service({spawn: child.spawn})
    const summary = await receive({message: messageText(), passphrase})
    const [{args, options, body}] = child.calls
    const purchaseCopy = args[args.indexOf('-purchase') + 1]
    const keyCopy = args[args.indexOf('-delivery-key') + 1]
    const rpcKeyFile = args[args.indexOf('-key-file') + 1]
    const vaultPath = args[args.indexOf('-vault') + 1]
    const receiptPath = args[args.indexOf('-out') + 1]

    expect(args).toEqual([
      'direct-receive',
      '-network',
      'idena',
      '-contract',
      `0x${CONTRACT}`,
      '-code-hash',
      CODE_HASH,
      '-order',
      ORDER_ID,
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
      'http://127.0.0.1:9009',
      '-key-file',
      rpcKeyFile,
    ])
    expect(options).toEqual(
      expect.objectContaining({
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: expect.objectContaining({FOD_PASSPHRASE: passphrase}),
      })
    )
    expect(args).not.toContain('-auto-confirm')
    expect(args).not.toContain('-broadcast')
    expect(args).not.toContain('-nodekey')
    expect(args.join(' ')).not.toContain(passphrase)
    expect(args.join(' ')).not.toContain('RPC_SECRET')
    expect(Buffer.concat(body).toString('utf8')).toBe(messageText())
    expect(path.dirname(vaultPath)).toBe(path.dirname(receiptPath))
    expect(path.dirname(path.dirname(vaultPath))).toBe(
      path.join(vaultRoot, BUYER)
    )
    expect(purchaseCopy).not.toBe(purchasePath)
    expect(keyCopy).not.toBe(keyPath)
    expect(fs.existsSync(path.dirname(purchaseCopy))).toBe(false)
    for (const dir of [
      vaultRoot,
      path.join(vaultRoot, BUYER),
      path.dirname(vaultPath),
    ]) {
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700)
    }
    for (const file of [vaultPath, receiptPath]) {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    }
    expect(summary).toEqual({
      contract: `0x${CONTRACT}`,
      orderId: ORDER_ID,
      buyer: `0x${BUYER}`,
      author: `0x${AUTHOR}`,
      epoch: 230,
      usableFlips: 3,
      vaultPath,
      receiptPath,
    })
    expect(JSON.stringify(summary)).not.toContain('RPC_SECRET')
    expect(JSON.stringify(summary)).not.toContain(CIPHERTEXT)
    expect(JSON.stringify(summary)).not.toContain(passphrase)
  })

  it('saves v4 only after the pinned CLI verifies the receipt', async () => {
    const child = fakeSpawn({
      result: receiptText(ORDER_ID, AUTHOR, V4_CONTRACT),
    })
    const summary = await service({spawn: child.spawn})({
      message: messageText(ORDER_ID, V4_CONTRACT),
      passphrase,
    })
    const {args} = child.calls[0]
    expect(args.slice(0, 3)).toEqual(['direct-receive', '-direct-version', '4'])
    expect(args[args.indexOf('-code-hash') + 1]).toBe(V4_CODE_HASH)
    expect(summary.contract).toBe(`0x${V4_CONTRACT}`)
    expect(fs.existsSync(summary.receiptPath)).toBe(true)
  })

  it('accepts the indented signed receipt written by the Go client', async () => {
    const prettyReceipt = receiptText()
      .replace(/:/g, ': ')
      .replace(/,/g, ',\n  ')
      .replace('{', '{\n  ')
      .replace('}', '\n}')
    const receive = service({spawn: fakeSpawn({result: prettyReceipt}).spawn})

    await expect(
      receive({message: messageText(), passphrase})
    ).resolves.toMatchObject({orderId: ORDER_ID, usableFlips: 3})
  })

  it('rejects weak passphrases and extra payload fields before file selection', async () => {
    const child = fakeSpawn({result: receiptText()})
    const receive = service({spawn: child.spawn})
    for (const bad of [
      '',
      'short',
      ' '.repeat(12),
      'a'.repeat(513),
      `long-enough\0bad`,
    ]) {
      await expect(
        receive({message: messageText(), passphrase: bad})
      ).rejects.toThrow('fod_direct_receive_invalid_passphrase')
    }
    await expect(
      receive({message: messageText(), passphrase, broadcast: true})
    ).rejects.toThrow('fod_direct_receive_invalid_message')
    await expect(receive({message: messageText()})).rejects.toThrow(
      'fod_direct_receive_invalid_message'
    )
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(child.spawn).not.toHaveBeenCalled()
  })

  it('refuses the wrong buyer and removes saved outputs after identity changes', async () => {
    const child = fakeSpawn({result: receiptText()})
    await expect(
      service({
        spawn: child.spawn,
        coinbase: async () => `0x${'f'.repeat(40)}`,
      })({message: messageText(), passphrase})
    ).rejects.toThrow('fod_direct_receive_buyer_mismatch')
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(child.spawn).not.toHaveBeenCalled()

    let reads = 0
    const changed = service({
      spawn: child.spawn,
      rpc: () => ({
        url:
          ++reads > 4 ? 'https://other.example/rpc' : 'http://127.0.0.1:9009',
        key: 'RPC_SECRET',
      }),
    })
    await expect(changed({message: messageText(), passphrase})).rejects.toThrow(
      'fod_direct_receive_identity_changed'
    )
    expect(child.spawn).toHaveBeenCalledTimes(1)
    expect(fs.readdirSync(path.join(vaultRoot, BUYER))).toEqual([])
  })

  it('removes only the new output after child or receipt failure', async () => {
    fs.mkdirSync(vaultRoot, {mode: 0o700})
    fs.mkdirSync(path.join(vaultRoot, BUYER), {mode: 0o700})
    const retained = path.join(vaultRoot, BUYER, 'existing-vault.age')
    fs.writeFileSync(retained, 'keep', {mode: 0o600})
    const child = fakeSpawn({result: receiptText(), exitCode: 1})
    await expect(
      service({spawn: child.spawn})({message: messageText(), passphrase})
    ).rejects.toThrow('fod_direct_receive_failed')
    expect(fs.readdirSync(path.join(vaultRoot, BUYER))).toEqual([
      'existing-vault.age',
    ])
    expect(fs.readFileSync(retained, 'utf8')).toBe('keep')

    dialog.showOpenDialog
      .mockResolvedValueOnce({canceled: false, filePaths: [purchasePath]})
      .mockResolvedValueOnce({canceled: false, filePaths: [keyPath]})
    const malformed = fakeSpawn({
      result: receiptText().replace(/}$/, ',"privateKey":"secret"}'),
    })
    await expect(
      service({spawn: malformed.spawn})({message: messageText(), passphrase})
    ).rejects.toThrow('fod_direct_receive_failed')
    expect(fs.readdirSync(path.join(vaultRoot, BUYER))).toEqual([
      'existing-vault.age',
    ])
  })

  it('rejects unsafe vault roots, selected files, and output permissions', async () => {
    const child = fakeSpawn({result: receiptText()})
    fs.mkdirSync(vaultRoot, {mode: 0o755})
    await expect(
      service({spawn: child.spawn})({message: messageText(), passphrase})
    ).rejects.toThrow('fod_direct_receive_unavailable')
    fs.rmSync(vaultRoot, {recursive: true})
    fs.mkdirSync(path.join(root, 'target'), {mode: 0o700})
    fs.symlinkSync(path.join(root, 'target'), vaultRoot)
    await expect(
      service({spawn: child.spawn})({message: messageText(), passphrase})
    ).rejects.toThrow('fod_direct_receive_unavailable')
    fs.rmSync(vaultRoot)
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()

    fs.chmodSync(keyPath, 0o644)
    await expect(
      service({spawn: child.spawn})({message: messageText(), passphrase})
    ).rejects.toThrow('fod_direct_receive_invalid_file')
    expect(child.spawn).not.toHaveBeenCalled()

    fs.chmodSync(keyPath, 0o600)
    dialog.showOpenDialog
      .mockResolvedValueOnce({canceled: false, filePaths: [purchasePath]})
      .mockResolvedValueOnce({canceled: false, filePaths: [keyPath]})
    const publicReceipt = fakeSpawn({
      result: receiptText(),
      resultMode: 0o644,
    })
    await expect(
      service({spawn: publicReceipt.spawn})({
        message: messageText(),
        passphrase,
      })
    ).rejects.toThrow('fod_direct_receive_failed')
    expect(fs.readdirSync(path.join(vaultRoot, BUYER))).toEqual([])
  })
})

describe('trusted FoD direct buy preparation', () => {
  let root
  let vaultRoot
  let sessionPath
  let session
  let dialog

  const offerId = 'd'.repeat(64)
  const inventoryCommitment = 'e'.repeat(64)
  const keyCommitment = 'f'.repeat(64)
  const curve = createECDH('secp256k1')
  curve.setPrivateKey(Buffer.from('1'.repeat(64), 'hex'))
  const deliveryPublicKey = curve.getPublicKey('hex', 'uncompressed')

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'idena-fod-buy-test-'))
    )
    vaultRoot = path.join(root, 'vaults')
    sessionPath = path.join(root, 'public-session.json')
    session = {
      format: 'fod.session-bundle',
      version: 1,
      author: AUTHOR,
      epoch: 230,
      manifest: ['cid-one'],
      inventory: {},
      verdict: {},
    }
    fs.writeFileSync(sessionPath, JSON.stringify(session), {mode: 0o644})
    fs.chmodSync(sessionPath, 0o644)
    dialog = {
      showOpenDialog: jest.fn().mockResolvedValue({
        canceled: false,
        filePaths: [sessionPath],
      }),
    }
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  function preparedBuy() {
    return {
      format: 'fod.prepared-direct-buy',
      version: 1,
      operation: 'buy',
      network: 'idena',
      contract: V4_CONTRACT,
      amount: '7000000000000000000',
      calldata: offerId + deliveryPublicKey,
      preparedAt: '2026-10-12T12:00:00Z',
      submitted: false,
      price: '2000000000000000000',
      availability: {
        author: AUTHOR,
        epoch: 230,
        binding: 'committed-inventory',
        coveredFlips: 1,
        verifiedFlips: 1,
        inventoryCommitment,
        blobs: [{cid: 'cid-one', hex: 'ab'}],
      },
      orderNonce: 1,
      buyer: BUYER,
      deliveryKey: deliveryPublicKey,
      author: AUTHOR,
      epoch: 230,
      coveredFlips: 1,
      keyCommitment,
      inventoryCommitment,
      directOfferId: offerId,
      directSession: session,
    }
  }

  function service({
    spawn = fakeSpawn({result: JSON.stringify(preparedBuy())}).spawn,
    rpc = () => ({url: 'http://127.0.0.1:9009', key: 'RPC_SECRET'}),
    selectedDialog = dialog,
  } = {}) {
    return createFodDirectBuyPrepareService({
      dialog: selectedDialog,
      getNodeRpcConnection: rpc,
      getActiveCoinbase: async () => `0x${BUYER}`,
      spawn,
      fs,
      binaryPath: process.execPath,
      expectedBinaryHash: TEST_BINARY_HASH,
      vaultRoot,
    })
  }

  function commitService({
    spawn,
    rpcCall,
    selectedDialog = {showMessageBox: jest.fn().mockResolvedValue({response: 1})},
    coinbase = async () => `0x${BUYER}`,
  }) {
    return createFodDirectBuyCommitService({
      dialog: selectedDialog,
      getNodeRpcConnection: () => ({
        url: 'http://127.0.0.1:9009',
        key: 'RPC_SECRET',
      }),
      getActiveCoinbase: coinbase,
      rpcCall,
      spawn,
      fs,
      binaryPath: process.execPath,
      expectedBinaryHash: TEST_BINARY_HASH,
      vaultRoot,
    })
  }

  function nodeRpc({
    submit = () => { throw new Error('unexpected broadcast') },
    feePerGas = '1',
    estimate = {success: true, gasUsed: 100000},
    transaction = (hash) => ({
      type: 'callContract',
      hash,
      from: `0x${BUYER}`,
      to: `0x${V4_CONTRACT}`,
      amount: '7',
      payload: `0x0a036275791261${preparedBuy().calldata}`,
      blockHash: `0x${'b'.repeat(64)}`,
    }),
  } = {}) {
    return jest.fn(async (connection, {method, params}) => {
      expect(connection).toEqual({
        url: 'http://127.0.0.1:9009',
        key: 'RPC_SECRET',
      })
      switch (method) {
        case 'bcn_syncing':
          return {
            result: {
              syncing: false,
              wrongTime: false,
              currentBlock: 7,
              highestBlock: 7,
            },
          }
        case 'dna_getCoinbaseAddr':
          return {result: `0x${BUYER}`}
        case 'dna_getBalance':
          expect(params).toEqual([`0x${BUYER}`])
          return {result: {balance: '8', nonce: 1, mempoolNonce: 1}}
        case 'contract_getStake':
          expect(params).toEqual([`0x${V4_CONTRACT}`])
          return {result: {Hash: V4_CODE_HASH}}
        case 'bcn_feePerGas':
          return {result: feePerGas}
        case 'contract_estimateCall':
          return {result: estimate}
        case 'contract_call':
          return submit(params)
        case 'bcn_txReceipt':
          return {result: {success: true}}
        case 'bcn_transaction':
          return {result: transaction(params[0])}
        case 'bcn_block':
          return {result: {hash: params[0], height: 7}}
        case 'bcn_blockAt':
          expect(params).toEqual([7])
          return {result: {hash: `0x${'b'.repeat(64)}`, height: 7}}
        default:
          throw new Error(`unexpected RPC method: ${method}`)
      }
    })
  }

  function fundedMarket(orderId = CONFIRM_ORDER_ID) {
    return JSON.stringify({
      format: 'fod.direct-market-state',
      version: 3,
      network: 'idena',
      source: 'node',
      contract: V4_CONTRACT,
      codeHash: V4_CODE_HASH.slice(2),
      offers: [{offerId, openOrderId: orderId}],
      orders: [{
        orderId,
        offerId,
        buyer: BUYER,
        paid: '2000000000000000000',
        bond: '5000000000000000000',
        fundedAtBlock: '7',
        state: 'funded',
      }],
    })
  }

  function settledMarket(orders = []) {
    const market = JSON.parse(fundedMarket())
    market.offers[0].openOrderId = '0'
    market.orders = [{...market.orders[0], state: 'settled'}, ...orders]
    return JSON.stringify(market)
  }

  it('saves one private buyer bundle and returns only display amounts', async () => {
    const child = fakeSpawn({result: JSON.stringify(preparedBuy())})
    const summary = await service({spawn: child.spawn})({})
    const [{binary, args, options, body}] = child.calls
    const stagedSession = args[args.indexOf('-session') + 1]
    const keyPath = args[args.indexOf('-delivery-key') + 1]
    const preparedPath = args[args.indexOf('-prepared') + 1]
    const rpcKeyFile = args[args.indexOf('-key-file') + 1]

    expect(binary).not.toBe(process.execPath)
    expect(options).toEqual(
      expect.objectContaining({shell: false, stdio: ['pipe', 'pipe', 'pipe']})
    )
    expect(args).toEqual([
      'direct-buy',
      '-buyer',
      `0x${BUYER}`,
      '-session',
      stagedSession,
      '-delivery-key',
      keyPath,
      '-prepared',
      preparedPath,
      '-network',
      'idena',
      '-direct-version',
      '4',
      '-contract',
      `0x${V4_CONTRACT}`,
      '-code-hash',
      V4_CODE_HASH,
      '-rpc',
      'http://127.0.0.1:9009',
      '-key-file',
      rpcKeyFile,
    ])
    expect(args).not.toContain('-nodekey')
    expect(args).not.toContain('-broadcast')
    expect(args).not.toContain('-signed')
    expect(args.join(' ')).not.toContain('RPC_SECRET')
    expect(Buffer.concat(body).length).toBe(0)
    expect(stagedSession).not.toBe(sessionPath)
    expect(fs.existsSync(path.dirname(stagedSession))).toBe(false)
    expect(summary).toEqual({
      purchaseId: expect.stringMatching(/^fod-buy-[0-9a-f]{32}$/),
      priceIdna: '2',
      bondIdna: '5',
      totalIdna: '7',
      author: `0x${AUTHOR}`,
      epoch: 230,
      usableFlips: 1,
    })
    expect(JSON.stringify(summary)).not.toContain(root)
    expect(JSON.stringify(summary)).not.toContain(deliveryPublicKey)

    const buyerRoot = path.join(vaultRoot, BUYER)
    const [name] = fs.readdirSync(buyerRoot)
    expect(name).toBe(summary.purchaseId)
    const saved = path.join(buyerRoot, name)
    for (const directory of [vaultRoot, buyerRoot, saved]) {
      expect(fs.statSync(directory).mode & 0o777).toBe(0o700)
    }
    for (const file of ['delivery.key', 'purchase.json', 'session.json']) {
      expect(fs.statSync(path.join(saved, file)).mode & 0o777).toBe(0o600)
    }
    expect(fs.readFileSync(path.join(saved, 'session.json'), 'utf8')).toBe(
      JSON.stringify(session)
    )
    expect(fs.readFileSync(path.join(saved, 'purchase.json'), 'utf8')).toBe(
      JSON.stringify(preparedBuy())
    )
  })

  it('recovers public fallback keys only for the matching saved buyer purchase', async () => {
    const {purchaseId} = await service()({})
    const orderId = CONFIRM_ORDER_ID
    const passphrase = 'local vault secret'
    const market = {
      format: 'fod.direct-market-state', version: 3, network: 'idena',
      source: 'node', contract: V4_CONTRACT, codeHash: V4_CODE_HASH.slice(2),
      offers: [{offerId}],
      orders: [{
        orderId, offerId, buyer: BUYER, paid: preparedBuy().price,
        bond: '5000000000000000000', state: 'settled', keysPublic: true,
      }],
    }
    const record = {
      format: 'fod.recovered-direct-delivery', version: 1,
      network: 'idena', contract: V4_CONTRACT,
      codeHash: V4_CODE_HASH.slice(2), offerId,
      orderId: Number(orderId), orderNonce: 1, buyer: BUYER,
      deliveryKey: deliveryPublicKey, author: AUTHOR, epoch: 230,
      inventoryCommitment, keyCommitment, keySource: 'public-reveal',
      usableFlips: 1,
    }
    const child = fakeSpawn({
      result: (args) => JSON.stringify(
        args[0] === 'direct-market' ? market : record
      ),
    })
    const recover = createFodDirectRecoverService({
      getNodeRpcConnection: () => ({url: 'http://127.0.0.1:9009', key: 'RPC_SECRET'}),
      getActiveCoinbase: async () => `0x${BUYER}`,
      spawn: child.spawn, fs, binaryPath: process.execPath,
      expectedBinaryHash: TEST_BINARY_HASH, vaultRoot,
    })

    await expect(recover({purchaseId, orderId, passphrase})).resolves.toEqual({
      purchaseId, orderId, status: 'recovered', usableFlips: 1,
    })
    const recovery = child.calls.find(({args}) => args[0] === 'direct-recover')
    expect(recovery).toBeTruthy()
    expect(recovery.args).not.toContain('-broadcast')
    expect(recovery.args.join(' ')).not.toContain(passphrase)
    expect(recovery.args.join(' ')).not.toContain('RPC_SECRET')
    expect(recovery.options.env).toEqual({FOD_PASSPHRASE: passphrase})
    const saved = path.join(vaultRoot, BUYER, purchaseId)
    for (const name of [`recovered-${orderId}.age`, `recovered-${orderId}.json`]) {
      expect(fs.statSync(path.join(saved, name)).mode & 0o777).toBe(0o600)
    }
    market.orders[0].buyer = AUTHOR
    const mismatch = fakeSpawn({result: JSON.stringify(market)})
    const wrongOrder = createFodDirectRecoverService({
      getNodeRpcConnection: () => ({url: 'http://127.0.0.1:9009', key: ''}),
      getActiveCoinbase: async () => `0x${BUYER}`,
      spawn: mismatch.spawn, fs, binaryPath: process.execPath,
      expectedBinaryHash: TEST_BINARY_HASH, vaultRoot,
    })
    await expect(wrongOrder({purchaseId, orderId, passphrase})).rejects.toThrow(
      'fod_direct_recover_order_mismatch'
    )
    expect(mismatch.calls.map(({args}) => args[0])).toEqual(['direct-market'])
  })

  it('retains an explicit v4 selection and its prepared version', async () => {
    const prepared = {...preparedBuy(), directVersion: 4}
    const child = fakeSpawn({result: JSON.stringify(prepared)})
    const {purchaseId} = await service({spawn: child.spawn})({directVersion: 4})
    const args = child.calls[0].args
    expect(args.slice(args.indexOf('-direct-version'), args.indexOf('-rpc'))).toEqual([
      '-direct-version', '4', '-contract', `0x${V4_CONTRACT}`,
      '-code-hash', V4_CODE_HASH,
    ])
    const retained = JSON.parse(fs.readFileSync(
      path.join(vaultRoot, BUYER, purchaseId, 'purchase.json'), 'utf8'
    ))
    expect(retained.directVersion).toBe(4)
    expect(retained.contract).toBe(V4_CONTRACT)

    const fresh = fakeSpawn({result: JSON.stringify(preparedBuy())})
    const rpcCall = jest.fn()
    const selectedDialog = {showMessageBox: jest.fn()}
    await expect(commitService({
      spawn: fresh.spawn, rpcCall, selectedDialog,
    })({purchaseId})).rejects.toThrow('fod_direct_buy_changed')
    expect(selectedDialog.showMessageBox).not.toHaveBeenCalled()
    expect(rpcCall).not.toHaveBeenCalled()
  })

  it('binds a selected market offer to the verified purchase before saving it', async () => {
    const child = fakeSpawn({result: JSON.stringify(preparedBuy())})
    await expect(service({spawn: child.spawn})({
      directVersion: 4,
      offerId: 'a'.repeat(64),
    })).rejects.toThrow('fod_direct_buy_offer_changed')
    expect(fs.readdirSync(path.join(vaultRoot, BUYER))).toEqual([])

    const result = await service({spawn: child.spawn})({
      directVersion: 4,
      offerId,
    })
    expect(result.purchaseId).toMatch(/^fod-buy-[0-9a-f]{32}$/)
    expect(fs.readdirSync(path.join(vaultRoot, BUYER))).toEqual([result.purchaseId])
  })

  it('finds a saved purchase only for the active identity after restart', async () => {
    const first = await service()({})
    const firstDir = path.join(vaultRoot, BUYER, first.purchaseId)
    fs.utimesSync(firstDir, new Date(1000000), new Date(1000000))
    const second = await service()({})
    const resume = createFodDirectBuyResumeService({
      getNodeRpcConnection: () => ({url: 'http://127.0.0.1:9009', key: ''}),
      getActiveCoinbase: async () => `0x${BUYER}`,
      fs,
      vaultRoot,
    })
    await expect(resume({})).resolves.toEqual({
      purchaseId: second.purchaseId,
      purchaseIds: [second.purchaseId, first.purchaseId],
    })
    await expect(resume({purchaseId: first.purchaseId})).rejects.toThrow(
      'fod_direct_buy_invalid_request'
    )
    const other = createFodDirectBuyResumeService({
      getNodeRpcConnection: () => ({url: 'http://127.0.0.1:9009', key: ''}),
      getActiveCoinbase: async () => `0x${AUTHOR}`,
      fs,
      vaultRoot,
    })
    await expect(other({})).resolves.toEqual({purchaseId: null, purchaseIds: []})
  })

  it('refuses changed identity and unsafe prepared output without saving files', async () => {
    const child = fakeSpawn({result: JSON.stringify(preparedBuy())})
    let reads = 0
    const changed = service({
      spawn: child.spawn,
      rpc: () => ({
        url: ++reads > 4 ? 'https://other.example/rpc' : 'http://127.0.0.1:9009',
        key: 'RPC_SECRET',
      }),
    })
    await expect(changed({})).rejects.toThrow('fod_direct_buy_identity_changed')
    expect(child.spawn).toHaveBeenCalledTimes(1)
    expect(fs.readdirSync(path.join(vaultRoot, BUYER))).toEqual([])

    const bad = fakeSpawn({
      result: JSON.stringify({...preparedBuy(), privateKey: 'secret'}),
    })
    await expect(service({spawn: bad.spawn})({})).rejects.toThrow(
      'fod_direct_buy_failed'
    )
    expect(fs.readdirSync(path.join(vaultRoot, BUYER))).toEqual([])

    const publicOutput = fakeSpawn({
      result: JSON.stringify(preparedBuy()),
      resultMode: 0o644,
    })
    await expect(service({spawn: publicOutput.spawn})({})).rejects.toThrow(
      'fod_direct_buy_failed'
    )
    expect(fs.readdirSync(path.join(vaultRoot, BUYER))).toEqual([])
  })

  it('rejects duplicate prepared fields at the top level and in nested evidence', async () => {
    const valid = JSON.stringify(preparedBuy())
    const variants = [
      valid.replace(
        '"amount":"7000000000000000000"',
        '"amount":"7000000000000000000","amount":"1"'
      ),
      valid.replace(
        `"availability":{"author":"${AUTHOR}"`,
        `"availability":{"author":"${AUTHOR}","author":"${AUTHOR}"`
      ),
      valid.replace(
        '"directSession":{"format":"fod.session-bundle"',
        '"directSession":{"format":"fod.session-bundle","format":"fod.session-bundle"'
      ),
    ]
    for (const result of variants) {
      expect(result).not.toBe(valid)
      const child = fakeSpawn({result})
      await expect(service({spawn: child.spawn})({})).rejects.toThrow(
        'fod_direct_buy_failed'
      )
      expect(fs.readdirSync(path.join(vaultRoot, BUYER))).toEqual([])
    }
  })

  it('rejects request fields before file selection', async () => {
    const child = fakeSpawn({result: JSON.stringify(preparedBuy())})
    await expect(service({spawn: child.spawn})({amount: '1'})).rejects.toThrow(
      'fod_direct_buy_invalid_request'
    )
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(child.spawn).not.toHaveBeenCalled()
  })

  it('keeps v5 unavailable before identity, file, or CLI access', async () => {
    const child = fakeSpawn({result: JSON.stringify(preparedBuy())})
    const rpc = jest.fn()
    await expect(service({spawn: child.spawn, rpc})({directVersion: 5}))
      .rejects.toThrow('fod_direct_buy_unavailable')
    expect(rpc).not.toHaveBeenCalled()
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(child.spawn).not.toHaveBeenCalled()
    expect(fs.existsSync(vaultRoot)).toBe(false)
  })

  it('rejects prepared version and contract mismatches without retaining a buy', async () => {
    for (const prepared of [
      {...preparedBuy(), directVersion: 5},
      {...preparedBuy(), contract: 'f'.repeat(40)},
    ]) {
      const child = fakeSpawn({result: JSON.stringify(prepared)})
      await expect(service({spawn: child.spawn})({})).rejects.toThrow(
        'fod_direct_buy_failed'
      )
      expect(fs.readdirSync(path.join(vaultRoot, BUYER))).toEqual([])
    }
  })

  it('rejects a retained purchase switched to an unpinned version', async () => {
    const {purchaseId} = await service()({})
    const savedPath = path.join(vaultRoot, BUYER, purchaseId, 'purchase.json')
    const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'))
    fs.writeFileSync(savedPath, JSON.stringify({...saved, directVersion: 5}))
    const child = fakeSpawn({result: JSON.stringify(preparedBuy())})
    const rpcCall = jest.fn()
    await expect(commitService({spawn: child.spawn, rpcCall})({purchaseId}))
      .rejects.toThrow('fod_direct_buy_unavailable')
    expect(child.spawn).not.toHaveBeenCalled()
    expect(rpcCall).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(vaultRoot, BUYER, purchaseId, 'buy-attempt.json')))
      .toBe(false)
  })

  it('commits only a saved purchase and honors native cancellation without broadcasting', async () => {
    const {purchaseId} = await service()({})
    const child = fakeSpawn({result: JSON.stringify(preparedBuy())})
    const rpcCall = nodeRpc()
    const selectedDialog = {
      showMessageBox: jest.fn().mockResolvedValue({response: 0}),
    }
    const commit = commitService({spawn: child.spawn, rpcCall, selectedDialog})

    await expect(commit({purchaseId, amount: '1'})).rejects.toThrow(
      'fod_direct_buy_invalid_request'
    )
    await expect(commit({purchaseId: `fod-buy-${'0'.repeat(32)}`}))
      .rejects.toThrow('fod_direct_buy_failed')
    expect(child.spawn).not.toHaveBeenCalled()
    expect(selectedDialog.showMessageBox).not.toHaveBeenCalled()

    await expect(commit({purchaseId})).resolves.toEqual({
      purchaseId,
      status: 'cancelled',
    })
    expect(selectedDialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: ['Cancel', 'Lock funds'],
        defaultId: 0,
        cancelId: 0,
      })
    )
    expect(child.calls.map(({args}) => args[0])).toEqual(['direct-buy'])
    expect(rpcCall.mock.calls.some(([, call]) => call.method === 'contract_call'))
      .toBe(false)
    expect(fs.existsSync(path.join(vaultRoot, BUYER, purchaseId, 'buy-attempt.json')))
      .toBe(false)
  })

  it('writes an owner-only attempt before the exact node-signed buy and finds its funded order', async () => {
    const {purchaseId} = await service()({})
    const markerPath = path.join(vaultRoot, BUYER, purchaseId, 'buy-attempt.json')
    const hash = `0x${'a'.repeat(64)}`
    const child = fakeSpawn({
      result: (args) =>
        args[0] === 'direct-market'
          ? fundedMarket()
          : JSON.stringify(preparedBuy()),
    })
    const rpcCall = nodeRpc({
      submit: (params) => {
        expect(params).toEqual([{
          from: `0x${BUYER}`,
          contract: `0x${V4_CONTRACT}`,
          method: 'buy',
          amount: '7',
          maxFee: '0.00000000000512',
          args: [{
            index: 0,
            format: 'hex',
            value: `0x${offerId}${deliveryPublicKey}`,
          }],
        }])
        expect(fs.statSync(markerPath).mode & 0o777).toBe(0o600)
        expect(fs.statSync(path.dirname(markerPath)).mode & 0o777).toBe(0o700)
        expect(JSON.parse(fs.readFileSync(markerPath, 'utf8'))).toEqual({
          format: 'fod.direct-buy-attempt',
          version: 1,
          buyer: BUYER,
          contract: `0x${V4_CONTRACT}`,
          purchaseSha256: createHash('sha256')
            .update(fs.readFileSync(path.join(vaultRoot, BUYER, purchaseId, 'purchase.json')))
            .digest('hex'),
          offerId,
          amount: '7000000000000000000',
          price: '2000000000000000000',
          txHash: null,
        })
        return {result: hash}
      },
    })

    await expect(commitService({spawn: child.spawn, rpcCall})({purchaseId}))
      .resolves.toEqual({purchaseId, status: 'funded', orderId: CONFIRM_ORDER_ID})
    expect(rpcCall.mock.calls.filter(([, call]) => call.method === 'contract_call'))
      .toHaveLength(1)
    expect(child.calls.map(({args}) => args[0])).toEqual([
      'direct-buy',
      'direct-market',
    ])
    expect(child.calls[0].args).not.toContain('-nodekey')
    expect(child.calls[0].args).not.toContain('-broadcast')
    expect(child.calls[0].args).not.toContain('-signed')
    expect(child.calls[0].args.join(' ')).not.toContain('RPC_SECRET')
    expect(JSON.parse(fs.readFileSync(markerPath, 'utf8')).txHash).toBe(hash)
  })

  it('recovers a settled purchase after restart without resubmitting or guessing an ambiguous order', async () => {
    const {purchaseId} = await service()({})
    const hash = `0x${'a'.repeat(64)}`
    let market = fundedMarket()
    let transactionValid = true
    const child = fakeSpawn({
      result: (args) => args[0] === 'direct-market'
        ? market
        : JSON.stringify(preparedBuy()),
    })
    const rpcCall = nodeRpc({
      submit: () => ({result: hash}),
      transaction: (txHash) => ({
        type: 'callContract', hash: txHash,
        from: `0x${transactionValid ? BUYER : AUTHOR}`,
        to: `0x${V4_CONTRACT}`, amount: '7',
        payload: `0x0a036275791261${preparedBuy().calldata}`,
        blockHash: `0x${'b'.repeat(64)}`,
      }),
    })
    await expect(commitService({spawn: child.spawn, rpcCall})({purchaseId}))
      .resolves.toEqual({purchaseId, status: 'funded', orderId: CONFIRM_ORDER_ID})

    market = settledMarket()
    transactionValid = false
    const resumed = commitService({spawn: child.spawn, rpcCall})
    await expect(resumed({purchaseId}))
      .resolves.toEqual({purchaseId, status: 'included'})
    transactionValid = true
    await expect(resumed({purchaseId}))
      .resolves.toEqual({purchaseId, status: 'settled', orderId: CONFIRM_ORDER_ID})

    const duplicate = {...JSON.parse(fundedMarket()).orders[0],
      orderId: '99', state: 'settled'}
    market = settledMarket([duplicate])
    await expect(resumed({purchaseId}))
      .resolves.toEqual({purchaseId, status: 'included'})
    expect(rpcCall.mock.calls.filter(([, call]) => call.method === 'contract_call'))
      .toHaveLength(1)
  })

  it('accepts integer and hex node fee rates during a funded buy', async () => {
    for (const feePerGas of [1, '0x1']) {
      const {purchaseId} = await service()({})
      const child = fakeSpawn({
        result: (args) => args[0] === 'direct-market'
          ? fundedMarket()
          : JSON.stringify(preparedBuy()),
      })
      const rpcCall = nodeRpc({
        feePerGas,
        submit: () => ({result: `0x${'a'.repeat(64)}`}),
      })
      await expect(commitService({spawn: child.spawn, rpcCall})({purchaseId}))
        .resolves.toEqual({purchaseId, status: 'funded', orderId: CONFIRM_ORDER_ID})
    }
  })

  it('refuses a buy whose minimum gas limit exceeds the fee budget', async () => {
    const {purchaseId} = await service()({})
    const child = fakeSpawn({result: JSON.stringify(preparedBuy())})
    const selectedDialog = {showMessageBox: jest.fn()}
    const rpcCall = nodeRpc({
      estimate: {success: true, gasUsed: 100, minGasLimit: 6000000},
    })
    await expect(commitService({
      spawn: child.spawn,
      rpcCall,
      selectedDialog,
    })({purchaseId})).rejects.toThrow('fod_direct_buy_fee_unavailable')
    expect(selectedDialog.showMessageBox).not.toHaveBeenCalled()
    expect(rpcCall.mock.calls.some(([, call]) => call.method === 'contract_call'))
      .toBe(false)
  })

  it('keeps a lost RPC response uncertain and never blindly retries the buy', async () => {
    const {purchaseId} = await service()({})
    const child = fakeSpawn({result: JSON.stringify(preparedBuy())})
    const rpcCall = nodeRpc({
      submit: () => { throw new Error('response lost after submission') },
    })
    const commit = commitService({spawn: child.spawn, rpcCall})

    await expect(commit({purchaseId})).resolves.toEqual({
      purchaseId,
      status: 'uncertain',
    })
    const markerPath = path.join(vaultRoot, BUYER, purchaseId, 'buy-attempt.json')
    expect(JSON.parse(fs.readFileSync(markerPath, 'utf8')).txHash).toBeNull()
    await expect(commit({purchaseId})).resolves.toEqual({
      purchaseId,
      status: 'uncertain',
    })
    expect(rpcCall.mock.calls.filter(([, call]) => call.method === 'contract_call'))
      .toHaveLength(1)
    expect(child.calls.map(({args}) => args[0])).toEqual(['direct-buy'])
  })

  it('refuses changed prepared terms or identity before showing the buy confirmation', async () => {
    const {purchaseId} = await service()({})
    const rpcCall = jest.fn()
    const selectedDialog = {showMessageBox: jest.fn()}
    const changedTerms = fakeSpawn({
      result: JSON.stringify({
        ...preparedBuy(),
        amount: '8000000000000000000',
      }),
    })
    await expect(commitService({
      spawn: changedTerms.spawn,
      rpcCall,
      selectedDialog,
    })({purchaseId})).rejects.toThrow('fod_direct_buy_changed')

    let identityReads = 0
    const changedIdentity = fakeSpawn({result: JSON.stringify(preparedBuy())})
    await expect(commitService({
      spawn: changedIdentity.spawn,
      rpcCall,
      selectedDialog,
      coinbase: async () => `0x${++identityReads > 1 ? AUTHOR : BUYER}`,
    })({purchaseId})).rejects.toThrow('fod_direct_buy_identity_changed')
    expect(selectedDialog.showMessageBox).not.toHaveBeenCalled()
    expect(rpcCall).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(vaultRoot, BUYER, purchaseId, 'buy-attempt.json')))
      .toBe(false)
  })
})
