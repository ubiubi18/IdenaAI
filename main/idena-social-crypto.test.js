/** @jest-environment node */

const crypto = require('crypto')
const {decrypt} = require('eciesjs')
const {keccak_256: keccak256, sha3_256: sha3256} = require('js-sha3')
const {
  SOCIAL_CONTRACT_ADDRESS,
  createIdenaSocialCryptoService,
  decryptExportedPrivateKey,
  validateSocialCryptoRequest,
} = require('./idena-social-crypto')
const {
  privateKeyToAddress,
  privateKeyToPublicKey,
} = require('./utils/idena-crypto')

function randomPrivateKey() {
  for (;;) {
    const candidate = crypto.randomBytes(32)
    try {
      privateKeyToPublicKey(candidate)
      return candidate
    } catch {
      candidate.fill(0)
    }
  }
}

function encryptExportedKey(privateKey, password) {
  const key = Buffer.from(sha3256.arrayBuffer(password))
  const nonce = crypto.randomBytes(12)
  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
    const ciphertext = Buffer.concat([
      cipher.update(privateKey),
      cipher.final(),
    ])
    return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString(
      'hex'
    )
  } finally {
    key.fill(0)
  }
}

function utf8EventArg(value) {
  return `0x${Buffer.from(value, 'utf8').toString('hex')}`
}

function createRpcHarness(privateKey) {
  const address = privateKeyToAddress(privateKey).toLowerCase()
  let receipt = null
  const calls = []

  const rpcCall = jest.fn(async ({method, params}) => {
    calls.push({method, params})
    if (method === 'dna_getCoinbaseAddr') return {result: address}
    if (method === 'dna_exportKey') {
      return {result: encryptExportedKey(privateKey, params[0])}
    }
    if (method === 'bcn_txReceipt') return {result: receipt}
    return {error: {message: 'unexpected_rpc_method'}}
  })

  return {
    address,
    calls,
    rpcCall,
    setReceipt(nextReceipt) {
      receipt = nextReceipt
    },
  }
}

