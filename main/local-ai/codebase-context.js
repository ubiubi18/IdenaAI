const path = require('path')
const fs = require('fs-extra')

const DEFAULT_MAX_FILES = 14
const DEFAULT_MAX_CHARS = 70000
const DEFAULT_MAX_FILE_CHARS = 6000
const MAX_SCAN_FILES = 6000
const MAX_FILE_BYTES = 45000
const MIN_TOKEN_LENGTH = 2

const IGNORED_DIR_NAMES = new Set([
  '.git',
  '.next',
  '.nyc_output',
  '.playwright-cli',
  '.tmp',
  '.vscode',
  'build',
  'coverage',
  'data',
  'dist',
  'downloads',
  'idena-go',
  'idena-wasm',
  'idena-wasm-binding',
  'logs',
  'node_modules',
  'out',
  'output',
  'tmp',
  'vendor',
])

const IGNORED_PATH_PARTS = new Set([
  'renderer/out',
  'renderer/.next',
  'python/idena_arc/idena_arc_sidecar.egg-info',
  'samples/flips',
  'samples/arc-agi-v2-public-eval',
])

const SKIPPED_PATH_NOTES = [
  {
    path: 'node_modules',
    reason: 'dependency tree; too large and not project-authored source',
  },
  {
    path: 'idena-go',
    reason: 'external Idena node source tree; inspect only on a focused ask',
  },
  {
    path: 'idena-wasm',
    reason: 'external WASM source tree; inspect only on a focused ask',
  },
  {
    path: 'idena-wasm-binding',
    reason: 'external WASM binding source; inspect only on a focused ask',
  },
  {
    path: 'samples/flips',
    reason: 'large flip fixtures; not useful for source audit unless requested',
  },
  {
    path: 'samples/arc-agi-v2-public-eval',
    reason: 'public eval fixtures; not source code for app audit',
  },
  {
    path: 'renderer/out',
    reason: 'generated renderer output',
  },
  {
    path: 'renderer/.next',
    reason: 'generated Next.js build cache',
  },
  {
    path: 'vendor',
    reason: 'vendored upstream UI source; inspect only on a focused ask',
  },
]

const ALLOWED_FILE_EXTENSIONS = new Set([
  '',
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.py',
  '.sh',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
])

const SENSITIVE_FILE_PATTERNS = [
  /^\.env($|\.)/u,
  /^id_rsa/u,
  /^id_dsa/u,
  /^id_ecdsa/u,
  /^id_ed25519/u,
  /secret/iu,
  /credential/iu,
  /private[-_]?key/iu,
]

const ALWAYS_USEFUL_FILES = new Set([
  'AGENTS.md',
  'README.md',
  'package.json',
  'main/index.js',
  'main/preload.js',
  'renderer/pages/ai-chat.js',
  'renderer/pages/idena-arc.js',
  'renderer/pages/settings/ai.js',
  'main/local-ai/manager.js',
  'main/local-ai/sidecar.js',
  'main/idena-arc/manager.js',
])

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(max, Math.max(min, parsed))
}

function normalizeRelativePath(value) {
  return String(value || '')
    .replace(/\\/gu, '/')
    .replace(/^\/+/u, '')
}

function isInsidePath(parent, child) {
  const relative = path.relative(parent, child)
  return Boolean(
    relative && !relative.startsWith('..') && !path.isAbsolute(relative)
  )
}

function resolveAllowedRoot(root, allowedRoots = []) {
  const defaultRoot = path.resolve(
    process.env.IDENA_CODEBASE_CONTEXT_ROOT || process.cwd()
  )
  const requestedRoot = path.resolve(String(root || defaultRoot))
  const normalizedAllowedRoots = [defaultRoot]
    .concat(Array.isArray(allowedRoots) ? allowedRoots : [])
    .map((item) => path.resolve(String(item || '')))
    .filter(Boolean)

  if (
    !normalizedAllowedRoots.some(
      (allowedRoot) =>
        requestedRoot === allowedRoot ||
        isInsidePath(allowedRoot, requestedRoot)
    )
  ) {
    throw new Error('Codebase context root is outside the allowed workspace')
  }

  return requestedRoot
}

