const {encode, decode} = require('rlp')
const {
  ALL_ORDERS,
  buildFlipSubmitPayload,
  decodeImageDataUrl,
  pickShuffle,
  selectPreparedDrafts,
} = require('./idena_ai_publish_prepared_flips')

const panels = [0, 1, 2, 3].map((index) => Buffer.from(`flip-panel-${index}`))

describe('prepared flip publishing', () => {
  it('splits four panels into two public and two private entries', () => {
    const payload = buildFlipSubmitPayload(panels, [2, 0, 1, 3], encode)

    const publicItems = decode(Buffer.from(payload.publicHex.slice(2), 'hex'))
    const privateItems = decode(Buffer.from(payload.privateHex.slice(2), 'hex'))

    expect(publicItems).toHaveLength(1)
    expect(publicItems[0]).toHaveLength(2)
    expect(privateItems).toHaveLength(2)
    expect(privateItems[0]).toHaveLength(2)

    const submitted = [...publicItems[0], ...privateItems[0]].map((item) =>
      Buffer.from(item).toString()
    )
    expect(submitted.slice().sort()).toEqual([
      'flip-panel-0',
      'flip-panel-1',
      'flip-panel-2',
      'flip-panel-3',
    ])
  })

  it('encodes both panel orders consistently with the requested shuffle', () => {
    const shuffledOrder = [2, 0, 1, 3]
    const payload = buildFlipSubmitPayload(panels, shuffledOrder, encode)
    const privateItems = decode(Buffer.from(payload.privateHex.slice(2), 'hex'))
    const orders = privateItems[1].map((order) =>
      Array.from(order, (value) =>
        Buffer.isBuffer(value) ? value[0] || 0 : Number(value)
      )
    )

    orders.forEach((order) => {
      expect(order.slice().sort()).toEqual([0, 1, 2, 3])
    })

    const [first, second] = orders
    const consistent =
      second.every((value, index) => value === first[shuffledOrder[index]]) ||
      first.every((value, index) => value === second[shuffledOrder[index]])
    expect(consistent).toBe(true)
  })

  it('rejects anything other than four panels', () => {
    expect(() =>
      buildFlipSubmitPayload(panels.slice(0, 3), [1, 0, 2, 3], encode)
    ).toThrow('four flip panels are required')
  })

  it('never keeps the original panel order', () => {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const order = pickShuffle([0, 1, 2, 3])
      expect(ALL_ORDERS).toContainEqual(order)
      expect(order).not.toEqual([0, 1, 2, 3])
    }
  })

  it('selects only generated drafts and honours the limit', () => {
    const flips = [
      {id: 'scheduled-session-2', type: 'draft', keywordPairId: 2},
      {id: 'manual-flip', type: 'draft', keywordPairId: 0},
      {id: 'scheduled-session-0', type: 'Draft', keywordPairId: 0},
      {id: 'scheduled-session-1', type: 'published', keywordPairId: 1},
      {id: 'scheduled-session-3', type: 'draft', keywordPairId: 3},
    ]

    expect(selectPreparedDrafts(flips).map(({id}) => id)).toEqual([
      'scheduled-session-0',
      'scheduled-session-2',
      'scheduled-session-3',
    ])
    expect(selectPreparedDrafts(flips, 2).map(({id}) => id)).toEqual([
      'scheduled-session-0',
      'scheduled-session-2',
    ])
  })

  it('reads base64 image data urls only', () => {
    expect(
      decodeImageDataUrl('data:image/png;base64,AAAA').toString('hex')
    ).toBe('000000')
    expect(() => decodeImageDataUrl('https://example.test/flip.png')).toThrow(
      'flip image is not a base64 data URL'
    )
  })
})
