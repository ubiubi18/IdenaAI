#!/usr/bin/env node

const fs = require('fs')

const SHA1_PATTERN = /^[0-9a-f]{40}$/u
const RUN_ID_PATTERN = /^[1-9][0-9]*$/u
const CANDIDATE_WORKFLOW =
  '.github/workflows/application-candidate-artifacts.yml'

function isCandidateWorkflowPath(value) {
  return (
    value === CANDIDATE_WORKFLOW ||
    (typeof value === 'string' &&
      value.startsWith(`${CANDIDATE_WORKFLOW}@`) &&
      value.length > CANDIDATE_WORKFLOW.length + 1)
  )
}

function verifyCandidateRun(run, {runId, commit, repository}) {
  if (
    !RUN_ID_PATTERN.test(runId || '') ||
    !SHA1_PATTERN.test(commit || '') ||
    !/^[^/\s]+\/[^/\s]+$/u.test(repository || '') ||
    !Number.isSafeInteger(run?.id) ||
    String(run.id) !== runId ||
    run.repository?.full_name !== repository ||
    run.head_repository?.full_name !== repository ||
    run.head_sha !== commit ||
    !isCandidateWorkflowPath(run.path) ||
    run.event !== 'workflow_dispatch' ||
    run.status !== 'completed' ||
    run.conclusion !== 'success'
  ) {
    throw new Error(
      'Candidate run does not match the approved completed workflow'
    )
  }
}

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 3) {
    throw new Error('Expected candidate run ID, commit, and repository')
  }
  const [runId, commit, repository] = argv
  const run = JSON.parse(fs.readFileSync(0, 'utf8'))
  verifyCandidateRun(run, {runId, commit, repository})
  console.log(`Verified candidate workflow run ${runId} at ${commit}`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`[candidate-run] ${error.message}`)
    process.exit(1)
  }
}

module.exports = {verifyCandidateRun}