function shouldIgnoreRelativePath(relativePath) {
  const normalized = normalizeRelativePath(relativePath)
  const parts = normalized.split('/').filter(Boolean)

  if (parts.some((part) => IGNORED_DIR_NAMES.has(part))) {
    return true
  }

  return [...IGNORED_PATH_PARTS].some(
    (ignoredPath) =>
      normalized === ignoredPath || normalized.startsWith(`${ignoredPath}/`)
  )
}

function shouldIgnoreFile(relativePath) {
  const normalized = normalizeRelativePath(relativePath)
  const baseName = path.basename(normalized)
  const extension = path.extname(baseName).toLowerCase()

  if (shouldIgnoreRelativePath(normalized)) {
    return true
  }

  if (!ALLOWED_FILE_EXTENSIONS.has(extension)) {
    return true
  }

  if (SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(baseName))) {
    return true
  }

  if (/lock$/u.test(baseName) && baseName !== 'package-lock.json') {
    return true
  }

  return false
}

async function collectCodebaseFiles(root) {
  const rootPath = path.resolve(root)
  const files = []

  async function visit(directory) {
    if (files.length >= MAX_SCAN_FILES) {
      return
    }

    let entries = []

    try {
      entries = await fs.readdir(directory, {withFileTypes: true})
    } catch {
      return
    }

    entries.sort((a, b) => a.name.localeCompare(b.name))

    for (const entry of entries) {
      if (files.length >= MAX_SCAN_FILES) {
        return
      }

      const absolutePath = path.join(directory, entry.name)
      const relativePath = normalizeRelativePath(
        path.relative(rootPath, absolutePath)
      )

      if (relativePath && !shouldIgnoreRelativePath(relativePath)) {
        if (entry.isDirectory()) {
          await visit(absolutePath)
        } else if (entry.isFile() && !shouldIgnoreFile(relativePath)) {
          files.push(relativePath)
        }
      }
    }
  }

  await visit(rootPath)

  return files.sort()
}

async function detectSkippedPaths(root) {
  const rootPath = path.resolve(root)
  const skipped = []

  for (const note of SKIPPED_PATH_NOTES) {
    const absolutePath = path.join(rootPath, note.path)

    // eslint-disable-next-line no-await-in-loop
    if (await fs.pathExists(absolutePath)) {
      skipped.push({...note})
    }
  }

  return skipped
}

function buildRepositoryTreeSummary(files = [], skippedPaths = []) {
  const topLevelCounts = new Map()
  const sourceAreaCounts = new Map()

  files.forEach((relativePath) => {
    const parts = normalizeRelativePath(relativePath).split('/').filter(Boolean)
    const topLevel = parts[0] || relativePath
    const sourceArea = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : topLevel

    topLevelCounts.set(topLevel, (topLevelCounts.get(topLevel) || 0) + 1)
    sourceAreaCounts.set(
      sourceArea,
      (sourceAreaCounts.get(sourceArea) || 0) + 1
    )
  })

  const formatCounts = (counts, limit) =>
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([name, count]) => `- ${name}: ${count} file(s)`)

  return [
    'Repository map before snippets:',
    ...formatCounts(topLevelCounts, 14),
    '',
    'Main source areas:',
    ...formatCounts(sourceAreaCounts, 18),
    '',
    skippedPaths.length ? 'Skipped heavy/generated/private paths:' : '',
    ...skippedPaths.map((item) => `- ${item.path}: ${item.reason}`),
  ]
    .filter((line) => line !== '')
    .join('\n')
}

