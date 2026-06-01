const {normalizeSha256Hex, sha256Json, sha256Text} = require('./hash')

const EVIDENCE_ANCHOR_VERSION = 1
const MAX_EVIDENCE_QUOTE_CHARS = 320

function normalizeString(value) {
  return String(value || '').trim()
}

function normalizeConfidence(value, fallback = 0) {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.max(0, Math.min(1, parsed))
}

function normalizeQuote(value, maxQuoteChars = MAX_EVIDENCE_QUOTE_CHARS) {
  const quote = normalizeString(value)
  const limit = Math.max(0, Number.parseInt(maxQuoteChars, 10) || 0)

  if (quote.length > limit) {
    throw new Error(`Evidence quote exceeds ${limit} characters`)
  }

  return quote
}

function createEvidenceAnchor(anchor = {}, options = {}) {
  const sourceId = normalizeString(anchor.sourceId)

  if (!sourceId) {
    throw new Error('Evidence anchor sourceId is required')
  }

  const paragraphHash = normalizeSha256Hex(anchor.paragraphHash, {
    fieldName: 'paragraphHash',
  })
  const quote = normalizeQuote(anchor.quote, options.maxQuoteChars)
  const textSelector = normalizeString(anchor.textSelector)
  const path = normalizeString(anchor.path)

  if (!paragraphHash && !quote && !textSelector && !path) {
    throw new Error(
      'Evidence anchor needs a paragraphHash, quote, textSelector, or path'
    )
  }

  return {
    schemaVersion: EVIDENCE_ANCHOR_VERSION,
    sourceId,
    section: normalizeString(anchor.section),
    title: normalizeString(anchor.title),
    path,
    textSelector,
    paragraphHash:
      paragraphHash || (quote ? sha256Text(quote.toLowerCase()) : ''),
    quote,
    quoteCharLength: quote.length,
    sourceVersion: normalizeString(anchor.sourceVersion),
    sourceContentHash: normalizeSha256Hex(anchor.sourceContentHash, {
      fieldName: 'sourceContentHash',
    }),
    anchorConfidence: normalizeConfidence(anchor.anchorConfidence, 0),
  }
}

function normalizeEvidenceAnchors(anchors = [], options = {}) {
  if (!Array.isArray(anchors)) {
    return []
  }

  return anchors
    .map((anchor) => createEvidenceAnchor(anchor, options))
    .sort((left, right) => {
      const leftKey = `${left.sourceId}|${left.path}|${left.paragraphHash}`
      const rightKey = `${right.sourceId}|${right.path}|${right.paragraphHash}`
      return leftKey.localeCompare(rightKey)
    })
}

function hashEvidenceAnchor(anchor = {}) {
  return sha256Json(createEvidenceAnchor(anchor))
}

module.exports = {
  EVIDENCE_ANCHOR_VERSION,
  MAX_EVIDENCE_QUOTE_CHARS,
  createEvidenceAnchor,
  hashEvidenceAnchor,
  normalizeEvidenceAnchors,
}
