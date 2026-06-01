const {sha256Text} = require('./hash')

const DEFAULT_MAX_CHARS = 1200
const DEFAULT_OVERLAP_CHARS = 120

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function toNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function normalizeSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return {}
  }

  return {...source}
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

function splitParagraphIntoSentences(paragraph) {
  const matches = paragraph.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)
  return (matches && matches.length ? matches : [paragraph])
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitLongUnitByWords(unit, maxChars) {
  if (unit.length <= maxChars) {
    return [unit]
  }

  const chunks = []
  let current = ''
  const words = unit.split(/\s+/).filter(Boolean)

  words.forEach((word) => {
    if (word.length > maxChars) {
      if (current) {
        chunks.push(current)
        current = ''
      }

      for (let index = 0; index < word.length; index += maxChars) {
        chunks.push(word.slice(index, index + maxChars))
      }
      return
    }

    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxChars) {
      current = candidate
      return
    }

    if (current) {
      chunks.push(current)
    }
    current = word
  })

  if (current) {
    chunks.push(current)
  }

  return chunks
}

function splitIntoUnits(text, maxChars) {
  return text
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .reduce((units, paragraph) => {
      splitParagraphIntoSentences(paragraph).forEach((sentence) => {
        splitLongUnitByWords(sentence, maxChars).forEach((unit) => {
          units.push(unit)
        })
      })
      return units
    }, [])
}

function overlapTail(text, overlapChars) {
  if (!overlapChars || text.length <= overlapChars) {
    return ''
  }

  const rawTail = text.slice(-overlapChars).trim()
  const firstWhitespace = rawTail.search(/\s/)

  if (firstWhitespace > 0 && firstWhitespace < rawTail.length - 1) {
    return rawTail.slice(firstWhitespace + 1).trim()
  }

  return rawTail
}

function packUnits(units, {maxChars, overlapChars}) {
  const chunks = []
  let current = ''
  let currentIsOverlapOnly = false

  units.forEach((unit) => {
    const candidate = current ? `${current}\n\n${unit}` : unit

    if (candidate.length <= maxChars) {
      current = candidate
      currentIsOverlapOnly = false
      return
    }

    if (current && !currentIsOverlapOnly) {
      chunks.push(current)
      current = overlapTail(current, overlapChars)
      currentIsOverlapOnly = Boolean(current)
    }

    const overlappedCandidate = current ? `${current}\n\n${unit}` : unit

    if (overlappedCandidate.length <= maxChars) {
      current = overlappedCandidate
      currentIsOverlapOnly = false
      return
    }

    current = unit
    currentIsOverlapOnly = false
  })

  if (current && !currentIsOverlapOnly) {
    chunks.push(current)
  }

  return chunks
}

function chunkText(text, options = {}) {
  const normalizedText = normalizeText(text)
  if (!normalizedText) {
    return []
  }

  const maxChars = toPositiveInt(options.maxChars, DEFAULT_MAX_CHARS)
  const overlapChars = Math.min(
    toNonNegativeInt(options.overlapChars, DEFAULT_OVERLAP_CHARS),
    Math.max(0, maxChars - 1)
  )
  const source = normalizeSource(options.source)
  const units = splitIntoUnits(normalizedText, maxChars)

  return packUnits(units, {maxChars, overlapChars}).map((chunk, index) => {
    const contentHash = sha256Text(chunk)

    return {
      id: `chunk:${contentHash.slice(0, 32)}`,
      index,
      text: chunk,
      charLength: chunk.length,
      contentHash,
      source,
    }
  })
}

module.exports = {
  DEFAULT_MAX_CHARS,
  DEFAULT_OVERLAP_CHARS,
  chunkText,
}
