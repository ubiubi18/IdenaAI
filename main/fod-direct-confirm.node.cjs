const assert = require('node:assert/strict')
const {createHash} = require('node:crypto')
const {EventEmitter} = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {PassThrough} = require('node:stream')
const {test} = require('node:test')
const {
  createFodDirectCheckService,
  createFodDirectReceiveService,
  createFodDirectConfirmService,
} = require('./fod-direct-check')

const contract = '0x6bc41502f4611d041a986cda580209d7f5a4e0d4'
const codeHash =
  '0x24221880179c31a21e183221e13d2456b222a71b12e874b288504748aaca38e1'
const v4Contract = '0x3730be2217b0de1fdfe73098d37f3174dd9748cb'
const v4CodeHash =
  '0x8b9fd14f9c08708db1ab25d90396563d3efe6bed6843c5aae15932d68bdf614c'
const v2Contract = '0xe86d31069194690b1a818f24912bafdacfb29f19'
const v2CodeHash =
  '0x9ee10f3588bd403460ff6149016a3e4544df5c2ef02f6e6123a5cd75588f3319'
const buyer = 'b'.repeat(40)
const ciphertext = 'c'.repeat(438)
const digest = createHash('sha256').update(Buffer.from(ciphertext, 'hex')).digest()
const calldata = Buffer.concat([Buffer.from('0000000000000001', 'hex'), digest])

