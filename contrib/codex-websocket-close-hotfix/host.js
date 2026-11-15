import { randomUUID } from 'node:crypto'
import { resolveConsumer } from './consumer.js'
import { installGuard } from './guard.js'
import { runLocalSelfTest } from './self-test.js'

export const name = 'codex-websocket-close-hotfix'
export const inject = ['tools']
const counts = ['pendingSockets', 'admitted', 'guardedCloses', 'derivedErrors', 'cleaned',
  'diagnosticAdmitted', 'diagnosticCloses', 'diagnosticErrors', 'unmatchedCandidates']
export const statusProperties = {
  version: { type: 'string' }, generation: { type: 'string' }, consumerVersion: { type: 'string' },
  wsVersion: { type: 'string' }, sdkVersion: { type: 'string' }, bindingVerified: { type: 'boolean' },
  active: { type: 'boolean' }, draining: { type: 'boolean' }, conflict: { type: 'boolean' },
  ...Object.fromEntries(counts.map(key => [key, { type: 'integer' }])),
}

/** Install reversible admission and one bounded, credential-free diagnostic tool. */
export function apply(ctx) {
  const binding = resolveConsumer(import.meta.url, import.meta.resolve('@deepseek-ai/dsh-llm-pi-ai'))
  ctx.effect(() => {
    const guard = installGuard(binding)
    const generation = randomUUID(), lifetime = new AbortController()
    let selfTestJob
    try {
      const unregister = ctx.tools.register({
        name: 'codex_websocket_hotfix_check',
        description: 'Check the active Codex WebSocket close fix and its verification counters. Optional self-test uses only local temporary sockets; no OpenAI request or credential access. Production and diagnostic counters are separate.',
        parameters: { type: 'object', properties: { self_test: { type: 'boolean', description: 'Run the bounded loopback close tests; default false.' } }, additionalProperties: false },
        output: {
          schema: { type: 'object', properties: {
            status: { type: 'object', properties: statusProperties, required: Object.keys(statusProperties), additionalProperties: false },
            self_test: { type: 'object', properties: {
              scope: { type: 'string', const: 'loopback-core-only' }, productionAdmissionProven: { type: 'boolean', const: false },
              cases: { type: 'array', items: { type: 'object', properties: {
                reason: { type: 'string', enum: ['connect_timeout', 'aborted'] }, passed: { type: 'boolean' }, guardCleaned: { type: 'boolean' },
              }, required: ['reason', 'passed', 'guardCleaned'], additionalProperties: false } },
            }, required: ['scope', 'productionAdmissionProven', 'cases'], additionalProperties: false },
          }, required: ['status'], additionalProperties: false },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        timeoutMs: 6000,
        async execute(args, exec) {
          if (!args || typeof args !== 'object' || Array.isArray(args)
            || Object.keys(args).some(key => key !== 'self_test')
            || (args.self_test !== undefined && typeof args.self_test !== 'boolean')) throw new Error('Expected optional boolean self_test')
          const result = {}
          if (args.self_test) {
            if (selfTestJob) throw new Error('A local self-test is already running; retry after it finishes')
            if (!guard.status().active) throw new Error('The close fix is no longer active; check for another wrapper')
            selfTestJob = runLocalSelfTest(binding, guard, AbortSignal.any([exec.signal, lifetime.signal]))
            try { result.self_test = await selfTestJob }
            finally { selfTestJob = undefined }
          }
          result.status = { version: '0.1.2', generation, consumerVersion: binding.consumerVersion,
            wsVersion: binding.wsVersion, sdkVersion: binding.sdkVersion, bindingVerified: true, ...guard.status() }
          return result
        },
      })
      return async () => {
        unregister()
        lifetime.abort(new Error('Codex close hotfix disabled'))
        guard.dispose()
        // The executing tool owns its failure; disposal only waits for local I/O cleanup.
        if (selfTestJob) await selfTestJob.catch((_error) => {})
      }
    } catch (error) { guard.dispose(); throw error }
  }, 'codex WebSocket close hotfix')
}
