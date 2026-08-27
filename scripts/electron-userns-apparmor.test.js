const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const profile = fs.readFileSync(
  path.join(root, 'deploy/apparmor/idena-ai-electron'),
  'utf8'
)
const installer = fs.readFileSync(
  path.join(root, 'deploy/install-electron-userns-apparmor.sh'),
  'utf8'
)
const shellVariable = (name) => `${String.fromCharCode(36)}{${name}}`
const electronPathReference = shellVariable('electron_path')
const profileSourceReference = shellVariable('profile_source')
const serviceUserReference = shellVariable('service_user')

describe('managed Electron AppArmor policy', () => {
  test('allows user namespaces only for the exact managed Electron path', () => {
    const profileHeader = profile
      .split('\n')
      .find((line) => line.startsWith('profile '))

    expect(profileHeader).toBe(
      'profile idena-ai-electron /opt/idena-ai/source/node_modules/electron/dist/electron flags=(unconfined) {'
    )
    expect(profile.match(/^\s*userns,\s*$/gm)).toHaveLength(1)
    expect(profile).not.toContain('/**')
    expect(profile).not.toMatch(/^\s*(capability|mount|network|ptrace)\b/m)
  })

  test('installer fails closed on a mutable or substituted Electron binary', () => {
    expect(installer).toContain(
      `realpath -e -- "${electronPathReference}") != "${electronPathReference}"`
    )
    expect(installer).toContain(`stat -c '%U' -- "${electronPathReference}"`)
    expect(installer).toContain(
      `runuser -u "${serviceUserReference}" -- test -w "${electronPathReference}"`
    )
    expect(installer).toContain(
      `apparmor_parser -Q "${profileSourceReference}"`
    )
    expect(installer).not.toMatch(/sysctl|--no-sandbox|chmod\s+4755|setcap/)
  })
})
