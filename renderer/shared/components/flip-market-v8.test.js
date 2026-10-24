/* global BigInt */
/* eslint-disable react/prop-types */
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {ChakraProvider} from '@chakra-ui/react'
import FlipMarketV8 from './flip-market-v8'

jest.mock('../providers/chain-context', () => ({
  useChainState: () => ({offline: false, syncing: false}),
}))
jest.mock('../providers/identity-context', () => ({
  useIdentityState: () => ({address: 'a'.repeat(40)}),
}))
jest.mock(
  './layout',
  () =>
    ({children}) =>
      children
)
jest.mock('./components', () => ({
  Page: ({children}) => <main>{children}</main>,
  PageTitle: ({children}) => <h1>{children}</h1>,
}))
async function render(data, action = async () => data, version = 8) {
  global.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const v8 = jest.fn(async (method, payload) => ({
    result: method === 'status' ? data : await action(method, payload),
  }))
  window.idena = {social: {[`v${version}`]: v8}}
  await act(async () =>
    root.render(
      <ChakraProvider>
        <FlipMarketV8 version={version} onLegacy={() => {}} />
      </ChakraProvider>
    )
  )
  return {
    container,
    v8,
    cleanup: async () => {
      await act(async () => root.unmount())
      container.remove()
      delete window.idena
    },
  }
}
it('shows activation honestly without invented prices or a technical setup form', async () => {
  const f = await render({configured: false})
  try {
    expect(f.container.textContent).toContain('awaiting activation')
    expect(f.container.querySelectorAll('input').length).toBe(0)
    expect(f.v8).toHaveBeenCalledWith('status', undefined)
  } finally {
    await f.cleanup()
  }
})

const atoms = (v) => (BigInt(v) * 10n ** 18n).toString()
function readyData() {
  return {
    configured: true,
    currentFlips: 5,
    walletBalance: '300',
    automatic: true,
    trading: {
      perTrade: atoms(75),
      purchaseRemaining: atoms(150),
      feeRemaining: atoms(25),
      expires: Date.now() + 3600000,
    },
    vaultBundles: ['d'.repeat(64)],
    actions: [],
    market: {
      height: 50,
      identity: 'a'.repeat(40),
      buyQuote: atoms(12),
      sellQuote: atoms(10),
      reserve: '0',
      poolCanAcquire: false,
      account: {
        balance: atoms(75),
        reserved: '0',
        target: atoms(75),
        needsTopup: false,
      },
      buys: [],
      sells: [],
      trades: [],
      bundles: [
        {
          id: 'd'.repeat(64),
          author: 'a'.repeat(40),
          used: false,
          sale: '0',
          epoch: 232,
          count: 5,
        },
      ],
    },
  }
}
const button = (f, label) =>
  [...f.container.querySelectorAll('button')].find(
    (b) => b.textContent === label
  )
