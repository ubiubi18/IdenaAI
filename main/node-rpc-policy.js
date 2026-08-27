const GENERIC_RPC_DENIED_METHODS = new Set(['dna_exportKey'])

function normalizeRpcMethod(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function validateGenericRpcMethod(value) {
  const method = normalizeRpcMethod(value)

  if (GENERIC_RPC_DENIED_METHODS.has(method)) {
    return 'privileged_rpc_requires_dedicated_bridge'
  }

  return null
}

function validateExportKeyPayload(payload = {}) {
  const method = normalizeRpcMethod(payload.method)
  const params = Array.isArray(payload.params) ? payload.params : []

  if (
    method !== 'dna_exportKey' ||
    params.length !== 1 ||
    typeof params[0] !== 'string' ||
    params[0].length < 1 ||
    params[0].length > 1024
  ) {
    return 'invalid_export_key_request'
  }

  return null
}

module.exports = {
  validateExportKeyPayload,
  validateGenericRpcMethod,
}
