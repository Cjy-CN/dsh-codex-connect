# 设计：OpenAI Codex 订阅组合包

Status: implemented

[English](design.md) | 中文

## 范围

`@dsh-external/dsh-openai-codex` 是标准 DeepSeek Harness bundle。它在不修改 dsh 源码的前提下提供 ChatGPT OAuth、Codex 模型目录、Codex 独立搜索提供方、浏览器账号设置和 `view_image` 工具。当前 dsh profile 继续负责 agent loop、附件、文件系统策略、工具、权限、压缩与 Web 输入框。

## 认证

插件把 OAuth 端点、PKCE／device code 行为、account id 提取、token 刷新和 Codex 请求认证交给固定版本的 pi-ai Codex provider。用户可以从插件的设置页面或 `dsh-openai-codex` 可执行文件启动同一套登录生命周期。Web 认证路由只接受回环地址的同源请求，返回 `no-store` JSON，且绝不暴露 token。账号页面会在不发送模型请求的情况下读取固定的 ChatGPT Codex usage 端点，把服务端用量转换为剩余百分比进度条；只有响应包含 credit 或 workspace limit 数值时才显示精确额度。

凭据以带版本的 JSON 文档存储在 `$DSH_HOME/.openai-codex-auth.json`。文件采用原子写入，跨进程锁覆盖登录、刷新和登出。该存储有意与 `~/.codex/auth.json` 分离；如果两个独立写入的客户端共享会轮换的 refresh token，其中任一方都可能使另一方的凭据失效。

## 模型适配器与压缩

bundle 使用公开的 `PiAiAdapter` 以及随附的 `openai-codex` provider 和模型目录。凭据解析器会刷新 OAuth 状态，并把所得 bearer token 作为显式的单次请求凭据传入。它不会发现环境中的 API Key，也不依赖 dsh 的私有适配器辅助函数。

因此，普通轮次与 `dsh-compaction-basic` 都经过标准 LLM 服务。消息转换、流式输出、工具调用、图片附件解析、用量、溢出分类、加密推理回放和取消仍由适配器负责。Codex 请求采用无状态模式（`store: false`），所以回放数据及完整的工具调用／结果配对保存在 Harness session 中，不依赖服务端 response id。

ChatGPT Codex 路由不会执行普通 Responses 的输出 token 上限。压缩仍使用模型目录中的上下文容量与标准检查点替换，但配置的摘要 token 上限无法在此路由由服务端强制执行。

## 图片

Codex 模型从 provider 目录继承其声明的输入模态。现有 dsh Web 输入框已经会把粘贴或拖放的图片转换为持久附件，因此浏览器插件只增加账号设置，不替换输入框。

插件提供的 `view_image` 工具接受本地路径或 HTTP(S) URL。本地读取经过已配置的文件系统服务；远程下载拒绝 URL 内嵌凭据，限制重定向次数和字节数，并响应取消。PNG、JPEG、WebP 与 GIF 通过文件签名识别；工具先经附件服务保存图片，再返回真正的图片内容块。所选模型未明确声明图片输入时，工具会拒绝执行。

## 搜索与会话历史

bundle 为 dsh 现有的 `web_search` 工具注册提供方。它使用 Codex 独立搜索端点与同一份可刷新 OAuth 凭据，把结构化文本结果转换为规范化的 HTTP(S) 引用，并支持 cached、indexed 和 live 模式。端点固定，profile 配置无法把 bearer token 重定向到其他地址。

每次发送前，提供方都会把已经解析默认值且不含凭据的 `{ endpoint, body }` 精确记录为 `web/openai-codex-search-llm-request`。这个专用事件归插件所有：它通过声明合并加入 `SessionEventMap`，并在插件加载时注册到当前进程的 session 事件词汇。注册会保留到进程结束，避免热重载使已经写入的 session 突然无法读取。

插件绝不会写入已停用的通用 `web/search-model-request` 事件。包含 Codex 专用事件的 session 必须在本插件已加载时读取，因为该请求属于模型可见历史，不能标记为可忽略。

## 组合

`cordis.patch.yml` 提供一条 `llm-openai-codex` 配置项，为新建 agent 选择 `openai-codex` / `gpt-5.6-sol`，并选择对应的搜索提供方。用户 settings 中已经保存的模型仍然优先。shell、文件系统、skills、MCP、subagents、权限、附件、压缩与 `web_search` 工具仍由选定的 dsh profile 提供。

## 后果

用户可以在每个 Harness home 登录一次，无需 OpenAI Platform API Key 即可使用账号有权访问的 Codex 模型、视觉输入、压缩和 Codex 搜索。移除 bundle 不会删除凭据。ChatGPT 套餐资格、模型权限、配额、OAuth 行为和独立搜索协议仍由提供方控制，可能独立于本插件发生变化。
