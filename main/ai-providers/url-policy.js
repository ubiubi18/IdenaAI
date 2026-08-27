const dns = require('dns')
const net = require('net')
const Agent = require('undici/lib/dispatcher/agent')

const DEFAULT_PROVIDER_RESPONSE_LIMIT = 24 * 1024 * 1024
const NON_PUBLIC_IPV6 = new net.BlockList()
for (const [address, prefix] of [
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
]) {
  NON_PUBLIC_IPV6.addSubnet(address, prefix, 'ipv6')
}

function isLoopbackHost(hostname) {
  const host = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, '')
  return (
    host === 'localhost' ||
    host === '::1' ||
    /^127(?:\.\d{1,3}){3}$/u.test(host)
  )
}

function isPublicIpv4(address) {
  const parts = String(address || '')
    .split('.')
    .map(Number)
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false
  }

  const [a, b, c] = parts
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

function isPublicIpAddress(address) {
  const version = net.isIP(address)
  if (version === 4) return isPublicIpv4(address)
  if (version !== 6) return false

  const normalized = String(address || '').toLowerCase()
  if (normalized.startsWith('::ffff:')) {
    return isPublicIpv4(normalized.slice('::ffff:'.length))
  }

  return !NON_PUBLIC_IPV6.check(normalized, 'ipv6')
}

function parseRemoteUrl(value, {allowLoopbackHttp = false} = {}) {
  let parsed
  try {
    parsed = new URL(String(value || '').trim())
  } catch {
    throw new Error('Remote endpoint must be a valid URL')
  }

  if (parsed.username || parsed.password) {
    throw new Error('Remote endpoint must not contain credentials')
  }

  const hostname = parsed.hostname.toLowerCase()
  const loopback = isLoopbackHost(hostname)
  if (
    parsed.protocol !== 'https:' &&
    !(allowLoopbackHttp && parsed.protocol === 'http:' && loopback)
  ) {
    throw new Error('Remote endpoint must use HTTPS or explicit loopback HTTP')
  }

  if (
    !loopback &&
    (hostname === 'metadata' ||
      hostname === 'metadata.google.internal' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal'))
  ) {
    throw new Error('Remote endpoint hostname is not public')
  }

  if (net.isIP(hostname) && !loopback && !isPublicIpAddress(hostname)) {
    throw new Error('Remote endpoint address is not public')
  }

  return parsed
}

async function assertRemoteUrl(
  value,
  {allowLoopbackHttp = false, lookup = dns.promises.lookup} = {}
) {
  const parsed = parseRemoteUrl(value, {allowLoopbackHttp})
  const hostname = parsed.hostname.toLowerCase()

  if (!lookup || isLoopbackHost(hostname) || net.isIP(hostname)) {
    return parsed
  }

  const records = await lookup(hostname, {all: true, verbatim: true})
  if (
    !Array.isArray(records) ||
    records.length === 0 ||
    records.some((record) => !isPublicIpAddress(record && record.address))
  ) {
    throw new Error('Remote endpoint resolved to a non-public address')
  }

  return parsed
}

function createRestrictedLookup(lookup = dns.lookup) {
  if (typeof lookup !== 'function') {
    throw new Error('A connection DNS lookup function is required')
  }

  return (hostname, options, callback) => {
    const requestedOptions =
      options && typeof options === 'object' ? options : {family: options}

    lookup(
      hostname,
      {...requestedOptions, all: true, verbatim: true},
      (error, resolvedRecords, legacyFamily) => {
        if (error) {
          callback(error)
          return
        }

        const records = Array.isArray(resolvedRecords)
          ? resolvedRecords
          : [{address: resolvedRecords, family: legacyFamily}]
        const loopbackRequest = isLoopbackHost(hostname)
        const invalid =
          records.length === 0 ||
          records.some((record) => {
            const address = record && record.address
            return loopbackRequest
              ? !isLoopbackHost(address)
              : !isPublicIpAddress(address)
          })

        if (invalid) {
          const policyError = new Error(
            'Remote endpoint resolved to a non-public address'
          )
          policyError.code = 'ERR_REMOTE_ADDRESS_POLICY'
          callback(policyError)
          return
        }

        if (requestedOptions.all) {
          callback(null, records)
          return
        }

        const [selected] = records
        callback(null, selected.address, selected.family)
      }
    )
  }
}

function createRestrictedDispatcher({lookup = dns.lookup} = {}) {
  return new Agent({connect: {lookup: createRestrictedLookup(lookup)}})
}

function createProviderHttpClient(
  client,
  {
    lookup = dns.promises.lookup,
    connectionLookup = dns.lookup,
    dispatcherFactory = createRestrictedDispatcher,
    maxResponseBytes = DEFAULT_PROVIDER_RESPONSE_LIMIT,
  } = {}
) {
  const dispatcher =
    typeof connectionLookup === 'function'
      ? dispatcherFactory({lookup: connectionLookup})
      : null

  async function checkedUrl(value) {
    return (
      await assertRemoteUrl(value, {
        allowLoopbackHttp: true,
        lookup,
      })
    ).toString()
  }

  const secureConfig = (config = {}) => {
    const secured = {
      ...config,
      redirect: 'error',
      maxResponseBytes: Math.min(
        maxResponseBytes,
        Number(config.maxResponseBytes) || maxResponseBytes
      ),
    }
    if (dispatcher) secured.dispatcher = dispatcher
    return secured
  }

  return {
    async get(url, config = {}) {
      return client.get(await checkedUrl(url), secureConfig(config))
    },
    async post(url, data, config = {}) {
      return client.post(await checkedUrl(url), data, secureConfig(config))
    },
    async request(config = {}) {
      const requestUrl = new URL(config.url || '', config.baseURL).toString()
      return client.request({
        ...secureConfig(config),
        baseURL: undefined,
        url: await checkedUrl(requestUrl),
      })
    },
  }
}

module.exports = {
  assertRemoteUrl,
  createProviderHttpClient,
  createRestrictedDispatcher,
  createRestrictedLookup,
  isPublicIpAddress,
  parseRemoteUrl,
}
