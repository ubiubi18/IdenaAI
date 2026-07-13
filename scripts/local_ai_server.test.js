const http = require('http')
const net = require('net')
const path = require('path')
const {spawn} = require('child_process')

const SCRIPT_PATH = path.join(__dirname, 'local_ai_server.py')
const MAX_REQUEST_BYTES = 4096
const AUTH_TOKEN_ENV = 'IDENAAI_LOCAL_RUNTIME_TOKEN'

jest.setTimeout(30000)

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

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

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port =
        address && typeof address === 'object' ? address.port : undefined

      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve(port)
      })
    })
  })
}

function request({
  port,
  requestPath,
  method = 'GET',
  body = null,
  headers = {},
  timeoutMs = 5000,
}) {
  return new Promise((resolve, reject) => {
    const requestBody =
      typeof body === 'string' || Buffer.isBuffer(body) ? body : null
    const requestHeaders = {
      Connection: 'close',
      ...headers,
    }

    if (requestBody) {
      requestHeaders['Content-Length'] = Buffer.byteLength(requestBody)
      if (!requestHeaders['Content-Type']) {
        requestHeaders['Content-Type'] = 'application/json'
      }
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: requestPath,
        method,
        headers: requestHeaders,
      },
      (res) => {
        const chunks = []

        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      }
    )

    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy(
        new Error(
          `${method} ${requestPath} timed out after ${timeoutMs}ms on port ${port}`
        )
      )
    })

    if (requestBody) {
      req.write(requestBody)
    }

    req.end()
  })
}

async function waitForHealth(port, headers = {}, running = null) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (running && running.child && running.child.exitCode !== null) {
      throw new Error(
        `Local AI stub exited before health check: exit ${
          running.child.exitCode
        }\n${running.getStderr()}`
      )
    }

    const waitingForReadyOutput =
      running &&
      typeof running.getStdout === 'function' &&
      !running.getStdout().includes(' listening on ')

    if (!waitingForReadyOutput) {
      try {
        const response = await request({
          port,
          requestPath: '/health',
          headers,
          timeoutMs: 1000,
        })

        if (response.statusCode === 200) {
          return
        }
      } catch (_error) {
        // Server is still starting.
      }
    }

    await sleep(100)
  }

  throw new Error(
    `Local AI stub did not start in time on port ${port}\nstdout:\n${
      running && typeof running.getStdout === 'function'
        ? running.getStdout()
        : ''
    }\nstderr:\n${
      running && typeof running.getStderr === 'function'
        ? running.getStderr()
        : ''
    }`
  )
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

  it('rejects oversized JSON bodies with HTTP 413', async () => {
    const port = await findFreePort()
    running = spawnStub(['--port', String(port)])

    await waitForHealth(port, {}, running)

    const oversizedBody = JSON.stringify({
      input: 'x'.repeat(MAX_REQUEST_BYTES),
    })

    const response = await request({
      port,
      requestPath: '/chat/completions',
      method: 'POST',
      body: oversizedBody,
    })

    expect(response.statusCode).toBe(413)
    expect(JSON.parse(response.body)).toMatchObject({
      error: {
        message: 'request_too_large',
        type: 'invalid_request',
      },
    })
  })

  it('requires the managed local auth token when configured', async () => {
    const port = await findFreePort()
    const authToken = 'managed-local-token'
    running = spawnStub(['--port', String(port)], {
      [AUTH_TOKEN_ENV]: authToken,
    })

    await waitForHealth(port, {'X-IdenaAI-Local-Token': authToken}, running)

    const unauthorized = await request({
      port,
      requestPath: '/health',
    })
    const authorized = await request({
      port,
      requestPath: '/v1/models',
      headers: {'X-IdenaAI-Local-Token': authToken},
    })

    expect(unauthorized.statusCode).toBe(401)
    expect(JSON.parse(unauthorized.body)).toMatchObject({
      error: {
        message: 'unauthorized',
        type: 'auth_error',
      },
    })
    expect(authorized.statusCode).toBe(200)
    expect(JSON.parse(authorized.body)).toMatchObject({
      object: 'list',
    })
  })

  it('rejects non-JSON POST bodies with HTTP 415', async () => {
    const port = await findFreePort()
    running = spawnStub(['--port', String(port)])

    await waitForHealth(port, {}, running)

    const response = await request({
      port,
      requestPath: '/chat/completions',
      method: 'POST',
      body: '{}',
      headers: {'Content-Type': 'text/plain'},
    })

    expect(response.statusCode).toBe(415)
    expect(JSON.parse(response.body)).toMatchObject({
      error: {
        message: 'unsupported_media_type',
        type: 'invalid_request',
      },
    })
  })

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
