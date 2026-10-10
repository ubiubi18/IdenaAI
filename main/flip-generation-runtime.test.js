/** @jest-environment node */
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  createFlipGenerationRuntime,
  normalizePanelImages,
  remainingDailyBudget,
  selectMissingPairs,
} = require('./flip-generation-runtime')

const TEST_CID = 'bafkreiabaeaqcaibaeaqcaibaeaqcaibaeaqcaibaeaqcaibaeaqcaibae'

function passingStory(overrides = {}) {
  return {
    id: 'story',
    panels: [
      'A baker puts a bell beside a basket.',
      'The baker lifts the basket and bumps the bell.',
      'The bell falls from the counter.',
      'The baker catches the bell inside the basket.',
    ],
    complianceReport: Object.fromEntries(
      [
        'keyword_relevance',
        'no_text_needed',
        'no_order_labels',
        'no_inappropriate_content',
        'single_story_only',
        'no_waking_up_template',
        'no_thumbs_up_down',
        'no_enumeration_logic',
        'no_screen_or_page_keyword_cheat',
        'causal_clarity',
        'consensus_clarity',
        'age_12_clarity',
        'everyday_knowledge_only',
        'large_visual_cues',
        'simple_action_chain',
        'obvious_final_outcome',
      ].map((key) => [key, 'pass'])
    ),
    qualityReport: {score: 91, failures: []},
    ...overrides,
  }
}

