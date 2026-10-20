/* eslint-disable react/prop-types */
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {ChakraProvider} from '@chakra-ui/react'
import FlipMarketV7 from './flip-market-v7'

jest.mock('../providers/chain-context', () => ({
  useChainState: () => ({offline: false, syncing: false}),
}))
jest.mock('../providers/identity-context', () => ({
  useIdentityState: () => ({address: `0x${'a'.repeat(40)}`}),
}))
jest.mock('../providers/settings-context', () => ({
  useSettingsState: () => ({
    internalPort: 9009,
    url: '',
    useExternalNode: false,
  }),
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

const OFFER_ID = 'a'.repeat(64)

it('selects a local tool file while keeping its expected hash independent', async () => {
  const originalActEnvironment = global.IS_REACT_ACT_ENVIRONMENT
  global.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const v7 = jest.fn(async (method) => {
    if (method === 'status') return {result: {configured: false, actions: []}}
    if (method === 'chooseBinary') return {result: {path: '/chosen/fod'}}
    throw new Error(`Unexpected method ${method}`)
  })
  window.idena = {social: {v7}}

  try {
    await act(async () => {
      root.render(
        <ChakraProvider>
          <FlipMarketV7 onSelectV4={() => {}} />
        </ChakraProvider>
      )
    })
    const choose = [...container.querySelectorAll('button')].find((button) =>
      button.textContent.includes('Choose tool file')
    )
    await act(async () => choose.click())
    expect(container.querySelector('#v7-binary').value).toBe('/chosen/fod')
    expect(container.querySelector('#v7-binary-hash').value).toBe('')
    expect(v7).toHaveBeenCalledWith('chooseBinary')
  } finally {
    await act(async () => root.unmount())
    container.remove()
    delete window.idena
    global.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
  }
})

it('uses the next offer and resolves a saved buyer order from the node', async () => {
  const originalActEnvironment = global.IS_REACT_ACT_ENVIRONMENT
  global.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const v7 = jest.fn(async (method, data) => {
    if (method === 'status')
      return {
        result: {
          configured: true,
          contract: 'b'.repeat(40),
          actions: [
            {
              actionId: `v7-${'c'.repeat(32)}`,
              operation: 'buy',
              offerId: OFFER_ID,
              amount: '2500000000000000000',
              price: '2000000000000000000',
              maxFee: '1000000000000000000',
              attempted: true,
              pinChanged: false,
              submitted: {status: 'included'},
            },
            {
              actionId: `v7-${'d'.repeat(32)}`,
              operation: 'list',
              offerId: OFFER_ID,
              amount: '0',
              maxFee: '1000000000000000000',
              attempted: true,
              pinChanged: false,
              submitted: {status: 'included'},
            },
            {
              actionId: `v7-${'e'.repeat(32)}`,
              operation: 'buy',
              offerId: OFFER_ID,
              amount: '2500000000000000000',
              maxFee: '1000000000000000000',
              attempted: true,
              pinChanged: true,
              submitted: {status: 'included'},
            },
          ],
        },
      }
    if (method === 'nextOffer')
      return {
        result: {
          available: true,
          offerId: OFFER_ID,
          count: 2,
          epoch: 230,
          publicSeed: false,
          price: '2000000000000000000',
          buyerBond: '500000000000000000',
          total: '2500000000000000000',
          bondTopUp: '0',
          blockHeight: 100,
        },
      }
    if (method === 'preview') return {result: {count: 2, flips: []}}
    if (method === 'purchaseOrder')
      return {result: {orderId: '17', state: 'funded'}}
    if (method === 'sellerOrder')
      return {result: {orderId: '23', state: 'funded'}}
    if (method === 'prepare')
      return {result: {amount: '2500000000000000000', maxFee: data.maxFee}}
    throw new Error(`Unexpected method ${method}`)
  })
  window.idena = {social: {v7}}

  try {
    await act(async () => {
      root.render(
        <ChakraProvider>
          <FlipMarketV7 onSelectV4={() => {}} />
        </ChakraProvider>
      )
    })
    expect(container.textContent).toContain('Next available bundle')
    expect(container.textContent).toContain('Price 2 iDNA')
    expect(container.textContent).toContain('Private purchase recorded')
    expect(
      container.textContent.match(/Private purchase recorded/g)
    ).toHaveLength(1)
    expect(container.querySelector('#v7-offer')).toBeNull()

    const fee = container.querySelector('#v7-fee')
    expect(fee.getAttribute('aria-required')).toBe('true')
    expect(fee.getAttribute('aria-describedby')).toContain('v7-fee-help')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      ).set
      setter.call(fee, 'invalid')
      fee.dispatchEvent(new Event('input', {bubbles: true}))
    })
    expect(fee.getAttribute('aria-invalid')).toBe('true')
    expect(fee.getAttribute('aria-describedby')).toContain('v7-fee-error')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      ).set
      setter.call(fee, '1')
      fee.dispatchEvent(new Event('input', {bubbles: true}))
    })
    const prepare = [...container.querySelectorAll('button')].find((button) =>
      button.textContent.includes('Choose session and prepare purchase')
    )
    await act(async () => {
      prepare.click()
    })
    expect(v7).toHaveBeenCalledWith(
      'prepare',
      expect.objectContaining({operation: 'buy', offerId: OFFER_ID})
    )
    const operation = container.querySelector('#v7-operation')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value'
      ).set
      setter.call(operation, 'confirm')
      operation.dispatchEvent(new Event('change', {bubbles: true}))
    })
    const purchase = container.querySelector('#v7-purchase')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value'
      ).set
      setter.call(purchase, `v7-${'c'.repeat(32)}`)
      purchase.dispatchEvent(new Event('change', {bubbles: true}))
    })
    expect(v7).toHaveBeenCalledWith('purchaseOrder', {
      actionId: `v7-${'c'.repeat(32)}`,
    })
    expect(container.querySelector('#v7-order').value).toBe('17')
    expect(container.querySelector('#v7-order').disabled).toBe(true)

    const findBuyerOrder = [...container.querySelectorAll('button')].find(
      (button) => button.textContent.includes('Find buyer order')
    )
    await act(async () => findBuyerOrder.click())
    expect(v7).toHaveBeenCalledWith('sellerOrder', {offerId: OFFER_ID})
    expect(container.querySelector('#v7-operation').value).toBe(
      'privateMessage'
    )
    expect(container.querySelector('#v7-order').value).toBe('23')
    expect(container.querySelector('#v7-order').disabled).toBe(true)
  } finally {
    await act(async () => root.unmount())
    container.remove()
    delete window.idena
    global.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
  }
})

