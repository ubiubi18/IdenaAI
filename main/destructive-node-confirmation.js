const ACTION_COPY = {
  'clean-state': {
    title: 'Delete local node state?',
    detail:
      'This removes the local blockchain state. Your private key is not deleted, but the node must synchronize again.',
  },
  'troubleshooting-reset-node': {
    title: 'Reset the local node?',
    detail:
      'This removes the managed node binary, blockchain database, and local IPFS data before reinstalling the node.',
  },
}

async function confirmDestructiveNodeAction({dialog, parent, action}) {
  const copy = ACTION_COPY[action]

  if (!copy || !dialog || typeof dialog.showMessageBox !== 'function') {
    return false
  }

  const result = await dialog.showMessageBox(parent, {
    type: 'warning',
    title: copy.title,
    message: copy.title,
    detail: copy.detail,
    buttons: ['Cancel', 'Continue'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })

  return Boolean(result && result.response === 1)
}

module.exports = {confirmDestructiveNodeAction}
