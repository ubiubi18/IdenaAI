const {PROVIDERS, OPENAI_COMPATIBLE_PROVIDERS} = require('./constants')

const STORY_PROMPT_VARIANTS = {
  OPENAI_LIKE: 'openai_like_compact_exemplars',
  GEMINI: 'gemini_visual_compact_exemplars',
  ANTHROPIC: 'anthropic_literal_compact_exemplars',
}

function resolveStoryPromptVariant(provider) {
  const normalized = String(provider || '')
    .trim()
    .toLowerCase()
  if (normalized === PROVIDERS.Gemini) {
    return STORY_PROMPT_VARIANTS.GEMINI
  }
  if (normalized === PROVIDERS.Anthropic) {
    return STORY_PROMPT_VARIANTS.ANTHROPIC
  }
  if (OPENAI_COMPATIBLE_PROVIDERS.includes(normalized)) {
    return STORY_PROMPT_VARIANTS.OPENAI_LIKE
  }
  return STORY_PROMPT_VARIANTS.OPENAI_LIKE
}

function buildStoryPromptExemplarLines({
  provider,
  fastMode = false,
  enabled = true,
}) {
  if (enabled === false) {
    return {
      enabled: false,
      variant: resolveStoryPromptVariant(provider),
      lines: [],
    }
  }

  const variant = resolveStoryPromptVariant(provider)
  const heading = fastMode
    ? `Compact exemplar steering (${variant}):`
    : `Compact positive/negative exemplars (${variant}):`

  const variants = {
    [STORY_PROMPT_VARIANTS.OPENAI_LIKE]: {
      positive:
        'Positive: before: A child holds a brush beside a large gray bird statue with a gray beak. trigger: The child dips the brush in yellow paint. reaction: The child paints the large beak yellow. after: The finished bright-yellow beak and the brush are clearly visible.',
      negative:
        'Negative: several small props roll, snag, drag, and reveal one another; the order needs explanation and the final result is unclear.',
      cue: 'Use short literal noun-verb sentences, one main action per panel, large keyword objects, and a completed goal, finished object, or clearly broken non-living object at the end.',
    },
    [STORY_PROMPT_VARIANTS.GEMINI]: {
      positive:
        'Positive: before: A child uses large binoculars to see three friends approaching. trigger: The child puts the binoculars on a table and starts inflating balloons. reaction: The finished balloons and cake are ready beside the binoculars. after: The friends arrive and the party begins beside the binoculars.',
      negative:
        'Negative: several people perform unrelated tasks, the important clue is tiny, and two different panel orders make equal sense.',
      cue: 'Keep one familiar goal, one main actor, large readable objects, and an ending that shows the goal was reached.',
    },
    [STORY_PROMPT_VARIANTS.ANTHROPIC]: {
      positive:
        'Positive: before: A worker places a wooden box on the ground beside a large hammer. trigger: The worker lifts the hammer over the box. reaction: The hammer strikes and splits the box. after: The broken box lies in two large pieces beside the hammer.',
      negative:
        'Negative: an obscure machine changes internally, only a small dial moves, and specialist knowledge is needed to understand the result.',
      cue: 'Prefer calm, literal, everyday physical scenes with one direct action chain and one large irreversible result.',
    },
  }

  const selected =
    variants[variant] || variants[STORY_PROMPT_VARIANTS.OPENAI_LIKE]
  const lines = [heading, selected.positive, selected.negative, selected.cue]

  return {
    enabled: true,
    variant,
    lines,
  }
}

module.exports = {
  buildStoryPromptExemplarLines,
  resolveStoryPromptVariant,
  STORY_PROMPT_VARIANTS,
}
