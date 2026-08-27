const {
  confirmDestructiveNodeAction,
} = require('./destructive-node-confirmation')

describe('destructive node confirmation', () => {
  it('requires the native continue button for every destructive action', async () => {
    const dialog = {
      showMessageBox: jest
        .fn()
        .mockResolvedValueOnce({response: 0})
        .mockResolvedValueOnce({response: 1}),
    }

    await expect(
      confirmDestructiveNodeAction({dialog, action: 'clean-state'})
    ).resolves.toBe(false)
    await expect(
      confirmDestructiveNodeAction({
        dialog,
        action: 'troubleshooting-reset-node',
      })
    ).resolves.toBe(true)
  })

  it('fails closed for unknown actions', async () => {
    await expect(
      confirmDestructiveNodeAction({dialog: {}, action: 'unknown'})
    ).resolves.toBe(false)
  })
})
