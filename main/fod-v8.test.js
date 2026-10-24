/** @jest-environment node */
const fs = require('fs')
const os = require('os')
const path = require('path')
const {createBondedMarket} = require('./fod-v8')

const WHO = 'a'.repeat(40)
const CONTRACT = 'b'.repeat(40)
const PIN = 'c'.repeat(64)
const BUNDLE = 'd'.repeat(64)
const PUBLIC_KEY = `04${'1'.repeat(128)}`
async function fixture({badDelivery = false, version = 8} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fod-v8-test-'))
  const actions = path.join(root, 'actions', WHO)
  fs.mkdirSync(actions, {recursive: true, mode: 0o700})
  const saved = path.join(actions, `v7-${'1'.repeat(32)}`)
  fs.mkdirSync(saved, {mode: 0o700})
  fs.writeFileSync(
    path.join(saved, 'prepared.json'),
    JSON.stringify({
      format: `fod.prepared-bonded-v${version}-queueBuy`,
      contract: CONTRACT,
      codeHash: PIN,
      bondedV8: {caller: WHO, deliveryKey: PUBLIC_KEY},
    }),
    {mode: 0o600}
  )
  fs.writeFileSync(path.join(saved, 'delivery.key'), 'private test key', {
    mode: 0o600,
  })
  const tradeDir = path.join(root, 'bonded', CONTRACT, WHO, 'trade-1')
  fs.mkdirSync(tradeDir, {recursive: true, mode: 0o700})
  fs.writeFileSync(path.join(tradeDir, 'retained.json'), '{}', {mode: 0o600})
  const calls = []
  const config = {contract: CONTRACT, codeHash: PIN}
  const market = {
    version,
    contract: CONTRACT,
    codeHash: PIN,
    identity: WHO,
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
    trades: [
      {
        id: '1',
        bundle: BUNDLE,
        buyer: WHO,
        seller: 'e'.repeat(40),
        deliveryKey: PUBLIC_KEY,
        ciphertextHash: 'f'.repeat(64),
        state: 3,
        proveBy: 200,
      },
    ],
  }
  const keyFile = path.join(root, 'identity.key')
  fs.writeFileSync(keyFile, '1'.repeat(64), {mode: 0o600})
  const hooks = {
    marketVersion: version,
    fs,
    root,
    dialog: {
      showMessageBox: jest.fn(async () => ({response: 1})),
      showOpenDialog: jest.fn(async () => ({filePaths: [keyFile]})),
    },
    configOrNull: async () => config,
    configure: jest.fn(),
    context: async () => ({
      coinbase: WHO,
      rpc: async (method) => (method === 'bcn_feePerGas' ? '1' : {}),
    }),
    privateDirectory: async (_, dir) => {
      fs.mkdirSync(dir, {recursive: true, mode: 0o700})
      return dir
    },
    privateJSON: async (_, file) => JSON.parse(fs.readFileSync(file, 'utf8')),
    writePrivateFile: async (_, file, text) =>
      fs.writeFileSync(file, text, {mode: 0o600}),
    actionDirectory: async () => actions,
    syncActionDirectories: async () => {},
    listActions: async () => [],
    preparedSummary: (p) => ({operation: p.operation, amount: p.amount}),
    submit: jest.fn(async () => ({status: 'included'})),
    check: jest.fn(),
    nodekeyAddress: () => WHO,
    readPrivateSelectedFile: async (_, file) => ({data: fs.readFileSync(file)}),
    withCLI: async (_, initial, passphrase, command) => {
      const args = await command({tempDir: root, rpcFlags: []})
      const kind = args[args.indexOf('-command') + 1]
      const out = args[args.indexOf('-out') + 1]
      const request = args.includes('-request')
        ? JSON.parse(
            fs.readFileSync(args[args.indexOf('-request') + 1], 'utf8')
          )
        : null
      calls.push({kind, request, passphrase: Boolean(passphrase)})
      if (kind === 'receive' && badDelivery)
        throw new Error('Key verification failed.')
      if (kind === 'status') fs.writeFileSync(out, JSON.stringify(market))
      if (kind === 'receive') fs.writeFileSync(out, 'encrypted vault')
      if (kind === 'preview')
        fs.writeFileSync(
          out,
          JSON.stringify({
            trade: '1',
            epoch: 233,
            count: 1,
            flips: [
              {
                cid: 'fixture-cid',
                images: Array(4).fill('data:image/jpeg;base64,YQ=='),
                orders: [
                  [0, 1, 2, 3],
                  [3, 2, 1, 0],
                ],
                secret: 'must not reach renderer',
              },
            ],
            deliveryKeyFile: 'must not reach renderer',
          })
        )
      if (kind === 'prepare')
        fs.writeFileSync(
          out,
          JSON.stringify({
            operation: request.operation,
            amount: '1',
            estimatedMaxFee: '1000',
            bondedV8: request,
          })
        )
    },
  }
  return {
    run: createBondedMarket(hooks),
    hooks,
    calls,
    config,
    market,
    root,
    cleanup: () => fs.rmSync(root, {recursive: true, force: true}),
  }
}
it('does not sign during status checks or without a local automation grant', async () => {
  const f = await fixture()
  try {
    await f.run('status')
    await f.run('tick')
    expect(f.hooks.submit).not.toHaveBeenCalled()
  } finally {
    f.cleanup()
  }
})
it('keeps market reads available at live fee rates and uses the simulated action fee', async () => {
  const f = await fixture()
  try {
    const oldContext = f.hooks.context
    f.hooks.context = async () => ({
      ...(await oldContext()),
      rpc: async (method) =>
        method === 'bcn_feePerGas' ? '98000000000000' : {},
    })
    const run = createBondedMarket(f.hooks)
    expect((await run('status')).configured).toBe(true)
    const action = await run('prepare', {
      operation: 'accept',
      id: '1',
      passphrase: 'a private test passphrase',
    })
    expect(action.maxFee).toBe('1000')
    expect(f.hooks.submit).not.toHaveBeenCalled()
  } finally {
    f.cleanup()
  }
})
it('accepts automatically only after local verification and vault persistence', async () => {
  const f = await fixture()
  try {
    await f.run('unlock', {passphrase: 'a private test passphrase'})
    await f.run('tick')
    expect(
      f.calls.filter((c) => c.kind !== 'status').map((c) => c.kind)
    ).toEqual(['receive', 'prepare'])
    expect(f.calls.find((c) => c.kind === 'receive').passphrase).toBe(true)
    expect(
      fs.existsSync(
        path.join(f.root, 'bonded', CONTRACT, WHO, 'trade-1', 'received.vault')
      )
    ).toBe(true)
    expect(f.hooks.submit).toHaveBeenCalledTimes(1)
    const [, grant] = f.hooks.submit.mock.calls[0]
    expect(grant.coinbase).toBe(WHO)
    expect(grant.operations.has('queueBuy')).toBe(false)
    expect(grant.operations.has('withdrawStake')).toBe(false)
    expect(grant.operations.has('challenge')).toBe(false)
    await f.run('stop')
    await f.run('tick')
    expect(f.hooks.submit).toHaveBeenCalledTimes(1)
  } finally {
    f.cleanup()
  }
})
it('does not accept or dispute if local verification fails', async () => {
  const f = await fixture({badDelivery: true})
  try {
    await f.run('unlock', {passphrase: 'a private test passphrase'})
    await f.run('tick')
    expect(f.hooks.submit).not.toHaveBeenCalled()
    expect(f.calls.some((c) => c.kind === 'prepare')).toBe(false)
  } finally {
    f.cleanup()
  }
})
it('waits for uncertain transactions and continues after their receipt is confirmed', async () => {
  const f = await fixture()
  try {
    f.hooks.listActions = async () => [
      {actionId: 'pending', attempted: true, submitted: {status: 'uncertain'}},
    ]
    const run = createBondedMarket(f.hooks)
    f.hooks.check
      .mockResolvedValueOnce({status: 'uncertain'})
      .mockResolvedValueOnce({status: 'included'})
    await run('unlock', {passphrase: 'a private test passphrase'})
    await run('tick')
    await run('tick')
    expect(f.hooks.submit).not.toHaveBeenCalled()
    await run('tick')
    expect(f.hooks.check).toHaveBeenCalledTimes(2)
    expect(f.hooks.submit).toHaveBeenCalledTimes(1)
  } finally {
    f.cleanup()
  }
})
it('rejects renderer-supplied paths, calldata, automatic grants, and amount overflow', async () => {
  const f = await fixture()
  try {
    for (const field of [
      'retainedFile',
      'calldata',
      'deliveryKeyFile',
      'automatic',
    ])
      await expect(
        f.run('prepare', {operation: 'accept', [field]: 'injected'})
      ).rejects.toThrow('Invalid market request')
    await expect(
      f.run('prepare', {
        operation: 'depositStake',
        amount: (2n ** 128n).toString(),
        target: '1',
      })
    ).rejects.toThrow('valid amount')
    expect(f.hooks.submit).not.toHaveBeenCalled()
  } finally {
    f.cleanup()
  }
})

