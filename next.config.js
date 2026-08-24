// eslint-disable-next-line import/no-extraneous-dependencies
const {PHASE_DEVELOPMENT_SERVER} = require('next/constants')

module.exports = (phase) => ({
  ...(phase === PHASE_DEVELOPMENT_SERVER ? {} : {output: 'export'}),
  outputFileTracingRoot: __dirname,
})
