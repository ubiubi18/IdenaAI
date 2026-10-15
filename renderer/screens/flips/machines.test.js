import {flipMachine} from './machines'

jest.mock('nanoid', () => ({nanoid: () => 'test-id'}))

it('requires the edit review flow before publishing a generated draft', () => {
  const guarded = flipMachine.transition('idle', 'PUBLISH', {
    requiresManualReview: true,
  })
  expect(guarded.value).toBe('idle')

  const ordinary = flipMachine.transition('idle', 'PUBLISH', {
    requiresManualReview: false,
  })
  expect(ordinary.matches('publishing')).toBe(true)
})
