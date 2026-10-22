const {
  auditPolicyFailures,
  runAuditSummary,
} = require('./check-dependency-footprint')

describe('dependency audit policy', () => {
  it('retries a timed-out request and accepts a complete vulnerability report', () => {
    const run = jest
      .fn()
      .mockReturnValueOnce({error: new Error('network timeout')})
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({metadata: {vulnerabilities: {total: 0}}}),
      })

    expect(runAuditSummary(run).vulnerabilities).toEqual({total: 0})
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('fails closed after two incomplete audit responses', () => {
    const run = jest.fn().mockReturnValue({
      status: 1,
      stdout: JSON.stringify({error: {message: 'registry unavailable'}}),
    })

    expect(auditPolicyFailures(runAuditSummary(run))).toEqual([
      'npm audit --omit=dev unavailable: registry unavailable',
    ])
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('fails closed when npm audit cannot be evaluated', () => {
    expect(auditPolicyFailures({error: 'network unavailable'})).toEqual([
      'npm audit --omit=dev unavailable: network unavailable',
    ])
  })

  it('blocks high or critical production findings', () => {
    expect(
      auditPolicyFailures({
        vulnerabilities: {low: 0, moderate: 1, high: 2, critical: 1},
      })
    ).toEqual([
      'npm audit --omit=dev reports 2 high and 1 critical production vulnerabilities',
    ])
  })

  it('allows a production tree with no high or critical findings', () => {
    expect(
      auditPolicyFailures({
        vulnerabilities: {low: 1, moderate: 1, high: 0, critical: 0},
      })
    ).toEqual([])
  })
})