function fixture(options = {}) {
  const targetContract = options.v4 ? v4Contract : options.v2 ? v2Contract : contract
  const targetCodeHash = options.v4 ? v4CodeHash : options.v2 ? v2CodeHash : codeHash
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fod-confirm-test-')))
  const vaultRoot = path.join(root, 'vaults')
  const buyerRoot = path.join(vaultRoot, buyer)
  const deliveryRoot = path.join(buyerRoot, 'fod-receive-ABC123')
  for (const dir of [vaultRoot, buyerRoot, deliveryRoot]) {
    fs.mkdirSync(dir, {mode: 0o700})
  }
  const receiptPath = path.join(deliveryRoot, 'receipt.json')
  fs.writeFileSync(
    receiptPath,
    JSON.stringify({
      format: 'fod.opened-direct-delivery',
      version: 1,
      contract: targetContract.slice(2),
      offerId: 'd'.repeat(64),
      orderId: 1,
      orderNonce: 1,
      buyer,
      deliveryKey: `04${'e'.repeat(128)}`,
      author: 'a'.repeat(40),
      epoch: 230,
      inventoryCommitment: '1'.repeat(64),
      keyCommitment: '2'.repeat(64),
      ciphertext,
      usableFlips: 3,
      contentCheckSignature: '3'.repeat(130),
    }),
    {mode: 0o600}
  )
  const binaryPath = path.join(root, 'fod')
  fs.writeFileSync(binaryPath, '#!/bin/sh\n', {mode: 0o700})
  const purchasePath = path.join(root, 'purchase.json')
  const keyPath = path.join(root, 'delivery.key')
  fs.writeFileSync(purchasePath, '{"retained":"private"}', {mode: 0o600})
  fs.writeFileSync(keyPath, '1'.repeat(64), {mode: 0o600})
  const expectedBinaryHash = createHash('sha256')
    .update(fs.readFileSync(binaryPath))
    .digest('hex')
  const calls = []
  let submissions = 0
  let changedIdentity = false
  let selections = 0
  let marketState = options.marketState || 'funded'
  const spawnCalls = []
  const dialog = {
    showOpenDialog: async () => {
      selections += 1
      if (options.mutateBeforeSpawn && selections === 2) {
        fs.appendFileSync(binaryPath, 'changed')
      }
      return {canceled: false, filePaths: [selections % 2 ? purchasePath : keyPath]}
    },
  }
  const rpcCall = async (_connection, request) => {
    calls.push(request)
    switch (request.method) {
      case 'bcn_syncing':
        return {result: {syncing: false, wrongTime: false, currentBlock: 7, highestBlock: 7}}
      case 'dna_getCoinbaseAddr':
        return {result: `0x${buyer}`}
      case 'dna_getBalance':
        return {result: {balance: '20', nonce: 0, mempoolNonce: 0}}
      case 'contract_getStake':
        return {result: {Hash: targetCodeHash}}
      case 'bcn_feePerGas':
        return {result: '1'}
      case 'contract_estimateCall':
        return {result: {success: true, gasCost: options.highFee ? '3.1' : '0.1', txFee: '0.1'}}
      case 'contract_call':
        submissions += 1
        assert.equal(request.params[0].contract, targetContract)
        assert.equal(request.params[0].method, 'confirm')
        assert.equal(request.params[0].amount, '0')
        assert.equal(request.params[0].maxFee, '3')
        assert.equal(request.params[0].args[0].value, `0x${calldata.toString('hex')}`)
        if (options.unknownSubmission) throw new Error('node timeout')
        return {result: `0x${'f'.repeat(64)}`}
      case 'bcn_txReceipt':
        return {result: {success: true}}
      default:
        throw new Error(`unexpected RPC ${request.method}`)
    }
  }
  const spawn = (stagedBinary, args) => {
    assert.notEqual(stagedBinary, binaryPath)
    assert.equal(fs.statSync(path.dirname(stagedBinary)).mode & 0o777, 0o700)
    assert.equal(fs.statSync(stagedBinary).mode & 0o777, 0o700)
    assert.equal(
      createHash('sha256').update(fs.readFileSync(stagedBinary)).digest('hex'),
      expectedBinaryHash
    )
    spawnCalls.push(args)
    if (options.mutateAtSpawn && spawnCalls.length === 1) {
      fs.appendFileSync(binaryPath, 'changed')
    }
    if (options.v4) {
      assert.deepEqual(args.slice(1, 3), ['-direct-version', '4'])
    } else {
      assert.notEqual(args[1], '-direct-version')
    }
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => true
    child.stdin.on('finish', () => {
      const outputFlag = args[0] === 'direct-confirm' ? '-prepared' : '-out'
      const out = args[args.indexOf(outputFlag) + 1]
      if (args[0] === 'direct-market') {
        fs.writeFileSync(out, JSON.stringify({
          format: 'fod.direct-market-state',
          version: options.marketVersion ?? (options.v4 ? 3 : 2),
          network: 'idena', source: 'node',
          contract: targetContract.slice(2),
          codeHash: (options.marketCodeHash || targetCodeHash).slice(2),
          orders: [{orderId: '1', buyer: options.marketBuyer || buyer,
            state: marketState}],
        }), {mode: 0o600})
      } else if (args[0] === 'direct-confirm') {
        fs.writeFileSync(out, JSON.stringify({
          format: 'fod.prepared-direct-confirm', version: 1, operation: 'confirm',
          network: 'idena', contract: targetContract.slice(2), buyer,
          amount: '0', calldata: calldata.toString('hex'),
          ciphertextSha256: digest.toString('hex'), directOrderId: 1,
        }), {mode: 0o600})
      } else if (args[0] === 'direct-check') {
        fs.writeFileSync(out, JSON.stringify({
          format: 'fod.direct-check', version: 1,
          contract: targetContract.slice(2), orderId: 1,
          author: 'a'.repeat(40), epoch: 230, usableFlips: 3,
        }), {mode: 0o600})
      } else if (args[0] === 'direct-receive') {
        fs.writeFileSync(args[args.indexOf('-vault') + 1], 'age-encrypted', {mode: 0o600})
        fs.writeFileSync(out, fs.readFileSync(receiptPath), {mode: 0o600})
      } else {
        throw new Error(`unexpected child command ${args[0]}`)
      }
      setImmediate(() => child.emit('close', 0))
    })
    return child
  }
  const newConfirm = () => createFodDirectConfirmService({
    getNodeRpcConnection: () => ({url: 'http://127.0.0.1:9009', key: ''}),
    getActiveCoinbase: () => `0x${changedIdentity ? 'a'.repeat(40) : buyer}`,
    rpcCall,
    spawn,
    fs,
    binaryPath,
    vaultRoot,
    expectedBinaryHash,
  })
  const confirm = newConfirm()
  const directOptions = {
    dialog,
    getNodeRpcConnection: () => ({url: 'http://127.0.0.1:9009', key: ''}),
    getActiveCoinbase: () => `0x${buyer}`,
    spawn, fs, binaryPath, expectedBinaryHash,
  }
  const check = createFodDirectCheckService(directOptions)
  const receive = createFodDirectReceiveService({...directOptions, vaultRoot})
  const message = JSON.stringify({
    format: 'fod.direct-delivery', version: 2, network: 'idena',
    contract: targetContract.slice(2), author: 'a'.repeat(40),
    offerId: 'd'.repeat(64), orderId: 1, orderNonce: 1,
    buyer, deliveryKey: `04${'e'.repeat(128)}`, ciphertext,
  })
  return {
    confirm,
    check,
    receive,
    message,
    calls,
    submissions: () => submissions,
    newConfirm,
    setMarketState: (value) => { marketState = value },
    selections: () => selections,
    spawnCalls,
    binaryPath,
    receiptPath,
    buyerRoot,
    changeIdentity: () => { changedIdentity = true },
    cleanup: () => fs.rmSync(root, {recursive: true, force: true}),
  }
}