describe('idena.social host message crypto', () => {
  let privateKey
  let recipientPrivateKey

  beforeEach(() => {
    privateKey = randomPrivateKey()
    recipientPrivateKey = randomPrivateKey()
  })

  afterEach(() => {
    privateKey.fill(0)
    recipientPrivateKey.fill(0)
  })

  it('decrypts the exact key-export format without retaining the password', () => {
    const password = crypto.randomBytes(32).toString('base64url')
    const encrypted = encryptExportedKey(privateKey, password)
    const decrypted = decryptExportedPrivateKey(encrypted, password)

    expect(decrypted.equals(privateKey)).toBe(true)
    decrypted.fill(0)
  })

  it('encrypts for both sender and recipient without returning key material', async () => {
    const harness = createRpcHarness(privateKey)
    const service = createIdenaSocialCryptoService({rpcCall: harness.rpcCall})
    const plaintext = JSON.stringify([
      [harness.address, privateKeyToAddress(recipientPrivateKey)],
      '',
      'hello',
      '',
      '',
      [],
      [],
      '',
      [],
    ])

    const response = await service({
      operation: 'encrypt-message',
      address: harness.address,
      recipientPublicKey:
        privateKeyToPublicKey(recipientPrivateKey).toString('hex'),
      plaintext,
    })

    expect(response.error).toBeUndefined()
    expect(Object.keys(response.result).sort()).toEqual([
      'recipientCiphertext',
      'senderCiphertext',
      'version',
    ])
    expect(
      Buffer.from(
        decrypt(
          Uint8Array.from(privateKey),
          Uint8Array.from(
            Buffer.from(response.result.senderCiphertext, 'base64')
          )
        )
      ).toString('utf8')
    ).toBe(plaintext)
    expect(
      Buffer.from(
        decrypt(
          Uint8Array.from(recipientPrivateKey),
          Uint8Array.from(
            Buffer.from(response.result.recipientCiphertext, 'base64')
          )
        )
      ).toString('utf8')
    ).toBe(plaintext)
  })

  it('decrypts only a receipt-bound message for the connected participant', async () => {
    const harness = createRpcHarness(privateKey)
    const service = createIdenaSocialCryptoService({rpcCall: harness.rpcCall})
    const recipient = privateKeyToAddress(recipientPrivateKey).toLowerCase()
    const plaintext = JSON.stringify([
      [harness.address, recipient],
      '',
      'receipt-bound message',
      '',
      '',
      [],
      [],
      '',
      [],
    ])
    const encrypted = await service({
      operation: 'encrypt-message',
      address: harness.address,
      recipientPublicKey:
        privateKeyToPublicKey(recipientPrivateKey).toString('hex'),
      plaintext,
    })
    const txHash = `0x${crypto.randomBytes(32).toString('hex')}`
    const messageHash = keccak256(plaintext)
    const pair = `${encrypted.result.senderCiphertext},${encrypted.result.recipientCiphertext}`
    harness.setReceipt({
      success: true,
      contract: SOCIAL_CONTRACT_ADDRESS,
      method: 'sendMessage',
      txHash,
      events: [
        {
          contract: SOCIAL_CONTRACT_ADDRESS,
          event: 'sendMessage',
          args: [
            harness.address,
            '0x01',
            utf8EventArg(pair),
            utf8EventArg(messageHash),
            utf8EventArg('true'),
          ],
        },
      ],
    })

    const response = await service({
      operation: 'decrypt-message',
      address: harness.address,
      txHash,
      messageHash,
      senderCiphertext: encrypted.result.senderCiphertext,
      recipientCiphertext: encrypted.result.recipientCiphertext,
    })

    expect(response).toEqual({
      result: {
        plaintext,
        role: 'sender',
        ciphertextIndexes: [0],
        version: 'host-v1',
      },
    })
    expect(harness.calls.some(({method}) => method === 'bcn_txReceipt')).toBe(
      true
    )
  })

  it('decrypts a receipt-bound group message only at the matching participant index', async () => {
    const thirdPrivateKey = randomPrivateKey()

    try {
      const senderHarness = createRpcHarness(privateKey)
      const senderService = createIdenaSocialCryptoService({
        rpcCall: senderHarness.rpcCall,
      })
      const firstRecipient =
        privateKeyToAddress(recipientPrivateKey).toLowerCase()
      const secondRecipient = privateKeyToAddress(thirdPrivateKey).toLowerCase()
      const plaintext = JSON.stringify([
        [senderHarness.address, firstRecipient, secondRecipient],
        '',
        'receipt-bound group message',
        '',
        '',
        [],
        [],
        '',
        [],
      ])
      const firstEncryption = await senderService({
        operation: 'encrypt-message',
        address: senderHarness.address,
        recipientPublicKey:
          privateKeyToPublicKey(recipientPrivateKey).toString('hex'),
        plaintext,
      })
      const secondEncryption = await senderService({
        operation: 'encrypt-message',
        address: senderHarness.address,
        recipientPublicKey:
          privateKeyToPublicKey(thirdPrivateKey).toString('hex'),
        plaintext,
      })
      const ciphertexts = [
        firstEncryption.result.senderCiphertext,
        firstEncryption.result.recipientCiphertext,
        secondEncryption.result.recipientCiphertext,
      ]
      const txHash = `0x${crypto.randomBytes(32).toString('hex')}`
      const messageHash = keccak256(plaintext)
      const receipt = {
        success: true,
        contract: SOCIAL_CONTRACT_ADDRESS,
        method: 'sendMessage',
        txHash,
        events: [
          {
            contract: SOCIAL_CONTRACT_ADDRESS,
            event: 'sendMessage',
            args: [
              senderHarness.address,
              '0x01',
              utf8EventArg(ciphertexts.join(',')),
              utf8EventArg(messageHash),
              utf8EventArg('true'),
            ],
          },
        ],
      }
      const recipientHarness = createRpcHarness(thirdPrivateKey)
      recipientHarness.setReceipt(receipt)
      const recipientService = createIdenaSocialCryptoService({
        rpcCall: recipientHarness.rpcCall,
      })

      const response = await recipientService({
        operation: 'decrypt-message',
        address: recipientHarness.address,
        txHash,
        messageHash,
        senderCiphertext: ciphertexts[0],
        recipientCiphertext: ciphertexts[1],
        ciphertexts,
      })

      expect(response).toEqual({
        result: {
          plaintext,
          role: 'recipient',
          ciphertextIndexes: [2],
          version: 'host-v1',
        },
      })
    } finally {
      thirdPrivateKey.fill(0)
    }
  })

  it('rejects ciphertext that is not present in the confirmed event', async () => {
    const harness = createRpcHarness(privateKey)
    const service = createIdenaSocialCryptoService({rpcCall: harness.rpcCall})
    const txHash = `0x${crypto.randomBytes(32).toString('hex')}`
    harness.setReceipt({
      success: true,
      contract: SOCIAL_CONTRACT_ADDRESS,
      method: 'sendMessage',
      txHash,
      events: [],
    })

    const response = await service({
      operation: 'decrypt-message',
      address: harness.address,
      txHash,
      messageHash: keccak256('unknown'),
      senderCiphertext: Buffer.from('not a message').toString('base64'),
      recipientCiphertext: Buffer.from('not a message').toString('base64'),
    })

    expect(response).toEqual({error: {message: 'unverified_message_event'}})
    expect(harness.calls.some(({method}) => method === 'dna_exportKey')).toBe(
      false
    )
  })

  it('rejects malformed requests before invoking node RPC', async () => {
    const harness = createRpcHarness(privateKey)
    const service = createIdenaSocialCryptoService({rpcCall: harness.rpcCall})

    expect(
      validateSocialCryptoRequest({
        operation: 'encrypt-message',
        address: harness.address,
        recipientPublicKey: 'not-a-key',
        plaintext: 'hello',
      })
    ).toBe('invalid_recipient_public_key')

    await expect(
      service({operation: 'status', address: 'not-an-address'})
    ).resolves.toEqual({error: {message: 'invalid_crypto_address'}})
    expect(harness.rpcCall).not.toHaveBeenCalled()
  })
})
