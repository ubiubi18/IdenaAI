const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {encode: rlpEncode} = require('rlp')
const {createFlipGenerationScheduler} = require('./flip-generation-scheduler')
const {DEFAULT_STORY_MODELS} = require('./ai-providers/constants')

const LEDGER_KEY = 'ai-provider-daily-budget-ledger'
// The renderer stores flip types in lower case; see renderer/shared/types.js.
const DRAFT_FLIP_TYPES = ['draft', 'publishing', 'published']
// Higher identity states publish one or two flips beyond the epoch minimum
// when unused keyword pairs allow it.
const EXTRA_FLIPS_BY_STATE = {verified: 1, human: 2}

function permutations(values) {
  if (values.length <= 1) return [values.slice()]
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map(
      (rest) => [value, ...rest]
    )
  )
}

const PANEL_ORDERS = permutations([0, 1, 2, 3])

// Mirrors the renderer guard: a submitted flip must not keep the original
// panel order.
function pickPanelShuffle(originalOrder = [0, 1, 2, 3]) {
  const original = originalOrder.map(Number)
  const candidates = PANEL_ORDERS.filter(
    (order) => !order.every((value, index) => value === original[index])
  )
  return candidates[crypto.randomInt(candidates.length)]
}

function panelBytes(dataUrl) {
  const match = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(String(dataUrl || ''))
  if (!match) throw new Error('Generated panel is not a base64 image')
  return Buffer.from(match[1], 'base64')
}

