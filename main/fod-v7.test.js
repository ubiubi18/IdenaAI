/** @jest-environment node */

const {createHash} = require('crypto')
const {EventEmitter} = require('events')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {PassThrough} = require('stream')
const {createFodV7Service} = require('./fod-v7')
const {privateKeyToAddress} = require('./utils/idena-crypto')

const ADDRESS = privateKeyToAddress('1'.repeat(64), false)
const CONTRACT = 'b'.repeat(40)
const CODE_HASH = 'c'.repeat(64)
const OFFER_ID = 'd'.repeat(64)
const PREVIEW_CIDS = [`b${'a'.repeat(58)}`, `b${'c'.repeat(58)}`]
const INVENTORY_COMMITMENT = createHash('sha256')
  .update('fod.bundle-manifest:v1')
  .update(ADDRESS)
  .update(Buffer.from([0, 230]))
  .update(`\0${PREVIEW_CIDS[0]}\0${PREVIEW_CIDS[1]}`)
  .digest('hex')
const CHAIN_OFFER_ID = createHash('sha256')
  .update('fod:pool-offer:v7')
  .update(Buffer.from(ADDRESS, 'hex'))
  .update(Buffer.from([0, 230]))
  .digest('hex')
const TX_HASH = `0x${'e'.repeat(64)}`
const DELIVERY_KEY = `04${'a'.repeat(128)}`

function marketRpc({publicSeed = false, sellerBond, noHead = false} = {}) {
  const rate = 1000000000000n
  const fixed = (value, bytes) =>
    Buffer.from(value.toString(16).padStart(bytes * 2, '0'), 'hex')
  const offer = Buffer.alloc(222)
  Buffer.from(ADDRESS, 'hex').copy(offer, 0)
  offer.writeUInt16BE(230, 20)
  offer.writeUInt32BE(PREVIEW_CIDS.length, 22)
  Buffer.from(INVENTORY_COMMITMENT, 'hex').copy(offer, 26)
  Buffer.alloc(32, 1).copy(offer, 58)
  fixed(sellerBond ?? (publicSeed ? 0n : rate * 10000000n), 16).copy(offer, 90)
  offer.writeBigUInt64BE(1n, 106)
  offer[122] = publicSeed ? 2 : 1
  offer[123] = publicSeed ? 1 : 0
  offer[204] = 1
  offer[221] = publicSeed ? 1 : 0
  const inventory = Buffer.concat([
    Buffer.from([PREVIEW_CIDS.length]),
    ...PREVIEW_CIDS.flatMap((cid) => [
      Buffer.from([cid.length]),
      Buffer.from(cid),
    ]),
  ])
  const head = Buffer.from(CHAIN_OFFER_ID, 'hex')
  const zero = Buffer.alloc(32)
  const fields = {
    'pool/primary-head': !publicSeed && !noHead ? head : zero,
    'pool/secondary-head': publicSeed && !noHead ? head : zero,
    'pool/primary-units': fixed(publicSeed ? 0n : 2n, 8),
    'pool/secondary-units': fixed(publicSeed ? 1n : 0n, 8),
    'pool/reserve': fixed(10000n * 10n ** 18n, 16),
    'pool/insurance': fixed(0n, 16),
  }
  const onRpc = (method, params) => {
    if (method === 'bcn_feePerGas') return rate.toString()
    if (method === 'contract_readData')
      return `0x${fields[params[1]].toString('hex')}`
    if (method === 'contract_iterateMap') {
      const bytes = params[1] === 'pool/offer/' ? offer : inventory
      return {
        items: [
          {key: `0x${CHAIN_OFFER_ID}`, value: `0x${bytes.toString('hex')}`},
        ],
        continuationToken: null,
      }
    }
    return undefined
  }
  return {onRpc, offer}
}
const BINARY_HASH = createHash('sha256')
  .update(fs.readFileSync(process.execPath))
  .digest('hex')

