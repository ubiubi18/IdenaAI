import {TextEncoder, TextDecoder} from 'util'

const {
  buildDynamicArgs,
  buildContractDeploymentArgs,
  stripOptions,
  getVotingOptionIndex,
  hexToObject,
  objectToHex,
  mapVoting,
} = require('./utils')

describe('buildDynamicArgs', () => {
  it('should filter nullish values out', () => {
    expect(
      buildDynamicArgs([{value: null}, {value: undefined}, {foo: 'bar'}, {}])
    ).toHaveLength(0)
    expect(
      buildDynamicArgs([
        {value: null},
        {value: undefined},
        {foo: ''},
        {value: 0},
        {value: ''},
        {},
      ])
    ).toHaveLength(2)
    expect(
      buildDynamicArgs([{value: 1}, {value: 2}, {foo: 'bar'}, {}])
    ).toHaveLength(2)
    expect(
      buildDynamicArgs([{value: 0}, {value: false}, {value: ''}, {}])
    ).toHaveLength(3)
  })
})

describe('buildDeploymentArgs', () => {
  global.TextEncoder = TextEncoder
  global.TextDecoder = TextDecoder

  describe('winnerThreshold', () => {
    it('should set default winnerThreshold', () => {
      expect(
        buildContractDeploymentArgs(
          {
            title: 'title',
          },
          {from: '0x0', stake: 100, gasCost: 0, txFee: 0}
        ).args.find(({index}) => index === 4)
      ).toHaveProperty('value', '66')
    })

    it('should not replace 0 with default', () => {
      expect(
        buildContractDeploymentArgs(
          {
            title: 'title',
            winnerThreshold: 0,
          },
          {from: '0x0', stake: 100, gasCost: 0, txFee: 0}
        ).args.find(({index}) => index === 4)
      ).toHaveProperty('value', '0')
    })

    it('should respect valid value', () => {
      ;[10, 22, 33, 51, 65, 77, 99].forEach((v) =>
        expect(
          buildContractDeploymentArgs(
            {
              title: 'title',
              winnerThreshold: v,
            },
            {from: '0x0', stake: 100, gasCost: 0, txFee: 0}
          ).args.find(({index}) => index === 4)
        ).toHaveProperty('value', String(v))
      )
    })
  })
})

describe('voting options', () => {
  global.TextEncoder = TextEncoder
  global.TextDecoder = TextDecoder

  it('filters empty options and reindexes ids for contract storage', () => {
    expect(
      stripOptions([
        {id: 0, value: ''},
        {id: 4, value: 'Accept'},
        {id: 8, value: 'Reject'},
      ])
    ).toEqual([
      {id: 0, value: 'Accept'},
      {id: 1, value: 'Reject'},
    ])
  })

  it('maps a selected UI option id to the contract option index', () => {
    const options = [
      {id: 4, value: 'Accept'},
      {id: 8, value: 'Reject'},
    ]

    expect(getVotingOptionIndex(options, 4)).toBe(0)
    expect(getVotingOptionIndex(options, 8)).toBe(1)
    expect(getVotingOptionIndex(options, 0)).toBe(0)
    expect(getVotingOptionIndex(options, 3)).toBe(-1)
  })

  it('stores reindexed options in deployment args', () => {
    const fact = hexToObject(
      buildContractDeploymentArgs(
        {
          title: 'title',
          options: [
            {id: 0, value: ''},
            {id: 2, value: 'Yes'},
            {id: 5, value: 'No'},
          ],
        },
        {from: '0x0', stake: 100, gasCost: 0, txFee: 0}
      ).args.find(({index}) => index === 0).value
    )

    expect(fact.options).toEqual([
      {id: 0, value: 'Yes'},
      {id: 1, value: 'No'},
    ])
  })

  it('normalizes fetched voting fact options', () => {
    expect(
      mapVoting({
        contractAddress: '0x1',
        fact: `0x${objectToHex({
          title: 'title',
          options: [
            {id: 2, value: 'Yes'},
            {id: 5, value: 'No'},
          ],
        }).toString()}`,
      }).options
    ).toEqual([
      {id: 0, value: 'Yes'},
      {id: 1, value: 'No'},
    ])
  })
})
