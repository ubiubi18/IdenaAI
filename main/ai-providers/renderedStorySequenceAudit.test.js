const {
  buildRenderedStorySequenceAuditPrompt,
  parseRenderedStorySequenceAudit,
} = require('./renderedStorySequenceAudit')

const STORY = [
  'A monster arrives at a palace with a sealed paint bucket.',
  'The monster opens the bucket while the palace door stays blue.',
  'The monster paints half of the palace door red.',
  'The entire palace door is red and the monster puts down the roller.',
]

const SHUFFLES = [
  [2, 0, 3, 1],
  [3, 1, 0, 2],
]

function passingChecks() {
  return {
    keyword_clarity: {passed: true, notes: ''},
    story_alignment: {passed: true, notes: ''},
    character_scene_continuity: {passed: true, notes: ''},
    causal_progression: {passed: true, notes: ''},
    premature_reveal: {passed: true, panel_indices: [], notes: ''},
    state_regression: {passed: true, panel_indices: [], notes: ''},
    panel_distinctness: {passed: true, notes: ''},
    shuffled_order: {
      passed: true,
      forms_meaningful_story: false,
      notes: '',
    },
  }
}

describe('rendered story sequence audit', () => {
  it('asks explicitly about premature reveals, state regressions, and safe shuffles', () => {
    const prompt = buildRenderedStorySequenceAuditPrompt({
      storyPanels: STORY,
      keywords: ['palace', 'monster'],
      shuffleCandidates: SHUFFLES,
    })

    expect(prompt).toContain('premature_reveal')
    expect(prompt).toContain('state_regression')
    expect(prompt).toContain('Candidate 1: 3 -> 1 -> 4 -> 2')
    expect(prompt).toContain('safe_shuffle_candidate')
  })

  it('accepts only a complete high-confidence audit with a safe shuffle', () => {
    const result = parseRenderedStorySequenceAudit(
      JSON.stringify({
        verdict: 'accept',
        passed: true,
        score: 94,
        failure_reasons: [],
        repair_panel_indices: [],
        repair_guidance_by_panel: [],
        should_replan_story: false,
        safe_shuffle_candidate: 2,
        checks: passingChecks(),
        summary: 'Clear irreversible repainting sequence.',
      }),
      {shuffleCandidates: SHUFFLES}
    )

    expect(result).toMatchObject({
      invoked: true,
      complete: true,
      passed: true,
      verdict: 'accept',
      safeShuffleCandidateIndex: 1,
      safeShuffleOrder: SHUFFLES[1],
    })
  })

  it('normalizes one-based repair panels and their guidance', () => {
    const checks = passingChecks()
    checks.premature_reveal = {
      passed: false,
      panel_indices: [2],
      notes: 'The reveal appears one panel too early.',
    }

    const result = parseRenderedStorySequenceAudit(
      JSON.stringify({
        verdict: 'repair',
        passed: false,
        score: 70,
        failure_reasons: ['premature_reveal'],
        repair_panel_indices: [2],
        repair_guidance_by_panel: [
          {panel: 2, instruction: 'Remove the reveal from this panel.'},
        ],
        should_replan_story: false,
        safe_shuffle_candidate: 1,
        checks,
      }),
      {shuffleCandidates: SHUFFLES}
    )

    expect(result.passed).toBe(false)
    expect(result.repairPanelIndices).toEqual([1])
    expect(result.repairGuidanceByPanel).toEqual({
      1: 'Remove the reveal from this panel.',
    })
    expect(result.shouldReplan).toBe(false)
  })

  it('fails closed when an accept response omits a required check', () => {
    const checks = passingChecks()
    delete checks.state_regression

    const result = parseRenderedStorySequenceAudit(
      JSON.stringify({
        verdict: 'accept',
        passed: true,
        score: 99,
        safe_shuffle_candidate: 1,
        checks,
      }),
      {shuffleCandidates: SHUFFLES}
    )

    expect(result.complete).toBe(false)
    expect(result.passed).toBe(false)
    expect(result.shouldReplan).toBe(true)
    expect(result.failureReasons).toContain('sequence_audit_incomplete')
  })

  it('fails closed when shuffle evidence or accept-state fields are inconsistent', () => {
    const checks = passingChecks()
    delete checks.shuffled_order.forms_meaningful_story

    const result = parseRenderedStorySequenceAudit(
      JSON.stringify({
        verdict: 'accept',
        passed: true,
        score: 99,
        failure_reasons: [],
        repair_panel_indices: [2],
        repair_guidance_by_panel: [],
        should_replan_story: false,
        safe_shuffle_candidate: 1,
        checks,
      }),
      {shuffleCandidates: SHUFFLES}
    )

    expect(result.complete).toBe(false)
    expect(result.passed).toBe(false)
    expect(result.shouldReplan).toBe(true)
    expect(result.failureReasons).toEqual(
      expect.arrayContaining([
        'sequence_audit_incomplete',
        'sequence_audit_inconsistent',
      ])
    )
  })

  it('fails closed instead of normalizing invalid repair panel indices away', () => {
    const result = parseRenderedStorySequenceAudit(
      JSON.stringify({
        verdict: 'accept',
        passed: true,
        score: 99,
        failure_reasons: [],
        repair_panel_indices: [99],
        repair_guidance_by_panel: [],
        should_replan_story: false,
        safe_shuffle_candidate: 1,
        checks: passingChecks(),
      }),
      {shuffleCandidates: SHUFFLES}
    )

    expect(result.complete).toBe(false)
    expect(result.passed).toBe(false)
    expect(result.shouldReplan).toBe(true)
    expect(result.failureReasons).toEqual(
      expect.arrayContaining([
        'sequence_audit_incomplete',
        'sequence_audit_inconsistent',
      ])
    )
  })

  it('rejects a shuffled candidate that still forms a meaningful story', () => {
    const checks = passingChecks()
    checks.shuffled_order = {
      passed: false,
      forms_meaningful_story: true,
      notes: 'The candidate still reads chronologically.',
    }

    const result = parseRenderedStorySequenceAudit(
      JSON.stringify({
        verdict: 'replan',
        passed: false,
        score: 55,
        failure_reasons: ['shuffled_story_ambiguity'],
        repair_panel_indices: [],
        should_replan_story: true,
        safe_shuffle_candidate: 0,
        checks,
      }),
      {shuffleCandidates: SHUFFLES}
    )

    expect(result.passed).toBe(false)
    expect(result.safeShuffleOrder).toBeNull()
    expect(result.shouldReplan).toBe(true)
    expect(result.failureReasons).toEqual(
      expect.arrayContaining(['shuffled_story_ambiguity', 'no_safe_shuffle'])
    )
  })
})
