const {auditPolicyFailures} = require('./check-dependency-footprint')

describe('dependency audit policy', () => {
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
