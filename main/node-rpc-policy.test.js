const {
  validateExportKeyPayload,
  validateGenericRpcMethod,
} = require('./node-rpc-policy')

describe('node RPC privilege policy', () => {
  it('blocks private-key export on the generic bridge', () => {
    expect(validateGenericRpcMethod('dna_exportKey')).toBe(
      'privileged_rpc_requires_dedicated_bridge'
    )
    expect(validateGenericRpcMethod('dna_identity')).toBeNull()
  })

  it('accepts only an exact private-key export request on the dedicated bridge', () => {
    expect(
      validateExportKeyPayload({
        method: 'dna_exportKey',
        params: ['local-backup-password'],
      })
    ).toBeNull()
    expect(validateExportKeyPayload({method: 'dna_identity', params: []})).toBe(
      'invalid_export_key_request'
    )
    expect(
      validateExportKeyPayload({method: 'dna_exportKey', params: []})
    ).toBe('invalid_export_key_request')
  })
})
