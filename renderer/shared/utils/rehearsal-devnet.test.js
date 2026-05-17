const {
  buildRehearsalNetworkPayload,
  buildRehearsalSolverLanePayload,
  REHEARSAL_NETWORK_LEAD_SECONDS,
  REHEARSAL_NETWORK_NODE_COUNT,
  REHEARSAL_NETWORK_SEED_FLIP_COUNT,
} = require('./rehearsal-devnet')

describe('rehearsal devnet payloads', () => {
  it('keeps the regular rehearsal timing by default', () => {
    expect(
      buildRehearsalNetworkPayload({
        connectApp: true,
      })
    ).toMatchObject({
      nodeCount: REHEARSAL_NETWORK_NODE_COUNT,
      firstCeremonyLeadSeconds: REHEARSAL_NETWORK_LEAD_SECONDS,
      seedFlipCount: REHEARSAL_NETWORK_SEED_FLIP_COUNT,
      connectApp: true,
      connectCountdownSeconds: null,
    })
  })

  it('forces remote rehearsal lanes onto the live probability ensemble path', () => {
    expect(
      buildRehearsalSolverLanePayload({
        provider: 'openai',
        model: 'gpt-5.5',
        probabilityEnsembleEnabled: false,
        probabilityRuns: 2,
        probabilityUseSwappedOrder: false,
        flipVisionMode: 'frames_two_pass',
      })
    ).toMatchObject({
      rehearsalOnly: true,
      provider: 'openai',
      model: 'gpt-5.5',
      benchmarkProfile: 'custom',
      flipVisionMode: 'composite',
      probabilityEnsembleEnabled: true,
      probabilityRuns: 2,
      probabilityUseSwappedOrder: false,
    })
  })

  it('does not mark local-ai rehearsal lanes as probability-capable', () => {
    expect(
      buildRehearsalSolverLanePayload({
        provider: 'local-ai',
      })
    ).toMatchObject({
      provider: 'local-ai',
      flipVisionMode: 'composite',
      probabilityEnsembleEnabled: false,
    })
  })
})
