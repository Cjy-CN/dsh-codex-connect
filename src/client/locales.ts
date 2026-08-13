/** English copy for the OpenAI Codex settings page. */
export const en = {
  nav: 'OpenAI Codex',
  title: 'OpenAI Codex',
  intro: 'Use your ChatGPT subscription in dsh without an API key.',
  signedOut: 'Not signed in',
  signingIn: 'Waiting for browser authorization…',
  signedIn: 'Signed in',
  expires: 'Current access expires {date}. The plugin refreshes it automatically.',
  login: 'Sign in with ChatGPT',
  loginAgain: 'Sign in again',
  logout: 'Sign out',
  working: 'Working…',
  retry: 'Retry',
  popupBlocked: 'The browser blocked the sign-in window. Allow pop-ups for this dsh page and retry.',
  localOnly: 'Browser sign-in is available only when this page is opened from the same computer as dsh. The CLI login remains available for remote deployments.',
  features: 'This provider includes Codex models, standalone web search, pasted image input, and the view_image tool for local paths or HTTP(S) URLs.',
  storage: 'The credential is stored under the dsh home directory and is separate from the Codex CLI credential.',
  requestFailed: 'The OpenAI Codex account request failed.',
}

/** Keys shared by both dictionaries. */
export type OpenAICodexSettingsKey = keyof typeof en

/** Chinese copy for the OpenAI Codex settings page. */
export const zh: { [Key in OpenAICodexSettingsKey]: string } = {
  nav: 'OpenAI Codex',
  title: 'OpenAI Codex',
  intro: '使用 ChatGPT 订阅在 dsh 中调用模型，无需 API Key。',
  signedOut: '尚未登录',
  signingIn: '正在等待浏览器授权…',
  signedIn: '已登录',
  expires: '当前访问凭证将在 {date} 到期，插件会自动刷新。',
  login: '使用 ChatGPT 登录',
  loginAgain: '重新登录',
  logout: '退出登录',
  working: '处理中…',
  retry: '重试',
  popupBlocked: '浏览器阻止了登录窗口。请允许此 dsh 页面弹出窗口后重试。',
  localOnly: '仅当此页面与 dsh 运行在同一台电脑时才能从浏览器登录；远程部署仍可使用 CLI 登录。',
  features: '此提供方包含 Codex 模型、独立联网搜索、粘贴图片输入，以及可读取本地路径或 HTTP(S) URL 的 view_image 工具。',
  storage: '凭证保存在 dsh 主目录下，与 Codex CLI 的凭证相互独立。',
  requestFailed: 'OpenAI Codex 账户请求失败。',
}