function fakeSpawn(calls) {
  return (binary, args, options) => {
    calls.push({
      binary,
      args,
      hasPassphrase: Boolean(options?.env?.FOD_PASSPHRASE),
    })
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = jest.fn()
    child.stdin.on('finish', () => {
      if (args[0] === 'v8' || args[0] === 'v9') {
        const command = args[args.indexOf('-command') + 1]
        const out = args[args.indexOf('-out') + 1]
        if (command === 'status')
          fs.writeFileSync(
            out,
            JSON.stringify({
              version: args[0] === 'v9' ? 9 : 8,
              contract: CONTRACT,
              codeHash: CODE_HASH,
              identity: ADDRESS,
              height: 100,
              buyQuote: '100',
              sellQuote: '90',
              poolCanAcquire: false,
              account: {
                balance: '1000',
                reserved: '0',
                target: '1000',
                needsTopup: false,
              },
              buys: [],
              sells: [],
              bundles: [],
              trades: [],
            }),
            {mode: 0o600}
          )
        if (command === 'listing') {
          const request = JSON.parse(
            fs.readFileSync(args[args.indexOf('-request') + 1], 'utf8')
          )
          fs.writeFileSync(out, JSON.stringify(request), {mode: 0o600})
        }
        if (command === 'prepare') {
          const request = JSON.parse(
            fs.readFileSync(args[args.indexOf('-request') + 1], 'utf8')
          )
          fs.writeFileSync(
            out,
            JSON.stringify({
              format: `fod.prepared-bonded-${args[0]}-${request.operation}`,
              version: 1,
              operation: request.operation,
              network: 'idena',
              contract: CONTRACT,
              codeHash: CODE_HASH,
              amount: request.operation === 'queueBuy' ? request.maximum : '1',
              estimatedMaxFee: '1000',
              bondedV8: request,
            }),
            {mode: 0o600}
          )
        }
      } else if (args[0] === 'direct-v7-prepare') {
        const operation = args[args.indexOf('-operation') + 1]
        const contract = args[args.indexOf('-contract') + 1]
        fs.writeFileSync(
          args[args.indexOf('-prepared') + 1],
          JSON.stringify({
            format: `fod.prepared-direct-v7-${
              operation === 'buyPublicSeed' ? 'buy-public-seed' : operation
            }`,
            operation,
            directVersion: 7,
            version: 1,
            network: 'idena',
            contract,
            codeHash: CODE_HASH,
            directOfferId: args.includes('-v7-offer-id')
              ? args[args.indexOf('-v7-offer-id') + 1]
              : OFFER_ID,
            amount: operation === 'buy' ? '2500000000000000000' : '0',
            ...(operation === 'buy' ? {price: '2000000000000000000'} : {}),
            ...(operation === 'buy'
              ? {
                  author: ADDRESS,
                  epoch: 230,
                  coveredFlips: PREVIEW_CIDS.length,
                  inventoryCommitment: INVENTORY_COMMITMENT,
                  buyer: ADDRESS,
                  deliveryKey: DELIVERY_KEY,
                  orderNonce: 1,
                  directSession: {
                    author: ADDRESS,
                    epoch: 230,
                    manifest: PREVIEW_CIDS,
                  },
                }
              : {}),
          }),
          {mode: 0o600}
        )
      } else if (args[0] === 'direct-v7-dm') {
        fs.writeFileSync(args[args.indexOf('-out') + 1], '{}', {mode: 0o600})
      } else if (args[0] === 'direct-v7-receive') {
        const purchase = JSON.parse(
          fs.readFileSync(args[args.indexOf('-purchase') + 1], 'utf8')
        )
        fs.writeFileSync(
          args[args.indexOf('-out') + 1],
          JSON.stringify({
            format: 'fod.opened-direct-delivery',
            version: 1,
            contract: args[args.indexOf('-contract') + 1],
            offerId: purchase.directOfferId,
            orderId: Number(args[args.indexOf('-order') + 1]),
            buyer: purchase.buyer,
            deliveryKey: purchase.deliveryKey,
            orderNonce: purchase.orderNonce,
            usableFlips: 2,
          }),
          {mode: 0o600}
        )
      } else if (args[0] === 'submit') {
        const contract = args[args.indexOf('-contract') + 1]
        const prepared = JSON.parse(
          fs.readFileSync(args[args.indexOf('-prepared') + 1], 'utf8')
        )
        const bonded = /^fod\.prepared-bonded-v[89]-/.test(prepared.format)
        fs.writeFileSync(
          args[args.indexOf('-signed') + 1],
          JSON.stringify({
            format: 'fod.submitted-transaction',
            version: 1,
            network: 'idena',
            contract,
            operation: bonded ? prepared.operation : 'challenge',
            amount: bonded ? prepared.amount : '0',
            maxFee: bonded ? prepared.estimatedMaxFee : '1000000000000000000',
            sender: ADDRESS,
            broadcast: true,
            txHash: TX_HASH,
            outcome: {included: true, success: true},
          }),
          {mode: 0o600}
        )
      }
      setImmediate(() => child.emit('close', 0))
    })
    return child
  }
}

