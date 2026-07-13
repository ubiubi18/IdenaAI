#!/usr/bin/env node

const fs = require('fs-extra')
const os = require('os')
const path = require('path')

const {createAiProviderBridge} = require('../main/ai-providers/bridge')

const PROVIDER = 'deepinfra'
const DEFAULT_MODEL = 'Qwen/Qwen3.6-35B-A3B'
const DEFAULT_KEYWORDS = ['window', 'cup']

function defaultUserDataDir() {
  if (process.env.IDENA_DESKTOP_USER_DATA_DIR) {
    return path.resolve(process.env.IDENA_DESKTOP_USER_DATA_DIR)
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'IdenaAI')
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'IdenaAI'
    )
  }
  return path.join(os.homedir(), '.config', 'IdenaAI')
}

function printHelp() {
  console.log(`Usage: DEEPINFRA_API_KEY=... npm run prepare:qwen-flip-draft -- [options]

Prepares one off-chain Idena flip storyboard draft with DeepInfra Qwen 3.6.
This writes a text draft only. Rendering the 4 panel images still requires an
image-capable provider in the app, such as OpenAI or Gemini.

Options:
  --keywords <a,b>            Keyword pair. Default: ${DEFAULT_KEYWORDS.join(
    ','
  )}
  --model <id>                Model id. Default: ${DEFAULT_MODEL}
  --user-data-dir <path>      App profile dir. Default: ${defaultUserDataDir()}
  --output <path>             Write draft JSON to this path
  --max-cost-usd <amount>     Local budget guard for this request. Default: 1
  --request-timeout-ms <n>    Request timeout. Default: 90000
  --max-retries <n>           Provider retries. Default: 1
  --help                      Show this help
`)
}

function readValue(argv, index, name) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

function toNonNegativeNumber(value, fallback, name) {
  if (value == null) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`)
  }
  return parsed
}

function toPositiveInt(value, fallback, name) {
  if (value == null) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function toNonNegativeInt(value, fallback, name) {
  if (value == null) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return parsed
}

function parseKeywords(value) {
  const keywords = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2)

  if (keywords.length !== 2) {
    throw new Error(
      'Keyword pair must contain exactly two comma-separated words'
    )
  }

  return keywords
}

function parseArgs(argv) {
  const options = {
    keywords: DEFAULT_KEYWORDS,
    model: DEFAULT_MODEL,
    userDataDir: defaultUserDataDir(),
    outputPath: null,
    maxCostUsd: 1,
    requestTimeoutMs: 90000,
    maxRetries: 1,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--keywords') {
      options.keywords = parseKeywords(readValue(argv, index, arg))
      index += 1
    } else if (arg === '--model') {
      options.model = readValue(argv, index, arg).trim()
      index += 1
    } else if (arg === '--user-data-dir') {
      options.userDataDir = path.resolve(readValue(argv, index, arg))
      index += 1
    } else if (arg === '--output') {
      options.outputPath = path.resolve(readValue(argv, index, arg))
      index += 1
    } else if (arg === '--max-cost-usd') {
      options.maxCostUsd = toNonNegativeNumber(
        readValue(argv, index, arg),
        1,
        arg
      )
      index += 1
    } else if (arg === '--request-timeout-ms') {
      options.requestTimeoutMs = toPositiveInt(
        readValue(argv, index, arg),
        90000,
        arg
      )
      index += 1
    } else if (arg === '--max-retries') {
      options.maxRetries = toNonNegativeInt(readValue(argv, index, arg), 1, arg)
      index += 1
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }

  return options
}

function createLogger() {
  return {
    info(message, meta) {
      if (process.env.DEBUG) {
        console.error(`[qwen-flip-draft:info] ${message}`, meta || '')
      }
    },
    error(message, meta) {
      console.error(`[qwen-flip-draft:error] ${message}`, meta || '')
    },
  }
}

function summarizeDraft(result, outputPath) {
  const story = Array.isArray(result.stories) ? result.stories[0] : null
  return {
    ok: Boolean(story),
    provider: result.provider,
    model: result.model,
    keywords: result.keywords,
    outputPath,
    title: story ? story.title : '',
    panels: story && Array.isArray(story.panels) ? story.panels : [],
    tokenUsage: result.tokenUsage,
    estimatedUsd: result.costs ? result.costs.estimatedUsd : null,
    generationPath: result.generationPath || '',
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  const apiKey = String(
    process.env.DEEPINFRA_API_KEY || process.env.IDENAAI_DEEPINFRA_API_KEY || ''
  ).trim()

  if (!apiKey) {
    throw new Error(
      'DEEPINFRA_API_KEY or IDENAAI_DEEPINFRA_API_KEY must be set'
    )
  }

  const bridge = createAiProviderBridge(createLogger(), {
    getUserDataPath: () => options.userDataDir,
  })
  bridge.setProviderKey({provider: PROVIDER, apiKey})

  const result = await bridge.generateStoryOptions({
    provider: PROVIDER,
    model: options.model,
    keywords: options.keywords,
    storyOptionCount: 1,
    includeNoise: false,
    hasCustomStory: false,
    disableLocalFallback: true,
    fastStoryMode: true,
    requestTimeoutMs: options.requestTimeoutMs,
    maxRetries: options.maxRetries,
    maxOutputTokens: 2600,
    temperature: 0.72,
    providerDailyBudgetRemainingUsd: options.maxCostUsd,
  })

  const outputPath =
    options.outputPath ||
    path.join(
      options.userDataDir,
      'ai-benchmark',
      `qwen36-flip-draft-${Date.now()}.json`
    )
  const draft = {
    ok: true,
    createdAt: new Date().toISOString(),
    provider: PROVIDER,
    model: options.model,
    keywords: options.keywords,
    note: 'Text storyboard draft only. Use the IdenaAI flip builder image provider lane to render panels.',
    ...result,
  }

  await fs.ensureDir(path.dirname(outputPath))
  await fs.writeJson(outputPath, draft, {spaces: 2})
  await fs.chmod(outputPath, 0o600).catch(() => {})

  console.log(JSON.stringify(summarizeDraft(draft, outputPath), null, 2))
}

main().catch((error) => {
  console.error(`[qwen-flip-draft:error] ${error.message}`)
  if (process.env.DEBUG) {
    console.error(error.stack)
  }
  process.exit(1)
})
