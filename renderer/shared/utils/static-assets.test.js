import {resolveIdentityMarkSrc, resolvePublicAssetPath} from './static-assets'

describe('static asset paths', () => {
  it('keeps absolute public paths for http renderer URLs', () => {
    expect(
      resolvePublicAssetPath(
        '/static/identity-mark.png',
        'http://127.0.0.1:8000/settings/ai'
      )
    ).toBe('/static/identity-mark.png')
  })

  it('resolves root static paths from top-level packaged pages', () => {
    expect(
      resolveIdentityMarkSrc(
        'file:///Applications/IdenaAI.app/Contents/Resources/app.asar/renderer/out/home.html'
      )
    ).toBe('static/identity-mark.png')
  })

  it('resolves root static paths from nested packaged pages', () => {
    expect(
      resolveIdentityMarkSrc(
        'file:///Applications/IdenaAI.app/Contents/Resources/app.asar/renderer/out/settings/ai.html'
      )
    ).toBe('../static/identity-mark.png')
  })
})