const click = async (f, label) => act(async () => button(f, label).click())
it('guides a first-time seller through deposit review without enabling or signing trades', async () => {
  const data = readyData()
  data.market.account = {
    balance: '0',
    reserved: '0',
    target: '0',
    needsTopup: false,
  }
  data.trading = null
  const f = await render(data, async (method, payload) => ({
    actionId: 'deposit',
    operation: payload.operation,
    amount: payload.amount,
    maxFee: atoms(1),
  }))
  try {
    expect(f.container.textContent).toContain(
      'First, set up your security deposit'
    )
    expect(f.container.textContent).toContain(
      'Close every queued order, trade and dispute first'
    )
    expect(button(f, 'Buy now')).toBeUndefined()
    await click(f, 'Review deposit')
    expect(f.v8).toHaveBeenCalledWith('prepare', {
      operation: 'depositStake',
      amount: atoms(18),
      target: atoms(18),
    })
    expect(f.container.textContent).toContain('Maximum network fee: 1 iDNA')
    expect(
      f.v8.mock.calls.some(([method]) =>
        ['submit', 'trade', 'unlock'].includes(method)
      )
    ).toBe(false)
  } finally {
    await f.cleanup()
  }
})
it('places one bounded buy-queue request from one click and does not open a repeated review', async () => {
  const data = readyData()
  const f = await render(data, async () => ({status: 'included'}))
  try {
    await click(f, 'Buy flips')
    expect(button(f, 'Join buy queue').disabled).toBe(false)
    await click(f, 'Join buy queue')
    expect(f.v8.mock.calls.filter(([method]) => method === 'trade')).toEqual([
      ['trade', {side: 'buy', quote: atoms(12)}],
    ])
    expect(
      f.v8.mock.calls.some(([method]) => ['prepare', 'submit'].includes(method))
    ).toBe(false)
  } finally {
    await f.cleanup()
  }
})
it('shows eligibility before depositing and rounds the suggested deposit up without changing quotes', async () => {
  const data = readyData()
  data.market.account = {
    balance: '0',
    reserved: '0',
    target: '0',
    needsTopup: false,
  }
  data.market.bundles = []
  data.market.buyQuote = '11111111111111111112'
  data.market.sellQuote = '9090909090909090909'
  data.trading = null
  const f = await render(data, async (_, payload) => ({
    operation: payload.operation,
    amount: payload.amount,
    maxFee: atoms(1),
    actionId: 'deposit',
  }))
  try {
    expect(f.container.textContent).toContain(
      '5 current flips detected · 0 proven bundles ready to sell'
    )
    expect(f.container.textContent).toContain(
      'Your current flips are not ready to sell'
    )
    expect(f.container.textContent).toContain('buy ≈11.1111 iDNA')
    expect(f.container.querySelector('input').value).toBe('17')
    await click(f, 'Review deposit')
    expect(f.v8).toHaveBeenCalledWith('prepare', {
      operation: 'depositStake',
      amount: atoms(17),
      target: atoms(17),
    })
  } finally {
    await f.cleanup()
  }
})
it('offers Sell now only for compatible external demand and uses pool or queue otherwise', async () => {
  const data = readyData()
  data.market.buys = [
    {buyer: 'b'.repeat(40), state: 1, expires: 60, maximum: atoms(20)},
  ]
  const f = await render(data, async () => ({status: 'included'}))
  try {
    expect(button(f, 'Sell now').disabled).toBe(false)
    data.market.buys[0].buyer = data.market.identity
    await click(f, 'Refresh')
    expect(button(f, 'Join sell queue').disabled).toBe(false)
    data.market.poolCanAcquire = true
    await click(f, 'Refresh')
    expect(button(f, 'Sell to pool').disabled).toBe(false)
  } finally {
    await f.cleanup()
  }
})
it('blocks new trading after a penalty but permits a full exit when all obligations are closed', async () => {
  const data = readyData()
  data.market.account.needsTopup = true
  data.market.account.balance = atoms(50)
  const f = await render(data, async (_, payload) => ({
    operation: payload.operation,
    amount: '1',
    maxFee: '1',
    actionId: 'exit',
  }))
  try {
    expect(f.container.textContent).toContain('New trades are paused')
    expect(button(f, 'Join sell queue').disabled).toBe(true)
    await click(f, 'Manage deposit')
    expect(button(f, 'Finish trading & withdraw deposit').disabled).toBe(false)
    data.market.account.reserved = atoms(10)
    data.market.buys = [
      {id: '1', buyer: data.market.identity, state: 1, maximum: atoms(10)},
    ]
    await click(f, 'Refresh')
    expect(button(f, 'Finish trading & withdraw deposit').disabled).toBe(true)
    data.market.account.reserved = '0'
    data.market.buys = []
    await click(f, 'Refresh')
    await click(f, 'Finish trading & withdraw deposit')
    expect(f.v8).toHaveBeenCalledWith('prepare', {
      operation: 'withdrawStake',
      amount: atoms(50),
      exit: true,
    })
  } finally {
    await f.cleanup()
  }
})
it('requires explicit session permission and disables orders with an uncertain transaction', async () => {
  const data = readyData()
  data.trading = null
  const f = await render(data)
  try {
    expect(f.container.textContent).toContain('Set up one-click trading')
    expect(button(f, 'Join sell queue').disabled).toBe(true)
    data.trading = readyData().trading
    data.actions = [{attempted: true, submitted: {status: 'uncertain'}}]
    await click(f, 'Refresh')
    expect(button(f, 'Join sell queue').disabled).toBe(true)
    expect(f.v8.mock.calls.every(([method]) => method === 'status')).toBe(true)
  } finally {
    await f.cleanup()
  }
})

