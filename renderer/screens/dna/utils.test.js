import apiClient from '../../shared/api/api-client'
import {
  authenticate,
  isValidDnaSignInUrls,
  isValidDnaUrl,
  signNonce,
  startSession,
} from './utils'

jest.mock('../../shared/api/api-client', () => jest.fn())
jest.mock('../../shared/api/dna', () => ({sendTransaction: jest.fn()}))
jest.mock('../../shared/utils/string', () => ({bufferToHex: jest.fn()}))

const validUrls = {
  callbackUrl: 'https://login.example.test/callback',
  nonceEndpoint: 'https://login.example.test:443/nonce',
  authenticationEndpoint: 'https://login.example.test/authenticate',
}

function signInLink({callbackUrl, nonceEndpoint, authenticationEndpoint}) {
  const link = new URL('dna://request//signin/v1')
  if (callbackUrl !== undefined)
    link.searchParams.set('callback_url', callbackUrl)
  if (nonceEndpoint !== undefined)
    link.searchParams.set('nonce_endpoint', nonceEndpoint)
  if (authenticationEndpoint !== undefined)
    link.searchParams.set('authentication_endpoint', authenticationEndpoint)
  return link.href
}

function jsonResponse(data) {
  return {
    ok: true,
    text: async () => JSON.stringify(data),
  }
}

describe('DNA sign-in URL boundary', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.clearAllMocks()
  })

  it('accepts a valid HTTPS sign-in with three same-origin URLs', () => {
    expect(isValidDnaSignInUrls(validUrls)).toBe(true)
    expect(isValidDnaUrl(signInLink(validUrls))).toBe(true)
  })

  it.each([
    ['nonce on another origin', {nonceEndpoint: 'https://evil.example/nonce'}],
    [
      'authentication on another origin',
      {authenticationEndpoint: 'https://evil.example/authenticate'},
    ],
    ['HTTP callback', {callbackUrl: 'http://login.example.test/callback'}],
    ['HTTP nonce', {nonceEndpoint: 'http://login.example.test/nonce'}],
    [
      'HTTP authentication',
      {authenticationEndpoint: 'http://login.example.test/authenticate'},
    ],
    ['missing callback', {callbackUrl: undefined}],
    ['malformed callback', {callbackUrl: 'https://%'}],
  ])('rejects %s before opening the sign-in dialog', (_, change) => {
    const urls = {...validUrls, ...change}
    expect(isValidDnaSignInUrls(urls)).toBe(false)
    expect(isValidDnaUrl(signInLink(urls))).toBe(false)
  })

  it('posts both sign-in requests without following redirects', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({data: {nonce: 'signin-example'}}))
      .mockResolvedValueOnce(jsonResponse({data: {authenticated: true}}))

    await expect(
      startSession(validUrls.nonceEndpoint, {
        token: 'test-token',
        address: 'test-address',
      })
    ).resolves.toBe('signin-example')
    await expect(
      authenticate(validUrls.authenticationEndpoint, {
        token: 'test-token',
        signature: 'test-signature',
      })
    ).resolves.toBe(true)

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      new URL(validUrls.nonceEndpoint).toString(),
      expect.objectContaining({method: 'POST', redirect: 'error'})
    )
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      validUrls.authenticationEndpoint,
      expect.objectContaining({method: 'POST', redirect: 'error'})
    )
  })

  it('does not sign a nonce when a synthetic redirect is rejected', async () => {
    global.fetch = jest.fn((_, {redirect}) => {
      if (redirect === 'error')
        return Promise.reject(new TypeError('Redirect blocked'))
      return Promise.resolve(jsonResponse({data: {nonce: 'signin-example'}}))
    })

    await expect(
      startSession(validUrls.nonceEndpoint, {
        token: 'test-token',
        address: 'test-address',
      }).then(signNonce)
    ).rejects.toThrow('Redirect blocked')

    expect(apiClient).not.toHaveBeenCalled()
  })
})
