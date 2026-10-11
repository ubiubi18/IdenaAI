/** @jest-environment node */

const {EventEmitter} = require('events')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {PassThrough} = require('stream')
const {
  createFodDirectCheckService,
  createFodDirectReceiveService,
} = require('./fod-direct-check')

const CONTRACT = 'e86d31069194690b1a818f24912bafdacfb29f19'
const CODE_HASH =
  '0x9ee10f3588bd403460ff6149016a3e4544df5c2ef02f6e6123a5cd75588f3319'
const AUTHOR = 'a'.repeat(40)
const BUYER = 'b'.repeat(40)
const CIPHERTEXT = 'c'.repeat(438)
const ORDER_ID = '18446744073709551615'

function messageText(orderId = ORDER_ID) {
  const text = JSON.stringify({
    format: 'fod.direct-delivery',
    version: 2,
    network: 'idena',
    contract: CONTRACT,
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

function resultText(orderId = ORDER_ID, author = AUTHOR) {
  return `{"format":"fod.direct-check","version":1,"contract":"${CONTRACT}","orderId":${orderId},"author":"${author}","epoch":230,"usableFlips":3}`
}

function receiptText(orderId = ORDER_ID, author = AUTHOR) {
  const text = JSON.stringify({
    format: 'fod.opened-direct-delivery',
    version: 1,
    contract: CONTRACT,
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
        const outPath = args[args.indexOf('-out') + 1]
        if (args[0] === 'direct-receive') {
          fs.writeFileSync(args[args.indexOf('-vault') + 1], 'age-encrypted', {
            mode: vaultMode,
          })
        }
        fs.writeFileSync(outPath, result, {mode: resultMode})
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
    })
  }

  it('uses fixed flags, private copies, stdin, and returns only a public summary', async () => {
    const child = fakeSpawn()
    const check = service({spawn: child.spawn})
    const summary = await check({message: messageText()})
    const [{binary, args, options, body}] = child.calls
    const purchaseCopy = args[args.indexOf('-purchase') + 1]
    const keyCopy = args[args.indexOf('-delivery-key') + 1]
    const rpcKeyFile = args[args.indexOf('-key-file') + 1]
    const outPath = args[args.indexOf('-out') + 1]

    expect(binary).toBe(process.execPath)
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
      orderId: ORDER_ID,
      author: `0x${AUTHOR}`,
      epoch: 230,
      usableFlips: 3,
      vaultPath,
    })
    expect(JSON.stringify(summary)).not.toContain('RPC_SECRET')
    expect(JSON.stringify(summary)).not.toContain(CIPHERTEXT)
    expect(JSON.stringify(summary)).not.toContain(passphrase)
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
