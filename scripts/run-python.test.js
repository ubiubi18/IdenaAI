const {
  isSupportedPythonVersion,
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
})
