# Codex WebSocket close hotfix

English | [中文](README.zh.md)

A reversible, community Host plugin for DSH Desktop **0.2.2-rc.3**, **dsh-codex-subscription 3.2.14**, **pi-ai 1.3.0**, and **ws 8.21.3**. It protects the known asynchronous `WebSocket was closed before the connection was established` error after SDK connection timeout or cancellation. This is not an official Desktop update and does not rewrite `app.asar`.

## Install and verify

1. Keep the supported Codex subscription plugin installed in the same profile. Do not grant version exemptions for this hotfix on an untested runtime.
2. Download this branch, or use a sparse checkout:

   ```sh
   git clone --filter=blob:none --sparse --branch desktop-codex-websocket-hotfix https://github.com/chanyuenpang/deepseek-harness.git
   cd deepseek-harness
   git sparse-checkout set contrib/codex-websocket-close-hotfix
   npm pack ./contrib/codex-websocket-close-hotfix
   ```

3. In DSH **Plugins → Add plugin**, select the generated `chanyuenpang-dsh-codex-websocket-close-hotfix-0.1.2.tgz`. Install the archive, not a linked source directory: dependency identity must resolve from the installed profile. The CLI equivalent is:

   ```sh
   dsh plugin --profile desktop add ./chanyuenpang-dsh-codex-websocket-close-hotfix-0.1.2.tgz
   ```

4. Ask the assistant to run `codex_websocket_hotfix_check` with `self_test: true`. `bindingVerified` checks the supported source/version and consumer dependency; `active` checks ownership of the admission hook. The loopback test never contacts OpenAI or reads credentials. Its counters are **not** production counters.
5. A later normal Codex connection increments `admitted`. This confirms the actual SDK call point reached the hook. Existing connections that were already CONNECTING before installation are not retroactively protected. If the new tool is absent or the manager reports a required restart, manually restart Desktop and check again. Replacing an already installed package also needs a fresh Host module generation.

## Behavior and rollback

The plugin resolves the subscription plugin's own `ws` class. It checks exact tested source fingerprints and only admits CONNECTING error-listener registration from the installed SDK's `connectWebSocket`. It then gives that socket a temporary close wrapper. Only SDK `closeWebSocketSilently` calls with code `1000` and reason `connect_timeout` or `aborted` receive the temporary guard. The exact ws closing-derived error is contained; unrelated errors and existing observers retain their normal behavior. WebSocket mode, request failure, OAuth, proxy routing and fallback policy are not changed.

Disable **Codex WebSocket close hotfix** in Plugins to stop admitting new sockets; its diagnostic tool disappears. Already admitted connections retain protection until open/close and then release it. No user connection is proactively closed. An unknown prior wrapper or unsupported version fails activation rather than claiming success. A later wrapper is never overwritten during cleanup; a conflict is reported. Duplicate admission layers are rejected instead of stacked.

## Model experience

The bundle adds one diagnostic tool and no prompt text, conversation data or inference request. Diagnostic output contains only version, ownership and aggregate counters. No request URL query, headers, credentials, ledger or user path is recorded. The signed SDK file remains unchanged; this runtime mitigation does not claim to install the upstream source patch itself.

## Development verification

`npm run check` checks runtime syntax. `npm test` runs the local guard tests using dev dependency `ws`; set `CODEX_PROFILE_ANCHOR` to the supported profile's package manifest to use the consumer's exact library instead. To additionally execute the real installed SDK negative/positive cases, set `HOTFIX_ELECTRON_EXECUTABLE` to the Desktop executable and `DSH_INSTALL_DIR` to its CLI package directory. The isolated Electron-as-Node fixture creates only loopback connections and a synthetic token; negative cases must exit with the original fatal error. Tests distinguish SDK failure results, local self-tests and real production admission.

## Known limitations

This mitigation covers the reproduced CONNECTING-close failure only. Exact source fingerprints intentionally reject changed SDK or WebSocket implementations. It does not certify other network failures, fix unrelated crashes, or change the officially signed Desktop distribution. The Host-only bundle's inventory icon and metadata have no custom Client code; installed visual rendering must be checked separately when an authenticated browser is available.
