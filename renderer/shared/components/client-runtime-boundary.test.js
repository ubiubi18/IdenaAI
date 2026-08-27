/* eslint-disable react/prop-types */
import React, {act, useEffect} from 'react'
import {hydrateRoot} from 'react-dom/client'
import {renderToString} from 'react-dom/server.node'
import ClientRuntimeBoundary from './client-runtime-boundary'

function PreparedSettingsView() {
  const aiEnabled = Boolean(window.legacySettings?.aiSolver?.enabled)
  return <span>{aiEnabled ? 'AI enabled' : 'AI disabled'}</span>
}

function RuntimeProbe({onMount}) {
  useEffect(() => {
    onMount(window.runtimeBridge)
  }, [onMount])

  return <span>{window.runtimeBridge}</span>
}

describe('ClientRuntimeBoundary', () => {
  let originalActEnvironment
  let consoleError

  beforeEach(() => {
    originalActEnvironment = global.IS_REACT_ACT_ENVIRONMENT
    global.IS_REACT_ACT_ENVIRONMENT = true
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    document.body.innerHTML = ''
  })

  afterEach(() => {
    consoleError.mockRestore()
    global.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
    delete window.idena
    delete window.legacySettings
    delete window.runtimeBridge
  })

  it.each([true, false])(
    'prepares persisted AI state before mounting providers (%s)',
    async (aiEnabled) => {
      const prepareRuntime = jest.fn(() => {
        window.legacySettings =
          window.idena?.storage?.settings?.loadState?.() || {}
        return true
      })
      const serverHtml = renderToString(
        <ClientRuntimeBoundary prepareRuntime={prepareRuntime}>
          <PreparedSettingsView />
        </ClientRuntimeBoundary>
      )
      expect(serverHtml).toBe('')
      expect(prepareRuntime).not.toHaveBeenCalled()

      window.idena = {
        storage: {
          settings: {
            loadState: () => ({aiSolver: {enabled: aiEnabled}}),
          },
        },
      }

      const container = document.createElement('div')
      container.innerHTML = serverHtml
      document.body.appendChild(container)

      const recoverableErrors = []
      let root
      await act(async () => {
        root = hydrateRoot(
          container,
          <ClientRuntimeBoundary prepareRuntime={prepareRuntime}>
            <PreparedSettingsView />
          </ClientRuntimeBoundary>,
          {
            onRecoverableError: (error) => recoverableErrors.push(error),
          }
        )
      })

      expect(container.textContent).toBe(
        aiEnabled ? 'AI enabled' : 'AI disabled'
      )
      expect(prepareRuntime).toHaveBeenCalledTimes(1)
      expect(recoverableErrors).toEqual([])
      expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(
        /did not match|hydration failed|text content does not match/iu
      )

      await act(async () => {
        root.unmount()
      })
    }
  )

  it('becomes ready after mount when browser development has no real bridge', async () => {
    const prepareRuntime = jest.fn(() => {
      window.runtimeBridge = 'browser fallback'
      return false
    })
    const container = document.createElement('div')
    container.innerHTML = renderToString(
      <ClientRuntimeBoundary prepareRuntime={prepareRuntime}>
        <RuntimeProbe onMount={() => {}} />
      </ClientRuntimeBoundary>
    )
    document.body.appendChild(container)

    let root
    await act(async () => {
      root = hydrateRoot(
        container,
        <ClientRuntimeBoundary prepareRuntime={prepareRuntime}>
          <RuntimeProbe onMount={() => {}} />
        </ClientRuntimeBoundary>
      )
    })

    expect(prepareRuntime).toHaveBeenCalledTimes(1)
    expect(container.textContent).toBe('browser fallback')

    await act(async () => {
      root.unmount()
    })
  })

  it('remounts providers when a late preload bridge becomes ready', async () => {
    const providerMounts = []
    const onMount = (bridge) => providerMounts.push(bridge)
    let hasRealBridge = false
    const prepareRuntime = jest.fn(() => {
      window.runtimeBridge = hasRealBridge ? 'electron' : 'browser fallback'
      return hasRealBridge
    })
    const container = document.createElement('div')
    container.innerHTML = renderToString(
      <ClientRuntimeBoundary prepareRuntime={prepareRuntime}>
        <RuntimeProbe onMount={onMount} />
      </ClientRuntimeBoundary>
    )
    document.body.appendChild(container)

    let root
    await act(async () => {
      root = hydrateRoot(
        container,
        <ClientRuntimeBoundary prepareRuntime={prepareRuntime}>
          <RuntimeProbe onMount={onMount} />
        </ClientRuntimeBoundary>
      )
    })

    expect(container.textContent).toBe('browser fallback')
    expect(providerMounts).toEqual(['browser fallback'])

    hasRealBridge = true
    await act(async () => {
      window.dispatchEvent(new Event('idena-preload-ready'))
    })

    expect(prepareRuntime).toHaveBeenCalledTimes(2)
    expect(container.textContent).toBe('electron')
    expect(providerMounts).toEqual(['browser fallback', 'electron'])

    await act(async () => {
      window.dispatchEvent(new Event('idena-preload-ready'))
    })

    expect(prepareRuntime).toHaveBeenCalledTimes(3)
    expect(providerMounts).toEqual(['browser fallback', 'electron'])

    await act(async () => {
      root.unmount()
    })
  })
})
