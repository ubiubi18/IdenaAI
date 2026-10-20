import {baseUnitsToIdna, idnaToBaseUnits} from './fod-v7-amount'

it('converts a human fee cap to exact base units without rounding', () => {
  expect(idnaToBaseUnits('0.1')).toBe('100000000000000000')
  expect(idnaToBaseUnits('1.000000000000000001')).toBe('1000000000000000001')
  expect(baseUnitsToIdna('1000000000000000001')).toBe('1.000000000000000001')
})

it('rejects ambiguous or over-precise iDNA amounts', () => {
  for (const value of ['1e3', '01', '-1', '1.0000000000000000001', ' 1']) {
    expect(idnaToBaseUnits(value)).toBeNull()
  }
})
