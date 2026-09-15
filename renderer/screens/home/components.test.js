/* eslint-disable react/prop-types */
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {Simulate} from 'react-dom/test-utils'
import {ChakraProvider} from '@chakra-ui/react'
import {QueryClient, QueryClientProvider} from 'react-query'
import {ReplenishStakeDrawer} from './components'

jest.mock('nanoid', () => ({nanoid: () => 'synthetic-id'}))

jest.mock('react-i18next', () => {
  const translation = {t: (text) => text, i18n: {language: 'en'}}
  return {
    ...jest.requireActual('react-i18next'),
    useTranslation: () => translation,
  }
})

jest.mock('../../shared/providers/identity-context', () => ({
  useIdentityState: () => ({
    address: '0x1111111111111111111111111111111111111111',
    state: 'Human',
    age: 10,
  }),
}))

jest.mock('../ads/containers', () => ({
  AdDrawer: ({children}) => <div>{children}</div>,
}))

jest.mock('../ads/hooks', () => ({useTrackTx: jest.fn()}))

jest.mock('../../shared/components/components', () => ({
  ...jest.requireActual('../../shared/components/components'),
  DrawerHeader: ({children}) => <header>{children}</header>,
  DrawerBody: ({children}) => <div>{children}</div>,
  DrawerFooter: ({children}) => <footer>{children}</footer>,
}))

describe('stake replenishment form', () => {
  let root
  let container
  let queryClient
  let originalActEnvironment

  beforeEach(() => {
    originalActEnvironment = global.IS_REACT_ACT_ENVIRONMENT
    global.IS_REACT_ACT_ENVIRONMENT = true
    window.idena = {
      rpc: {
        call: jest.fn(async ({method}) => ({
          result:
            method === 'dna_getBalance'
              ? {balance: '100', stake: '10'}
              : '0xsynthetic-transaction',
        })),
      },
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    queryClient = new QueryClient({
      defaultOptions: {queries: {retry: false, cacheTime: 0}},
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    queryClient.clear()
    container.remove()
    delete window.idena
    global.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
  })

  async function renderForm() {
    await act(async () => {
      root.render(
        <ChakraProvider>
          <QueryClientProvider client={queryClient}>
            <ReplenishStakeDrawer
              isOpen
              onClose={jest.fn()}
              onMined={jest.fn()}
              onError={jest.fn()}
            />
          </QueryClientProvider>
        </ChakraProvider>
      )
    })
    return container.querySelector('input[type="number"]')
  }

  it.each(['0.5', '1.123456789012345678'])(
    'accepts and submits the exact decimal amount %s',
    async (amount) => {
      const input = await renderForm()
      await act(async () => {
        Simulate.change(input, {target: {value: amount}})
      })

      const form = container.querySelector('form')
      expect(input.value).toBe(amount)
      expect(form.checkValidity()).toBe(true)

      await act(async () => {
        container
          .querySelectorAll('input[type="checkbox"]')
          .forEach((checkbox) => {
            Simulate.change(checkbox, {target: {checked: true}})
          })
      })
      await act(async () => {
        Simulate.submit(form)
      })

      expect(window.idena.rpc.call).toHaveBeenCalledWith({
        method: 'dna_sendTransaction',
        params: [
          {
            type: 0x16,
            from: '0x1111111111111111111111111111111111111111',
            to: '0x1111111111111111111111111111111111111111',
            amount,
          },
        ],
        id: 1,
      })
    }
  )

  it.each(['', '0', '-1'])(
    'does not submit an invalid amount %j',
    async (amount) => {
      const input = await renderForm()
      await act(async () => {
        Simulate.change(input, {target: {value: amount}})
        container
          .querySelectorAll('input[type="checkbox"]')
          .forEach((checkbox) => {
            Simulate.change(checkbox, {target: {checked: true}})
          })
      })
      await act(async () => {
        Simulate.submit(container.querySelector('form'))
      })
      expect(container.querySelector('button[type="submit"]').disabled).toBe(
        true
      )
      expect(
        window.idena.rpc.call.mock.calls.some(
          ([request]) => request.method === 'dna_sendTransaction'
        )
      ).toBe(false)
    }
  )

  it('requires the stake acknowledgments before submitting', async () => {
    const input = await renderForm()
    await act(async () => {
      Simulate.change(input, {target: {value: '1.5'}})
    })
    await act(async () => {
      Simulate.submit(container.querySelector('form'))
    })
    expect(container.querySelector('button[type="submit"]').disabled).toBe(true)
    expect(
      window.idena.rpc.call.mock.calls.some(
        ([request]) => request.method === 'dna_sendTransaction'
      )
    ).toBe(false)
  })
})