it('shows a retry when the public flip preview fails', async () => {
  const originalActEnvironment = global.IS_REACT_ACT_ENVIRONMENT
  global.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let previewCalls = 0
  const v7 = jest.fn(async (method) => {
    if (method === 'status')
      return {
        result: {configured: true, contract: 'b'.repeat(40), actions: []},
      }
    if (method === 'nextOffer')
      return {
        result: {
          available: true,
          offerId: OFFER_ID,
          count: 1,
          epoch: 230,
          publicSeed: false,
          price: '1000000000000000000',
          buyerBond: '1000000000000000000',
          total: '2000000000000000000',
          bondTopUp: '0',
          blockHeight: 100,
        },
      }
    if (method === 'preview') {
      previewCalls += 1
      if (previewCalls === 1) return {error: {message: 'Explorer unavailable'}}
      return {result: {count: 1, flips: [{cid: 'example', images: []}]}}
    }
    throw new Error(`Unexpected method ${method}`)
  })
  window.idena = {social: {v7}}

  try {
    await act(async () => {
      root.render(
        <ChakraProvider>
          <FlipMarketV7 onSelectV4={() => {}} />
        </ChakraProvider>
      )
    })
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 350)
      })
    })
    expect(container.textContent).toContain(
      'The public flip preview could not load'
    )
    const retry = [...container.querySelectorAll('button')].find((button) =>
      button.textContent.includes('Retry preview')
    )
    await act(async () => retry.click())
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 350)
      })
    })
    expect(v7).toHaveBeenCalledTimes(4)
    expect(container.textContent).toContain('Explorer images are unavailable')
  } finally {
    await act(async () => root.unmount())
    container.remove()
    delete window.idena
    global.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
  }
})