it('v9 offers package import without upfront proof registration', async () => {
  const data = readyData()
  data.market.version = 9
  data.market.bundles = []
  const f = await render(data, async () => data, 9)
  try {
    expect(f.container.textContent).toContain('Import package')
    expect(f.container.textContent).not.toContain('Register proven flips')
    expect(f.container.textContent).toContain('captured validation session')
  } finally {
    await f.cleanup()
  }
})

it('v9 derives an editable purchase budget from the 500 iDNA starting quote', async () => {
  const data = readyData()
  data.market.version = 9
  data.market.buyQuote = atoms(500)
  data.market.sellQuote = '409090909090909090909'
  data.market.account.balance = atoms(750)
  data.market.account.target = atoms(750)
  data.trading = null
  const f = await render(data, async () => data, 9)
  try {
    await click(f, 'Set up one-click trading')
    const label = [...f.container.querySelectorAll('label')].find(
      (l) => l.textContent === 'Total purchase budget · iDNA'
    )
    expect(label.parentElement.querySelector('input').value).toBe('750')
    expect(f.v8.mock.calls.every(([method]) => method === 'status')).toBe(true)
  } finally {
    await f.cleanup()
  }
})

it('keeps buying and queued orders ahead of opt-in setup and seller import', async () => {
  const data = readyData()
  data.trading = null
  data.market.buyQuote = atoms(500)
  data.market.account.balance = atoms(2750)
  data.market.account.target = atoms(2750)
  const f = await render(data, async () => data, 9)
  try {
    await click(f, 'Buy flips')
    expect(f.container.textContent).toContain('Buy at the curve price')
    expect(f.container.textContent).toContain('My queue and trades')
    expect(button(f, 'Import package')).toBeUndefined()
    expect(f.container.querySelectorAll('input[type="password"]')).toHaveLength(
      0
    )
    expect(button(f, 'Join buy queue').disabled).toBe(true)
    await click(f, 'Set up one-click trading')
    const label = [...f.container.querySelectorAll('label')].find(
      (l) => l.textContent === 'Maximum per trade · iDNA'
    )
    expect(label.parentElement.querySelector('input').value).toBe('525')
    expect(button(f, 'Join buy queue').disabled).toBe(true)
    expect(f.v8.mock.calls.every(([method]) => method === 'status')).toBe(true)
  } finally {
    await f.cleanup()
  }
})

it('shows public prices, real liquidity and live demand, and opens purchased flips without a signing action', async () => {
  const data = readyData()
  data.market.escrow = atoms(1650)
  data.market.stakes = atoms(4250)
  data.market.reserve = atoms(183)
  data.market.priceHistory = [
    {trade: '1', price: atoms(500)},
    {trade: '2', price: atoms(510)},
  ]
  data.market.buys = [3, 4, 5].map((id) => ({
    id: String(id),
    buyer: data.market.identity,
    state: 1,
    maximum: atoms(550),
    expires: 1000,
  }))
  data.market.trades = [
    {id: '1', buyer: data.market.identity, state: 5, price: atoms(500)},
  ]
  const flip = {
    cid: 'test',
    images: Array(4).fill('data:image/jpeg;base64,YQ=='),
    orders: [
      [0, 1, 2, 3],
      [3, 2, 1, 0],
    ],
  }
  const f = await render(
    data,
    async () => ({trade: '1', epoch: 233, count: 2, flips: [flip, flip]}),
    9
  )
  try {
    expect(f.container.textContent).toContain('0 offers · 3 buy orders')
    expect(f.container.textContent).toContain(
      'Available pool liquidity183 iDNA'
    )
    expect(f.container.textContent).toContain('Purchase escrow: 1,650 iDNA')
    expect(
      f.container.querySelector('svg[role="img"]').getAttribute('aria-label')
    ).toContain('completed purchase prices')
    await click(f, 'View flips · Set #1')
    expect(f.v8).toHaveBeenCalledWith('purchasedPreview', {id: '1'})
    expect(document.body.textContent).toContain('Flip 1 of 2')
    expect(document.querySelectorAll('[role="dialog"] img')).toHaveLength(8)
    const next = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Next flip'
    )
    await act(async () => next.click())
    expect(document.body.textContent).toContain('Flip 2 of 2')
    expect(next.disabled).toBe(true)
    expect(f.v8.mock.calls.map(([method]) => method)).toEqual([
      'status',
      'purchasedPreview',
    ])
  } finally {
    await f.cleanup()
  }
})
