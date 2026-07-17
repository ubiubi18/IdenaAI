const {
  isSupportedPythonVersion,
  parseConfiguredRuntime,
  parsePythonVersion,
  requireSupportedPython,
  resolvePythonRuntime,
} = require('./run-python')

describe('run-python runtime gate', () => {
  it('accepts supported Python versions and rejects old or malformed output', () => {
    expect(parsePythonVersion('3.11.9\n')).toEqual([3, 11, 9])
    expect(parsePythonVersion('Python 3.11.9')).toBeNull()
    expect(isSupportedPythonVersion([3, 11, 0])).toBe(true)
    expect(isSupportedPythonVersion([3, 12, 1])).toBe(true)
    expect(isSupportedPythonVersion([3, 10, 14])).toBe(false)
    expect(isSupportedPythonVersion([2, 7, 18])).toBe(false)
  })

  it('fails closed when the configured runtime is old or cannot be inspected', () => {
    const oldRuntime = jest.fn(() => ({status: 0, stdout: '3.9.6\n'}))
    expect(() => requireSupportedPython('python3', [], oldRuntime)).toThrow(
      'requires Python 3.11 or newer'
    )

    const failedRuntime = jest.fn(() => ({status: 1, stdout: ''}))
    expect(() => requireSupportedPython('python3', [], failedRuntime)).toThrow(
      'could not be inspected'
    )
  })

  it('falls back to an installed supported runtime unless one is explicit', () => {
    const run = jest.fn((command) => {
      if (command === 'python3') return {status: 0, stdout: '3.9.6\n'}
      if (command === 'python3.12') return {status: 0, stdout: '3.12.11\n'}
      return {error: new Error('missing'), status: null, stdout: ''}
    })

    expect(resolvePythonRuntime('', 'darwin', run)).toEqual({
      command: 'python3.12',
      prefixArgs: [],
      version: [3, 12, 11],
    })
    expect(() => resolvePythonRuntime('python3', 'darwin', run)).toThrow(
      'requires Python 3.11 or newer'
    )
  })

  it('preserves configured executable paths containing spaces', () => {
    const executable = 'C:\\Program Files\\Python312\\python.exe'
    const run = jest.fn((command) => {
      if (command === executable) return {status: 0, stdout: '3.12.11\n'}
      return {error: new Error('missing'), status: null, stdout: ''}
    })

    expect(parseConfiguredRuntime(executable, 'win32')).toEqual({
      command: executable,
      prefixArgs: [],
    })
    expect(resolvePythonRuntime(executable, 'win32', run)).toEqual({
      command: executable,
      prefixArgs: [],
      version: [3, 12, 11],
    })
  })

  it('supports the standard versioned Windows Python launcher form', () => {
    expect(parseConfiguredRuntime('py -3.12', 'win32')).toEqual({
      command: 'py',
      prefixArgs: ['-3.12'],
    })
  })
})
