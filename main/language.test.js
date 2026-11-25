const i18next = require('i18next')
const {getI18nConfig} = require('./language')

jest.mock('electron', () => ({app: {getLocale: () => 'ru-RU'}}))

test('selects the bundled vote translations for each count', async () => {
  const i18n = i18next.createInstance()
  await i18n.init(getI18nConfig())

  expect(i18n.t('Connected to url')).toBe(i18n.t('Connected to url', {url: ''}))
  const votes = (count) => i18n.t('{{count}} votes', {count})
  expect([1, 2, 5, 21].map(votes)).toEqual([
    '1 голос',
    '2 голоса',
    '5 голосов',
    '21 голос',
  ])

  await i18n.changeLanguage('zh')
  expect(votes(2)).toBe('2 票')
})
