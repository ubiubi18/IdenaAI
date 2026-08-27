/* eslint-disable import/no-extraneous-dependencies */
const {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
} = require('next/constants')
const createNextConfig = require('./next.config')

describe('Next.js renderer configuration', () => {
  it('keeps static export for builds but not for the development server', () => {
    expect(createNextConfig(PHASE_DEVELOPMENT_SERVER)).toEqual({
      agentRules: false,
      outputFileTracingRoot: __dirname,
    })
    expect(createNextConfig(PHASE_PRODUCTION_BUILD)).toEqual({
      agentRules: false,
      output: 'export',
      outputFileTracingRoot: __dirname,
    })
  })
})
