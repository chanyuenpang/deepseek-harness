import assert from 'node:assert/strict'
import { createServer } from 'node:http'

/** Exercise only owned loopback sockets; never change global constructors or contact OpenAI. */
export async function runLocalSelfTest({ WebSocket }, guard, signal) {
  const results = []
  for (const reason of ['connect_timeout', 'aborted']) {
    signal?.throwIfAborted()
    const upgraded = Promise.withResolvers(), closed = Promise.withResolvers()
    const connections = new Set()
    let stopping = false
    const server = createServer()
    server.on('connection', socket => {
      if (stopping) { socket.destroy(); return }
      connections.add(socket); socket.once('close', () => connections.delete(socket))
    })
    server.on('upgrade', () => upgraded.resolve()) // Deliberately do not complete the handshake.
    let socket, timer, onAbort
    const cancelled = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Local WebSocket self-test exceeded 2 seconds')), 2000)
      onAbort = () => reject(signal.reason ?? new Error('Local self-test aborted'))
      signal?.addEventListener('abort', onAbort, { once: true })
    })
    const wait = promise => Promise.race([promise, cancelled])
    try {
      await wait(new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) }))
      const address = server.address()
      socket = new WebSocket(`ws://127.0.0.1:${address.port}/local-hotfix-test`)
      // This test observer makes a failed diagnostic safe for the Host. Success also
      // requires the guard's own counters, not merely absence of a fatal exception.
      const errors = []
      socket.on('error', error => errors.push(error.message))
      socket.once('close', closed.resolve)
      await wait(upgraded.promise)
      const originalClose = socket.close
      const before = guard.status()
      guard.admitDiagnostic(socket)
      socket.close(1000, reason)
      socket.close(1000, reason) // Repeated close must not add another guard.
      await wait(closed.promise)
      const after = guard.status()
      assert.equal(after.diagnosticCloses, before.diagnosticCloses + 1)
      assert.equal(after.diagnosticErrors, before.diagnosticErrors + 1)
      assert.equal(socket.close, originalClose)
      assert.equal(socket.listenerCount('error'), 1, 'temporary guard was removed')
      assert.equal(socket.listenerCount('close'), 0)
      assert.deepEqual(errors, ['WebSocket was closed before the connection was established'])
      results.push({ reason, passed: true, guardCleaned: true })
    } finally {
      stopping = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (socket && socket.readyState !== WebSocket.CLOSED) { socket.terminate(); await closed.promise }
      socket?.removeAllListeners()
      for (const connection of connections) connection.destroy()
      await new Promise(resolve => server.close(resolve))
    }
  }
  return { scope: 'loopback-core-only', productionAdmissionProven: false, cases: results }
}