describe('direct v7 desktop bridge', () => {
  let root
  let keyFile
  let calls
  let dialog

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'idena-v7-test-'))
    )
    keyFile = path.join(root, 'nodekey')
    fs.writeFileSync(keyFile, '1'.repeat(64), {mode: 0o600})
    calls = []
    dialog = {
      showMessageBox: jest.fn().mockResolvedValue({response: 1}),
      showOpenDialog: jest
        .fn()
        .mockResolvedValue({canceled: false, filePaths: [keyFile]}),
    }
  })

  afterEach(() => fs.rmSync(root, {recursive: true, force: true}))

  function service({
    connection,
    stakeHash,
    fsImpl = fs,
    getNonce = () => 2,
    identity = ADDRESS,
    onRpc,
    openFolder,
    getExplorer,
    marketVersion = 7,
  } = {}) {
    return createFodV7Service({
      marketVersion,
      fs: fsImpl,
      dialog,
      spawn: fakeSpawn(calls),
      root: path.join(root, 'v7'),
      getNodeRpcConnection: () =>
        connection || {url: 'http://127.0.0.1:9009', key: 'local-key'},
      getActiveCoinbase: async () => `0x${identity}`,
      openFolder,
      getExplorer,
      rpcCall: async (_connection, {method, params}) => {
        const override = await onRpc?.(method, params)
        if (override !== undefined) return {result: override}
        const results = {
          bcn_syncing: {
            syncing: false,
            wrongTime: false,
            currentBlock: 100,
            highestBlock: 100,
          },
          contract_getStake: {Hash: stakeHash || `0x${CODE_HASH}`},
          dna_getCoinbaseAddr: `0x${identity}`,
          dna_getBalance: {
            balance: '10',
            nonce: getNonce(),
            mempoolNonce: getNonce(),
          },
          dna_epoch: {epoch: 230},
          bcn_txReceipt: {
            success: true,
            txHash: TX_HASH,
            contract: `0x${CONTRACT}`,
          },
        }
        return {result: results[method]}
      },
    })
  }

  const pins = {
    contract: CONTRACT,
    codeHash: CODE_HASH,
    binaryPath: process.execPath,
    binarySha256: BINARY_HASH,
  }

  it.each([8, 9])(
    'v%s enforces purchase budgets at the real signing boundary',
    async (version) => {
      fs.mkdirSync(path.join(root, 'v7'), {recursive: true, mode: 0o700})
      fs.writeFileSync(
        path.join(root, 'v7', `bonded-v${version}.json`),
        JSON.stringify(pins),
        {mode: 0o600}
      )
      const v8 = service({
        marketVersion: version,
        onRpc: (method) => {
          if (method === 'bcn_feePerGas') return '1'
          if (method === 'dna_identity') return {flips: []}
          return undefined
        },
      })
      await v8('unlock', {
        passphrase: 'a test vault passphrase',
        perTrade: '200',
        purchaseBudget: '105',
      })
      const dialogs = dialog.showMessageBox.mock.calls.length
      await v8('tick')
      expect(calls.filter(({args}) => args[0] === 'submit')).toHaveLength(0)
      const result = await v8('trade', {side: 'buy', quote: '100'})
      expect(result.status).toBe('included')
      expect(dialog.showMessageBox).toHaveBeenCalledTimes(dialogs)
      expect(calls.filter(({args}) => args[0] === 'submit')).toHaveLength(1)
      expect((await v8('status')).trading.purchaseRemaining).toBe('0')
      await expect(v8('trade', {side: 'buy', quote: '100'})).rejects.toThrow(
        'budget'
      )
      expect(calls.filter(({args}) => args[0] === 'submit')).toHaveLength(1)
      await v8('stop')
      await expect(v8('trade', {side: 'buy', quote: '100'})).rejects.toThrow(
        'Enable one-click'
      )
    }
  )

  it('v9 retains the vault passphrase through the real sale signing boundary', async () => {
    const bundle = 'd'.repeat(64)
    const base = path.join(root, 'v7', 'bonded', CONTRACT, ADDRESS)
    fs.mkdirSync(base, {recursive: true, mode: 0o700})
    fs.writeFileSync(
      path.join(root, 'v7', 'bonded-v9.json'),
      JSON.stringify(pins),
      {mode: 0o600}
    )
    const journal = Buffer.alloc(273)
    Buffer.from(CONTRACT, 'hex').copy(journal, 36)
    Buffer.from(ADDRESS, 'hex').copy(journal, 56)
    journal.writeUInt16BE(233, 76)
    journal.writeUInt16BE(5, 78)
    fs.writeFileSync(
      path.join(base, `package-${bundle}.json`),
      JSON.stringify({
        protocolVersion: 9,
        caller: ADDRESS,
        bundle,
        journal: journal.toString('hex'),
        vaultFile: keyFile,
        sessionFile: keyFile,
      }),
      {mode: 0o600}
    )
    const v9 = service({
      marketVersion: 9,
      onRpc: (method) => (method === 'bcn_feePerGas' ? '1' : undefined),
    })
    await v9('unlock', {
      passphrase: 'a test vault passphrase',
      perTrade: '200',
      purchaseBudget: '1000',
    })
    const result = await v9('trade', {side: 'sell', bundle, quote: '90'})
    expect(result.status).toBe('included')
    expect(calls.find((c) => c.args[0] === 'submit').hasPassphrase).toBe(true)
    expect(calls.find((c) => c.args.includes('listing')).hasPassphrase).toBe(
      true
    )
  })

  it('lets the user choose a tool path without treating it as verified', async () => {
    const v7 = service()
    expect(await v7('chooseBinary')).toEqual({path: keyFile})
    expect(fs.existsSync(path.join(root, 'v7', 'config.json'))).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('refuses a wrong code pin and non-loopback RPC before storing configuration', async () => {
    const badCode = service({stakeHash: `0x${'f'.repeat(64)}`})
    await expect(badCode('configure', pins)).rejects.toThrow()
    expect(fs.existsSync(path.join(root, 'v7', 'config.json'))).toBe(false)

    const remote = service({connection: {url: 'https://example.com', key: ''}})
    await expect(remote('configure', pins)).rejects.toThrow('loopback')
    expect(calls).toHaveLength(0)
  })

  it('prepares through the pinned CLI and never signs the same action twice', async () => {
    const v7 = service()
    await v7('configure', pins)
    const prepared = await v7('prepare', {
      operation: 'challenge',
      orderId: '17',
      maxFee: '1000000000000000000',
    })
    expect(prepared.operation).toBe('challenge')
    expect(prepared.amount).toBe('0')
    expect(calls[0].args).not.toContain('-broadcast')
    const sent = await v7('submit', {actionId: prepared.actionId})
    expect(sent).toEqual({
      actionId: prepared.actionId,
      txHash: TX_HASH,
      status: 'included',
    })
    expect(calls[1].args).toContain('-broadcast')
    await expect(v7('submit', {actionId: prepared.actionId})).rejects.toThrow(
      'already'
    )
    expect(calls).toHaveLength(2)
    expect(await v7('check', {actionId: prepared.actionId})).toEqual({
      txHash: TX_HASH,
      status: 'included',
    })
  })

  it('refreshes pending receipts without rewriting signed records or allowing a second signature', async () => {
    let receipt = null
    const v7 = service({
      onRpc: (method) => (method === 'bcn_txReceipt' ? receipt : undefined),
    })
    await v7('configure', pins)
    const prepared = await v7('prepare', {
      operation: 'challenge',
      orderId: '17',
      maxFee: '1000000000000000000',
    })
    await v7('submit', {actionId: prepared.actionId})
    const file = path.join(
      root,
      'v7',
      'actions',
      ADDRESS,
      prepared.actionId,
      'signed.json'
    )
    const signed = JSON.parse(fs.readFileSync(file, 'utf8'))
    signed.outcome = {included: false}
    fs.writeFileSync(file, JSON.stringify(signed))
    const original = fs.readFileSync(file)
    expect((await v7('status')).actions[0].submitted.status).toBe('uncertain')
    receipt = {success: true, txHash: TX_HASH, contract: `0x${CONTRACT}`}
    expect((await v7('status')).actions[0].submitted.status).toBe('included')
    receipt = {...receipt, success: false}
    expect((await v7('status')).actions[0].submitted.status).toBe('failed')
    receipt = {...receipt, txHash: `0x${'f'.repeat(64)}`}
    expect((await v7('status')).actions[0].submitted.status).toBe('uncertain')
    expect(fs.readFileSync(file).equals(original)).toBe(true)
    await expect(v7('submit', {actionId: prepared.actionId})).rejects.toThrow(
      'already'
    )
    expect(calls.filter(({args}) => args[0] === 'submit')).toHaveLength(1)
  })

  it('requires user review before signing or broadcasting', async () => {
    dialog.showMessageBox.mockResolvedValue({response: 0})
    const v7 = service()
    await v7('configure', pins)
    const prepared = await v7('prepare', {
      operation: 'challenge',
      orderId: '17',
      maxFee: '1000000000000000000',
    })
    expect(await v7('submit', {actionId: prepared.actionId})).toEqual({
      status: 'cancelled',
    })
    expect(calls).toHaveLength(1)
    expect(
      fs.existsSync(
        path.join(
          root,
          'v7',
          'actions',
          ADDRESS,
          prepared.actionId,
          'attempt.json'
        )
      )
    ).toBe(false)
    expect(dialog.showMessageBox.mock.calls[0][0].detail).toContain(
      'Maximum network fee: 1 iDNA'
    )
  })

  it('shows the private purchase price and buyer bond before signing', async () => {
    dialog.showMessageBox.mockResolvedValue({response: 0})
    const v7 = service()
    await v7('configure', pins)
    const prepared = await v7('prepare', {
      operation: 'buy',
      offerId: OFFER_ID,
      maxFee: '1000000000000000000',
    })

    expect(await v7('submit', {actionId: prepared.actionId})).toEqual({
      status: 'cancelled',
    })
    const {title, message, detail} = dialog.showMessageBox.mock.calls[0][0]
    expect(title).toBe('Flips on Demand · Review transaction')
    expect(message).toBe('Sign and broadcast buy private flips?')
    expect(detail).toContain('Price: 2 iDNA')
    expect(detail).toContain('Buyer bond: 0.5 iDNA')
    expect(detail).toContain('Total attached: 2.5 iDNA')
    expect(detail).toContain('App fee: 0 iDNA')
    expect(detail).toContain('Verify the delivered ciphertext')
    expect(calls).toHaveLength(1)
  })

  it('repeats the public-key limitation in the transaction review', async () => {
    dialog.showMessageBox.mockResolvedValue({response: 0})
    const v7 = service()
    await v7('configure', pins)
    const prepared = await v7('prepare', {
      operation: 'buyPublicSeed',
      offerId: OFFER_ID,
      maxFee: '1000000000000000000',
    })
    expect(await v7('submit', {actionId: prepared.actionId})).toEqual({
      status: 'cancelled',
    })
    const {detail} = dialog.showMessageBox.mock.calls[0][0]
    expect(detail).toContain('These keys are already public')
    expect(detail).toContain('no private delivery or dispute')
  })

  it('fetches matching public images only when explicitly requested', async () => {
    const jpeg = '0xffd8ffdb00000000ffd9'
    const getExplorer = jest.fn(async (route) => {
      if (route.startsWith('Epoch/')) {
        return {
          result: [
            {cid: PREVIEW_CIDS[0], author: `0x${ADDRESS}`, epoch: 230},
            {cid: PREVIEW_CIDS[1], author: `0x${'f'.repeat(40)}`, epoch: 230},
          ],
        }
      }
      if (route === `Flip/${PREVIEW_CIDS[0]}/Content`) {
        return {result: {pics: [jpeg, jpeg], privateKey: 'never expose'}}
      }
      throw new Error('An unmatched flip must not be fetched.')
    })
    const v7 = service({getExplorer})
    await v7('configure', pins)
    const prepared = await v7('prepare', {
      operation: 'buy',
      offerId: OFFER_ID,
      maxFee: '1000000000000000000',
    })

    const metadata = await v7('preview', {actionId: prepared.actionId})
    expect(metadata.flips.every((flip) => flip.images.length === 0)).toBe(true)
    expect(getExplorer).not.toHaveBeenCalled()

    const preview = await v7('preview', {
      actionId: prepared.actionId,
      includeImages: true,
    })
    expect(preview.count).toBe(2)
    const image = `data:image/jpeg;base64,${Buffer.from(
      jpeg.slice(2),
      'hex'
    ).toString('base64')}`
    expect(preview.flips[0].images).toEqual([image, image])
    expect(preview.flips[1].images).toEqual([])
    expect(JSON.stringify(preview)).not.toContain('never expose')
    expect(getExplorer).toHaveBeenCalledTimes(2)
    expect(calls).toHaveLength(1)
  })

  it('reads the next private bundle and its current price and buyer bond', async () => {
    const v7 = service(marketRpc())
    await v7('configure', pins)

    const next = await v7('nextOffer')
    const price = (10000n * 10n ** 18n + 10n) / 11n
    expect(next).toEqual({
      available: true,
      offerId: CHAIN_OFFER_ID,
      epoch: 230,
      count: 2,
      publicSeed: false,
      saleType: 'first-sale',
      price: price.toString(),
      buyerBond: (5n * 10n ** 18n).toString(),
      total: (price + 5n * 10n ** 18n).toString(),
      bondTopUp: '0',
      blockHeight: 100,
    })
    expect(calls).toHaveLength(0)
  })

  it('shows the public seed without a buyer bond or private order', async () => {
    const v7 = service(marketRpc({publicSeed: true}))
    await v7('configure', pins)

    const next = await v7('nextOffer')
    expect(next.available).toBe(true)
    expect(next.publicSeed).toBe(true)
    expect(next.price).toBe((1000n * 10n ** 18n).toString())
    expect(next.buyerBond).toBe('0')
    expect(next.total).toBe(next.price)
  })

  it('reports an empty queue without selecting another offer', async () => {
    const v7 = service(marketRpc({noHead: true}))
    await v7('configure', pins)
    expect(await v7('nextOffer')).toEqual({available: false})
  })

  it('marks the head unavailable when its seller bond needs a top-up', async () => {
    const v7 = service(marketRpc({sellerBond: 1n}))
    await v7('configure', pins)
    const next = await v7('nextOffer')
    expect(next.available).toBe(true)
    expect(next.bondTopUp).toBe((5n * 10n ** 18n - 1n).toString())
  })

  it('accepts a seller bond equal to the contract minimum', async () => {
    const v7 = service(marketRpc({sellerBond: 5n * 10n ** 18n}))
    await v7('configure', pins)
    expect((await v7('nextOffer')).bondTopUp).toBe('0')
  })

  it('rejects a queue head whose offer record is not queued', async () => {
    const market = marketRpc()
    market.offer[122] = 5
    const v7 = service(market)
    await v7('configure', pins)
    await expect(v7('nextOffer')).rejects.toThrow(
      'does not match the public queue'
    )
  })

  it('resolves the active order only for the matching saved buyer purchase', async () => {
    const market = marketRpc()
    market.offer[122] = 3
    market.offer.writeBigUInt64BE(17n, 114)
    const order = Buffer.alloc(215)
    Buffer.from(CHAIN_OFFER_ID, 'hex').copy(order, 0)
    Buffer.from(ADDRESS, 'hex').copy(order, 32)
    Buffer.from(DELIVERY_KEY, 'hex').copy(order, 52)
    order.writeBigUInt64BE(1n, 173)
    order[181] = 1
    const onRpc = (method, params) =>
      method === 'contract_readData' && params[1] === 'pool/order/17'
        ? `0x${order.toString('hex')}`
        : market.onRpc(method, params)
    const v7 = service({onRpc})
    await v7('configure', pins)
    const prepared = await v7('prepare', {
      operation: 'buy',
      offerId: CHAIN_OFFER_ID,
      maxFee: '1000000000000000000',
    })
    expect(await v7('purchaseOrder', {actionId: prepared.actionId})).toEqual({
      orderId: '17',
      state: 'funded',
    })
    order[52] = 3
    await expect(
      v7('purchaseOrder', {actionId: prepared.actionId})
    ).rejects.toThrow('does not match this saved purchase')
  })

  it('resolves only a funded order for the active seller offer', async () => {
    const market = marketRpc()
    market.offer[122] = 3
    market.offer.writeBigUInt64BE(17n, 114)
    const order = Buffer.alloc(215)
    Buffer.from(CHAIN_OFFER_ID, 'hex').copy(order, 0)
    order[181] = 1
    const onRpc = (method, params) =>
      method === 'contract_readData' && params[1] === 'pool/order/17'
        ? `0x${order.toString('hex')}`
        : market.onRpc(method, params)
    const v7 = service({onRpc})
    await v7('configure', pins)

    expect(await v7('sellerOrder', {offerId: CHAIN_OFFER_ID})).toEqual({
      orderId: '17',
      state: 'funded',
    })
    order[181] = 4
    await expect(v7('sellerOrder', {offerId: CHAIN_OFFER_ID})).rejects.toThrow(
      'does not match this offer'
    )
    order[181] = 1
    order[0] = 0
    await expect(v7('sellerOrder', {offerId: CHAIN_OFFER_ID})).rejects.toThrow(
      'does not match this offer'
    )
    const [firstOfferByte] = Buffer.from(CHAIN_OFFER_ID, 'hex')
    order[0] = firstOfferByte
    market.offer[122] = 1
    await expect(v7('sellerOrder', {offerId: CHAIN_OFFER_ID})).rejects.toThrow(
      'no funded private order'
    )
  })

  it('rejects another seller identity and an order that changes during lookup', async () => {
    const market = marketRpc()
    market.offer[122] = 3
    market.offer.writeBigUInt64BE(17n, 114)
    const otherSeller = service({identity: 'a'.repeat(40), onRpc: market.onRpc})
    await otherSeller('configure', pins)
    await expect(
      otherSeller('sellerOrder', {offerId: CHAIN_OFFER_ID})
    ).rejects.toThrow('does not belong to the active identity')

    const order = Buffer.alloc(215)
    Buffer.from(CHAIN_OFFER_ID, 'hex').copy(order, 0)
    order[181] = 1
    let block = 100
    const onRpc = (method, params) => {
      if (method === 'bcn_syncing')
        return {
          syncing: false,
          wrongTime: false,
          currentBlock: block,
          highestBlock: block,
        }
      if (method === 'contract_readData' && params[1] === 'pool/order/17') {
        block = 101
        return `0x${order.toString('hex')}`
      }
      return market.onRpc(method, params)
    }
    const v7 = service({onRpc})
    await v7('configure', pins)
    await expect(v7('sellerOrder', {offerId: CHAIN_OFFER_ID})).rejects.toThrow(
      'changed while it was read'
    )
  })

  it('previews a public offer before preparation using its pinned on-chain inventory', async () => {
    const offer = Buffer.alloc(222)
    Buffer.from(ADDRESS, 'hex').copy(offer, 0)
    offer.writeUInt16BE(230, 20)
    offer.writeUInt32BE(PREVIEW_CIDS.length, 22)
    Buffer.from(INVENTORY_COMMITMENT, 'hex').copy(offer, 26)
    const inventory = Buffer.concat([
      Buffer.from([PREVIEW_CIDS.length]),
      ...PREVIEW_CIDS.flatMap((cid) => [
        Buffer.from([cid.length]),
        Buffer.from(cid),
      ]),
    ])
    const getExplorer = jest.fn(async (route) =>
      route.startsWith('Epoch/')
        ? {
            result: PREVIEW_CIDS.map((cid) => ({
              cid,
              author: `0x${ADDRESS}`,
              epoch: 230,
            })),
          }
        : {
            result: {
              pics: ['0xffd8ffdb00000000ffd9', '0xffd8ffdb00000000ffd9'],
            },
          }
    )
    const v7 = service({
      getExplorer,
      onRpc: (method, params) => {
        if (method !== 'contract_iterateMap') return undefined
        const bytes = params[1] === 'pool/offer/' ? offer : inventory
        return {
          items: [
            {key: `0x${CHAIN_OFFER_ID}`, value: `0x${bytes.toString('hex')}`},
          ],
          continuationToken: null,
        }
      },
    })
    await v7('configure', pins)

    const preview = await v7('preview', {
      offerId: CHAIN_OFFER_ID,
      includeImages: true,
    })
    expect(preview.count).toBe(2)
    expect(preview.flips).toHaveLength(2)
    expect(preview.flips[0].images[0]).toMatch(/^data:image\/jpeg;base64,/)
    expect(calls).toHaveLength(0)
    expect(getExplorer).toHaveBeenCalledTimes(3)

    inventory[inventory.length - 1] = 'd'.charCodeAt(0)
    await expect(
      v7('preview', {offerId: CHAIN_OFFER_ID, includeImages: true})
    ).rejects.toThrow('offer commitment')
    expect(getExplorer).toHaveBeenCalledTimes(3)
  })

  it('refuses preview if the saved public inventory no longer matches its commitment', async () => {
    const getExplorer = jest.fn()
    const v7 = service({getExplorer})
    await v7('configure', pins)
    const prepared = await v7('prepare', {
      operation: 'buy',
      offerId: OFFER_ID,
      maxFee: '1000000000000000000',
    })
    const file = path.join(
      root,
      'v7',
      'actions',
      ADDRESS,
      prepared.actionId,
      'prepared.json'
    )
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    saved.directSession.manifest = [PREVIEW_CIDS[1]]
    fs.writeFileSync(file, JSON.stringify(saved), {mode: 0o600})

    await expect(
      v7('preview', {actionId: prepared.actionId, includeImages: true})
    ).rejects.toThrow('verified public flip inventory')
    expect(getExplorer).not.toHaveBeenCalled()
  })

  it('opens the saved ciphertext folder without sending the file', async () => {
    const openFolder = jest.fn().mockResolvedValue(true)
    const v7 = service({openFolder})
    await v7('configure', pins)

    expect(
      await v7('privateMessage', {orderId: '17', passphrase: 'vault-key'})
    ).toEqual({
      status: 'saved',
      fileName: 'ciphertext.json',
      folderOpened: true,
    })
    expect(openFolder).toHaveBeenCalledTimes(1)
    expect(calls.map(({args}) => args[0])).toEqual(['direct-v7-dm'])
  })

  it('uses the verified buyer receipt for the same order without selecting it again', async () => {
    const v7 = service()
    await v7('configure', pins)
    const purchase = await v7('prepare', {
      operation: 'buy',
      offerId: OFFER_ID,
      maxFee: '1000000000000000000',
    })
    const verified = await v7('receive', {
      actionId: purchase.actionId,
      orderId: '17',
      passphrase: 'new-buyer-vault',
    })
    expect(verified).toMatchObject({
      status: 'verified',
      usableFlips: 2,
      receiptId: expect.stringMatching(/^v7-receipt-[0-9a-f]{32}$/),
    })
    expect(verified).not.toHaveProperty('receiptPath')

    const dialogsBeforeConfirm = dialog.showOpenDialog.mock.calls.length
    await expect(
      v7('prepare', {
        operation: 'confirm',
        orderId: '18',
        maxFee: '1000000000000000000',
        receiptId: verified.receiptId,
      })
    ).rejects.toThrow('does not match this order and identity')
    const confirm = await v7('prepare', {
      operation: 'confirm',
      orderId: '17',
      maxFee: '1000000000000000000',
      receiptId: verified.receiptId,
    })
    expect(confirm.operation).toBe('confirm')
    expect(dialog.showOpenDialog).toHaveBeenCalledTimes(dialogsBeforeConfirm)
    const confirmArgs = calls.at(-1).args
    expect(confirmArgs[0]).toBe('direct-v7-prepare')
    expect(confirmArgs).toContain('-delivery')
  })

  it('refuses a selected nodekey for another identity before signing', async () => {
    const v7 = service()
    await v7('configure', pins)
    const prepared = await v7('prepare', {
      operation: 'challenge',
      orderId: '17',
      maxFee: '1000000000000000000',
    })
    fs.writeFileSync(keyFile, '2'.repeat(64), {mode: 0o600})
    await expect(v7('submit', {actionId: prepared.actionId})).rejects.toThrow(
      'does not control the active identity'
    )
    expect(calls.map(({args}) => args[0])).toEqual(['direct-v7-prepare'])
    expect(
      fs.existsSync(
        path.join(
          root,
          'v7',
          'actions',
          ADDRESS,
          prepared.actionId,
          'attempt.json'
        )
      )
    ).toBe(false)
  })

  it('refuses a nodekey replaced after the first identity check', async () => {
    let balanceReads = 0
    let replaceOnBalance = false
    const v7 = service({
      onRpc: (method) => {
        if (replaceOnBalance && method === 'dna_getBalance') {
          balanceReads += 1
          if (balanceReads === 2) {
            fs.writeFileSync(keyFile, '2'.repeat(64), {mode: 0o600})
          }
        }
      },
    })
    await v7('configure', pins)
    const prepared = await v7('prepare', {
      operation: 'challenge',
      orderId: '17',
      maxFee: '1000000000000000000',
    })
    replaceOnBalance = true
    await expect(v7('submit', {actionId: prepared.actionId})).rejects.toThrow(
      'Signing stopped'
    )
    expect(balanceReads).toBe(2)
    expect(calls.map(({args}) => args[0])).toEqual(['direct-v7-prepare'])
  })

  it('reserves each identity nonce across actions, restart, and pin changes', async () => {
    let chainNonce = 2
    const getNonce = () => chainNonce
    const v7 = service({getNonce})
    await v7('configure', pins)
    const first = await v7('prepare', {
      operation: 'challenge',
      orderId: '17',
      maxFee: '1000000000000000000',
    })
    const second = await v7('prepare', {
      operation: 'challenge',
      orderId: '18',
      maxFee: '1000000000000000000',
    })
    await v7('submit', {actionId: first.actionId})
    const restarted = service({getNonce})
    await expect(
      restarted('submit', {actionId: second.actionId})
    ).rejects.toThrow('already have a v7 signing attempt')
    expect(calls.filter(({args}) => args[0] === 'submit')).toHaveLength(1)

    const changedPin = {...pins, contract: 'f'.repeat(40)}
    const reconfigured = service({getNonce})
    await reconfigured('configure', changedPin)
    const {actions} = await reconfigured('status')
    expect(
      actions.find(({actionId}) => actionId === first.actionId)
    ).toMatchObject({
      attempted: true,
      pinChanged: true,
    })
    expect(
      await reconfigured('check', {actionId: first.actionId})
    ).toMatchObject({
      status: 'included',
    })
    const third = await reconfigured('prepare', {
      operation: 'challenge',
      orderId: '19',
      maxFee: '1000000000000000000',
    })
    await expect(
      reconfigured('submit', {actionId: third.actionId})
    ).rejects.toThrow('already have a v7 signing attempt')
    expect(calls.filter(({args}) => args[0] === 'submit')).toHaveLength(1)

    chainNonce = 3
    await reconfigured('submit', {actionId: third.actionId})
    expect(calls.filter(({args}) => args[0] === 'submit')).toHaveLength(2)
    chainNonce = 2
    const fourth = await reconfigured('prepare', {
      operation: 'challenge',
      orderId: '20',
      maxFee: '1000000000000000000',
    })
    await expect(
      reconfigured('submit', {actionId: fourth.actionId})
    ).rejects.toThrow('already have a v7 signing attempt')
  })

  it('preserves a reconciled native-transfer nonce reservation across restart', async () => {
    const v7 = service({getNonce: () => 2})
    await v7('configure', pins)
    const journal = path.join(root, 'v7', 'nonce-journal.jsonl')
    const transfer = {
      coinbase: ADDRESS,
      accountNonce: 3,
      actionId: `v7-${'9'.repeat(32)}`,
      contract: 'f'.repeat(40),
      codeHash: '',
      kind: 'native-transfer',
      txHash: TX_HASH.slice(2),
    }
    fs.appendFileSync(journal, `${JSON.stringify(transfer)}\n`)
    const restarted = service({getNonce: () => 2})
    expect((await restarted('status')).configured).toBe(true)
    const prepared = await restarted('prepare', {
      operation: 'challenge',
      orderId: '17',
      maxFee: '1000000000000000000',
    })
    await expect(
      restarted('submit', {actionId: prepared.actionId})
    ).rejects.toThrow('already have a v7 signing attempt')
    expect(calls.filter(({args}) => args[0] === 'submit')).toHaveLength(0)
    for (const invalid of [
      {...transfer, kind: undefined, txHash: undefined},
      {...transfer, txHash: ''},
      {...transfer, kind: 'unknown'},
      {...transfer, codeHash: CODE_HASH},
    ]) {
      fs.writeFileSync(
        journal,
        `fod.v7.nonce-journal/1\n${JSON.stringify(invalid)}\n`
      )
      await expect(restarted('status')).rejects.toThrow(
        'nonce journal is invalid'
      )
    }
  })

  it('fails closed when the durable nonce journal is missing or damaged', async () => {
    const v7 = service()
    await v7('configure', pins)
    const prepared = await v7('prepare', {
      operation: 'challenge',
      orderId: '17',
      maxFee: '1000000000000000000',
    })
    const journal = path.join(root, 'v7', 'nonce-journal.jsonl')
    fs.unlinkSync(journal)
    await expect(v7('submit', {actionId: prepared.actionId})).rejects.toThrow()
    expect(calls.map(({args}) => args[0])).toEqual(['direct-v7-prepare'])
    fs.writeFileSync(journal, 'partial', {mode: 0o600})
    await expect(v7('submit', {actionId: prepared.actionId})).rejects.toThrow()
    expect(calls.map(({args}) => args[0])).toEqual(['direct-v7-prepare'])
  })

  it('imports an older saved signing attempt before enabling another call', async () => {
    const v7 = service()
    await v7('configure', pins)
    const first = await v7('prepare', {
      operation: 'challenge',
      orderId: '17',
      maxFee: '1000000000000000000',
    })
    await v7('submit', {actionId: first.actionId})
    const configPath = path.join(root, 'v7', 'config.json')
    const legacyConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    delete legacyConfig.nonceGuardVersion
    fs.writeFileSync(configPath, JSON.stringify(legacyConfig), {mode: 0o600})
    fs.unlinkSync(path.join(root, 'v7', 'nonce-journal.jsonl'))
    const restarted = service()
    expect((await restarted('status')).configured).toBe(true)
    const second = await restarted('prepare', {
      operation: 'challenge',
      orderId: '18',
      maxFee: '1000000000000000000',
    })
    await expect(
      restarted('submit', {actionId: second.actionId})
    ).rejects.toThrow('already have a v7 signing attempt')
    expect(calls.filter(({args}) => args[0] === 'submit')).toHaveLength(1)
  })

  it('keeps a sign attempt and never launches the CLI when marker sync fails', async () => {
    const v7 = service()
    await v7('configure', pins)
    const prepared = await v7('prepare', {
      operation: 'challenge',
      orderId: '17',
      maxFee: '1000000000000000000',
    })
    const actionDir = path.join(
      root,
      'v7',
      'actions',
      ADDRESS,
      prepared.actionId
    )
    const syncTarget =
      process.platform === 'win32'
        ? path.join(actionDir, 'attempt.guard')
        : actionDir
    const originalOpen = fs.promises.open.bind(fs.promises)
    const fsWithFailedSync = {
      ...fs,
      promises: {
        ...fs.promises,
        open: async (file, ...args) => {
          const handle = await originalOpen(file, ...args)
          if (file !== syncTarget) return handle
          return {
            stat: () => handle.stat(),
            write: (...values) => handle.write(...values),
            sync: async () => {
              throw new Error('attempt sync failed')
            },
            close: () => handle.close(),
          }
        },
      },
    }
    await expect(
      service({fsImpl: fsWithFailedSync})('submit', {
        actionId: prepared.actionId,
      })
    ).rejects.toThrow('attempt sync failed')
    expect(calls.map(({args}) => args[0])).toEqual(['direct-v7-prepare'])
    await expect(v7('submit', {actionId: prepared.actionId})).rejects.toThrow(
      'already had a signing attempt'
    )
  })

  if (process.platform === 'win32') {
    it('refuses a prepared action whose durable signing guard is missing', async () => {
      const v7 = service()
      await v7('configure', pins)
      const prepared = await v7('prepare', {
        operation: 'challenge',
        orderId: '17',
        maxFee: '1000000000000000000',
      })
      fs.unlinkSync(
        path.join(
          root,
          'v7',
          'actions',
          ADDRESS,
          prepared.actionId,
          'attempt.guard'
        )
      )
      await expect(
        v7('submit', {actionId: prepared.actionId})
      ).rejects.toThrow()
      expect(calls.map(({args}) => args[0])).toEqual(['direct-v7-prepare'])
    })

    it('does not repeat a Windows signing attempt if its new marker is lost', async () => {
      const v7 = service()
      await v7('configure', pins)
      const prepared = await v7('prepare', {
        operation: 'challenge',
        orderId: '17',
        maxFee: '1000000000000000000',
      })
      await v7('submit', {actionId: prepared.actionId})
      fs.unlinkSync(
        path.join(
          root,
          'v7',
          'actions',
          ADDRESS,
          prepared.actionId,
          'attempt.json'
        )
      )
      await expect(v7('submit', {actionId: prepared.actionId})).rejects.toThrow(
        'already had a signing attempt'
      )
      expect(calls.map(({args}) => args[0])).toEqual([
        'direct-v7-prepare',
        'submit',
      ])
    })
  }

  it('supplies a vault passphrase when preparing a private listing', async () => {
    const v7 = service()
    await v7('configure', pins)
    await v7('prepare', {
      operation: 'list',
      maxFee: '1000000000000000000',
      passphrase: 'local-test-passphrase',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].hasPassphrase).toBe(true)
    expect(calls[0].args).not.toContain('-broadcast')
  })
})
