/** @jest-environment node */
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  createFlipGenerationRuntime,
  remainingDailyBudget,
  selectMissingPairs,
} = require('./flip-generation-runtime')

describe('scheduled generation runtime', () => {
  const end = 1800000000000
  const pairs = [
    {id: 0, words: [10, 11], used: false},
    {id: 1, words: [12, 13], used: false},
    {id: 2, words: [14, 15], used: false},
  ]
  let directory
  let drafts
  let db
  let rpc
  let bridge
  let settings
  let time
  let options
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flip-scheduler-test-'))
    drafts = []
    db = {}
    time = end + 1800000
    settings = {
      enabled: true,
      postSessionFlipGenerationEnabled: true,
      providerDailyBudgetUsd: 1,
    }
    rpc = jest.fn(async ({method}) => ({
      result: {
        bcn_syncing: {syncing: false, currentBlock: 100, highestBlock: 100},
        dna_epoch: {epoch: 42, startBlock: 90, currentPeriod: 'None'},
        dna_getCoinbaseAddr: 'synthetic-identity',
        dna_identity: {
          state: 'Human',
          requiredFlips: 2,
          flips: [],
          flipKeyWordPairs: pairs,
        },
        bcn_blockAt: {
          hash: 'synthetic-block',
          timestamp: end / 1000,
          height: 90,
        },
        bcn_keyWord: {Name: 'synthetic word', Desc: 'fixture'},
        flip_submit: {hash: 'bafkrei-fixture', txHash: `0x${'c'.repeat(64)}`},
      }[method],
    }))
    bridge = {
      generateStoryOptions: jest.fn().mockResolvedValue({
        ok: true,
        stories: [{id: 'story', panels: ['a', 'b', 'c', 'd']}],
        costs: {actualUsd: 0.3},
      }),
      generateFlipPanels: jest.fn().mockResolvedValue({
        ok: true,
        panels: Array.from({length: 4}, () => ({
          imageDataUrl: 'data:image/png;base64,AA==',
        })),
        costs: {actualUsd: 0.4},
      }),
    }
    const fakeImage = {
      isEmpty: () => false,
      getSize: () => ({width: 240, height: 180}),
      resize: () => fakeImage,
      crop: () => fakeImage,
      toDataURL: () => 'data:image/png;base64,AA==',
    }
    options = {
      getSettings: () => ({aiSolver: settings}),
      rpc,
      bridge,
      flips: {
        getFlips: () => drafts,
        addDraft: (draft) => drafts.push(draft),
        updateDraft: (draft) => {
          const index = drafts.findIndex((item) => item.id === draft.id)
          drafts[index] = {...drafts[index], ...draft}
        },
      },
      profilePath: directory,
      nativeImage: {createFromDataURL: () => fakeImage},
      now: () => time,
      chooseDelay: () => 1800000,
      prepareDb: () => ({
        getState: () => db,
        get: (key) => ({value: () => db[key]}),
        set: (key, value) => ({
          write: () => {
            db[key] = value
          },
        }),
      }),
    }
  })
  afterEach(() => fs.rmSync(directory, {recursive: true, force: true}))
  it('uses DeepSeek for scheduled stories and audits with a separate image provider', async () => {
    settings.flipBuilderStoryProvider = 'deepseek'
    settings.flipBuilderImageProvider = 'openai'
    await createFlipGenerationRuntime(options).tick()
    expect(bridge.generateStoryOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'deepseek',
        model: 'deepseek-flash',
      })
    )
    expect(bridge.generateFlipPanels).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'deepseek',
        model: 'deepseek-flash',
        imageProvider: 'openai',
        validatorModel: 'deepseek-flash',
        sequenceAuditModel: 'deepseek-flash',
      })
    )
    expect(drafts).toHaveLength(1)
  })
  it('creates a reviewable draft through the existing providers and records their costs', async () => {
    await createFlipGenerationRuntime(options).tick()
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      type: 'draft',
      keywordPairId: 0,
      epoch: 42,
      order: [0, 1, 2, 3],
    })
    expect(drafts[0].images).toHaveLength(4)
    expect(
      bridge.generateFlipPanels.mock.calls[0][0].providerDailyBudgetRemainingUsd
    ).toBeCloseTo(0.7)
    expect(remainingDailyBudget(settings, db, time)).toBeCloseTo(0.3)
    expect(
      rpc.mock.calls.some(([payload]) =>
        /submit|send|export/i.test(payload.method)
      )
    ).toBe(false)
    expect(
      fs
        .statSync(path.join(directory, 'post-session-flips.json'))
        .mode.toString(8)
        .slice(-3)
    ).toBe('600')
  })
  it('blocks generation when the existing daily ledger is exhausted', async () => {
    db['ai-provider-daily-budget-ledger'] = {
      entries: [{time: new Date(time).toISOString(), actualUsd: 1}],
    }
    expect(await createFlipGenerationRuntime(options).tick()).toBe('failed')
    expect(bridge.generateStoryOptions).not.toHaveBeenCalled()
    expect(drafts).toHaveLength(0)
  })
  it('counts validation spending alongside generation and rolls over each local day', () => {
    const date = new Date(time).toISOString()
    db['scope-validation-ai-cost-ledger'] = {
      entries: [{time: date, actualUsd: 0.8}],
    }
    db['ai-provider-daily-budget-ledger'] = {
      entries: [{time: date, estimatedUsd: 0.2}],
    }
    expect(remainingDailyBudget(settings, db, time)).toBe(0)
    expect(remainingDailyBudget(settings, db, time + 86400000)).toBe(1)
  })
  it('stops before the image request when a manual draft filled that pair', async () => {
    bridge.generateStoryOptions.mockImplementation(async () => {
      drafts.push({
        type: 'draft',
        createdAt: new Date(time).toISOString(),
        keywordPairId: 0,
      })
      return {
        ok: true,
        stories: [{id: 'story', panels: ['a', 'b', 'c', 'd']}],
        costs: {actualUsd: 0.3},
      }
    })
    await createFlipGenerationRuntime(options).tick()
    expect(bridge.generateFlipPanels).not.toHaveBeenCalled()
    expect(drafts).toHaveLength(1)
  })
  it('preserves manual drafts and ignores archived drafts from the previous epoch', () => {
    const identity = {
      state: 'Newbie',
      requiredFlips: 2,
      flips: [],
      flipKeyWordPairs: pairs,
    }
    const stored = [
      {
        keywordPairId: 0,
        type: 'draft',
        createdAt: new Date(end + 1).toISOString(),
      },
      {
        keywordPairId: 1,
        type: 'archived',
        createdAt: new Date(end - 1).toISOString(),
      },
    ]
    expect(
      selectMissingPairs(identity, stored, end).map((pair) => pair.id)
    ).toEqual([1])
  })

  it('adds one extra flip for verified and two for human identities', () => {
    const buildPairs = (count) =>
      Array.from({length: count}, (_, id) => ({
        id,
        words: [10 + id, 100 + id],
        used: false,
      }))
    const requiredOnly = {
      state: 'Newbie',
      requiredFlips: 3,
      flips: [],
      flipKeyWordPairs: buildPairs(9),
    }
    const verified = {...requiredOnly, state: 'Verified'}
    const human = {...requiredOnly, state: 'Human'}

    expect(selectMissingPairs(requiredOnly, [], end).map(({id}) => id)).toEqual(
      [0, 1, 2]
    )
    expect(selectMissingPairs(verified, [], end).map(({id}) => id)).toEqual([
      0, 1, 2, 3,
    ])
    expect(selectMissingPairs(human, [], end).map(({id}) => id)).toEqual([
      0, 1, 2, 3, 4,
    ])
  })

  it('caps the extra flips at the available keyword pairs', () => {
    const identity = {
      state: 'Human',
      requiredFlips: 3,
      flips: [],
      flipKeyWordPairs: Array.from({length: 4}, (_, id) => ({
        id,
        words: [10 + id, 100 + id],
        used: false,
      })),
    }

    expect(selectMissingPairs(identity, [], end).map(({id}) => id)).toEqual([
      0, 1, 2, 3,
    ])
  })

  it('counts published flips against the extra target', () => {
    const identity = {
      state: 'Verified',
      requiredFlips: 3,
      flips: [{id: 'published-one'}],
      flipKeyWordPairs: Array.from({length: 9}, (_, id) => ({
        id,
        words: [10 + id, 100 + id],
        used: false,
      })),
    }

    expect(selectMissingPairs(identity, [], end).map(({id}) => id)).toEqual([
      0, 1, 2,
    ])
  })

  it('shuffles and submits a prepared draft through the node', async () => {
    drafts.push({
      id: 'scheduled-fixture-0',
      type: 'draft',
      epoch: 42,
      keywordPairId: 0,
      originalOrder: [0, 1, 2, 3],
      order: [0, 1, 2, 3],
      orderPermutations: [0, 1, 2, 3],
      images: Array.from({length: 4}, () => 'data:image/png;base64,AA=='),
      protectedImages: Array.from(
        {length: 4},
        () => 'data:image/png;base64,AA=='
      ),
    })

    const runtime = createFlipGenerationRuntime(options)
    const result = await runtime.publishPending()

    expect(result).toBe('published')
    expect(rpc).toHaveBeenCalledWith({
      method: 'flip_submit',
      params: [
        expect.objectContaining({
          pairId: 0,
          publicHex: expect.stringMatching(/^0x[0-9a-f]+$/),
          privateHex: expect.stringMatching(/^0x[0-9a-f]+$/),
        }),
      ],
    })
    expect(drafts[0]).toMatchObject({
      type: 'published',
      hash: 'bafkrei-fixture',
      txHash: `0x${'c'.repeat(64)}`,
    })
    expect(drafts[0].order).not.toEqual([0, 1, 2, 3])
    expect(drafts[0].orderPermutations).toEqual(drafts[0].order)
  })

  it('ignores drafts of other epochs and identities that cannot validate', async () => {
    drafts.push({
      id: 'scheduled-old-0',
      type: 'draft',
      epoch: 41,
      keywordPairId: 0,
      images: Array.from({length: 4}, () => 'data:image/png;base64,AA=='),
      protectedImages: Array.from(
        {length: 4},
        () => 'data:image/png;base64,AA=='
      ),
    })

    expect(await createFlipGenerationRuntime(options).publishPending()).toBe(
      'idle'
    )

    rpc.mockImplementation(async ({method}) => ({
      result: {
        bcn_syncing: {syncing: false, currentBlock: 100, highestBlock: 100},
        dna_epoch: {epoch: 42, startBlock: 90, currentPeriod: 'None'},
        dna_getCoinbaseAddr: 'synthetic-identity',
        dna_identity: {
          state: 'Suspended',
          requiredFlips: 0,
          flips: [],
          flipKeyWordPairs: [],
        },
      }[method],
    }))

    expect(await createFlipGenerationRuntime(options).publishPending()).toBe(
      'skipped'
    )
  })
})
