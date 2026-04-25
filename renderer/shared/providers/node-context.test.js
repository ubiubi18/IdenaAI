const {shouldRunBuiltInNode} = require('./node-context')

describe('node-context built-in node mode', () => {
  it('runs the built-in node only when it is enabled without a persistent external node', () => {
    expect(
      shouldRunBuiltInNode({
        runInternalNode: true,
        useExternalNode: false,
      })
    ).toBe(true)

    expect(
      shouldRunBuiltInNode({
        runInternalNode: true,
        useExternalNode: true,
        externalNodeMode: 'persistent',
      })
    ).toBe(false)

    expect(
      shouldRunBuiltInNode({
        runInternalNode: false,
        useExternalNode: false,
      })
    ).toBe(false)
  })

  it('keeps the built-in node preference during ephemeral rehearsal routing', () => {
    expect(
      shouldRunBuiltInNode({
        runInternalNode: true,
        useExternalNode: true,
        externalNodeMode: 'ephemeral',
      })
    ).toBe(true)
  })
})