function tokenizeQuery(value) {
  const stopWords = new Set([
    'about',
    'able',
    'audit',
    'build',
    'change',
    'code',
    'codebase',
    'could',
    'file',
    'from',
    'have',
    'local',
    'make',
    'please',
    'propose',
    'read',
    'repo',
    'should',
    'talk',
    'that',
    'this',
    'used',
    'with',
  ])

  return [
    ...new Set(
      String(value || '')
        .toLowerCase()
        .match(/[a-z0-9_.-]+/gu) || []
    ),
  ]
    .map((token) => token.replace(/^[._-]+|[._-]+$/gu, ''))
    .filter(
      (token) => token.length >= MIN_TOKEN_LENGTH && !stopWords.has(token)
    )
    .slice(0, 48)
}

function normalizeExcludedPaths(value) {
  if (!Array.isArray(value)) {
    return new Set()
  }

  return new Set(
    value
      .map((item) => normalizeRelativePath(item))
      .filter((item) => item && !item.startsWith('../'))
      .slice(0, 256)
  )
}

function scoreFile(relativePath, queryTokens = []) {
  const normalizedPath = normalizeRelativePath(relativePath)
  const lowerPath = normalizedPath.toLowerCase()
  const baseName = path.basename(lowerPath)
  const isGameQuestion =
    queryTokens.includes('game') || queryTokens.includes('games')
  let score = 0

  if (ALWAYS_USEFUL_FILES.has(normalizedPath)) {
    score += 20
  }

  if (lowerPath.startsWith('main/local-ai/')) {
    score += 10
  }

  if (lowerPath.startsWith('renderer/pages/')) {
    score += 8
  }

  if (lowerPath.startsWith('main/idena-arc/')) {
    score += 6
  }

  if (
    lowerPath.startsWith('docs/idenaarc') ||
    lowerPath.startsWith('docs/protocol/')
  ) {
    score += 3
  }

  if (isGameQuestion) {
    if (lowerPath.startsWith('main/idena-arc/mvp/')) {
      score += 20
    }

    if (
      lowerPath.includes('rule-sandbox-grid') ||
      lowerPath.includes('visible-goal') ||
      lowerPath.includes('human-rule') ||
      lowerPath.includes('local-demo') ||
      lowerPath.includes('game')
    ) {
      score += 18
    }

    if (
      lowerPath.startsWith('renderer/pages/idena-arc') ||
      lowerPath.startsWith('docs/idenaarc')
    ) {
      score += 10
    }
  }

  for (const token of queryTokens) {
    if (lowerPath.includes(token)) {
      score += baseName.includes(token) ? 12 : 5
    }
  }

  return score
}

async function readTextFile(root, relativePath) {
  const absolutePath = path.resolve(root, relativePath)
  const rootPath = path.resolve(root)

  if (!(absolutePath === rootPath || isInsidePath(rootPath, absolutePath))) {
    throw new Error('Refusing to read outside the codebase root')
  }

  const stats = await fs.stat(absolutePath)

  if (!stats.isFile()) {
    return null
  }

  if (stats.size > MAX_FILE_BYTES) {
    return {
      path: normalizeRelativePath(relativePath),
      bytes: stats.size,
      skipped: true,
      reason: 'large_file',
    }
  }

  const raw = await fs.readFile(absolutePath, 'utf8')

  if (raw.includes('\u0000')) {
    return {
      path: normalizeRelativePath(relativePath),
      bytes: stats.size,
      skipped: true,
      reason: 'binary_or_null_bytes',
    }
  }

  return {
    path: normalizeRelativePath(relativePath),
    bytes: stats.size,
    content: raw.length > MAX_FILE_BYTES ? raw.slice(0, MAX_FILE_BYTES) : raw,
    truncated: raw.length > MAX_FILE_BYTES,
  }
}

