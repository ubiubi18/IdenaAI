#!/usr/bin/env node

const fs = require('fs-extra')
const os = require('os')
const path = require('path')

const {createAiProviderBridge} = require('../main/ai-providers/bridge')
const {createAiTestUnitBridge} = require('../main/ai-test-unit')

const PROVIDER = 'deepinfra'
const DEFAULT_MODEL = 'Qwen/Qwen3.6-35B-A3B'

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
  console.log(`Usage: DEEPINFRA_API_KEY=... npm run test:qwen-deepinfra -- [options]

Runs the off-chain AI test unit queue through DeepInfra Qwen 3.6.
The API key is read only from DEEPINFRA_API_KEY or IDENAAI_DEEPINFRA_API_KEY.

Options:
  --user-data-dir <path>      App profile dir. Default: ${defaultUserDataDir()}
  --model <id>                Model id. Default: ${DEFAULT_MODEL}
  --max-flips <n>             Max flips to run. Default: 20
  --batch-size <n>            Batch size. Default: 20
  --max-cost-usd <amount>     Local budget stop for the run. Default: 5
  --output <path>             Write full JSON result to this path
  --dequeue                   Remove tested flips from the local queue
  --provider-test-only        Only test the provider connection
  --no-provider-test          Skip the connection test before running flips
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

function toPositiveInt(value, fallback, name) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    if (value == null) return fallback
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function toNonNegativeNumber(value, fallback, name) {
  if (value == null) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`)
  }
  return parsed
}

function parseArgs(argv) {
  const options = {
    userDataDir: defaultUserDataDir(),
    model: DEFAULT_MODEL,
    maxFlips: 20,
    batchSize: 20,
    maxCostUsd: 5,
    outputPath: null,
    dequeue: false,
    providerTestOnly: false,
    skipProviderTest: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--user-data-dir') {
      options.userDataDir = path.resolve(readValue(argv, index, arg))
      index += 1
    } else if (arg === '--model') {
      options.model = readValue(argv, index, arg).trim()
      index += 1
    } else if (arg === '--max-flips') {
      options.maxFlips = toPositiveInt(readValue(argv, index, arg), 20, arg)
      index += 1
    } else if (arg === '--batch-size') {
      options.batchSize = toPositiveInt(readValue(argv, index, arg), 20, arg)
      index += 1
    } else if (arg === '--max-cost-usd') {
      options.maxCostUsd = toNonNegativeNumber(
        readValue(argv, index, arg),
        5,
        arg
      )
      index += 1
    } else if (arg === '--output') {
      options.outputPath = path.resolve(readValue(argv, index, arg))
      index += 1
    } else if (arg === '--dequeue') {
      options.dequeue = true
    } else if (arg === '--provider-test-only') {
      options.providerTestOnly = true
    } else if (arg === '--no-provider-test') {
      options.skipProviderTest = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!options.model) {
    throw new Error('--model cannot be empty')
  }
  return options
}

function createLogger() {
  function write(level, message, meta) {
    const suffix =
      meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ''
    console.error(`[qwen-deepinfra:${level}] ${message}${suffix}`)
  }

  return {
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  }
}

function formatPercent(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 'n/a'
  return `${(numeric * 100).toFixed(1)}%`
}

function summarizeResult(result) {
  const summary = result.summary || {}
  const evaluation = summary.evaluation || {}
  const tokens = summary.tokens || {}
  const costs = summary.costs || {}
  return {
    totalFlips: result.totalFlips,
    totalBatches: result.totalBatches,
    queueAfterRun: result.queueAfterRun,
    left: summary.left || 0,
    right: summary.right || 0,
    skipped: summary.skipped || 0,
    labeled: evaluation.labeled || 0,
    correct: evaluation.correct || 0,
    accuracyLabeled: formatPercent(evaluation.accuracyLabeled),
    accuracyAnswered: formatPercent(evaluation.accuracyAnswered),
    promptTokens: tokens.promptTokens || 0,
    completionTokens: tokens.completionTokens || 0,
    totalTokens: tokens.totalTokens || 0,
    estimatedUsd: costs.estimatedUsd == null ? null : costs.estimatedUsd,
    actualUsd: costs.actualUsd == null ? null : costs.actualUsd,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  const apiKey =
    process.env.DEEPINFRA_API_KEY || process.env.IDENAAI_DEEPINFRA_API_KEY
  if (!apiKey) {
    throw new Error(
      'Set DEEPINFRA_API_KEY or IDENAAI_DEEPINFRA_API_KEY before running'
    )
  }

  const logger = createLogger()
  const bridge = createAiProviderBridge(logger, {
    getUserDataPath: () => options.userDataDir,
  })
  bridge.setProviderKey({provider: PROVIDER, apiKey})

  console.log(
    `Using ${PROVIDER} ${options.model} with profile ${options.userDataDir}`
  )

  if (!options.skipProviderTest) {
    const providerResult = await bridge.testProvider({
      provider: PROVIDER,
      model: options.model,
    })
    console.log(
      `Provider test ok: model=${providerResult.model} latencyMs=${providerResult.latencyMs}`
    )
  }

  if (options.providerTestOnly) {
    return
  }

  const testUnit = createAiTestUnitBridge({
    logger,
    aiProviderBridge: bridge,
    dependencies: {
      getUserDataPath: () => options.userDataDir,
    },
  })
  const queue = await testUnit.listFlips({limit: options.maxFlips})
  if (!queue.total) {
    throw new Error(
      `No flips queued at ${path.join(
        options.userDataDir,
        'ai-benchmark',
        'test-unit-flips.json'
      )}`
    )
  }

  console.log(
    `Queued flips: ${queue.total}; running ${Math.min(
      queue.total,
      options.maxFlips
    )}`
  )

  const result = await testUnit.run(
    {
      provider: PROVIDER,
      model: options.model,
      benchmarkProfile: 'strict',
      maxFlips: options.maxFlips,
      batchSize: options.batchSize,
      dequeue: options.dequeue,
      providerDailyBudgetRemainingUsd: options.maxCostUsd,
    },
    {
      onProgress: (event) => {
        if (event.type === 'batch-start') {
          console.log(
            `Batch ${event.batch}/${event.totalBatches || '?'} started (${
              event.count
            } flips)`
          )
        } else if (event.type === 'batch-complete') {
          console.log(`Batch ${event.batch} complete`)
        } else if (event.type === 'run-complete') {
          console.log('Run complete')
        }
      },
    }
  )

  const outputPath =
    options.outputPath ||
    path.join(
      options.userDataDir,
      'ai-benchmark',
      `deepinfra-qwen36-run-${Date.now()}.json`
    )
  await fs.ensureDir(path.dirname(outputPath))
  await fs.writeJson(outputPath, result, {spaces: 2})
  await fs.chmod(outputPath, 0o600).catch(() => {})

  console.log(JSON.stringify(summarizeResult(result), null, 2))
  console.log(`Result JSON: ${outputPath}`)
}

main().catch((error) => {
  console.error(`[qwen-deepinfra:error] ${error.message}`)
  if (process.env.DEBUG) {
    console.error(error.stack)
  }
  process.exit(1)
})