it('keeps refresh unavailable while a saved action is being sent', async () => {
  const originalActEnvironment = global.IS_REACT_ACT_ENVIRONMENT
  global.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let finishSubmit
  const pendingSubmit = new Promise((resolve) => {
    finishSubmit = resolve
  })
  const actionId = `v7-${'c'.repeat(32)}`
  const v7 = jest.fn(async (method) => {
    if (method === 'status')
      return {
        result: {
          configured: true,
          contract: 'b'.repeat(40),
          actions: [
            {
              actionId,
              operation: 'challenge',
              amount: '0',
              maxFee: '1000000000000000000',
              attempted: false,
              pinChanged: false,
            },
          ],
        },
      }
    if (method === 'nextOffer') return {result: {available: false}}
    if (method === 'submit') return pendingSubmit
    throw new Error(`Unexpected method ${method}`)
  })
  window.idena = {social: {v7}}

  try {
    await act(async () => {
      root.render(
        <ChakraProvider>
          <FlipMarketV7 onSelectV4={() => {}} />
        </ChakraProvider>
      )
    })
    const button = (text) =>
      [...container.querySelectorAll('button')].find((item) =>
        item.textContent.includes(text)
      )
    await act(async () => button('Review and send').click())
    expect(v7).toHaveBeenCalledWith('submit', {actionId})
    expect(button('Refresh').disabled).toBe(true)

    await act(async () => {
      finishSubmit({
        result: {status: 'included', txHash: `0x${'e'.repeat(64)}`},
      })
      await pendingSubmit
    })
    expect(container.textContent).toContain('Included')
  } finally {
    await act(async () => root.unmount())
    container.remove()
    delete window.idena
    global.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
  }
})

it('carries a newly verified local receipt into confirmation preparation', async () => {
  const originalActEnvironment = global.IS_REACT_ACT_ENVIRONMENT
  global.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const actionId = `v7-${'c'.repeat(32)}`
  const receiptId = `v7-receipt-${'d'.repeat(32)}`
  const v7 = jest.fn(async (method, data) => {
    if (method === 'status')
      return {
        result: {
          configured: true,
          contract: 'b'.repeat(40),
          actions: [
            {
              actionId,
              operation: 'buy',
              offerId: OFFER_ID,
              amount: '2500000000000000000',
              price: '2000000000000000000',
              maxFee: '1000000000000000000',
              attempted: true,
              pinChanged: false,
              submitted: {status: 'included'},
            },
          ],
        },
      }
    if (method === 'nextOffer') return {result: {available: false}}
    if (method === 'purchaseOrder')
      return {result: {orderId: '17', state: 'funded'}}
    if (method === 'receive')
      return {result: {usableFlips: 2, receiptId, folderOpened: false}}
    if (method === 'prepare')
      return {result: {amount: '0', maxFee: data.maxFee}}
    throw new Error(`Unexpected method ${method}`)
  })
  window.idena = {social: {v7}}

  try {
    await act(async () => {
      root.render(
        <ChakraProvider>
          <FlipMarketV7 onSelectV4={() => {}} />
        </ChakraProvider>
      )
    })
    const change = async (selector, value) => {
      const element = container.querySelector(selector)
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          element.tagName === 'SELECT'
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype,
          'value'
        ).set
        setter.call(element, value)
        element.dispatchEvent(new Event('change', {bubbles: true}))
        element.dispatchEvent(new Event('input', {bubbles: true}))
      })
    }
    await change('#v7-operation', 'receive')
    await change('#v7-purchase', actionId)
    await change('#v7-passphrase', 'new-buyer-vault')
    const button = (text) =>
      [...container.querySelectorAll('button')].find((item) =>
        item.textContent.includes(text)
      )
    await act(async () => button('Verify delivery').click())
    expect(v7).toHaveBeenCalledWith('receive', {
      actionId,
      orderId: '17',
      passphrase: 'new-buyer-vault',
    })
    expect(container.querySelector('#v7-operation').value).toBe('confirm')
    expect(container.textContent).toContain('receipt is ready for confirmation')

    await change('#v7-fee', '1')
    await act(async () => button('Prepare confirmation').click())
    expect(v7).toHaveBeenCalledWith(
      'prepare',
      expect.objectContaining({
        operation: 'confirm',
        orderId: '17',
        receiptId,
      })
    )
  } finally {
    await act(async () => root.unmount())
    container.remove()
    delete window.idena
    global.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
  }
})
