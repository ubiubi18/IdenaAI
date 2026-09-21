#!/usr/bin/env node

/*
 * Publish already prepared flip drafts through a local Idena node RPC.
 *
 * The app publishes flips from the renderer, one review step at a time. This
 * operator tool rebuilds the same payload for drafts the post-session generator
 * produced (shufflePics + flipToHex from renderer/screens/flips/utils.js) so a
 * batch can be submitted from a shell. It reads the node API key from the
 * profile settings at runtime, never prints credentials, and writes its results
 * to a file so the store can be reconciled with the app stopped.
 *
 * Usage:
 *   node scripts/idena_ai_publish_prepared_flips.js \
 *     --app-root /opt/idena-ai/source \
 *     --profile /var/lib/idena-ai/profile \
 *     --rpc-port 9129 [--submit] [--max N] [--results FILE]
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {createRequire} = require('module')

const DEFAULT_APP_ROOT = '/opt/idena-ai/source'
const DEFAULT_RPC_PORT = 9129
const PANEL_COUNT = 4

function permutations(values) {
  if (values.length <= 1) return [values.slice()]
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map(
      (rest) => [value, ...rest]
    )
  )
}

const ALL_ORDERS = permutations(
  Array.from({length: PANEL_COUNT}, (_, index) => index)
)

function randomOrder() {
  return ALL_ORDERS[crypto.randomInt(ALL_ORDERS.length)].slice()
}

// Mirrors the app's client-side shuffle guard: a submitted flip must not keep
// the original panel order.
function pickShuffle(originalOrder = [0, 1, 2, 3]) {
  const original = originalOrder.map(Number)
  const candidates = ALL_ORDERS.filter(
    (order) => !order.every((value, index) => value === original[index])
  )
  return candidates[crypto.randomInt(candidates.length)].slice()
}

// Copy of renderer/screens/flips/utils.js shufflePics + flipToHex.
function buildFlipSubmitPayload(pictures, shuffledOrder, rlpEncode) {
  if (!Array.isArray(pictures) || pictures.length !== PANEL_COUNT) {
    throw new Error('four flip panels are required')
  }

  const seed = randomOrder()
  const shuffledPictures = []
  const firstOrder = new Array(PANEL_COUNT)

  seed.forEach((value, index) => {
    shuffledPictures.push(pictures[value])
    firstOrder[value] = index
  })

  const secondOrder = shuffledOrder.map((value) => firstOrder[value])
  const orders =
    crypto.randomInt(2) === 0
      ? [firstOrder, secondOrder]
      : [secondOrder, firstOrder]

  const publicHex = `0x${Buffer.from(
    rlpEncode([
      shuffledPictures
        .slice(0, PANEL_COUNT / 2)
        .map((item) => Uint8Array.from(item)),
    ])
  ).toString('hex')}`
  const privateHex = `0x${Buffer.from(
    rlpEncode([
      shuffledPictures
        .slice(PANEL_COUNT / 2)
        .map((item) => Uint8Array.from(item)),
      orders,
    ])
  ).toString('hex')}`

  return {publicHex, privateHex, orders}
}

function selectPreparedDrafts(flips, max = 0) {
  const drafts = (Array.isArray(flips) ? flips : [])
    .filter(
      (flip) =>
        String(flip.type || '').toLowerCase() === 'draft' &&
        String(flip.id || '').startsWith('scheduled-')
    )
    .sort((a, b) => Number(a.keywordPairId) - Number(b.keywordPairId))

  return max > 0 ? drafts.slice(0, max) : drafts
}

function decodeImageDataUrl(value) {
  const match = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(String(value || ''))
  if (!match) throw new Error('flip image is not a base64 data URL')
  return Buffer.from(match[1], 'base64')
}

function parseArgs(argv) {
  const options = {
    appRoot: DEFAULT_APP_ROOT,
    profile: '',
    rpcPort: DEFAULT_RPC_PORT,
    submit: false,
    results: '',
    max: 0,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const readValue = () => {
      index += 1
      return argv[index]
    }

    if (flag === '--app-root') options.appRoot = readValue()
    else if (flag === '--profile') options.profile = readValue()
    else if (flag === '--rpc-port') options.rpcPort = Number(readValue())
    else if (flag === '--results') options.results = readValue()
    else if (flag === '--max') options.max = Number(readValue())
    else if (flag === '--submit') options.submit = true
    else throw new Error(`unknown argument: ${flag}`)
  }

  if (!options.profile) throw new Error('--profile is required')
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const appRequire = createRequire(path.join(options.appRoot, 'package.json'))
  const rlpEncode = appRequire('rlp').encode
  const sharp = appRequire('sharp')

  const settings = JSON.parse(
    fs.readFileSync(path.join(options.profile, 'settings.json'), 'utf8')
  )
  const apiKey = settings.internalApiKey

  async function rpc(method, params = []) {
    const response = await fetch(`http://127.0.0.1:${options.rpcPort}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({method, params, id: 1, key: apiKey}),
    })
    const payload = await response.json()
    if (payload.error) {
      throw new Error(
        `${method} failed: ${
          payload.error.message || JSON.stringify(payload.error)
        }`
      )
    }
    return payload.result
  }

  const address = await rpc('dna_getCoinbaseAddr')
  const identity = await rpc('dna_identity', [address])
  const usedPairs = new Set(
    (identity.flipKeyWordPairs || [])
      .filter((pair) => pair.used)
      .map((pair) => Number(pair.id))
  )

  const store = JSON.parse(
    fs.readFileSync(path.join(options.profile, 'flips.json'), 'utf8')
  )
  const drafts = selectPreparedDrafts(store.flips, options.max)

  console.log(
    `identity state=${identity.state} published=${
      (identity.flips || []).length
    } drafts=${drafts.length}`
  )

  const results = []
  for (const draft of drafts) {
    const pairId = Number(draft.keywordPairId)
    const images = draft.protectedImages || draft.images || []

    if (usedPairs.has(pairId)) {
      console.log(`pair ${pairId}: skipped, keyword pair already used on-chain`)
    } else if (images.length !== PANEL_COUNT) {
      console.log(`pair ${pairId}: skipped, needs four panels`)
    } else {
      const compressed = await Promise.all(
        images
          .slice(0, PANEL_COUNT)
          .map((image) =>
            sharp(decodeImageDataUrl(image))
              .resize(240, 180, {fit: 'fill'})
              .jpeg({quality: 60})
              .toBuffer()
          )
      )

      const originalOrder = Array.isArray(draft.originalOrder)
        ? draft.originalOrder
        : [0, 1, 2, 3]
      const shuffledOrder = pickShuffle(originalOrder)
      const payload = buildFlipSubmitPayload(
        compressed,
        shuffledOrder,
        rlpEncode
      )
      const sizeKb = Math.round(
        (payload.publicHex.length + payload.privateHex.length) / 2048
      )

      if (options.submit) {
        // eslint-disable-next-line no-await-in-loop
        const submitted = await rpc('flip_submit', [
          {
            publicHex: payload.publicHex,
            privateHex: payload.privateHex,
            pairId,
          },
        ])
        const txHash = String((submitted && submitted.txHash) || '')
        const flipHash = String((submitted && submitted.hash) || '')
        console.log(
          `pair ${pairId}: submitted tx=${txHash.slice(
            0,
            18
          )}… hash=${flipHash.slice(0, 18)}… (${sizeKb} KB)`
        )
        results.push({
          id: draft.id,
          pairId,
          txHash,
          hash: flipHash,
          shuffledOrder,
          submittedAt: new Date().toISOString(),
        })
        usedPairs.add(pairId)
      } else {
        console.log(
          `pair ${pairId}: ready, ~${sizeKb} KB payload, shuffle ${shuffledOrder.join(
            ''
          )}`
        )
      }
    }
  }

  if (options.results) {
    fs.writeFileSync(options.results, JSON.stringify(results, null, 2), {
      mode: 0o600,
    })
    console.log(`results written: ${options.results} (${results.length})`)
  }
}

module.exports = {
  ALL_ORDERS,
  buildFlipSubmitPayload,
  decodeImageDataUrl,
  permutations,
  pickShuffle,
  selectPreparedDrafts,
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`flip publisher failed: ${error.message}`)
    process.exit(1)
  })
}
