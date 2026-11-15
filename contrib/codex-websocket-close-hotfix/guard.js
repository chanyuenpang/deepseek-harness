import { sourceHash, SUPPORTED } from './consumer.js'
import { pathToFileURL } from 'node:url'

const MARK = 'dshCodexConnectingCloseGuardV1'
const DERIVED_ERROR = 'WebSocket was closed before the connection was established'
const TARGET = 'wss://chatgpt.com/backend-api/codex/responses'
const normalized = value => String(value).replaceAll('\\', '/').replaceAll('%20', ' ').toLowerCase()

/** Install one admission layer; existing admitted sockets retain protection on disposal. */
export function installGuard({ WebSocket, sdkUrl, wsFile }) {
  const proto = WebSocket.prototype
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'addEventListener')
  const originalAdd = descriptor?.value
  if (originalAdd?.[MARK]) throw new Error('Codex close hotfix is already installed; disable the older entry first')
  if (typeof originalAdd !== 'function' || sourceHash(originalAdd.toString()) !== SUPPORTED.addHash) {
    throw new Error('WebSocket.addEventListener is already wrapped or unsupported')
  }
  const records = new Map()
  let accepting = true, conflict = false
  const reportConflict = () => {
    if (!conflict) console.warn('[codex-close-hotfix] Another WebSocket wrapper was retained, not overwritten. After disabling conflicting wrappers, manually restart Desktop to fully reset the chain.')
    conflict = true
  }
  const counts = { admitted: 0, guardedCloses: 0, derivedErrors: 0, cleaned: 0,
    diagnosticAdmitted: 0, diagnosticCloses: 0, diagnosticErrors: 0, unmatchedCandidates: 0 }
  const sdkLocation = normalized(sdkUrl) + ':'
  const fromSdk = (stack, fn) => normalized(stack).includes('at ' + fn.toLowerCase() + ' (' + sdkLocation)
  const fromWsClose = stack => [normalized(wsFile), normalized(pathToFileURL(wsFile).href)]
    .some(file => normalized(stack).includes('(' + file + ':'))
  const target = socket => {
    try { const url = new URL(socket.url); return url.origin + url.pathname === TARGET }
    catch (_error) { return false /* Non-URL sockets are not a Codex target. */ }
  }

  function admit(socket, diagnostic) {
    if (records.has(socket) || socket.close?.[MARK]) return
    const ownClose = Object.getOwnPropertyDescriptor(socket, 'close')
    const originalClose = socket.close
    let finished = false, armed = false
    const finish = () => {
      if (finished) return
      finished = true
      socket.removeListener('open', finish)
      socket.removeListener('close', finish)
      socket.removeListener('error', guardError)
      if (socket.close === close) {
        if (ownClose) Object.defineProperty(socket, 'close', ownClose)
        else delete socket.close
      } else reportConflict()
      records.delete(socket)
      counts.cleaned++
    }
    const guardError = error => {
      if (error?.message === DERIVED_ERROR && fromWsClose(error.stack)) {
        counts[diagnostic ? 'diagnosticErrors' : 'derivedErrors']++
        return
      }
      // EventEmitter must still fail for an unrelated error with no real observer.
      if (!socket.listeners('error').some(listener => listener !== guardError)) throw error
    }
    function close(...args) {
      const eligible = !finished && this === socket && socket.readyState === WebSocket.CONNECTING
        && args[0] === 1000 && ['aborted', 'connect_timeout'].includes(args[1])
        && (diagnostic || fromSdk(new Error().stack, 'closeWebSocketSilently'))
      if (eligible && !armed) {
        armed = true
        socket.prependListener('error', guardError)
        counts[diagnostic ? 'diagnosticCloses' : 'guardedCloses']++
      }
      try { return Reflect.apply(originalClose, this, args) }
      catch (error) { finish(); throw error }
    }
    Object.defineProperty(close, MARK, { value: true })
    Object.defineProperty(socket, 'close', { configurable: true, writable: true, enumerable: ownClose?.enumerable ?? false, value: close })
    records.set(socket, finish)
    socket.once('open', finish)
    socket.once('close', finish)
    counts[diagnostic ? 'diagnosticAdmitted' : 'admitted']++
  }

  function addEventListener(...args) {
    if (accepting && args[0] === 'error' && this.readyState === WebSocket.CONNECTING && target(this)) {
      if (fromSdk(new Error().stack, 'connectWebSocket')) admit(this, false)
      else counts.unmatchedCandidates++
    }
    return Reflect.apply(originalAdd, this, args)
  }
  Object.defineProperty(addEventListener, MARK, { value: true })
  Object.defineProperty(proto, 'addEventListener', { ...descriptor, value: addEventListener })
  return {
    status: () => ({ active: accepting && proto.addEventListener === addEventListener,
      draining: !accepting && records.size > 0, pendingSockets: records.size,
      conflict: conflict || (accepting && proto.addEventListener !== addEventListener), ...counts }),
    /** Only the internal loopback diagnostic uses this; never marks production admission. */
    admitDiagnostic(socket) {
      if (!accepting) throw new Error('Hotfix is disabled')
      admit(socket, true)
    },
    dispose() {
      if (!accepting) return
      accepting = false
      if (proto.addEventListener === addEventListener) Object.defineProperty(proto, 'addEventListener', descriptor)
      else reportConflict()
      // Do not remove protection from already admitted CONNECTING sockets.
      // Their open/close event owns cleanup, even after the plugin is disabled.
    },
  }
}