test('confirms one verified order once with bounded fee and pinned identity', async () => {
  const f = fixture()
  try {
    assert.deepEqual(await f.confirm({orderId: '1', contract}), {orderId: '1', status: 'settled'})
    assert.deepEqual(await f.newConfirm()({orderId: '1', contract}), {orderId: '1', status: 'settled'})
    assert.equal(f.submissions(), 1)
    assert.equal(f.calls.filter((call) => call.method === 'contract_call').length, 1)
  } finally {
    f.cleanup()
  }
})

test('refuses a wrong contract, an unaffordable fee, and a changed identity', async () => {
  const f = fixture({highFee: true})
  try {
    await assert.rejects(f.confirm({orderId: '1', contract: `0x${'a'.repeat(40)}`}))
    await assert.rejects(f.confirm({orderId: '1', contract}), /fod_direct_confirm_fee_unavailable/)
    f.changeIdentity()
    await assert.rejects(f.confirm({orderId: '1', contract}))
    assert.equal(f.submissions(), 0)
  } finally {
    f.cleanup()
  }
})

test('treats an unknown submission outcome as pending without signing again', async () => {
  const f = fixture({unknownSubmission: true})
  try {
    assert.deepEqual(await f.confirm({orderId: '1', contract}), {orderId: '1', status: 'pending'})
    const marker = path.join(f.buyerRoot, `confirm-${contract.slice(2)}-1.json`)
    assert.equal(fs.statSync(marker).mode & 0o777, 0o600)
    assert.deepEqual(await f.newConfirm()({orderId: '1', contract}), {orderId: '1', status: 'pending'})
    assert.equal(f.submissions(), 1)
    f.setMarketState('settled')
    assert.deepEqual(await f.newConfirm()({orderId: '1', contract}), {orderId: '1', status: 'settled'})
    assert.equal(f.submissions(), 1)
  } finally {
    f.cleanup()
  }
})

test('rejects a receipt with the wrong saved buyer or order before running the CLI', async () => {
  const f = fixture({v4: true})
  try {
    const original = fs.readFileSync(f.receiptPath, 'utf8')
    for (const wrong of [
      original.replace(`"buyer":"${buyer}"`, `"buyer":"${'a'.repeat(40)}"`),
      original.replace('"orderId":1', '"orderId":2'),
    ]) {
      fs.writeFileSync(f.receiptPath, wrong, {mode: 0o600})
      await assert.rejects(
        f.confirm({orderId: '1', contract: v4Contract}),
        /fod_direct_confirm_no_saved_receipt/
      )
    }
    assert.equal(f.spawnCalls.length, 0)
    assert.equal(f.submissions(), 0)
  } finally {
    f.cleanup()
  }
})

test('v4 confirms only a saved receipt for the exact funded buyer and contract', async () => {
  const f = fixture({v4: true})
  try {
    await assert.rejects(f.confirm({orderId: '1', contract}), /fod_direct_confirm_no_saved_receipt/)
    assert.deepEqual(await f.confirm({orderId: '1', contract: v4Contract}), {
      orderId: '1', status: 'settled',
    })
    assert.equal(f.submissions(), 1)
  } finally {
    f.cleanup()
  }
})

test('recognizes an already settled v4 order without broadcasting', async () => {
  const f = fixture({v4: true, marketState: 'settled'})
  try {
    assert.deepEqual(await f.newConfirm()({orderId: '1', contract: v4Contract}), {
      orderId: '1', status: 'settled',
    })
    assert.equal(f.submissions(), 0)
  } finally {
    f.cleanup()
  }
})

test('v4 refuses a wrong market schema, hash, buyer, or refunded order', async () => {
  for (const options of [
    {marketVersion: 2},
    {marketCodeHash: codeHash},
    {marketBuyer: 'a'.repeat(40)},
    {marketState: 'refunded'},
  ]) {
    const f = fixture({v4: true, ...options})
    try {
      await assert.rejects(
        f.confirm({orderId: '1', contract: v4Contract}),
        /fod_direct_confirm_failed/
      )
      assert.equal(f.submissions(), 0)
    } finally {
      f.cleanup()
    }
  }
})

