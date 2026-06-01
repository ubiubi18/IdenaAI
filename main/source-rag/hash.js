const crypto = require('crypto')

function normalizeJsonValue(value, seen = new Set()) {
  if (value === undefined || typeof value === 'function') {
    return undefined
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      const normalized = normalizeJsonValue(item, seen)
      return normalized === undefined ? null : normalized
    })
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      throw new Error('Cannot stable stringify circular JSON')
    }

    seen.add(value)

    const result = {}
    Object.keys(value)
      .sort()
      .forEach((key) => {
        const normalized = normalizeJsonValue(value[key], seen)
        if (normalized !== undefined) {
          result[key] = normalized
        }
      })

    seen.delete(value)
    return result
  }

  return String(value)
}

function stableStringify(value) {
  return JSON.stringify(normalizeJsonValue(value))
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex')
}

function sha256Json(value) {
  return sha256Text(stableStringify(value))
}

function normalizeSha256Hex(
  value,
  {fieldName = 'hash', required = false} = {}
) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()

  if (!normalized) {
    if (required) {
      throw new Error(`${fieldName} is required`)
    }
    return ''
  }

  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new Error(`${fieldName} must be a lowercase sha256 hex digest`)
  }

  return normalized
}

module.exports = {
  normalizeSha256Hex,
  stableStringify,
  sha256Text,
  sha256Json,
}
