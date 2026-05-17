const {
  buildRehearsalNetworkPayload,
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
})
