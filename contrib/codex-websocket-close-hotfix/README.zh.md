# Codex WebSocket 关闭热修复

[English](README.md) | 中文

这是可回滚的社区 Host 插件，验证目标为 **DSH Desktop 0.2.2-rc.3、dsh-codex-subscription 3.2.14、pi-ai 1.3.0、ws 8.21.3**。它保护 SDK 在连接超时或取消时关闭尚未建立的 WebSocket 所引发的已知异步错误。它不是官方 Desktop 更新，不改写 `app.asar`。

## 安装与验证

1. 同一 profile 中应已安装上述受支持版本的 Codex 订阅插件。不要给不受支持的版本授予兼容性豁免。
2. 下载此分支，或只检出补丁目录：

   ```sh
   git clone --filter=blob:none --sparse --branch desktop-codex-websocket-hotfix https://github.com/chanyuenpang/deepseek-harness.git
   cd deepseek-harness
   git sparse-checkout set contrib/codex-websocket-close-hotfix
   npm pack ./contrib/codex-websocket-close-hotfix
   ```

3. 在 DSH“插件 → 添加插件”中选择生成的 `chanyuenpang-dsh-codex-websocket-close-hotfix-0.1.2.tgz`。请安装压缩包而不是链接源码目录，以便正确解析当前 profile 中的依赖身份。也可使用：

   ```sh
   dsh plugin --profile desktop add ./chanyuenpang-dsh-codex-websocket-close-hotfix-0.1.2.tgz
   ```

4. 让助手调用 `codex_websocket_hotfix_check`，参数为 `self_test: true`。`bindingVerified` 表示版本、源码指纹及消费者依赖核对通过，`active` 表示当前接纳层仍由本补丁拥有。纯本机自检不联系 OpenAI，不读取凭据；其计数不代表生产请求命中。
5. 下一次正常 Codex 新连接应增加 `admitted`，这才是实际 SDK 调用点进入补丁的证据。安装前已经在 CONNECTING 状态的连接不追溯保护。如果工具未出现或安装器要求重启，请手动重启 Desktop 后复查。替换已经加载的插件包也需要新的 Host 模块代次。

## 行为与回滚

插件解析 Codex 订阅插件自己使用的 `ws` 类，并核对精确版本和源码指纹。只接纳来自已安装 SDK `connectWebSocket` 的 CONNECTING 错误监听注册，随后给该连接安装临时关闭包装。仅当 SDK `closeWebSocketSilently` 以代码 `1000`、原因为 `connect_timeout` 或 `aborted` 关闭连接时，才接住该次关闭派生的精确错误。其他错误和已有监听器保留原有行为；不会变更 WebSocket 模式、请求失败语义、OAuth、代理或 SDK 原有回退策略。

在插件页停用“Codex WebSocket 关闭热修复”即可停止接纳新连接，诊断工具随之撤销。已经接纳的在途连接仍受保护，直到自然 open/close 后清理；不会主动关闭用户连接。未知的前置包装或不受支持的版本会使启用明确失败，不能假报生效。后装包装不会在回滚时被覆盖，冲突会出现在诊断中；重复接纳层拒绝叠加。

## 模型体验

仅增加一个诊断工具，不增加提示词、会话数据或模型请求。诊断只输出版本、归属状态和聚合计数，不记录请求查询串、请求头、凭据、账本或用户路径。签名 SDK 文件保持原样；这是运行时局部缓解，不冒称已经把上游源码补丁写入官方安装包。

## 开发验证

`npm run check` 检查运行时代码语法。`npm test` 使用开发依赖 `ws` 运行局部保护测试；将 `CODEX_PROFILE_ANCHOR` 设为受支持 profile 的包清单路径，可改用消费者实际使用的库。要额外执行真实安装版 SDK 的负／正对照，请将 `HOTFIX_ELECTRON_EXECUTABLE` 设为 Desktop 可执行文件路径，将 `DSH_INSTALL_DIR` 设为其 CLI（命令行界面）包目录。隔离的 Electron Node 模式 fixture（测试前置数据）只建立本机连接并使用合成 token；负对照必须以原致命错误退出。测试分别记录 SDK 失败结果、本机自检和真实生产接纳。

## 已知限制

仅覆盖本次复现的建连中关闭错误，不能证明所有网络错误或其他崩溃均已修复。SDK 或 WebSocket 源码变化会被精确指纹拒绝，需要重新审查。插件没有自定义 Client 界面；插件清单图标和文案的真实渲染仍需在具备认证的浏览器中单独检查。
