import {resolveNodeKeywordRefresh} from './keyword-refresh'

describe('resolveNodeKeywordRefresh', () => {
  it('replaces a stale empty snapshot with current identity keyword pairs', () => {
    const currentPairs = [
      {id: 7, used: false, words: [101, 202]},
      {id: 8, used: false, words: [303, 404]},
    ]

    const result = resolveNodeKeywordRefresh(
      {nodeAvailableKeywords: []},
      {availableKeywords: currentPairs}
    )

    expect(result).toEqual({
      availableKeywords: currentPairs,
      nodeAvailableKeywords: currentPairs,
      keywordPairId: 7,
      keywordSource: 'node',
    })
    expect(result.availableKeywords).not.toBe(currentPairs)
    expect(result.availableKeywords[0].words).not.toBe(currentPairs[0].words)
  })

  it('falls back to the machine snapshot when no refreshed list is supplied', () => {
    const result = resolveNodeKeywordRefresh({
      nodeAvailableKeywords: [{id: 3, words: [11, 22]}],
    })

    expect(result.keywordPairId).toBe(3)
    expect(result.availableKeywords).toHaveLength(1)
  })

  it('clears stale pairs when the refreshed identity has none', () => {
    const result = resolveNodeKeywordRefresh(
      {nodeAvailableKeywords: [{id: 3, words: [11, 22]}]},
      {availableKeywords: []}
    )

    expect(result).toEqual({
      availableKeywords: [],
      nodeAvailableKeywords: [],
      keywordPairId: 0,
      keywordSource: 'node',
    })
  })
})
