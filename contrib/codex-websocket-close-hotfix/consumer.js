import { createRequire } from 'node:module'
import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

export const SUPPORTED = Object.freeze({
  consumer: '3.2.14', ws: '8.21.3', sdk: '1.3.0',
  sdkHash: '4d90da82aaac68f9f0e1fd7daec39f1aa285c111bf04c7ddefa52e920b41b2cc',
  closeHash: '034a550638c3c9477124538457d43bad45ae0a279dbfd53b42e3b062035ce25b',
  addHash: '785899cb32e30cd2ab4f581fc75993b23fa00b60e0f097e84804c719fcfcbe00',
})

/** Fingerprint source without platform newline differences. */
export const sourceHash = source => createHash('sha256').update(source.replaceAll('\r\n', '\n')).digest('hex')

/** Resolve the consumer's own CJS ws instance, never this package's dev dependency. */
export function resolveConsumer(anchor, coreEntry) {
  const require = createRequire(anchor)
  const consumerPackage = require.resolve('dsh-codex-subscription/package.json')
  const consumerVersion = JSON.parse(readFileSync(consumerPackage, 'utf8')).version
  if (consumerVersion !== SUPPORTED.consumer) throw new Error(`Unsupported dsh-codex-subscription ${consumerVersion}; disable this hotfix before upgrading`)
  const consumerRequire = createRequire(require.resolve('dsh-codex-subscription'))
  const wsPackage = consumerRequire.resolve('ws/package.json')
  const wsVersion = JSON.parse(readFileSync(wsPackage, 'utf8')).version
  if (wsVersion !== SUPPORTED.ws) throw new Error(`Unsupported ws ${wsVersion}`)
  const WebSocket = consumerRequire('ws')
  const roots = createRequire(coreEntry).resolve.paths('@earendil-works/pi-ai') ?? []
  const sdkPackage = roots.map(root => join(root, '@earendil-works/pi-ai/package.json')).find(path => existsSync(path))
  if (!sdkPackage) throw new Error('Cannot locate the installed pi-ai package from the core adapter')
  const sdkVersion = JSON.parse(readFileSync(sdkPackage, 'utf8')).version
  const sdkFile = realpathSync(join(dirname(sdkPackage), 'dist/api/openai-codex-responses.js'))
  if (sdkVersion !== SUPPORTED.sdk || sourceHash(readFileSync(sdkFile, 'utf8')) !== SUPPORTED.sdkHash) {
    throw new Error('Unsupported or already changed Codex SDK; review this hotfix before enabling it')
  }
  if (sourceHash(WebSocket.prototype.close.toString()) !== SUPPORTED.closeHash) throw new Error('WebSocket.close is already wrapped or unsupported')
  return { WebSocket, consumerVersion, wsVersion, sdkVersion, sdkUrl: pathToFileURL(sdkFile).href,
    wsFile: realpathSync(join(dirname(wsPackage), 'lib/websocket.js')) }
}