test('refuses an unreviewed binary before opening the private receipt', async () => {
  const f = fixture({v4: true})
  try {
    fs.appendFileSync(f.binaryPath, 'changed')
    await assert.rejects(f.confirm({orderId: '1', contract: v4Contract}))
    assert.equal(f.spawnCalls.length, 0)
    assert.equal(f.submissions(), 0)
  } finally {
    f.cleanup()
  }
})

test('recovers a saved receipt after restart and rejects conflicting copies', async () => {
  const f = fixture({v4: true})
  try {
    const identicalDir = path.join(f.buyerRoot, 'fod-receive-DEF456')
    fs.mkdirSync(identicalDir, {mode: 0o700})
    fs.copyFileSync(f.receiptPath, path.join(identicalDir, 'receipt.json'))
    assert.deepEqual(await f.newConfirm()({orderId: '1', contract: v4Contract}), {
      orderId: '1', status: 'settled',
    })
    assert.equal(f.submissions(), 1)
    const conflicting = fs.readFileSync(f.receiptPath, 'utf8')
      .replace('"ciphertext":"' + ciphertext, '"ciphertext":"' + 'd'.repeat(438))
    fs.writeFileSync(path.join(identicalDir, 'receipt.json'), conflicting, {mode: 0o600})
    await assert.rejects(
      f.newConfirm()({orderId: '1', contract: v4Contract}),
      /fod_direct_confirm_duplicate_receipt/
    )
    assert.equal(f.submissions(), 1)
  } finally {
    f.cleanup()
  }
})

test('reconciles a v4 settled chain state after an unknown submission', async () => {
  const f = fixture({v4: true, unknownSubmission: true})
  try {
    assert.deepEqual(await f.confirm({orderId: '1', contract: v4Contract}), {
      orderId: '1', status: 'pending',
    })
    f.setMarketState('settled')
    assert.deepEqual(await f.newConfirm()({orderId: '1', contract: v4Contract}), {
      orderId: '1', status: 'settled',
    })
    assert.equal(f.submissions(), 1)
  } finally {
    f.cleanup()
  }
})

test('runs the staged binary when the original changes at spawn time', async () => {
  const f = fixture({v4: true, mutateAtSpawn: true})
  try {
    assert.deepEqual(await f.confirm({orderId: '1', contract: v4Contract}), {
      orderId: '1', status: 'settled',
    })
    assert.equal(f.submissions(), 1)
  } finally {
    f.cleanup()
  }
})

test('v4 checks and saves only through the pinned CLI with the explicit version', async () => {
  const f = fixture({v4: true})
  try {
    const checked = await f.check({message: f.message})
    assert.equal(checked.contract, v4Contract)
    const saved = await f.receive({message: f.message, passphrase: 'correct horse battery staple'})
    assert.equal(saved.contract, v4Contract)
    assert.equal(fs.statSync(saved.receiptPath).mode & 0o777, 0o600)
    assert.deepEqual(f.spawnCalls.map((args) => args.slice(0, 3)), [
      ['direct-check', '-direct-version', '4'],
      ['direct-receive', '-direct-version', '4'],
    ])
    assert.equal(f.selections(), 4)
  } finally {
    f.cleanup()
  }
})

test('check and receive refuse an unreviewed binary before private file selection', async () => {
  const f = fixture({v4: true})
  try {
    fs.appendFileSync(f.binaryPath, 'changed')
    await assert.rejects(f.check({message: f.message}))
    await assert.rejects(f.receive({
      message: f.message, passphrase: 'correct horse battery staple',
    }))
    assert.equal(f.selections(), 0)
    assert.equal(f.spawnCalls.length, 0)
  } finally {
    f.cleanup()
  }
})

test('v2 and v3 checks and saves keep their CLI arguments', async () => {
  for (const options of [{v2: true}, {}]) {
    const f = fixture(options)
    try {
      const checked = await f.check({message: f.message})
      const saved = await f.receive({
        message: f.message, passphrase: 'correct horse battery staple',
      })
      assert.equal(checked.contract, saved.contract)
      assert.deepEqual(f.spawnCalls.map((args) => args[1]), ['-network', '-network'])
    } finally {
      f.cleanup()
    }
  }
})

test('rechecks the executable before giving private inputs to the child', async () => {
  const f = fixture({v4: true, mutateBeforeSpawn: true})
  try {
    await assert.rejects(f.check({message: f.message}))
    assert.equal(f.spawnCalls.length, 0)
  } finally {
    f.cleanup()
  }
})