it('rejects expired, changed-pin, price-moved and undercollateralized one-click orders before signing', async () => {
  const f = await fixture()
  const terms = {side: 'buy', quote: '100'}
  try {
    await expect(f.run('trade', terms)).rejects.toThrow('Enable one-click')
    await f.run('unlock', {
      passphrase: 'a private test passphrase',
      perTrade: '200',
      purchaseBudget: '500',
    })
    await expect(f.run('trade', {...terms, calldata: 'bad'})).rejects.toThrow(
      'Invalid market'
    )
    f.market.buyQuote = '106'
    await expect(f.run('trade', terms)).rejects.toThrow('price moved')
    f.market.buyQuote = '100'
    f.market.account.reserved = '900'
    await expect(f.run('trade', terms)).rejects.toThrow('already committed')
    f.market.account.reserved = '0'
    f.market.account.needsTopup = true
    await expect(f.run('trade', terms)).rejects.toThrow('Restore')
    f.market.account.needsTopup = false
    const clock = jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + 9 * 3600000)
    try {
      await expect(f.run('trade', terms)).rejects.toThrow('Enable one-click')
    } finally {
      clock.mockRestore()
    }
    f.config.codeHash = 'f'.repeat(64)
    await expect(f.run('trade', terms)).rejects.toThrow('Enable one-click')
    await f.run('stop')
    expect(f.hooks.submit).not.toHaveBeenCalled()
  } finally {
    f.cleanup()
  }
})
it('blocks new orders during an uncertain transaction and forbids partial or committed withdrawals', async () => {
  const f = await fixture()
  try {
    f.hooks.listActions = async () => [
      {actionId: 'pending', attempted: true, submitted: {status: 'uncertain'}},
    ]
    const run = createBondedMarket(f.hooks)
    await run('unlock', {
      passphrase: 'a private test passphrase',
      perTrade: '200',
      purchaseBudget: '500',
    })
    await expect(run('trade', {side: 'buy', quote: '100'})).rejects.toThrow(
      'previous transaction'
    )
    await expect(
      run('prepare', {operation: 'withdrawStake', amount: '10', exit: false})
    ).rejects.toThrow('full deposit')
    f.market.account.reserved = '10'
    await expect(
      run('prepare', {operation: 'withdrawStake', amount: '1000', exit: true})
    ).rejects.toThrow('full deposit')
    expect(f.hooks.submit).not.toHaveBeenCalled()
  } finally {
    f.cleanup()
  }
})
it('lets a settled penalized account prepare a full exit without requiring a refill', async () => {
  const f = await fixture()
  try {
    f.market.account.needsTopup = true
    f.market.account.balance = '900'
    f.market.trades = []
    const prepared = await f.run('prepare', {
      operation: 'withdrawStake',
      amount: '900',
      exit: true,
    })
    expect(prepared.operation).toBe('withdrawStake')
    expect(f.hooks.submit).not.toHaveBeenCalled()
  } finally {
    f.cleanup()
  }
})

