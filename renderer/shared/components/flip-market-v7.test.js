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
    expect(container.querySelector('#v7-offer')).toBeNull()

    const fee = container.querySelector('#v7-fee')
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
  } finally {
    await act(async () => root.unmount())
    container.remove()
    delete window.idena
    global.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
  }
})
