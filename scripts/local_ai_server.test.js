const path = require('path')
const {spawn} = require('child_process')

const SCRIPT_PATH = path.join(__dirname, 'local_ai_server.py')
const MAX_REQUEST_BYTES = 4096

jest.setTimeout(30000)

const itRunsLocalHttpScenario =
  process.platform === 'darwin' && process.env.GITHUB_ACTIONS === 'true'
    ? it.skip
    : it

function pythonInvocation() {
  const configured = String(
    process.env.IDENAAI_PYTHON ||
      (process.platform === 'win32' ? 'python' : 'python3')
  ).trim()
  const [command, ...args] = configured.split(/\s+/u).filter(Boolean)

  return {
    command: command || (process.platform === 'win32' ? 'python' : 'python3'),
    args,
  }
}

function spawnStub(args = [], extraEnv = {}) {
  const python = pythonInvocation()
  const child = spawn(
    python.command,
    [
      ...python.args,
      SCRIPT_PATH,
      '--backend',
      'stub',
      '--max-request-bytes',
      String(MAX_REQUEST_BYTES),
      ...args,
    ],
    {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        MPLBACKEND: process.env.MPLBACKEND || 'Agg',
        PYTHONUNBUFFERED: '1',
        ...extraEnv,
      },
    }
  )

  let stdout = ''
  let stderr = ''

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8')
  })

  return {
    child,
    getStdout: () => stdout,
    getStderr: () => stderr,
  }
}

function runPythonSnippet(snippet) {
  return new Promise((resolve, reject) => {
    const python = pythonInvocation()
    const child = spawn(python.command, [...python.args, '-c', snippet], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        MPLBACKEND: process.env.MPLBACKEND || 'Agg',
        PYTHONPATH: path.resolve(__dirname),
      },
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve(stdout)
        return
      }

      reject(new Error(stderr || `python exited with ${code}`))
    })
  })
}

function indentPython(source, spaces = 4) {
  const prefix = ' '.repeat(spaces)

  return String(source || '')
    .trim()
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')
}

function runPythonServerScenario(scenario) {
  return runPythonSnippet(`
import http.client
import json
import threading
from http.server import HTTPServer
from local_ai_server import LocalAiHandler, StubBackend

server = HTTPServer(("127.0.0.1", 0), LocalAiHandler)
server.backend = StubBackend("local-stub-chat")
server.max_request_bytes = ${MAX_REQUEST_BYTES}
server.auth_token = ""
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
port = server.server_address[1]

def request(method, path, body=None, headers=None):
    payload = body.encode("utf-8") if isinstance(body, str) else body
    request_headers = {"Connection": "close"}
    if headers:
        request_headers.update(headers)
    if payload is not None and "Content-Length" not in request_headers:
        request_headers["Content-Length"] = str(len(payload))
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        conn.request(method, path, body=payload, headers=request_headers)
        response = conn.getresponse()
        raw_body = response.read().decode("utf-8")
        return {
            "statusCode": response.status,
            "body": json.loads(raw_body) if raw_body else None,
        }
    finally:
        conn.close()

try:
${indentPython(scenario)}
finally:
    server.shutdown()
    thread.join(timeout=2)
    server.server_close()
`)
}

function waitForExit(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Process did not exit in time'))
    }, timeoutMs)

    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({code, signal})
    })
  })
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.killed) {
    return
  }

  child.kill('SIGTERM')

  try {
    await waitForExit(child, 3000)
  } catch (_error) {
    child.kill('SIGKILL')
    await waitForExit(child, 3000)
  }
}

