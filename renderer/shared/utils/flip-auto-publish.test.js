const {
  buildAuditedShuffleCandidates,
  evaluateAutoPublishRender,
  evaluateAutoPublishStoryDraft,
  selectAuditedStoryCandidate,
} = require('./flip-auto-publish')

function passingOption(overrides = {}) {
  return {
    complianceReport: {
      keyword_relevance: 'pass',
      no_text_needed: 'pass',
      no_order_labels: 'pass',
      no_inappropriate_content: 'pass',
      single_story_only: 'pass',
      no_waking_up_template: 'pass',
      no_thumbs_up_down: 'pass',
      no_enumeration_logic: 'pass',
      no_screen_or_page_keyword_cheat: 'pass',
      causal_clarity: 'pass',
      consensus_clarity: 'pass',
      age_12_clarity: 'pass',
      everyday_knowledge_only: 'pass',
      large_visual_cues: 'pass',
      simple_action_chain: 'pass',
      obvious_final_outcome: 'pass',
    },
    failedComplianceKeys: [],
    riskFlags: [],
    qualityScore: 91,
    qualityFailures: [],
    ...overrides,
  }
}

function passingValidators() {
  return Array.from({length: 4}, () => ({
    invoked: true,
    passed: true,
    ocr_text_check: {status: 'pass', passed: true},
    keyword_visibility_check: {status: 'pass', passed: true},
    alignment_check: {status: 'pass', passed: true},
    policy_risk_check: {status: 'pass', passed: true},
  }))
}