it('v9 verifies delivery locally and never auto-generates or submits a dispute proof', async () => {
  const f = await fixture({version: 9})
  try {
    await f.run('unlock', {passphrase: 'a private test passphrase'})
    await f.run('tick')
    expect(
      f.calls.filter((c) => c.kind !== 'status').map((c) => c.kind)
    ).toEqual(['receive', 'prepare'])
    expect(
      f.calls.find((c) => c.kind === 'prepare').request.protocolVersion
    ).toBe(9)
    expect(f.hooks.submit).toHaveBeenCalledTimes(1)
    await expect(
      f.run('prepare', {operation: 'registerBundle'})
    ).rejects.toThrow('Unsupported')
    f.market.trades[0].state = 4
    await f.run('tick')
    expect(f.calls.some((c) => c.request?.operation === 'proveDelivery')).toBe(
      false
    )
    expect(
      f.calls
        .filter((c) => c.kind === 'prepare')
        .every((c) => c.request.operation === 'accept')
    ).toBe(true)
  } finally {
    f.cleanup()
  }
})
it('v9 refuses a v8 snapshot before any trade', async () => {
  const f = await fixture({version: 9})
  try {
    f.market.version = 8
    await expect(f.run('status')).rejects.toThrow('snapshot')
    expect(f.hooks.submit).not.toHaveBeenCalled()
  } finally {
    f.cleanup()
  }
})

it('opens completed purchased flips read-only with the saved buyer key and no password', async () => {
  const f = await fixture({version: 9})
  try {
    f.market.trades[0].state = 5
    f.market.bundles = [{id: BUNDLE, epoch: 233, cids: ['fixture-cid']}]
    const preview = await f.run('purchasedPreview', {id: '1'})
    expect(preview.count).toBe(1)
    expect(preview.flips[0].orders).toEqual([
      [0, 1, 2, 3],
      [3, 2, 1, 0],
    ])
    expect(preview.deliveryKeyFile).toBeUndefined()
    expect(preview.flips[0].secret).toBeUndefined()
    expect(f.calls.find((c) => c.kind === 'preview')).toMatchObject({
      passphrase: false,
      request: {operation: 'preview', caller: WHO},
    })
    expect(f.hooks.submit).not.toHaveBeenCalled()
    expect(
      fs.readdirSync(path.join(f.root, 'bonded', CONTRACT, WHO, 'trade-1'))
    ).toEqual(['retained.json'])
    f.market.bundles[0].cids = ['wrong-cid']
    await expect(f.run('purchasedPreview', {id: '1'})).rejects.toThrow(
      'could not be verified'
    )
    f.market.trades[0].state = 3
    await expect(f.run('purchasedPreview', {id: '1'})).rejects.toThrow(
      'completed purchases'
    )
    f.market.trades[0].state = 5
    f.market.trades[0].buyer = 'f'.repeat(40)
    await expect(f.run('purchasedPreview', {id: '1'})).rejects.toThrow(
      'completed purchases'
    )
    await expect(
      f.run('purchasedPreview', {id: '1', deliveryKeyFile: 'arbitrary'})
    ).rejects.toThrow('Invalid market request')
  } finally {
    f.cleanup()
  }
})
