#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const {execFileSync} = require('child_process')

const scannedPrefixes = ['main/', 'renderer/']
const scannedExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])

const blockedPatterns = [
  {
    name: 'dynamic Function constructor',
    regex: /\b(?:new\s+)?Function\s*\(/g,
  },
  {
    name: 'electron.remote namespace',
    regex: /\belectron\s*\.\s*remote\b/g,
  },
  {
    name: 'require("electron").remote',
    regex: /\brequire\s*\(\s*['"]electron['"]\s*\)\s*\.\s*remote\b/g,
  },
  {
    name: '@electron/remote package',
    regex: /['"]@electron\/remote['"]/g,
  },
  {
    name: 'remote destructured from electron require',
    regex:
      /\b(?:const|let|var)\s*\{[^}]*\bremote\b[^}]*\}\s*=\s*require\s*\(\s*['"]electron['"]\s*\)/g,
  },
  {
    name: 'remote destructured from imported electron object',
    regex: /\b(?:const|let|var)\s*\{[^}]*\bremote\b[^}]*\}\s*=\s*electron\b/g,
  },
  {
    name: 'remote imported from electron',
    regex: /\bimport\s*\{[^}]*\bremote\b[^}]*\}\s*from\s*['"]electron['"]/g,
  },
  {
    name: 'enableRemoteModule enabled',
    regex: /\benableRemoteModule\s*:\s*true\b/g,
  },
]

function listTrackedFiles() {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    {encoding: 'utf8'}
  )
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function shouldScan(filePath) {
  return (
    scannedPrefixes.some((prefix) => filePath.startsWith(prefix)) &&
    scannedExtensions.has(path.extname(filePath).toLowerCase())
  )
}

function findPatternMatches(filePath) {
  if (!fs.existsSync(filePath)) {
    return []
  }

  const content = fs.readFileSync(filePath, 'utf8')
  const fileFindings = []

  for (const pattern of blockedPatterns) {
    pattern.regex.lastIndex = 0
    let match = pattern.regex.exec(content)
    while (match) {
      fileFindings.push({
        filePath,
        line: content.slice(0, match.index).split('\n').length,
        name: pattern.name,
        value: match[0],
      })
      match = pattern.regex.exec(content)
    }
  }

  return fileFindings
}

const findings = listTrackedFiles()
  .filter(shouldScan)
  .flatMap((filePath) => findPatternMatches(filePath))

const mainIndex = fs.existsSync('main/index.js')
  ? fs.readFileSync('main/index.js', 'utf8')
  : ''
const socialProtocol = fs.existsSync('main/idena-social-protocol.js')
  ? fs.readFileSync('main/idena-social-protocol.js', 'utf8')
  : ''
const socialEmbed = fs.existsSync(
  'renderer/shared/components/social-desktop-embed.js'
)
  ? fs.readFileSync(
      'renderer/shared/components/social-desktop-embed.js',
      'utf8'
    )
  : ''
const socialPolicy = fs.existsSync(
  'renderer/shared/components/social-desktop-rpc-policy.js'
)
  ? fs.readFileSync(
      'renderer/shared/components/social-desktop-rpc-policy.js',
      'utf8'
    )
  : ''
if (!/\bnodeIntegration\s*:\s*false\b/.test(mainIndex)) {
  findings.push({
    filePath: 'main/index.js',
    line: 1,
    name: 'main window nodeIntegration guard',
    value: 'nodeIntegration: false missing',
  })
}

const socialProtocolGuards = [
  ['standard custom scheme', /\bstandard\s*:\s*true\b/],
  ['secure custom scheme', /\bsecure\s*:\s*true\b/],
  ['CSP bypass disabled', /\bbypassCSP\s*:\s*false\b/],
  ['service workers disabled', /\ballowServiceWorkers\s*:\s*false\b/],
  ['extension access disabled', /\ballowExtensions\s*:\s*false\b/],
  ['request method allowlist', /\['GET',\s*'HEAD'\]\.includes\(method\)/],
  ['real path confinement', /isPathInside\(realRoot,\s*realCandidatePath\)/],
]

for (const [name, regex] of socialProtocolGuards) {
  if (!regex.test(socialProtocol)) {
    findings.push({
      filePath: 'main/idena-social-protocol.js',
      line: 1,
      name,
      value: 'required idena.social protocol guard missing',
    })
  }
}

if (!/idena-social:\/\/app\/index\.html#\//.test(socialPolicy)) {
  findings.push({
    filePath: 'renderer/shared/components/social-desktop-rpc-policy.js',
    line: 1,
    name: 'isolated idena.social origin',
    value: 'dedicated protocol URL missing',
  })
}

if (
  !/sandbox="allow-scripts allow-same-origin allow-popups"/.test(socialEmbed)
) {
  findings.push({
    filePath: 'renderer/shared/components/social-desktop-embed.js',
    line: 1,
    name: 'isolated idena.social sandbox',
    value: 'required sandbox policy missing',
  })
}

if (findings.length > 0) {
  console.error('Electron safety check failed:')
  for (const finding of findings) {
    console.error(
      `- ${finding.filePath}:${finding.line} ${finding.name}: ${finding.value}`
    )
  }
  process.exit(1)
}

console.log('Electron safety check passed.')
