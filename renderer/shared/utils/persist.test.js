import {persistItem, persistState} from './persist'

const SECRET_VALUE = 'value-that-must-not-be-logged'

describe('persistent storage logging', () => {
  beforeEach(() => {
    global.logger = {error: jest.fn()}
    window.idena = {
      storage: {
        settings: {
          persistItem: jest.fn(() => {
            throw new Error('write failed')
          }),
          persistState: jest.fn(() => {
            throw new Error('write failed')
          }),
        },
      },
    }
  })

  afterEach(() => {
    delete global.logger
    delete window.idena
  })

  it('does not log item values when a write fails', () => {
    persistItem('settings', 'apiKey', SECRET_VALUE)

    const logged = JSON.stringify(global.logger.error.mock.calls)
    expect(logged).toContain('settings')
    expect(logged).toContain('apiKey')
    expect(logged).not.toContain(SECRET_VALUE)
  })

  it('does not log state values when a write fails', () => {
    persistState('settings', {apiKey: SECRET_VALUE})

    const logged = JSON.stringify(global.logger.error.mock.calls)
    expect(logged).toContain('settings')
    expect(logged).not.toContain(SECRET_VALUE)
  })
})
