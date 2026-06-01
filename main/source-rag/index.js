const aiAnnotator = require('./ai-annotator')
const annotation = require('./annotation')
const annotationStore = require('./annotation-store')
const evidenceAnchor = require('./evidence-anchor')
const exportPolicy = require('./export-policy')
const hash = require('./hash')
const knowledgeItem = require('./knowledge-item')
const knowledgeStore = require('./knowledge-store')
const licensePolicy = require('./license-policy')
const retriever = require('./retriever')
const sourceFetchPolicy = require('./source-fetch-policy')
const sourceReference = require('./source-reference')
const sourceStore = require('./source-store')

module.exports = {
  ...aiAnnotator,
  ...annotation,
  ...annotationStore,
  ...evidenceAnchor,
  ...exportPolicy,
  ...hash,
  ...knowledgeItem,
  ...knowledgeStore,
  ...licensePolicy,
  ...retriever,
  ...sourceFetchPolicy,
  ...sourceReference,
  ...sourceStore,
}
