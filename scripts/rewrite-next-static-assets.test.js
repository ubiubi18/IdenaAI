const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  baseHrefForHtml,
  rewriteNextStaticAssets,
} = require('./rewrite-next-static-assets')

describe('rewrite-next-static-assets', () => {
  let outputDir

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idena-static-'))
    fs.mkdirSync(path.join(outputDir, 'settings'), {recursive: true})
    fs.mkdirSync(path.join(outputDir, '_next', 'static', 'chunks'), {
      recursive: true,
    })
    fs.mkdirSync(path.join(outputDir, 'idena-social', 'assets'), {
      recursive: true,
    })
    fs.writeFileSync(
      path.join(outputDir, 'home.html'),
      '<html><head><link href="/static/app.css"></head>' +
        '<body><script src="/_next/home.js"></script></body></html>'
    )
    fs.writeFileSync(
      path.join(outputDir, 'settings', 'node.html'),
      '<html><head></head><body>' +
        '<script src="/_next/node.js"></script></body></html>'
    )
    fs.writeFileSync(
      path.join(outputDir, '_next', 'static', 'chunks', 'webpack-fixture.js'),
      '(()=>{var f={};f.p="/_next/";})();'
    )
    fs.writeFileSync(
      path.join(outputDir, 'idena-social', 'index.html'),
      '<html><head>' +
        '<meta http-equiv="Content-Security-Policy" content="base-uri \'none\'">' +
        '<script type="module" src="./assets/social.js"></script>' +
        '<link rel="stylesheet" href="./assets/social.css">' +
        '</head><body></body></html>'
    )
  })

  afterEach(() => {
    fs.rmSync(outputDir, {recursive: true, force: true})
  })

  it('uses the renderer root as the base for top-level and nested pages', () => {
    expect(baseHrefForHtml(outputDir, path.join(outputDir, 'home.html'))).toBe(
      './'
    )
    expect(
      baseHrefForHtml(outputDir, path.join(outputDir, 'settings', 'node.html'))
    ).toBe('../')
  })

  it('rewrites exported assets and the webpack public path deterministically', () => {
    expect(rewriteNextStaticAssets(outputDir)).toEqual({
      htmlFiles: 2,
      preservedHtmlFiles: 1,
      webpackRuntimeFiles: 1,
    })

    const home = fs.readFileSync(path.join(outputDir, 'home.html'), 'utf8')
    const node = fs.readFileSync(
      path.join(outputDir, 'settings', 'node.html'),
      'utf8'
    )
    const runtime = fs.readFileSync(
      path.join(outputDir, '_next', 'static', 'chunks', 'webpack-fixture.js'),
      'utf8'
    )
    const social = fs.readFileSync(
      path.join(outputDir, 'idena-social', 'index.html'),
      'utf8'
    )

    expect(home).toContain('<base data-idena-static-root href="./">')
    expect(home).toContain('href="static/app.css"')
    expect(home).toContain('src="_next/home.js"')
    expect(node).toContain('<base data-idena-static-root href="../">')
    expect(node).toContain('src="_next/node.js"')
    expect(runtime).toContain('f.p="_next/"')
    expect(social).toContain('content="base-uri \'none\'"')
    expect(social).toContain('src="./assets/social.js"')
    expect(social).toContain('href="./assets/social.css"')
    expect(social).not.toContain('data-idena-static-root')
    expect(
      new URL(
        './assets/social.js',
        'file:///opt/IdenaAI/resources/app.asar/renderer/out/idena-social/index.html#/'
      ).href
    ).toBe(
      'file:///opt/IdenaAI/resources/app.asar/renderer/out/idena-social/assets/social.js'
    )

    rewriteNextStaticAssets(outputDir)
    expect(fs.readFileSync(path.join(outputDir, 'home.html'), 'utf8')).toBe(
      home
    )
  })
})
