const {
  buildRenderedStoryRepairGuidance,
  evaluateRenderedStoryFeedback,
} = require('./renderFeedback')

function makePanel(imageDataUrl) {
  return {imageDataUrl}
}

describe('render feedback loop', () => {
  test('repairs a single weak panel when only one rendered panel is misaligned', () => {
    const result = evaluateRenderedStoryFeedback({
      storyPanels: [
        'A calm person enters a hallway with a cup.',
        'A ghost appears and the person jolts in shock.',
        'The cup drops and water spreads.',
        'The person backs away from the puddle.',
      ],
      renderedPanels: [
        makePanel('data:image/png;base64,AAA='),
        makePanel('data:image/png;base64,BBB='),
        makePanel('data:image/png;base64,CCC='),
        makePanel('data:image/png;base64,DDD='),
      ],
      textAuditByPanel: [{}, {}, {}, {}],
      validatorAuditByPanel: [
        {},
        {
          alignment_check: {
            passed: false,
            status: 'fail',
          },
        },
        {},
        {},
      ],
      keywords: ['shock', 'ghost'],
      hasAlternativeOption: false,
    })

    expect(result.verdict).toBe('repair_selected_panels')
    expect(result.repairPanelIndices).toEqual([1])
    expect(result.failureReasons).toContain('rendered_alignment')
    expect(result.metrics.renderedAlignmentFail).toBe(true)

    expect(
      buildRenderedStoryRepairGuidance(result, {
        keywordA: 'shock',
        keywordB: 'ghost',
      })
    ).toEqual(
      expect.objectContaining({
        1: expect.stringContaining('follow the planned panel event literally'),
      })
    )
  })

  test('switches away from repeated near-duplicate rendered panels when an alternative exists', () => {
    const result = evaluateRenderedStoryFeedback({
      storyPanels: [
        'A person reaches a basement door with a flashlight.',
        'The ghost appears on the stairs.',
        'The flashlight falls while the ghost remains visible.',
        'The person backs away from the stairs.',
      ],
      renderedPanels: [
        makePanel('data:image/png;base64,AAAA1111'),
        makePanel('data:image/png;base64,SAME2222'),
        makePanel('data:image/png;base64,SAME2222'),
        makePanel('data:image/png;base64,DDDD4444'),
      ],
      textAuditByPanel: [{}, {}, {}, {}],
      validatorAuditByPanel: [{}, {}, {}, {}],
      keywords: ['shock', 'ghost'],
      hasAlternativeOption: true,
    })

    expect(result.verdict).toBe('reject_story_and_use_alternative_option')
    expect(result.failureReasons).toEqual(
      expect.arrayContaining([
        'rendered_near_duplicate',
        'causal_progression_ambiguity',
      ])
    )
    expect(result.nearDuplicatePairs).toEqual([
      expect.objectContaining({left: 1, right: 2}),
    ])
    expect(result.repairPanelIndices).toEqual([2])
  })

  test('repairs a premature reveal identified by the sequence audit', () => {
    const result = evaluateRenderedStoryFeedback({
      storyPanels: [
        'A person receives a closed present.',
        'The person starts opening the present.',
        'A clown springs out for the first time.',
        'The open present and clown remain visible.',
      ],
      renderedPanels: [
        makePanel('data:image/png;base64,AAA='),
        makePanel('data:image/png;base64,BBB='),
        makePanel('data:image/png;base64,CCC='),
        makePanel('data:image/png;base64,DDD='),
      ],
      textAuditByPanel: [{}, {}, {}, {}],
      validatorAuditByPanel: [{}, {}, {}, {}],
      sequenceAudit: {
        invoked: true,
        complete: true,
        passed: false,
        score: 72,
        failureReasons: ['premature_reveal'],
        repairPanelIndices: [1],
        repairGuidanceByPanel: {
          1: 'Remove the clown; it must first appear in panel 3.',
        },
        shouldReplan: false,
      },
      keywords: ['present', 'clown'],
      hasAlternativeOption: false,
    })

    expect(result.verdict).toBe('repair_selected_panels')
    expect(result.failureReasons).toEqual(
      expect.arrayContaining(['rendered_sequence_audit', 'premature_reveal'])
    )
    expect(result.repairPanelIndices).toEqual([1])
    expect(
      buildRenderedStoryRepairGuidance(result, {
        keywordA: 'present',
        keywordB: 'clown',
      })[1]
    ).toContain('Remove the clown; it must first appear in panel 3.')
  })

  test('requires a story replan when the sequence audit is incomplete', () => {
    const result = evaluateRenderedStoryFeedback({
      storyPanels: ['one', 'two', 'three', 'four'],
      renderedPanels: [
        makePanel('data:image/png;base64,AAA='),
        makePanel('data:image/png;base64,BBB='),
        makePanel('data:image/png;base64,CCC='),
        makePanel('data:image/png;base64,DDD='),
      ],
      sequenceAudit: {
        invoked: true,
        complete: false,
        passed: false,
        score: 0,
        failureReasons: ['sequence_audit_incomplete'],
        repairPanelIndices: [],
        repairGuidanceByPanel: {},
        shouldReplan: true,
      },
      keywords: ['palace', 'monster'],
    })

    expect(result.verdict).toBe('replan_story')
    expect(result.metrics.renderedSequenceAuditFail).toBe(true)
  })
})
