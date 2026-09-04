import {submitFlip as submitFlipRpc} from '../../shared/api/dna'
import {resizeImageToDataUrl} from '../../shared/utils/image-canvas'
import {getFlipsBridge} from '../../shared/utils/flips-bridge'
import {compressFlipImagesForSubmit, publishFlip} from './utils'

jest.mock('../../shared/api/dna', () => ({
  submitFlip: jest.fn(),
}))

jest.mock('../../shared/utils/image-canvas', () => ({
  resizeImageToDataUrl: jest.fn(),
}))

jest.mock('../../shared/utils/flips-bridge', () => ({
  getFlipsBridge: jest.fn(),
}))

jest.mock('../../i18n', () => ({
  t: (value) => value,
}))

describe('flip submit image preparation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getFlipsBridge.mockReturnValue({getFlips: () => []})
  })

  it('encodes all data URL panels with the protocol submit profile', async () => {
    resizeImageToDataUrl.mockImplementation(async (_, options) =>
      JSON.stringify(options)
    )

    const result = await compressFlipImagesForSubmit([
      'data:image/png;base64,QQ==',
      'data:image/png;base64,Qg==',
      'https://example.test/panel.jpg',
      '',
      'data:image/png;base64,Qw==',
    ])

    expect(resizeImageToDataUrl).toHaveBeenCalledTimes(2)
    expect(resizeImageToDataUrl).toHaveBeenCalledWith(
      'data:image/png;base64,QQ==',
      {
        width: 240,
        height: 180,
        type: 'image/jpeg',
        quality: 0.6,
        exact: true,
      }
    )
    expect(result).toHaveLength(4)
    expect(result[2]).toBe('https://example.test/panel.jpg')
    expect(result[3]).toBe('')
  })

  it('compresses oversized draft panels in the shared publish path', async () => {
    const submitDataUrl = 'data:image/jpeg;base64,QQ=='
    resizeImageToDataUrl.mockResolvedValue(submitDataUrl)
    submitFlipRpc.mockResolvedValue({result: {txHash: 'submitted'}})

    const oversizedDataUrl = `data:image/png;base64,${'A'.repeat(400000)}`
    await expect(
      publishFlip({
        keywordPairId: 1,
        protectedImages: Array.from({length: 4}, () => oversizedDataUrl),
        originalOrder: [0, 1, 2, 3],
        order: [3, 2, 1, 0],
        adversarialImageId: 0,
        orderPermutations: [3, 2, 1, 0],
      })
    ).resolves.toEqual({txHash: 'submitted'})

    expect(resizeImageToDataUrl).toHaveBeenCalledTimes(4)
    expect(submitFlipRpc).toHaveBeenCalledTimes(1)
  })
})