async function buildCodebaseContext(options = {}) {
  const root = resolveAllowedRoot(options.root, options.allowedRoots)
  const rootStats = await fs.stat(root)

  if (!rootStats.isDirectory()) {
    throw new Error('Codebase context root is not a directory')
  }

  const query = String(options.query || '').slice(0, 4000)
  const excludedPaths = normalizeExcludedPaths(options.excludePaths)
  const maxFiles = clampInteger(options.maxFiles, DEFAULT_MAX_FILES, 1, 24)
  const maxChars = clampInteger(
    options.maxChars,
    DEFAULT_MAX_CHARS,
    8000,
    120000
  )
  const maxFileChars = clampInteger(
    options.maxFileChars,
    DEFAULT_MAX_FILE_CHARS,
    1200,
    MAX_FILE_BYTES
  )
  const queryTokens = tokenizeQuery(query)
  const allFiles = await collectCodebaseFiles(root)
  const skippedPaths = await detectSkippedPaths(root)
  const treeSummary = buildRepositoryTreeSummary(allFiles, skippedPaths)
  const rankedCandidates = allFiles
    .filter((relativePath) => !excludedPaths.has(relativePath))
    .map((relativePath) => ({
      path: relativePath,
      score: scoreFile(relativePath, queryTokens),
    }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  const rankedFiles = rankedCandidates.slice(
    0,
    Math.max(maxFiles * 4, maxFiles)
  )

  const includedFiles = []
  const skippedFiles = []
  let totalChars = 0

  for (const item of rankedFiles) {
    if (includedFiles.length >= maxFiles || totalChars >= maxChars) {
      break
    }

    // eslint-disable-next-line no-await-in-loop
    const file = await readTextFile(root, item.path)

    if (file && file.skipped) {
      skippedFiles.push(file)
    } else if (file) {
      const remainingChars = maxChars - totalChars
      const content =
        file.content.length > Math.min(remainingChars, maxFileChars)
          ? file.content.slice(0, Math.min(remainingChars, maxFileChars))
          : file.content

      includedFiles.push({
        ...file,
        chars: content.length,
        content,
        truncated: file.truncated || content.length < file.content.length,
      })
      totalChars += content.length
    }
  }

  const context = [
    'Local codebase context selected by the IdenaAI desktop app.',
    'Access mode: read-only snippets from the owner-authorized local workspace.',
    'Important: you have read-only access to the source snippets below for this chat turn.',
    'Do not answer that you have no codebase access. You do not have shell access or full filesystem access, but you can inspect and reason over these snippets.',
    'Workflow: use the repository map first, inspect the small snippets second, and treat skipped heavy paths as intentionally unavailable unless the user asks for them.',
    'If the selected snippets are insufficient, state the gap and propose the next narrow code slice instead of pretending to have full-repo access.',
    `Workspace root: ${root}`,
    `Files scanned: ${allFiles.length}`,
    `Files included: ${includedFiles.length}`,
    `Per-file snippet cap: ${maxFileChars} chars`,
    query ? `User request used for file selection: ${query}` : '',
    '',
    treeSummary,
    '',
    skippedFiles.length ? 'Skipped candidate files in this pass:' : '',
    ...skippedFiles.map(
      (file) => `- ${file.path}: ${file.reason}, ${file.bytes} bytes`
    ),
    '',
    ...includedFiles.flatMap((file) => [
      `--- file: ${file.path}`,
      file.content,
      file.truncated ? '[truncated]' : '',
      '',
    ]),
  ]
    .filter((line) => line !== '')
    .join('\n')

  return {
    ok: true,
    root,
    scannedFileCount: allFiles.length,
    candidateFileCount: rankedCandidates.length,
    includedFileCount: includedFiles.length,
    totalChars,
    truncated:
      totalChars >= maxChars || includedFiles.length < rankedCandidates.length,
    remainingCandidateCount: Math.max(
      0,
      rankedCandidates.length - includedFiles.length
    ),
    excludedFileCount: excludedPaths.size,
    skippedPaths,
    skippedFiles,
    treeSummary,
    files: includedFiles.map(({path: filePath, bytes, chars, truncated}) => ({
      path: filePath,
      bytes,
      chars,
      truncated,
    })),
    context,
  }
}

module.exports = {
  buildCodebaseContext,
  collectCodebaseFiles,
  resolveAllowedRoot,
  shouldIgnoreFile,
  tokenizeQuery,
  buildRepositoryTreeSummary,
  detectSkippedPaths,
}
