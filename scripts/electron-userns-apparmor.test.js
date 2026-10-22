const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const profiles = [
  ['idena-ai-electron', '/opt/idena-ai/source'],
  ['idena-ai-3-electron', '/opt/idena-ai-3/source'],
]
const installer = fs.readFileSync(
  path.join(root, 'deploy/install-electron-userns-apparmor.sh'),
  'utf8'
)
const shellVariable = (name) => `${String.fromCharCode(36)}{${name}}`
const electronPathReference = shellVariable('electron_path')
const profileSourceReference = shellVariable('profile_source')
const serviceUserReference = shellVariable('service_user')

describe('managed Electron AppArmor policy', () => {
  test.each(profiles)(
    'allows user namespaces only for the exact %s Electron path',
    (name, source) => {
      const profile = fs.readFileSync(
        path.join(root, 'deploy/apparmor', name),
        'utf8'
      )
      const profileHeader = profile
        .split('\n')
        .find((line) => line.startsWith('profile '))

      expect(profileHeader).toBe(
        `profile ${name} ${source}/node_modules/electron/dist/electron flags=(unconfined) {`
      )
      expect(profile.match(/^\s*userns,\s*$/gm)).toHaveLength(1)
      expect(profile).not.toContain('/**')
      expect(profile).not.toMatch(/^\s*(capability|mount|network|ptrace)\b/m)
    }
  )

  test('installer fails closed on a mutable or substituted Electron binary', () => {
    expect(installer).toContain(
      `realpath -e -- "${electronPathReference}") != "${electronPathReference}"`
    )
    expect(installer).toContain(`stat -c '%U' -- "${electronPathReference}"`)
    expect(installer).toContain(
      `runuser -u "${serviceUserReference}" -- test -w "${electronPathReference}"`
    )
    expect(installer).toContain(
      `runuser -u "${serviceUserReference}" -- test -w "${shellVariable(
        'path_to_check'
      )}"`
    )
    expect(installer).toContain(
      `apparmor_parser -Q "${profileSourceReference}"`
    )
    expect(installer).not.toMatch(/sysctl|--no-sandbox|chmod\s+4755|setcap/)
  })

  test('instance 3 uses its own fixed service user and AppArmor profile', () => {
    expect(installer).toContain('profile_name=idena-ai-3-electron')
    expect(installer).toContain(
      'electron_path=/opt/idena-ai-3/source/node_modules/electron/dist/electron'
    )
    expect(installer).toContain('service_user=idenaai3')
  })
})
