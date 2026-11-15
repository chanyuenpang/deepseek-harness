import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { statusProperties } from '../host.js'
const require = createRequire(pathToFileURL(join(process.env.DSH_INSTALL_DIR, 'package.json')))
const { assertSupportedJsonSchema } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')))
assertSupportedJsonSchema({ type: 'object', properties: statusProperties, required: Object.keys(statusProperties), additionalProperties: false })
assert.throws(() => assertSupportedJsonSchema({ type: 'integer', minimum: 0 }), /minimum/)
console.log('installed output-schema subset: passed')
