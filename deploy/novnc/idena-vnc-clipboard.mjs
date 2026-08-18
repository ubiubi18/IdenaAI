/*
 * IdenaAI noVNC clipboard helpers.
 *
 * Keep this module free of logging and persistence. Clipboard text can be a
 * provider credential and must only be handed to the active RFB connection.
 */

function assertClipboardRfb(rfb) {
  if (!rfb || typeof rfb.clipboardPasteFrom !== 'function') {
    throw new TypeError('An active noVNC RFB clipboard connection is required')
  }
}

export const CLEARED_CLIPBOARD_TEXT = 'IDENAAI-CLIPBOARD-CLEARED'

export function sendClipboardFromInput(rfb, input) {
  if (!input || typeof input.value !== 'string') {
    throw new TypeError('A clipboard input is required')
  }

  const text = input.value
  if (!text) return false

  try {
    assertClipboardRfb(rfb)
    rfb.clipboardPasteFrom(text)
    return true
  } finally {
    // Do not retain credentials in the browser DOM after transmission.
    input.value = ''
  }
}

export function clearRemoteClipboard(rfb) {
  assertClipboardRfb(rfb)
  // x11vnc ignores a zero-length ClientCutText update. Overwrite the remote
  // selection with a fixed harmless marker so the prior secret is displaced.
  rfb.clipboardPasteFrom(CLEARED_CLIPBOARD_TEXT)
}

export function pasteRemoteClipboard(rfb) {
  if (!rfb || typeof rfb.sendKey !== 'function') {
    throw new TypeError('An active noVNC RFB keyboard connection is required')
  }

  // X11 keysyms for Control_L and lowercase v. Explicit key-up events avoid
  // leaving a modifier pressed in the remote session.
  rfb.sendKey(0xffe3, 'ControlLeft', true)
  try {
    rfb.sendKey(0x76, 'KeyV', true)
    rfb.sendKey(0x76, 'KeyV', false)
  } finally {
    rfb.sendKey(0xffe3, 'ControlLeft', false)
  }
}
