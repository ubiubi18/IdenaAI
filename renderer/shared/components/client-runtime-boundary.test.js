import React, {act} from 'react'
import {hydrateRoot} from 'react-dom/client'
import {renderToString} from 'react-dom/server.node'
import ClientRuntimeBoundary from './client-runtime-boundary'

function PreloadBackedSettingsView() {
  const persistedSettings = window.idena?.storage?.settings?.loadState?.() || {}
  const aiEnabled = Boolean(persistedSettings.aiSolver?.enabled)
  return <span>{aiEnabled ? 'AI enabled' : 'AI disabled'}</span>
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
  })

  it.each([true, false])(
    'hydrates before exposing preload-backed AI state (%s)',
    async (aiEnabled) => {
      const serverHtml = renderToString(
        <ClientRuntimeBoundary>
          <PreloadBackedSettingsView />
        </ClientRuntimeBoundary>
      )
      expect(serverHtml).toBe('')

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
          <ClientRuntimeBoundary>
            <PreloadBackedSettingsView />
          </ClientRuntimeBoundary>,
          {
            onRecoverableError: (error) => recoverableErrors.push(error),
          }
        )
      })

      expect(container.textContent).toBe(
        aiEnabled ? 'AI enabled' : 'AI disabled'
      )
      expect(recoverableErrors).toEqual([])
      expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(
        /did not match|hydration failed|text content does not match/iu
      )

      await act(async () => {
        root.unmount()
      })
    }
  )
})
