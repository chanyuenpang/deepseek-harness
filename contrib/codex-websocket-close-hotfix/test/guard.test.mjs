import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installGuard } from '../guard.js'
import { runLocalSelfTest } from '../self-test.js'

const require = createRequire(process.env.CODEX_PROFILE_ANCHOR ?? import.meta.url)
const wsRequire = process.env.CODEX_PROFILE_ANCHOR ? createRequire(require.resolve('dsh-codex-subscription')) : require
const WebSocket = wsRequire('ws')
const binding = { WebSocket, sdkUrl: 'file:///fixture/openai-codex-responses.js',
  wsFile: join(dirname(wsRequire.resolve('ws/package.json')), 'lib/websocket.js') }

test('local core self-test cleans its guards and keeps production counters separate', async () => {
  const original = WebSocket.prototype.addEventListener
  const guard = installGuard(binding)
  try {
    const result = await runLocalSelfTest(binding, guard, new AbortController().signal)
    assert.equal(result.cases.length, 2)
    assert.equal(result.productionAdmissionProven, false)
    assert.equal(guard.status().admitted, 0)
    assert.equal(guard.status().diagnosticErrors, 2)
    assert.equal(guard.status().pendingSockets, 0)
  } finally { guard.dispose() }
  assert.equal(WebSocket.prototype.addEventListener, original)
})

test('duplicate admission fails without stacking and later wrappers are not overwritten', t => {
  const warning = t.mock.method(console, 'warn', () => {})
  const descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'addEventListener')
  const guard = installGuard(binding)
  try {
    assert.throws(() => installGuard(binding), /already installed/)
    const ours = WebSocket.prototype.addEventListener
    const later = function (...args) { return Reflect.apply(ours, this, args) }
    WebSocket.prototype.addEventListener = later
    guard.dispose()
    assert.equal(WebSocket.prototype.addEventListener, later)
    assert.equal(guard.status().conflict, true)
    assert.equal(guard.status().active, false)
    assert.match(warning.mock.calls[0].arguments[0], /manually restart Desktop/)
  } finally { Object.defineProperty(WebSocket.prototype, 'addEventListener', descriptor) }
})

test('an unknown earlier wrapper is rejected unchanged', () => {
  const descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'addEventListener')
  const earlier = function (...args) { return Reflect.apply(descriptor.value, this, args) }
  WebSocket.prototype.addEventListener = earlier
  try { assert.throws(() => installGuard(binding), /wrapped or unsupported/); assert.equal(WebSocket.prototype.addEventListener, earlier) }
  finally { Object.defineProperty(WebSocket.prototype, 'addEventListener', descriptor) }
})

test('cancelled local diagnostics acquire no socket', async () => {
  const guard = installGuard(binding), abort = new AbortController()
  abort.abort(new Error('fixture cancellation'))
  try { await assert.rejects(runLocalSelfTest(binding, guard, abort.signal), /fixture cancellation/); assert.equal(guard.status().pendingSockets, 0) }
  finally { guard.dispose() }
})

test('a successful connection releases its instance wrapper on open', async () => {
  const guard = installGuard(binding), signal = AbortSignal.timeout(2000)
  const server = new WebSocket.WebSocketServer({ port: 0, host: '127.0.0.1' })
  let socket
  try {
    await once(server, 'listening', { signal })
    socket = new WebSocket(`ws://127.0.0.1:${server.address().port}`)
    socket.on('error', () => {})
    const originalClose = socket.close
    guard.admitDiagnostic(socket)
    await once(socket, 'open', { signal })
    assert.equal(socket.close, originalClose)
    assert.equal(guard.status().pendingSockets, 0)
    socket.close(1000, 'normal')
    await once(socket, 'close', { signal })
    assert.equal(guard.status().diagnosticErrors, 0)
  } finally {
    if (socket && socket.readyState !== WebSocket.CLOSED) { const closed = once(socket, 'close'); socket.terminate(); await closed }
    for (const client of server.clients) client.terminate()
    await new Promise(resolve => server.close(resolve))
    guard.dispose()
  }
})

test('synchronous close failures restore the previous instance method and are rethrown', () => {
  const guard = installGuard(binding), expected = new Error('fixture synchronous close')
  class Socket extends EventEmitter { readyState = 0; close() { throw expected } }
  const socket = new Socket(), original = socket.close
  try {
    guard.admitDiagnostic(socket)
    assert.throws(() => socket.close(1000, 'aborted'), error => error === expected)
    assert.equal(socket.close, original)
    assert.equal(guard.status().pendingSockets, 0)
    assert.equal(socket.listenerCount('error'), 0)
  } finally { guard.dispose() }
})

const executable = process.env.HOTFIX_ELECTRON_EXECUTABLE
test('diagnostic status schema compiles in the installed Host schema subset', { skip: !executable }, () => {
  const child = spawnSync(executable, [fileURLToPath(new URL('./schema-child.mjs', import.meta.url))], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 7000,
  })
  assert.ifError(child.error)
  assert.equal(child.status, 0, child.stdout + child.stderr)
})
for (const scenario of ['negative-timeout', 'negative-abort', 'noncodex', 'unexpected-error',
  'protected-timeout', 'protected-abort', 'unload-before-timeout', 'unload-before-error', 'existing-listener', 'unexpected-observed']) {
  test(`installed SDK + actual ws: ${scenario}`, { skip: !executable, timeout: 10000 }, () => {
    const child = spawnSync(executable, [fileURLToPath(new URL('./sdk-child.mjs', import.meta.url)), scenario], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 7000,
    })
    assert.ifError(child.error)
    const negative = scenario.startsWith('negative-') || ['noncodex', 'unexpected-error'].includes(scenario)
    assert.equal(child.status, negative ? 1 : 0, child.stdout + child.stderr)
    if (negative) assert.match(child.stderr, scenario === 'unexpected-error' ? /unrelated fixture network failure/ : /WebSocket was closed before the connection was established/)
    else {
      const report = JSON.parse(child.stdout.trim())
      assert.equal(report.admitted, 1)
      assert.equal(report.derivedErrors, 1)
      assert.equal(report.pendingSockets, 0)
    }
  })
}
