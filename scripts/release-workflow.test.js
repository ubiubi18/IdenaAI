/** @jest-environment node */
const fs = require('fs')
const os = require('os')
const path = require('path')
const {execFileSync, spawnSync} = require('child_process')

const workflow = fs.readFileSync(
  path.join(__dirname, '../.github/workflows/release.yml'),
  'utf8'
)
const validationStep = workflow
  .split('      - name: Validate immutable release tag\n')[1]
  ?.split('\n      - name:')[0]
const validationScript = validationStep
  ?.split('        run: |\n')[1]
  ?.split('          response_file=')[0]
  ?.split('\n')
  .filter((line) => line.startsWith('          '))
  .map((line) => line.slice(10))
  .join('\n')

describe('release workflow source boundary', () => {
  let root
  let checkout
  let approvedCommit
  let unreviewedCommit

  const git = (...args) =>
    execFileSync('git', args, {
      cwd: checkout,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-source-test-'))
    checkout = path.join(root, 'checkout')
    fs.mkdirSync(checkout)
    git('init', '--bare', path.join(root, 'origin.git'))
    git('init', '-b', 'main')
    git('config', 'user.name', 'Release Test')
    git('config', 'user.email', 'release-test@example.invalid')
    git('remote', 'add', 'origin', path.join(root, 'origin.git'))
    git('commit', '--allow-empty', '-m', 'Approved source')
    approvedCommit = git('rev-parse', 'HEAD')
    git('tag', '-a', 'v1.2.3', '-m', 'Approved release')
    git('tag', 'v1.2.5')
    git('push', 'origin', 'main', 'main:stable')
    git('switch', '-c', 'unreviewed')
    git('commit', '--allow-empty', '-m', 'Unreviewed source')
    unreviewedCommit = git('rev-parse', 'HEAD')
    git('tag', '-a', 'v1.2.4', '-m', 'Unreviewed release')
  })

  afterAll(() => {
    if (root) fs.rmSync(root, {recursive: true, force: true})
  })

  function validate({commit = approvedCommit, ...env} = {}) {
    expect(validationScript).toBeTruthy()
    git('checkout', '--detach', commit)
    return spawnSync('bash', ['-c', validationScript], {
      cwd: checkout,
      encoding: 'utf8',
      env: {
        ...process.env,
        RELEASE_REF_NAME: 'v1.2.3',
        RELEASE_DEFAULT_BRANCH: 'main',
        GITHUB_SHA: approvedCommit,
        GITHUB_OUTPUT: path.join(root, 'outputs'),
        ...env,
      },
    })
  }

  it('accepts an annotated tag at the triggering, reviewed commit', () => {
    expect(validate().status).toBe(0)
    expect(validate({RELEASE_DEFAULT_BRANCH: 'stable'}).status).toBe(0)
  })

  it.each([
    ['malformed tag', {RELEASE_REF_NAME: 'main'}, /Unsupported release tag/u],
    ['lightweight tag', {RELEASE_REF_NAME: 'v1.2.5'}, /must be annotated/u],
    ['moved tag', {RELEASE_REF_NAME: 'v1.2.4'}, /does not match release tag/u],
    ['wrong trigger', {GITHUB_SHA: '0'.repeat(40)}, /triggering commit/u],
    [
      'missing default branch',
      {RELEASE_DEFAULT_BRANCH: ''},
      /default branch is missing/u,
    ],
  ])('rejects %s before running release code', (_name, env, error) => {
    const result = validate(env)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(error)
  })

  it('rejects an annotated tag from an unreviewed branch', () => {
    const result = validate({
      commit: unreviewedCommit,
      RELEASE_REF_NAME: 'v1.2.4',
      GITHUB_SHA: unreviewedCommit,
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/not on the repository default branch/u)
  })

  it('fails closed if the default branch cannot be fetched', () => {
    expect(validate({RELEASE_DEFAULT_BRANCH: 'missing'}).status).not.toBe(0)
  })

  it('cannot select different release source through a manual dispatch', () => {
    expect(workflow).not.toMatch(/workflow_dispatch|inputs\.tag/u)
    expect(workflow).not.toContain('needs.release-preflight.outputs.commit')
    expect(workflow).toContain('ref: ${{ github.ref }}')
    if (workflow.includes('  release-preflight:')) {
      expect(workflow).toContain('ref: ${{ github.sha }}')
    }
  })
})
