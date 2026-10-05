const COMMON_SENSE_FLIP_STORY_RULES = [
  '- Make the whole story understandable at a glance to a typical 12-year-old.',
  '- Use only everyday common sense. Do not require specialist, cultural, occupational, mechanical, or obscure knowledge.',
  '- Use one main actor, one obvious goal or problem, and one direct action chain. Avoid multi-object chain reactions and complicated accidents.',
  '- Keep both keywords large, central, and causally necessary: removing either must change the visible trigger or outcome. Never depend on tiny parts, hidden clues, or subtle expressions.',
  '- Change one large, visible state per panel and carry it forward. Show repairs, erasures, reversals, and changes of direction in the images rather than only in the written plan.',
  '- Prefer an unmistakable ending: a goal visibly achieved, an object visibly finished or built, or a non-living object visibly broken or destroyed.',
  '- If the keyword pair is awkward, choose the simplest familiar literal scene. Do not force clever, surreal, or obscure logic.',
]

const COMMON_SENSE_FLIP_REJECTION_RULES = [
  '- Reject a story that needs verbal explanation or special knowledge.',
  '- Reject a story whose order depends on a tiny object part, hidden state, or subtle visual clue.',
  '- Reject a story with several actors, props, or mechanisms causing a chain reaction.',
  '- Reject a story unless its final result is large, stable, and immediately obvious.',
]

module.exports = {
  COMMON_SENSE_FLIP_REJECTION_RULES,
  COMMON_SENSE_FLIP_STORY_RULES,
}
