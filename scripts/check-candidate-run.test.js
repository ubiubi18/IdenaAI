const {verifyCandidateRun} = require('./check-candidate-run')

describe('approved candidate workflow run', () => {
  const expected = {
    runId: '123456789',
    commit: 'a'.repeat(40),
    repository: 'ubiubi18/IdenaAI',
  }
  const run = {
    id: 123456789,
    repository: {full_name: expected.repository},
    head_repository: {full_name: expected.repository},
    head_sha: expected.commit,
    path: '.github/workflows/application-candidate-artifacts.yml@main',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
  }

  it('accepts the approved successful manual candidate run', () => {
    expect(() => verifyCandidateRun(run, expected)).not.toThrow()
  })

  it.each([
    {id: 123456788},
    {head_sha: 'b'.repeat(40)},
    {repository: {full_name: 'someone/other'}},
    {head_repository: {full_name: 'someone/other'}},
    {path: '.github/workflows/release.yml'},
    {event: 'push'},
    {status: 'in_progress'},
    {conclusion: 'failure'},
  ])('rejects changed run identity or status: %p', (change) => {
    expect(() => verifyCandidateRun({...run, ...change}, expected)).toThrow(
      /does not match/u
    )
  })
})
