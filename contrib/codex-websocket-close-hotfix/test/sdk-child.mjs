// Isolated real-SDK fixture. No process-level exception handler: negative cases must die.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { resolveConsumer } from '../consumer.js'
import { installGuard } from '../guard.js'

const scenario = process.argv[2]
const coreRequire = createRequire(pathToFileURL(join(process.env.DSH_INSTALL_DIR, 'package.json')))
const binding = resolveConsumer(pathToFileURL(process.env.CODEX_PROFILE_ANCHOR), pathToFileURL(coreRequire.resolve('@deepseek-ai/dsh-llm-pi-ai')))
const provider = await import(binding.sdkUrl)
const beforeAdd = binding.WebSocket.prototype.addEventListener
const protectedCase = !scenario.startsWith('negative-') && scenario !== 'noncodex'
const guard = protectedCase ? installGuard(binding) : null
const server = createServer(), connections = new Set(), sockets = []
const handshake = Promise.withResolvers()
let stopping = false, fetches = 0, observedErrors = 0
server.on('connection', socket => { if (stopping) { socket.destroy(); return }; connections.add(socket); socket.once('close', () => connections.delete(socket)) })
server.on('upgrade', () => handshake.resolve())
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const previousWebSocket = globalThis.WebSocket, previousFetch = globalThis.fetch
globalThis.WebSocket = class extends binding.WebSocket {
  constructor(url) {
    super(`ws://127.0.0.1:${address.port}/stalled-upgrade`)
    Object.defineProperty(this, 'url', { value: scenario === 'noncodex' ? 'wss://example.test/other' : String(url) })
    sockets.push(this)
    if (['existing-listener', 'unexpected-observed'].includes(scenario)) this.on('error', () => observedErrors++)
  }
  close(...args) {
    if (['unexpected-error', 'unexpected-observed'].includes(scenario)) process.nextTick(() => this.emit('error', new Error('unrelated fixture network failure')))
    const value = super.close(...args)
    if (scenario === 'unload-before-error') guard.dispose()
    return value
  }
}
globalThis.fetch = async input => {
  assert.equal(String(input), 'https://chatgpt.com/backend-api/codex/responses')
  fetches++
  return new Response('data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":0}}}\n\n', { headers: { 'content-type': 'text/event-stream' } })
}
const controller = new AbortController()
const token = `fixture.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture' } })).toString('base64url')}.fixture`
try {
  const result = provider.stream({ id: 'gpt-5.1-codex', name: 'fixture', api: 'openai-codex-responses', provider: 'openai-codex',
    baseUrl: 'https://chatgpt.com/backend-api', reasoning: true, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 400000, maxTokens: 128000 },
  { messages: [] }, { apiKey: token, env: {}, signal: controller.signal, transport: 'websocket', websocketConnectTimeoutMs: 100 }).result()
  await handshake.promise
  if (scenario === 'unload-before-timeout') guard.dispose()
  if (scenario.endsWith('abort')) controller.abort()
  const output = await result
  await Promise.all(sockets.map(socket => socket.readyState === binding.WebSocket.CLOSED ? null : new Promise(resolve => socket.once('close', resolve))))
  assert.equal(output.stopReason, scenario.endsWith('abort') ? 'aborted' : 'stop')
  if (!scenario.endsWith('abort')) {
    assert.ok(output.diagnostics.some(item => item.type === 'provider_transport_failure'
      && /WebSocket connect timeout/.test(item.error.message) && item.details.fallbackTransport === 'sse'))
  } else assert.equal(output.errorMessage, 'Request was aborted')
  assert.equal(fetches, scenario.endsWith('abort') ? 0 : 1)
  if (guard) {
    const status = guard.status()
    assert.equal(status.admitted, 1, 'actual installed SDK call stack admitted this connection')
    assert.equal(status.guardedCloses, 1)
    assert.equal(status.derivedErrors, 1)
    assert.equal(status.pendingSockets, 0)
    for (const socket of sockets) {
      assert.equal(socket.listenerCount('error'), ['existing-listener', 'unexpected-observed'].includes(scenario) ? 1 : 0)
      assert.equal(socket.listenerCount('close'), 0)
    }
    if (scenario === 'existing-listener') assert.equal(observedErrors, 1)
    if (scenario === 'unexpected-observed') assert.equal(observedErrors, 2)
    console.log(JSON.stringify({ scenario, stopReason: output.stopReason, fetches, ...status }))
  }
} finally {
  stopping = true
  try { guard?.dispose() }
  finally {
    for (const connection of connections) connection.destroy()
    await new Promise(resolve => server.close(resolve))
    globalThis.WebSocket = previousWebSocket
    globalThis.fetch = previousFetch
  }
  assert.equal(binding.WebSocket.prototype.addEventListener, beforeAdd)
}
