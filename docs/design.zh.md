# 设计：OpenAI Codex 订阅组合包

Status: implemented

[English](design.md) | 中文

兼容性：必须使用包含 commit `b1d42fc99f` 或其后续提交的修改版 `Yan-Zero/deepseek-harness` fork；未经修改的 upstream／公开版没有本 bundle 所需的扩展点。

## 问题

通用 `llm-pi-ai` 插件已经可以保留 pi-ai 随附的 `openai-codex` 协议与模型 catalog，但其 settings 表层有意只负责 API 密钥引用，并且不会构造 OAuth 凭据存储。因此，手工声明该路由无法刷新 ChatGPT 凭据；把 OAuth access token 当作 `apiKeyEnv` 则会在到期后失效且无法恢复。OpenCode 的第三方 Codex 插件表明，ChatGPT 订阅访问需要提供方原生 OAuth 流程与 ChatGPT Codex Responses 后端，不能把 OAuth token 当成通用 `api.openai.com/v1` 密钥。该集成在登录之外还必须满足模型运行时要求：无状态历史、加密推理回放、工具配对保留、用量与溢出分类、经普通 LLM seam 运行的压缩，以及模型可见输入与输出均可重建的可引用搜索。

## 决策

**订阅访问采用可选组合包。** `@dsh-external/dsh-openai-codex` 提供一条复合 `llm-openai-codex` 配置项，把新建 agent 的组合默认值改为 `openai-codex` / `gpt-5.6-sol`，并为 `ctx.web.search` 选择同一 id；已保存的模型选择仍然优先。通用 Models settings 目录继续排除仅支持 OAuth 的提供方，因此绝不会把 Codex 渲染成 API 密钥卡片。手工配置的 `llm-pi-ai.providers.openai-codex` 路由会与专用组合包响亮冲突，避免形成归属不明的路由。

**插件负责显式终端登录。** 随附的 `dsh-openai-codex` 可执行文件无需启动 profile 即可运行，并支持 login、logout 与 status。浏览器 PKCE 是默认方式，无界面主机显式选择 device code。它把 OAuth 端点、account id 提取、token 刷新和 Codex 请求认证交给固定版本的 pi-ai provider，而不会复制 OpenCode 或 Codex CLI 常量。凭据以严格、带版本的 JSON 文档存储在 `$DSH_HOME/.openai-codex-auth.json`，仅所有者可访问，并通过原子替换写入；跨进程写入锁覆盖 login、refresh 与 logout。该文件与 `~/.codex/auth.json` 分离，避免两个独立写入者争用会轮换的 refresh token。诊断和 status 均不暴露 token 值。

**提供方保持在共享 LLM 路径上。** `createPiAiCatalogAuthAdapter()` 是 `llm-pi-ai` 的窄扩展点：它接受提供方原生凭据存储，同时保留随附 provider 的 catalog、协议实现、请求转换、回放投影和流转换。可配置插件仍然逐请求传入 API 密钥，且不注入存储。Codex 组合包把生成的适配器注册到 `ctx.llm`，因此普通轮次与 `dsh-compaction-basic` 辅助调用共用相同的已记录消息、工具 schema、session 标识、取消、用量、结束和溢出行为。

**Codex 无状态回放是持久的。** provider 发送 `store: false` 并请求 `reasoning.encrypted_content`。`llm-pi-ai` 把加密条目存入带版本的回放状态，并且只在适配器、提供方和模型标识都相同时恢复。工具调用和结果会重建为完整匹配的历史，而不是服务器保存的 item reference，压缩输入也不例外。ChatGPT 后端不接受普通 Responses 输出 token 上限；压缩仍使用 catalog 上下文容量、完整前缀摘要、检查点校验和替换，但其配置的摘要 `maxTokens` 无法在此路由上由服务器执行，并作为限制写入文档。

**客户端能力继续由 dsh 负责。** 本组合包不会嵌入 Codex CLI 配置或工具实现。shell、文件系统、skills、MCP、subagents、权限、压缩和 `web_search` 函数工具来自所选 dsh profile。组合包使用官方客户端独立的 `alpha/search` 协议与同一份可刷新 OAuth 凭据，为现有搜索 seam 注册提供方。其端点固定，配置无法把 bearer token 重定向到其他地址。提供方会在发送前记录完整且不含密钥的请求，并把结构化 `text_result` 记录映射为规范化引用；普通工具事件则记录查询与返回表层。这让后续轮次与压缩可以重建内容，同时无需让 pi-ai 传输表示托管的 `web_search_call` 条目。组合包 patch 会选择该提供方，同时保留 base DeepSeek 提供方的注册。

**搜索策略采用显式配置。** 提供方支持官方的 cached、indexed 和 live 外部 web 模式，默认使用 cached；模型、搜索上下文大小和输出预算同样可配置。未知结果 DTO 会被忽略以保持前向兼容，只有 HTTP(S) 来源可被引用，重复 URL 会去重，最终 `maxResults` 截断由共享 web seam 负责。凭据缺失与 401/403 会指明登录操作；取消与畸形网络响应使用共享 web 错误词汇。

## 考虑过的替代方案

**移植 OpenCode 插件的请求转换器与 OAuth 常量。** 否决，因为 dsh 已固定依赖一个维护中的 pi-ai Codex OAuth 与 Responses 协议实现。第二套实现会重复安全敏感的端点、刷新行为、模型兼容性、无状态推理回放和工具历史修复。

**让通用 Models settings 卡片保存 OAuth。** 否决，因为该表层与 Harness 凭据 seam 负责具名 API 密钥值，而 OAuth 拥有交互式生命周期与结构化刷新状态。为 `openai-codex` 展示 API 密钥编辑器会同时错误表达输入及其续期行为。

**通过 `subagent-codex` 复用宿主 Codex CLI。** 否决，因为该包启动的是完整外部 coding agent（编程智能体），并不实现 Harness LLM 适配器 seam，因此无法服务普通模型选择、agent loop（智能体循环）请求日志或 `dsh-compaction-basic` 调用。

**把订阅登录加入每个 base profile。** 否决，因为 ChatGPT 认证是个人、可选且受提供方套餐策略约束的行为。base 仍可使用 DeepSeek 或 API 密钥提供方；除非用户调用专用命令，否则不会执行 OpenAI 登录或创建凭据文件。

**向模型请求注入托管的 Codex web-search 工具。** 否决，因为仅让请求被接受并不完整：固定版本的 LLM 传输不会把 `web_search_call` 条目、结果与引用注解投影到持久 Harness 消息中。实际实现的独立提供方会发送一次显式记录的辅助请求，并通过既有的已记录工具 seam 返回规范化数据。

## 后果

用户可以在每个 Harness home 登录一次，把组合包安装到选定 profile，并在没有 OpenAI Platform 或 DeepSeek API 密钥的情况下同时使用随附的 Codex GPT catalog 与 dsh `web_search`。OAuth 刷新可安全跨越并发本地 dsh 进程；移除组合包不会静默删除机器凭据，logout 会点名已删除的文件。ChatGPT 套餐资格、模型可用性、用量上限、OAuth 行为与私有独立搜索协议仍属于外部策略；此组合包是本地个人集成，不是通用 OpenAI API 或多用户生产授权。测试固定严格的 secret 存储、启动器语法与脱敏、真实 Loader 注册／dispose、catalog 暴露、无状态压缩回放、搜索模式与标头、引用规范化、取消和失败映射。
