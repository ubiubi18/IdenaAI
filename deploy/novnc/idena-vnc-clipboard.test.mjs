import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'

import {
  CLEARED_CLIPBOARD_TEXT,
  clearRemoteClipboard,
  pasteRemoteClipboard,
  sendClipboardFromInput,
} from './idena-vnc-clipboard.mjs'

test('sends clipboard text once and immediately clears the masked input', () => {
  const calls = []
  const rfb = {clipboardPasteFrom: (text) => calls.push(text)}
  const input = {value: 'NOVNC-CLIPBOARD-TEST-20260818'}

  assert.equal(sendClipboardFromInput(rfb, input), true)
  assert.deepEqual(calls, ['NOVNC-CLIPBOARD-TEST-20260818'])
  assert.equal(input.value, '')
})

test('does not send an empty clipboard value', () => {
  const calls = []
  const rfb = {clipboardPasteFrom: (text) => calls.push(text)}
  const input = {value: ''}

  assert.equal(sendClipboardFromInput(rfb, input), false)
  assert.deepEqual(calls, [])
})

test('clears the input even when clipboard transmission fails', () => {
  const input = {value: 'dummy-secret'}
  const rfb = {
    clipboardPasteFrom: () => {
      throw new Error('simulated transport failure')
    },
  }

  assert.throws(() => sendClipboardFromInput(rfb, input), /transport failure/)
  assert.equal(input.value, '')
})

test('clears the input when the RFB clipboard capability is missing', () => {
  const input = {value: 'dummy-secret'}

  assert.throws(() => sendClipboardFromInput({}, input), /RFB clipboard/)
  assert.equal(input.value, '')
})

test('explicitly clears the remote clipboard', () => {
  const calls = []
  clearRemoteClipboard({clipboardPasteFrom: (text) => calls.push(text)})
  assert.equal(CLEARED_CLIPBOARD_TEXT, 'IDENAAI-CLIPBOARD-CLEARED')
  assert.deepEqual(calls, [CLEARED_CLIPBOARD_TEXT])
})

test('sends a complete remote Linux Ctrl+V sequence', () => {
  const calls = []
  pasteRemoteClipboard({
    sendKey: (...args) => calls.push(args),
  })

  assert.deepEqual(calls, [
    [0xffe3, 'ControlLeft', true],
    [0x76, 'KeyV', true],
    [0x76, 'KeyV', false],
    [0xffe3, 'ControlLeft', false],
  ])
})

test('page uses a masked non-persistent clipboard control', async () => {
  const html = await readFile(
    new URL('./idena-vnc-lite.html', import.meta.url),
    'utf8'
  )
  const moduleSource = await readFile(
    new URL('./idena-vnc-clipboard.mjs', import.meta.url),
    'utf8'
  )

  assert.match(html, /id="clipboard-input"[\s\S]*type="password"/)
  assert.match(html, /autocomplete="off"/)
  assert.match(html, /spellcheck="false"/)
  assert.match(html, /sendClipboardFromInput\(rfb, clipboardInput\)/)
  assert.match(html, /clearRemoteClipboard\(rfb\)/)
  assert.match(html, /pasteRemoteClipboard\(rfb\)/)
  assert.match(html, /new URL\('\/websockify', window\.location\.href\)/)
  assert.doesNotMatch(html, /readQueryVariable\('(host|port|path)'/)
  assert.match(
    html,
    /function disconnectedFromServer[\s\S]*clipboardInput\.value = ''/
  )
  assert.match(html, /let isConnected = false/)

  for (const forbidden of [
    'console.',
    'localStorage',
    'sessionStorage',
    'document.cookie',
  ]) {
    assert.equal(html.includes(forbidden), false)
    assert.equal(moduleSource.includes(forbidden), false)
  }
})
