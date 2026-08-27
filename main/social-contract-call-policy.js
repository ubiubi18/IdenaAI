const SOCIAL_CONTRACT_ADDRESS = '0x840e092e31e9656ff15e541505039ed77585338e'
const SOCIAL_CONTRACT_METHODS = new Set(['makePost', 'sendMessage', 'sendTip'])
const IDNA_SCALE = 10n ** 18n
const SOCIAL_BASE_CALL_AMOUNT = 10n ** 13n
const SOCIAL_MAX_TIP_AMOUNT = 1000n * IDNA_SCALE
const SOCIAL_MAX_FEE = 10n * IDNA_SCALE
const SOCIAL_MAX_ARGUMENT_BYTES = 1024 * 1024
const SOCIAL_MAX_TEXT_BYTES = 256 * 1024
const SOCIAL_MAX_CIPHERTEXT_BYTES = SOCIAL_MAX_TEXT_BYTES + 256
const SOCIAL_ALLOWED_MEDIA_TYPES = new Set([
  'image/apng',
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'video/mp4',
  'video/webm',
  'video/ogg',
])

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.has(key))
}

function isBoundedString(value, maxBytes, {allowEmpty = false} = {}) {
  return (
    typeof value === 'string' &&
    (allowEmpty || value.length > 0) &&
    Buffer.byteLength(value) <= maxBytes
  )
}

function isOptionalBoundedString(value, maxBytes) {
  return value === undefined || isBoundedString(value, maxBytes)
}

function isBoundedBase64(value, maxBytes) {
  return (
    isBoundedString(value, Math.ceil((maxBytes * 4) / 3) + 4) &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]*={0,2}$/u.test(value)
  )
}

function decimalToAtoms(value) {
  const text = String(value ?? '').trim()
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,18}))?$/u.exec(text)
  if (!match) return null

  const whole = global.BigInt(match[1])
  const fraction = global.BigInt((match[2] || '').padEnd(18, '0') || '0')
  return whole * IDNA_SCALE + fraction
}

function parseContractArgument(call) {
  if (
    !Array.isArray(call.args) ||
    call.args.length !== 1 ||
    !isPlainObject(call.args[0]) ||
    !hasOnlyKeys(call.args[0], new Set(['format', 'index', 'value'])) ||
    call.args[0].format !== 'string' ||
    call.args[0].index !== 0 ||
    typeof call.args[0].value !== 'string' ||
    Buffer.byteLength(call.args[0].value) > SOCIAL_MAX_ARGUMENT_BYTES
  ) {
    return null
  }

  try {
    const parsed = JSON.parse(call.args[0].value)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function validateMethodArgument(method, argument, amountAtoms) {
  if (method === 'makePost') {
    const media = argument.media === undefined ? [] : argument.media
    const mediaType = argument.mediaType === undefined ? [] : argument.mediaType
    return amountAtoms === SOCIAL_BASE_CALL_AMOUNT &&
      hasOnlyKeys(
        argument,
        new Set(['message', 'replyToPostId', 'channelId', 'media', 'mediaType'])
      ) &&
      isBoundedString(argument.message, SOCIAL_MAX_TEXT_BYTES, {
        allowEmpty: true,
      }) &&
      isOptionalBoundedString(argument.replyToPostId, 256) &&
      isOptionalBoundedString(argument.channelId, 256) &&
      Array.isArray(media) &&
      Array.isArray(mediaType) &&
      media.length <= 1 &&
      media.length === mediaType.length &&
      media.every((value) =>
        isBoundedBase64(value, SOCIAL_MAX_ARGUMENT_BYTES)
      ) &&
      mediaType.every((value) => SOCIAL_ALLOWED_MEDIA_TYPES.has(value)) &&
      (argument.message.length > 0 || media.length > 0)
      ? null
      : 'invalid_social_contract_call'
  }

  if (method === 'sendMessage') {
    return amountAtoms === SOCIAL_BASE_CALL_AMOUNT &&
      hasOnlyKeys(argument, new Set(['message', 'messageHash', 'encrypted'])) &&
      Array.isArray(argument.message) &&
      argument.message.length === 2 &&
      argument.message.every((value) =>
        isBoundedBase64(value, SOCIAL_MAX_CIPHERTEXT_BYTES)
      ) &&
      typeof argument.messageHash === 'string' &&
      /^[0-9a-fA-F]{64}$/u.test(argument.messageHash) &&
      argument.encrypted === true
      ? null
      : 'invalid_social_contract_call'
  }

  const declaredTipAtoms = decimalToAtoms(argument.tipAmount)
  return hasOnlyKeys(argument, new Set(['postId', 'tipAmount'])) &&
    typeof argument.postId === 'string' &&
    argument.postId.length > 0 &&
    argument.postId.length <= 256 &&
    amountAtoms !== null &&
    amountAtoms > 0n &&
    amountAtoms <= SOCIAL_MAX_TIP_AMOUNT &&
    declaredTipAtoms === amountAtoms
    ? null
    : 'invalid_social_contract_call'
}

function validateSocialContractCall(call) {
  if (
    !isPlainObject(call) ||
    !hasOnlyKeys(
      call,
      new Set(['from', 'contract', 'method', 'amount', 'args', 'maxFee'])
    ) ||
    !/^0x[0-9a-fA-F]{40}$/u.test(String(call.from || '')) ||
    String(call.contract || '').toLowerCase() !== SOCIAL_CONTRACT_ADDRESS ||
    !SOCIAL_CONTRACT_METHODS.has(call.method)
  ) {
    return 'invalid_social_contract_call'
  }

  const amountAtoms = decimalToAtoms(call.amount)
  const maxFeeAtoms = decimalToAtoms(call.maxFee)
  const argument = parseContractArgument(call)

  if (
    amountAtoms === null ||
    maxFeeAtoms === null ||
    maxFeeAtoms > SOCIAL_MAX_FEE ||
    !argument
  ) {
    return 'invalid_social_contract_call'
  }

  return validateMethodArgument(call.method, argument, amountAtoms)
}

function socialContractCallRequiresConfirmation(call) {
  return Boolean(call && call.method === 'sendTip')
}

module.exports = {
  SOCIAL_CONTRACT_ADDRESS,
  decimalToAtoms,
  parseContractArgument,
  socialContractCallRequiresConfirmation,
  validateSocialContractCall,
}
