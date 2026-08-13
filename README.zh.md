# dsh Codex

[English](README.md) | 中文

通过 OpenAI Codex 登录流程，在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 中使用 ChatGPT 订阅，无需 OpenAI Platform API 密钥。

> [!IMPORTANT]
> 本插件必须配合修改版 [`Yan-Zero/deepseek-harness`](https://github.com/Yan-Zero/deepseek-harness) fork 使用，要求包含 commit `b1d42fc99f`（`feat: support externally authenticated providers`）或其后续提交。插件无法加载于未经修改的 upstream／公开版 dsh。该 fork 提供本 bundle 所需的提供方原生 OAuth 适配器入口，以及可持久化的辅助搜索请求事件。

本插件为 dsh 添加一条完整的 `openai-codex` 路由：

- ChatGPT OAuth 登录及 token 自动刷新
- Codex GPT 模型目录；账号可用时包括 `gpt-5.6-sol`
- 经 dsh 现有 LLM 路径提供流式响应、工具调用、图片、推理回放与提示词缓存
- 面向无状态 Codex 对话的 dsh 压缩
- 通过 dsh 普通 `web_search` 工具使用 Codex 独立搜索后端
- `cached`、`indexed`、`live` 三种搜索模式

OpenAI 在 [Codex 认证指南](https://learn.chatgpt.com/docs/auth.md)中明确区分 ChatGPT 订阅登录与按量计费的 API 密钥访问。本项目只将前者用于 ChatGPT Codex 后端，不会把订阅转换成通用 OpenAI API 凭据。

## 安装

本插件是独立的 dsh bundle。仓库包含构建产物，因此本地 checkout 可以直接安装：

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-codex
dsh plugin --profile web exec dsh-openai-codex login
dsh web
```

请把路径替换为本仓库的绝对目录。登录命令会打开浏览器并等待 localhost 回调。无界面主机可以使用 device-code 登录：

```sh
dsh plugin --profile web exec dsh-openai-codex login --device-code
```

Codex、Claude Code 及其他自动化 agent 应直接遵循 [INSTALL.md](INSTALL.md)。该文档是一份完整且可重复执行的安装 runbook，无需阅读源码或设计文档。

常用账号命令：

```sh
dsh plugin --profile web exec dsh-openai-codex status
dsh plugin --profile web exec dsh-openai-codex logout
```

bundle 会为新建 agent 选择 `openai-codex` / `gpt-5.6-sol`，并选择 Codex 搜索提供方。dsh settings 中已经保存的模型仍然优先；模型选择器也可以切换到当前账号可用的其他 Codex 模型。

所需 fork commit 分别从 `@deepseek-ai/dsh-llm-pi-ai` 与 `@deepseek-ai/dsh-web` 导出 `createPiAiCatalogAuthAdapter()` 和 `snapshotWebSearchModelRequest()`。准确的兼容性检查见 [INSTALL.md](INSTALL.md)。

## 搜索

提供方会把 dsh 现有的 `web_search` 工具连接到官方 Codex 客户端使用的独立搜索协议。搜索结果会成为普通 dsh 文本及 HTTP(S) 引用，因此后续轮次和压缩都会保留同一份工具历史。

在 profile patch 中配置 `llm-openai-codex`：

```yaml
- id: llm-openai-codex
  config:
    searchMode: live
    searchContextSize: medium
```

可用字段：

| 字段 | 默认值 | 可选值 |
|---|---:|---|
| `searchModel` | `gpt-5.6-sol` | Codex 模型 id |
| `searchMode` | `cached` | `cached`、`indexed`、`live` |
| `searchContextSize` | `medium` | `low`、`medium`、`high` |
| `searchMaxOutputTokens` | `10000` | 正整数 |

这些模式遵循 [Codex 官方搜索配置](https://learn.chatgpt.com/docs/config-file/config-basic#web-search-mode)；`live` 对应 `codex --search`。

## 凭据与隐私

dsh 登录与 Codex CLI／Desktop 相互独立：

- 凭据存储于 `$DSH_HOME/.openai-codex-auth.json`，默认位于 `~/.dsh`
- 文件原子写入，token 刷新会在本地 dsh 进程之间加锁
- status 与诊断不会打印 token 值
- 绝不复制或修改 `~/.codex/auth.json`

分离存储可以避免两个客户端竞争同一个会轮换的 refresh token。移除 bundle 不会删除凭据；需要移除本地账号时请运行 `logout`。

## 兼容性说明

- ChatGPT 套餐资格、模型权限、配额及 Codex 后端行为由 OpenAI 控制，可能发生变化。
- Codex 端点不执行普通 Responses 的 `max_output_tokens` 字段。压缩可以工作，但该路由无法在服务端落实配置的摘要上限。
- 本 bundle 提供认证、模型传输和搜索。文件系统、shell、skills、MCP、subagents、权限及 `web_search` 工具本身仍来自当前 dsh profile。
- 独立搜索端点不是公开的 OpenAI Platform API；兼容性取决于固定版本的 Codex／pi-ai 实现。

协议、回放、持久化与失败处理细节见[设计文档](docs/design.zh.md)。

## 开发

dsh 包是 peer dependencies。运行源码测试时，请由兼容的 dsh workspace 提供这些包，然后执行：

```sh
pnpm install
pnpm run check
```

`pnpm run check` 会执行严格 TypeScript 检查、16 项聚焦测试与可发布构建。

## 许可证

Apache-2.0
