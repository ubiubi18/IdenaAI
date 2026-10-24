/* global BigInt */
/* eslint-disable no-continue */
const {randomBytes, createECDH} = require('crypto')
const path = require('path')

const ATOMS = 10n ** 18n
const HEX32 = /^[0-9a-f]{64}$/
const ID = /^[1-9][0-9]{0,19}$/
const SIMPLE = new Set([
  'depositStake',
  'withdrawStake',
  'addReserve',
  'queueSell',
  'queueBuy',
  'cancelSell',
  'cancelBuy',
  'acquire',
  'matchNext',
  'ready',
  'deliver',
  'accept',
  'challenge',
  'expireTrade',
  'registerBundle',
  'proveDelivery',
])
const AUTOMATIC = new Set([
  'ready',
  'deliver',
  'accept',
  'matchNext',
  'acquire',
])
function fail(message) {
  throw new Error(message)
}
function amount(value, allowZero = false) {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]*)$/.test(value) ||
    BigInt(value) >= 2n ** 128n ||
    (!allowZero && value === '0')
  )
    fail('Enter a valid amount.')
  return value
}
function id(value) {
  if (
    typeof value !== 'string' ||
    !ID.test(value) ||
    BigInt(value) >= 2n ** 64n
  )
    fail('Invalid order.')
  return value
}
function validatePayload(payload, fields) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.keys(payload).some((key) => !fields.includes(key))
  )
    fail('Invalid market request.')
}
function createBondedMarket(h) {
  const version = h.marketVersion === 9 ? 9 : 8
  const {
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
    preparedSummary,
    submit,
    check,
    listActions,
    nodekeyAddress,
    readPrivateSelectedFile,
    readAction,
  } = h
  let automatic = null
  let lastWorkerMessage = ''
  const epochVaults = new Map()
  function validGrant(c, initial) {
    return Boolean(
      automatic &&
        automatic.expires > Date.now() &&
        automatic.coinbase === initial.coinbase &&
        automatic.contract === c.contract &&
        automatic.codeHash === c.codeHash
    )
  }
  async function config() {
    const c = await configOrNull()
    if (!c) fail('The bonded market has not been activated.')
    return c
  }
  async function base(c, initial) {
    return privateDirectory(
      fs,
      path.join(root, 'bonded', c.contract, initial.coinbase)
    )
  }
  async function cli(
    c,
    initial,
    command,
    request,
    output,
    passphrase = '',
    maxFee = ''
  ) {
    await withCLI(c, initial, passphrase, async ({tempDir, rpcFlags}) => {
      const args = [
        `v${version}`,
        '-command',
        command,
        ...rpcFlags,
        '-contract',
        c.contract,
        '-code-hash',
        c.codeHash,
        '-out',
        output,
      ]
      if (request) {
        const file = path.join(tempDir, 'request.json')
        await writePrivateFile(
          fs,
          file,
          JSON.stringify({
            ...request,
            ...(version === 9 ? {protocolVersion: 9} : {}),
          })
        )
        args.push('-request', file)
      }
      if (maxFee) args.push('-max-fee', maxFee)
      return args
    })
  }
  async function snapshot(c, initial) {
    const directory = await base(c, initial)
    const output = path.join(
      directory,
      `snapshot-${randomBytes(8).toString('hex')}.json`
    )
    try {
      await cli(c, initial, 'status', null, output)
      const data = await privateJSON(fs, output, 4 * 1024 * 1024)
      if (
        data.version !== version ||
        data.identity !== initial.coinbase ||
        data.contract !== c.contract ||
        data.codeHash !== c.codeHash
      )
        fail('The market snapshot does not match the active identity.')
      return data
    } finally {
      await fs.promises.rm(output, {force: true})
    }
  }
  async function status() {
    const c = await configOrNull()
    if (!c) return {configured: false, version, automatic: false}
    const initial = await context(c)
    const market = await snapshot(c, initial)
    if (version === 9) await addLocalPackages(c, initial, market)
    const rate = BigInt(await initial.rpc('bcn_feePerGas', []))
    if (rate <= 0n) fail('Network fee unavailable.')
    const identity = await initial.rpc('dna_identity', [
      `0x${initial.coinbase}`,
    ])
    const epoch = await initial.rpc('dna_epoch', [])
    const wallet = await initial.rpc('dna_getBalance', [
      `0x${initial.coinbase}`,
    ])
    return {
      configured: true,
      market,
      currentFlips: Array.isArray(identity?.flips) ? identity.flips.length : 0,
      currentEpoch: epoch?.epoch,
      walletBalance: wallet?.balance,
      automatic: validGrant(c, initial),
      trading:
        validGrant(c, initial) && automatic.orderLimits
          ? {
              perTrade: automatic.orderLimits.perTrade.toString(),
              purchaseRemaining:
                automatic.orderLimits.purchaseRemaining.toString(),
              feeRemaining: automatic.remainingFee.toString(),
              expires: automatic.expires,
            }
          : null,
      vaultBundles: [...epochVaults.keys()]
        .filter((key) => key.startsWith(`${c.contract}:${initial.coinbase}:`))
        .map((key) => key.split(':')[2]),
      workerMessage: lastWorkerMessage,
      actions: (await listActions(c, initial.coinbase, initial.rpc)).filter(
        (a) => !a.pinChanged
      ),
    }
  }
  async function choose(title, privateOnly = false, max = 4 * 1024 * 1024) {
    const result = await dialog.showOpenDialog({
      title,
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths?.length !== 1)
      fail('File selection cancelled.')
    const file = result.filePaths[0]
    const selected = await readPrivateSelectedFile(
      fs,
      file,
      max,
      privateOnly,
      true
    )
    return {file, data: selected.data}
  }
  async function importProfile() {
    const chosen = await choose(
      'Choose the independently reviewed market connection'
    )
    let profile
    try {
      profile = JSON.parse(chosen.data.toString('utf8'))
    } finally {
      chosen.data.fill(0)
    }
    validatePayload(profile, [
      'contract',
      'codeHash',
      'binaryPath',
      'binarySha256',
    ])
    await configure(profile)
    automatic = null
    return status()
  }
  async function addLocalPackages(c, initial, market) {
    const directory = await base(c, initial)
    const names = await fs.promises.readdir(directory)
    for (const name of names.filter((n) =>
      /^package-[0-9a-f]{64}\.json$/.test(n)
    )) {
      const saved = await privateJSON(
        fs,
        path.join(directory, name),
        2 * 1024 * 1024
      )
      if (
        saved.protocolVersion !== 9 ||
        saved.caller !== initial.coinbase ||
        !HEX32.test(saved.bundle || '') ||
        name !== `package-${saved.bundle}.json`
      )
        fail('Invalid saved package.')
      const j = Buffer.from(saved.journal || '', 'hex')
      if (
        j.length !== 273 ||
        j.subarray(36, 56).toString('hex') !== c.contract ||
        j.subarray(56, 76).toString('hex') !== initial.coinbase
      )
        fail('Saved package belongs to another market.')
      epochVaults.set(
        `${c.contract}:${initial.coinbase}:${saved.bundle}`,
        saved.vaultFile
      )
      if (!market.bundles.some((b) => b.id === saved.bundle))
        market.bundles.push({
          id: saved.bundle,
          author: initial.coinbase,
          epoch: j.readUInt16BE(76),
          count: j.readUInt16BE(78),
          sale: '0',
          used: false,
          local: true,
        })
    }
  }
  async function importPackage(payload) {
    validatePayload(payload, ['passphrase'])
    if (version !== 9)
      fail('Direct package import needs the optimistic market.')
    const c = await config()
    const initial = await context(c)
    const session = await choose(
      'Choose the captured validation session',
      true,
      8 * 1024 * 1024
    )
    const vault = await choose('Choose the encrypted epoch key vault', true)
    const directory = await base(c, initial)
    const input = path.join(
      directory,
      `session-${randomBytes(8).toString('hex')}.json`
    )
    const output = path.join(
      directory,
      `listing-${randomBytes(8).toString('hex')}.json`
    )
    try {
      await writePrivateFile(fs, input, session.data)
      await cli(
        c,
        initial,
        'listing',
        {
          operation: 'queueSell',
          caller: initial.coinbase,
          sessionFile: input,
          vaultFile: vault.file,
        },
        output,
        payload.passphrase || ''
      )
      const listing = await privateJSON(fs, output, 2 * 1024 * 1024)
      if (!HEX32.test(listing.bundle || '')) fail('Invalid verified package.')
      const destination = path.join(directory, `package-${listing.bundle}.json`)
      try {
        const old = await privateJSON(fs, destination, 2 * 1024 * 1024)
        if (
          old.journal !== listing.journal ||
          old.sessionWire !== listing.sessionWire
        )
          fail('A different original package is already saved.')
      } catch (e) {
        if (e.code !== 'ENOENT') throw e
        await writePrivateFile(fs, destination, JSON.stringify(listing))
      }
    } finally {
      session.data.fill(0)
      vault.data.fill(0)
      await fs.promises.rm(output, {force: true})
    }
    return status()
  }
  async function chooseVault(payload) {
    validatePayload(payload, ['bundle'])
    if (!HEX32.test(payload.bundle || '')) fail('Invalid bundle.')
    const c = await config()
    const initial = await context(c)
    const market = await snapshot(c, initial)
    if (version === 9) await addLocalPackages(c, initial, market)
    if (
      !market.bundles.some(
        (b) => b.id === payload.bundle && b.author === initial.coinbase
      )
    )
      fail('This bundle does not belong to the active identity.')
    const selected = await choose(
      'Choose this epoch key vault once for this session',
      true
    )
    selected.data.fill(0)
    epochVaults.set(
      `${c.contract}:${initial.coinbase}:${payload.bundle}`,
      selected.file
    )
    return {selected: true}
  }
  async function tradeDirectory(c, initial, tradeId) {
    return privateDirectory(
      fs,
      path.join(await base(c, initial), `trade-${id(tradeId)}`)
    )
  }
  async function buyerKeyFor(c, initial, trade) {
    const entries = await fs.promises.readdir(
      await actionDirectory(initial.coinbase),
      {withFileTypes: true}
    )
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^v7-[0-9a-f]{32}$/.test(entry.name))
        continue
      const dir = path.join(await actionDirectory(initial.coinbase), entry.name)
      let p
      try {
        p = await privateJSON(
          fs,
          path.join(dir, 'prepared.json'),
          20 * 1024 * 1024
        )
      } catch {
        continue
      }
      if (
        p.format === `fod.prepared-bonded-v${version}-queueBuy` &&
        p.contract === c.contract &&
        p.codeHash === c.codeHash &&
        p.bondedV8?.caller === initial.coinbase &&
        p.bondedV8.deliveryKey === trade.deliveryKey
      )
        return path.join(dir, 'delivery.key')
    }
    fail('The private delivery key for this order is unavailable.')
  }
  async function purchasedPreview(payload) {
    validatePayload(payload, ['id'])
    const tradeId = id(payload.id)
    const c = await config()
    const initial = await context(c)
    const market = await snapshot(c, initial)
    const trade = market.trades.find((t) => t.id === tradeId)
    if (!trade || trade.buyer !== initial.coinbase || trade.state !== 5)
      fail('Only your completed purchases can be viewed.')
    const bundle = market.bundles.find((b) => b.id === trade.bundle)
    if (!bundle || !bundle.cids?.length || bundle.cids.length > 64)
      fail('The purchased inventory is unavailable.')
    const directory = await tradeDirectory(c, initial, tradeId)
    const output = path.join(
      directory,
      `preview-${randomBytes(16).toString('hex')}.json`
    )
    try {
      await cli(
        c,
        initial,
        'preview',
        {
          operation: 'preview',
          caller: initial.coinbase,
          id: tradeId,
          retainedFile: path.join(directory, 'retained.json'),
          deliveryKeyFile: await buyerKeyFor(c, initial, trade),
        },
        output
      )
      const result = await privateJSON(fs, output, 32 * 1024 * 1024)
      const raster = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/
      if (
        result.trade !== tradeId ||
        result.epoch !== bundle.epoch ||
        result.count !== bundle.cids.length ||
        !Array.isArray(result.flips) ||
        result.flips.length !== bundle.cids.length ||
        result.flips.some(
          (flip, index) =>
            flip.cid !== bundle.cids[index] ||
            !Array.isArray(flip.images) ||
            flip.images.length !== 4 ||
            flip.images.some(
              (src) =>
                typeof src !== 'string' ||
                src.length > 3 * 1024 * 1024 ||
                !raster.test(src)
            ) ||
            !Array.isArray(flip.orders) ||
            flip.orders.length !== 2 ||
            flip.orders.some(
              (order) =>
                !Array.isArray(order) ||
                order.length !== 4 ||
                [...order].sort().join(',') !== '0,1,2,3'
            )
        )
      )
        fail('The purchased preview could not be verified.')
      const current = await context(c)
      if (current.coinbase !== initial.coinbase)
        fail('The active identity changed.')
      return {
        trade: tradeId,
        epoch: result.epoch,
        count: result.count,
        flips: result.flips.map(({cid, images, orders}) => ({
          cid,
          images,
          orders,
        })),
      }
    } finally {
      await fs.promises.rm(output, {force: true})
    }
  }
  async function tradeTerms(c, initial, market, request, passphrase) {
    const trade = market.trades.find((t) => t.id === request.id)
    if (!trade) fail('This trade is unavailable for the active identity.')
    const directory = await tradeDirectory(c, initial, trade.id)
    if (request.operation === 'ready' || request.operation === 'accept') {
      if (trade.buyer !== initial.coinbase) fail('This is not your purchase.')
      request.retainedFile = path.join(directory, 'retained.json')
      if (!fs.existsSync(request.retainedFile))
        await cli(c, initial, 'retain', request, request.retainedFile)
      request.deliveryKeyFile = await buyerKeyFor(c, initial, trade)
      if (request.operation === 'accept') {
        if (!passphrase) fail('Unlock local delivery verification first.')
        request.ciphertextHash = trade.ciphertextHash
        await cli(
          c,
          initial,
          'receive',
          request,
          path.join(directory, 'received.vault'),
          passphrase
        )
      }
    } else if (request.operation === 'deliver') {
      if (trade.seller !== initial.coinbase) fail('This is not your sale.')
      const envelope = path.join(directory, 'delivery.json')
      if (!fs.existsSync(envelope)) {
        let vaultFile = epochVaults.get(
          `${c.contract}:${initial.coinbase}:${trade.bundle}`
        )
        if (!vaultFile) {
          const chosen = await choose(
            'Choose the verified epoch key vault',
            true
          )
          chosen.data.fill(0)
          vaultFile = chosen.file
          epochVaults.set(
            `${c.contract}:${initial.coinbase}:${trade.bundle}`,
            vaultFile
          )
        }
        if (!passphrase) fail('Unlock your epoch key vault first.')
        await cli(
          c,
          initial,
          'delivery',
          {...request, vaultFile},
          envelope,
          passphrase
        )
      }
      const delivery = await privateJSON(fs, envelope)
      if (
        delivery.operation !== 'deliver' ||
        delivery.id !== request.id ||
        delivery.caller !== initial.coinbase
      )
        fail('Saved delivery differs from this trade.')
      request.ciphertext = delivery.ciphertext
    }
  }
  async function prepare(payload, automated = false) {
    validatePayload(payload, [
      'operation',
      'id',
      'bundle',
      'amount',
      'target',
      'minimum',
      'maximum',
      'capacity',
      'exit',
      'passphrase',
    ])
    if (
      !SIMPLE.has(payload.operation) ||
      (version === 9 && payload.operation === 'registerBundle') ||
      (automated && !AUTOMATIC.has(payload.operation))
    )
      fail('Unsupported market action.')
    const c = await config()
    const initial = await context(c)
    const market = await snapshot(c, initial)
    if (
      payload.operation === 'withdrawStake' &&
      (payload.exit !== true ||
        payload.amount !== market.account?.balance ||
        market.account?.reserved !== '0')
    )
      fail(
        'Finish all open orders and trades before withdrawing the full deposit.'
      )
    let maxFee = (
      BigInt(await initial.rpc('bcn_feePerGas', [])) * 5000000n
    ).toString()
    if (BigInt(maxFee) <= 0n) fail('Network fee unavailable.')
    if (BigInt(maxFee) > 1000n * ATOMS) maxFee = (1000n * ATOMS).toString()
    const request = {
      operation: payload.operation,
      caller: initial.coinbase,
      ...(version === 9 ? {protocolVersion: 9} : {}),
    }
    for (const field of ['amount', 'target', 'minimum', 'maximum', 'capacity'])
      if (payload[field] !== undefined) request[field] = amount(payload[field])
    if (payload.id !== undefined) request.id = id(payload.id)
    if (payload.bundle !== undefined) {
      if (!HEX32.test(payload.bundle)) fail('Invalid bundle.')
      request.bundle = payload.bundle
    }
    if (payload.exit !== undefined) {
      if (typeof payload.exit !== 'boolean') fail('Invalid withdrawal.')
      request.exit = payload.exit
    }
    const actionId = `v7-${randomBytes(16).toString('hex')}`
    const directory = path.join(
      await actionDirectory(initial.coinbase),
      actionId
    )
    await fs.promises.mkdir(directory, {mode: 0o700})
    if (process.platform === 'win32')
      await writePrivateFile(fs, path.join(directory, 'attempt.guard'), '')
    if (request.operation === 'queueBuy' || request.operation === 'queueSell')
      request.expires = market.height + 4320
    if (request.operation === 'queueBuy') {
      const key = createECDH('secp256k1')
      key.generateKeys()
      request.deliveryKey = key.getPublicKey('hex', 'uncompressed')
      request.deliveryKeyFile = path.join(directory, 'delivery.key')
      const secret = key.getPrivateKey()
      try {
        await writePrivateFile(
          fs,
          request.deliveryKeyFile,
          secret.toString('hex').padStart(64, '0')
        )
      } finally {
        secret.fill(0)
      }
    }
    if (['ready', 'deliver', 'accept'].includes(request.operation))
      await tradeTerms(
        c,
        initial,
        market,
        request,
        payload.passphrase || automatic?.passphrase
      )
    if (version === 9 && request.operation === 'queueSell') {
      const listing = await privateJSON(
        fs,
        path.join(await base(c, initial), `package-${request.bundle}.json`),
        2 * 1024 * 1024
      )
      request.sessionFile = listing.sessionFile
      request.vaultFile =
        epochVaults.get(
          `${c.contract}:${initial.coinbase}:${request.bundle}`
        ) || listing.vaultFile
      const converted = path.join(directory, 'listing.json')
      await cli(
        c,
        initial,
        'listing',
        request,
        converted,
        payload.passphrase || automatic?.passphrase || ''
      )
      Object.assign(request, await privateJSON(fs, converted, 2 * 1024 * 1024))
    }
    if (request.operation === 'registerBundle') {
      const proof = await choose('Choose the verified content proof')
      const session = await choose('Choose the canonical session bundle')
      try {
        const data = JSON.parse(proof.data.toString('utf8'))
        request.journal = data.journal
        request.seal = data.seal
        const sessionFile = path.join(directory, 'session.json')
        await writePrivateFile(fs, sessionFile, session.data)
        const converted = path.join(directory, 'registration.json')
        await cli(
          c,
          initial,
          'registration',
          {...request, sessionFile},
          converted
        )
        Object.assign(
          request,
          await privateJSON(fs, converted, 2 * 1024 * 1024)
        )
      } finally {
        proof.data.fill(0)
        session.data.fill(0)
      }
    }
    if (request.operation === 'proveDelivery') {
      const selected = await choose('Choose the private delivery proof')
      try {
        const proof = JSON.parse(selected.data.toString('utf8'))
        request.journal = proof.journal
        request.seal = proof.seal
      } finally {
        selected.data.fill(0)
      }
    }
    if (version === 9 && request.operation === 'proveDelivery') {
      const content = await choose(
        'Choose the original-content proof for this dispute'
      )
      try {
        const proof = JSON.parse(content.data.toString('utf8'))
        request.contentJournal = proof.journal
        request.contentSeal = proof.seal
      } finally {
        content.data.fill(0)
      }
    }
    const preparedPath = path.join(directory, 'prepared.json')
    await cli(
      c,
      initial,
      'prepare',
      request,
      preparedPath,
      payload.passphrase || automatic?.passphrase || '',
      maxFee
    )
    const prepared = await privateJSON(fs, preparedPath, 20 * 1024 * 1024)
    const estimatedFee = amount(prepared.estimatedMaxFee)
    if (BigInt(estimatedFee) > BigInt(maxFee))
      fail('The simulated network fee exceeds the local limit.')
    maxFee = estimatedFee
    const summary = preparedSummary(prepared, c, request.operation)
    await writePrivateFile(
      fs,
      path.join(directory, 'meta.json'),
      JSON.stringify({
        actionId,
        coinbase: initial.coinbase,
        contract: c.contract,
        codeHash: c.codeHash,
        operation: request.operation,
        maxFee,
      })
    )
    await syncActionDirectories(fs, directory, root)
    return {actionId, ...summary, maxFee}
  }
  async function unlock(payload) {
    validatePayload(payload, ['passphrase', 'perTrade', 'purchaseBudget'])
    if (
      typeof payload.passphrase !== 'string' ||
      payload.passphrase.length < 12 ||
      payload.passphrase.length > 1024
    )
      fail('Use a vault passphrase of at least 12 characters.')
    const c = await config()
    const initial = await context(c, true)
    let orderLimits = null
    if (
      payload.perTrade !== undefined ||
      payload.purchaseBudget !== undefined
    ) {
      orderLimits = {
        perTrade: BigInt(amount(payload.perTrade)),
        purchaseRemaining: BigInt(amount(payload.purchaseBudget, true)),
      }
      const market = await snapshot(c, initial)
      if (
        market.account.needsTopup ||
        orderLimits.perTrade > BigInt(market.account.target) ||
        orderLimits.perTrade > BigInt(market.account.balance)
      )
        fail(
          'Restore your security deposit before enabling this trading limit.'
        )
    }
    const display = (v) =>
      `${v / ATOMS}.${
        (v % ATOMS).toString().padStart(18, '0').replace(/0+$/, '') || '0'
      } iDNA`
    const confirmation = await dialog.showMessageBox({
      type: 'question',
      title: orderLimits
        ? 'Enable one-click trading'
        : 'Enable local trade handling',
      message: orderLimits
        ? 'Enable buying and selling within these limits on this device?'
        : 'Handle your matched trades automatically while this app is open?',
      detail: `For the next 8 hours this app may match queued orders, reserve pool payments, retain encrypted flips, deliver encrypted keys, and accept only after every flip decrypts and is saved locally. ${
        orderLimits
          ? `Orders you click may be signed without another dialog. Maximum per trade: ${display(
              orderLimits.perTrade
            )}. Total purchase ceiling: ${display(
              orderLimits.purchaseRemaining
            )}. Price protection: 5% from the displayed quote. Queued orders can remain active after this permission expires.`
          : 'No new purchase or sale is authorized.'
      } No deposit, contribution, dispute, or withdrawal is authorized. Total network fee ceiling: 25 iDNA. You can stop at any time.`,
      buttons: ['Cancel', 'Enable'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (confirmation.response !== 1) return {enabled: false}
    const selected = await choose('Choose the active identity key', true, 1024)
    let owner
    try {
      owner = nodekeyAddress(selected.data)
    } finally {
      selected.data.fill(0)
    }
    if (owner !== initial.coinbase)
      fail('The selected key belongs to another identity.')
    automatic = {
      keyPath: selected.file,
      coinbase: initial.coinbase,
      contract: c.contract,
      codeHash: c.codeHash,
      expires: Date.now() + 8 * 3600000,
      remainingFee: 25n * ATOMS,
      operations: new Set([
        ...AUTOMATIC,
        ...(orderLimits ? ['queueBuy', 'queueSell'] : []),
      ]),
      orderLimits,
      passphrase: payload.passphrase,
      resolvedActions: new Set(),
    }
    return {enabled: true}
  }
  async function placeTrade(payload) {
    validatePayload(payload, ['side', 'bundle', 'quote'])
    if (!['buy', 'sell'].includes(payload.side)) fail('Invalid trade side.')
    const quoted = BigInt(amount(payload.quote))
    const c = await config()
    const initial = await context(c, true)
    if (!validGrant(c, initial) || !automatic.orderLimits)
      fail('Enable one-click trading before placing an order.')
    const grant = automatic
    if (
      (await listActions(c, initial.coinbase, initial.rpc)).some(
        (a) =>
          !a.pinChanged &&
          a.attempted &&
          !grant.resolvedActions.has(a.actionId) &&
          !['included', 'failed'].includes(a.submitted?.status)
      )
    )
      fail(
        'Wait for the previous transaction to be confirmed before trading again.'
      )
    const market = await snapshot(c, initial)
    if (version === 9) await addLocalPackages(c, initial, market)
    const {account} = market
    if (account.needsTopup || BigInt(account.balance) < BigInt(account.target))
      fail('Restore your security deposit before another trade.')
    const free =
      (BigInt(account.balance) < BigInt(account.target)
        ? BigInt(account.balance)
        : BigInt(account.target)) - BigInt(account.reserved)
    let terms
    if (payload.side === 'buy') {
      const maximum = (quoted * 105n + 99n) / 100n
      if (BigInt(market.buyQuote) > maximum)
        fail(
          'The price moved beyond your limit. Refresh the quote and try again.'
        )
      if (
        maximum > grant.orderLimits.perTrade ||
        maximum > grant.orderLimits.purchaseRemaining
      )
        fail('This purchase exceeds your approved trading budget.')
      if (maximum > free)
        fail(
          'Your deposit is already committed. Wait or cancel an unmatched order.'
        )
      terms = {operation: 'queueBuy', maximum: maximum.toString()}
    } else {
      if (
        !HEX32.test(payload.bundle || '') ||
        !market.bundles.some(
          (b) =>
            b.id === payload.bundle &&
            b.author === initial.coinbase &&
            !b.used &&
            b.sale === '0'
        )
      )
        fail('Choose an available verified bundle owned by this identity.')
      if (
        !epochVaults.has(`${c.contract}:${initial.coinbase}:${payload.bundle}`)
      )
        fail('Choose the epoch vault before starting one-click sales.')
      const minimum = (quoted * 95n) / 100n || 1n
      if (
        BigInt(market.sellQuote) < minimum ||
        BigInt(market.buyQuote) > grant.orderLimits.perTrade
      )
        fail(
          'The price moved beyond your limit. Refresh the quote and try again.'
        )
      if (grant.orderLimits.perTrade > free)
        fail(
          'Your deposit is already committed. Wait or cancel an unmatched order.'
        )
      terms = {
        operation: 'queueSell',
        bundle: payload.bundle,
        minimum: minimum.toString(),
        capacity: grant.orderLimits.perTrade.toString(),
      }
    }
    const prepared = await prepare(terms)
    if (!validGrant(c, initial))
      fail('Trading permission expired. Enable it again before trading.')
    grant.requestedOrderId = prepared.actionId
    let result
    try {
      result = await submit({actionId: prepared.actionId}, grant)
    } finally {
      delete grant.requestedOrderId
    }
    lastWorkerMessage =
      'Order submitted. Matching and delivery continue while this app is open.'
    return result
  }
  async function tick() {
    if (!automatic || automatic.expires <= Date.now()) return {active: false}
    const c = await config()
    const initial = await context(c, true)
    if (
      c.contract !== automatic.contract ||
      c.codeHash !== automatic.codeHash ||
      initial.coinbase !== automatic.coinbase
    ) {
      automatic = null
      return {active: false}
    }
    const market = await snapshot(c, initial)
    const actions = (
      await listActions(c, initial.coinbase, initial.rpc)
    ).filter(
      (a) =>
        !a.pinChanged &&
        !automatic.resolvedActions.has(a.actionId) &&
        a.attempted &&
        a.submitted?.status !== 'included' &&
        a.submitted?.status !== 'failed'
    )
    if (actions.length) {
      const result = await check({actionId: actions[0].actionId})
      if (['included', 'failed'].includes(result.status))
        automatic.resolvedActions.add(actions[0].actionId)
      lastWorkerMessage =
        result.status === 'included'
          ? 'Previous transaction confirmed.'
          : 'Waiting for the previous transaction.'
      return {active: true}
    }
    let next
    for (const t of market.trades) {
      if (
        t.buyer === initial.coinbase &&
        t.state === 1 &&
        market.height < t.readyBy
      ) {
        next = {operation: 'ready', id: t.id}
        break
      }
      if (
        t.buyer === initial.coinbase &&
        [3, 4].includes(t.state) &&
        market.height < t.proveBy
      ) {
        next = {operation: 'accept', id: t.id}
        break
      }
      if (
        t.seller === initial.coinbase &&
        t.state === 2 &&
        market.height < t.deliverBy
      ) {
        if (!epochVaults.has(`${c.contract}:${initial.coinbase}:${t.bundle}`)) {
          lastWorkerMessage =
            'Choose the epoch vault using Deliver keys to enable this sale.'
          continue
        }
        next = {operation: 'deliver', id: t.id}
        break
      }
    }
    if (!next) {
      const buys = market.buys.filter(
        (b) => b.state === 1 && b.expires > market.height
      )
      const sells = market.sells.filter(
        (s) => [1, 2].includes(s.state) && s.expires > market.height
      )
      const pair = buys.some((b) =>
        sells.some(
          (s) =>
            b.buyer !== s.seller &&
            (b.buyer === initial.coinbase || s.seller === initial.coinbase) &&
            BigInt(b.maximum) >= BigInt(market.buyQuote) &&
            BigInt(s.capacity) >= BigInt(market.buyQuote) &&
            BigInt(s.minimum) <=
              BigInt(s.state === 2 ? s.proceeds : market.sellQuote)
        )
      )
      if (pair) next = {operation: 'matchNext'}
      else if (
        market.poolCanAcquire &&
        sells.some(
          (s) =>
            s.seller === initial.coinbase &&
            s.state === 1 &&
            BigInt(s.minimum) <= BigInt(market.sellQuote) &&
            BigInt(s.capacity) >= BigInt(market.sellQuote)
        )
      )
        next = {operation: 'acquire'}
    }
    if (!next) return {active: true}
    try {
      const prepared = await prepare(next, true)
      const result = await submit({actionId: prepared.actionId}, automatic)
      lastWorkerMessage =
        result.status === 'included'
          ? 'Trade step confirmed.'
          : 'Waiting for transaction confirmation.'
    } catch {
      lastWorkerMessage =
        'Automatic handling needs attention. Use the next action shown for your trade.'
    }
    return {active: true}
  }
  return async function perform(method, payload) {
    switch (method) {
      case 'status':
        return status()
      case 'purchasedPreview':
        return purchasedPreview(payload)
      case 'importProfile':
        return importProfile()
      case 'prepare':
        return prepare(payload)
      case 'submit': {
        const c = await config()
        const initial = await context(c)
        const action = await readAction(c, initial.coinbase, payload?.actionId)
        const result = await submit(payload)
        if (
          action.meta.operation === 'withdrawStake' &&
          result.status !== 'cancelled'
        )
          automatic = null
        return result
      }
      case 'check':
        return check(payload)
      case 'unlock':
        return unlock(payload)
      case 'trade':
        return placeTrade(payload)
      case 'importPackage':
        return importPackage(payload)
      case 'chooseVault':
        return chooseVault(payload)
      case 'stop':
        automatic = null
        return {enabled: false}
      case 'tick':
        return tick()
      default:
        fail('Unsupported bonded market action.')
    }
  }
}
module.exports = {createBondedMarket}