function passingRender(overrides = {}) {
  return {
    ok: true,
    panels: Array.from({length: 4}, () => ({
      imageDataUrl: 'data:image/png;base64,AA==',
    })),
    validatorAuditByPanel: Array.from({length: 4}, () => ({
      invoked: true,
      passed: true,
      ocr_text_check: {status: 'pass', passed: true},
      keyword_visibility_check: {status: 'pass', passed: true},
      alignment_check: {status: 'pass', passed: true},
      policy_risk_check: {status: 'pass', passed: true},
    })),
    sequenceAudit: {
      invoked: true,
      complete: true,
      passed: true,
      verdict: 'accept',
      safeShuffleOrder: [2, 0, 3, 1],
    },
    renderFeedback: {verdict: 'accept_rendered_story'},
    costs: {actualUsd: 0.4},
    ...overrides,
  }
}

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
    rpc = jest.fn(async ({method, params}) => ({
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
        bcn_keyWord: {
          Name: params[0] % 2 === 0 ? 'bell' : 'basket',
          Desc: 'fixture',
        },
        flip_submit: {hash: TEST_CID, txHash: `0x${'c'.repeat(64)}`},
      }[method],
    }))
    bridge = {
      generateStoryOptions: jest.fn().mockResolvedValue({
        ok: true,
        stories: [passingStory()],
        costs: {actualUsd: 0.3},
      }),
      generateFlipPanels: jest.fn().mockResolvedValue(passingRender()),
    }
    const fakeImage = {
      isEmpty: () => false,
      getSize: () => ({width: 240, height: 180}),
      resize: () => fakeImage,
      crop: () => fakeImage,
      toBitmap: () => Buffer.alloc(240 * 180 * 4, 255),
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
      nativeImage: {
        createFromDataURL: () => fakeImage,
        createFromBitmap: () => fakeImage,
      },
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
        fastBuild: false,
        panelRenderMode: 'sheet_audited',
        validatorEnabled: true,
        sequenceAuditEnabled: true,
        sequenceAuditShuffleCandidates: expect.arrayContaining([[2, 0, 3, 1]]),
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
    expect(drafts[0].autoPublishAudit).toMatchObject({
      version: 1,
      shuffleOrder: [2, 0, 3, 1],
      imageDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
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
  it('chooses an audited story and rejects a weak first option', async () => {
    bridge.generateStoryOptions.mockResolvedValue({
      ok: true,
      stories: [
        passingStory({id: 'weak', qualityReport: {score: 60, failures: []}}),
        passingStory({id: 'clear'}),
      ],
      costs: {actualUsd: 0.3},
    })

    await createFlipGenerationRuntime(options).tick()

    expect(bridge.generateStoryOptions).toHaveBeenCalledWith(
      expect.objectContaining({storyOptionCount: 2, fastStoryMode: false})
    )
    expect(bridge.generateFlipPanels).toHaveBeenCalledWith(
      expect.objectContaining({selectedStoryId: 'clear'})
    )
    expect(drafts).toHaveLength(1)
  })

  it('stops before images when no story passes the existing quality gate', async () => {
    bridge.generateStoryOptions.mockResolvedValue({
      ok: true,
      stories: [passingStory({qualityReport: {score: 40, failures: []}})],
      costs: {actualUsd: 0.3},
    })

    expect(await createFlipGenerationRuntime(options).tick()).toBe('scheduled')
    expect(bridge.generateFlipPanels).not.toHaveBeenCalled()
    expect(drafts).toHaveLength(0)
  })

  it('stops before saving a draft when the rendered sequence is rejected', async () => {
    bridge.generateFlipPanels.mockResolvedValue(
      passingRender({
        sequenceAudit: {
          invoked: true,
          complete: true,
          passed: false,
          verdict: 'replan',
          safeShuffleOrder: null,
        },
      })
    )

    expect(await createFlipGenerationRuntime(options).tick()).toBe('scheduled')
    expect(drafts).toHaveLength(0)
    expect(
      rpc.mock.calls.some(([payload]) => payload.method === 'flip_submit')
    ).toBe(false)
  })
  it('does not accept a composite sheet as four audited panels', async () => {
    bridge.generateFlipPanels.mockResolvedValue(
      passingRender({
        panels: [{imageDataUrl: 'data:image/png;base64,AA=='}],
      })
    )

    expect(await createFlipGenerationRuntime(options).tick()).toBe('scheduled')
    expect(drafts).toHaveLength(0)
  })
  it('blocks generation when the existing daily ledger is exhausted', async () => {
    db['ai-provider-daily-budget-ledger'] = {
      entries: [{time: new Date(time).toISOString(), actualUsd: 1}],
    }
    expect(await createFlipGenerationRuntime(options).tick()).toBe(
      'waiting_budget'
    )
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
        stories: [passingStory()],
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

  it('submits only the audited shuffle for a generated draft', async () => {
    const runtime = createFlipGenerationRuntime(options)
    await runtime.tick()
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
      hash: TEST_CID,
      txHash: `0x${'c'.repeat(64)}`,
    })
    expect(drafts[0].order).toEqual([2, 0, 3, 1])
    expect(drafts[0].orderPermutations).toEqual(drafts[0].order)
  })

  it('does not publish an older scheduled draft without audit evidence', async () => {
    drafts.push({
      id: 'scheduled-legacy-0',
      type: 'draft',
      epoch: 42,
      keywordPairId: 0,
      originalOrder: [0, 1, 2, 3],
      images: Array.from({length: 4}, () => 'data:image/png;base64,AA=='),
      protectedImages: Array.from(
        {length: 4},
        () => 'data:image/png;base64,AA=='
      ),
    })

    expect(await createFlipGenerationRuntime(options).publishPending()).toBe(
      'idle'
    )
    expect(
      rpc.mock.calls.some(([payload]) => payload.method === 'flip_submit')
    ).toBe(false)
  })

  it.each(['image', 'shuffle', 'original order'])(
    'does not publish when the audited %s changes in the saved draft',
    async (changed) => {
      const runtime = createFlipGenerationRuntime(options)
      await runtime.tick()
      if (changed === 'image') {
        drafts[0].protectedImages[0] = 'data:image/png;base64,AQ=='
      } else if (changed === 'shuffle') {
        drafts[0].autoPublishAudit.shuffleOrder = [3, 1, 0, 2]
      } else {
        drafts[0].originalOrder = [1, 0, 2, 3]
      }

      expect(await runtime.publishPending()).toBe('publish_failed')
      expect(
        rpc.mock.calls.some(([payload]) => payload.method === 'flip_submit')
      ).toBe(false)
    }
  )

  it('uses spare node pairs after exhausting quality attempts without reducing the target', () => {
    expect(
      selectMissingPairs(
        {state: 'Newbie', requiredFlips: 2, flips: [], flipKeyWordPairs: pairs},
        [],
        end,
        [0]
      ).map(({id}) => id)
    ).toEqual([1, 2])
  })

  it('does not publish a same-epoch draft from another session or changed keyword assignment', async () => {
    const runtime = createFlipGenerationRuntime(options)
    await runtime.tick()
    const {id} = drafts[0]
    drafts[0].id = 'scheduled-other-session-0'
    expect(await runtime.publishPending()).toBe('idle')
    drafts[0].id = id
    drafts[0].keywords.words[0].id = 999
    expect(await runtime.publishPending()).toBe('idle')
    expect(
      rpc.mock.calls.some(([payload]) => payload.method === 'flip_submit')
    ).toBe(false)
  })

  it('durably claims a submission before RPC and prevents overlapping or restarted retries', async () => {
    const runtime = createFlipGenerationRuntime(options)
    await runtime.tick()
    const read = rpc.getMockImplementation()
    let rejectSubmit
    rpc.mockImplementation(async (payload) => {
      if (payload.method !== 'flip_submit') return read(payload)
      expect(drafts[0].autoPublishSubmission.status).toBe('submitting')
      return new Promise((resolve, reject) => {
        rejectSubmit = reject
      })
    })
    const pending = runtime.publishPending()
    while (!rejectSubmit) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setImmediate(resolve)
      })
    }
    expect(await runtime.publishPending()).toBe('busy')
    expect(await createFlipGenerationRuntime(options).publishPending()).toBe(
      'idle'
    )
    rejectSubmit(new Error('response lost after submission'))
    expect(await pending).toBe('publish_failed')
    expect(drafts[0].autoPublishSubmission.status).toBe('unknown')
    expect(await createFlipGenerationRuntime(options).publishPending()).toBe(
      'idle'
    )
    expect(
      rpc.mock.calls.filter(([payload]) => payload.method === 'flip_submit')
    ).toHaveLength(1)
  })

  it('quarantines an invalid audit and allows a later valid draft to publish', async () => {
    settings.providerDailyBudgetUsd = 5
    const runtime = createFlipGenerationRuntime(options)
    await runtime.tick()
    await runtime.tick()
    drafts[0].autoPublishAudit.imageDigest = 'changed'
    expect(await runtime.publishPending()).toBe('publish_failed')
    expect(await runtime.publishPending()).toBe('published')
    expect(drafts[0].autoPublishSubmission.status).toBe('audit_failed')
    expect(drafts[1].type).toBe('published')
  })

  it.each([{hash: TEST_CID}, {hash: 'invalid', txHash: `0x${'c'.repeat(64)}`}])(
    'retains an incomplete submission result for reconciliation',
    async (result) => {
      const runtime = createFlipGenerationRuntime(options)
      await runtime.tick()
      const read = rpc.getMockImplementation()
      rpc.mockImplementation((payload) =>
        payload.method === 'flip_submit'
          ? Promise.resolve({result})
          : read(payload)
      )
      expect(await runtime.publishPending()).toBe('publish_failed')
      expect(drafts[0].type).toBe('draft')
      expect(drafts[0].autoPublishSubmission.status).toBe('unknown')
      expect(await runtime.publishPending()).toBe('idle')
    }
  )

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

