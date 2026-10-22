/* global BigInt */
const BASE_UNITS = 10n ** 18n

export function idnaToBaseUnits(value) {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(value)
  ) {
    return null
  }

  const [whole, fraction = ''] = value.split('.')
  return (
    BigInt(whole) * BASE_UNITS +
    BigInt(fraction.padEnd(18, '0') || '0')
  ).toString()
}

export function baseUnitsToIdna(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    return null
  }
  const units = BigInt(value)
  const whole = units / BASE_UNITS
  const fraction = String(units % BASE_UNITS)
    .padStart(18, '0')
    .replace(/0+$/, '')
  return `${whole}${fraction ? `.${fraction}` : ''}`
}
