#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const BASE_MARKER = 'data-idena-static-root'
const ROOT_ASSET_PATTERN = /(\b(?:href|src)=["'])\/((?:_next|static)\/)/gu
const ABSOLUTE_WEBPACK_PUBLIC_PATH_PATTERN = /(\.p=)(["'])\/_next\/\2/gu
const RELATIVE_WEBPACK_PUBLIC_PATH_PATTERN = /\.p=(["'])_next\/\1/u

function listFiles(rootDir, predicate) {
  const entries = fs.readdirSync(rootDir, {withFileTypes: true})
  const files = []

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    const entryPath = path.join(rootDir, entry.name)

    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath, predicate))
    } else if (entry.isFile() && predicate(entryPath)) {
      files.push(entryPath)
    }
  }

  return files
}

function baseHrefForHtml(outputDir, htmlPath) {
  const relativeDirectory = path.relative(outputDir, path.dirname(htmlPath))

  if (
    relativeDirectory === '..' ||
    relativeDirectory.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`HTML file escapes renderer output: ${htmlPath}`)
  }

  if (!relativeDirectory || relativeDirectory === '.') {
    return './'
  }

  return '../'.repeat(relativeDirectory.split(path.sep).filter(Boolean).length)
}

function upsertStaticRootBase(html, baseHref) {
  const markedBasePattern = new RegExp(
    `<base\\s+${BASE_MARKER}(?:=(?:""|''))?\\s+href=(["'])[^"']*\\1\\s*/?>`,
    'iu'
  )
  const nextBase = `<base ${BASE_MARKER} href="${baseHref}">`

  if (markedBasePattern.test(html)) {
    return html.replace(markedBasePattern, nextBase)
  }

  if (/<base\b/iu.test(html)) {
    throw new Error('Renderer HTML already contains an unmanaged base element')
  }

  if (!/<head(?:\s[^>]*)?>/iu.test(html)) {
    throw new Error('Renderer HTML does not contain a head element')
  }

  return html.replace(/<head(?:\s[^>]*)?>/iu, (head) => `${head}${nextBase}`)
}

function rewriteHtml(outputDir, htmlPath) {
  const source = fs.readFileSync(htmlPath, 'utf8')
  const baseHref = baseHrefForHtml(outputDir, htmlPath)
  const withBase = upsertStaticRootBase(source, baseHref)
  const rewritten = withBase.replace(ROOT_ASSET_PATTERN, '$1$2')

  if (ROOT_ASSET_PATTERN.test(rewritten)) {
    throw new Error(`Root-relative renderer asset remains in ${htmlPath}`)
  }

  fs.writeFileSync(htmlPath, rewritten)
}

function rewriteWebpackRuntime(runtimePath) {
  const source = fs.readFileSync(runtimePath, 'utf8')
  const rewritten = source.replace(
    ABSOLUTE_WEBPACK_PUBLIC_PATH_PATTERN,
    '$1$2_next/$2'
  )

  if (
    ABSOLUTE_WEBPACK_PUBLIC_PATH_PATTERN.test(rewritten) ||
    !RELATIVE_WEBPACK_PUBLIC_PATH_PATTERN.test(rewritten)
  ) {
    throw new Error(
      `Webpack runtime does not expose a relative public path: ${runtimePath}`
    )
  }

  fs.writeFileSync(runtimePath, rewritten)
}

function rewriteNextStaticAssets(outputDir) {
  const normalizedOutputDir = path.resolve(outputDir)

  if (!fs.statSync(normalizedOutputDir).isDirectory()) {
    throw new Error(
      `Renderer output is not a directory: ${normalizedOutputDir}`
    )
  }

  const htmlFiles = listFiles(normalizedOutputDir, (filePath) =>
    filePath.endsWith('.html')
  )
  const webpackRuntimeFiles = listFiles(
    path.join(normalizedOutputDir, '_next', 'static', 'chunks'),
    (filePath) =>
      path.basename(filePath).startsWith('webpack-') && filePath.endsWith('.js')
  )

  if (htmlFiles.length === 0) {
    throw new Error('Renderer output contains no HTML files')
  }

  if (webpackRuntimeFiles.length === 0) {
    throw new Error('Renderer output contains no webpack runtime')
  }

  htmlFiles.forEach((htmlPath) => rewriteHtml(normalizedOutputDir, htmlPath))
  webpackRuntimeFiles.forEach(rewriteWebpackRuntime)

  return {
    htmlFiles: htmlFiles.length,
    webpackRuntimeFiles: webpackRuntimeFiles.length,
  }
}

if (require.main === module) {
  const outputDir =
    process.argv[2] || path.join(__dirname, '..', 'renderer', 'out')
  const result = rewriteNextStaticAssets(outputDir)
  console.log(JSON.stringify(result))
}

module.exports = {
  baseHrefForHtml,
  rewriteNextStaticAssets,
}
