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
const TX_HASH = `0x${'e'.repeat(64)}`
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
      if (args[0] === 'direct-v7-prepare') {
        const operation = args[args.indexOf('-operation') + 1]
        const contract = args[args.indexOf('-contract') + 1]
        fs.writeFileSync(
          args[args.indexOf('-prepared') + 1],
          JSON.stringify({
            format: `fod.prepared-direct-v7-${operation}`,
            operation,
            directVersion: 7,
            version: 1,
            network: 'idena',
            contract,
            codeHash: CODE_HASH,
            directOfferId: OFFER_ID,
            amount: '0',
          }),
          {mode: 0o600}
        )
      } else if (args[0] === 'submit') {
        const contract = args[args.indexOf('-contract') + 1]
        fs.writeFileSync(
          args[args.indexOf('-signed') + 1],
          JSON.stringify({
            format: 'fod.submitted-transaction',
            version: 1,
            network: 'idena',
            contract,
            operation: 'challenge',
            amount: '0',
            maxFee: '1000000000000000000',
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
    onRpc,
  } = {}) {
    return createFodV7Service({
      fs: fsImpl,
      dialog,
      spawn: fakeSpawn(calls),
      root: path.join(root, 'v7'),
      getNodeRpcConnection: () =>
        connection || {url: 'http://127.0.0.1:9009', key: 'local-key'},
      getActiveCoinbase: async () => `0x${ADDRESS}`,
      rpcCall: async (_connection, {method}) => {
        await onRpc?.(method)
        const results = {
          bcn_syncing: {
            syncing: false,
            wrongTime: false,
            currentBlock: 100,
            highestBlock: 100,
          },
          contract_getStake: {Hash: stakeHash || `0x${CODE_HASH}`},
          dna_getCoinbaseAddr: `0x${ADDRESS}`,
          dna_getBalance: {
            balance: '10',
            nonce: getNonce(),
            mempoolNonce: getNonce(),
          },
          dna_epoch: {epoch: 230},
          bcn_txReceipt: {success: true},
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