// Copy of renderer/screens/flips/utils.js shufflePics + flipToHex so scheduled
// flips are submitted with the same payload the UI produces.
function buildFlipSubmitPayload(pictures, shuffledOrder) {
  const seed = PANEL_ORDERS[crypto.randomInt(PANEL_ORDERS.length)]
  const shuffledPictures = []
  const firstOrder = new Array(pictures.length)

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
      shuffledPictures.slice(0, 2).map((item) => Uint8Array.from(item)),
    ])
  ).toString('hex')}`
  const privateHex = `0x${Buffer.from(
    rlpEncode([
      shuffledPictures.slice(2).map((item) => Uint8Array.from(item)),
      orders,
    ])
  ).toString('hex')}`

  return {publicHex, privateHex}
}

function isDraftFlip(flip) {
  return DRAFT_FLIP_TYPES.includes(String(flip?.type || '').toLowerCase())
}

function extraFlipsForState(state) {
  return (
    EXTRA_FLIPS_BY_STATE[
      String(state || '')
        .trim()
        .toLowerCase()
    ] || 0
  )
}

function dayKey(value) {
  const date = new Date(value)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function remainingDailyBudget(settings, state, now = Date.now()) {
  const entries = Object.entries(state || {}).flatMap(([key, value]) =>
    key === LEDGER_KEY || key.endsWith('validation-ai-cost-ledger')
      ? value?.entries || []
      : []
  )
  const spent = entries.reduce((total, entry) => {
    if (dayKey(entry.time) !== dayKey(now)) return total
    const cost = Number(entry.actualUsd ?? entry.estimatedUsd ?? 0)
    return total + (Number.isFinite(cost) && cost > 0 ? cost : 0)
  }, 0)
  const limit = Number(settings.providerDailyBudgetUsd)
  // Unattended generation always has a finite cap, even if manual calls have
  // explicitly disabled the guardrail. It never raises the configured limit.
  return Math.max(0, (Number.isFinite(limit) && limit > 0 ? limit : 15) - spent)
}

function selectMissingPairs(identity, drafts, sessionEndedAt) {
  const pairs = identity.flipKeyWordPairs || []
  const currentDrafts = drafts.filter(
    (draft) =>
      isDraftFlip(draft) && Date.parse(draft.createdAt) >= sessionEndedAt
  )
  const occupied = new Set(
    currentDrafts.map((draft) => String(draft.keywordPairId))
  )
  const reservedDrafts = pairs.filter(
    (pair) => !pair.used && occupied.has(String(pair.id))
  ).length
  const published = Math.max(
    Array.isArray(identity.flips) ? identity.flips.length : 0,
    pairs.filter((pair) => pair.used).length
  )
  const required = Number(identity.requiredFlips)
  if (
    !Number.isSafeInteger(required) ||
    required < 0 ||
    required > pairs.length
  )
    return []
  const target = Math.min(
    required + extraFlipsForState(identity.state),
    pairs.length
  )
  return pairs
    .filter((pair) => !pair.used && !occupied.has(String(pair.id)))
    .slice(0, Math.max(0, target - published - reservedDrafts))
}

function normalizePanelImages(response, nativeImage) {
  const panels = response?.panels || []
  if (![1, 4].includes(panels.length))
    throw new Error('Four generated panels are required')
  function decode(panel) {
    const data = panel?.imageDataUrl || ''
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(data))
      throw new Error('Invalid generated image')
    const image = nativeImage.createFromDataURL(data)
    if (image.isEmpty()) throw new Error('Unable to decode generated image')
    return image
  }
  function fit(image, width, height) {
    const size = image.getSize()
    const scale = Math.max(width / size.width, height / size.height)
    const scaled = image.resize({
      width: Math.ceil(size.width * scale),
      height: Math.ceil(size.height * scale),
      quality: 'best',
    })
    const next = scaled.getSize()
    return scaled.crop({
      x: Math.floor((next.width - width) / 2),
      y: Math.floor((next.height - height) / 2),
      width,
      height,
    })
  }
  const images =
    panels.length === 4
      ? panels.map(decode)
      : (() => {
          const sheet = fit(decode(panels[0]), 480, 360)
          return [0, 1, 2, 3].map((index) =>
            sheet.crop({
              x: (index % 2) * 240,
              y: Math.floor(index / 2) * 180,
              width: 240,
              height: 180,
            })
          )
        })()
  return images.map((image) => fit(image, 240, 180).toDataURL())
}

function createFlipGenerationRuntime({
  getSettings,
  rpc,
  bridge,
  flips,
  prepareDb,
  profilePath,
  nativeImage,
  now = Date.now,
  onFailure = () => {},
  chooseDelay,
}) {
  const statePath = path.join(profilePath, 'post-session-flips.json')

  async function readRpc(method, ...params) {
    const response = await rpc({method, params})
    if (response?.error || response?.result == null)
      throw new Error('Post-session node snapshot unavailable')
    return response.result
  }

  async function snapshot() {
    const settings = getSettings().aiSolver || {}
    if (!settings.enabled || !settings.postSessionFlipGenerationEnabled)
      return {enabled: false}
    const sync = await readRpc('bcn_syncing')
    if (
      sync.syncing !== false ||
      sync.wrongTime ||
      !(sync.currentBlock > 0) ||
      sync.currentBlock < sync.highestBlock
    )
      return {enabled: true, ready: false}
    const epoch = await readRpc('dna_epoch')
    if (epoch.currentPeriod !== 'None')
      return {enabled: true, ready: true, period: epoch.currentPeriod}
    const address = await readRpc('dna_getCoinbaseAddr')
    const identity = await readRpc('dna_identity', address)
    if (!['Newbie', 'Verified', 'Human'].includes(identity.state))
      return {enabled: true, ready: false}
    const epochBlock = await readRpc('bcn_blockAt', epoch.startBlock)
    const latestEpoch = await readRpc('dna_epoch')
    if (
      latestEpoch.epoch !== epoch.epoch ||
      latestEpoch.currentPeriod !== 'None' ||
      latestEpoch.startBlock !== epoch.startBlock
    )
      return {enabled: true, ready: false}
    const sessionEndedAt = Number(epochBlock.timestamp) * 1000
    const sessionId = crypto
      .createHash('sha256')
      .update(`${epochBlock.hash}:${address.toLowerCase()}`)
      .digest('hex')
    return {
      enabled: true,
      ready: true,
      period: epoch.currentPeriod,
      epoch: epoch.epoch,
      sessionId,
      sessionEndedAt,
      settings,
      missingPairs: selectMissingPairs(
        identity,
        flips.getFlips(),
        sessionEndedAt
      ),
    }
  }

  function save(state) {
    const temporary = `${statePath}.tmp`
    const fd = fs.openSync(temporary, 'w', 0o600)
    try {
      fs.writeFileSync(fd, JSON.stringify(state))
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(temporary, statePath)
  }

  function budgetPayload(settings) {
    const remaining = remainingDailyBudget(
      settings,
      prepareDb('validationResults').getState(),
      now()
    )
    if (remaining <= 0) throw new Error('Local provider daily budget exhausted')
    return {
      providerDailyBudgetEnabled: true,
      providerDailyBudgetRemainingUsd: remaining,
    }
  }

  function recordCost(response, action, provider, model) {
    const db = prepareDb('validationResults')
    const ledger = db.get(LEDGER_KEY).value() || {version: 1, entries: []}
    const costs = response?.costs || {}
    const entry = {
      id: crypto.randomUUID(),
      time: new Date(now()).toISOString(),
      source: 'post-session-flips',
      action,
      provider,
      model,
      actualUsd: costs.actualUsd ?? null,
      estimatedUsd: costs.estimatedUsd ?? null,
      tokenUsage: response?.tokenUsage || {},
    }
    db.set(LEDGER_KEY, {
      ...ledger,
      updatedAt: entry.time,
      entries: [entry, ...ledger.entries].slice(0, 250),
    }).write()
  }

  async function stillNeeded(pair, current) {
    const latest = await snapshot()
    if (
      !latest.ready ||
      latest.sessionId !== current.sessionId ||
      !latest.missingPairs.some((item) => item.id === pair.id)
    ) {
      throw new Error(
        'Generation cancelled because the session or required flips changed'
      )
    }
  }

  async function generate(pair, current) {
    await stillNeeded(pair, current)
    const {settings} = current
    const words = await Promise.all(
      pair.words.map(async (id) => {
        const word = await readRpc('bcn_keyWord', id)
        if (!word.Name) throw new Error('Node keywords are unavailable')
        return {id, name: word.Name, desc: word.Desc || ''}
      })
    )
    const keywords = words.map((word) => word.name)
    const provider = settings.flipBuilderStoryProvider || 'openai'
    const model =
      settings.flipBuilderStoryModel || DEFAULT_STORY_MODELS[provider]
    const imageProvider = settings.flipBuilderImageProvider || 'openai'
    const imageModel = settings.flipBuilderImageModel || 'gpt-image-2'
    const fast = settings.flipBuilderGenerationMode !== 'strict'
    function providerConfig(selectedProvider) {
      return selectedProvider === 'openai-compatible'
        ? {
            baseUrl: settings.customProviderBaseUrl,
            chatPath: settings.customProviderChatPath,
          }
        : undefined
    }
    const story = await bridge.generateStoryOptions({
      ...budgetPayload(settings),
      provider,
      model,
      providerConfig: providerConfig(provider),
      keywords,
      storyOptionCount: 1,
      fastStoryMode: fast,
      disableLocalFallback: true,
      includeNoise: false,
      requestTimeoutMs: 90000,
      maxRetries: 1,
    })
    recordCost(story, 'story', provider, model)
    const selected = story?.stories?.[0]
    if (
      !story.ok ||
      !selected ||
      selected.isStoryboardStarter ||
      selected.isWeakStoryDraft ||
      selected.panels?.length !== 4
    ) {
      throw new Error('Generation did not produce a usable story')
    }
    await stillNeeded(pair, current)
    const rendered = await bridge.generateFlipPanels({
      ...budgetPayload(settings),
      provider,
      providerConfig: providerConfig(provider),
      model,
      imageProvider,
      imageProviderConfig: providerConfig(imageProvider),
      textAuditModel: model,
      validatorModel: model,
      sequenceAuditModel: model,
      imageModel,
      imageQuality: settings.flipBuilderImageQuality || 'low',
      imageSize: settings.flipBuilderImageSize || '1024x1024',
      keywords,
      storyPanels: selected.panels,
      storyOptions: story.stories,
      selectedStoryId: selected.id,
      senseSelection: selected.senseSelection,
      fastBuild: fast,
      panelRenderMode: fast ? 'sheet_fast' : 'panels',
      textAuditEnabled: !fast,
      validatorEnabled: !fast,
      renderFeedbackEnabled: true,
      includeNoise: false,
      regenerateIndices: [0, 1, 2, 3],
      requestTimeoutMs: 90000,
      maxRetries: 1,
    })
    recordCost(rendered, 'images', imageProvider, imageModel)
    if (!rendered.ok)
      throw new Error('Generation did not produce usable images')
    const images = normalizePanelImages(rendered, nativeImage)
    await stillNeeded(pair, current)
    const draftId = `scheduled-${current.sessionId}-${pair.id}`
    if (flips.getFlips().some((draft) => draft.id === draftId)) return
    flips.addDraft({
      id: draftId,
      type: 'draft',
      createdAt: new Date(now()).toISOString(),
      epoch: current.epoch,
      keywordPairId: pair.id,
      keywords: {words, translations: [[], []]},
      images,
      protectedImages: images,
      originalOrder: [0, 1, 2, 3],
      order: [0, 1, 2, 3],
      orderPermutations: [0, 1, 2, 3],
      adversarialImageId: -1,
    })
  }

  function pendingDrafts(current) {
    return flips
      .getFlips()
      .filter(
        (flip) =>
          String(flip.id || '').startsWith('scheduled-') &&
          String(flip.type || '').toLowerCase() === 'draft' &&
          Number(flip.epoch) === Number(current.epoch)
      )
  }

  async function publishDraft(draft) {
    const images = (draft.protectedImages || draft.images || []).slice(0, 4)
    if (images.length !== 4) {
      throw new Error('Scheduled draft needs four panels')
    }
    const originalOrder = Array.isArray(draft.originalOrder)
      ? draft.originalOrder
      : [0, 1, 2, 3]
    const shuffledOrder = pickPanelShuffle(originalOrder)
    const payload = buildFlipSubmitPayload(
      images.map(panelBytes),
      shuffledOrder
    )
    const submitted = await readRpc('flip_submit', {
      publicHex: payload.publicHex,
      privateHex: payload.privateHex,
      pairId: Number(draft.keywordPairId),
    })
    flips.updateDraft({
      id: draft.id,
      type: 'published',
      hash: String((submitted && submitted.hash) || ''),
      txHash: String((submitted && submitted.txHash) || ''),
      order: shuffledOrder,
      orderPermutations: shuffledOrder,
      modifiedAt: new Date(now()).toISOString(),
    })
    return submitted
  }

  // Publishes one prepared draft per call so the ordinary 30s tick shuffles and
  // submits scheduled flips without a separate timer.
  async function publishPending() {
    const current = await snapshot()
    if (!current.enabled || !current.ready || current.period !== 'None') {
      return 'skipped'
    }
    const [draft] = pendingDrafts(current)
    if (!draft) return 'idle'
    try {
      await publishDraft(draft)
      return 'published'
    } catch (error) {
      onFailure('publish_failed', error)
      return 'publish_failed'
    }
  }

  const scheduler = createFlipGenerationScheduler({
    snapshot,
    generate,
    now,
    chooseDelay,
    onFailure,
    save,
    load: () =>
      fs.existsSync(statePath)
        ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
        : {},
  })

  return {...scheduler, publishPending}
}

module.exports = {
  createFlipGenerationRuntime,
  remainingDailyBudget,
  selectMissingPairs,
  normalizePanelImages,
}
