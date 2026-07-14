const path = require('path')
const {prepareBundledNode} = require('./prepare-bundled-node')

describe('prepare bundled node', () => {
  it('always builds the bundle from the pinned source checkout', () => {
    const runCommand = jest.fn()
    const verifyBinary = jest.fn(() => true)
    const targetFile = path.join('/tmp', 'idena-go')

    prepareBundledNode({
      platform: 'linux',
      arch: 'x64',
      targetFile,
      requiredSourcesPresent: () => true,
      runCommand,
      verifyBinary,
    })

    expect(runCommand).toHaveBeenCalledTimes(1)
    expect(runCommand.mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/build-node-from-sources\.js$/u),
        targetFile,
        '--platform',
        'linux',
        '--arch',
        'x64',
      ])
    )
    expect(verifyBinary).toHaveBeenCalledWith(targetFile)
  })

  it('sets up missing sources before building', () => {
    const runCommand = jest.fn()

    prepareBundledNode({
      platform: 'darwin',
      arch: 'arm64',
      targetFile: '/tmp/idena-go',
      requiredSourcesPresent: () => false,
      runCommand,
      verifyBinary: () => true,
    })

    expect(runCommand).toHaveBeenCalledTimes(2)
    expect(runCommand.mock.calls[0][1][0]).toMatch(/setup-sources\.js$/u)
    expect(runCommand.mock.calls[1][1][0]).toMatch(
      /build-node-from-sources\.js$/u
    )
  })
})
