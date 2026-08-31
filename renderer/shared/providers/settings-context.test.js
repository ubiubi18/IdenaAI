const {
  DEFAULT_RUN_INTERNAL_NODE,
  buildAiSolverSettings,
  buildEffectiveSettingsState,
  isManagedExternalNodeKeyImportEnabled,
  isValidationRehearsalNodeSettings,
  normalizeNodeModeSettings,
} = require('./settings-context')

describe('settings-context ai solver normalization', () => {
  it('keeps the built-in node off by default for fresh installs', () => {
    expect(DEFAULT_RUN_INTERNAL_NODE).toBe(false)
  })

  it('keeps persistent external-node mode from also starting the built-in node', () => {
    expect(
      normalizeNodeModeSettings({
        useExternalNode: true,
        runInternalNode: true,
      })
    ).toMatchObject({
      useExternalNode: true,
      runInternalNode: false,
    })
  })

  it('keeps the default system reserve for AI sessions', () => {
    expect(buildAiSolverSettings()).toMatchObject({
      model: 'gpt-5.5',
      flipBuilderStoryProvider: 'openai',
      flipBuilderStoryModel: 'gpt-5.6-sol',
      flipBuilderImageProvider: 'openai',
      flipBuilderImageModel: 'gpt-image-2',
      flipBuilderImageQuality: 'low',
      flipBuilderImageSize: '1024x1024',
      flipBuilderGenerationMode: 'fast',
      shortSessionOpenAiFastModel: 'gpt-5.5',
      probabilityReasoningEffort: 'xhigh',
      autoReportBestFlipEnabled: false,
      memoryBudgetGiB: 32,
      systemReserveGiB: 6,
      localAiMemoryReference: 'molmo2-4b',
    })
  })

  it('normalizes persisted flip-builder model policy independently', () => {
    expect(
      buildAiSolverSettings({
        flipBuilderStoryProvider: '',
        flipBuilderStoryModel: '',
        flipBuilderImageProvider: '',
        flipBuilderImageModel: '',
        flipBuilderImageQuality: 'unsupported',
        flipBuilderImageSize: '',
        flipBuilderGenerationMode: 'unsupported',
      })
    ).toMatchObject({
      flipBuilderStoryProvider: 'openai',
      flipBuilderStoryModel: 'gpt-5.6-sol',
      flipBuilderImageProvider: 'openai',
      flipBuilderImageModel: 'gpt-image-2',
      flipBuilderImageQuality: 'low',
      flipBuilderImageSize: '1024x1024',
      flipBuilderGenerationMode: 'fast',
    })
  })

  it('normalizes explicit reserve values', () => {
    expect(
      buildAiSolverSettings({
        memoryBudgetGiB: '24',
        systemReserveGiB: '7',
      })
    ).toMatchObject({
      memoryBudgetGiB: 24,
      systemReserveGiB: 7,
    })
  })

  it('falls back when the reserve is invalid', () => {
    expect(
      buildAiSolverSettings({
        systemReserveGiB: '-5',
      })
    ).toMatchObject({
      systemReserveGiB: 6,
    })
  })

  it('caps the reserve at a sane upper bound', () => {
    expect(
      buildAiSolverSettings({
        systemReserveGiB: '999',
      })
    ).toMatchObject({
      systemReserveGiB: 64,
    })
  })

  it('normalizes short-session OpenAI fast mode settings', () => {
    expect(
      buildAiSolverSettings({
        shortSessionOpenAiFastEnabled: 1,
        shortSessionOpenAiFastModel: 'not-a-model',
      })
    ).toMatchObject({
      shortSessionOpenAiFastEnabled: true,
      shortSessionOpenAiFastModel: 'gpt-5.5',
    })
  })

  it('accepts full short-session fast models', () => {
    expect(
      buildAiSolverSettings({
        shortSessionOpenAiFastEnabled: true,
        shortSessionOpenAiFastModel: 'gpt-5.6-sol',
      })
    ).toMatchObject({
      shortSessionOpenAiFastEnabled: true,
      shortSessionOpenAiFastModel: 'gpt-5.6-sol',
    })
  })

  it('normalizes the auto-report best-flip switch', () => {
    expect(
      buildAiSolverSettings({
        autoReportBestFlipEnabled: 1,
      })
    ).toMatchObject({
      autoReportBestFlipEnabled: true,
    })
  })

  it('normalizes on-chain auto-submit consent as a persisted string', () => {
    expect(
      buildAiSolverSettings({
        onchainAutoSubmitConsentAt: ' 2026-04-24T10:00:00.000Z ',
      })
    ).toMatchObject({
      onchainAutoSubmitConsentAt: '2026-04-24T10:00:00.000Z',
    })
    expect(buildAiSolverSettings()).toMatchObject({
      onchainAutoSubmitConsentAt: '',
    })
  })

  it('accepts short-session mini fast-mode selections without downgrading them', () => {
    expect(
      buildAiSolverSettings({
        shortSessionOpenAiFastEnabled: true,
        shortSessionOpenAiFastModel: 'gpt-5.5-mini',
      })
    ).toMatchObject({
      shortSessionOpenAiFastEnabled: true,
      shortSessionOpenAiFastModel: 'gpt-5.5-mini',
    })
  })

  it('migrates the old OpenAI default model to GPT-5.5', () => {
    expect(
      buildAiSolverSettings({
        provider: 'openai',
        model: 'gpt-5.4',
        shortSessionOpenAiFastModel: 'gpt-5.4-mini',
      })
    ).toMatchObject({
      provider: 'openai',
      model: 'gpt-5.5',
      shortSessionOpenAiFastModel: 'gpt-5.4-mini',
    })
  })

  it('keeps the internal node preference while routing through an ephemeral rehearsal node', () => {
    expect(
      buildEffectiveSettingsState(
        {
          runInternalNode: true,
          useExternalNode: false,
          url: 'http://localhost:9009',
          externalApiKey: '',
        },
        {
          url: 'http://127.0.0.1:22301',
          apiKey: 'rehearsal-secret',
          label: 'Validation rehearsal node',
        }
      )
    ).toMatchObject({
      runInternalNode: true,
      useExternalNode: true,
      url: 'http://127.0.0.1:22301',
      externalApiKey: 'rehearsal-secret',
      externalNodeMode: 'ephemeral',
      ephemeralExternalNodeConnected: true,
    })
  })

  it('detects rehearsal sessions from the ephemeral connection flag', () => {
    expect(
      isValidationRehearsalNodeSettings({
        useExternalNode: true,
        ephemeralExternalNodeConnected: true,
        externalNodeLabel: '',
      })
    ).toBe(true)
  })

  it('allows key import only for an explicitly managed persistent loopback node', () => {
    expect(
      isManagedExternalNodeKeyImportEnabled({
        useExternalNode: true,
        externalNodeMode: 'persistent',
        managedExternalNodeKeyImportEnabled: true,
        url: 'http://127.0.0.1:9129',
      })
    ).toBe(true)

    expect(
      isManagedExternalNodeKeyImportEnabled({
        useExternalNode: true,
        externalNodeMode: 'persistent',
        managedExternalNodeKeyImportEnabled: true,
        url: 'http://[::1]:9129',
      })
    ).toBe(true)
  })

  it.each([
    ['missing operator opt-in', false, 'http://127.0.0.1:9129'],
    ['remote host', true, 'https://node.example.org'],
    ['loopback lookalike', true, 'http://127.0.0.1.example.org:9129'],
    ['embedded credentials', true, 'http://user:pass@127.0.0.1:9129'],
    ['unexpected path', true, 'http://127.0.0.1:9129/rpc'],
    ['unexpected query', true, 'http://127.0.0.1:9129/?target=remote'],
  ])('blocks managed key import for %s', (_label, enabled, url) => {
    expect(
      isManagedExternalNodeKeyImportEnabled({
        useExternalNode: true,
        externalNodeMode: 'persistent',
        managedExternalNodeKeyImportEnabled: enabled,
        url,
      })
    ).toBe(false)
  })

  it('blocks key import for ephemeral rehearsal nodes', () => {
    expect(
      isManagedExternalNodeKeyImportEnabled({
        useExternalNode: true,
        externalNodeMode: 'ephemeral',
        managedExternalNodeKeyImportEnabled: true,
        url: 'http://127.0.0.1:9129',
      })
    ).toBe(false)
  })
})
