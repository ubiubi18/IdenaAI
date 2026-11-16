const SOCIAL_CONTRACT_ADDRESS = '0x840e092e31e9656ff15e541505039ed77585338e'
const SOCIAL_CONTRACT_METHODS = new Set(['makePost', 'sendMessage', 'sendTip'])
const SOCIAL_PROFILE_CONTRACT_ADDRESS =
  '0xd558483330925f169bbe692d8ea15b2faa83c17f'
const SOCIAL_PROFILE_METHODS = new Set(['claimName', 'dropName', 'setProfile'])
const SOCIAL_PROFILE_ADDRESS_MAPS = new Set([
  'a:',
  'b:',
  'p:',
  'i:',
  'v:',
  'r:',
])
const SOCIAL_PROFILE_NAME_MAPS = new Set(['n:', 'x:'])
// A 32 KiB picture is hex encoded in JSON, so 128 KiB leaves ample envelope room.
const SOCIAL_PROFILE_PICTURE_MAX_RESPONSE_BYTES = 128 * 1024
const IDNA_SCALE = 10n ** 18n
const SOCIAL_BASE_CALL_AMOUNT = 10n ** 13n
const SOCIAL_MESSAGE_CALL_AMOUNT = 2n * SOCIAL_BASE_CALL_AMOUNT
const SOCIAL_MAX_TIP_AMOUNT = 1000n * IDNA_SCALE
const SOCIAL_MAX_FEE = 10n * IDNA_SCALE
const SOCIAL_MESSAGE_MAX_FEE = 20n * IDNA_SCALE
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

function validateSocialProfileReadMap(params) {
  if (
    !Array.isArray(params) ||
    params.length !== 4 ||
    params[0] !== SOCIAL_PROFILE_CONTRACT_ADDRESS ||
    params[3] !== 'string' ||
    typeof params[2] !== 'string' ||
    params[2].length > 86 ||
    !/^0x(?:[0-9a-f]{2})+$/u.test(params[2])
  ) {
    return 'invalid_rpc_params'
  }

  const key = Buffer.from(params[2].slice(2), 'hex').toString('utf8')
  if (`0x${Buffer.from(key, 'utf8').toString('hex')}` !== params[2]) {
    return 'invalid_rpc_params'
  }

  return (SOCIAL_PROFILE_ADDRESS_MAPS.has(params[1]) &&
    /^0x[0-9a-f]{40}$/u.test(key)) ||
    (SOCIAL_PROFILE_NAME_MAPS.has(params[1]) && /^[a-z0-9_]{3,20}$/u.test(key))
    ? null
    : 'invalid_rpc_params'
}

function validateSocialProfilePictureCid(params) {
  return Array.isArray(params) &&
    params.length === 1 &&
    typeof params[0] === 'string' &&
    /^[a-zA-Z0-9]{10,120}$/u.test(params[0])
    ? null
    : 'invalid_rpc_params'
}

function validateSocialProfileCall(call) {
  if (
    !isPlainObject(call) ||
    !hasOnlyKeys(
      call,
      new Set(['from', 'contract', 'method', 'amount', 'args', 'maxFee'])
    ) ||
    !/^0x[0-9a-fA-F]{40}$/u.test(call.from) ||
    call.contract !== SOCIAL_PROFILE_CONTRACT_ADDRESS ||
    !SOCIAL_PROFILE_METHODS.has(call.method) ||
    decimalToAtoms(call.amount) !== 0n
  ) {
    return 'invalid_social_contract_call'
  }

  const maxFee = decimalToAtoms(call.maxFee)
  if (maxFee === null || maxFee <= 0n || maxFee > SOCIAL_MAX_FEE) {
    return 'invalid_social_contract_call'
  }

  if (call.method === 'dropName') {
    return Array.isArray(call.args) && call.args.length === 0
      ? null
      : 'invalid_social_contract_call'
  }

  if (
    !Array.isArray(call.args) ||
    call.args.length !== 1 ||
    !isPlainObject(call.args[0]) ||
    typeof call.args[0].value !== 'string' ||
    Buffer.byteLength(call.args[0].value) > 1024
  ) {
    return 'invalid_social_contract_call'
  }

  const argument = parseContractArgument(call)
  if (
    !argument ||
    argument._gas !== 3_000_000 ||
    argument._keepGas !== 1_000_000
  ) {
    return 'invalid_social_contract_call'
  }

  if (call.method === 'claimName') {
    return hasOnlyKeys(argument, new Set(['name', '_gas', '_keepGas'])) &&
      typeof argument.name === 'string' &&
      /^[a-z0-9_]{3,20}$/u.test(argument.name)
      ? null
      : 'invalid_social_contract_call'
  }

  return hasOnlyKeys(
    argument,
    new Set(['bio', 'picture', '_gas', '_keepGas'])
  ) &&
    typeof argument.bio === 'string' &&
    argument.bio.length <= 160 &&
    Buffer.byteLength(argument.bio) <= 640 &&
    typeof argument.picture === 'string' &&
    (argument.picture === '' ||
      (argument.picture.length <= 120 &&
        /^ipfs:\/\/[a-zA-Z0-9]{10,}$/u.test(argument.picture)))
    ? null
    : 'invalid_social_contract_call'
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
    return amountAtoms === SOCIAL_MESSAGE_CALL_AMOUNT &&
      hasOnlyKeys(argument, new Set(['message', 'messageHash', 'encrypted'])) &&
      Array.isArray(argument.message) &&
      argument.message.length >= 2 &&
      argument.message.length <= 16 &&
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

  if (amountAtoms === null || maxFeeAtoms === null || !argument) {
    return 'invalid_social_contract_call'
  }

  let maxFeeLimit = SOCIAL_MAX_FEE
  if (call.method === 'sendMessage') {
    const ciphertextCount = Array.isArray(argument.message)
      ? argument.message.length
      : 0
    if (ciphertextCount < 2 || ciphertextCount > 16) {
      return 'invalid_social_contract_call'
    }
    maxFeeLimit = SOCIAL_MESSAGE_MAX_FEE
  }
  if (maxFeeAtoms > maxFeeLimit) return 'invalid_social_contract_call'

  return validateMethodArgument(call.method, argument, amountAtoms)
}

function socialContractCallRequiresConfirmation(call) {
  return Boolean(
    call &&
      (call.method === 'sendTip' ||
        (call.contract === SOCIAL_PROFILE_CONTRACT_ADDRESS &&
          SOCIAL_PROFILE_METHODS.has(call.method)))
  )
}

module.exports = {
  SOCIAL_CONTRACT_ADDRESS,
  SOCIAL_PROFILE_CONTRACT_ADDRESS,
  SOCIAL_PROFILE_PICTURE_MAX_RESPONSE_BYTES,
  decimalToAtoms,
  parseContractArgument,
  socialContractCallRequiresConfirmation,
  validateSocialContractCall,
  validateSocialProfileCall,
  validateSocialProfilePictureCid,
  validateSocialProfileReadMap,
}
