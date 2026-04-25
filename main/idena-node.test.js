const {
  __test__: {
    isPeerHintRetryable,
    mergePeerHints,
    normalizePeerHint,
    sortPeerHintsForRetry,
    toBootstrapPeerHints,
  },
} = require('./idena-node')

describe('idena node peer hints', () => {
  const now = Date.parse('2026-04-25T10:00:00.000Z')

  it('normalizes p2p multiaddrs into ipfs peer hints', () => {
    expect(
      normalizePeerHint('/ip4/127.0.0.1/tcp/40405/p2p/QmRuntimePeer')
    ).toMatchObject({
      addr: '/ip4/127.0.0.1/tcp/40405/ipfs/QmRuntimePeer',
      source: 'cache',
      network: 'mainnet',
      failures: 0,
    })
  })

  it('rebuilds full peer hints from net_peers addr and id fields', () => {
    expect(
      normalizePeerHint({
        id: 'QmRuntimePeer',
        addr: '/ip4/127.0.0.1/tcp/40405',
      })
    ).toMatchObject({
      addr: '/ip4/127.0.0.1/tcp/40405/ipfs/QmRuntimePeer',
      network: 'mainnet',
    })
  })

  it('prefers fresh runtime peers before static bootstrap fallbacks', () => {
    const sorted = sortPeerHintsForRetry(
      [
        ...toBootstrapPeerHints([
          '/ip4/2.2.2.2/tcp/40405/ipfs/QmBootstrapPeer',
        ]),
        {
          addr: '/ip4/1.1.1.1/tcp/40405/ipfs/QmRuntimePeer',
          source: 'runtime',
          lastSeenAt: '2026-04-25T09:59:00.000Z',
        },
        {
          addr: '/ip4/3.3.3.3/tcp/40405/ipfs/QmStaleRuntimePeer',
          source: 'runtime',
          lastSeenAt: '2026-04-20T09:59:00.000Z',
        },
      ],
      now
    )

    expect(sorted.map(({addr}) => addr)).toEqual([
      '/ip4/1.1.1.1/tcp/40405/ipfs/QmRuntimePeer',
      '/ip4/2.2.2.2/tcp/40405/ipfs/QmBootstrapPeer',
      '/ip4/3.3.3.3/tcp/40405/ipfs/QmStaleRuntimePeer',
    ])
  })

  it('backs off failed hints exponentially', () => {
    expect(
      isPeerHintRetryable(
        {
          addr: '/ip4/1.1.1.1/tcp/40405/ipfs/QmRuntimePeer',
          failures: 1,
          lastFailedAt: '2026-04-25T09:56:00.000Z',
        },
        now
      )
    ).toBe(false)
    expect(
      isPeerHintRetryable(
        {
          addr: '/ip4/1.1.1.1/tcp/40405/ipfs/QmRuntimePeer',
          failures: 1,
          lastFailedAt: '2026-04-25T09:55:00.000Z',
        },
        now
      )
    ).toBe(true)
    expect(
      isPeerHintRetryable(
        {
          addr: '/ip4/1.1.1.1/tcp/40405/ipfs/QmRuntimePeer',
          failures: 3,
          lastFailedAt: '2026-04-25T09:41:00.000Z',
        },
        now
      )
    ).toBe(false)
  })

  it('lets a successful runtime observation reset stale failures', () => {
    const [merged] = mergePeerHints([
      {
        addr: '/ip4/1.1.1.1/tcp/40405/ipfs/QmRuntimePeer',
        source: 'runtime',
        failures: 0,
        lastSeenAt: '2026-04-25T10:00:00.000Z',
        lastSucceededAt: '2026-04-25T10:00:00.000Z',
      },
      {
        addr: '/ip4/1.1.1.1/tcp/40405/ipfs/QmRuntimePeer',
        source: 'runtime',
        failures: 4,
        lastFailedAt: '2026-04-25T09:00:00.000Z',
      },
    ])

    expect(merged).toMatchObject({
      source: 'runtime',
      failures: 0,
      lastSucceededAt: '2026-04-25T10:00:00.000Z',
    })
  })
})
