import { EventEmitter, getEventListeners } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stream } from '@earendil-works/pi-ai/api/openai-codex-responses'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import type { Model } from '@earendil-works/pi-ai'

const model: Model<'openai-codex-responses'> = {
  id: 'gpt-5.1-codex',
  name: 'Codex test model',
  api: 'openai-codex-responses',
  provider: 'openai-codex',
  baseUrl: 'https://chatgpt.com/backend-api',
  reasoning: true,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 400000,
  maxTokens: 128000,
}
const token = `test.${Buffer.from(JSON.stringify({
  'https://api.openai.com/auth': { chatgpt_account_id: 'test-account' },
})).toString('base64url')}.test`

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Codex websocket close errors', () => {
  it.each(['timeout', 'abort', 'already-aborted'] as const)(
    'handles an asynchronous handshake error after %s and releases listeners',
    async (mode) => {
      vi.useFakeTimers()
      const controller = new AbortController()
      const sockets: ConnectingWebSocket[] = []
      const closed = Promise.withResolvers<undefined>()
      let unhandledCloseError: unknown
      let errorListenersAtClose = 0

      // ws uses EventEmitter error semantics even when subscribed through its
      // EventTarget facade. Closing while CONNECTING emits error asynchronously.
      class ConnectingWebSocket {
        readonly events = new EventEmitter()
        readyState = 0
        closeReason: string | undefined

        constructor() {
          sockets.push(this)
        }

        addEventListener(type: string, listener: (event: unknown) => void): void {
          this.events.on(type, listener)
        }

        removeEventListener(type: string, listener: (event: unknown) => void): void {
          this.events.off(type, listener)
        }

        send(): void {
          throw new Error('Cannot send before websocket open')
        }

        close(_code: number, reason: string): void {
          this.closeReason = reason
          this.readyState = 2
          queueMicrotask(() => {
            errorListenersAtClose = this.events.listenerCount('error')
            try {
              this.events.emit('error', new Error('WebSocket was closed before the connection was established'))
            } catch (error) {
              // Observe the EventEmitter throw without crashing the test worker.
              unhandledCloseError = error
            } finally {
              this.readyState = 3
              this.events.emit('close', { code: 1000, reason })
              closed.resolve(undefined)
            }
          })
        }
      }

      vi.stubGlobal('WebSocket', ConnectingWebSocket)
      const fetch = vi.fn(() => Promise.resolve(new Response(
        `data: ${JSON.stringify({
          type: 'response.completed',
          response: { status: 'completed', usage: { input_tokens: 1, output_tokens: 0 } },
        })}\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      )))
      vi.stubGlobal('fetch', fetch)
      if (mode === 'already-aborted') controller.abort()

      const result = stream(model, normalizeContext({ messages: [] }), {
        apiKey: token,
        signal: controller.signal,
        transport: 'auto',
        websocketConnectTimeoutMs: 10,
        env: {},
      }).result()
      // Run the async constructor continuation before cancellation or timeout.
      await vi.advanceTimersByTimeAsync(0)
      expect(sockets).toHaveLength(1)
      if (mode === 'abort') controller.abort()
      if (mode === 'timeout') await vi.advanceTimersByTimeAsync(10)
      await closed.promise
      const output = await result

      expect(unhandledCloseError).toBeUndefined()
      expect(errorListenersAtClose).toBeGreaterThan(0)
      expect(sockets[0]?.closeReason).toBe(mode === 'timeout' ? 'connect_timeout' : 'aborted')
      expect(sockets[0]?.events.eventNames()).toEqual([])
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
      expect(vi.getTimerCount()).toBe(0)
      if (mode === 'timeout') {
        expect(output.stopReason).toBe('stop')
        expect(fetch).toHaveBeenCalledOnce()
        expect(output.diagnostics).toEqual(expect.arrayContaining([
          expect.objectContaining({
            type: 'provider_transport_failure',
            error: expect.objectContaining({ message: 'WebSocket connect timeout after 10ms' }),
            details: expect.objectContaining({ fallbackTransport: 'sse', eventsEmitted: false }),
          }),
        ]))
      } else {
        expect(output.stopReason).toBe('aborted')
        expect(output.errorMessage).toBe('Request was aborted')
        expect(fetch).not.toHaveBeenCalled()
      }
    },
  )
})
