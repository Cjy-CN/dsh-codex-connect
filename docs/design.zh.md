# Codex Connect for dsh：Alpha 设计

## 所有权与组合

本包通过 Harness 公共 `LlmRuntime` 与 `PiAiAdapter` 注册 `openai-codex`。主模型路径不是一次性 subagent，而是标准 Harness agent loop，因此原生工具审批、权限策略、流式输出、附件解析、reasoning replay、会话持久化、压缩与恢复均保持有效。

bundle patch 只插入 `llm-openai-codex`，不会写入 `agent-default-model` 或 `web.searchProvider`。`enableSearch` 与 `enableImageTool` 默认均为 `false`；关闭时不会注册对应可选服务。

## OAuth 持久化

插件使用 `$DSH_HOME/.openai-codex-auth.json`，与 Codex CLI/Desktop 状态分离。文件格式严格且有版本号；POSIX 上会拒绝组/其他用户可读文件。父目录和文件按仅所有者权限创建，写入采用原子替换，刷新修改使用 Harness 跨进程文件锁，返回给调用方的是凭据副本。

为兼容迁移，设置页路由、OAuth 路径和 provider id 不改名。只有显式登录会输出授权 URL 或代码；状态输出会脱敏。doctor 只用 `lstat` 检查元数据，不打开文件。

## 搜索与图片

仅当 `enableSearch: true` 时注册 Codex 独立搜索提供方和不含凭据的请求事件。多 provider 环境仍需显式设置 `web.searchProvider: openai-codex`。仅当 `enableImageTool: true` 且 tools、filesystem、attachments 服务存在时注册 `view_image`。

## 冲突、诊断与兼容边界

注册前检查现有 provider id；发现 `openai-codex` 已被占用时，给出旧 bundle 或手动 provider 配置的定向迁移提示。boot-free CLI doctor 只报告包/运行时版本、OAuth 路径元数据、能力默认值和安全提示。

Alpha 固定使用 Harness `0.1.0-rc.6` 开发依赖，同时面向当前 `0.1.0-rc.5` 主线组合与兼容 API；Node.js 支持 `^22.19.0 || >=24.0.0`。`@earendil-works/pi-ai` 固定为 `0.82.1`。资格、额度、模型和后端协议仍由上游控制。测试仅使用临时 OAuth 文档和模拟网络响应，CI 不执行真实认证。