describe('audited flip auto publish gates', () => {
  it('accepts a complete clear story containing both exact keywords', () => {
    const result = evaluateAutoPublishStoryDraft({
      option: passingOption(),
      keywords: ['palace', 'monster'],
      panels: [
        'A monster stands outside a palace holding a paint bucket.',
        'The monster opens the bucket beside the blue palace door.',
        'The monster paints the palace door red.',
        'The palace door remains red as the monster puts down the roller.',
      ],
    })

    expect(result).toEqual({passed: true, reasons: []})
  })

  it('rejects weak drafts and a missing exact multiword keyword', () => {
    const result = evaluateAutoPublishStoryDraft({
      option: passingOption({isWeakStoryDraft: true}),
      keywords: ['Idena flips', 'present'],
      panels: [
        'A person receives a present.',
        'The person opens the present.',
        'Four puzzle pictures appear.',
        'The person arranges the puzzle pictures.',
      ],
    })

    expect(result.passed).toBe(false)
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        'weak_story_draft',
        'missing_exact_keyword:Idena flips',
      ])
    )
  })

  it('does not accept a keyword that appears only inside another word', () => {
    const result = evaluateAutoPublishStoryDraft({
      option: passingOption(),
      keywords: ['art', 'basket'],
      panels: [
        'A baker puts a cart beside a basket.',
        'The baker lifts the basket onto the cart.',
        'The cart rolls away with the basket.',
        'The baker stops the cart and removes the basket.',
      ],
    })

    expect(result.passed).toBe(false)
    expect(result.reasons).toContain('missing_exact_keyword:art')
  })

  it('provides deterministic candidate shuffles', () => {
    const candidates = buildAuditedShuffleCandidates()

    expect(candidates).toContainEqual([2, 0, 3, 1])
    expect(candidates.every((item) => new Set(item).size === 4)).toBe(true)
  })

  it('selects the strongest fully audited story candidate', () => {
    const weaker = passingOption({
      id: 'weaker',
      qualityScore: 82,
      panels: [
        'A baker puts a bell beside a basket.',
        'The baker lifts the basket and bumps the bell.',
        'The bell falls from the counter.',
        'The baker catches the bell inside the basket.',
      ],
    })
    const stronger = passingOption({
      id: 'stronger',
      qualityScore: 94,
      panels: [
        'A baker puts a bell beside a basket.',
        'The baker lifts the basket and bumps the bell.',
        'The bell falls from the counter.',
        'The baker catches the bell inside the basket.',
      ],
    })

    const result = selectAuditedStoryCandidate({
      options: [weaker, stronger],
      keywords: ['bell', 'basket'],
    })

    expect(result.passed).toBe(true)
    expect(result.option.id).toBe('stronger')
  })

  it('fails closed when no story candidate has complete compliance evidence', () => {
    const result = selectAuditedStoryCandidate({
      options: [
        passingOption({
          complianceReport: {},
          panels: [
            'A baker puts a bell beside a basket.',
            'The baker lifts the basket and bumps the bell.',
            'The bell falls from the counter.',
            'The baker catches the bell inside the basket.',
          ],
        }),
      ],
      keywords: ['bell', 'basket'],
    })

    expect(result.passed).toBe(false)
    expect(result.reasons).toContain(
      'story_compliance_failed:keyword_relevance,no_text_needed,no_order_labels,no_inappropriate_content,single_story_only,no_waking_up_template,no_thumbs_up_down,no_enumeration_logic,no_screen_or_page_keyword_cheat,causal_clarity,consensus_clarity,age_12_clarity,everyday_knowledge_only,large_visual_cues,simple_action_chain,obvious_final_outcome'
    )
  })

  it('rejects a story that fails a common-sense simplicity check', () => {
    const result = evaluateAutoPublishStoryDraft({
      option: passingOption({
        complianceReport: {
          ...passingOption().complianceReport,
          simple_action_chain: 'fail',
        },
      }),
      keywords: ['organ', 'garage'],
      panels: [
        'A child stands beside an organ in a garage.',
        'The child picks up a cloth beside the organ.',
        'The child wipes dust from the organ.',
        'The clean organ stands in the garage beside the child.',
      ],
    })

    expect(result.passed).toBe(false)
    expect(result.reasons).toContain(
      'story_compliance_failed:simple_action_chain'
    )
  })

  it('accepts only a fully audited render and returns its safe shuffle', () => {
    const result = evaluateAutoPublishRender({
      response: {
        ok: true,
        includeNoise: false,
        panels: [{}, {}, {}, {}],
        validatorAuditByPanel: passingValidators(),
        sequenceAudit: {
          invoked: true,
          complete: true,
          passed: true,
          verdict: 'accept',
          safeShuffleOrder: [2, 0, 3, 1],
        },
        renderFeedback: {verdict: 'accept_rendered_story'},
      },
    })

    expect(result).toEqual({
      passed: true,
      reasons: [],
      shuffleOrder: [2, 0, 3, 1],
    })
  })

  it('fails closed on an incomplete audit or missing safe shuffle', () => {
    const result = evaluateAutoPublishRender({
      response: {
        ok: true,
        panels: [{}, {}, {}, {}],
        validatorAuditByPanel: passingValidators(),
        sequenceAudit: {
          invoked: true,
          complete: false,
          passed: false,
          verdict: 'replan',
          safeShuffleOrder: null,
        },
        renderFeedback: {verdict: 'replan_story'},
      },
    })

    expect(result.passed).toBe(false)
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        'sequence_audit_incomplete',
        'sequence_audit_rejected',
        'audited_shuffle_missing',
        'render_feedback_rejected',
      ])
    )
  })

  it('fails closed when a panel audit layer is unavailable', () => {
    const validators = passingValidators()
    validators[2].alignment_check = {status: 'error', passed: true}

    const result = evaluateAutoPublishRender({
      response: {
        ok: true,
        panels: [{}, {}, {}, {}],
        validatorAuditByPanel: validators,
        sequenceAudit: {
          invoked: true,
          complete: true,
          passed: true,
          verdict: 'accept',
          safeShuffleOrder: [2, 0, 3, 1],
        },
        renderFeedback: {verdict: 'accept_rendered_story'},
      },
    })

    expect(result.passed).toBe(false)
    expect(result.reasons).toContain('panel_audit_incomplete')
  })
})