describe('scheduled panel normalization', () => {
  it('keeps the edges of each audited panel inside a padded 240x180 image', () => {
    const edge = [20, 40, 60, 255]
    const pixels = Buffer.alloc(180 * 180 * 4, 255)
    edge.forEach((byte, index) => {
      pixels[index] = byte
      pixels[(180 * 180 - 1) * 4 + index] = byte
    })
    const crop = jest.fn(() => {
      throw new Error('Audited panels must not be cropped')
    })
    const scaled = {
      getSize: () => ({width: 180, height: 180}),
      toBitmap: () => pixels,
    }
    const image = {
      isEmpty: () => false,
      getSize: () => ({width: 1024, height: 1024}),
      resize: jest.fn(() => scaled),
      crop,
    }
    const bitmaps = []
    const nativeImage = {
      createFromDataURL: () => image,
      createFromBitmap: (bitmap, size) => {
        bitmaps.push({bitmap, size})
        return {toDataURL: () => 'data:image/png;base64,AA=='}
      },
    }

    const result = normalizePanelImages(
      {
        panels: Array.from({length: 4}, () => ({
          imageDataUrl: 'data:image/png;base64,AA==',
        })),
      },
      nativeImage
    )
    const pixelAt = (x, y) =>
      Array.from(
        bitmaps[0].bitmap.subarray((y * 240 + x) * 4, (y * 240 + x + 1) * 4)
      )

    expect(result).toHaveLength(4)
    expect(bitmaps[0].size).toEqual({width: 240, height: 180})
    expect(image.resize).toHaveBeenCalledWith({
      width: 180,
      height: 180,
      quality: 'best',
    })
    expect(pixelAt(29, 0)).toEqual([255, 255, 255, 255])
    expect(pixelAt(30, 0)).toEqual(edge)
    expect(pixelAt(209, 179)).toEqual(edge)
    expect(pixelAt(210, 179)).toEqual([255, 255, 255, 255])
    expect(crop).not.toHaveBeenCalled()
  })
})