describe('local_ai_server.py', () => {
  let running = null

  afterEach(async () => {
    if (running) {
      await stopChild(running.child)
      running = null
    }
  })

  itRunsLocalHttpScenario(
    'rejects oversized JSON bodies with HTTP 413',
    async () => {
      const output = await runPythonServerScenario(`
body = json.dumps({"input": "x" * ${MAX_REQUEST_BYTES}})
response = request(
    "POST",
    "/chat/completions",
    body=body,
    headers={"Content-Type": "application/json"},
)
print(json.dumps(response))
`)
      const response = JSON.parse(output)

      expect(response.statusCode).toBe(413)
      expect(response.body).toMatchObject({
        error: {
          message: 'request_too_large',
          type: 'invalid_request',
        },
      })
    }
  )

  itRunsLocalHttpScenario(
    'requires the managed local auth token when configured',
    async () => {
      const output = await runPythonServerScenario(`
server.auth_token = "managed-local-token"
unauthorized = request("GET", "/health")
authorized = request(
    "GET",
    "/v1/models",
    headers={"X-IdenaAI-Local-Token": server.auth_token},
)
print(json.dumps({"unauthorized": unauthorized, "authorized": authorized}))
`)
      const {authorized, unauthorized} = JSON.parse(output)

      expect(unauthorized.statusCode).toBe(401)
      expect(unauthorized.body).toMatchObject({
        error: {
          message: 'unauthorized',
          type: 'auth_error',
        },
      })
      expect(authorized.statusCode).toBe(200)
      expect(authorized.body).toMatchObject({
        object: 'list',
      })
    }
  )

  itRunsLocalHttpScenario(
    'rejects non-JSON POST bodies with HTTP 415',
    async () => {
      const output = await runPythonServerScenario(`
response = request(
    "POST",
    "/chat/completions",
    body="{}",
    headers={"Content-Type": "text/plain"},
)
print(json.dumps(response))
`)
      const response = JSON.parse(output)

      expect(response.statusCode).toBe(415)
      expect(response.body).toMatchObject({
        error: {
          message: 'unsupported_media_type',
          type: 'invalid_request',
        },
      })
    }
  )

  it('folds system prompts into Molmo-compatible user turns', async () => {
    const output = await runPythonSnippet(`
import json
from local_ai_server import fold_system_messages_into_user_turns
messages = [
    {"role": "system", "content": [{"type": "text", "text": "Be concise."}]},
    {"role": "user", "content": [{"type": "text", "text": "hello"}]},
    {"role": "assistant", "content": [{"type": "text", "text": "hi"}]},
]
print(json.dumps(fold_system_messages_into_user_turns(messages)))
`)
    const folded = JSON.parse(output)

    expect(folded).toHaveLength(2)
    expect(folded[0].role).toBe('user')
    expect(folded[0].content[0].text).toContain('System instruction:')
    expect(folded[0].content[0].text).toContain('Be concise.')
    expect(folded[0].content[0].text).toContain('hello')
    expect(folded[1].role).toBe('assistant')
  })

  it('merges repeated user turns before Molmo chat templating', async () => {
    const output = await runPythonSnippet(`
import json
from local_ai_server import fold_system_messages_into_user_turns
messages = [
    {"role": "user", "content": [{"type": "text", "text": "first failed try"}]},
    {"role": "user", "content": [{"type": "text", "text": "second try"}]},
    {"role": "assistant", "content": [{"type": "text", "text": "reply"}]},
    {"role": "user", "content": [{"type": "text", "text": "follow up"}]},
]
print(json.dumps(fold_system_messages_into_user_turns(messages)))
`)
    const folded = JSON.parse(output)

    expect(folded).toHaveLength(3)
    expect(folded.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
    ])
    expect(folded[0].content[0].text).toContain('first failed try')
    expect(folded[0].content[0].text).toContain('second try')
  })

  it('refuses non-loopback binds without --allow-remote', async () => {
    const remoteAttempt = spawnStub(['--host', '0.0.0.0', '--port', '59999'])

    const result = await waitForExit(remoteAttempt.child)

    expect(result.code).not.toBe(0)
    expect(remoteAttempt.getStdout()).toBe('')
    expect(remoteAttempt.getStderr()).toContain('--allow-remote')
  })
})
