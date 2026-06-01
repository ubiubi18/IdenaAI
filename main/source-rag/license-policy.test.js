const {
  canExportCondensedKnowledgePublicly,
  getPublicCondensedKnowledgeBlockReasons,
  resolveLicensePolicy,
} = require('./license-policy')

describe('source-rag license policy', () => {
  it('allows Wikipedia-style condensed knowledge with attribution/share-alike flags', () => {
    const policy = resolveLicensePolicy({
      license: 'Creative Commons Attribution Share Alike 4.0',
      licenseDetectedFrom: 'page-footer',
    })

    expect(policy).toEqual(
      expect.objectContaining({
        license: 'CC-BY-SA-4.0',
        attributionRequired: true,
        shareAlikeRequired: true,
        commercialUseAllowed: true,
        derivativesAllowed: true,
        fullTextStorageAllowed: false,
        condensedKnowledgeStorageAllowed: true,
        publicCondensedKnowledgeAllowed: true,
      })
    )
    expect(canExportCondensedKnowledgePublicly(policy)).toBe(true)
  })

  it('does not assume arXiv or website licenses when unclear', () => {
    const policy = resolveLicensePolicy({
      license: '',
      licenseDetectedFrom: 'unknown',
    })

    expect(policy).toEqual(
      expect.objectContaining({
        license: 'UNKNOWN',
        licenseClass: 'unknown',
        reviewRequired: true,
        condensedKnowledgeStorageAllowed: false,
        publicCondensedKnowledgeAllowed: false,
      })
    )
    expect(getPublicCondensedKnowledgeBlockReasons(policy)).toEqual([
      'license_unknown',
      'license_review_required',
      'condensed_knowledge_storage_not_allowed',
      'public_condensed_knowledge_not_allowed',
    ])
  })

  it('uses public repository license metadata when provided', () => {
    const policy = resolveLicensePolicy({
      license: 'Apache License 2.0',
      licenseDetectedFrom: 'repository-license',
    })

    expect(policy).toEqual(
      expect.objectContaining({
        license: 'Apache-2.0',
        licenseClass: 'permissive',
        attributionRequired: true,
        shareAlikeRequired: false,
        publicCondensedKnowledgeAllowed: true,
      })
    )
  })

  it('blocks public condensed knowledge when access status is not ok', () => {
    expect(
      getPublicCondensedKnowledgeBlockReasons({
        ...resolveLicensePolicy({license: 'MIT'}),
        accessStatus: 'changed',
      })
    ).toContain('source_access_changed')
  })

  it('blocks public condensed knowledge for source URL risk flags', () => {
    expect(
      getPublicCondensedKnowledgeBlockReasons({
        ...resolveLicensePolicy({license: 'MIT'}),
        accessStatus: 'ok',
        sourceQualityFlags: ['url-risk:canonical-non-public-host'],
      })
    ).toContain('source_quality_url_risk_canonical_non_public_host')
  })
})
