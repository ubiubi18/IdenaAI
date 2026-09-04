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

  it('normalizes all populated image sources with the submit profile', async () => {
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

    expect(resizeImageToDataUrl).toHaveBeenCalledTimes(3)
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
    expect(resizeImageToDataUrl).toHaveBeenCalledWith(
      'https://example.test/panel.jpg',
      {
        width: 240,
        height: 180,
        type: 'image/jpeg',
        quality: 0.6,
        exact: true,
      }
    )
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

  it('uses a smaller profile when the encoded RLP is still too large', async () => {
    const oversizedSubmitDataUrl = `data:image/jpeg;base64,${'A'.repeat(
      400000
    )}`
    resizeImageToDataUrl.mockImplementation(async (_, options) =>
      options.width === 240
        ? oversizedSubmitDataUrl
        : 'data:image/jpeg;base64,QQ=='
    )
    submitFlipRpc.mockResolvedValue({result: {txHash: 'submitted'}})

    await expect(
      publishFlip({
        keywordPairId: 1,
        protectedImages: Array.from(
          {length: 4},
          () => 'data:image/png;base64,QQ=='
        ),
        originalOrder: [0, 1, 2, 3],
        order: [3, 2, 1, 0],
        adversarialImageId: 0,
        orderPermutations: [3, 2, 1, 0],
      })
    ).resolves.toEqual({txHash: 'submitted'})

    expect(resizeImageToDataUrl).toHaveBeenCalledTimes(8)
    expect(
      resizeImageToDataUrl.mock.calls
        .slice(0, 4)
        .every(([, options]) => options.width === 240)
    ).toBe(true)
    expect(
      resizeImageToDataUrl.mock.calls
        .slice(4)
        .every(([, options]) => options.width === 200)
    ).toBe(true)
    expect(submitFlipRpc).toHaveBeenCalledTimes(1)
  })

  it('rejects before RPC when every submit profile exceeds the limit', async () => {
    const oversizedSubmitDataUrl = `data:image/jpeg;base64,${'A'.repeat(
      400000
    )}`
    resizeImageToDataUrl.mockResolvedValue(oversizedSubmitDataUrl)

    await expect(
      publishFlip({
        keywordPairId: 1,
        protectedImages: Array.from(
          {length: 4},
          () => 'data:image/png;base64,QQ=='
        ),
        originalOrder: [0, 1, 2, 3],
        order: [3, 2, 1, 0],
        adversarialImageId: 0,
        orderPermutations: [3, 2, 1, 0],
      })
    ).rejects.toThrow('Cannot submit flip, content is too big')

    expect(resizeImageToDataUrl).toHaveBeenCalledTimes(12)
    expect(submitFlipRpc).not.toHaveBeenCalled()
  })

  it('rejects an incomplete image set before encoding or RPC submission', async () => {
    await expect(
      publishFlip({
        keywordPairId: 1,
        protectedImages: ['data:image/png;base64,QQ=='],
        originalOrder: [0, 1, 2, 3],
        order: [3, 2, 1, 0],
        adversarialImageId: 0,
        orderPermutations: [3, 2, 1, 0],
      })
    ).rejects.toThrow('You must use 4 images for a flip')

    expect(resizeImageToDataUrl).not.toHaveBeenCalled()
    expect(submitFlipRpc).not.toHaveBeenCalled()
  })
})
