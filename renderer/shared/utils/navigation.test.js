import {resolvePackagedRouteHref} from './navigation'

describe('renderer navigation', () => {
  it('keeps normal routes absolute for dev server navigation', () => {
    expect(
      resolvePackagedRouteHref(
        '/settings/ai?setup=1',
        'http://127.0.0.1:8000/settings/general'
      )
    ).toBe('/settings/ai?setup=1')
  })

  it('resolves sibling settings tabs as packaged html files', () => {
    expect(
      resolvePackagedRouteHref(
        '/settings/ai',
        'file:///Applications/IdenaAI.app/Contents/Resources/app.asar/renderer/out/settings/general.html'
      )
    ).toBe('ai.html')
  })

  it('resolves nested packaged routes from top-level pages', () => {
    expect(
      resolvePackagedRouteHref(
        '/settings/node',
        'file:///Applications/IdenaAI.app/Contents/Resources/app.asar/renderer/out/home.html'
      )
    ).toBe('settings/node.html')
  })

  it('resolves top-level packaged routes from nested pages', () => {
    expect(
      resolvePackagedRouteHref(
        '/home',
        'file:///Applications/IdenaAI.app/Contents/Resources/app.asar/renderer/out/settings/ai.html'
      )
    ).toBe('../home.html')
  })
})
