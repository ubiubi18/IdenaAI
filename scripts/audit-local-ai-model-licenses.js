#!/usr/bin/env node

const {
  MANAGED_LOCAL_RUNTIME_INSTALL_PROFILES,
  QWEN36_27B_CLAUDE_OPUS_OLLAMA_MODEL,
  QWEN36_27B_CLAUDE_OPUS_HF_OLLAMA_MODEL,
  QWEN36_27B_CLAUDE_OPUS_GGUF_REPO,
} = require('../renderer/shared/utils/local-ai-settings')

const ALLOWED_LICENSES = new Set(['apache-2.0', 'mit'])

function normalizeLicense(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeLicense).filter(Boolean).join(',')
  }

  return String(value || '')
    .trim()
    .toLowerCase()
}

function buildChecks() {
  const checks = [
    {
      label: 'default Ollama alias',
      localModel: QWEN36_27B_CLAUDE_OPUS_OLLAMA_MODEL,
      hfModel: QWEN36_27B_CLAUDE_OPUS_GGUF_REPO,
    },
    {
      label: 'portable Hugging Face Ollama target',
      localModel: QWEN36_27B_CLAUDE_OPUS_HF_OLLAMA_MODEL,
      hfModel: QWEN36_27B_CLAUDE_OPUS_GGUF_REPO,
    },
    {
      label: 'fast local-chat fallback',
      localModel: 'qwen3.5:9b',
      hfModel: 'Qwen/Qwen3.5-9B',
    },
    {
      label: 'legacy sidecar migration marker',
      localModel: 'phi-3.5-vision-instruct',
      hfModel: 'microsoft/Phi-3.5-vision-instruct',
    },
  ]

  Object.values(MANAGED_LOCAL_RUNTIME_INSTALL_PROFILES).forEach((profile) => {
    checks.push({
      label: profile.displayName,
      localModel: profile.modelId,
      hfModel: profile.modelId,
      revision: profile.revision,
    })
  })

  return checks
}

async function readModelLicense({hfModel, revision}) {
  const url = `https://huggingface.co/api/models/${hfModel}${
    revision ? `?revision=${encodeURIComponent(revision)}` : ''
  }`
  const response = await fetch(url)
  const body = await response.json().catch(() => ({}))
  const license = normalizeLicense(body.cardData?.license || body.license)
  const tagLicense = normalizeLicense(
    (body.tags || [])
      .find((tag) => String(tag).startsWith('license:'))
      ?.slice('license:'.length)
  )

  return {
    url,
    status: response.status,
    sha: body.sha || '',
    license: license || tagLicense,
  }
}

async function main() {
  const checks = buildChecks()
  const failures = []

  for (const check of checks) {
    const result = await readModelLicense(check)
    const allowed = ALLOWED_LICENSES.has(result.license)
    const status = allowed ? 'ok' : 'blocked'
    const revision = check.revision ? ` @ ${check.revision}` : ''
    const sha = result.sha ? ` (${result.sha.slice(0, 12)})` : ''

    console.log(
      `${status.padEnd(7)} ${result.license || 'missing-license'} ${
        check.localModel
      } -> ${check.hfModel}${revision}${sha}`
    )

    if (!allowed) {
      failures.push({
        ...check,
        ...result,
      })
    }
  }

  if (failures.length) {
    console.error(
      `\nLocal AI model license audit failed. Allowed licenses: ${Array.from(
        ALLOWED_LICENSES
      ).join(', ')}.`
    )
    failures.forEach((failure) => {
      console.error(`- ${failure.localModel} -> ${failure.url}`)
    })
    process.exit(1)
  }

  console.log(
    `\nLocal AI model license audit passed. Allowed licenses: ${Array.from(
      ALLOWED_LICENSES
    ).join(', ')}.`
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
