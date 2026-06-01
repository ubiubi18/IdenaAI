const PROMPT_INJECTION_PATTERNS = [
  {
    id: 'ignore-prior-instructions',
    severity: 'high',
    pattern:
      /\b(ignore|disregard|forget|override)\b.{0,60}\b(previous|prior|above|system|developer|instructions?)\b/iu,
  },
  {
    id: 'system-prompt-exfiltration',
    severity: 'high',
    pattern:
      /\b(reveal|print|show|dump|return)\b.{0,60}\b(system prompt|developer message|hidden instructions?)\b/iu,
  },
  {
    id: 'secret-exfiltration',
    severity: 'high',
    pattern:
      /\b(send|upload|post|exfiltrate|leak)\b.{0,80}\b(api key|token|password|secret|private key)\b/iu,
  },
  {
    id: 'role-reassignment',
    severity: 'medium',
    pattern: /\byou are now\b.{0,50}\b(system|developer|admin|root)\b/iu,
  },
  {
    id: 'tool-misuse',
    severity: 'medium',
    pattern:
      /\b(call|run|execute|use)\b.{0,60}\b(tool|function|shell|terminal)\b.{0,60}\b(ignore|bypass|without asking)\b/iu,
  },
]

const SEVERITY_SCORE = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
}

function normalizeText(value) {
  return String(value || '').trim()
}

function maxSeverity(left, right) {
  return SEVERITY_SCORE[right] > SEVERITY_SCORE[left] ? right : left
}

function detectPromptInjectionRisk(text) {
  const normalized = normalizeText(text)
  if (!normalized) {
    return {
      riskLevel: 'none',
      flags: [],
    }
  }

  const matches = PROMPT_INJECTION_PATTERNS.filter((entry) =>
    entry.pattern.test(normalized)
  )
  const riskLevel = matches.reduce(
    (level, entry) => maxSeverity(level, entry.severity),
    'none'
  )

  return {
    riskLevel,
    flags: matches.map((entry) => `prompt-injection:${entry.id}`),
  }
}

function mergeSecurityFlags(...flagGroups) {
  return Array.from(
    new Set(
      flagGroups
        .flat()
        .map((flag) => normalizeText(flag).toLowerCase())
        .filter(Boolean)
    )
  ).sort()
}

module.exports = {
  PROMPT_INJECTION_PATTERNS,
  detectPromptInjectionRisk,
  mergeSecurityFlags,
}
